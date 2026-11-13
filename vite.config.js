import process from 'node:process'
import { defineConfig } from 'vite'
import { weaponCandidatePlugin } from './tools/weapons/preview-assets.mjs'

export default defineConfig({
  root: 'src',
  publicDir: '../public',
  plugins: [
    weaponCandidatePlugin(process.env.WEAPON_PREVIEW_ROOT),
  ],
  server: {
    host: true,
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
})
