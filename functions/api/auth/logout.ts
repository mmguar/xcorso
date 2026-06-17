import type { ApiFunction } from '../_env'
import { tokenCookie } from '../_auth'

export const onRequestPost: ApiFunction = async () => {
  return Response.json({ ok: true }, {
    headers: { 'Set-Cookie': tokenCookie('', 0) },
  })
}
