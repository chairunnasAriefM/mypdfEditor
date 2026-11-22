<script setup>
import { ref, computed, markRaw, onMounted, provide, nextTick } from 'vue'
import {
  FileText, ArrowLeft, Sun, Moon, Minus, X,
  Stamp, FileDown, Scaling, Merge, Scissors, RotateCw, FolderOpen, Maximize2, Minimize2, House, Check
} from 'lucide-vue-next'
import { OnFileDrop, OnFileDropOff } from '../wailsjs/runtime/runtime'
import { SetWindowState, SetFullscreen, StatFiles, RevealInExplorer, Quit } from '../wailsjs/go/main/App'
import WatermarkStudio from './components/WatermarkStudio.vue'
import MergePanel from './components/MergePanel.vue'
import SplitPanel from './components/SplitPanel.vue'
import RotatePanel from './components/RotatePanel.vue'
import ResizePanel from './components/ResizePanel.vue'
import CompressPanel from './components/CompressPanel.vue'
import { job } from './utils/jobStore'
import { BUBBLE_LOGO, APP_LOGO } from './utils/logos'

const tools = [
  { id: 'watermark', label: 'Watermark', sub: 'Studio dengan pratinjau', icon: Stamp },
  { id: 'compress', label: 'Kompres MB', sub: 'Perkecil ke target MB', icon: FileDown },
  { id: 'resize', label: 'Resize kertas', sub: 'A4, F4, Letter', icon: Scaling },
  { id: 'merge', label: 'Gabung PDF', sub: 'Satukan banyak PDF', icon: Merge },
  { id: 'split', label: 'Pisah PDF', sub: 'Ekstrak atau pecah', icon: Scissors },
  { id: 'rotate', label: 'Putar halaman', sub: '90° atau 180°', icon: RotateCw }
]
const toolById = (id) => tools.find((t) => t.id === id)
const PANELS = {
  watermark: markRaw(WatermarkStudio), merge: markRaw(MergePanel), split: markRaw(SplitPanel),
  rotate: markRaw(RotatePanel), resize: markRaw(ResizePanel), compress: markRaw(CompressPanel)
}

// winState = ukuran jendela OS; cardState = bentuk visual kartu (dianimasikan CSS).
const winState = ref('bubble')
const cardState = ref('bubble')
const view = ref('grid') // 'grid' atau id alat
const files = ref([])
const dropEvent = ref(null) // drop yang diteruskan ke Watermark Studio
let dropSeq = 0
const dark = ref(false)
const isFull = ref(false)
const toast = ref(null)
let busy = false
let toastTimer = null

const rank = { bubble: 0, menu: 1, studio: 2 }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function go(next) {
  if (busy || next === winState.value) return
  busy = true
  try {
    if (rank[next] > rank[winState.value]) {
      // Membesar: ubah jendela dulu, lalu kartu mengembang dengan pegas.
      await SetWindowState(next)
      winState.value = next
      await nextTick()
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      cardState.value = next
      job.finished = false
      armToast()
    } else {
      // Mengecil: kartu mengerut dulu, baru jendela OS diperkecil.
      if (next === 'bubble') job.finished = false // hasil yang sudah terlihat tidak perlu tanda selesai
      cardState.value = next
      await sleep(340)
      await SetWindowState(next)
      winState.value = next
    }
  } finally {
    busy = false
  }
}

function currentExpanded() {
  return view.value === 'watermark' ? 'studio' : 'menu'
}

function openFromBubble() { go(currentExpanded()) }
async function collapse() {
  if (isFull.value) await toggleFull()
  go('bubble')
}

// Fullscreen: jendela memenuhi area kerja, kartu mengembang dengan pegas.
async function toggleFull() {
  if (busy || winState.value === 'bubble') return
  busy = true
  try {
    if (!isFull.value) {
      await SetFullscreen(true, '')
      isFull.value = true
      await nextTick()
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      cardState.value = 'full'
    } else {
      const target = currentExpanded()
      cardState.value = target
      await sleep(340)
      await SetFullscreen(false, target)
      winState.value = target
      isFull.value = false
    }
  } finally {
    busy = false
  }
}

// Bulatan: tahan lalu geser di mana pun = pindahkan jendela; klik singkat = buka menu.
let press = null
function bubbleDown(e) {
  if (e.button !== 0) return
  press = { x: e.screenX, y: e.screenY }
  window.addEventListener('mousemove', bubbleMove)
  window.addEventListener('mouseup', bubbleUp)
}
function bubbleCleanup() {
  window.removeEventListener('mousemove', bubbleMove)
  window.removeEventListener('mouseup', bubbleUp)
  press = null
}
function bubbleMove(e) {
  if (!press) return
  if (e.buttons !== 1) return bubbleCleanup()
  if (Math.hypot(e.screenX - press.x, e.screenY - press.y) > 4) {
    bubbleCleanup()
    window.WailsInvoke('drag') // geser native Windows, tanpa lag
  }
}
function bubbleUp() {
  bubbleCleanup()
  openFromBubble()
}

function openTool(id) {
  view.value = id
  if (!isFull.value) go(id === 'watermark' ? 'studio' : 'menu')
}
function backToGrid() {
  view.value = 'grid'
  if (!isFull.value) go('menu')
}

function toggleTheme() {
  dark.value = !dark.value
  document.documentElement.classList.toggle('dark', dark.value)
  try { localStorage.setItem('pdfbubble:theme', dark.value ? 'dark' : 'light') } catch {}
}

function armToast() {
  clearTimeout(toastTimer)
  if (toast.value) toastTimer = setTimeout(() => (toast.value = null), 8000)
}
function notify(text, path = null) {
  toast.value = { text, path }
  // Saat jadi bulatan, toast ditahan sampai menu dibuka lagi.
  if (winState.value === 'bubble') clearTimeout(toastTimer)
  else armToast()
}
provide('notify', notify)
provide('files', files)
provide('setFiles', (list) => { files.value = list })

const SUPPORTED = ['pdf', 'png', 'jpg', 'jpeg', 'webp']

async function onDrop(paths) {
  const infos = (await StatFiles(paths)).filter((f) => SUPPORTED.includes(f.ext))
  if (!infos.length) return
  const pdfs = infos.filter((f) => f.ext === 'pdf')

  // Di studio watermark, drop ditangani studio (PDF/gambar utama atau logo).
  if (winState.value !== 'bubble' && view.value === 'watermark') {
    dropEvent.value = { id: ++dropSeq, files: infos }
    return
  }

  // Di panel Gabung PDF, drop menambah ke antrean (tanpa duplikat).
  if (winState.value !== 'bubble' && view.value === 'merge') {
    const have = new Set(files.value.map((f) => f.path))
    files.value = [...files.value, ...pdfs.filter((f) => !have.has(f.path))]
    return
  }

  if (pdfs.length >= 2 && (winState.value === 'bubble' || view.value === 'grid')) {
    files.value = pdfs
    view.value = 'merge'
    await go('menu')
    return
  }
  if (winState.value === 'bubble') {
    files.value = [infos[0]]
    await go(currentExpanded())
  } else {
    files.value = view.value === 'merge' ? [...files.value, ...infos] : [infos[0]]
  }
}

function addFiles(list) {
  files.value = view.value === 'merge' ? [...files.value, ...list] : list.slice(0, 1)
}

async function openResultFolder() {
  if (toast.value?.path) await RevealInExplorer(toast.value.path)
}

onMounted(() => {
  try {
    if (localStorage.getItem('pdfbubble:theme') === 'dark') {
      dark.value = true
      document.documentElement.classList.add('dark')
    }
  } catch {}
  OnFileDrop((_x, _y, paths) => onDrop(paths), false)
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isFull.value) toggleFull() })
})

const panelProps = computed(() => (view.value === 'watermark' ? { files: files.value, drop: dropEvent.value } : { files: files.value }))
const fullLayout = computed(() => cardState.value === 'full')
const title = computed(() => (view.value === 'grid' ? 'PDF Bubble' : toolById(view.value)?.label))
</script>

<template>
  <!-- State 1: bubble. Cincin luar menggeser jendela, inti membuka menu. -->
  <div v-if="winState === 'bubble'" class="bubble-root" @mousedown="bubbleDown">
    <div class="ring" :class="{ busy: job.active, done: job.finished && !job.active }" :style="{ '--p': job.pct }">
      <button
        class="core"
        :class="{ 'has-logo': BUBBLE_LOGO && !job.active && !job.finished }"
        :title="job.active ? job.label : ''"
        aria-label="Buka PDF Bubble"
        @keydown.enter.prevent="openFromBubble"
      >
        <span v-if="job.active" class="pct">{{ Math.round(job.pct) }}</span>
        <Check v-else-if="job.finished" :size="24" :stroke-width="2.4" />
        <img v-else-if="BUBBLE_LOGO" :src="BUBBLE_LOGO" class="logo" alt="" draggable="false" />
        <FileText v-else :size="24" :stroke-width="1.8" />
      </button>
    </div>
  </div>

  <!-- State 2 dan 3: kartu yang mengembang dari bulatan. -->
  <!-- Kartu tetap terpasang (hanya disembunyikan) agar proses kompres tidak berhenti saat jadi bulatan. -->
  <div v-show="winState !== 'bubble'" class="card" :data-s="cardState">
    <div class="content" :class="{ show: cardState !== 'bubble' }">
      <header class="bar drag">
        <button v-if="view !== 'grid' && !fullLayout" class="ibtn no-drag" aria-label="Kembali" @click="backToGrid">
          <ArrowLeft :size="16" />
        </button>
        <img v-if="APP_LOGO && (view === 'grid' || fullLayout)" :src="APP_LOGO" class="brand" alt="" draggable="false" />
        <span class="title">{{ title }}</span>
        <span class="flex-1" />
        <button class="ibtn no-drag" :aria-label="dark ? 'Tema terang' : 'Tema gelap'" @click="toggleTheme">
          <Sun v-if="dark" :size="16" /><Moon v-else :size="16" />
        </button>
        <button class="ibtn no-drag" :aria-label="isFull ? 'Keluar fullscreen' : 'Fullscreen'" @click="toggleFull">
          <Minimize2 v-if="isFull" :size="16" /><Maximize2 v-else :size="16" />
        </button>
        <button class="ibtn no-drag" aria-label="Kecilkan ke bulatan" @click="collapse">
          <Minus :size="16" />
        </button>
        <button class="ibtn no-drag" aria-label="Tutup aplikasi" @click="Quit()">
          <X :size="16" />
        </button>
      </header>

      <main class="body" :class="{ wide: fullLayout }">
        <nav v-if="fullLayout" class="side no-drag">
          <div v-if="APP_LOGO" class="sbrand"><img :src="APP_LOGO" alt="" draggable="false" /><b>PDF Bubble</b></div>
          <button class="sitem" :class="{ on: view === 'grid' }" @click="backToGrid">
            <House :size="18" :stroke-width="1.8" /><span>Beranda</span>
          </button>
          <span class="slabel">Alat</span>
          <button v-for="t in tools" :key="t.id" class="sitem" :class="{ on: view === t.id }" @click="openTool(t.id)">
            <component :is="t.icon" :size="18" :stroke-width="1.8" />
            <span>{{ t.label }}<small>{{ t.sub }}</small></span>
          </button>
          <span class="grow" />
          <p class="shint">Seret file ke jendela untuk membuka.<br />Esc untuk keluar fullscreen.</p>
        </nav>

        <div class="main">
          <div v-if="view === 'grid'" class="grid no-drag">
            <button v-for="t in tools" :key="t.id" class="tile" @click="openTool(t.id)">
              <component :is="t.icon" :size="26" :stroke-width="1.7" style="color: var(--accent)" />
              <span class="tl">{{ t.label }}</span>
              <span class="ts">{{ t.sub }}</span>
            </button>
          </div>
          <KeepAlive v-else>
            <component :is="PANELS[view]" :key="view" v-bind="panelProps" @files="addFiles" />
          </KeepAlive>
        </div>
      </main>

      <Transition name="toast">
        <div v-if="toast" class="toast no-drag">
          <span class="truncate">{{ toast.text }}</span>
          <button v-if="toast.path" class="toast-btn" @click="openResultFolder">
            <FolderOpen :size="14" /> Buka folder hasil
          </button>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.bubble-root { position: absolute; inset: 0; cursor: grab; }
/* Bubble: jendela 76x76, visual 64x64 + margin 6px untuk bayangan. */
.ring {
  position: absolute; left: 6px; top: 6px;
  width: 64px; height: 64px; box-sizing: border-box; padding: 10px;
  border-radius: 50%;
  background: var(--glass);
  /* bayangan kecil agar muat di margin 6px dan tidak terpotong tepi jendela (jadi "kotak") */
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35), inset 0 0 0 1px var(--glass-edge);
  cursor: grab; pointer-events: none;
}
.core {
  width: 44px; height: 44px; border: 0; border-radius: 50%; cursor: pointer;
  display: grid; place-items: center;
  background: var(--accent); color: var(--accent-ink);
  transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.core:hover { transform: scale(1.08); }
.core.has-logo { background: transparent; padding: 0; overflow: hidden; }
.core .logo { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; display: block; pointer-events: none; }
.brand { width: 22px; height: 22px; margin-left: 4px; border-radius: 6px; object-fit: cover; pointer-events: none; }
.sbrand { display: flex; align-items: center; gap: 10px; padding: 4px 8px 12px; font-size: 15px; }
.sbrand img { width: 28px; height: 28px; border-radius: 8px; object-fit: cover; }
.pct { font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; }
/* Progress melingkar pada cincin bulatan saat memproses */
.ring.busy { background: conic-gradient(var(--accent) calc(var(--p) * 1%), var(--tile-hover, rgba(128,128,128,.35)) 0); }
.ring.done .core { background: #2fa37a; color: #fff; animation: pop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1); }
@keyframes pop { from { transform: scale(0.7); } to { transform: scale(1); } }
.core:active { transform: scale(0.94); }

/* Kartu: tumbuh dari bulatan dengan kurva pegas. */
.card {
  position: absolute; left: 6px; top: 6px; overflow: hidden;
  background: var(--glass);
  box-shadow: var(--shadow), inset 0 0 0 1px var(--glass-edge);
  transition:
    width 0.5s cubic-bezier(0.34, 1.56, 0.64, 1),
    height 0.5s cubic-bezier(0.34, 1.56, 0.64, 1),
    left 0.4s ease, top 0.4s ease,
    border-radius 0.4s ease;
}
.card[data-s='bubble'] { width: 64px; height: 64px; border-radius: 32px; }
.card[data-s='menu'] { width: 368px; height: 508px; border-radius: 26px; }
.card[data-s='studio'] { width: 748px; height: 528px; border-radius: 26px; }
.card[data-s='full'] { left: 0; top: 0; width: 100vw; height: 100vh; border-radius: 0; background: var(--solid); box-shadow: none; }
.card[data-s='full'] .grid { grid-template-columns: repeat(3, minmax(0, 1fr)); grid-template-rows: none; grid-auto-rows: 168px; align-content: center; max-width: 900px; width: 100%; margin: 0 auto; padding: 24px; height: auto; }
.card[data-s='full'] .tl { font-size: 16px; }

.content {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  opacity: 0; transition: opacity 0.18s ease;
}
.content.show { opacity: 1; transition-delay: 0.12s; }

.bar { display: flex; align-items: center; gap: 4px; padding: 10px 12px 6px 14px; min-height: 40px; }
.title { font-size: 15px; font-weight: 600; letter-spacing: -0.01em; padding-left: 4px; }
.ibtn {
  width: 30px; height: 30px; border: 0; border-radius: 10px; cursor: pointer;
  display: grid; place-items: center; background: transparent; color: var(--ink-soft);
  transition: background 0.15s, color 0.15s;
}
.ibtn:hover { background: var(--tile); color: var(--ink); }
.ibtn:focus-visible, .tile:focus-visible, .core:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.body { flex: 1; min-height: 0; display: flex; }
.main { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.main > * { flex: 1; min-height: 0; }

/* Sidebar alat (fullscreen) */
.side { width: 232px; flex-shrink: 0; display: flex; flex-direction: column; gap: 4px; padding: 8px 12px 16px 16px; border-right: 1px solid var(--line); }
.sitem {
  display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 0; border-radius: 12px; cursor: pointer; text-align: left;
  font: inherit; font-size: 14px; font-weight: 600; background: transparent; color: var(--ink);
  transition: background 0.15s, transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.sitem small { display: block; font-size: 11.5px; font-weight: 400; color: var(--ink-soft); }
.sitem svg { color: var(--ink-soft); flex-shrink: 0; }
.sitem:hover { background: var(--tile); }
.sitem.on { background: var(--accent); color: var(--accent-ink); }
.sitem.on svg, .sitem.on small { color: inherit; opacity: 0.85; }
.slabel { margin: 12px 12px 4px; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-soft); }
.shint { margin: 0; padding: 0 8px; font-size: 11.5px; line-height: 1.5; color: var(--ink-soft); }
.grow { flex: 1; }
.grid {
  display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: repeat(3, 1fr);
  gap: 10px; height: 100%; box-sizing: border-box; padding: 8px 14px 16px;
}
.tile {
  display: flex; flex-direction: column; align-items: flex-start; justify-content: space-between;
  padding: 14px; border: 1px solid var(--line); border-radius: 18px; cursor: pointer; text-align: left;
  background: var(--tile); color: var(--ink);
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.15s;
}
.tile:hover { background: var(--tile-hover); transform: translateY(-2px); }
.tile:active { transform: scale(0.97); }
.tl { font-size: 14px; font-weight: 600; }
.ts { font-size: 12px; color: var(--ink-soft); margin-top: -8px; }

.toast {
  position: absolute; left: 12px; right: 12px; bottom: 12px;
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 10px 12px; border-radius: 14px; font-size: 13px;
  background: var(--ink); color: var(--glass);
}
.toast-btn {
  display: flex; align-items: center; gap: 6px; flex-shrink: 0; border: 0; cursor: pointer;
  padding: 6px 10px; border-radius: 10px; font-size: 12px; font-weight: 600;
  background: var(--accent); color: var(--accent-ink);
}
.toast-enter-active, .toast-leave-active { transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s; }
.toast-enter-from, .toast-leave-to { transform: translateY(16px); opacity: 0; }
</style>
