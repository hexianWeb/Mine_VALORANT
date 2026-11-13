import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'

export const defaultPreviewRoot = 'D:/opencode-temp/opencode/weapon-previews'
const prefix = '/__weapon_preview__/'
const contentTypes = { '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' }

function within(root, file) {
  const relative = path.relative(root, file)
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

/** Serve only candidate assets, only to loopback, without allowing arbitrary Vite /@fs access. */
export function candidateAssetMiddleware(root = defaultPreviewRoot) {
  return async (request, response, next) => {
    if (!request.url?.startsWith(prefix))
      return next()
    const fail = (status) => {
      response.statusCode = status
      response.end()
    }
    const address = request.socket.remoteAddress
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)
      || request.headers['sec-fetch-site'] === 'cross-site') {
      return fail(403)
    }
    if (!['GET', 'HEAD'].includes(request.method))
      return fail(405)
    try {
      const host = new URL(`http://${request.headers.host ?? 'localhost'}`).hostname
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(host))
        return fail(403)
      if (request.headers.origin) {
        const origin = new URL(request.headers.origin)
        if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname))
          return fail(403)
      }
      const relative = decodeURIComponent(request.url.split('?')[0].slice(prefix.length))
      const parts = relative.split('/')
      if (!/^candidate-[\w-]+$/.test(parts[0]) || parts.some(part => !part || part === '.' || part === '..' || /[\\:\0]/.test(part)))
        return fail(403)
      const type = contentTypes[path.extname(relative)]
      if (!type)
        return fail(403)
      const canonicalRoot = await realpath(root)
      const file = await realpath(path.resolve(root, ...parts))
      if (!within(canonicalRoot, file))
        return fail(403)
      const bytes = await readFile(file)
      response.setHeader('Content-Type', type)
      response.setHeader('Content-Length', bytes.length)
      response.setHeader('Cache-Control', 'no-store')
      response.setHeader('X-Content-Type-Options', 'nosniff')
      response.end(request.method === 'HEAD'
        ? undefined
        : bytes)
    }
    catch (error) {
      fail(error.code === 'ENOENT' || error.code === 'ENOTDIR'
        ? 404
        : 400)
    }
  }
}

export function weaponCandidatePlugin(root = defaultPreviewRoot) {
  return {
    name: 'weapon-candidate-assets',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(candidateAssetMiddleware(root))
    },
  }
}
