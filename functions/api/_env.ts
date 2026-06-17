export interface Env {
  BUCKET: R2Bucket
  KV: KVNamespace
  RESEND_API_KEY: string
  RESEND_FROM: string
  JWT_SECRET: string
}

export type ApiContext = EventContext<Env, string, Record<string, unknown>>
export type ApiFunction = PagesFunction<Env>
