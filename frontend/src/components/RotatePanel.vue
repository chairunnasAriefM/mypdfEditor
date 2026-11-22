<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { Loader2, ChevronLeft, ChevronRight, RotateCw, RotateCcw, FlipVertical2 } from 'lucide-vue-next'
import { RotatePages, ReadFileB64 } from '../../wailsjs/go/main/App'
import { usePdfInput } from '../utils/usePdfInput'
import { useBoxSize } from '../utils/useBoxSize'
import { parsePages, b64ToBytes } from '../utils/watermarkEngine'
import pdfjs from '../utils/pdfjs'
import PdfFileBar from './PdfFileBar.vue'

const props = defineProps({ files: Array })
const { pdf, pageCount, pick, reset, notify, name } = usePdfInput(props)

const angle = ref(90) // 90 = kanan, 270 = kiri, 180 = balik
const target = ref('all')
const ranges = ref('')
const busy = ref(false)
const pv = ref(1)
const cv = ref(null)
const visual = ref(0)
const stageRef = ref(null)
const { w: sw, h: sh } = useBoxSize(stageRef)

let doc = null
let task = null
// sisi kotak pratinjau: muat untuk orientasi apa pun, termasuk setelah diputar 90°
const BOX = computed(() => Math.max(120, Math.min(sw.value || 220, sh.value || 220) - 40))

const affected = computed(() => {
  const n = pv.value
  if (target.value === 'all') return true
  if (target.value === 'odd') return n % 2 === 1
  if (target.value === 'even') return n % 2 === 0
  const set = parsePages(ranges.value, pageCount.value)
  return !!set && set.has(n)
})
const targetDeg = computed(() => (affected.value ? angle.value : 0))

// putar lewat jalur terpendek agar animasi mulus
watch(targetDeg, (t) => {
  const cur = ((visual.value % 360) + 360) % 360
  visual.value += ((t - cur + 540) % 360) - 180
}, { immediate: true })

async function render() {
  if (!doc || !cv.value) return
  task?.cancel()
  try {
    const pg = await doc.getPage(pv.value)
    const v1 = pg.getViewport({ scale: 1 })
    const dpr = window.devicePixelRatio || 1
    const v = pg.getViewport({ scale: Math.min(BOX.value / v1.width, BOX.value / v1.height) * dpr })
    const c = cv.value
    c.width = Math.ceil(v.width); c.height = Math.ceil(v.height)
    c.style.width = c.width / dpr + 'px'; c.style.height = c.height / dpr + 'px'
    task = pg.render({ canvasContext: c.getContext('2d'), viewport: v })
    await task.promise
  } catch { /* render dibatalkan */ }
}

watch(pdf, async (f) => {
  doc?.destroy(); doc = null
  pv.value = 1
  if (!f) return
  try {
    doc = await pdfjs.getDocument({ data: b64ToBytes(await ReadFileB64(f.path)) }).promise
    await render()
  } catch (e) {
    notify('Gagal membuat pratinjau: ' + (e?.message || e))
  }
}, { immediate: true })
watch([pv, BOX], render)
onBeforeUnmount(() => { task?.cancel(); doc?.destroy() })

const step = (d) => { pv.value = Math.min(pageCount.value || 1, Math.max(1, pv.value + d)) }

async function run() {
  busy.value = true
  try {
    const out = await RotatePages(pdf.value.path, angle.value, target.value, ranges.value)
    notify('Tersimpan: ' + name(out), out)
  } catch (e) {
    notify('Gagal: ' + (e?.message || e))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="pnl no-drag">
    <div class="ctl">
      <PdfFileBar :pdf="pdf" :page-count="pageCount" @pick="pick" @reset="reset" />
      <div class="pseg angles">
        <button :class="{ on: angle === 90 }" @click="angle = 90"><RotateCw :size="14" /> 90° kanan</button>
        <button :class="{ on: angle === 270 }" @click="angle = 270"><RotateCcw :size="14" /> 90° kiri</button>
        <button :class="{ on: angle === 180 }" @click="angle = 180"><FlipVertical2 :size="14" /> 180°</button>
      </div>
      <div class="pseg">
        <button :class="{ on: target === 'all' }" @click="target = 'all'">Semua</button>
        <button :class="{ on: target === 'odd' }" @click="target = 'odd'">Ganjil</button>
        <button :class="{ on: target === 'even' }" @click="target = 'even'">Genap</button>
        <button :class="{ on: target === 'range' }" @click="target = 'range'">Rentang</button>
      </div>
      <input v-if="target === 'range'" v-model="ranges" class="pinp rg" placeholder="2, 4-6" />
    </div>

    <div class="pvw">
      <div ref="stageRef" class="stage">
        <canvas v-show="pdf" ref="cv" :style="{ transform: `rotate(${visual}deg)` }" />
        <span v-if="!pdf" class="empty">Pilih PDF untuk melihat pratinjau rotasi</span>
      </div>
      <div v-if="pdf" class="pager">
        <button class="pbtn pghost" :disabled="pv <= 1" @click="step(-1)"><ChevronLeft :size="15" /></button>
        <span>Hal {{ pv }} / {{ pageCount }} <i v-if="!affected">• tidak ikut diputar</i></span>
        <button class="pbtn pghost" :disabled="pv >= pageCount" @click="step(1)"><ChevronRight :size="15" /></button>
      </div>
    </div>

    <div class="act">
      <button class="pbtn pprim" :disabled="!pdf || busy || (target === 'range' && !ranges.trim())" @click="run">
        <Loader2 v-if="busy" :size="15" class="pspin" /> Putar &amp; Simpan
      </button>
    </div>
  </div>
</template>

<style scoped>
.angles button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; font-size: 12.5px; }
.rg { margin: -4px 0 10px; }
.stage { flex: 1; min-height: 0; display: grid; place-items: center; overflow: hidden; }
canvas { background: #fff; box-shadow: 0 3px 14px rgba(0, 0, 0, 0.3); transition: transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1); }
.empty { font-size: 12.5px; color: var(--ink-soft); }
.pager { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 8px; border-top: 1px solid var(--line); font-size: 12.5px; color: var(--ink-soft); }
.pager i { font-style: normal; color: var(--accent); }
.pager .pbtn { padding: 4px 8px; }
.pager .pbtn:disabled { opacity: 0.35; cursor: default; }
</style>
