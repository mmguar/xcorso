import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// ponytail: rewrite /app → /app.html so the SPA entry works at a clean URL
function appRewrite(): Plugin {
  return {
    name: 'app-rewrite',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url === '/app' || req.url?.startsWith('/app?')) req.url = '/app.html'
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [appRewrite(), react(), tailwindcss()],
  build: { rollupOptions: { input: 'app.html' } },
  server: { host: true },
  optimizeDeps: {
    exclude: ['pdfjs-dist'],
  },
  resolve: {
    alias: {
      // Polyfill Node's buffer module for ocad2geojson in the browser
      buffer: 'buffer/',
      // Use the readable jsPDF build so our patch-package patch (blendMode
      // GState support, for annotation overprint) stays a small diff. Vite
      // minifies dependencies in the production bundle, so there's no size cost.
      jspdf: 'jspdf/dist/jspdf.es.js',
    },
  },
  define: {
    // Make Buffer available as a global (ocad2geojson uses it implicitly)
    global: 'globalThis',
  },
})
