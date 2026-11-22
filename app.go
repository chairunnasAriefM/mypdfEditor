package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Ukuran jendela OS per state (piksel logis).
var windowSizes = map[string][2]int{
	"bubble": {76, 76},
	"menu":   {380, 520},
	"studio": {760, 540},
}

type App struct {
	ctx   context.Context
	state string
	// Koordinat jendela saat masih berupa bulatan; dipulihkan saat kembali ke bulat.
	origX, origY int
	// Posisi sebelum fullscreen.
	preX, preY int
}

func NewApp() *App { return &App{state: "bubble"} }

func (a *App) startup(ctx context.Context) { a.ctx = ctx }

// domReady mengubah gaya jendela menjadi popup polos agar bisa sekecil 76x76
// (jendela berjudul dipaksa Windows minimal ~133px lebarnya).
func (a *App) domReady(ctx context.Context) {
	forcePopupStyle("PDF Bubble")
	runtime.WindowSetSize(ctx, 76, 76)
	// Terapkan ulang setelah jendela benar-benar tampil, agar bilah judul hilang.
	go func() {
		time.Sleep(400 * time.Millisecond)
		forcePopupStyle("PDF Bubble")
		runtime.WindowSetSize(ctx, 76, 76)
	}()
}

// placeClamped meletakkan jendela pada ukuran tertentu dan menggeser ke dalam
// bila akan terpotong di tepi kanan/bawah monitor.
func (a *App) placeClamped(x, y int, size [2]int) {
	scale := dpiScale()
	wpx := int(float64(size[0]) * scale)
	hpx := int(float64(size[1]) * scale)

	if left, top, right, bottom, ok := workArea(x, y); ok {
		if x+wpx > right {
			x = right - wpx
		}
		if y+hpx > bottom {
			y = bottom - hpx
		}
		if x < left {
			x = left
		}
		if y < top {
			y = top
		}
	}
	runtime.WindowSetPosition(a.ctx, x, y)
	runtime.WindowSetSize(a.ctx, size[0], size[1])
}

// SetWindowState mengubah ukuran jendela OS ke state tertentu.
func (a *App) SetWindowState(state string) {
	size, ok := windowSizes[state]
	if !ok {
		return
	}
	if a.state == "full" { // pengaman: keluar dari fullscreen dulu
		a.placeClamped(a.preX, a.preY, windowSizes["menu"])
		a.state = "menu"
	}
	if state == a.state {
		return
	}

	if state == "bubble" {
		runtime.WindowSetSize(a.ctx, size[0], size[1])
		runtime.WindowSetPosition(a.ctx, a.origX, a.origY)
		a.state = state
		return
	}

	x, y := runtime.WindowGetPosition(a.ctx)
	if a.state == "bubble" {
		a.origX, a.origY = x, y
	}
	a.placeClamped(x, y, size)
	a.state = state
}

// SetFullscreen memenuhi area kerja monitor (taskbar tetap terlihat) atau
// mengembalikan jendela ke ukuran state ("menu"/"studio") di posisi semula.
func (a *App) SetFullscreen(on bool, state string) {
	if on {
		if a.state == "full" || a.state == "bubble" {
			return
		}
		a.preX, a.preY = runtime.WindowGetPosition(a.ctx)
		left, top, right, bottom, ok := workArea(a.preX, a.preY)
		if !ok {
			runtime.WindowMaximise(a.ctx)
			a.state = "full"
			return
		}
		scale := dpiScale()
		runtime.WindowSetPosition(a.ctx, left, top)
		runtime.WindowSetSize(a.ctx, int(float64(right-left)/scale), int(float64(bottom-top)/scale))
		a.state = "full"
		return
	}
	if a.state != "full" {
		return
	}
	size, ok := windowSizes[state]
	if !ok {
		state, size = "menu", windowSizes["menu"]
	}
	runtime.WindowUnmaximise(a.ctx)
	a.placeClamped(a.preX, a.preY, size)
	a.state = state
}

// PickFiles membuka dialog pilih file bawaan Windows.
func (a *App) PickFiles(multi bool, kind string) ([]string, error) {
	pattern, label := "*.pdf", "Dokumen PDF"
	if kind == "image" {
		pattern, label = "*.png;*.jpg;*.jpeg;*.webp", "Gambar"
	} else if kind == "any" {
		pattern, label = "*.pdf;*.png;*.jpg;*.jpeg;*.webp", "PDF & Gambar"
	}
	opts := runtime.OpenDialogOptions{
		Title:   "Pilih file",
		Filters: []runtime.FileFilter{{DisplayName: label, Pattern: pattern}},
	}
	if multi {
		return runtime.OpenMultipleFilesDialog(a.ctx, opts)
	}
	p, err := runtime.OpenFileDialog(a.ctx, opts)
	if err != nil || p == "" {
		return nil, err
	}
	return []string{p}, nil
}

type FileInfo struct {
	Path   string  `json:"path"`
	Name   string  `json:"name"`
	SizeMB float64 `json:"sizeMB"`
	Ext    string  `json:"ext"`
}

// StatFiles mengembalikan nama, ekstensi, dan ukuran (MB) tiap path.
func (a *App) StatFiles(paths []string) []FileInfo {
	out := make([]FileInfo, 0, len(paths))
	for _, p := range paths {
		st, err := os.Stat(p)
		if err != nil || st.IsDir() {
			continue
		}
		out = append(out, FileInfo{
			Path:   p,
			Name:   filepath.Base(p),
			SizeMB: float64(st.Size()) / 1024 / 1024,
			Ext:    strings.ToLower(strings.TrimPrefix(filepath.Ext(p), ".")),
		})
	}
	return out
}

// RevealInExplorer membuka Explorer dengan file hasil terpilih.
func (a *App) RevealInExplorer(path string) error { return revealInExplorer(path) }

// Quit menutup aplikasi.
func (a *App) Quit() { runtime.Quit(a.ctx) }

// ReadFileB64 membaca file dan mengembalikannya sebagai base64 (untuk frontend).
func (a *App) ReadFileB64(path string) (string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(b), nil
}

// SaveOutput menyimpan hasil di folder yang sama dengan file asli, memakai
// akhiran deskriptif (mis. "_watermark"), tanpa menimpa file yang sudah ada.
func (a *App) SaveOutput(srcPath, suffix, dataB64 string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(dataB64)
	if err != nil {
		return "", err
	}
	dir := filepath.Dir(srcPath)
	name := strings.TrimSuffix(filepath.Base(srcPath), filepath.Ext(srcPath))
	out := filepath.Join(dir, name+suffix+".pdf")
	for i := 2; ; i++ {
		if _, err := os.Stat(out); os.IsNotExist(err) {
			break
		}
		out = filepath.Join(dir, fmt.Sprintf("%s%s (%d).pdf", name, suffix, i))
	}
	if err := os.WriteFile(out, data, 0o644); err != nil {
		return "", err
	}
	return out, nil
}
