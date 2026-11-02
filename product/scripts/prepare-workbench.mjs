import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const agentHome = path.join(projectRoot, 'workspace', 'canvas-agent');

export function prepareWorkbench() {
    const source = path.join(projectRoot, 'workspace', 'design-os.sqlite');
    const folder = path.join(projectRoot, 'workspace', 'migration');
    mkdirSync(folder, { recursive: true });
    if (!existsSync(source)) {
        const target = path.join(folder, 'import.json');
        if (!existsSync(target)) writeFileSync(target, JSON.stringify({ projects: [], assets: [], files: [] }));
        console.log('当前没有旧工作台数据库；保留已有导入包，从空画布开始 Pi 实验。');
        return;
    }
    const db = new DatabaseSync(source, { readOnly: true });
    try {
        const backup = path.join(folder, 'legacy-before-infinite-canvas.sqlite');
        if (!existsSync(backup)) db.prepare('VACUUM INTO ?').run(backup);
        const competitions = db.prepare('SELECT * FROM competitions ORDER BY created_at').all();
        const images = db.prepare('SELECT * FROM assets ORDER BY created_at').all();
        const tasks = db.prepare('SELECT * FROM generation_tasks ORDER BY created_at').all();
        const files = images.map((asset) => {
            const filename = path.resolve(projectRoot, 'workspace', 'competitions', asset.competition_id, 'generations', asset.filename);
            const base = path.resolve(projectRoot, 'workspace', 'competitions') + path.sep;
            if (!filename.startsWith(base)) throw new Error('图片路径不在原工作区内');
            return { storageKey: `image:legacy-${asset.id}`, dataUrl: `data:${asset.mime_type};base64,${readFileSync(filename).toString('base64')}` };
        });
        const assets = images.map((asset) => ({
            id: `legacy-${asset.id}`, kind: 'image', title: asset.prompt || asset.filename,
            coverUrl: '', tags: JSON.parse(asset.tags_json), source: '原竞赛工作台',
            note: asset.instruction, createdAt: asset.created_at, updatedAt: asset.created_at,
            data: { dataUrl: '', storageKey: `image:legacy-${asset.id}`, width: asset.width, height: asset.height, bytes: asset.file_size, mimeType: asset.mime_type },
            metadata: { ...asset, generation: tasks.find((task) => task.id === asset.generation_task_id) || null },
        }));
        const projects = competitions.map((competition) => {
            const items = images.filter((asset) => asset.competition_id === competition.id);
            const requirements = JSON.parse(competition.requirements_json || '{}');
            const specs = [requirements.width && requirements.height ? `${requirements.width} × ${requirements.height} ${requirements.unit || 'px'}` : '', requirements.dpi ? `${requirements.dpi} DPI` : '', requirements.formats?.join(' / ').toUpperCase(), requirements.maxFileSizeMb ? `不超过 ${requirements.maxFileSizeMb} MB` : ''].filter(Boolean).join(' · ');
            const nodes = items.map((asset, index) => ({
                id: `legacy-${asset.id}`, type: 'image', title: asset.prompt || asset.filename,
                position: { x: (index % 3) * 350, y: Math.floor(index / 3) * 460 },
                width: 300, height: 300 * (asset.height || 1) / (asset.width || 1),
                metadata: { content: '', storageKey: `image:legacy-${asset.id}`, status: 'success', naturalWidth: asset.width, naturalHeight: asset.height, mimeType: asset.mime_type, bytes: asset.file_size, prompt: asset.prompt, model: asset.model, references: asset.parent_asset_id ? [`image:legacy-${asset.parent_asset_id}`] : [] },
            }));
            nodes.push({ id: `brief-${competition.id}`, type: 'text', title: '竞赛 Brief 与投稿要求', position: { x: 0, y: Math.ceil(items.length / 3) * 460 }, width: 1000, height: 360, metadata: { content: `${competition.name}\n${competition.brief}\n截止：${competition.deadline || '未设定'}\n主办方：${competition.organizer}\n规格：${specs || '未设定'}\nAI 政策：${competition.ai_policy}${competition.source_url ? `\n来源：${competition.source_url}` : ''}`, fontSize: 18 } });
            return { id: `competition-${competition.id}`, title: competition.name, createdAt: competition.created_at, updatedAt: competition.created_at, nodes,
                connections: items.filter((asset) => items.some((parent) => parent.id === asset.parent_asset_id)).map((asset) => ({ id: `lineage-${asset.id}`, fromNodeId: `legacy-${asset.parent_asset_id}`, toNodeId: `legacy-${asset.id}` })),
                chatSessions: [], activeChatId: null, backgroundMode: 'dots', showImageInfo: false, viewport: { x: 40, y: 100, k: 0.65 },
            };
        });
        writeFileSync(path.join(folder, 'import.json'), JSON.stringify({ projects, assets, files }));
        console.log(`迁移就绪：${projects.length} 个竞赛、${assets.length} 张图片；原文件与数据库已保留。`);
    } finally { db.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) prepareWorkbench();
