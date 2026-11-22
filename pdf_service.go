package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

func init() {
	// Portabel: jangan membuat folder konfigurasi pdfcpu di profil pengguna.
	api.DisableConfigDir()
}

func newConf() *model.Configuration {
	c := model.NewDefaultConfiguration()
	c.ValidationMode = model.ValidationRelaxed
	return c
}

// uniqueFile memberi nama unik "nama (2).ext" bila sudah ada, agar tidak menimpa apa pun.
func uniqueFile(dir, stem, ext string) string {
	out := filepath.Join(dir, stem+ext)
	for i := 2; ; i++ {
		if _, err := os.Stat(out); os.IsNotExist(err) {
			return out
		}
		out = filepath.Join(dir, fmt.Sprintf("%s (%d)%s", stem, i, ext))
	}
}

func outNear(src, suffix string) string {
	dir := filepath.Dir(src)
	stem := strings.TrimSuffix(filepath.Base(src), filepath.Ext(src))
	return uniqueFile(dir, stem+suffix, ".pdf")
}

var rangeRe = regexp.MustCompile(`^(\d+)(?:\s*-\s*(\d+))?$`)

// parseRanges mengubah "1-3, 5, 8-10" menjadi ["1-3","5","8-10"] dan memvalidasinya.
func parseRanges(s string, total int) ([]string, error) {
	var out []string
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		m := rangeRe.FindStringSubmatch(part)
		if m == nil {
			return nil, fmt.Errorf("rentang tidak valid: %q", part)
		}
		a, _ := strconv.Atoi(m[1])
		b := a
		if m[2] != "" {
			b, _ = strconv.Atoi(m[2])
		}
		if a < 1 || b < a || b > total {
			return nil, fmt.Errorf("halaman %q di luar 1-%d", part, total)
		}
		if a == b {
			out = append(out, strconv.Itoa(a))
		} else {
			out = append(out, fmt.Sprintf("%d-%d", a, b))
		}
	}
	if len(out) == 0 {
		return nil, errors.New("rentang halaman masih kosong")
	}
	return out, nil
}

func parityPages(total, rem int) []string {
	var out []string
	for i := 1; i <= total; i++ {
		if i%2 == rem {
			out = append(out, strconv.Itoa(i))
		}
	}
	return out
}

// PDFPageCount mengembalikan jumlah halaman PDF.
func (a *App) PDFPageCount(path string) (int, error) {
	return api.PageCountFile(path)
}

// MergePDFs menggabungkan PDF sesuai urutan daftar, tanpa kehilangan kualitas.
func (a *App) MergePDFs(paths []string) (string, error) {
	if len(paths) < 2 {
		return "", errors.New("pilih minimal 2 file PDF")
	}
	out := outNear(paths[0], "_gabung")
	if err := api.MergeCreateFile(paths, out, false, newConf()); err != nil {
		return "", err
	}
	return out, nil
}

// ExtractPages mengekstrak rentang halaman ke 1 PDF baru.
func (a *App) ExtractPages(path, ranges string) (string, error) {
	total, err := api.PageCountFile(path)
	if err != nil {
		return "", err
	}
	sel, err := parseRanges(ranges, total)
	if err != nil {
		return "", err
	}
	out := outNear(path, "_ekstrak")
	if err := api.TrimFile(path, out, sel, newConf()); err != nil {
		return "", err
	}
	return out, nil
}

// SplitEvery memecah PDF per n halaman ke subfolder "namafile_split".
func (a *App) SplitEvery(path string, n int) (string, error) {
	if n < 1 {
		return "", errors.New("jumlah halaman per file minimal 1")
	}
	dir := filepath.Dir(path)
	stem := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	outDir := filepath.Join(dir, stem+"_split")
	for i := 2; ; i++ {
		if _, err := os.Stat(outDir); os.IsNotExist(err) {
			break
		}
		outDir = filepath.Join(dir, fmt.Sprintf("%s_split (%d)", stem, i))
	}
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return "", err
	}
	if err := api.SplitFile(path, outDir, n, newConf()); err != nil {
		return "", err
	}
	return outDir, nil
}

// RotatePages memutar halaman (metadata saja, lossless).
// angle: 90 (kanan), 180, 270 (kiri). target: all | odd | even | range.
func (a *App) RotatePages(path string, angle int, target, ranges string) (string, error) {
	if angle != 90 && angle != 180 && angle != 270 {
		return "", errors.New("sudut harus 90, 180, atau 270")
	}
	var sel []string // nil = semua halaman
	switch target {
	case "all":
	case "odd", "even", "range":
		total, err := api.PageCountFile(path)
		if err != nil {
			return "", err
		}
		switch target {
		case "odd":
			sel = parityPages(total, 1)
		case "even":
			sel = parityPages(total, 0)
		default:
			if sel, err = parseRanges(ranges, total); err != nil {
				return "", err
			}
		}
		if len(sel) == 0 {
			return "", errors.New("tidak ada halaman yang cocok")
		}
	default:
		return "", errors.New("target halaman tidak dikenal")
	}
	out := outNear(path, "_putar")
	if err := api.RotateFile(path, out, angle, sel, newConf()); err != nil {
		return "", err
	}
	return out, nil
}

var paperPoints = map[string][2]int{
	"A3": {842, 1191}, "A4": {595, 842}, "A5": {420, 595},
	"F4": {612, 936}, "Letter": {612, 792}, "Legal": {612, 1008},
}

// ResizePages mengubah dimensi halaman secara vektor. preset: A4/A3/A5/F4/Letter/Legal
// atau "scale" (pakai persen, 10-400). Rasio konten dipertahankan.
func (a *App) ResizePages(path, preset string, percent float64) (string, error) {
	var cfg, suffix string
	if preset == "scale" {
		if percent < 10 || percent > 400 {
			return "", errors.New("skala harus 10-400 persen")
		}
		cfg = fmt.Sprintf("scalefactor:%.4f", percent/100)
		suffix = fmt.Sprintf("_skala%d", int(percent+0.5))
	} else {
		d, ok := paperPoints[preset]
		if !ok {
			return "", errors.New("ukuran kertas tidak dikenal")
		}
		cfg = fmt.Sprintf("dimensions:%d %d, enforce:off", d[0], d[1]) // orientasi mengikuti halaman asli
		suffix = "_" + preset
	}
	rc, err := pdfcpu.ParseResizeConfig(cfg, types.POINTS)
	if err != nil {
		return "", err
	}
	out := outNear(path, suffix)
	if err := api.ResizeFile(path, out, nil, rc, newConf()); err != nil {
		return "", err
	}
	return out, nil
}
