import { defineConfig } from 'vite';

// Relative base so the build works from capacitor://localhost and any web path.
export default defineConfig({
  base: './',
  build: { target: 'es2020' },
});
