# PDF Bubble

Utilitas PDF **melayang** untuk Windows, terinspirasi AssistiveTouch iPhone. Bulatan kecil selalu ada di atas layar; klik untuk membuka enam alat PDF. Berjalan **offline**, **portabel** (satu file `.exe`, tanpa installer), dan **tanpa hak administrator**.

> Status: beta. Dibangun dengan Go + [Wails v2](https://wails.io), Vue 3, Tailwind CSS, [pdfcpu](https://github.com/pdfcpu/pdfcpu), pdf-lib, dan pdf.js.

## Fitur

| Alat | Yang dilakukan |
|---|---|
| **Watermark** | Teks atau gambar/logo (mode satu warna otomatis menghapus latar putih), pola tunggal atau bata berulang, rotasi, dan "Pas ke halaman". Pratinjau langsung identik dengan hasil. |
| **Kompres MB** | Perkecil ke target ukuran dengan teks tetap terbaca (lihat di bawah). |
| **Resize kertas** | A4, A3, A5, F4, Letter, Legal, atau skala persen. Vektor, kualitas teks tidak turun. |
| **Gabung PDF** | Banyak PDF jadi satu, atur urutan, lengkap dengan thumbnail dan pratinjau halaman. |
| **Pisah PDF** | Ekstrak rentang halaman, atau pecah per N halaman ke subfolder `nama_split/`. |
| **Putar halaman** | 90° kanan/kiri atau 180°, untuk semua, ganjil, genap, atau rentang. Lossless. |

Semua alat punya pratinjau, mendukung seret-dan-lepas file, dan bisa dipakai dalam mode fullscreen dengan sidebar alat.

### Tiga ukuran jendela
- **Bulatan 76×76**: tahan lalu geser di mana saja untuk memindahkan, klik untuk membuka. Menampilkan progress saat ada proses berjalan. Seret 1 file ke bulatan untuk langsung membukanya, atau 2+ PDF untuk langsung ke Gabung PDF.
- **Menu 380×520** dan **Studio Watermark 760×540**: otomatis bergeser ke dalam bila hampir keluar layar.
- **Fullscreen**: tombol ⤢ di header, **Esc** untuk keluar.

## Kompres: cara kerjanya

Target ukuran diperlakukan sebagai batas keras, dengan prioritas **teks tetap terbaca**.

1. **Halaman teks vektor** (ekspor Word/Excel) dibiarkan vektor, jadi tetap tajam dan bisa disalin.
2. **Halaman scan** (misalnya hasil scan printer) dipisah menjadi lapisan (MRC): teks sebagai bitmap 1-bit tajam, warna teks, dan latar/foto yang dikecilkan.
3. **Mode Otomatis**: berwarna dulu, lalu hitam-putih, lalu semua halaman hitam-putih dengan resolusi makin rendah, sampai muat. Untuk file yang mustahil mencapai target, hasil terkecil yang masih terbaca tetap disimpan.
4. Pemrosesan berat berjalan paralel di semua inti CPU (Web Worker), render halaman memakai akselerasi GPU bila tersedia.

Catatan: pengodean JPEG dan kompresi Flate berjalan di CPU. Teks yang berada di atas foto atau teks putih di atas latar gelap hanya sebagian terdeteksi.

## Unduh dan jalankan

Ambil `PDFBubble.exe` dari halaman **Releases** atau dari artifact di tab **Actions**, lalu klik dua kali.

Kebutuhan: Windows 10/11 dengan **WebView2 Runtime** (sudah ada di Windows 11 dan Windows 10 terbaru). Build CI menyertakan bootstrapper WebView2 (`-webview2 embed`).

Hasil tidak pernah menimpa file asli:

```
dokumen_watermark.pdf   dokumen_kompres.pdf   dokumen_A4.pdf
dokumen_gabung.pdf      dokumen_ekstrak.pdf   dokumen_putar.pdf
dokumen_split/          (untuk pecah per N halaman)
```

## Membangun dari kode sumber

Prasyarat: Go 1.21+, Node 18+, Wails CLI.

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@v2.9.2

go mod tidy
cd frontend && npm install && cd ..

wails dev      # mode pengembangan
wails build    # hasil: build/bin/PDFBubble.exe
```

Rilis otomatis: push tag `v*` (misalnya `v1.0.0`) dan GitHub Actions membangun `.exe` lalu melampirkannya ke Release.

## Struktur proyek

```
main.go              konfigurasi jendela Wails (frameless, transparan, always-on-top, file drop)
app.go               binding Go-Vue: ukuran jendela, fullscreen, dialog file, simpan hasil
pdf_service.go       gabung / pisah / putar / resize (pdfcpu)
platform_windows.go  Win32: area kerja monitor, gaya jendela, DWM
frontend/src/
  App.vue            state jendela, sidebar, toast, bulatan progress
  components/        panel tiap alat + viewer halaman
  utils/             watermarkEngine, compressEngine, mrcCore, worker pool
```

## Lisensi

[MIT](LICENSE)
