import { defineConfig } from 'vite';

// GitHub Pages serves project sites from /<repo>/, so the base has to be
// configurable; everything else (worklet, sound bank) is built from it.
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  server: {
    proxy: { '/api': 'http://127.0.0.1:4174' },
    watch: { ignored: ['**/tools/**', '**/smoke-*.png'] },
  },
});
