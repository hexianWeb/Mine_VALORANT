/** Decode + mip generation off the UI thread. Abort terminates the worker immediately. */
export async function decodeEXR(buffer, { maxMipLevel = 0, signal } = {}) {
  signal?.throwIfAborted()
  if (typeof Worker === 'undefined') {
    const { parseEXRData } = await import('./exr-data.js')
    signal?.throwIfAborted()
    return {
      ...parseEXRData(buffer, maxMipLevel),
      worker: false,
    }
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./exr-worker.js', import.meta.url), { type: 'module' })
    function cleanup() {
      signal?.removeEventListener('abort', onAbort)
      worker.terminate()
    }
    function fail(error) {
      cleanup()
      reject(error)
    }
    function onAbort() {
      fail(signal.reason)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    worker.onmessage = ({ data }) => {
      cleanup()
      if (data.error)
        reject(new Error(data.error))
      else
        resolve({ ...data.parsed, worker: true })
    }
    worker.onerror = event => fail(new Error(`EXR worker: ${event.message}`))
    worker.onmessageerror = () => fail(new Error('EXR worker returned unreadable data'))
    try {
      worker.postMessage({ buffer, maxMipLevel }, [buffer])
    }
    catch (error) {
      fail(error)
    }
  })
}
