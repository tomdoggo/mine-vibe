import { defineConfig } from 'vite';

export default defineConfig({
  // 端口被占用时自动换下一个，终端里会打印实际地址
  // host: true = 同一 Wi-Fi 下的手机也能访问（终端里会打印 Network 地址）
  server: { port: 5176, open: true, host: true },
});
