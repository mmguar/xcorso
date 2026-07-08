import type { Env } from './env'
import { getUser, createToken, tokenCookie } from './auth'

type Params = Record<string, string>

interface HistoryEntry {
  version: number
  timestamp: string
  projectSizeBytes: number
  editedBy?: string // e.g. "ma" (first 2 chars of email)
  mapHash?: string // map referenced by this version; entries without it block map GC
}

interface ProjectMeta {
  id: string
  name: string
  updatedAt: string
  projectSizeBytes: number
  mapHash: string
  mapSizeBytes: number
  version: number
  history: HistoryEntry[]
}

type ShareRole = 'editor' | 'viewer'

interface ShareEntry {
  userId: string
  email: string
  role: ShareRole
}

interface SharedRef {
  projectId: string
  ownerId: string
  ownerEmail: string
  role: ShareRole
}

// Shares to emails without an account yet use userId "pending:<email>" and a
// KV list keyed by email instead of projects:shared:<userId>. Resolved on first login.
const PENDING = 'pending:'

function sharedRefsKey(share: Pick<ShareEntry, 'userId' | 'email'>): string {
  return share.userId.startsWith(PENDING) ? `projects:pending:${share.email}` : `projects:shared:${share.userId}`
}

async function getShares(env: Env, projectId: string): Promise<ShareEntry[]> {
  return await env.KV.get(`projects:shares:${projectId}`, 'json') as ShareEntry[] ?? []
}

async function putShares(env: Env, projectId: string, shares: ShareEntry[]): Promise<void> {
  if (shares.length === 0) await env.KV.delete(`projects:shares:${projectId}`)
  else await env.KV.put(`projects:shares:${projectId}`, JSON.stringify(shares))
}

async function getSharedWithMe(env: Env, userId: string): Promise<SharedRef[]> {
  return await env.KV.get(`projects:shared:${userId}`, 'json') as SharedRef[] ?? []
}

async function putSharedWithMe(env: Env, userId: string, refs: SharedRef[]): Promise<void> {
  if (refs.length === 0) await env.KV.delete(`projects:shared:${userId}`)
  else await env.KV.put(`projects:shared:${userId}`, JSON.stringify(refs))
}

// Drop a project ref from a share target's list (real user or pending email).
async function removeSharedRef(env: Env, share: Pick<ShareEntry, 'userId' | 'email'>, projectId: string): Promise<void> {
  const key = sharedRefsKey(share)
  const refs = await env.KV.get(key, 'json') as SharedRef[] | null ?? []
  const remaining = refs.filter(r => r.projectId !== projectId)
  if (remaining.length === 0) await env.KV.delete(key)
  else await env.KV.put(key, JSON.stringify(remaining))
}

async function deleteR2Prefix(env: Env, prefix: string): Promise<void> {
  let cursor: string | undefined
  do {
    const listed = await env.BUCKET.list({ prefix, cursor })
    if (listed.objects.length > 0) {
      await env.BUCKET.delete(listed.objects.map((o: R2Object) => o.key))
    }
    cursor = listed.truncated ? listed.cursor : undefined
  } while (cursor)
}

interface Access { ownerId: string; role: ShareRole | 'owner'; index: ProjectMeta[] }

// Resolve access: returns ownerId + role + the owner's index (avoids a second KV read)
async function resolveAccess(env: Env, userId: string, projectId: string): Promise<Access | null> {
  const ownedIndex = await getIndex(env, userId)
  if (ownedIndex.find(p => p.id === projectId)) return { ownerId: userId, role: 'owner', index: ownedIndex }

  const sharedRefs = await getSharedWithMe(env, userId)
  const ref = sharedRefs.find(r => r.projectId === projectId)
  if (ref) {
    const ownerIndex = await getIndex(env, ref.ownerId)
    return { ownerId: ref.ownerId, role: ref.role, index: ownerIndex }
  }

  return null
}

function emailInitials(email: string): string {
  return email.slice(0, 2).toLowerCase()
}

function r2Prefix(userId: string, projectId: string) {
  return `users/${userId}/projects/${projectId}`
}

async function getIndex(env: Env, userId: string): Promise<ProjectMeta[]> {
  const kv = await env.KV.get(`projects:index:${userId}`, 'json') as ProjectMeta[] | null
  if (kv) return kv
  // Migrate from R2 if exists
  const obj = await env.BUCKET.get(`users/${userId}/index.json`)
  if (!obj) return []
  const data = await obj.json() as ProjectMeta[]
  await env.KV.put(`projects:index:${userId}`, JSON.stringify(data))
  return data
}

async function putIndex(env: Env, userId: string, index: ProjectMeta[]): Promise<void> {
  await env.KV.put(`projects:index:${userId}`, JSON.stringify(index))
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

async function computeIndexEtag(index: ProjectMeta[]): Promise<string> {
  const body = JSON.stringify({ projects: index })
  const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))
  return `"${toHex(hashBuf).slice(0, 16)}"`
}

function codesEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const ab = enc.encode(a), bb = enc.encode(b)
  if (ab.byteLength !== bb.byteLength) return false
  return crypto.subtle.timingSafeEqual(ab, bb)
}

// --- Auth ---

export async function authSend(request: Request, env: Env, _params: Params) {
  const body = await request.json() as { email?: string; cfToken?: string }
  const email = body.email?.trim().toLowerCase()
  if (!email || !email.includes('@')) {
    return Response.json({ error: 'Invalid email' }, { status: 400 })
  }

  // Fail closed: without bot verification this endpoint sends unlimited email.
  if (!env.TURNSTILE_SECRET) {
    return Response.json({ error: 'Login is not configured (missing TURNSTILE_SECRET)' }, { status: 503 })
  }
  const cfRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: body.cfToken ?? '' }),
  })
  const cfData = await cfRes.json() as { success: boolean }
  if (!cfData.success) return Response.json({ error: 'Verification failed' }, { status: 403 })

  const sends = parseInt(await env.KV.get(`auth:sends:${email}`) ?? '0')
  if (sends >= 2) {
    return Response.json({ error: 'Wait a minute before requesting a new code' }, { status: 429 })
  }

  // Count the send before it happens — incrementing after let parallel
  // requests all pass the sends check and spam the address.
  await env.KV.put(`auth:sends:${email}`, String(sends + 1), { expirationTtl: 60 })

  const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000))
  await env.KV.put(`auth:code:${email}`, code, { expirationTtl: 600 })
  await env.KV.delete(`auth:attempts:${email}`)

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
  const body = await request.json() as { email?: string; code?: string; termsVersion?: string }
  const email = body.email?.trim().toLowerCase()
  const code = body.code?.trim()
  if (!email || !code) {
    return Response.json({ error: 'Missing email or code' }, { status: 400 })
  }

  const attempts = parseInt(await env.KV.get(`auth:attempts:${email}`) ?? '0')
  if (attempts >= 5) {
    await env.KV.delete(`auth:code:${email}`)
    return Response.json({ error: 'Too many attempts, request a new code' }, { status: 429 })
  }

  const stored = await env.KV.get(`auth:code:${email}`)
  if (!stored || !codesEqual(stored, code)) {
    await env.KV.put(`auth:attempts:${email}`, String(attempts + 1), { expirationTtl: 600 })
    return Response.json({ error: 'Invalid or expired code' }, { status: 401 })
  }
  await env.KV.delete(`auth:code:${email}`)
  await env.KV.delete(`auth:attempts:${email}`)

  let user = await env.KV.get(`users:email:${email}`, 'json') as { userId: string; createdAt: string; termsVersion?: string } | null
  if (!user) {
    const userId = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    user = { userId, createdAt, termsVersion: body.termsVersion }
    await env.KV.put(`users:email:${email}`, JSON.stringify(user))
    await env.KV.put(`users:id:${userId}`, JSON.stringify({ email, createdAt, termsVersion: body.termsVersion }))

    // Resolve shares that were created before this account existed
    const pending = await env.KV.get(`projects:pending:${email}`, 'json') as SharedRef[] | null
    if (pending) {
      for (const ref of pending) {
        const shares = await getShares(env, ref.projectId)
        const entry = shares.find(s => s.userId === `${PENDING}${email}`)
        if (entry) {
          entry.userId = userId
          await putShares(env, ref.projectId, shares)
        }
      }
      await putSharedWithMe(env, userId, pending)
      await env.KV.delete(`projects:pending:${email}`)
    }
  } else if (body.termsVersion && user.termsVersion !== body.termsVersion) {
    user.termsVersion = body.termsVersion
    await env.KV.put(`users:email:${email}`, JSON.stringify(user))
    const idRecord = await env.KV.get(`users:id:${user.userId}`, 'json') as Record<string, unknown> | null
    if (idRecord) await env.KV.put(`users:id:${user.userId}`, JSON.stringify({ ...idRecord, termsVersion: body.termsVersion }))
  }

  const token = await createToken(env, user.userId, email)
  return Response.json({ ok: true, userId: user.userId, email, termsVersion: user.termsVersion }, {
    headers: { 'Set-Cookie': tokenCookie(token) },
  })
}

export async function authMe(request: Request, env: Env, _params: Params) {
  const user = await getUser(request, env)
  if (!user) return Response.json({ user: null })
  const [record, index] = await Promise.all([
    env.KV.get(`users:email:${user.email}`, 'json') as Promise<{ termsVersion?: string } | null>,
    getIndex(env, user.sub),
  ])
  const etag = await computeIndexEtag(index)
  return Response.json({
    user: { userId: user.sub, email: user.email, termsVersion: record?.termsVersion },
    projects: index,
    indexEtag: etag,
  })
}

export async function authAcceptTerms(request: Request, env: Env, _params: Params) {
  const user = await getUser(request, env)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json() as { termsVersion?: string }
  if (!body.termsVersion) return Response.json({ error: 'Missing termsVersion' }, { status: 400 })

  const emailRecord = await env.KV.get(`users:email:${user.email}`, 'json') as Record<string, unknown> | null
  if (emailRecord) await env.KV.put(`users:email:${user.email}`, JSON.stringify({ ...emailRecord, termsVersion: body.termsVersion }))
  const idRecord = await env.KV.get(`users:id:${user.sub}`, 'json') as Record<string, unknown> | null
  if (idRecord) await env.KV.put(`users:id:${user.sub}`, JSON.stringify({ ...idRecord, termsVersion: body.termsVersion }))

  return Response.json({ ok: true, termsVersion: body.termsVersion })
}

export async function authDeleteAccount(request: Request, env: Env, _params: Params) {
  const user = await getUser(request, env)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = user.sub
  await deleteR2Prefix(env, `users/${userId}/`)

  // Clean up shares for owned projects
  const ownedIndex = await getIndex(env, userId)
  for (const p of ownedIndex) {
    const shares = await getShares(env, p.id)
    for (const s of shares) {
      await removeSharedRef(env, s, p.id)
    }
    await putShares(env, p.id, [])
  }
  // Remove this user from other owners' share lists, then drop the refs
  const refs = await getSharedWithMe(env, userId)
  for (const ref of refs) {
    const shares = await getShares(env, ref.projectId)
    await putShares(env, ref.projectId, shares.filter(s => s.userId !== userId))
  }
  await env.KV.delete(`projects:shared:${userId}`)

  await env.KV.delete(`users:id:${userId}`)
  await env.KV.delete(`users:email:${user.email}`)
  await env.KV.delete(`projects:index:${userId}`)

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
  const etag = await computeIndexEtag(index)

  if (request.headers.get('If-None-Match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } })
  }
  return Response.json({ projects: index }, { headers: { ETag: etag } })
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

  const access = await resolveAccess(env, user.sub, params.id)
  if (!access) return Response.json({ error: 'Not found' }, { status: 404 })

  const obj = await env.BUCKET.get(`${r2Prefix(access.ownerId, params.id)}/current.json`)
  if (!obj) return Response.json({ error: 'Not found' }, { status: 404 })

  // Sync version travels in a header: the body is the client-uploaded JSON,
  // whose `version` field is the project *format* version ("1.0").
  const meta = access.index.find(p => p.id === params.id)
  return new Response(obj.body, {
    headers: { 'Content-Type': 'application/json', 'X-Version': String(meta?.version ?? 0) },
  })
}

export async function projectPut(request: Request, env: Env, params: Params) {
  const user = await getUser(request, env)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const cl = parseInt(request.headers.get('Content-Length') ?? '0')
  if (cl > MAX_PROJECT_BYTES) return Response.json({ error: 'Project too large (max 10 MB)' }, { status: 413 })

  const access = await resolveAccess(env, user.sub, params.id)
  if (!access) return Response.json({ error: 'Not found' }, { status: 404 })
  if (access.role === 'viewer') return Response.json({ error: 'Read-only access' }, { status: 403 })

  const prefix = r2Prefix(access.ownerId, params.id)

  const { index } = access
  const meta = index.find(p => p.id === params.id)
  if (!meta) return Response.json({ error: 'Not found' }, { status: 404 })

  // Mandatory once the project has a version — omitting If-Match must not
  // silently overwrite someone else's push (KV/R2 have no other concurrency control).
  const ifMatch = request.headers.get('If-Match')
  if (meta.version > 0 && Number(ifMatch) !== meta.version) {
    return Response.json({ error: 'Conflict', serverVersion: meta.version }, { status: 409 })
  }

  const forceSnapshot = request.headers.get('X-Snapshot') === 'true'
  const lastHistoryTs = meta.history[0]?.timestamp
  const historyStale = !lastHistoryTs || (Date.now() - new Date(lastHistoryTs).getTime()) > 10 * 60_000
  let archived = false
  if (meta.version > 0 && (forceSnapshot || historyStale)) {
    const current = await env.BUCKET.get(`${prefix}/current.json`)
    if (current) {
      const vKey = `${prefix}/history/v${String(meta.version).padStart(3, '0')}.json`
      await env.BUCKET.put(vKey, await current.arrayBuffer(), {
        httpMetadata: { contentType: 'application/json' },
      })
      archived = true
    }
  }

  const body = await request.arrayBuffer()
  // Re-check after reading — chunked requests have no Content-Length.
  if (body.byteLength > MAX_PROJECT_BYTES) return Response.json({ error: 'Project too large (max 10 MB)' }, { status: 413 })
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
  if (archived) {
    meta.history = [
      { version: newVersion, timestamp: meta.updatedAt, projectSizeBytes: body.byteLength, editedBy: emailInitials(user.email), mapHash },
      ...meta.history,
    ].slice(0, 50)
  }

  await putIndex(env, access.ownerId, index)

  // GC map blobs no longer referenced by current or any history entry.
  // Skipped while pre-mapHash entries remain (they roll off the 50-entry cap).
  // ponytail: best-effort — a map uploaded by a concurrent editor between their
  // mapUpload and projectPut can be swept; their next map change re-uploads it.
  if (archived && !meta.history.some(h => h.mapHash == null)) {
    const referenced = new Set([mapHash, ...meta.history.map(h => h.mapHash)])
    const mapsPrefix = `${prefix}/maps/`
    const listed = await env.BUCKET.list({ prefix: mapsPrefix })
    const stale = listed.objects
      .filter((o: R2Object) => !referenced.has(o.key.slice(mapsPrefix.length).replace(/\.bin$/, '')))
      .map((o: R2Object) => o.key)
    if (stale.length > 0) await env.BUCKET.delete(stale)
  }

  const indexEtag = await computeIndexEtag(index)
  return Response.json({ version: newVersion, indexEtag })
}

export async function projectDelete(request: Request, env: Env, params: Params) {
  const user = await getUser(request, env)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const access = await resolveAccess(env, user.sub, params.id)
  if (!access) return Response.json({ error: 'Not found' }, { status: 404 })
  if (access.role !== 'owner') return Response.json({ error: 'Only the owner can delete' }, { status: 403 })

  // Remove shares and shared-with-me refs
  const shares = await getShares(env, params.id)
  for (const s of shares) {
    await removeSharedRef(env, s, params.id)
  }
  await putShares(env, params.id, [])

  await deleteR2Prefix(env, `${r2Prefix(user.sub, params.id)}/`)

  const filtered = access.index.filter(p => p.id !== params.id)
  await putIndex(env, user.sub, filtered)

  return Response.json({ ok: true })
}

// --- Maps ---

const MAX_MAP_BYTES = 50 * 1024 * 1024   // 50 MB
const MAX_PROJECT_BYTES = 10 * 1024 * 1024 // 10 MB

export async function mapUpload(request: Request, env: Env, params: Params) {
  const user = await getUser(request, env)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const cl = parseInt(request.headers.get('Content-Length') ?? '0')
  if (cl > MAX_MAP_BYTES) return Response.json({ error: 'Map file too large (max 50 MB)' }, { status: 413 })

  const access = await resolveAccess(env, user.sub, params.id)
  if (!access) return Response.json({ error: 'Not found' }, { status: 404 })
  if (access.role === 'viewer') return Response.json({ error: 'Read-only access' }, { status: 403 })

  const body = await request.arrayBuffer()
  if (body.byteLength > MAX_MAP_BYTES) return Response.json({ error: 'Map file too large (max 50 MB)' }, { status: 413 })

  // Only accept OCAD files (magic bytes 0x0CAD at offset 0)
  if (body.byteLength < 2) return Response.json({ error: 'Invalid file' }, { status: 400 })
  const magic = new DataView(body).getUint16(0, true)
  if (magic !== 0x0CAD) return Response.json({ error: 'Only OCAD map files can be synced to the cloud' }, { status: 400 })

  const hash = toHex(await crypto.subtle.digest('SHA-256', body))
  const key = `users/${access.ownerId}/projects/${params.id}/maps/${hash}.bin`

  const existing = await env.BUCKET.head(key)
  if (!existing) {
    await env.BUCKET.put(key, body)
  }

  return Response.json({ hash, sizeBytes: body.byteLength })
}

export async function mapGet(request: Request, env: Env, params: Params) {
  const user = await getUser(request, env)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  if (!/^[0-9a-f]{64}$/.test(params.hash)) return Response.json({ error: 'Invalid hash' }, { status: 400 })

  const access = await resolveAccess(env, user.sub, params.id)
  if (!access) return Response.json({ error: 'Not found' }, { status: 404 })

  const key = `users/${access.ownerId}/projects/${params.id}/maps/${params.hash}.bin`
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

  const access = await resolveAccess(env, user.sub, params.id)
  if (!access) return Response.json({ error: 'Not found' }, { status: 404 })

  const meta = access.index.find(p => p.id === params.id)
  if (!meta) return Response.json({ error: 'Not found' }, { status: 404 })

  return Response.json({ history: meta.history ?? [] })
}

export async function historyGet(request: Request, env: Env, params: Params) {
  const user = await getUser(request, env)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  if (!/^\d{1,6}$/.test(params.version)) return Response.json({ error: 'Invalid version' }, { status: 400 })

  const access = await resolveAccess(env, user.sub, params.id)
  if (!access) return Response.json({ error: 'Not found' }, { status: 404 })

  const key = `users/${access.ownerId}/projects/${params.id}/history/v${params.version.padStart(3, '0')}.json`
  const obj = await env.BUCKET.get(key)
  if (!obj) return Response.json({ error: 'Not found' }, { status: 404 })

  return new Response(obj.body, {
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function historyRestore(request: Request, env: Env, params: Params) {
  const user = await getUser(request, env)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  if (!/^\d{1,6}$/.test(params.version)) return Response.json({ error: 'Invalid version' }, { status: 400 })

  const access = await resolveAccess(env, user.sub, params.id)
  if (!access) return Response.json({ error: 'Not found' }, { status: 404 })
  if (access.role === 'viewer') return Response.json({ error: 'Read-only access' }, { status: 403 })

  const prefix = `users/${access.ownerId}/projects/${params.id}`

  const snapshotKey = `${prefix}/history/v${params.version.padStart(3, '0')}.json`
  const snapshot = await env.BUCKET.get(snapshotKey)
  if (!snapshot) return Response.json({ error: 'Version not found' }, { status: 404 })
  const snapshotBytes = await snapshot.arrayBuffer()

  const { index } = access
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

  try {
    const parsed = JSON.parse(new TextDecoder().decode(snapshotBytes))
    meta.name = parsed.meta?.name ?? meta.name
    meta.mapHash = parsed.meta?.mapHash ?? meta.mapHash
  } catch { /* keep existing */ }

  meta.history = [
    { version: newVersion, timestamp: meta.updatedAt, projectSizeBytes: snapshotBytes.byteLength, editedBy: emailInitials(user.email), mapHash: meta.mapHash },
    ...meta.history,
  ].slice(0, 50)

  await putIndex(env, access.ownerId, index)
  const indexEtag = await computeIndexEtag(index)
  return Response.json({ version: newVersion, indexEtag })
}

// --- Sharing ---

export async function shareAdd(request: Request, env: Env, params: Params) {
  const user = await getUser(request, env)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const access = await resolveAccess(env, user.sub, params.id)
  if (!access || access.role !== 'owner') return Response.json({ error: 'Only the owner can share' }, { status: 403 })

  const body = await request.json() as { email?: string; role?: string }
  const email = body.email?.trim().toLowerCase()
  if (!email || !email.includes('@')) return Response.json({ error: 'Invalid email' }, { status: 400 })
  const role: ShareRole = body.role === 'viewer' ? 'viewer' : 'editor'

  if (email === user.email) return Response.json({ error: 'Cannot share with yourself' }, { status: 400 })

  // Look up the target user; no account yet → pending share, resolved on their first login
  const targetUser = await env.KV.get(`users:email:${email}`, 'json') as { userId: string } | null
  const targetId = targetUser?.userId ?? `${PENDING}${email}`

  // Update shares list
  const shares = await getShares(env, params.id)
  const existing = shares.find(s => s.userId === targetId)
  if (existing) {
    existing.role = role
    existing.email = email
  } else {
    shares.push({ userId: targetId, email, role })
  }
  await putShares(env, params.id, shares)

  // Update target's shared-with-me (or pending) list
  const refsKey = sharedRefsKey({ userId: targetId, email })
  const refs = await env.KV.get(refsKey, 'json') as SharedRef[] | null ?? []
  const existingRef = refs.find(r => r.projectId === params.id)
  if (existingRef) {
    existingRef.role = role
    existingRef.ownerEmail = user.email
  } else {
    refs.push({ projectId: params.id, ownerId: user.sub, ownerEmail: user.email, role })
  }
  await env.KV.put(refsKey, JSON.stringify(refs))

  return Response.json({ ok: true, shares })
}

export async function shareRemove(request: Request, env: Env, params: Params) {
  const user = await getUser(request, env)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const access = await resolveAccess(env, user.sub, params.id)
  // Owner can remove anyone; non-owner can remove themselves (leave)
  if (!access) return Response.json({ error: 'Not found' }, { status: 404 })
  if (access.role !== 'owner' && params.userId !== user.sub) {
    return Response.json({ error: 'Only the owner can remove others' }, { status: 403 })
  }

  const shares = await getShares(env, params.id)
  const removed = shares.find(s => s.userId === params.userId)
  await putShares(env, params.id, shares.filter(s => s.userId !== params.userId))
  if (removed) await removeSharedRef(env, removed, params.id)

  return Response.json({ ok: true })
}

export async function shareList(request: Request, env: Env, params: Params) {
  const user = await getUser(request, env)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const access = await resolveAccess(env, user.sub, params.id)
  if (!access) return Response.json({ error: 'Not found' }, { status: 404 })

  const shares = await getShares(env, params.id)
  return Response.json({ shares, role: access.role })
}

export async function sharedWithMe(request: Request, env: Env, _params: Params) {
  const user = await getUser(request, env)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const refs = await getSharedWithMe(env, user.sub)

  // Enrich with project name/updatedAt from owner's index
  const enriched: { projectId: string; ownerId: string; ownerEmail: string; role: ShareRole; name: string; updatedAt: string }[] = []
  const ownerCache = new Map<string, ProjectMeta[]>()
  for (const ref of refs) {
    if (!ownerCache.has(ref.ownerId)) ownerCache.set(ref.ownerId, await getIndex(env, ref.ownerId))
    const ownerIndex = ownerCache.get(ref.ownerId)!
    const meta = ownerIndex.find(p => p.id === ref.projectId)
    if (meta) {
      enriched.push({ ...ref, name: meta.name, updatedAt: meta.updatedAt })
    }
  }

  return Response.json({ projects: enriched })
}
