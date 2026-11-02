import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const environment = path.join(root, 'workspace', 'competition-agent-venv');
const python = path.join(environment, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
function run(command, args) {
    const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
}
if (!existsSync(python)) run(process.env.PYTHON || 'python', ['-m', 'venv', environment]);
run(python, ['-m', 'pip', 'install', '-r', 'platform/competition-agent/requirements.txt']);
