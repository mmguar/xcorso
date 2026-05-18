import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: true },
  optimizeDeps: {
    exclude: ['pdfjs-dist'],
  },
  resolve: {
    alias: {
      // Polyfill Node's buffer module for ocad2geojson in the browser
      buffer: 'buffer/',
    },
  },
  define: {
    // Make Buffer available as a global (ocad2geojson uses it implicitly)
    global: 'globalThis',
  },
})
