<script setup>
import { ref, shallowRef, computed, watch, onBeforeUnmount } from 'vue'
import { Loader2, ChevronLeft, ChevronRight, X } from 'lucide-vue-next'
import { ReadFileB64, SaveOutput } from '../../wailsjs/go/main/App'
import { usePdfInput } from '../utils/usePdfInput'
import { usePdfDoc } from '../utils/usePdfDoc'
import { useBoxSize } from '../utils/useBoxSize'
import { compressPdf } from '../utils/compressEngine'
import { jobStart, jobProgress, jobEnd } from '../utils/jobStore'
import { b64ToBytes, bytesToB64 } from '../utils/watermarkEngine'
import pdfjs from '../utils/pdfjs'
import PdfFileBar from './PdfFileBar.vue'
import PageThumb from './PageThumb.vue'

const props = defineProps({ files: Array })
const { pdf, pageCount, pick, reset, notify, name } = usePdfInput(props)
const { doc } = usePdfDoc(pdf)

const targetMB = ref(2)
const mode = ref('auto')
const soft = ref(false)
const running = ref(false)
const progress = ref({ text: '', pct: 0 })
const result = shallowRef(null)
const resDoc = shallowRef(null)
const pv = ref(1)
const stageRef = ref(null)
const { w: sw, h: sh } = useBoxSize(stageRef)
let ctrl = null

const paneW = computed(() => Math.max(90, Math.floor(((sw.value || 320) - 44) / 2)))
const paneH = computed(() => Math.max(120, (sh.value || 320) - 70))
const fmt = (b) => (b / 1048576).toFixed(2) + ' MB'
const saving = computed(() => (result.value && pdf.value ? Math.max(0, Math.round((1 - result.value.size / (pdf.value.sizeMB * 1048576)) * 100)) : 0))

function clearResult() {
  resDoc.value?.destroy()
  resDoc.value = null
  result.value = null
  pv.value = 1
}
watch(pdf, clearResult)
onBeforeUnmount(() => { ctrl && (ctrl.cancelled = true); resDoc.value?.destroy() })

async function run() {
  clearResult()
  running.value = true
  jobStart('Mengompres')
  ctrl = { cancelled: false }
  progress.value = { text: 'Membaca file', pct: 1 }
  try {
    const bytes = b64ToBytes(await ReadFileB64(pdf.value.path))
    const r = await compressPdf(bytes, {
      targetMB: Math.max(0.05, Number(targetMB.value) || 2),
      mode: mode.value,
      allowSoft: soft.value,
      onProgress: (p) => { progress.value = p; jobProgress(p.pct, p.text) },
      signal: ctrl
    })
    if (!r.changed) {
      notify(r.reached ? 'Ukuran file sudah di bawah target, tidak perlu dikompres.' : 'Tidak ada hasil yang lebih kecil dari file asli. Coba mode hitam-putih atau izinkan teks lebih halus.')
      return
    }
    const path = await SaveOutput(pdf.value.path, '_kompres', bytesToB64(r.bytes))
    result.value = { ...r, path }
    resDoc.value = await pdfjs.getDocument({ data: r.bytes.slice() }).promise
    notify(
      (r.reached ? 'Tersimpan: ' : `Hasil terkecil yang masih jelas ${fmt(r.size)}, target belum tercapai. Tersimpan: `) + name(path),
      path
    )
  } catch (e) {
    if (!/Dibatalkan/.test(e?.message || '')) notify('Gagal: ' + (e?.message || e))
  } finally {
    running.value = false
    jobEnd()
  }
}
const cancel = () => { if (ctrl) ctrl.cancelled = true }
const step = (d) => { pv.value = Math.min(pageCount.value || 1, Math.max(1, pv.value + d)) }
</script>

<template>
  <div class="pnl no-drag">
    <div class="ctl">
      <PdfFileBar :pdf="pdf" :page-count="pageCount" @pick="pick" @reset="reset" />

      <label class="plab">
        Ukuran maksimal hasil
        <span class="mbrow">
          <input v-model.number="targetMB" class="pinp mb" type="number" min="0.1" step="0.5" /> <b>MB</b>
          <button v-for="m in [1, 2, 5, 10]" :key="m" class="chip" @click="targetMB = m">{{ m }}</button>
        </span>
      </label>

      <div class="pseg">
        <button :class="{ on: mode === 'auto' }" @click="mode = 'auto'">Otomatis</button>
        <button :class="{ on: mode === 'color' }" @click="mode = 'color'">Berwarna</button>
        <button :class="{ on: mode === 'bw' }" @click="mode = 'bw'">Hitam-putih</button>
      </div>
      <label v-if="mode !== 'auto'" class="soft"><input v-model="soft" type="checkbox" /> Izinkan teks lebih halus bila target sulit dicapai</label>
      <p class="note">
        <template v-if="mode === 'auto'">Target dianggap batas keras: dicoba berwarna dulu, lalu hitam-putih, lalu semua halaman hitam-putih dengan resolusi makin rendah sampai muat. Untuk file yang memang mustahil mencapai target, hasil terkecil yang masih terbaca disimpan.</template>
        <template v-else-if="mode === 'color'">Teks vektor (hasil Word/Excel) dipertahankan tajam dan bisa disalin. Halaman scan dipisah menjadi teks 1-bit yang tajam dan latar/foto yang dikecilkan, jadi tulisan tetap jelas walau file jauh lebih kecil.</template>
        <template v-else>Halaman scan diubah menjadi 1-bit dengan Otsu adaptif, sangat kecil dan kontras. Teks tak terlihat tetap disisipkan bila halaman punya teks.</template>
      </p>

      <div v-if="pdf" class="stats">
        <div><span>Asli</span><b>{{ pdf.sizeMB.toFixed(2) }} MB</b></div>
        <div><span>Target</span><b>{{ Number(targetMB || 0).toFixed(2) }} MB</b></div>
        <div v-if="result" :class="result.reached ? 'ok' : 'warn'"><span>Hasil</span><b>{{ fmt(result.size) }} (-{{ saving }}%)</b></div>
      </div>
      <p v-if="result" class="note">
        {{ result.scanPages }} dari {{ result.pages }} halaman terdeteksi scan.
        <template v-if="result.usedMode === 'bw' && mode === 'auto'"> Berwarna tidak muat di target, jadi hasil akhirnya hitam-putih ({{ result.level.dpi }} dpi<template v-if="result.rescued">, semua halaman</template>).</template>
        <template v-else-if="result.rescued"> Halaman yang banyak gambarnya juga dibuat berlapis.</template>
        <template v-if="!result.reached"> File ini terlalu besar untuk mencapai target; ini ukuran terkecil yang masih terbaca. Naikkan target bila perlu.</template>
      </p>

      <div v-if="running" class="prog">
        <div class="bar"><i :style="{ width: progress.pct + '%' }" /></div>
        <span>{{ progress.text }}</span>
      </div>
    </div>

    <div class="pvw">
      <div ref="stageRef" class="stage">
        <template v-if="pdf">
          <figure>
            <PageThumb :doc="doc" :page="pv" :w="paneW" :h="paneH" />
            <figcaption><b>Asli</b> • {{ pdf.sizeMB.toFixed(2) }} MB</figcaption>
          </figure>
          <figure>
            <PageThumb v-if="resDoc" :doc="resDoc" :page="pv" :w="paneW" :h="paneH" />
            <span v-else class="ph" :style="{ width: paneW + 'px', height: paneH + 'px' }">{{ running ? 'Memproses…' : 'Hasil muncul di sini' }}</span>
            <figcaption><b>Hasil</b><template v-if="result"> • {{ fmt(result.size) }}</template></figcaption>
          </figure>
        </template>
        <p v-else class="empty">Pilih PDF untuk melihat perbandingan sebelum dan sesudah</p>
      </div>
      <div v-if="pdf" class="pager">
        <button class="pbtn pghost" :disabled="pv <= 1" @click="step(-1)"><ChevronLeft :size="15" /></button>
        <span>Hal {{ pv }} / {{ pageCount }}</span>
        <button class="pbtn pghost" :disabled="pv >= pageCount" @click="step(1)"><ChevronRight :size="15" /></button>
      </div>
    </div>

    <div class="act">
      <button v-if="!running" class="pbtn pprim" :disabled="!pdf" @click="run">Kompres &amp; Simpan</button>
      <button v-else class="pbtn pghost" @click="cancel"><Loader2 :size="15" class="pspin" /> Batalkan</button>
    </div>
  </div>
</template>

<style scoped>
.mbrow { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
.mb { width: 84px; margin-top: 0; }
.chip { padding: 5px 10px; font-size: 12px; border-radius: 999px; cursor: pointer; border: 1px solid var(--line); background: var(--tile); color: var(--ink); }
.chip:hover { background: var(--tile-hover); }
.soft { display: flex; align-items: center; gap: 6px; margin: -4px 0 8px; font-size: 12px; color: var(--ink); }
.note { font-size: 11.5px; line-height: 1.45; color: var(--ink-soft); margin: 0 0 10px; }
.stats { display: flex; gap: 8px; margin-bottom: 8px; }
.stats div { flex: 1; padding: 8px 10px; border-radius: 12px; background: var(--tile); border: 1px solid var(--line); display: flex; flex-direction: column; }
.stats span { font-size: 11px; color: var(--ink-soft); }
.stats b { font-size: 13px; }
.stats .ok { border-color: #2fa37a; } .stats .ok b { color: #2fa37a; }
.stats .warn { border-color: #d6a21c; } .stats .warn b { color: #d6a21c; }
.prog { margin: 6px 0 10px; font-size: 12px; color: var(--ink-soft); }
.bar { height: 6px; border-radius: 6px; background: var(--line); overflow: hidden; margin-bottom: 4px; }
.bar i { display: block; height: 100%; background: var(--accent); transition: width 0.25s; }
.stage { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; gap: 16px; padding: 12px; overflow: hidden; }
figure { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 8px; }
figcaption { font-size: 12px; color: var(--ink-soft); }
figcaption b { color: var(--ink); }
.ph { display: grid; place-items: center; border: 1.5px dashed var(--line); border-radius: 6px; font-size: 12px; color: var(--ink-soft); }
.empty { font-size: 12.5px; color: var(--ink-soft); }
.pager { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 8px; border-top: 1px solid var(--line); font-size: 12.5px; color: var(--ink-soft); }
.pager .pbtn { padding: 4px 8px; }
.pager .pbtn:disabled { opacity: 0.35; cursor: default; }
</style>
