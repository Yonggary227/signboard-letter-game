import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages는 /<저장소명>/ 하위 경로로 서비스되므로 build 시 상대경로(base './')를 쓴다.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? './' : '/',
  server: {
    host: true,
    port: 3000,
    allowedHosts: true,
  },
}))
