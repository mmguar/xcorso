export interface Env {
  ASSETS: Fetcher
  BUCKET: R2Bucket
  KV: KVNamespace
  RESEND_API_KEY: string
  RESEND_FROM: string
  JWT_SECRET: string
  TURNSTILE_SECRET: string
}
