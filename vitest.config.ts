import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// Vitest config for frontend unit + component tests. Kept separate from
// vite.config.ts so the Tauri dev server config (HMR, TAURI_DEV_HOST) does
// not leak into the test environment.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Restrict scan to `src/` so vitest does not try to load src-tauri test
    // files (those are Rust, run via `cargo test`).
    include: ['src/**/*.{test,spec}.{ts,tsx}']
  }
})
