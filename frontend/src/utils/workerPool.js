import MrcWorker from './mrcWorker.js?worker'
import { processTask } from './mrcTask'

/** Kumpulan worker agar halaman diproses paralel di semua inti CPU. */
export function createPool() {
  const size = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1))
  let workers = []
  try {
    workers = Array.from({ length: size }, () => ({ w: new MrcWorker(), busy: false }))
  } catch {
    workers = [] // tanpa worker: proses di thread utama
  }
  const queue = []
  let nextId = 1

  function pump() {
    for (const slot of workers) {
      if (slot.busy || !queue.length) continue
      const job = queue.shift()
      slot.busy = true
      slot.w.onmessage = (e) => {
        slot.busy = false
        if (e.data.error) job.rej(new Error(e.data.error))
        else job.res(e.data.res)
        pump()
      }
      slot.w.onerror = (e) => { slot.busy = false; job.rej(new Error(e.message || 'Worker error')); pump() }
      slot.w.postMessage({ id: job.id, msg: job.msg }, job.transfer)
    }
  }

  return {
    size: workers.length || 1,
    gpuNote: typeof OffscreenCanvas !== 'undefined',
    run(msg, transfer = []) {
      if (!workers.length) return processTask(msg)
      return new Promise((res, rej) => { queue.push({ id: nextId++, msg, transfer, res, rej }); pump() })
    },
    destroy() { workers.forEach((s) => s.w.terminate()) }
  }
}
