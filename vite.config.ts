import { defineConfig } from 'vite';

// Relative base so the build works from capacitor://localhost and any web path.
// `--mode artifact` builds a single-script page for a claude.ai Artifact.
export default defineConfig(({ mode }) => ({
  base: './',
  build: {
    target: 'es2020',
    ...(mode === 'artifact' && {
      outDir: 'dist-artifact',
      copyPublicDir: false,
      rollupOptions: { output: { inlineDynamicImports: true } },
    }),
  },
}));
