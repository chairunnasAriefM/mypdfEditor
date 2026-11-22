import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib'

export const A4 = { W: 595.28, H: 841.89 }

export const FONTS = {
  TR: { label: 'Times New Roman', pdf: StandardFonts.TimesRoman, css: '"Times New Roman", Times, serif', bold: false },
  TRB: { label: 'Times New Roman Tebal', pdf: StandardFonts.TimesRomanBold, css: '"Times New Roman", Times, serif', bold: true },
  H: { label: 'Helvetica / Arial', pdf: StandardFonts.Helvetica, css: 'Arial, Helvetica, sans-serif', bold: false },
  HB: { label: 'Helvetica / Arial Tebal', pdf: StandardFonts.HelveticaBold, css: 'Arial, Helvetica, sans-serif', bold: true },
  C: { label: 'Courier', pdf: StandardFonts.Courier, css: '"Courier New", Courier, monospace', bold: false }
}

const rad = (d) => (d * Math.PI) / 180

/** Sudut diagonal otomatis (derajat), menyesuaikan rasio halaman. */
export const diagAngle = (W, H) => Math.round(((Math.atan2(H, W) * 180) / Math.PI) * 10) / 10

/** Metrik font PDF standar. Dipakai pratinjau DAN hasil PDF agar ukurannya identik. */
export async function createMetrics() {
  const doc = await PDFDocument.create()
  const fonts = {}
  for (const k of Object.keys(FONTS)) fonts[k] = await doc.embedFont(FONTS[k].pdf)
  const clean = (key, text) => {
    let out = ''
    for (const ch of text) {
      try { fonts[key].widthOfTextAtSize(ch, 10); out += ch } catch { out += '?' }
    }
    return out
  }
  return { clean, width: (key, size, text) => fonts[key].widthOfTextAtSize(text, size) }
}

/** Ukuran blok watermark (teks multi-baris atau gambar). */
function block(p, metrics, aspect) {
  if (p.kind === 'image') {
    const bw = p.iw, bh = p.iw * (aspect || 1)
    return { bw, bh, lines: [] }
  }
  const lines = p.txt.split('\n').filter((l) => l.trim() !== '').map((raw) => {
    const t = metrics.clean(p.font, raw)
    return { t, w: metrics.width(p.font, p.size, t) }
  })
  if (!lines.length) return { bw: 0, bh: 0, lines }
  return {
    bw: Math.max(...lines.map((l) => l.w)),
    bh: (lines.length - 1) * p.ls + p.size,
    lines
  }
}

/**
 * Tata letak tunggal untuk pratinjau dan PDF.
 * Koordinat: titik, asal kiri-atas, y ke bawah. Rotasi positif = berlawanan jarum jam.
 */
export function layout(W, H, p, metrics, aspect) {
  const blk = block(p, metrics, aspect)
  const items = []
  if (!blk.bw || !blk.bh) return { ...blk, items }
  const r = rad(p.rot), cos = Math.cos(r), sin = Math.sin(r)

  if (p.mode === 'single') {
    items.push({ cx: W / 2 + p.ox, cy: H / 2 + p.oy, rot: p.rot })
    return { ...blk, items }
  }

  const cw = blk.bw + p.gx, ch = blk.bh + p.gy
  const D = Math.hypot(W, H) / 2 + Math.hypot(blk.bw, blk.bh)
  const nc = Math.ceil(D / cw) + 1, nr = Math.ceil(D / ch) + 1
  const R = Math.hypot(blk.bw, blk.bh) / 2
  for (let row = -nr; row <= nr; row++) {
    const shift = p.stag && Math.abs(row) % 2 === 1 ? cw / 2 : 0
    for (let col = -nc; col <= nc; col++) {
      const u = col * cw + shift, v = row * ch
      const cx = W / 2 + u * cos + v * sin
      const cy = H / 2 - u * sin + v * cos
      if (cx < -R || cx > W + R || cy < -R || cy > H + R) continue
      items.push({ cx, cy, rot: p.rot })
      if (items.length > 3000) return { ...blk, items }
    }
  }
  return { ...blk, items }
}

/** Titik lokal (u,v) pada item -> koordinat halaman. */
export function toPage(item, u, v) {
  const r = rad(item.rot)
  return [item.cx + u * Math.cos(r) + v * Math.sin(r), item.cy - u * Math.sin(r) + v * Math.cos(r)]
}

export const lineV = (blk, p, i) => -blk.bh / 2 + p.size / 2 + i * p.ls + 0.35 * p.size // baseline

/** Skala watermark agar lebarnya 0.7 x panjang diagonal efektif halaman. */
export function fitToPage(W, H, p, metrics, aspect) {
  const r = rad(p.rot)
  const L = Math.min(W / (Math.abs(Math.cos(r)) || 1e-9), H / (Math.abs(Math.sin(r)) || 1e-9))
  const { bw } = block(p, metrics, aspect)
  if (!bw) return {}
  const k = (0.7 * L) / bw
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
  if (p.kind === 'image') return { iw: Math.round(clamp(p.iw * k, 20, 800)) }
  return { size: Math.round(clamp(p.size * k, 8, 200)), ls: Math.round(clamp(p.ls * k, 0, 250)) }
}

export function parsePages(str, total) {
  if (!str || !str.trim()) return null
  const set = new Set()
  for (const part of str.split(',')) {
    const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/)
    if (!m) continue
    const a = +m[1], b = m[2] ? +m[2] : a
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (i >= 1 && i <= total) set.add(i)
  }
  return set
}

const hexRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Gambar logo -> canvas. Mode 'one': satu warna; latar putih jadi transparan. */
export function prepareLogo(bitmap, cmode, hex) {
  const maxW = 1200
  const k = Math.min(1, maxW / bitmap.width)
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(bitmap.width * k))
  c.height = Math.max(1, Math.round(bitmap.height * k))
  const x = c.getContext('2d', { willReadFrequently: true })
  x.drawImage(bitmap, 0, 0, c.width, c.height)
  if (cmode !== 'one') return c
  const img = x.getImageData(0, 0, c.width, c.height), d = img.data
  let hasAlpha = false
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) { hasAlpha = true; break }
  const [r, g, b] = hexRgb(hex)
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]
    d[i + 3] = hasAlpha ? a : Math.round(a * (1 - (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255))
    d[i] = r; d[i + 1] = g; d[i + 2] = b
  }
  x.putImageData(img, 0, 0)
  return c
}

/** Gambar semua item pada canvas (satuan titik; ctx sudah diskala). */
export function drawWatermark(ctx, L, p, logo) {
  ctx.save()
  ctx.globalAlpha = p.op / 100
  const f = FONTS[p.font]
  for (const it of L.items) {
    ctx.save()
    ctx.translate(it.cx, it.cy)
    ctx.rotate(-rad(it.rot))
    if (p.kind === 'image') {
      if (logo) ctx.drawImage(logo, -L.bw / 2, -L.bh / 2, L.bw, L.bh)
    } else {
      ctx.fillStyle = p.col
      ctx.font = `${f.bold ? 'bold ' : ''}${p.size}px ${f.css}`
      ctx.textBaseline = 'alphabetic'
      L.lines.forEach((ln, i) => {
        const cw = ctx.measureText(ln.t).width || 1
        ctx.save()
        ctx.translate(-ln.w / 2, lineV(L, p, i))
        ctx.scale(ln.w / cw, 1) // samakan lebar dengan metrik PDF
        ctx.fillText(ln.t, 0, 0)
        ctx.restore()
      })
    }
    ctx.restore()
  }
  ctx.restore()
}

/** Tulis watermark ke dokumen pdf-lib. Memperhitungkan CropBox dan /Rotate halaman. */
export async function stampPdf(doc, p, metrics, logoPng, aspect, pageSet) {
  const font = p.kind === 'text' ? await doc.embedFont(FONTS[p.font].pdf) : null
  const image = p.kind === 'image' && logoPng ? await doc.embedPng(logoPng) : null
  const [cr, cg, cb] = hexRgb(p.col)
  const color = rgb(cr / 255, cg / 255, cb / 255)

  doc.getPages().forEach((page, idx) => {
    if (pageSet && !pageSet.has(idx + 1)) return
    const box = page.getCropBox()
    const R = ((page.getRotation().angle % 360) + 360) % 360
    const sw = R % 180 === 0
    const W = sw ? box.width : box.height, H = sw ? box.height : box.width
    const L = layout(W, H, p, metrics, aspect)

    // koordinat tampilan (kiri-atas, y bawah) -> ruang pengguna PDF
    const map = ([dx, dy]) => {
      let ux, uy
      if (R === 0) { ux = dx; uy = box.height - dy }
      else if (R === 90) { ux = dy; uy = dx }
      else if (R === 180) { ux = box.width - dx; uy = dy }
      else { ux = box.width - dy; uy = box.height - dx }
      return { x: box.x + ux, y: box.y + uy }
    }

    for (const it of L.items) {
      const ang = degrees(it.rot + R)
      if (image) {
        const o = map(toPage(it, -L.bw / 2, L.bh / 2)) // sudut kiri-bawah
        page.drawImage(image, { x: o.x, y: o.y, width: L.bw, height: L.bh, rotate: ang, opacity: p.op / 100 })
      } else {
        L.lines.forEach((ln, i) => {
          const o = map(toPage(it, -ln.w / 2, lineV(L, p, i)))
          page.drawText(ln.t, { x: o.x, y: o.y, size: p.size, font, color, rotate: ang, opacity: p.op / 100 })
        })
      }
    }
  })
}

export const b64ToBytes = (b64) => {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
export const bytesToB64 = (bytes) => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
