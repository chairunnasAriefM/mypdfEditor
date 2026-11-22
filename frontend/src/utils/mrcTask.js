import { mrcPrepare, mrcBackground, mrcForeground, packMask, bilevelFromRgba } from './mrcCore'

async function deflate(u8) {
  const cs = new CompressionStream('deflate') // zlib = FlateDecode
  const w = cs.writable.getWriter()
  w.write(u8); w.close()
  return new Uint8Array(await new Response(cs.readable).arrayBuffer())
}

/** Kompres Flate dengan dan tanpa predictor, pakai yang lebih kecil. */
async function smallest(packed) {
  const [zu, zp] = await Promise.all([deflate(packed.up), deflate(packed.plain)])
  return zu.length <= zp.length ? { data: zu, predicted: true } : { data: zp, predicted: false }
}

/** RGBA -> JPEG. Di worker memakai OffscreenCanvas; di thread utama memakai canvas biasa. */
async function jpeg(data, w, h, q) {
  const img = new ImageData(data, w, h)
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(w, h)
    c.getContext('2d').putImageData(img, 0, 0)
    return new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: q })).arrayBuffer())
  }
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  c.getContext('2d').putImageData(img, 0, 0)
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q))
  return new Uint8Array(await blob.arrayBuffer())
}

/** Satu tugas kompresi halaman. Dipakai oleh worker (atau thread utama bila worker tak tersedia). */
export async function processTask(m) {
  const rgba = new Uint8ClampedArray(m.rgba)
  const { w, h } = m

  if (m.type === 'bilevel') {
    const z = await smallest(bilevelFromRgba(rgba, w, h))
    return { data: z.data, predicted: z.predicted, w, h }
  }

  // type === 'mrc'
  const st = mrcPrepare(rgba, w, h)
  const hasMask = st.textPx > 60
  let mask = null, fg = null, maskPred = false
  if (hasMask) {
    const z = await smallest(packMask(st.mask, w, h))
    mask = z.data; maskPred = z.predicted
    const f = mrcForeground(st, rgba, w, h, 4)
    fg = { w: f.w, h: f.h, jpg: await jpeg(f.data, f.w, f.h, m.fgQ || 0.5) }
  }

  if (m.sizesOnly) {
    const bgBytes = []
    for (const lv of m.levels) {
      const bg = mrcBackground(st, rgba, w, h, lv.scale)
      bgBytes.push((await jpeg(bg.data, bg.w, bg.h, lv.q)).length)
    }
    return { maskBytes: mask ? mask.length : 0, fgBytes: fg ? fg.jpg.length : 0, bgBytes }
  }

  const bg = mrcBackground(st, rgba, w, h, m.bgScale)
  return {
    bg: await jpeg(bg.data, bg.w, bg.h, m.bgQ), bgW: bg.w, bgH: bg.h,
    mask, maskPred, maskW: w, maskH: h, fg
  }
}
