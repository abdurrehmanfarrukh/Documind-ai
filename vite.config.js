import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Listen on all interfaces so http://localhost:5173 works reliably in an external browser
    host: true,
    port: 5173,
    strictPort: false,
    // Open your default OS browser (Chrome/Edge/etc.) when you run `npm run dev`
    open: true,
  },
})
