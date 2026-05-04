import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: ['code-editor.up.railway.app'],
  },
  preview: {
    allowedHosts: ['code-editor.up.railway.app'],
    host: '0.0.0.0',
    port: 4173,
  },
})
