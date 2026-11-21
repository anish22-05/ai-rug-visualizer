/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In development, proxy API + static rug images to the FastAPI backend so the app
// is same-origin (no CORS setup needed locally).
const backend = process.env.VITE_DEV_BACKEND ?? 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': backend,
      '/static': backend,
    },
  },
  test: {
    environment: 'node',
  },
})
