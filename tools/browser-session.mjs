import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

/** Isolated Chrome/CDP session; profiles and reports live under the caller's temp directory. */
export async function openBrowser({ output, errors = [], messages = [] }) {
  fs.mkdirSync(output, { recursive: true })
  const child = spawn(process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new',
    '--enable-unsafe-webgpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    `--user-data-dir=${path.join(output, `profile-${Date.now()}`)}`,
    'about:blank',
  ], {
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let socket
  const pending = new Map()
  const close = () => {
    for (const request of pending.values()) {
      clearTimeout(request.timeout)
      request.reject(new Error('Browser closed'))
    }
    pending.clear()
    socket?.close()
    child.kill()
  }
  try {
    const endpoint = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Chrome startup timeout')), 30000)
      let log = ''
      child.once('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      child.stderr.on('data', (data) => {
        log += data.toString()
        const match = log.match(/DevTools listening on (ws:\/\/\S+)/)
        if (match) {
          clearTimeout(timeout)
          resolve(match[1])
        }
      })
    })
    const browser = new URL(endpoint)
    const target = await (await fetch(`http://${browser.host}/json/new?about:blank`, { method: 'PUT' })).json()
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      socket.onopen = resolve
      socket.onerror = reject
    })
    let nextId = 0
    const urls = new Map()
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.id) {
        const request = pending.get(message.id)
        if (!request)
          return
        pending.delete(message.id)
        clearTimeout(request.timeout)
        if (message.error)
          request.reject(new Error(JSON.stringify(message.error)))
        else
          request.resolve(message.result)
      }
      else if (message.method === 'Runtime.exceptionThrown') {
        errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
      }
      else if (message.method === 'Runtime.consoleAPICalled') {
        const text = message.params.args.map(arg => arg.value ?? arg.description ?? '').join(' ')
        messages.push({ type: message.params.type, text, stackTrace: message.params.stackTrace })
        const renderingWarning = message.params.type === 'warning'
          && (text.includes('THREE.TSL:') || (text.startsWith('THREE.') && /deprecated|has been renamed/i.test(text)))
        if (message.params.type === 'error' || renderingWarning)
          errors.push(text)
      }
      else if (message.method === 'Network.requestWillBeSent') {
        urls.set(message.params.requestId, message.params.request.url)
      }
      else if (message.method === 'Network.loadingFailed') {
        messages.push({
          type: 'network',
          url: urls.get(message.params.requestId),
          error: message.params.errorText,
        })
      }
    }
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId
      const timeout = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`${method} timeout`))
      }, 120000)
      pending.set(id, { resolve, reject, timeout })
      socket.send(JSON.stringify({ id, method, params }))
    })
    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (result.exceptionDetails)
        throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
      return result.result.value
    }
    await send('Runtime.enable')
    await send('Page.enable')
    await send('Network.enable')
    const navigate = async (url) => {
      let listener
      let timeout
      const loaded = new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Page load timeout')), 120000)
        listener = (event) => {
          if (JSON.parse(event.data).method === 'Page.loadEventFired')
            resolve()
        }
        socket.addEventListener('message', listener)
      })
      try {
        await Promise.all([
          send('Page.navigate', { url }),
          loaded,
        ])
      }
      finally {
        clearTimeout(timeout)
        socket.removeEventListener('message', listener)
      }
    }
    const frames = count => evaluate(`new Promise(resolve => { let n=${count}; function tick(){ if(--n<=0) resolve(true); else requestAnimationFrame(tick); } requestAnimationFrame(tick); })`)
    return {
      socket,
      send,
      evaluate,
      navigate,
      frames,
      errors,
      messages,
      close,
    }
  }
  catch (error) {
    close()
    throw error
  }
}
