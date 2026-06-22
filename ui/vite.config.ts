import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const COMFY = 'http://127.0.0.1:8188'

export default defineConfig({
  plugins: [react()],
  base: '/peropixfy/',
  build: { outDir: '../web', emptyOutDir: true },
  server: {
    proxy: {
      '/prompt': COMFY,
      '/history': COMFY,
      '/view': COMFY,
      '/upload': COMFY,
      '/object_info': COMFY,
      '/models': COMFY,
      '/queue': COMFY,
      '/interrupt': COMFY,
      '/peropixfy/api': COMFY,
      '/ws': { target: COMFY, ws: true },
    },
  },
})
