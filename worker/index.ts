import type { Env } from './env'
import * as routes from './routes'

type Handler = (req: Request, env: Env, params: Record<string, string>) => Promise<Response>

const ROUTES: [string, string, Handler][] = [
  ['POST', '/api/auth/send', routes.authSend],
  ['POST', '/api/auth/verify', routes.authVerify],
  ['GET', '/api/auth/me', routes.authMe],
  ['DELETE', '/api/auth/account', routes.authDeleteAccount],
  ['POST', '/api/auth/accept-terms', routes.authAcceptTerms],
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
        params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i])
      } else if (patternParts[i] !== pathParts[i]) {
        match = false
        break
      }
    }
    if (match) return [handler, params]
  }
  return null
}

const CSP = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'self' https://cloudflareinsights.com https://static.cloudflareinsights.com https://*.sentry.io",
  "frame-src https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ')

const SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': CSP,
} as const

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    let res: Response

    if (url.pathname.startsWith('/api/')) {
      // CSRF defense-in-depth on top of SameSite=Lax: browsers send Origin on
      // all cross-origin requests, so a mismatch means a cross-site call.
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        const origin = request.headers.get('Origin')
        if (origin && origin !== url.origin) {
          return Response.json({ error: 'Forbidden' }, { status: 403 })
        }
      }
      const matched = matchRoute(request.method, url.pathname)
      if (!matched) return Response.json({ error: 'Not found' }, { status: 404 })
      const [handler, params] = matched

      // ponytail: rate limiting moved to Cloudflare WAF rules, saves 2 KV ops per request
      res = await handler(request, env, params)
    } else {
      res = await env.ASSETS.fetch(request)
    }

    const patched = new Response(res.body, res)
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) patched.headers.set(k, v)
    return patched
  },
}
