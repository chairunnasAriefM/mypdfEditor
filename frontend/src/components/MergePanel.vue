<script setup>
import { ref, reactive, computed, watch, inject } from 'vue'
import { ArrowUp, ArrowDown, X, Plus, Loader2, Trash2 } from 'lucide-vue-next'
import { PickFiles, StatFiles, PDFPageCount, MergePDFs } from '../../wailsjs/go/main/App'
import { firstPageThumb } from '../utils/thumbs'
import { usePdfDoc } from '../utils/usePdfDoc'
import PageViewer from './PageViewer.vue'

const props = defineProps({ files: Array })
const setFiles = inject('setFiles')
const notify = inject('notify')
const counts = reactive({})
const thumbs = reactive({})
const busy = ref(false)
const sel = ref(0)
const mp = ref(1)

const items = computed(() => props.files.filter((f) => f.ext === 'pdf'))
const totalMB = computed(() => items.value.reduce((s, f) => s + f.sizeMB, 0))
const totalPages = computed(() => items.value.reduce((s, f) => s + (typeof counts[f.path] === 'number' ? counts[f.path] : 0), 0))
const selFile = computed(() => items.value[Math.min(sel.value, items.value.length - 1)] || null)
const { doc } = usePdfDoc(selFile)
const selCount = computed(() => (selFile.value && typeof counts[selFile.value.path] === 'number' ? counts[selFile.value.path] : 1))

watch(items, async (list) => {
  if (sel.value >= list.length) sel.value = Math.max(0, list.length - 1)
  for (const f of list) {
    if (counts[f.path] !== undefined) continue
    counts[f.path] = null
    try { counts[f.path] = await PDFPageCount(f.path) } catch { counts[f.path] = '?' }
    firstPageThumb(f.path, 44, 60).then((u) => { thumbs[f.path] = u })
  }
}, { immediate: true })
watch(selFile, () => { mp.value = 1 })

async function add() {
  const paths = await PickFiles(true, 'pdf')
  if (!paths?.length) return
  const have = new Set(items.value.map((f) => f.path))
  const fresh = (await StatFiles(paths)).filter((f) => !have.has(f.path))
  setFiles([...items.value, ...fresh])
}

function move(i, d) {
  const l = [...items.value]
  const j = i + d
  if (j < 0 || j >= l.length) return
  ;[l[i], l[j]] = [l[j], l[i]]
  if (sel.value === i) sel.value = j
  else if (sel.value === j) sel.value = i
  setFiles(l)
}
const remove = (i) => setFiles(items.value.filter((_, k) => k !== i))

async function run() {
  busy.value = true
  try {
    const out = await MergePDFs(items.value.map((f) => f.path))
    notify('Tersimpan: ' + out.split(/[\\/]/).pop(), out)
  } catch (e) {
    notify('Gagal: ' + (e?.message || e))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="pnl no-drag">
    <div class="ctl fill">
      <div class="bar">
        <button class="pbtn pghost" @click="add"><Plus :size="15" /> Tambah PDF</button>
        <button v-if="items.length" class="pbtn pghost" title="Kosongkan antrean" @click="setFiles([])"><Trash2 :size="14" /></button>
        <span v-if="items.length" class="sum">{{ items.length }} file • {{ totalPages }} hlm • {{ totalMB.toFixed(2) }} MB</span>
      </div>

      <ul v-if="items.length" class="list">
        <li v-for="(f, i) in items" :key="f.path" :class="{ on: selFile && selFile.path === f.path }" @click="sel = i">
          <span class="idx">{{ i + 1 }}</span>
          <span class="pic"><img v-if="thumbs[f.path]" :src="thumbs[f.path]" alt="" /></span>
          <div class="info">
            <span class="nm" :title="f.path">{{ f.name }}</span>
            <span class="meta">{{ f.sizeMB.toFixed(2) }} MB • {{ counts[f.path] ?? '…' }} hlm</span>
          </div>
          <button class="ib" :disabled="i === 0" aria-label="Naik" @click.stop="move(i, -1)"><ArrowUp :size="14" /></button>
          <button class="ib" :disabled="i === items.length - 1" aria-label="Turun" @click.stop="move(i, 1)"><ArrowDown :size="14" /></button>
          <button class="ib" aria-label="Hapus" @click.stop="remove(i)"><X :size="14" /></button>
        </li>
      </ul>
      <button v-else class="pdz" @click="add">
        <Plus :size="20" />
        <b>Seret beberapa PDF ke sini</b>
        <small>atau klik untuk memilih</small>
      </button>
    </div>

    <!-- Pratinjau besar hanya di fullscreen; di mode ringkas thumbnail ada di tiap baris. -->
    <div class="pvw fullonly">
      <PageViewer
        v-if="selFile"
        :doc="doc" :page="mp"
        :title="selFile.name" :sub="`Hal ${mp} / ${selCount} • file ke-${items.indexOf(selFile) + 1} dalam urutan`"
        :has-prev="mp > 1" :has-next="mp < selCount"
        @prev="mp--" @next="mp++"
      />
      <p v-else class="empty">Tambahkan PDF, lalu klik salah satu untuk melihat halamannya.</p>
    </div>

    <div class="act">
      <button class="pbtn pprim" :disabled="items.length < 2 || busy" @click="run">
        <Loader2 v-if="busy" :size="15" class="pspin" /> Gabung &amp; Simpan
      </button>
    </div>
  </div>
</template>

<style scoped>
.bar { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
.sum { margin-left: auto; font-size: 12px; color: var(--ink-soft); }
.list { flex: 1; min-height: 0; margin: 0 0 12px; padding: 0; list-style: none; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
.list li { display: flex; align-items: center; gap: 6px; padding: 7px 8px; border-radius: 12px; background: var(--tile); border: 1px solid var(--line); cursor: pointer; }
.list li.on { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.pic { width: 44px; height: 60px; flex-shrink: 0; display: grid; place-items: center; border-radius: 4px; background: var(--tile-hover); }
.pic img { max-width: 100%; max-height: 100%; box-shadow: 0 1px 5px rgba(0, 0, 0, 0.28); }
.idx { width: 20px; text-align: center; font-size: 12px; font-weight: 600; color: var(--accent); }
.info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.nm { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta { font-size: 11.5px; color: var(--ink-soft); }
.ib { width: 26px; height: 26px; display: grid; place-items: center; border: 0; border-radius: 8px; cursor: pointer; background: transparent; color: var(--ink-soft); }
.ib:hover:not(:disabled) { background: var(--tile-hover); color: var(--ink); }
.ib:disabled { opacity: 0.3; cursor: default; }
.empty { margin: auto; font-size: 12.5px; color: var(--ink-soft); }
</style>
