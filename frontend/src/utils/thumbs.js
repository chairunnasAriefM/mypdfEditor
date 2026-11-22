import { ReadFileB64 } from '../../wailsjs/go/main/App'
import { b64ToBytes } from './watermarkEngine'
import pdfjs from './pdfjs'

const cache = new Map()

/** Thumbnail halaman 1 sebagai data URL (di-cache per path). */
export function firstPageThumb(path, maxW = 40, maxH = 56) {
  const key = `${path}|${maxW}x${maxH}`
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      const doc = await pdfjs.getDocument({ data: b64ToBytes(await ReadFileB64(path)) }).promise
      try {
        const pg = await doc.getPage(1)
        const v1 = pg.getViewport({ scale: 1 })
        const dpr = window.devicePixelRatio || 1
        const v = pg.getViewport({ scale: Math.min(maxW / v1.width, maxH / v1.height) * dpr })
        const c = document.createElement('canvas')
        c.width = Math.ceil(v.width); c.height = Math.ceil(v.height)
        await pg.render({ canvasContext: c.getContext('2d'), viewport: v }).promise
        return c.toDataURL('image/png')
      } finally {
        doc.destroy()
      }
    })().catch(() => { cache.delete(key); return null }))
  }
  return cache.get(key)
}
