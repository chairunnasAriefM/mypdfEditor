import {
  PDFDocument, PDFName, PDFRawStream, PDFArray, StandardFonts, degrees,
  pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject
} from 'pdf-lib'
import pdfjs from './pdfjs'
import { createPool } from './workerPool'

const OPS = pdfjs.OPS
const tick = () => new Promise((r) => setTimeout(r, 0))
const MB = 1048576

// Tingkat kompresi (makin ke bawah makin kecil).
// Berwarna = MRC: teks = bitmap 1-bit pada maskDpi (tajam), latar/foto = JPEG pada bgDpi.
// Yang diturunkan lebih dulu adalah latar/foto; resolusi teks tidak turun di bawah 150 dpi (masih terbaca).
// Tingkat "soft" hanya dipakai bila pengguna mengizinkan.
const LEVELS = {
  color: [
    { maskDpi: 200, bgDpi: 150, q: 0.55, px: 1700 }, { maskDpi: 200, bgDpi: 120, q: 0.46, px: 1400 },
    { maskDpi: 170, bgDpi: 110, q: 0.42, px: 1250 }, { maskDpi: 150, bgDpi: 100, q: 0.4, px: 1100 }
  ],
  bw: [
    { dpi: 250, q: 0.6, px: 1700 }, { dpi: 200, q: 0.55, px: 1500 },
    { dpi: 170, q: 0.5, px: 1300 }, { dpi: 150, q: 0.45, px: 1150 }
  ]
}
const SOFT = {
  color: [
    { maskDpi: 130, bgDpi: 90, q: 0.36, px: 900 }, { maskDpi: 110, bgDpi: 75, q: 0.32, px: 750 },
    { maskDpi: 100, bgDpi: 60, q: 0.28, px: 650, noText: true }
  ],
  bw: [{ dpi: 130, q: 0.4, px: 950 }, { dpi: 110, q: 0.35, px: 800 }]
}
// Cadangan (berwarna, mode manual): halaman yang banyak gambarnya (> 15%) ikut dibuat berlapis.
const RESCUE = [{ maskDpi: 170, bgDpi: 110, q: 0.42, px: 1200 }, { maskDpi: 150, bgDpi: 100, q: 0.4, px: 1050 }]
const RESCUE_SOFT = [{ maskDpi: 130, bgDpi: 85, q: 0.34, px: 850 }]
// Tahap terakhir mode Otomatis: SEMUA halaman dijadikan hitam-putih; makin ke bawah makin kecil,
// teks tersembunyi dibuang agar ukuran minimal. Resolusi terendah 85 dpi masih terbaca untuk teks normal.
const SQUEEZE = [
  { dpi: 150, q: 0.4, px: 800 }, { dpi: 120, q: 0.35, px: 700, noText: true },
  { dpi: 100, q: 0.3, px: 600, noText: true }, { dpi: 85, q: 0.3, px: 500, noText: true }
]

const IMAGE_OPS = new Set([
  OPS.paintImageXObject, OPS.paintImageXObjectRepeat, OPS.paintInlineImageXObject,
  OPS.paintInlineImageXObjectGroup, OPS.paintImageMaskXObject
].filter((x) => x !== undefined))

/** Proporsi luas halaman yang tertutup gambar (melacak CTM lewat daftar operator pdf.js). */
function imageCoverage(opList, pageArea) {
  let ctm = [1, 0, 0, 1, 0, 0]
  const stack = []
  let area = 0
  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i], a = opList.argsArray[i]
    if (fn === OPS.save) stack.push(ctm)
    else if (fn === OPS.restore) ctm = stack.pop() || ctm
    else if (fn === OPS.transform) ctm = pdfjs.Util.transform(ctm, a)
    else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (a?.[0]) ctm = pdfjs.Util.transform(ctm, a[0]) }
    else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm
    else if (IMAGE_OPS.has(fn)) area += Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2])
  }
  return Math.min(1, area / pageArea)
}

/** Analisis tiap halaman: ukuran, jumlah karakter teks, dan apakah termasuk halaman scan. */
export async function analyze(pdfDoc, onProgress, signal) {
  const pages = []
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    if (signal?.cancelled) throw new Error('Dibatalkan')
    onProgress?.({ text: `Menganalisis halaman ${i}/${pdfDoc.numPages}`, pct: (i / pdfDoc.numPages) * 15 })
    const pg = await pdfDoc.getPage(i)
    const v = pg.getViewport({ scale: 1 })
    const text = await pg.getTextContent()
    const chars = text.items.reduce((s, it) => s + (it.str || '').trim().length, 0)
    const coverage = imageCoverage(await pg.getOperatorList(), v.width * v.height)
    pages.push({ w: v.width, h: v.height, chars, coverage, scan: coverage > 0.5 })
    pg.cleanup()
    if (i % 5 === 0) await tick()
  }
  return pages
}

/** Render halaman ke RGBA. Canvas tanpa willReadFrequently agar dirender dengan akselerasi GPU. */
async function rasterizeRGBA(pdfDoc, n, dpi) {
  const pg = await pdfDoc.getPage(n)
  const v1 = pg.getViewport({ scale: 1 })
  const k = Math.min(dpi / 72, 4600 / Math.max(v1.width, v1.height))
  const v = pg.getViewport({ scale: k })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(v.width); canvas.height = Math.round(v.height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await pg.render({ canvasContext: ctx, viewport: v }).promise
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  pg.cleanup()
  canvas.width = canvas.height = 0
  return { rgba: img.data, w: img.width, h: img.height, pw: v1.width, ph: v1.height }
}

const toJpeg = (canvas, q) =>
  new Promise((res, rej) => canvas.toBlob(async (b) => (b ? res(new Uint8Array(await b.arrayBuffer())) : rej(new Error('JPEG gagal'))), 'image/jpeg', q))

/** Lapisan teks tak terlihat agar halaman hasil rasterisasi tetap bisa dicari / disalin. */
async function addInvisibleText(pdfDoc, n, page, font) {
  const pg = await pdfDoc.getPage(n)
  const vp = pg.getViewport({ scale: 1 })
  const tc = await pg.getTextContent()
  let count = 0
  for (const it of tc.items) {
    if (!it.str || !it.str.trim() || ++count > 4000) continue
    const t = pdfjs.Util.transform(vp.transform, it.transform)
    const size = Math.hypot(t[0], t[1]) || 10
    let s = ''
    for (const ch of it.str) { try { font.widthOfTextAtSize(ch, 10); s += ch } catch { s += '?' } }
    try {
      page.drawText(s, { x: t[4], y: vp.height - t[5], size, font, opacity: 0, rotate: degrees((-Math.atan2(t[1], t[0]) * 180) / Math.PI) })
    } catch { /* abaikan item bermasalah */ }
  }
  pg.cleanup()
}

const NM = (x) => PDFName.of(x)

async function inflate(u8) {
  const ds = new DecompressionStream('deflate')
  const w = ds.writable.getWriter()
  w.write(u8); w.close()
  return new Uint8Array(await new Response(ds.readable).arrayBuffer())
}

function unpredict(data, colors, bpc, cols, pred) {
  if (pred === 1) return data
  if (pred < 10) return null // TIFF predictor: tidak didukung
  const bpp = Math.max(1, (colors * bpc + 7) >> 3)
  const rowB = (colors * bpc * cols + 7) >> 3
  const rows = Math.floor(data.length / (rowB + 1))
  const out = new Uint8Array(rows * rowB)
  for (let r = 0; r < rows; r++) {
    const ft = data[r * (rowB + 1)], src = r * (rowB + 1) + 1, dst = r * rowB, prev = dst - rowB
    for (let i = 0; i < rowB; i++) {
      const x = data[src + i]
      const a = i >= bpp ? out[dst + i - bpp] : 0
      const b = r > 0 ? out[prev + i] : 0
      const c = i >= bpp && r > 0 ? out[prev + i - bpp] : 0
      let v
      if (ft === 0) v = x
      else if (ft === 1) v = x + a
      else if (ft === 2) v = x + b
      else if (ft === 3) v = x + ((a + b) >> 1)
      else {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
      }
      out[dst + i] = v & 255
    }
  }
  return out
}

function csInfo(doc, cs) {
  cs = doc.context.lookup(cs)
  if (cs === NM('DeviceRGB') || cs === NM('CalRGB')) return { n: 3 }
  if (cs === NM('DeviceGray') || cs === NM('CalGray')) return { n: 1 }
  if (cs instanceof PDFArray) {
    const t = doc.context.lookup(cs.get(0))
    if (t === NM('ICCBased')) {
      const n = doc.context.lookup(cs.get(1))?.dict?.get(NM('N'))?.asNumber?.()
      return n === 3 || n === 1 ? { n } : null
    }
    if (t === NM('CalRGB')) return { n: 3 }
    if (t === NM('CalGray')) return { n: 1 }
    if (t === NM('Indexed') || t === NM('I')) {
      const base = csInfo(doc, cs.get(1))
      if (!base || base.pal) return null
      const hival = doc.context.lookup(cs.get(2))?.asNumber?.()
      const lk = doc.context.lookup(cs.get(3))
      const bytes = lk?.contents ?? lk?.asBytes?.()
      return bytes && hival != null ? { n: 1, pal: { base: base.n, bytes, hival } } : null
    }
  }
  return null
}

/** Dekode gambar Flate 8-bit (RGB/Gray/Indexed, predictor PNG) menjadi canvas. */
async function decodeFlateImage(doc, d, contents) {
  const w = d.get(NM('Width'))?.asNumber?.(), h = d.get(NM('Height'))?.asNumber?.()
  const bpc = d.get(NM('BitsPerComponent'))?.asNumber?.()
  if (!w || !h || bpc !== 8) return null
  const info = csInfo(doc, d.get(NM('ColorSpace')))
  if (!info) return null
  const parms = doc.context.lookup(d.get(NM('DecodeParms')))
  const dp = parms instanceof PDFArray ? doc.context.lookup(parms.get(0)) : parms
  const pred = dp?.get?.(NM('Predictor'))?.asNumber?.() ?? 1
  const cols = dp?.get?.(NM('Columns'))?.asNumber?.() ?? w
  let raw = await inflate(contents)
  raw = unpredict(raw, info.n, 8, cols, pred)
  if (!raw || raw.length < w * h * info.n) return null

  const rgba = new Uint8ClampedArray(w * h * 4)
  const { pal } = info
  for (let i = 0, o = 0; i < w * h; i++, o += 4) {
    if (pal) {
      const k = Math.min(raw[i], pal.hival) * pal.base
      if (pal.base === 3) { rgba[o] = pal.bytes[k]; rgba[o + 1] = pal.bytes[k + 1]; rgba[o + 2] = pal.bytes[k + 2] }
      else rgba[o] = rgba[o + 1] = rgba[o + 2] = pal.bytes[k]
    } else if (info.n === 3) {
      rgba[o] = raw[i * 3]; rgba[o + 1] = raw[i * 3 + 1]; rgba[o + 2] = raw[i * 3 + 2]
    } else {
      rgba[o] = rgba[o + 1] = rgba[o + 2] = raw[i]
    }
    rgba[o + 3] = 255
  }
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  c.getContext('2d').putImageData(new ImageData(rgba, w, h), 0, 0)
  return c
}

/** Kompres ulang gambar tertanam (JPEG dan Flate) dengan batas sisi px dan kualitas q. */
async function recompressImages(doc, q, maxPx, signal) {
  let count = 0
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (signal?.cancelled) throw new Error('Dibatalkan')
    if (!(obj instanceof PDFRawStream)) continue
    const d = obj.dict
    if (d.get(NM('Subtype')) !== NM('Image')) continue
    if (d.has(NM('ImageMask')) || d.has(NM('Mask')) || d.has(NM('Decode'))) continue
    const src = obj.contents
    if (src.length < 8000) continue

    let f = d.get(NM('Filter'))
    if (f instanceof PDFArray) f = f.size() === 1 ? f.get(0) : null
    const isDct = f === NM('DCTDecode')
    const isFlate = f === NM('FlateDecode')
    if (!isDct && !isFlate) continue

    try {
      let source
      if (isDct) {
        const cs = csInfo(doc, d.get(NM('ColorSpace')))
        if (!cs || cs.pal) continue // CMYK dan lainnya dilewati
        source = await createImageBitmap(new Blob([src], { type: 'image/jpeg' }), { imageOrientation: 'none' })
      } else {
        source = await decodeFlateImage(doc, d, src)
        if (!source) continue
      }
      const k = Math.min(1, maxPx / Math.max(source.width, source.height))
      const nw = Math.max(16, Math.round(source.width * k)), nh = Math.max(16, Math.round(source.height * k))
      const c = document.createElement('canvas')
      c.width = nw; c.height = nh
      const cx = c.getContext('2d')
      cx.imageSmoothingQuality = 'high'
      cx.fillStyle = '#fff'
      cx.fillRect(0, 0, nw, nh)
      cx.drawImage(source, 0, 0, nw, nh)
      source.close?.()
      const out = await toJpeg(c, q)
      if (out.length >= src.length * 0.9) continue
      const nd = doc.context.obj({
        Type: 'XObject', Subtype: 'Image', Width: nw, Height: nh,
        ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode', Length: out.length
      })
      if (d.has(NM('SMask'))) nd.set(NM('SMask'), d.get(NM('SMask')))
      doc.context.assign(ref, PDFRawStream.of(nd, out))
    } catch { /* format tidak didukung: lewati */ }
    if (++count % 3 === 0) await tick()
  }
}

/** Render halaman scan lalu kirim ke worker; hasil dikembalikan sebagai promise (diproses paralel). */
function dispatchScan(pool, pdfDoc, pageNo, mode, level) {
  return rasterizeRGBA(pdfDoc, pageNo, mode === 'bw' ? level.dpi : level.maskDpi).then((r) => {
    const msg = mode === 'bw'
      ? { type: 'bilevel', rgba: r.rgba.buffer, w: r.w, h: r.h }
      : { type: 'mrc', rgba: r.rgba.buffer, w: r.w, h: r.h, bgScale: level.bgDpi / level.maskDpi, bgQ: level.q, fgQ: 0.5 }
    return { pw: r.pw, ph: r.ph, run: pool.run(msg, [r.rgba.buffer]) }
  })
}

function addRawImage(doc, dict, bytes) {
  return doc.context.register(PDFRawStream.of(doc.context.obj({ ...dict, Length: bytes.length }), bytes))
}

async function build({ srcDoc, pdfDoc, info, mode, level, onProgress, signal, lo, hi, label, pool }) {
  const out = await PDFDocument.create()
  const font = await out.embedFont(StandardFonts.Helvetica)
  const total = info.length
  // Salin semua halaman vektor sekaligus agar font/gambar bersama tidak terduplikasi.
  const keep = info.map((p, i) => (p.scan ? -1 : i)).filter((i) => i >= 0)
  const copied = keep.length ? await out.copyPages(srcDoc, keep) : []
  const copyAt = new Map(keep.map((idx, k) => [idx, copied[k]]))

  // Render berurutan (dipercepat GPU), pemrosesan berat paralel di worker.
  const scanIdx = info.map((p, i) => (p.scan ? i : -1)).filter((i) => i >= 0)
  const jobs = new Map()
  const inflight = new Set()
  let started = 0
  for (const i of scanIdx) {
    if (signal?.cancelled) throw new Error('Dibatalkan')
    while (inflight.size >= pool.size + 1) await Promise.race(inflight)
    onProgress?.({ text: `${label} • halaman ${++started}/${scanIdx.length} (${pool.size} inti)`, pct: lo + (started / scanIdx.length) * (hi - lo) * 0.8 })
    const job = await dispatchScan(pool, pdfDoc, i + 1, mode, level)
    const done = job.run.then(() => inflight.delete(done), () => inflight.delete(done))
    inflight.add(done)
    jobs.set(i, job)
  }

  const ctx = out.context
  for (let i = 0; i < total; i++) {
    if (signal?.cancelled) throw new Error('Dibatalkan')
    const pi = info[i]
    if (!pi.scan) { out.addPage(copyAt.get(i)); continue }
    const job = jobs.get(i)
    const res = await job.run
    const page = out.addPage([job.pw, job.ph])
    if (mode === 'bw') {
      const ref = addRawImage(out, {
        Type: 'XObject', Subtype: 'Image', Width: res.w, Height: res.h, ColorSpace: 'DeviceGray', BitsPerComponent: 1,
        Filter: 'FlateDecode', ...(res.predicted ? { DecodeParms: { Predictor: 15, Colors: 1, BitsPerComponent: 1, Columns: res.w } } : {})
      }, res.data)
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(job.pw, 0, 0, job.ph, 0, 0), drawObject(page.node.newXObject('Scan', ref)), popGraphicsState())
    } else {
      const bg = await out.embedJpg(res.bg)
      page.drawImage(bg, { x: 0, y: 0, width: job.pw, height: job.ph })
      if (res.mask && res.fg) {
        // Warna teks (JPEG kecil) dipotong oleh mask 1-bit beresolusi tinggi: teks tajam, warna tetap.
        const mref = addRawImage(out, {
          Type: 'XObject', Subtype: 'Image', Width: res.maskW, Height: res.maskH, ImageMask: true, BitsPerComponent: 1,
          Filter: 'FlateDecode', ...(res.maskPred ? { DecodeParms: { Predictor: 15, Colors: 1, BitsPerComponent: 1, Columns: res.maskW } } : {})
        }, res.mask)
        const fdict = ctx.obj({
          Type: 'XObject', Subtype: 'Image', Width: res.fg.w, Height: res.fg.h, ColorSpace: 'DeviceRGB',
          BitsPerComponent: 8, Filter: 'DCTDecode', Length: res.fg.jpg.length
        })
        fdict.set(PDFName.of('Mask'), mref)
        const fref = ctx.register(PDFRawStream.of(fdict, res.fg.jpg))
        page.pushOperators(pushGraphicsState(), concatTransformationMatrix(job.pw, 0, 0, job.ph, 0, 0), drawObject(page.node.newXObject('Fg', fref)), popGraphicsState())
      }
    }
    if (pi.chars > 0 && !level.noText) await addInvisibleText(pdfDoc, i + 1, page, font)
    jobs.delete(i)
    if (i % 3 === 2) await tick()
  }
  onProgress?.({ text: `${label} • mengompres gambar tertanam`, pct: lo + (hi - lo) * 0.9 })
  await recompressImages(out, level.q, level.px, signal)
  onProgress?.({ text: `${label} • menyimpan`, pct: hi })
  return out.save({ useObjectStreams: true })
}

/** Perkiraan ukuran per tingkat dari beberapa halaman contoh (paralel); mengembalikan indeks tingkat pertama yang muat. */
async function estimateStart(pool, pdfDoc, mode, levels, sampleIdx, scans, restBytes, target, onProgress) {
  const SAFETY = 1.1
  for (let l = 0; l < levels.length; l++) {
    onProgress?.({ text: `Memperkirakan ukuran (${l + 1}/${levels.length})`, pct: 16 + (l / levels.length) * 8 })
    const lv = levels[l]
    const sizes = await Promise.all(sampleIdx.map(async (i) => {
      const r = await rasterizeRGBA(pdfDoc, i + 1, mode === 'bw' ? lv.dpi : lv.maskDpi)
      if (mode === 'bw') return (await pool.run({ type: 'bilevel', rgba: r.rgba.buffer, w: r.w, h: r.h }, [r.rgba.buffer])).data.length
      const m = await pool.run({
        type: 'mrc', rgba: r.rgba.buffer, w: r.w, h: r.h, sizesOnly: true, fgQ: 0.5,
        levels: [{ scale: lv.bgDpi / lv.maskDpi, q: lv.q }]
      }, [r.rgba.buffer])
      return m.maskBytes + m.fgBytes + m.bgBytes[0]
    }))
    const avg = sizes.reduce((a, b) => a + b, 0) / sizes.length
    if (restBytes + avg * SAFETY * scans <= target) return { idx: l, fits: true }
  }
  return { idx: levels.length - 1, fits: false }
}

/**
 * Perkecil PDF hingga <= targetMB, seketat mungkin tetapi tetap terbaca.
 * mode 'auto'  : berwarna (teks 1-bit tajam + latar kecil) -> hitam-putih -> semua halaman hitam-putih
 *                beresolusi makin rendah. Berhenti begitu target tercapai; bila mustahil, hasil terkecil disimpan.
 * mode 'color' / 'bw' : hanya satu jenis; allowSoft membuka tingkat resolusi lebih rendah.
 */
export async function compressPdf(bytes, { targetMB, mode = 'auto', allowSoft = false, onProgress, signal } = {}) {
  const target = targetMB * MB
  if (bytes.length <= target) return { bytes, size: bytes.length, changed: false, reached: true, scanPages: 0, pages: 0 }

  const pool = createPool()
  const pdfDoc = await pdfjs.getDocument({ data: bytes.slice() }).promise
  try {
    const raw = await analyze(pdfDoc, onProgress, signal)
    const srcDoc = await PDFDocument.load(bytes, { ignoreEncryption: true })
    const mark = (th) => raw.map((p) => ({ ...p, scan: p.coverage > th }))
    const auto = mode === 'auto'

    async function attempt(m, slot, { soft, tail, rescue }) {
      const infoA = mark(m === 'bw' ? 0.15 : 0.5)
      const scanList = infoA.map((p, i) => ({ ...p, i })).filter((p) => p.scan)
      const scans = scanList.length
      const levels = [...LEVELS[m], ...(soft ? SOFT[m] : [])]
      let start = 0
      let fits = true
      if (scans) {
        const pick = [0, Math.floor(scans / 3), Math.floor((2 * scans) / 3), scans - 1]
        const sample = [...new Set(pick)].map((k) => scanList[k].i)
        const restBytes = bytes.length * ((infoA.length - scans) / infoA.length) * 0.9
        start = await estimateStart(pool, pdfDoc, m, levels, sample, scans, restBytes, target, onProgress)
        fits = start.fits
        start = start.idx
      }
      // Bila perkiraan menunjukkan tak ada tingkat yang muat, langsung bangun yang terkecil.
      const order = fits
        ? [...new Set([start, start + 1, levels.length - 1].filter((x) => x < levels.length))].sort((a, b) => a - b)
        : [levels.length - 1]
      const plan = order.map((li) => ({ info: infoA, level: levels[li], label: `${m === 'bw' ? 'Hitam-putih' : 'Berwarna'} (teks ${levels[li].maskDpi || levels[li].dpi} dpi)` }))
      if (m === 'color' && rescue) {
        const infoB = mark(0.15)
        for (const lv of [...RESCUE, ...(soft ? RESCUE_SOFT : [])]) plan.push({ info: infoB, level: lv, label: 'Berwarna (halaman bergambar)' })
      }
      if (m === 'bw' && tail) {
        const infoAll = mark(-1)
        SQUEEZE.forEach((lv, k) => plan.push({ info: infoAll, level: lv, label: `Hitam-putih semua halaman (${lv.dpi} dpi)`, tail: true, last: k === SQUEEZE.length - 1 }))
      }

      let best = null
      let n = 0
      for (const step of plan) {
        if (best && best.bytes.length <= target) break
        // jauh di atas target? lompat langsung ke tahap terkecil (hemat waktu pada file raksasa)
        if (step.tail && !step.last && best && best.bytes.length > 3 * target) continue
        const lo = slot[0] + (n / plan.length) * (slot[1] - slot[0]), hi = slot[0] + ((n + 1) / plan.length) * (slot[1] - slot[0])
        n++
        const out = await build({ srcDoc, pdfDoc, info: step.info, mode: m, level: step.level, onProgress, signal, lo, hi, label: step.label, pool })
        if (!best || out.length < best.bytes.length) best = { bytes: out, level: step.level, rescued: step.info !== infoA, mode: m, scans }
      }
      return best
    }

    let best
    if (auto) {
      best = await attempt('color', [25, 55], { soft: true, rescue: false })
      if (best.bytes.length > target) {
        const bw = await attempt('bw', [55, 97], { soft: true, tail: true, rescue: false })
        if (bw.bytes.length < best.bytes.length) best = bw
      }
    } else {
      best = await attempt(mode, [25, 97], { soft: allowSoft, tail: false, rescue: true })
    }

    onProgress?.({ text: 'Selesai', pct: 100 })
    const smaller = best.bytes.length < bytes.length
    return {
      bytes: smaller ? best.bytes : bytes,
      size: smaller ? best.bytes.length : bytes.length,
      changed: smaller,
      reached: smaller && best.bytes.length <= target,
      scanPages: best.scans,
      pages: raw.length,
      level: best.level,
      rescued: best.rescued,
      usedMode: best.mode
    }
  } finally {
    pool.destroy()
    pdfDoc.destroy()
  }
}
