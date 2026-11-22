// Logo kustom. Taruh file di frontend/src/assets/logo/ :
//   bubble.(png|svg|webp|jpg)  -> logo di dalam bulatan melayang
//   app.(png|svg|webp|jpg)     -> logo merek di header dan sidebar
// Bila file tidak ada, tampilan bawaan dipakai. Diproses saat build, jadi tetap offline dan tertanam di .exe.
const first = (m) => Object.values(m)[0] || null

export const BUBBLE_LOGO = first(
  import.meta.glob('../assets/logo/bubble.{png,svg,webp,jpg,jpeg}', { eager: true, query: '?url', import: 'default' })
)
export const APP_LOGO = first(
  import.meta.glob('../assets/logo/app.{png,svg,webp,jpg,jpeg}', { eager: true, query: '?url', import: 'default' })
)
