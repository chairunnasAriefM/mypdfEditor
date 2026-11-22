import { processTask } from './mrcTask'

self.onmessage = async (e) => {
  const { id, msg } = e.data
  try {
    const res = await processTask(msg)
    const transfer = []
    for (const v of [res.data, res.bg, res.mask, res.fg?.jpg]) if (v?.buffer) transfer.push(v.buffer)
    self.postMessage({ id, res }, transfer)
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) })
  }
}
