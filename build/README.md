# Aset build

## Ikon aplikasi (.exe)
Ganti `appicon.png` dengan logo Anda.

- PNG persegi **1024×1024** (minimal 256×256), latar transparan disarankan.
- Wails membuat `build/windows/icon.ico` dari file ini saat `wails build`.
- Jika `build/windows/icon.ico` sudah pernah terbentuk dan ikon tidak berubah, hapus file `.ico` itu lalu build ulang.
- Atau taruh sendiri `build/windows/icon.ico` (multi-ukuran 16/32/48/256 px) untuk hasil paling tajam.
- Windows menyimpan cache ikon; bila ikon lama masih tampil, ganti nama `.exe` atau segarkan cache ikon.

Logo di dalam bulatan dan di header diatur di `frontend/src/assets/logo/`.
