import { ref, onMounted, onBeforeUnmount } from 'vue'

/** Ukuran konten sebuah elemen (reaktif), dipakai agar pratinjau ikut membesar di fullscreen. */
export function useBoxSize(elRef) {
  const w = ref(0)
  const h = ref(0)
  let ro
  onMounted(() => {
    ro = new ResizeObserver(([e]) => {
      w.value = Math.floor(e.contentRect.width)
      h.value = Math.floor(e.contentRect.height)
    })
    if (elRef.value) ro.observe(elRef.value)
  })
  onBeforeUnmount(() => ro?.disconnect())
  return { w, h }
}
