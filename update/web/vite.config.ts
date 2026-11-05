import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 更新服务的管理页面。构建产物输出到 dist/，由 update/server.py 直接托管，
// Linux 服务器上不需要 Node —— 只有改版重新构建时才需要 npm。
//
// 开发时先起后端：python3 update/server.py --port 8000
// 再起页面：cd update/web && npm run dev （5174 端口，/api 代理到 8000）
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/download': 'http://127.0.0.1:8000',
      '/healthz': 'http://127.0.0.1:8000',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // 科室里最老的浏览器也要能打开后台，取 Win7 还能装的最后一版内核。
    target: 'chrome109',
    cssCodeSplit: false,
    chunkSizeWarningLimit: 1400,
  },
})
