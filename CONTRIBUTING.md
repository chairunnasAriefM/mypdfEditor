# Berkontribusi

Terima kasih sudah mau membantu PDF Bubble.

## Menjalankan untuk pengembangan
```
go mod tidy
cd frontend && npm install && cd ..
wails dev
```

## Struktur singkat
- `main.go`, `app.go`: jendela Wails, ukuran 3 state, fullscreen, dialog file.
- `pdf_service.go`: Gabung, Pisah, Putar, Resize (pdfcpu).
- `platform_windows.go`: pemanggilan Win32 (area kerja monitor, gaya jendela, DWM).
- `frontend/src/utils/`: mesin watermark (`watermarkEngine.js`) dan kompres (`compressEngine.js`, `mrcCore.js`).
- `frontend/src/components/`: panel tiap alat.

## Aturan
- Tidak ada CDN atau aset online. Semua dependensi frontend harus di-bundle lokal.
- Aplikasi tidak boleh meminta hak administrator atau menulis ke Program Files/Registry.
- Jangan menimpa file pengguna. Hasil selalu memakai akhiran deskriptif.
- Satu perubahan per pull request, sertakan screenshot untuk perubahan tampilan.
