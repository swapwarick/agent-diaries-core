import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/**/*.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  target: 'es2022',
  outDir: 'dist',
  splitting: false,
  tsconfig: './tsconfig.json',
});
