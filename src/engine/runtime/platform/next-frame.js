/** Yield to the browser without making cancellation depend on a visible tab. */
export function nextFrame(signal) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    let id
    const onAbort = () => {
      cancelAnimationFrame(id)
      reject(signal.reason)
    }
    id = requestAnimationFrame((time) => {
      signal?.removeEventListener('abort', onAbort)
      resolve(time)
    })
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
