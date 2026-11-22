//go:build !windows

package main

// Stub agar proyek tetap bisa dikompilasi di OS non-Windows (hanya untuk dev).
func dpiScale() float64                                                { return 1.0 }
func workArea(x, y int) (left, top, right, bottom int, ok bool)       { return }
func revealInExplorer(path string) error                              { return nil }
func forcePopupStyle(title string) {}
