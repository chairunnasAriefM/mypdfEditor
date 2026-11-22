import { computed, inject, ref, watch } from 'vue'
import { PickFiles, StatFiles, PDFPageCount } from '../../wailsjs/go/main/App'

/** Logika bersama panel satu-PDF (Pisah, Putar, Resize). */
export function usePdfInput(props) {
  const setFiles = inject('setFiles')
  const notify = inject('notify')
  const pdf = computed(() => props.files.find((f) => f.ext === 'pdf') || null)
  const pageCount = ref(0)

  watch(pdf, async (f) => {
    pageCount.value = 0
    if (!f) return
    try { pageCount.value = await PDFPageCount(f.path) } catch (e) { notify('Gagal membaca PDF: ' + (e?.message || e)) }
  }, { immediate: true })

  async function pick() {
    const paths = await PickFiles(false, 'pdf')
    if (paths?.length) setFiles(await StatFiles(paths))
  }
  const reset = () => setFiles([])
  const name = (p) => p.split(/[\\/]/).pop()
  return { pdf, pageCount, pick, reset, notify, name }
}
