<script setup>
import { ref, computed } from 'vue'
import { Loader2, Maximize } from 'lucide-vue-next'
import { ExtractPages, SplitEvery } from '../../wailsjs/go/main/App'
import { usePdfInput } from '../utils/usePdfInput'
import { usePdfDoc } from '../utils/usePdfDoc'
import { useBoxSize } from '../utils/useBoxSize'
import { parsePages } from '../utils/watermarkEngine'
import PdfFileBar from './PdfFileBar.vue'
import PageThumb from './PageThumb.vue'
import PageViewer from './PageViewer.vue'

const props = defineProps({ files: Array })
const { pdf, pageCount, pick, reset, notify, name } = usePdfInput(props)
const { doc } = usePdfDoc(pdf)

const mode = ref('extract')
const ranges = ref('')
const every = ref(1)
const busy = ref(false)
const viewIdx = ref(null)
const gridRef = ref(null)
const { w: gw } = useBoxSize(gridRef)

const MAX = 400
const PALETTE = ['#3E7BFA', '#E8743B', '#2FA37A', '#B05CE0', '#D6A21C', '#E0527A']
const n = computed(() => Math.max(1, Math.floor(every.value) || 1))
// Thumbnail membesar mengikuti lebar panel (fullscreen = thumbnail besar).
const tw = computed(() => Math.max(66, Math.min(170, Math.floor((gw.value - 24 - 10 * 4) / Math.max(3, Math.floor(gw.value / 150))))))
const th = computed(() => Math.round(tw.value * 1.38))

const selected = computed(() => {
  const set = parsePages(ranges.value, pageCount.value)
  return set ? [...set].sort((a, b) => a - b) : []
})

const thumbs = computed(() => {
  const total = pageCount.value
  if (!pdf.value || !total) return []
  if (mode.value === 'extract') {
    return selected.value.slice(0, MAX).map((p) => ({ p, color: 'var(--accent)' }))
  }
  const out = []
  for (let i = 1; i <= Math.min(total, MAX); i++) {
    const g = Math.floor((i - 1) / n.value)
    out.push({ p: i, color: PALETTE[g % PALETTE.length], g: g + 1, tag: (i - 1) % n.value === 0 ? `File ${g + 1}` : null })
  }
  return out
})

const summary = computed(() => {
  if (!pdf.value || !pageCount.value) return 'Pilih PDF untuk melihat pratinjau'
  if (mode.value === 'split') return `Menghasilkan ${Math.ceil(pageCount.value / n.value)} file • klik halaman untuk memperbesar`
  if (!ranges.value.trim()) return 'Isi rentang halaman untuk melihat pratinjau'
  return selected.value.length ? `${selected.value.length} halaman terpilih • klik halaman untuk memperbesar` : 'Rentang tidak valid'
})
const hidden = computed(() => Math.max(0, (mode.value === 'extract' ? selected.value.length : pageCount.value) - MAX))
const cur = computed(() => (viewIdx.value === null ? null : thumbs.value[viewIdx.value] || null))

async function run() {
  busy.value = true
  try {
    if (mode.value === 'extract') {
      const out = await ExtractPages(pdf.value.path, ranges.value)
      notify('Tersimpan: ' + name(out), out)
    } else {
      const dir = await SplitEvery(pdf.value.path, n.value)
      notify('Folder hasil: ' + name(dir), dir)
    }
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
      <div class="pseg">
        <button :class="{ on: mode === 'extract' }" @click="mode = 'extract'; viewIdx = null">Ekstrak ke 1 PDF</button>
        <button :class="{ on: mode === 'split' }" @click="mode = 'split'; viewIdx = null">Pecah banyak file</button>
      </div>
      <label v-if="mode === 'extract'" class="plab">
        Halaman yang diambil (total {{ pageCount || 0 }})
        <input v-model="ranges" class="pinp" placeholder="1-3, 5, 8-10" />
      </label>
      <label v-else class="plab">
        Halaman per file (total {{ pageCount || 0 }})
        <input v-model.number="every" class="pinp" type="number" min="1" />
      </label>
    </div>

    <div class="pvw">
      <PageViewer
        v-if="cur"
        :doc="doc" :page="cur.p" closable
        :title="`Halaman ${cur.p}`" :sub="mode === 'split' ? `Masuk File ${cur.g}` : `${viewIdx + 1} dari ${thumbs.length} halaman terpilih`"
        :has-prev="viewIdx > 0" :has-next="viewIdx < thumbs.length - 1"
        @prev="viewIdx--" @next="viewIdx++" @close="viewIdx = null"
      />
      <template v-if="!cur">
        <p class="sum">{{ summary }}</p>
        <div ref="gridRef" class="thumbs">
          <figure v-for="(t, i) in thumbs" :key="t.p" :style="{ '--c': t.color }" @click="viewIdx = i">
            <span v-if="t.tag" class="tag">{{ t.tag }}</span>
            <PageThumb :doc="doc" :page="t.p" :w="tw" :h="th" />
            <span class="zoom"><Maximize :size="14" /></span>
            <figcaption>{{ t.p }}</figcaption>
          </figure>
          <p v-if="hidden" class="more">+{{ hidden }} halaman lagi</p>
        </div>
      </template>
    </div>

    <div class="act">
      <button class="pbtn pprim" :disabled="!pdf || busy || (mode === 'extract' && !selected.length)" @click="run">
        <Loader2 v-if="busy" :size="15" class="pspin" /> {{ mode === 'extract' ? 'Ekstrak & Simpan' : 'Pecah & Simpan' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.sum { margin: 0; padding: 9px 12px; font-size: 12.5px; color: var(--ink-soft); border-bottom: 1px solid var(--line); }
.thumbs { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-wrap: wrap; gap: 14px 10px; padding: 12px; align-content: flex-start; }
figure { position: relative; margin: 0; display: flex; flex-direction: column; align-items: center; padding-top: 15px; cursor: zoom-in; }
figure :deep(.th) { outline: 2px solid var(--c); outline-offset: 1px; transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1); }
figure:hover :deep(.th) { transform: translateY(-3px); }
.zoom { position: absolute; right: 4px; top: 22px; display: grid; place-items: center; width: 24px; height: 24px; border-radius: 8px; opacity: 0; transition: opacity 0.15s; background: var(--solid); color: var(--ink); box-shadow: 0 1px 6px rgba(0, 0, 0, 0.3); }
figure:hover .zoom { opacity: 1; }
figcaption { margin-top: 4px; font-size: 11.5px; color: var(--ink-soft); }
.tag { position: absolute; top: 0; left: 0; font-size: 11px; font-weight: 700; color: var(--c); white-space: nowrap; }
.more { width: 100%; margin: 0; text-align: center; font-size: 12px; color: var(--ink-soft); }
</style>
