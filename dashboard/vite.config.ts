import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    allowedHosts: ['acg.tamgo.ai', 'localhost', '31.97.142.91'],
    proxy: {
      '/api': 'http://localhost:5050', // proxy al backend si es necesario
    },
  },
})
