import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  // 开发预览联调钉钉 API：WebView 里被 CORS 拦，真机走 CapacitorHttp 直连不需要这些代理
  server: {
    proxy: {
      '/dingtalk-openapi': {
        target: 'https://api.dingtalk.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/dingtalk-openapi/, ''),
      },
      '/dingtalk-oapi': {
        target: 'https://oapi.dingtalk.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/dingtalk-oapi/, ''),
      },
    },
  },
})
