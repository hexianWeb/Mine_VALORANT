/** 浏览器服务注入给 Engine；手动步进不需要 DOM。 */
export function createFrameDriver({ window = globalThis.window, document = window.document } = {}) {
  return {
    request: callback => window.requestAnimationFrame(callback),
    cancel: id => window.cancelAnimationFrame(id),
    onVisibility(callback) {
      const listener = () => callback(document.hidden)
      document.addEventListener('visibilitychange', listener)
      return () => document.removeEventListener('visibilitychange', listener)
    },
  }
}
