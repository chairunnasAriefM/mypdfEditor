import { reactive } from 'vue'

/** Status pekerjaan berat (kompres/watermark) agar tetap terlihat di bulatan saat jendela diminimize. */
export const job = reactive({ active: false, pct: 0, label: '', finished: false })

export function jobStart(label = '') {
  job.active = true
  job.finished = false
  job.pct = 1
  job.label = label
}
export function jobProgress(pct, label) {
  job.pct = Math.max(job.pct, Math.min(100, pct || 0))
  if (label) job.label = label
}
export function jobEnd() {
  job.active = false
  job.finished = true
  job.pct = 100
}
