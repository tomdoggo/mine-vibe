import { defineConfig } from 'vite';

export default defineConfig({
  // 相对路径，打包后放到任意子目录都能加载 public/assets
  base: './',
  server: {
    port: 5174,
    strictPort: false,
  },
  build: {
    target: 'es2020',
  },
});
