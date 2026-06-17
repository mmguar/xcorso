import type { Env } from './_env'

const ALG = { name: 'HMAC', hash: 'SHA-256' } as const
const TOKEN_TTL = 30 * 24 * 60 * 60 // 30 days

async function getKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    ALG,
    false,
    ['sign', 'verify'],
  )
}

function b64url(buf: ArrayBufferLike | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - s.length % 4) % 4)
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0))
}

interface TokenPayload {
  sub: string // userId
  email: string
  exp: number
}

export async function createToken(env: Env, userId: string, email: string): Promise<string> {
  const key = await getKey(env.JWT_SECRET)
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const payload: TokenPayload = { sub: userId, email, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL }
  const payloadB64 = b64url(new TextEncoder().encode(JSON.stringify(payload)))
  const sig = b64url(await crypto.subtle.sign(ALG, key, new TextEncoder().encode(`${header}.${payloadB64}`)))
  return `${header}.${payloadB64}.${sig}`
}

export async function verifyToken(env: Env, token: string): Promise<TokenPayload | null> {
  try {
    const [header, payload, sig] = token.split('.')
    if (!header || !payload || !sig) return null
    const key = await getKey(env.JWT_SECRET)
    const valid = await crypto.subtle.verify(ALG, key, b64urlDecode(sig), new TextEncoder().encode(`${header}.${payload}`))
    if (!valid) return null
    const data = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))) as TokenPayload
    if (data.exp < Math.floor(Date.now() / 1000)) return null
    return data
  } catch {
    return null
  }
}

export async function getUser(request: Request, env: Env): Promise<TokenPayload | null> {
  const cookie = request.headers.get('Cookie') ?? ''
  const match = cookie.match(/(?:^|;\s*)xcorso_token=([^;]+)/)
  if (!match) return null
  return verifyToken(env, match[1])
}

export function tokenCookie(token: string, maxAge = TOKEN_TTL): string {
  return `xcorso_token=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
}
