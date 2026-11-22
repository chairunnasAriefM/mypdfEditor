<script setup>
import { ref, shallowRef, reactive, watch, onMounted, onBeforeUnmount, inject } from 'vue'
import { PDFDocument } from 'pdf-lib'
import pdfjs from '../utils/pdfjs'
import { FileUp, ImagePlus, Loader2, RotateCcw, X } from 'lucide-vue-next'
import { PickFiles, StatFiles, ReadFileB64, SaveOutput } from '../../wailsjs/go/main/App'
import SliderRow from './SliderRow.vue'
import { compressPdf } from '../utils/compressEngine'
import { jobStart, jobProgress, jobEnd } from '../utils/jobStore'
import { useBoxSize } from '../utils/useBoxSize'
import {
  A4, FONTS, createMetrics, layout, fitToPage, diagAngle, parsePages,
  prepareLogo, drawWatermark, stampPdf, b64ToBytes, bytesToB64
} from '../utils/watermarkEngine'

const props = defineProps({ files: Array, drop: Object })
const emit = defineEmits(['files'])
const notify = inject('notify')

const BG_MAX = 1600 // resolusi latar tetap; ditampilkan sesuai ukuran panel

// ---- state ----
const tab = ref('isi')
const busy = ref(false)
const src = ref(null) // {path,name,ext,bytes}
const pages = ref('')
const totalPages = ref(0)
const page = reactive({ W: A4.W, H: A4.H })
const bg = shallowRef(null)
const logoBitmap = shallowRef(null)
const logoName = ref('')
const logoCanvas = shallowRef(null)
const metrics = shallowRef(null)
const autoRot = ref(true)
const compress = ref(false)
const stage = ref('')
const maxMB = ref(2)
const canvasRef = ref(null)
const stageRef = ref(null)
const { w: stageW, h: stageH } = useBoxSize(stageRef)

const p = reactive({
  kind: 'text', txt: 'Ini Watermark', font: 'H', size: 65, ls: 70,
  iw: 200, cmode: 'one', col: '#333333', op: 30,
  mode: 'single', rot: diagAngle(A4.W, A4.H), ox: 0, oy: 0, gx: 50, gy: 30, stag: true
})
const presets = {
  single: { size: 65, ls: 70, iw: 200, op: 30, rot: null },
  tile: { size: 26, ls: 30, iw: 120, op: 20, rot: 30 }
}

function setMode(m) {
  if (m === p.mode) return
  presets[p.mode] = { size: p.size, ls: p.ls, iw: p.iw, op: p.op, rot: autoRot.value ? null : p.rot }
  p.mode = m
  const t = presets[m]
  Object.assign(p, { size: t.size, ls: t.ls, iw: t.iw, op: t.op })
  autoRot.value = t.rot === null
  p.rot = t.rot === null ? diagAngle(page.W, page.H) : t.rot
}

function setRot(kind) {
  const d = diagAngle(page.W, page.H)
  autoRot.value = kind === 'ne'
  p.rot = kind === 'flat' ? 0 : kind === 'ne' ? d : kind === 'se' ? -d : 90
}
function onRotInput(v) { autoRot.value = false; p.rot = v }

const aspect = () => (logoCanvas.value ? logoCanvas.value.height / logoCanvas.value.width : 1)
function fit() {
  Object.assign(p, fitToPage(page.W, page.H, p, metrics.value, aspect()))
}

// ---- memuat file ----
const ext = (n) => n.split('.').pop().toLowerCase()

async function loadSource(info) {
  try {
    const bytes = b64ToBytes(await ReadFileB64(info.path))
    let canvas
    if (info.ext === 'pdf') {
      const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise
      const pg = await doc.getPage(1)
      const v1 = pg.getViewport({ scale: 1 })
      const v = pg.getViewport({ scale: BG_MAX / Math.max(v1.width, v1.height) })
      canvas = document.createElement('canvas')
      canvas.width = Math.ceil(v.width); canvas.height = Math.ceil(v.height)
      await pg.render({ canvasContext: canvas.getContext('2d'), viewport: v }).promise
      page.W = v1.width; page.H = v1.height
      totalPages.value = doc.numPages
      doc.destroy()
    } else {
      const bmp = await createImageBitmap(new Blob([bytes]))
      page.W = A4.W; page.H = A4.W * (bmp.height / bmp.width)
      canvas = document.createElement('canvas')
      canvas.width = bmp.width; canvas.height = bmp.height
      canvas.getContext('2d').drawImage(bmp, 0, 0)
      totalPages.value = 1
    }
    src.value = { ...info, bytes }
    bg.value = canvas
    if (autoRot.value) p.rot = diagAngle(page.W, page.H)
  } catch (e) {
    notify('Gagal membuka file: ' + (e?.message || e))
  }
}

async function pickSource() {
  const paths = await PickFiles(false, 'any')
  if (paths?.length) {
    const [info] = await StatFiles(paths)
    if (info) emit('files', [info])
  }
}

async function setLogo(path) {
  try {
    const bytes = b64ToBytes(await ReadFileB64(path))
    logoBitmap.value = await createImageBitmap(new Blob([bytes]))
    logoName.value = path.split(/[\\/]/).pop()
  } catch (e) {
    notify('Gagal membuka gambar: ' + (e?.message || e))
  }
}

async function pickLogo() {
  const paths = await PickFiles(false, 'image')
  if (paths?.length) await setLogo(paths[0])
}

function clearLogo() {
  logoBitmap.value = null
  logoName.value = ''
}

/** Kosongkan file utama; pengaturan watermark tetap dipertahankan. */
function clearSource() {
  src.value = null
  bg.value = null
  totalPages.value = 0
  pages.value = ''
  page.W = A4.W
  page.H = A4.H
  if (autoRot.value) p.rot = diagAngle(page.W, page.H)
}

function resetFile() {
  clearSource()
  emit('files', [])
}

// Drop dari App: PDF = file utama; gambar = logo bila mode Gambar dan file utama sudah ada.
watch(() => props.drop, (d) => {
  if (!d) return
  const pdf = d.files.find((f) => f.ext === 'pdf')
  const img = d.files.find((f) => f.ext !== 'pdf')
  if (pdf) emit('files', [pdf])
  else if (img && p.kind === 'image' && src.value) setLogo(img.path)
  else if (img) emit('files', [img])
})

watch(() => props.files, (f) => {
  if (!f?.length) { if (src.value) clearSource(); return }
  const first = f?.find((x) => ['pdf', 'png', 'jpg', 'jpeg', 'webp'].includes(x.ext))
  if (first && first.path !== src.value?.path) loadSource(first)
}, { immediate: true })

watch([logoBitmap, () => p.cmode, () => p.col], () => {
  logoCanvas.value = logoBitmap.value ? prepareLogo(logoBitmap.value, p.cmode, p.col) : null
})

// ---- live preview ----
let raf = 0
function schedule() {
  if (raf) return
  raf = requestAnimationFrame(() => { raf = 0; redraw() })
}

function redraw() {
  const cv = canvasRef.value
  if (!cv || !metrics.value) return
  const dpr = window.devicePixelRatio || 1
  const boxW = stageW.value || 337, boxH = stageH.value || 436
  const ds = Math.min(boxW / page.W, boxH / page.H)
  const cw = Math.round(page.W * ds * dpr), ch = Math.round(page.H * ds * dpr)
  if (cv.width !== cw || cv.height !== ch) {
    cv.width = cw; cv.height = ch
    cv.style.width = cw / dpr + 'px'; cv.style.height = ch / dpr + 'px'
  }
  const ctx = cv.getContext('2d')
  ctx.setTransform(cw / page.W, 0, 0, ch / page.H, 0, 0)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, page.W, page.H)
  if (bg.value) ctx.drawImage(bg.value, 0, 0, page.W, page.H)
  const set = parsePages(pages.value, totalPages.value || 1)
  if (set && !set.has(1)) return
  const L = layout(page.W, page.H, p, metrics.value, aspect())
  drawWatermark(ctx, L, p, p.kind === 'image' ? logoCanvas.value : null)
}

watch(p, schedule, { deep: true })
watch([bg, logoCanvas, pages, () => page.W, () => page.H, metrics, stageW, stageH], schedule)

onMounted(async () => {
  metrics.value = await createMetrics()
  schedule()
})
onBeforeUnmount(() => cancelAnimationFrame(raf))

// ---- terapkan ----
const canvasPng = (c) => new Promise((res) => c.toBlob(async (b) => res(new Uint8Array(await b.arrayBuffer())), 'image/png'))

async function apply() {
  if (!src.value) return notify('Pilih file PDF atau gambar dulu.')
  if (p.kind === 'image' && !logoCanvas.value) return notify('Pilih gambar logo dulu.')
  if (p.kind === 'text' && !p.txt.trim()) return notify('Teks watermark masih kosong.')
  busy.value = true
  jobStart('Watermark')
  try {
    let doc
    if (src.value.ext === 'pdf') {
      doc = await PDFDocument.load(src.value.bytes, { ignoreEncryption: true })
    } else {
      doc = await PDFDocument.create()
      const img = await doc.embedPng(await canvasPng(bg.value))
      doc.addPage([page.W, page.H]).drawImage(img, { x: 0, y: 0, width: page.W, height: page.H })
    }
    const set = parsePages(pages.value, doc.getPageCount())
    if (pages.value.trim() && (!set || !set.size)) throw new Error('Rentang halaman tidak valid.')
    const logoPng = p.kind === 'image' ? await canvasPng(logoCanvas.value) : null
    await stampPdf(doc, p, metrics.value, logoPng, aspect(), set)
    let out = await doc.save()
    let note = ''
    if (compress.value) {
      const r = await compressPdf(out, {
        targetMB: Math.max(0.05, Number(maxMB.value) || 2),
        mode: 'color',
        onProgress: (pr) => { stage.value = `${pr.text}`; jobProgress(pr.pct, pr.text) }
      })
      if (r.changed) out = r.bytes
      note = r.reached ? ` (${(out.length / 1048576).toFixed(2)} MB)` : ` (${(out.length / 1048576).toFixed(2)} MB, target belum tercapai)`
    }
    const path = await SaveOutput(src.value.path, '_watermark', bytesToB64(out))
    notify('Watermark tersimpan: ' + path.split(/[\\/]/).pop() + note, path)
  } catch (e) {
    notify('Gagal: ' + (e?.message || e))
  } finally {
    busy.value = false
    stage.value = ''
    jobEnd()
  }
}
</script>

<template>
  <div class="studio no-drag">
    <!-- Kolom kiri: kontrol -->
    <section class="left">
      <div class="scroll">
        <button v-if="!src" class="dz" @click="pickSource">
          <FileUp :size="20" />
          <b>Seret file PDF / gambar ke sini</b>
          <small>atau klik untuk memilih</small>
        </button>
        <div v-else class="filebar">
          <span class="fname" :title="src.name">{{ src.name }}</span>
          <button class="btn ghost" @click="pickSource"><FileUp :size="14" /> Ganti</button>
          <button class="btn ghost" title="Kosongkan file" @click="resetFile"><RotateCcw :size="14" /> Reset</button>
        </div>
        <label v-if="!src || src.ext === 'pdf'" class="lab">
          Halaman (kosong = semua){{ totalPages ? ' • total ' + totalPages : '' }}
          <input v-model="pages" class="inp" placeholder="1-3,5" />
        </label>

        <div class="tabs">
          <button :class="{ on: tab === 'isi' }" @click="tab = 'isi'">Isi</button>
          <button :class="{ on: tab === 'tata' }" @click="tab = 'tata'">Tata letak</button>
        </div>

        <template v-if="tab === 'isi'">
          <div class="seg">
            <button :class="{ on: p.kind === 'text' }" @click="p.kind = 'text'">Teks</button>
            <button :class="{ on: p.kind === 'image' }" @click="p.kind = 'image'">Gambar</button>
          </div>

          <template v-if="p.kind === 'text'">
            <label class="lab">Teks (satu baris per baris)
              <textarea v-model="p.txt" class="inp" rows="3" />
            </label>
            <label class="lab">Font
              <select v-model="p.font" class="inp">
                <option v-for="(f, k) in FONTS" :key="k" :value="k">{{ f.label }}</option>
              </select>
            </label>
            <SliderRow v-model="p.size" label="Ukuran huruf" :min="8" :max="200" unit="pt" />
            <SliderRow v-model="p.ls" label="Jarak antar baris" :min="0" :max="250" unit="pt" />
          </template>

          <template v-else>
            <div class="logorow">
              <button class="drop" @click="pickLogo">
                <ImagePlus :size="18" />
                <span>{{ logoName || 'Pilih logo / tanda tangan (PNG, JPG, WEBP)' }}</span>
              </button>
              <button v-if="logoName" class="x" title="Hapus logo" @click="clearLogo"><X :size="14" /></button>
            </div>
            <p v-if="src" class="hint">Tip: seret gambar ke jendela untuk mengganti logo.</p>
            <div class="seg">
              <button :class="{ on: p.cmode === 'orig' }" @click="p.cmode = 'orig'">Warna asli</button>
              <button :class="{ on: p.cmode === 'one' }" @click="p.cmode = 'one'">Satu warna</button>
            </div>
            <SliderRow v-model="p.iw" label="Lebar gambar" :min="20" :max="800" unit="pt" />
          </template>

          <label class="lab colorrow">Warna
            <input v-model="p.col" type="color" class="color" />
            <code>{{ p.col }}</code>
          </label>
          <SliderRow v-model="p.op" label="Opasitas" :min="1" :max="100" unit="%" />
        </template>

        <template v-else>
          <div class="seg">
            <button :class="{ on: p.mode === 'single' }" @click="setMode('single')">Tunggal</button>
            <button :class="{ on: p.mode === 'tile' }" @click="setMode('tile')">Berulang penuh</button>
          </div>
          <SliderRow :model-value="p.rot" label="Rotasi" :min="-90" :max="90" :step="0.1" unit="°" @update:model-value="onRotInput" />
          <div class="chips">
            <button @click="setRot('flat')">Mendatar</button>
            <button @click="setRot('ne')">Diagonal ↗</button>
            <button @click="setRot('se')">Diagonal ↘</button>
            <button @click="setRot('up')">Tegak</button>
          </div>

          <template v-if="p.mode === 'single'">
            <SliderRow v-model="p.ox" label="Geser horizontal" :min="-400" :max="400" unit="pt" />
            <SliderRow v-model="p.oy" label="Geser vertikal" :min="-400" :max="400" unit="pt" />
            <button class="btn ghost wide" @click="fit">Pas ke halaman</button>
          </template>
          <template v-else>
            <SliderRow v-model="p.gx" label="Jarak horizontal" :min="0" :max="300" unit="pt" />
            <SliderRow v-model="p.gy" label="Jarak vertikal" :min="0" :max="300" unit="pt" />
            <label class="check"><input v-model="p.stag" type="checkbox" /> Selang-seling (pola bata)</label>
          </template>
        </template>
      </div>

      <footer class="foot">
        <label class="check">
          <input v-model="compress" type="checkbox" /> Sekaligus kompres, maks.
          <input v-model.number="maxMB" class="mb" type="number" min="0.1" step="0.5" :disabled="!compress" /> MB
        </label>
        <button class="btn primary" :disabled="busy" @click="apply">
          <Loader2 v-if="busy" :size="15" class="spin" /> {{ busy && stage ? stage : 'Terapkan & Simpan' }}
        </button>
      </footer>
    </section>

    <!-- Kolom kanan: live preview -->
    <section class="right">
      <div ref="stageRef" class="stage"><canvas ref="canvasRef" /></div>
      <p class="cap">{{ src ? 'Pratinjau halaman 1' : 'Simulasi A4, seret file ke jendela ini' }}</p>
    </section>
  </div>
</template>

<style scoped>
.studio { display: flex; height: 100%; }
.left { width: 375px; display: flex; flex-direction: column; min-height: 0; }
.scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 14px 8px 16px; }
.right { flex: 1; min-width: 0; padding: 4px 14px 12px 6px; display: flex; flex-direction: column; align-items: center; }
.stage {
  flex: 1; width: 100%; min-height: 0; box-sizing: border-box; padding: 12px; display: grid; place-items: center; border-radius: 16px; overflow: hidden;
  background: var(--tile); border: 1px solid var(--line);
}
canvas { background: #fff; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25); border-radius: 2px; }
.cap { margin: 8px 0 0; font-size: 12px; color: var(--ink-soft); }

.dz {
  display: flex; flex-direction: column; align-items: center; gap: 2px; width: 100%; padding: 16px 12px; margin-bottom: 10px;
  border: 1.5px dashed var(--accent); border-radius: 14px; cursor: pointer; font: inherit; font-size: 13px;
  background: color-mix(in srgb, var(--accent) 8%, transparent); color: var(--accent);
}
.dz small { color: var(--ink-soft); font-size: 12px; }
.logorow { display: flex; gap: 6px; align-items: stretch; }
.logorow .drop { flex: 1; }
.x { width: 34px; margin-bottom: 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--tile); color: var(--ink-soft); cursor: pointer; display: grid; place-items: center; }
.hint { margin: -4px 0 10px; font-size: 11.5px; color: var(--ink-soft); }
.filebar { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
.filebar .fname { flex: 1; min-width: 0; color: var(--ink); font-size: 12.5px; }
.filebar .btn { padding: 6px 9px; font-size: 12px; }
.fname { font-size: 12px; color: var(--ink-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lab { display: block; font-size: 12.5px; color: var(--ink-soft); margin-bottom: 10px; }
.inp {
  display: block; width: 100%; box-sizing: border-box; margin-top: 4px; padding: 7px 9px; font: inherit; font-size: 13px;
  border: 1px solid var(--line); border-radius: 10px; background: var(--tile); color: var(--ink); resize: none; user-select: text;
}
.colorrow { display: flex; align-items: center; gap: 10px; }
.color { width: 36px; height: 28px; padding: 0; border: 1px solid var(--line); border-radius: 8px; background: none; }
code { font-size: 12px; }

.tabs, .seg { display: flex; gap: 4px; padding: 3px; border-radius: 12px; background: var(--tile); border: 1px solid var(--line); margin-bottom: 12px; }
.tabs button, .seg button {
  flex: 1; padding: 6px 8px; font-size: 13px; border: 0; border-radius: 9px; cursor: pointer; background: transparent; color: var(--ink-soft);
}
.tabs button.on, .seg button.on { background: var(--accent); color: var(--accent-ink); font-weight: 600; }

.chips { display: flex; flex-wrap: wrap; gap: 6px; margin: -2px 0 12px; }
.chips button { padding: 5px 10px; font-size: 12px; border-radius: 999px; cursor: pointer; border: 1px solid var(--line); background: var(--tile); color: var(--ink); }
.chips button:hover { background: var(--tile-hover); }

.drop {
  display: flex; align-items: center; gap: 8px; width: 100%; padding: 14px 12px; margin-bottom: 10px; font-size: 12.5px; text-align: left; cursor: pointer;
  border: 1.5px dashed var(--line); border-radius: 12px; background: var(--tile); color: var(--ink-soft);
}
.check { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--ink); }
.check.off { opacity: 0.55; }
.mb { width: 46px; padding: 2px 4px; font-size: 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--tile); color: var(--ink); }

.foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 14px 14px 16px; border-top: 1px solid var(--line); }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 12px; font-size: 13px; font-weight: 600; border: 0; border-radius: 11px; cursor: pointer; white-space: nowrap; }
.btn.primary { background: var(--accent); color: var(--accent-ink); }
.btn.primary:disabled { opacity: 0.6; cursor: progress; }
.btn.ghost { background: var(--tile); color: var(--ink); border: 1px solid var(--line); }
.btn.wide { width: 100%; }
.spin { animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
