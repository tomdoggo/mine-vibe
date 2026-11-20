import { defineConfig } from 'vite';

export default defineConfig({
  // host: true = 同一 Wi-Fi 下的手机也能打开（终端会打印 Network 地址）
  server: { port: 5178, host: true },
  preview: { port: 5178, host: true },
});
