import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 백엔드 프록시 대상.
// - docker-compose 안에서는 서비스명으로 접근: http://backend:8000
// - docker 없이 로컬에서 직접 띄울 때는 http://localhost:8000
const API_PROXY_TARGET = process.env.VITE_API_PROXY_TARGET || 'http://backend:8000'

// 구글 로그인 팝업의 postMessage 가 COOP 에 막히지 않도록.
const HEADERS = { 'Cross-Origin-Opener-Policy': 'same-origin-allow-popups' }

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    headers: HEADERS,
    // 도메인(meeting.likecorp.net)을 통한 접속을 허용
    allowedHosts: ['meeting.likecorp.net'],
    // /api/* 요청을 백엔드로 전달 (로컬 localhost:5173 접속 시 사용)
    proxy: {
      '/api': {
        target: API_PROXY_TARGET,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    headers: HEADERS,
    allowedHosts: ['meeting.likecorp.net'],
    proxy: {
      '/api': {
        target: API_PROXY_TARGET,
        changeOrigin: true,
      },
    },
  },
})
