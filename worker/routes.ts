import type { Env } from './env'
import { getUser, createToken, tokenCookie } from './auth'

type Params = Record<string, string>

interface ProjectMeta {
  id: string
  name: string
  updatedAt: string
  projectSizeBytes: number
  mapHash: string
  mapSizeBytes: number
  version: number
  history: { version: number; timestamp: string; projectSizeBytes: number }[]
}

function r2Prefix(userId: string, projectId: string) {
  return `users/${userId}/projects/${projectId}`
}

async function getIndex(env: Env, userId: string): Promise<ProjectMeta[]> {
  const obj = await env.BUCKET.get(`users/${userId}/index.json`)
  if (!obj) return []
  return obj.json()
}

async function putIndex(env: Env, userId: string, index: ProjectMeta[]): Promise<void> {
  await env.BUCKET.put(`users/${userId}/index.json`, JSON.stringify(index), {
    httpMetadata: { contentType: 'application/json' },
  })
}

// --- Auth ---

export async function authSend(request: Request, env: Env, _params: Params) {
  const body = await request.json() as { email?: string }
  const email = body.email?.trim().toLowerCase()
  if (!email || !email.includes('@')) {
    return Response.json({ error: 'Invalid email' }, { status: 400 })
  }

  const code = String(Math.floor(100000 + Math.random() * 900000))
  await env.KV.put(`auth:code:${email}`, code, { expirationTtl: 600 })

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.RESEND_FROM,
      to: email,
      subject: 'xcorso login code',
      text: `Your login code is: ${code}\n\nIt expires in 10 minutes.`,
    }),
  })

  if (!res.ok) {
    return Response.json({ error: 'Failed to send email' }, { status: 502 })
  }
  return Response.json({ ok: true })
}

export async function authVerify(request: Request, env: Env, _params: Params) {
  const body = await request.json() as { email?: string; code?: string }
  const email = body.email?.trim().toLowerCase()
  const code = body.code?.trim()
  if (!email || !code) {
    return Response.json({ error: 'Missing email or code' }, { status: 400 })
  }

  const stored = await env.KV.get(`auth:code:${email}`)
  if (!stored || stored !== code) {
    return Response.json({ error: 'Invalid or expired code' }, { status: 401 })
  }
  await env.KV.delete(`auth:code:${email}`)

  let user = await env.KV.get(`users:email:${email}`, 'json') as { userId: string; createdAt: string } | null
  if (!user) {
    const userId = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    user = { userId, createdAt }
    await env.KV.put(`users:email:${email}`, JSON.stringify(user))
    await env.KV.put(`users:id:${userId}`, JSON.stringify({ email, createdAt }))
  }

  const token = await createToken(env, user.userId, email)
  return Response.json({ ok: true, userId: user.userId, email }, {
    headers: { 'Set-Cookie': tokenCookie(token) },
  })
}

export async function authMe(request: Request, env: Env, _params: Params) {
  const user = await getUser(request, env)
  if (!user) return Response.json({ user: null })
  return Response.json({ user: { userId: user.sub, email: user.email } })
}

export async function authDeleteAccount(request: Request, env: Env, _params: Params) {
  const user = await getUser(request, env)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = user.sub
  const prefix = `users/${userId}/`
  let cursor: string | undefined
  do {
    const listed = await env.BUCKET.list({ prefix, cursor })
    if (listed.objects.length > 0) {
      await env.BUCKET.delete(listed.objects.map((o: R2Object) => o.key))
    }
    cursor = listed.truncated ? listed.cursor : undefined
  } while (cursor)

  await env.KV.delete(`users:id:${userId}`)
  await env.KV.delete(`users:email:${user.email}`)

  return Response.json({ ok: true }, {
    headers: { 'Set-Cookie': tokenCookie('', 0) },
  })
}

export async function authLogout(_request: Request, _env: Env, _params: Params) {
  return Response.json({ ok: true }, {
    headers: { 'Set-Cookie': tokenCookie('', 0) },
  })
}

// --- Projects ---

export async function projectsList(request: Request, env: Env, _params: Params) {
  const user = await getUser(request, env)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const index = await getIndex(env, user.sub)
  return Response.json({ projects: index })
}

export async function projectsCreate(request: Request, env: Env, _params: Params) {
  const user = await getUser(request, env)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as { name?: string }
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  const existing = await getIndex(env, user.sub)
  existing.push({
    id,
    name: body.name ?? 'Untitled',
    updatedAt: now,
    projectSizeBytes: 0,
    mapHash: '',
    mapSizeBytes: 0,
    version: 0,
    history: [],
  })
  await putIndex(env, user.sub, existing)

  return Response.json({ id }, { status: 201 })
}

export async function projectGet(request: Request, env: Env, params: Params) {
  const user = await getUser(request, env)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const obj = await env.BUCKET.get(`${r2Prefix(user.sub, params.id)}/current.json`)
  if (!obj) return Response.json({ error: 'Not found' }, { status: 404 })

  return new Response(obj.body, {
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function projectPut(request: Request, env: Env, params: Params) {
  const user = await getUser(request, env)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const prefix = r2Prefix(user.sub, params.id)

  const index = await getIndex(env, user.sub)
  const meta = index.find(p => p.id === params.id)
  if (!meta) return Response.json({ error: 'Not found' }, { status: 404 })

  const ifMatch = request.headers.get('If-Match')
  if (ifMatch && Number(ifMatch) !== meta.version) {
    return Response.json({ error: 'Conflict', serverVersion: meta.version }, { status: 409 })
  }

  if (meta.version > 0) {
    const current = await env.BUCKET.get(`${prefix}/current.json`)
    if (current) {
      const vKey = `${prefix}/history/v${String(meta.version).padStart(3, '0')}.json`
      await env.BUCKET.put(vKey, await current.arrayBuffer(), {
        httpMetadata: { contentType: 'application/json' },
      })
    }
  }

  const body = await request.arrayBuffer()
  await env.BUCKET.put(`${prefix}/current.json`, body, {
    httpMetadata: { contentType: 'application/json' },
  })

  let name = meta.name
  let mapHash = meta.mapHash
  try {
    const parsed = JSON.parse(new TextDecoder().decode(body))
    name = parsed.meta?.name ?? name
    mapHash = parsed.meta?.mapHash ?? mapHash
  } catch { /* keep existing metadata */ }

  const newVersion = meta.version + 1
  meta.version = newVersion
  meta.name = name
  meta.mapHash = mapHash
  meta.updatedAt = new Date().toISOString()
  meta.projectSizeBytes = body.byteLength
  meta.history = [
    { version: newVersion, timestamp: meta.updatedAt, projectSizeBytes: body.byteLength },
    ...meta.history,
  ].slice(0, 50)

  await putIndex(env, user.sub, index)
  return Response.json({ version: newVersion })
}

export async function projectDelete(request: Request, env: Env, params: Params) {
  const user = await getUser(request, env)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const prefix = r2Prefix(user.sub, params.id)
  const listed = await env.BUCKET.list({ prefix: `${prefix}/` })
  if (listed.objects.length > 0) {
    await env.BUCKET.delete(listed.objects.map((o: R2Object) => o.key))
  }

  const index = await getIndex(env, user.sub)
  const filtered = index.filter(p => p.id !== params.id)
  await putIndex(env, user.sub, filtered)

  return Response.json({ ok: true })
}

// --- Maps ---

export async function mapUpload(request: Request, env: Env, params: Params) {
  const user = await getUser(request, env)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.arrayBuffer()
  const hashBuf = await crypto.subtle.digest('SHA-256', body)
  const hash = [...new Uint8Array(hashBuf)].map(b => b.toString(16).padStart(2, '0')).join('')
  const key = `users/${user.sub}/projects/${params.id}/maps/${hash}.bin`

  const existing = await env.BUCKET.head(key)
  if (!existing) {
    await env.BUCKET.put(key, body)
  }

  return Response.json({ hash, sizeBytes: body.byteLength })
}

export async function mapGet(request: Request, env: Env, params: Params) {
  const user = await getUser(request, env)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const key = `users/${user.sub}/projects/${params.id}/maps/${params.hash}.bin`
  const obj = await env.BUCKET.get(key)
  if (!obj) return Response.json({ error: 'Not found' }, { status: 404 })

  return new Response(obj.body, {
    headers: { 'Content-Type': 'application/octet-stream' },
  })
}

// --- History ---

export async function historyList(request: Request, env: Env, params: Params) {
  const user = await getUser(request, env)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const index = await getIndex(env, user.sub) as { id: string; history: unknown[] }[]
  const meta = index.find(p => p.id === params.id)
  if (!meta) return Response.json({ error: 'Not found' }, { status: 404 })

  return Response.json({ history: meta.history ?? [] })
}

export async function historyGet(request: Request, env: Env, params: Params) {
  const user = await getUser(request, env)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const key = `users/${user.sub}/projects/${params.id}/history/v${params.version.padStart(3, '0')}.json`
  const obj = await env.BUCKET.get(key)
  if (!obj) return Response.json({ error: 'Not found' }, { status: 404 })

  return new Response(obj.body, {
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function historyRestore(request: Request, env: Env, params: Params) {
  const user = await getUser(request, env)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const prefix = `users/${user.sub}/projects/${params.id}`

  const snapshotKey = `${prefix}/history/v${params.version.padStart(3, '0')}.json`
  const snapshot = await env.BUCKET.get(snapshotKey)
  if (!snapshot) return Response.json({ error: 'Version not found' }, { status: 404 })
  const snapshotBytes = await snapshot.arrayBuffer()

  const index = await getIndex(env, user.sub)
  const meta = index.find(p => p.id === params.id)
  if (!meta) return Response.json({ error: 'Project not found' }, { status: 404 })

  const current = await env.BUCKET.get(`${prefix}/current.json`)
  if (current) {
    const archiveKey = `${prefix}/history/v${String(meta.version).padStart(3, '0')}.json`
    await env.BUCKET.put(archiveKey, await current.arrayBuffer(), {
      httpMetadata: { contentType: 'application/json' },
    })
  }

  await env.BUCKET.put(`${prefix}/current.json`, snapshotBytes, {
    httpMetadata: { contentType: 'application/json' },
  })

  const newVersion = meta.version + 1
  meta.version = newVersion
  meta.updatedAt = new Date().toISOString()
  meta.projectSizeBytes = snapshotBytes.byteLength
  meta.history = [
    { version: newVersion, timestamp: meta.updatedAt, projectSizeBytes: snapshotBytes.byteLength },
    ...meta.history,
  ].slice(0, 50)

  try {
    const parsed = JSON.parse(new TextDecoder().decode(snapshotBytes))
    meta.name = parsed.meta?.name ?? meta.name
    meta.mapHash = parsed.meta?.mapHash ?? meta.mapHash
  } catch { /* keep existing */ }

  await putIndex(env, user.sub, index)
  return Response.json({ version: newVersion })
}
