import { cp, mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stage = resolve(root, 'workspace/build/site');
const output = resolve(root, 'site');
function inside(path) {
  const rel = relative(root, path);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Invalid build target');
  return path;
}
await rm(inside(stage), { recursive: true, force: true });
await mkdir(stage, { recursive: true });
for (const app of ['web', 'comfyart']) {
  const result = spawnSync(process.execPath, [resolve(root, `frontend/${app}/node_modules/vite/bin/vite.js`), 'build'], {
    cwd: resolve(root, `frontend/${app}`),
    env: { ...process.env, SAIYAN_BUILD_OUTPUT: stage },
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
await cp(resolve(root, 'offline/client'), resolve(stage, 'offline'), { recursive: true });
await cp(resolve(root, 'offline/media'), resolve(stage, 'media'), { recursive: true });
await cp(resolve(root, 'offline/service-worker.js'), resolve(stage, 'service-worker.js'));
const snapshotHash=createHash('sha256').update(await readFile(resolve(root,'offline/client/snapshot.json'))).digest('hex');
const journeyHash=createHash('sha256').update(await readFile(resolve(root,'offline/client/journey.json'))).digest('hex');
await writeFile(resolve(stage,'service-worker.js'),(await readFile(resolve(root,'offline/service-worker.js'),'utf8'))+`\n// snapshot-data-sha256: ${snapshotHash}\n// journey-data-sha256: ${journeyHash}\n`);
for (const entry of ['index.html', 'comfyart/index.html']) {
  const path = resolve(stage, entry);
  const source = (await readFile(path, 'utf8')).replace(/\r\n?/g, '\n');
  let count = 0;
  let html = source.replace(/<script>[\s\S]*?<\/script>/g, '').replace(
    /<script type="module" crossorigin src="([^"]+)"><\/script>/g,
    (_, src) => { count++; return `<script src="/offline/runtime.js"></script>\n<script type="module" src="/offline/entry.js" data-entry="${src}"></script>`; },
  );
  if (count !== 1) throw new Error(`Missing application entry: ${entry}`);
  if (!html.includes('rel="icon"')) html = html.replace('</head>', '<link rel="icon" href="/logo.svg" /></head>');
  await writeFile(path, html.split('\n').map(line => line.trimEnd()).join('\n'));
}
await mkdir(resolve(stage, 'competitions'), { recursive: true });
await cp(resolve(stage, 'index.html'), resolve(stage, 'competitions/index.html'));
// A completed build replaces the preview only after all assets are ready.
const backup = resolve(root, `workspace/build/previous-${Date.now()}`);
let directoryLocked = false;
await rename(inside(output), inside(backup)).catch(async error => {
  if (error.code === 'ENOENT') return;
  if (!['EPERM','EBUSY'].includes(error.code)) throw error;
  // Windows can lock the served directory even after the server stops. Keep
  // a full recoverable copy, publish assets first, then switch entry files.
  await cp(inside(output), inside(backup), { recursive: true });
  directoryLocked = true;
});
if (directoryLocked) {
  const entries = ['index.html','competitions/index.html','comfyart/index.html','service-worker.js'];
  await cp(inside(stage), inside(output), { recursive: true, filter: path => !entries.some(entry => path === resolve(stage, entry)) });
  for (const entry of entries) await cp(resolve(stage, entry), resolve(output, entry));
  console.log('Served directory locked: backup retained; assets and entry files updated.');
} else await rename(inside(stage), inside(output));
console.log('Static site ready: site/');
