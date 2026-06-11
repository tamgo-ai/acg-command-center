import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/crash-intel/',
  build: { outDir: 'dist', assetsDir: 'assets' },
  server: {
    proxy: {
      '/crash-intel/api': {
        target: 'http://127.0.0.1:5052',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/crash-intel\/api/, '/api'),
      },
    },
  },
})
