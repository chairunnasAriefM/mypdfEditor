import { ref, shallowRef, watch, onBeforeUnmount } from 'vue'
import { ReadFileB64 } from '../../wailsjs/go/main/App'
import { b64ToBytes } from './watermarkEngine'
import pdfjs from './pdfjs'

/** Memuat PDF terpilih sebagai dokumen pdfjs untuk pratinjau (dibebaskan saat ganti/tutup). */
export function usePdfDoc(fileRef) {
  const doc = shallowRef(null)
  const loading = ref(false)
  let token = 0

  watch(fileRef, async (f) => {
    const t = ++token
    doc.value?.destroy()
    doc.value = null
    if (!f) return
    loading.value = true
    try {
      const d = await pdfjs.getDocument({ data: b64ToBytes(await ReadFileB64(f.path)) }).promise
      if (t !== token) return d.destroy()
      doc.value = d
    } catch { /* pratinjau opsional */ } finally {
      if (t === token) loading.value = false
    }
  }, { immediate: true })

  onBeforeUnmount(() => { token++; doc.value?.destroy() })
  return { doc, loading }
}
