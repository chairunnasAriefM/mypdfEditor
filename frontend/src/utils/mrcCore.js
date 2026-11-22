// Inti algoritma kompresi berlapis (MRC): teks tajam 1-bit + latar/foto beresolusi rendah.
// Fungsi murni di atas array RGBA agar bisa dijalankan di Web Worker dan diuji di Node.

export function lumaPlane(rgba, w, h) {
  const g = new Uint8Array(w * h)
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8
  return g
}

/** Rata-rata lokal (jendela (2r+1)^2) lewat integral image. */
function boxMean(gray, w, h, r) {
  const W = w + 1
  const I = w * h > 1.6e7 ? new Float64Array(W * (h + 1)) : new Uint32Array(W * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) {
      row += gray[y * w + x]
      I[(y + 1) * W + x + 1] = I[y * W + x + 1] + row
    }
  }
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1)
      const s = I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0]
      out[y * w + x] = s / ((x1 - x0) * (y1 - y0))
    }
  }
  return out
}

/**
 * Deteksi piksel teks/garis: 1 = gelap di atas latar terang, 2 = terang di atas latar gelap.
 * Blok yang bertekstur seperti foto (latar tidak rata) atau terlalu padat dibuang dari mask.
 */
export function segmentText(gray, w, h, { r = 12, dDark = 28, dLight = 35, TS = 32 } = {}) {
  const lm = boxMean(gray, w, h, r)
  const mask = new Uint8Array(w * h)
  let total = 0
  for (let i = 0; i < mask.length; i++) {
    const m = lm[i], g = gray[i]
    if (m < 120) { if (g > m + dLight) mask[i] = 2 }
    else if (g < m - dDark && g < 200) mask[i] = 1
  }
  const tx = Math.ceil(w / TS), ty = Math.ceil(h / TS)
  for (let by = 0; by < ty; by++) {
    const y0 = by * TS, y1 = Math.min(h, y0 + TS)
    for (let bx = 0; bx < tx; bx++) {
      const x0 = bx * TS, x1 = Math.min(w, x0 + TS)
      let nz = 0, n = 0, s = 0, sq = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const k = y * w + x
          if (mask[k]) nz++
          else { const g = gray[k]; n++; s += g; sq += g * g }
        }
      }
      const area = (x1 - x0) * (y1 - y0)
      const dens = nz / area
      const std = n > 8 ? Math.sqrt(Math.max(0, sq / n - (s / n) * (s / n))) : 0
      if (dens > 0.003 && dens < 0.5 && std < 22) { total += nz; continue }
      if (nz) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * w + x] = 0
    }
  }
  // Buang bintik noise scan: piksel mask dengan <= 1 tetangga (8 arah) bukan bagian goresan huruf.
  const keepMask = new Uint8Array(mask)
  let kept = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const k = y * w + x
      if (!mask[k]) continue
      const n = (mask[k - 1] ? 1 : 0) + (mask[k + 1] ? 1 : 0) + (mask[k - w] ? 1 : 0) + (mask[k + w] ? 1 : 0) +
        (mask[k - w - 1] ? 1 : 0) + (mask[k - w + 1] ? 1 : 0) + (mask[k + w - 1] ? 1 : 0) + (mask[k + w + 1] ? 1 : 0)
      if (n < 2) keepMask[k] = 0
      else kept++
    }
  }
  return { mask: keepMask, textPx: kept }
}

function dilate(mask, w, h) {
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = y * w + x
      tmp[k] = mask[k] || (x > 0 && mask[k - 1]) || (x < w - 1 && mask[k + 1]) ? 1 : 0
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = y * w + x
      out[k] = tmp[k] || (y > 0 && tmp[k - w]) || (y < h - 1 && tmp[k + w]) ? 1 : 0
    }
  }
  return out
}

/** Isi sel tanpa data dengan sel valid terdekat (kiri/kanan, lalu baris atas/bawah). */
function fillHoles(buf, valid, w, h, def) {
  for (let y = 0; y < h; y++) {
    let last = -1
    for (let x = 0; x < w; x++) {
      const k = y * w + x
      if (valid[k]) last = k
      else if (last >= 0) { buf[k * 4] = buf[last * 4]; buf[k * 4 + 1] = buf[last * 4 + 1]; buf[k * 4 + 2] = buf[last * 4 + 2]; valid[k] = 2 }
    }
    last = -1
    for (let x = w - 1; x >= 0; x--) {
      const k = y * w + x
      if (valid[k] === 1) last = k
      else if (!valid[k] && last >= 0) { buf[k * 4] = buf[last * 4]; buf[k * 4 + 1] = buf[last * 4 + 1]; buf[k * 4 + 2] = buf[last * 4 + 2]; valid[k] = 2 }
    }
  }
  let prevRow = -1
  for (let y = 0; y < h; y++) {
    let any = false
    for (let x = 0; x < w; x++) if (valid[y * w + x]) { any = true; break }
    if (any) { prevRow = y; continue }
    for (let x = 0; x < w; x++) {
      const k = y * w + x
      const s = prevRow >= 0 ? (prevRow * w + x) * 4 : -1
      buf[k * 4] = s >= 0 ? buf[s] : def; buf[k * 4 + 1] = s >= 0 ? buf[s + 1] : def; buf[k * 4 + 2] = s >= 0 ? buf[s + 2] : def
    }
  }
}

export function mrcPrepare(rgba, w, h) {
  const gray = lumaPlane(rgba, w, h)
  const { mask, textPx } = segmentText(gray, w, h)
  return { gray, mask, textPx, dil: textPx ? dilate(mask, w, h) : null }
}

/** Latar: rata-rata piksel non-teks per sel (teks "dihapus"), resolusi bw x bh. */
export function mrcBackground(st, rgba, w, h, scale) {
  const bw = Math.max(1, Math.round(w * scale)), bh = Math.max(1, Math.round(h * scale))
  const sums = new Float32Array(bw * bh * 3), cnt = new Float32Array(bw * bh)
  for (let y = 0; y < h; y++) {
    const cy = Math.min(bh - 1, ((y * bh) / h) | 0)
    for (let x = 0; x < w; x++) {
      const k = y * w + x
      if (st.dil && st.dil[k]) continue
      const c = cy * bw + Math.min(bw - 1, ((x * bw) / w) | 0), p = k * 4
      sums[c * 3] += rgba[p]; sums[c * 3 + 1] += rgba[p + 1]; sums[c * 3 + 2] += rgba[p + 2]; cnt[c]++
    }
  }
  const data = new Uint8ClampedArray(bw * bh * 4)
  const valid = new Uint8Array(bw * bh)
  for (let c = 0; c < bw * bh; c++) {
    data[c * 4 + 3] = 255
    if (cnt[c] > 0) { data[c * 4] = sums[c * 3] / cnt[c]; data[c * 4 + 1] = sums[c * 3 + 1] / cnt[c]; data[c * 4 + 2] = sums[c * 3 + 2] / cnt[c]; valid[c] = 1 }
  }
  fillHoles(data, valid, bw, bh, 255)
  return { data, w: bw, h: bh }
}

/** Warna teks: rata-rata berbobot piksel teks per sel kasar (ff piksel). */
export function mrcForeground(st, rgba, w, h, ff = 4) {
  const fw = Math.ceil(w / ff), fh = Math.ceil(h / ff)
  const sums = new Float32Array(fw * fh * 3), wt = new Float32Array(fw * fh)
  for (let y = 0; y < h; y++) {
    const cy = (y / ff) | 0
    for (let x = 0; x < w; x++) {
      const k = y * w + x, m = st.mask[k]
      if (!m) continue
      const g = st.gray[k]
      const wgt = m === 1 ? (255 - g) * (255 - g) + 1 : g * g + 1 // piksel paling pekat paling menentukan
      const c = cy * fw + ((x / ff) | 0), p = k * 4
      sums[c * 3] += rgba[p] * wgt; sums[c * 3 + 1] += rgba[p + 1] * wgt; sums[c * 3 + 2] += rgba[p + 2] * wgt; wt[c] += wgt
    }
  }
  const data = new Uint8ClampedArray(fw * fh * 4)
  const valid = new Uint8Array(fw * fh)
  for (let c = 0; c < fw * fh; c++) {
    data[c * 4 + 3] = 255
    if (wt[c] > 0) { data[c * 4] = sums[c * 3] / wt[c]; data[c * 4 + 1] = sums[c * 3 + 1] / wt[c]; data[c * 4 + 2] = sums[c * 3 + 2] / wt[c]; valid[c] = 1 }
  }
  fillHoles(data, valid, fw, fh, 0)
  return { data, w: fw, h: fh }
}

/** Mask 1-bit (teks = 0, latar = 1) + predictor PNG "Up" agar Flate lebih efektif. */
export function packMask(mask, w, h) {
  const stride = (w + 7) >> 3
  const rows = new Uint8Array(stride * h).fill(0xff)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) if (mask[y * w + x]) rows[y * stride + (x >> 3)] &= ~(0x80 >> (x & 7))
  }
  return { plain: rows, up: upPredict(rows, stride, h) }
}

function upPredict(rows, stride, h) {
  const out = new Uint8Array((stride + 1) * h)
  for (let y = 0; y < h; y++) {
    out[y * (stride + 1)] = 2
    for (let i = 0; i < stride; i++) out[y * (stride + 1) + 1 + i] = (rows[y * stride + i] - (y ? rows[(y - 1) * stride + i] : 0)) & 255
  }
  return out
}

function otsu(hist, total) {
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let sumB = 0, wB = 0, best = 0, thr = 127
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sumB += t * hist[t]
    const mB = sumB / wB, mF = (sum - sumB) / wF
    const v = wB * wF * (mB - mF) * (mB - mF)
    if (v > best) { best = v; thr = t }
  }
  return thr
}

/** Hitam-putih: Otsu global + per blok 256px (adaptif), dikemas 1-bit dengan predictor Up. */
export function bilevelFromRgba(rgba, w, h) {
  const gray = lumaPlane(rgba, w, h)
  const gh = new Uint32Array(256)
  for (let i = 0; i < gray.length; i++) gh[gray[i]]++
  const gT = otsu(gh, w * h)
  const TS = 256, tx = Math.ceil(w / TS), ty = Math.ceil(h / TS)
  const thr = new Uint8Array(tx * ty)
  for (let by = 0; by < ty; by++) {
    for (let bx = 0; bx < tx; bx++) {
      const hist = new Uint32Array(256)
      let n = 0, lo = 255, hi = 0
      for (let y = by * TS; y < Math.min(h, (by + 1) * TS); y++) {
        for (let x = bx * TS; x < Math.min(w, (bx + 1) * TS); x++) {
          const g = gray[y * w + x]
          hist[g]++; n++
          if (g < lo) lo = g
          if (g > hi) hi = g
        }
      }
      thr[by * tx + bx] = hi - lo < 40 ? gT : Math.min(gT + 40, Math.max(gT - 40, otsu(hist, n)))
    }
  }
  const stride = (w + 7) >> 3
  const rows = new Uint8Array(stride * h)
  for (let y = 0; y < h; y++) {
    const rowT = ((y / TS) | 0) * tx
    for (let x = 0; x < w; x++) if (gray[y * w + x] > thr[rowT + ((x / TS) | 0)]) rows[y * stride + (x >> 3)] |= 0x80 >> (x & 7)
  }
  return { plain: rows, up: upPredict(rows, stride, h), w, h }
}
