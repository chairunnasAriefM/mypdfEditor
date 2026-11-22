//go:build windows

package main

import (
	"os/exec"
	"syscall"
	"unsafe"
)

var (
	user32              = syscall.NewLazyDLL("user32.dll")
	procMonitorFromPt   = user32.NewProc("MonitorFromPoint")
	procGetMonitorInfoW = user32.NewProc("GetMonitorInfoW")
	procGetDpiForSystem = user32.NewProc("GetDpiForSystem")
	procFindWindowW     = user32.NewProc("FindWindowW")
	procSetWindowLongW  = user32.NewProc("SetWindowLongPtrW")
	procSetWindowPos    = user32.NewProc("SetWindowPos")
	procDwmSetAttr      = syscall.NewLazyDLL("dwmapi.dll").NewProc("DwmSetWindowAttribute")
)

// forcePopupStyle membuang caption/thick frame sehingga jendela bisa sangat kecil.
func forcePopupStyle(title string) {
	cls, _ := syscall.UTF16PtrFromString("wailsWindow")
	ttl, _ := syscall.UTF16PtrFromString(title)
	hwnd, _, _ := procFindWindowW.Call(uintptr(unsafe.Pointer(cls)), uintptr(unsafe.Pointer(ttl)))
	if hwnd == 0 {
		return
	}
	const (
		gwlStyle    = ^uintptr(15) // -16
		wsPopup     = 0x80000000
		wsVisible   = 0x10000000
		wsMinimize  = 0x00020000
		swpFlags    = 0x0001 | 0x0002 | 0x0004 | 0x0010 | 0x0020 // NOSIZE|NOMOVE|NOZORDER|NOACTIVATE|FRAMECHANGED
	)
	// Matikan bayangan/bingkai DWM dan sudut membulat Windows 11 agar tidak ada kotak di sekitar bulatan.
	policy, corner := uint32(1), uint32(1) // DWMNCRP_DISABLED, DWMWCP_DONOTROUND
	procDwmSetAttr.Call(hwnd, 2, uintptr(unsafe.Pointer(&policy)), 4)  // DWMWA_NCRENDERING_POLICY
	procDwmSetAttr.Call(hwnd, 33, uintptr(unsafe.Pointer(&corner)), 4) // DWMWA_WINDOW_CORNER_PREFERENCE
	procSetWindowLongW.Call(hwnd, gwlStyle, uintptr(wsPopup|wsVisible|wsMinimize))
	procSetWindowPos.Call(hwnd, 0, 0, 0, 0, 0, swpFlags)
}

type rect struct{ Left, Top, Right, Bottom int32 }

type monitorInfo struct {
	Size    uint32
	Monitor rect
	Work    rect
	Flags   uint32
}

// dpiScale mengembalikan faktor skala DPI sistem (1.0 = 96 dpi).
func dpiScale() float64 {
	if procGetDpiForSystem.Find() != nil {
		return 1.0
	}
	dpi, _, _ := procGetDpiForSystem.Call()
	if dpi == 0 {
		return 1.0
	}
	return float64(dpi) / 96.0
}

// workArea mengembalikan area kerja monitor (tanpa taskbar) yang memuat titik x,y.
func workArea(x, y int) (left, top, right, bottom int, ok bool) {
	pt := uintptr(uint32(int32(x))) | uintptr(uint32(int32(y)))<<32
	hMon, _, _ := procMonitorFromPt.Call(pt, 2) // MONITOR_DEFAULTTONEAREST
	if hMon == 0 {
		return
	}
	mi := monitorInfo{Size: uint32(unsafe.Sizeof(monitorInfo{}))}
	r, _, _ := procGetMonitorInfoW.Call(hMon, uintptr(unsafe.Pointer(&mi)))
	if r == 0 {
		return
	}
	return int(mi.Work.Left), int(mi.Work.Top), int(mi.Work.Right), int(mi.Work.Bottom), true
}

func revealInExplorer(path string) error {
	cmd := exec.Command("explorer.exe")
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CmdLine:    `explorer.exe /select,"` + path + `"`,
		HideWindow: false,
	}
	return cmd.Start()
}
