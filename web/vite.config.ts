import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// MedSafeVault renders from a local pywebview http server, so every asset
// reference must stay relative (`./`).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome110',
    cssCodeSplit: false,
    chunkSizeWarningLimit: 1400,
  },
})
