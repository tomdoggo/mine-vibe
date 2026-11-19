import { defineConfig, type Plugin } from 'vite';
import { createGhostMiddleware } from './server/ghostStore.ts';

/** 把幽灵卡组数据库接口挂到 dev / preview 服务器上 */
function ghostApi(): Plugin {
  let mw: ReturnType<typeof createGhostMiddleware> | undefined;
  const get = () => (mw ??= createGhostMiddleware('data/ghosts.db'));
  return {
    name: 'ghost-api',
    configureServer(server) { server.middlewares.use(get()); },
    configurePreviewServer(server) { server.middlewares.use(get()); },
  };
}

export default defineConfig({
  // host: true = 同一 Wi-Fi 下的手机也能打开（终端会打印 Network 地址）
  server: { port: 5177, host: true },
  preview: { port: 5177, host: true },
  plugins: [ghostApi()],
});
