<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { ChevronLeft, ChevronRight, ArrowLeft } from 'lucide-vue-next'
import PageThumb from './PageThumb.vue'
import { useBoxSize } from '../utils/useBoxSize'

const props = defineProps({
  doc: Object, page: Number, title: String, sub: String,
  hasPrev: Boolean, hasNext: Boolean, closable: Boolean
})
const emit = defineEmits(['prev', 'next', 'close'])
const stage = ref(null)
const { w, h } = useBoxSize(stage)

function onKey(e) {
  if (e.key === 'ArrowLeft' && props.hasPrev) emit('prev')
  else if (e.key === 'ArrowRight' && props.hasNext) emit('next')
  else if (e.key === 'Escape' && props.closable) { e.stopImmediatePropagation(); emit('close') }
}
onMounted(() => window.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))
</script>

<template>
  <div class="viewer">
    <div class="vbar">
      <button v-if="closable" class="pbtn pghost" @click="emit('close')"><ArrowLeft :size="14" /> Daftar</button>
      <span class="vt"><b>{{ title }}</b><small v-if="sub">{{ sub }}</small></span>
      <span class="vp">
        <button class="pbtn pghost" :disabled="!hasPrev" aria-label="Sebelumnya" @click="emit('prev')"><ChevronLeft :size="15" /></button>
        <button class="pbtn pghost" :disabled="!hasNext" aria-label="Berikutnya" @click="emit('next')"><ChevronRight :size="15" /></button>
      </span>
    </div>
    <div ref="stage" class="vstage">
      <PageThumb :doc="doc" :page="page" :w="Math.max(100, w - 28)" :h="Math.max(100, h - 28)" />
    </div>
  </div>
</template>

<style scoped>
.viewer { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.vbar { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--line); }
.vbar .pbtn { padding: 5px 9px; font-size: 12.5px; }
.vt { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.25; }
.vt b { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vt small { font-size: 11.5px; color: var(--ink-soft); }
.vp { display: flex; gap: 4px; }
.vp .pbtn:disabled { opacity: 0.35; cursor: default; }
.vstage { flex: 1; min-height: 0; display: grid; place-items: center; overflow: hidden; }
</style>
