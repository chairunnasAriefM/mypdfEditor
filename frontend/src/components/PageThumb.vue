<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({ doc: Object, page: { type: Number, default: 1 }, w: Number, h: Number })
const el = ref(null)
const cv = ref(null)
const visible = ref(false)
let task = null
let token = 0
let io = null

async function render() {
  const t = ++token
  task?.cancel()
  if (!props.doc || !cv.value || !visible.value) return
  try {
    const pg = await props.doc.getPage(props.page)
    if (t !== token) return
    const v1 = pg.getViewport({ scale: 1 })
    const dpr = window.devicePixelRatio || 1
    const v = pg.getViewport({ scale: Math.min(props.w / v1.width, props.h / v1.height) * dpr })
    const c = cv.value
    c.width = Math.ceil(v.width); c.height = Math.ceil(v.height)
    c.style.width = c.width / dpr + 'px'; c.style.height = c.height / dpr + 'px'
    task = pg.render({ canvasContext: c.getContext('2d'), viewport: v })
    await task.promise
  } catch { /* dibatalkan */ }
}

watch(() => [props.doc, props.page, props.w, props.h], render)
onMounted(() => {
  // Render hanya saat terlihat, agar ratusan halaman tetap ringan.
  io = new IntersectionObserver(([e]) => {
    if (e.isIntersecting && !visible.value) { visible.value = true; render() }
  }, { rootMargin: '300px' })
  io.observe(el.value)
})
onBeforeUnmount(() => { token++; task?.cancel(); io?.disconnect() })
</script>

<template>
  <span ref="el" class="th" :style="{ width: w + 'px', height: h + 'px' }">
    <canvas v-show="doc" ref="cv" />
  </span>
</template>

<style scoped>
.th { display: inline-grid; place-items: center; background: var(--tile); border-radius: 3px; }
canvas { background: #fff; box-shadow: 0 1px 6px rgba(0, 0, 0, 0.28); }
</style>
