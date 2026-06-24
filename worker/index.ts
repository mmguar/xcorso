import type { Env } from './env'
import { getUser } from './auth'
import * as routes from './routes'

type Handler = (req: Request, env: Env, params: Record<string, string>) => Promise<Response>

// ponytail: per-IP for unauth, per-user for auth. KV atomic increment via get/put with short TTL.
const RATE_WINDOW = 60 // seconds
const RATE_LIMIT_WRITE = 30  // PUT/POST/DELETE per minute
const RATE_LIMIT_READ = 120  // GET per minute

async function checkRateLimit(env: Env, key: string, limit: number): Promise<boolean> {
  const kvKey = `ratelimit:${key}`
  const count = parseInt(await env.KV.get(kvKey) ?? '0')
  if (count >= limit) return false
  await env.KV.put(kvKey, String(count + 1), { expirationTtl: RATE_WINDOW })
  return true
}

const ROUTES: [string, string, Handler][] = [
  ['POST', '/api/auth/send', routes.authSend],
  ['POST', '/api/auth/verify', routes.authVerify],
  ['GET', '/api/auth/me', routes.authMe],
  ['DELETE', '/api/auth/account', routes.authDeleteAccount],
  ['POST', '/api/auth/logout', routes.authLogout],
  ['GET', '/api/projects', routes.projectsList],
  ['POST', '/api/projects', routes.projectsCreate],
  ['GET', '/api/projects/:id', routes.projectGet],
  ['PUT', '/api/projects/:id', routes.projectPut],
  ['DELETE', '/api/projects/:id', routes.projectDelete],
  ['PUT', '/api/projects/:id/map', routes.mapUpload],
  ['GET', '/api/projects/:id/map/:hash', routes.mapGet],
  ['GET', '/api/projects/:id/history', routes.historyList],
  ['GET', '/api/projects/:id/history/:version', routes.historyGet],
  ['POST', '/api/projects/:id/history/:version/restore', routes.historyRestore],
  ['GET', '/api/projects/:id/share', routes.shareList],
  ['POST', '/api/projects/:id/share', routes.shareAdd],
  ['DELETE', '/api/projects/:id/share/:userId', routes.shareRemove],
  ['GET', '/api/shared', routes.sharedWithMe],
]

function matchRoute(method: string, pathname: string): [Handler, Record<string, string>] | null {
  for (const [m, pattern, handler] of ROUTES) {
    if (m !== method) continue
    const patternParts = pattern.split('/')
    const pathParts = pathname.split('/')
    if (patternParts.length !== pathParts.length) continue
    const params: Record<string, string> = {}
    let match = true
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(':')) {
        params[patternParts[i].slice(1)] = pathParts[i]
      } else if (patternParts[i] !== pathParts[i]) {
        match = false
        break
      }
    }
    if (match) return [handler, params]
  }
  return null
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname.startsWith('/api/')) {
      const matched = matchRoute(request.method, url.pathname)
      if (!matched) return Response.json({ error: 'Not found' }, { status: 404 })
      const [handler, params] = matched

      if (!url.pathname.startsWith('/api/auth/')) {
        const user = await getUser(request, env)
        const identity = user?.sub ?? (request.headers.get('CF-Connecting-IP') || 'unknown')
        const isWrite = request.method !== 'GET'
        const allowed = await checkRateLimit(env, `${identity}:${isWrite ? 'w' : 'r'}`, isWrite ? RATE_LIMIT_WRITE : RATE_LIMIT_READ)
        if (!allowed) return Response.json({ error: 'Too many requests' }, { status: 429 })
      }

      return handler(request, env, params)
    }

    return env.ASSETS.fetch(request)
  },
}
