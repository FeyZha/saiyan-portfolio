import path from 'node:path';
import { PiCompetitionRuntime } from '../platform/pi-agent/runtime.ts';
import { createCompetitionIngestion } from '../platform/web/competition-ingestion.ts';
import { workbenchPlugin } from '../platform/web/workbench-plugin.ts';
import { createServer } from '../platform/web/node_modules/vite/dist/node/index.js';
import react from '../platform/web/node_modules/@vitejs/plugin-react/dist/index.js';

const root = process.cwd(), port = 3190;
const server = await createServer({ configFile: false, envFile: false, root: path.join(root, 'platform/web'),
    cacheDir: path.join(root, 'workspace/comfyart-runtime/vite-cache'),
    plugins: [react(), workbenchPlugin({ root, runtime: new PiCompetitionRuntime(root), ingestion: createCompetitionIngestion(root),
        handlerDependencies: { allowedAuthorities: [`127.0.0.1:${port}`, `localhost:${port}`],
            readBootstrap: async () => ({ projects: [], assets: [], files: [], competitionEngine: 'pi', cachedCompetitionBriefs: [], agent: { url: '', token: '' } }) } })],
    resolve: { alias: { '@': path.join(root, 'platform/web/src') } },
    define: { __APP_VERSION__: JSON.stringify('ComfyArt 创作版'), __APP_RELEASES__: '[]' },
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false, watch: { ignored: ['**/workspace/**'] } }, logLevel: 'warn' });
await server.listen();
console.log(`http://127.0.0.1:${port}/competitions`);
