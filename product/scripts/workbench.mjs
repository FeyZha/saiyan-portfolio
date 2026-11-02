import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { prepareWorkbench, projectRoot, agentHome } from './prepare-workbench.mjs';

// Refuse to silently open a second origin: browser-local projects belong to port 3000.
async function requireFreePort(port) {
    await new Promise((resolve, reject) => {
        const probe = createServer();
        probe.once('error', () => reject(new Error(`端口 ${port} 已占用，请先停止本项目的旧服务。`)));
        probe.listen(port, '127.0.0.1', () => probe.close(resolve));
    });
}
await requireFreePort(3000);
await requireFreePort(17371);
prepareWorkbench();
const env = { ...process.env, CANVAS_AGENT_HOME: agentHome };
const agentArgs = process.argv.includes('--preview') ? ['dist/index.js'] : ['node_modules/tsx/dist/cli.mjs', 'src/index.ts'];
const agent = spawn(process.execPath, agentArgs, { cwd: path.join(projectRoot, 'platform/canvas-agent'), env, windowsHide: true });
agent.stdout.on('data', (chunk) => process.stdout.write(chunk.toString().replace(/Connect token:[^\r\n]*/g, 'Connect token: [自动连接，已隐藏]')));
agent.stderr.pipe(process.stderr);
const web = spawn(process.execPath, ['node_modules/vite/bin/vite.js', ...(process.argv.includes('--preview') ? ['preview'] : []), '--host', '127.0.0.1', '--port', '3000', '--strictPort'], { cwd: path.join(projectRoot, 'platform/web'), env, stdio: 'inherit', windowsHide: true });
let stopping = false;
function stop(code = 0) {
    if (stopping) return;
    stopping = true;
    for (const child of [agent, web]) {
        if (!child.pid || child.exitCode !== null) continue;
        if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        else child.kill();
    }
    process.exitCode = code;
}
for (const child of [agent, web]) {
    child.on('error', (error) => { console.error(error.message); stop(1); });
    child.on('exit', (code) => stop(code || 0));
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
