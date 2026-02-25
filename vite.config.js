import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  root: '.',
  server: {
    port: 5173,
    host: true,
    strictPort: true,
    // Proxy /api → backend. Puertos fijos: API 3001, WEB 5173. Arranque oficial: npm run dev:all
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            if (res && typeof res.writeHead === 'function' && !res.headersSent) {
              res.writeHead(503, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'API no disponible', message: 'Inicia el backend con: npm run dev:api' }));
            }
          });
        }
      }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  preview: {
    port: 5173,
    host: true
  },
  optimizeDeps: {
    include: ['esri-leaflet', 'leaflet'],
    esbuildOptions: {
      define: {
        global: 'globalThis'
      }
    }
  }
})
