<script setup>
import { ref, computed, watch } from 'vue'
import { Loader2, ArrowRight } from 'lucide-vue-next'
import { ResizePages } from '../../wailsjs/go/main/App'
import { usePdfInput } from '../utils/usePdfInput'
import { usePdfDoc } from '../utils/usePdfDoc'
import { useBoxSize } from '../utils/useBoxSize'
import PdfFileBar from './PdfFileBar.vue'
import SliderRow from './SliderRow.vue'
import PageThumb from './PageThumb.vue'

const props = defineProps({ files: Array })
const { pdf, pageCount, pick, reset, notify, name } = usePdfInput(props)
const { doc } = usePdfDoc(pdf)

const PAPER = { A4: [595, 842], A3: [842, 1191], A5: [420, 595], F4: [612, 936], Letter: [612, 792], Legal: [612, 1008] }
const presets = [
  ...Object.entries(PAPER).map(([k, [w, h]]) => [k, `${w} × ${h} pt`]),
  ['scale', 'Skala persen']
]
const sel = ref('A4')
const percent = ref(100)
const busy = ref(false)
const orig = ref({ w: 0, h: 0 })
const pvRef = ref(null)
const { w: pvW, h: pvH } = useBoxSize(pvRef)

watch(doc, async (d) => {
  orig.value = { w: 0, h: 0 }
  if (!d) return
  try {
    const v = (await d.getPage(1)).getViewport({ scale: 1 })
    orig.value = { w: v.width, h: v.height }
  } catch { /* abaikan */ }
}, { immediate: true })

// Ukuran hasil: orientasi mengikuti halaman asli.
const target = computed(() => {
  const o = orig.value
  if (!o.w) return null
  if (sel.value === 'scale') return { w: (o.w * percent.value) / 100, h: (o.h * percent.value) / 100 }
  const [a, b] = PAPER[sel.value]
  return o.w > o.h ? { w: b, h: a } : { w: a, h: b }
})

const fig = computed(() => {
  const o = orig.value, t = target.value
  if (!t) return null
  const boxW = Math.max(80, ((pvW.value || 340) - 90) / 2)
  const boxH = Math.max(80, (pvH.value || 200) - 90)
  const s = Math.min(boxW / Math.max(o.w, t.w), boxH / Math.max(o.h, t.h))
  const k = Math.min(t.w / o.w, t.h / o.h) // isi diskalakan muat di halaman baru
  return { ow: o.w * s, oh: o.h * s, tw: t.w * s, th: t.h * s, cw: o.w * k * s, ch: o.h * k * s }
})
const dim = (d) => `${Math.round(d.w)} × ${Math.round(d.h)} pt`
const pct = computed(() => (orig.value.w && target.value ? Math.round(Math.min(target.value.w / orig.value.w, target.value.h / orig.value.h) * 100) : 0))

async function run() {
  busy.value = true
  try {
    const out = await ResizePages(pdf.value.path, sel.value, percent.value)
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
      <div class="grid">
        <button v-for="[k, d] in presets" :key="k" :class="{ on: sel === k }" @click="sel = k">
          <b>{{ k === 'scale' ? 'Custom' : k }}</b><span>{{ d }}</span>
        </button>
      </div>
      <SliderRow v-if="sel === 'scale'" v-model="percent" label="Skala halaman" :min="10" :max="400" unit="%" />
      <p class="note">Ukuran diubah secara vektor. Isi dipertahankan rasionya dan diletakkan di tengah halaman.</p>
    </div>

    <div ref="pvRef" class="pvw center">
      <template v-if="fig">
        <figure>
          <span class="box" :style="{ width: fig.ow + 'px', height: fig.oh + 'px' }">
            <PageThumb :doc="doc" :page="1" :w="fig.ow" :h="fig.oh" />
          </span>
          <figcaption><b>Asli</b><br />{{ dim(orig) }}</figcaption>
        </figure>
        <ArrowRight :size="20" class="arr" />
        <figure>
          <span class="box paper" :style="{ width: fig.tw + 'px', height: fig.th + 'px' }">
            <PageThumb :doc="doc" :page="1" :w="fig.cw" :h="fig.ch" />
          </span>
          <figcaption><b>Hasil</b><br />{{ dim(target) }} • isi {{ pct }}%</figcaption>
        </figure>
      </template>
      <p v-else class="empty">Pilih PDF untuk melihat pratinjau ukuran (halaman 1)</p>
    </div>

    <div class="act">
      <button class="pbtn pprim" :disabled="!pdf || busy" @click="run">
        <Loader2 v-if="busy" :size="15" class="pspin" /> Ubah ukuran &amp; Simpan
      </button>
    </div>
  </div>
</template>

<style scoped>
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; }
.grid button {
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 8px 12px; cursor: pointer; text-align: left;
  border: 1px solid var(--line); border-radius: 12px; background: var(--tile); color: var(--ink);
}
.grid button span { font-size: 11.5px; color: var(--ink-soft); }
.grid button.on { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.pvw.center { flex-direction: row; align-items: center; justify-content: center; gap: 18px; padding: 10px; }
figure { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 8px; }
figcaption { font-size: 12px; text-align: center; color: var(--ink-soft); line-height: 1.4; }
figcaption b { color: var(--ink); }
.box { display: grid; place-items: center; background: var(--tile-hover); outline: 1px dashed var(--line); transition: width 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), height 0.35s cubic-bezier(0.34, 1.56, 0.64, 1); }
.box.paper { background: #fff; outline: 1.5px solid var(--accent); }
.arr { color: var(--ink-soft); flex-shrink: 0; }
.empty { font-size: 12.5px; color: var(--ink-soft); }
.note { font-size: 11.5px; color: var(--ink-soft); margin: 0 0 10px; }
</style>
