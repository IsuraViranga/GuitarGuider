/// <reference types="vitest/config" />
import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // "npm run dev:phone" uses mode "phone": HTTPS with a self-signed certificate, because
  // phone browsers only allow the microphone on secure (https://) addresses.
  plugins: [react(), ...(mode === 'phone' ? [basicSsl()] : [])],
  server: {
    // Listen on the local network too, so a phone on the same Wi-Fi can open the app.
    host: true,
    port: mode === 'phone' ? 5174 : 5173,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
  },
}))
