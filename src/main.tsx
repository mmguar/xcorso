// Polyfill Buffer for ocad2geojson (Node.js library used in browser)
import { Buffer } from 'buffer'
globalThis.Buffer = Buffer

// Polyfill Promise.withResolvers for Safari < 17.4 / iOS < 17.4
if (typeof (Promise as any).withResolvers === 'undefined') {
  (Promise as any).withResolvers = function <T>() {
    let resolve!: (value: T | PromiseLike<T>) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }
}

import * as Sentry from '@sentry/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  enabled: import.meta.env.PROD,
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
