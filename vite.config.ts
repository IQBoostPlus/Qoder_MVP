import { defineConfig, type Plugin, type PreviewServer, type ViteDevServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { createScenarioHttp } from './server/scenario-http.ts';

function localScenarioApi(): Plugin {
  function middleware(server: ViteDevServer | PreviewServer) {
    const api = createScenarioHttp(process.env);
    server.middlewares.use((request, response, next) => { void api.handle(request, response, next); });
    server.httpServer?.once('close', api.close);
  }
  return { name: 'd5-local-scenario-api', configureServer: middleware, configurePreviewServer: middleware };
}

export default defineConfig({
  base: './',
  plugins: [vue(), localScenarioApi()],
  server: { host: '127.0.0.1', port: 5173 },
  build: { outDir: 'dist', target: 'es2022' },
});
