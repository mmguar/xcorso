import type { Env } from './env'
import * as routes from './routes'

type Handler = (req: Request, env: Env, params: Record<string, string>) => Promise<Response>

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
      return handler(request, env, params)
    }

    return env.ASSETS.fetch(request)
  },
}
