import { localForageStorage } from '@/lib/localforage-storage';
import { competitionCreativeBrief, compactCompetitionCreativeBrief, legacyCompetitionCreativeBrief, previousBoardCompetitionCreativeBrief, previousCompetitionCreativeBrief } from '@/lib/competition-brief';
import { resolveImageUrl, setImageBlob } from '@/services/image-storage';
import { useAgentStore } from '@/stores/use-agent-store';
import type { CanvasProject } from '@/stores/canvas/use-canvas-store';
import type { CanvasNodeData } from '@/types/canvas';
import type { Asset } from '@/stores/use-asset-store';
import type { CompetitionWorkspace, WorkspaceStatus } from '@/types/workspace';

type CachedCompetitionBrief = { id: string; sourceUrl: string; themeTask: string };
type Bootstrap = { projects: CanvasProject[]; assets: Asset[]; files: { storageKey: string; dataUrl: string }[]; agent: { url: string; token: string }; competitionEngine?: string; cachedCompetitionBriefs?: CachedCompetitionBrief[] };

export async function bootstrapWorkbench() {
    const response = await fetch('/__workbench/bootstrap', { cache: 'no-store' });
    if (!response.ok) throw new Error('本地工作台未就绪，请从项目根目录启动后刷新。');
    const data: Bootstrap = await response.json();
    // Import once per browser before the upstream stores hydrate; never replace a user's saved canvas.
    if (!await localForageStorage.getItem('competition-workbench:imported')) {
        const canvasKey = 'infinite-canvas:canvas_store';
        const assetKey = 'infinite-canvas:asset_store';
        const savedCanvas = JSON.parse(await localForageStorage.getItem(canvasKey) || '{"state":{"projects":[],"deletedProjects":[]},"version":0}');
        const savedAssets = JSON.parse(await localForageStorage.getItem(assetKey) || '{"state":{"assets":[]},"version":0}');
        const existingIds = new Set(savedCanvas.state.projects.map((project: CanvasProject) => project.id));
        const missing = data.projects.filter((project) => !existingIds.has(project.id) && !savedCanvas.state.deletedProjects?.some((item: { id: string }) => item.id === project.id));
        const assetIds = new Set(savedAssets.state.assets.map((asset: Asset) => asset.id));
        for (const file of data.files) {
            const existingUrl = assetIds.has(file.storageKey.replace('image:', '')) ? await resolveImageUrl(file.storageKey, '') : '';
            const url = existingUrl || await setImageBlob(file.storageKey, await (await fetch(file.dataUrl)).blob());
            for (const project of missing) for (const node of project.nodes) {
                if (node.metadata?.storageKey === file.storageKey) node.metadata.content = url;
            }
            const asset = data.assets.find((asset) => asset.kind === 'image' && asset.data.storageKey === file.storageKey);
            if (asset?.kind === 'image') { asset.coverUrl = url; asset.data.dataUrl = url; }
        }
        await localForageStorage.setItem(canvasKey, JSON.stringify({ ...savedCanvas, state: { ...savedCanvas.state, projects: [...savedCanvas.state.projects, ...missing] } }));
        await localForageStorage.setItem(assetKey, JSON.stringify({ ...savedAssets, state: { ...savedAssets.state, assets: [...savedAssets.state.assets, ...data.assets.filter((asset) => !assetIds.has(asset.id))] } }));
        await localForageStorage.setItem('competition-workbench:imported', '1');
    }
    await bootstrapWorkspaces(Array.isArray(data.cachedCompetitionBriefs) ? data.cachedCompetitionBriefs : [], data.competitionEngine === 'pi');
    const agent = useAgentStore.getState();
    agent.setAgentState({ url: data.agent.url, token: data.agent.token, activeTab: 'chat' });
    agent.openPanel();
    agent.connectAgent({ silent: true });
}

async function bootstrapWorkspaces(cachedCompetitionBriefs: CachedCompetitionBrief[] = [], piExperiment = false) {
    const importedKey = 'competition-workbench:workspaces-imported';
    const workspaceKey = 'competition-workbench:workspace_store';
    const canvasKey = 'infinite-canvas:canvas_store';
    const assetKey = 'infinite-canvas:asset_store';
    const existing = await localForageStorage.getItem(workspaceKey);
    if (existing) {
        const saved = JSON.parse(existing);
        const state = saved.state as { workspaces: CompetitionWorkspace[]; currentWorkspaceId: string };
        const savedCanvas = JSON.parse(await localForageStorage.getItem(canvasKey) || '{"state":{"projects":[]},"version":0}');
        const changed = piExperiment ? { workspaces: false, projects: false } : await reuseCreativeBriefs(state.workspaces, savedCanvas.state.projects, cachedCompetitionBriefs);
        if (changed.workspaces) await localForageStorage.setItem(workspaceKey, JSON.stringify(saved));
        if (changed.projects) await localForageStorage.setItem(canvasKey, JSON.stringify(savedCanvas));
        return state.workspaces.find((workspace) => workspace.id === state.currentWorkspaceId)?.canvasProjectId || state.workspaces[0]?.canvasProjectId || '';
    }
    if (await localForageStorage.getItem(importedKey)) return '';

    const savedCanvas = JSON.parse(await localForageStorage.getItem(canvasKey) || '{"state":{"projects":[],"deletedProjects":[]},"version":0}');
    const projects = savedCanvas.state.projects as CanvasProject[];
    const samples = piExperiment ? [] : [
        { id: 'competition-tokyo-visual-award', title: '东京视觉奖', deadline: '2026-10-15', brief: '围绕城市与未来生活完成视觉提案，保留概念、过程与最终输出。' },
        { id: 'competition-poster-100', title: 'Poster 100', deadline: '2026-11-08', brief: '以公共议题为主题完成系列海报，并整理设计说明与提交文件。' },
    ];
    for (const sample of samples) {
        if (projects.length >= 3) break;
        if (!projects.some((project) => project.id === sample.id)) projects.push(createWorkspaceCanvas(sample));
    }
    const statuses: WorkspaceStatus[] = ['working', 'review_required', 'not_started'];
    const nextActions = ['继续完善当前方案', '查看生成结果', '整理竞赛 Brief'];
    const now = new Date().toISOString();
    const workspaces = projects.map<CompetitionWorkspace>((project, index) => ({
        id: `workspace-${project.id}`,
        competitionId: project.id.replace(/^competition-/, ''),
        title: project.title,
        deadline: project.nodes.find((node) => node.type === 'text')?.metadata?.content?.match(/截止：([^\n]+)/)?.[1] || samples.find((sample) => sample.id === project.id)?.deadline,
        brief: project.nodes.find((node) => node.type === 'text')?.metadata?.content || samples.find((sample) => sample.id === project.id)?.brief,
        themeTask: samples.find((sample) => sample.id === project.id)?.brief,
        status: piExperiment ? 'not_started' : statuses[index] || 'not_started',
        nextAction: piExperiment ? '打开画布' : nextActions[index] || '整理竞赛 Brief',
        canvasProjectId: project.id,
        createdAt: project.createdAt || now,
        updatedAt: project.updatedAt || now,
    }));
    if (!piExperiment) await reuseCreativeBriefs(workspaces, projects, cachedCompetitionBriefs);
    const currentWorkspaceId = workspaces[0]?.id || '';
    await localForageStorage.setItem(workspaceKey, JSON.stringify({ state: { workspaces, currentWorkspaceId }, version: 0 }));
    await localForageStorage.setItem(canvasKey, JSON.stringify({ ...savedCanvas, state: { ...savedCanvas.state, projects } }));

    const savedAssets = JSON.parse(await localForageStorage.getItem(assetKey) || '{"state":{"assets":[]},"version":0}');
    savedAssets.state.assets = (savedAssets.state.assets as Asset[]).map((asset) => {
        const competitionId = String(asset.metadata?.competition_id || '');
        const workspaceId = workspaces.find((workspace) => workspace.competitionId === competitionId)?.id || currentWorkspaceId;
        return { ...asset, workspaceId };
    });
    await localForageStorage.setItem(assetKey, JSON.stringify(savedAssets));
    await localForageStorage.setItem(importedKey, '1');
    return workspaces[0]?.canvasProjectId || '';
}

function createWorkspaceCanvas(sample: { id: string; title: string; deadline: string; brief: string }): CanvasProject {
    const now = new Date().toISOString();
    return {
        id: sample.id,
        title: sample.title,
        createdAt: now,
        updatedAt: now,
        nodes: [{ id: `brief-${sample.id}`, type: 'text', title: '创作目标', position: { x: 80, y: 120 }, width: 760, height: 300, metadata: { content: competitionCreativeBrief(sample.brief), fontSize: 18 } }],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: 'dots',
        showImageInfo: false,
        viewport: { x: 40, y: 80, k: 0.8 },
    };
}

export function refreshCreativeGoal(node: CanvasNodeData, workspace: CompetitionWorkspace): CanvasNodeData {
    if (node.type !== 'text' || node.title !== '创作目标' || ![`brief-${workspace.canvasProjectId}`, `brief-${workspace.competitionId}`].includes(node.id)
        || !workspace.themeTask?.trim() || workspace.themeTask.trim() === '未公布') return node;
    const content = node.metadata?.content || '';
    const next = competitionCreativeBrief(workspace.themeTask, workspace.submissionFormat, workspace.finalSubmissionFormat, workspace.creativeContent);
    // Earlier compact cards kept only the first task paragraph; match that exact generated text too.
    const oldBriefs = [previousBoardCompetitionCreativeBrief(workspace.themeTask, workspace.submissionFormat, workspace.finalSubmissionFormat), previousCompetitionCreativeBrief(workspace.themeTask, workspace.submissionFormat), legacyCompetitionCreativeBrief(workspace.themeTask), legacyCompetitionCreativeBrief(workspace.themeTask, workspace.submissionFormat),
        compactCompetitionCreativeBrief(workspace.themeTask, workspace.submissionFormat), compactCompetitionCreativeBrief(workspace.themeTask.split(/\r?\n/)[0], workspace.submissionFormat)];
    if (content === next || !oldBriefs.includes(content)) return node;
    return { ...node, metadata: { ...node.metadata, content: next } };
}

async function reuseCreativeBriefs(workspaces: CompetitionWorkspace[], projects: CanvasProject[], cachedCompetitionBriefs: CachedCompetitionBrief[]) {
    const changed = { workspaces: false, projects: false };
    // Only reformat an exact generated goal; edited text, deleted nodes and canvas geometry stay intact.
    for (const workspace of workspaces) {
        const project = projects.find((item) => item.id === workspace.canvasProjectId);
        if (!project) continue;
        project.nodes = project.nodes.map((node) => {
            const next = refreshCreativeGoal(node, workspace);
            if (next !== node) changed.projects = true;
            return next;
        });
    }
    workspaces = workspaces.filter((workspace) => !workspace.directionId);
    type Report = Pick<CompetitionWorkspace, 'themeTask' | 'sourceUrl' | 'organizer' | 'designTypes' | 'fee'> & { id: string; sourceUrls?: string[] };
    const knownTheme = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim()) && value.trim() !== '未公布';
    let reports: Report[] = [];
    if (workspaces.some((workspace) => !knownTheme(workspace.themeTask) || !workspace.sourceUrl)) try {
        const response = await fetch('/__workbench/competitions', { cache: 'no-store' });
        if (response.ok) {
            const feed = await response.json();
            reports = [...(Array.isArray(feed.items) ? feed.items : []), ...(Array.isArray(feed.pending) ? feed.pending : [])];
        }
    } catch { /* A cached canvas remains usable when discovery is offline. */ }
    const briefs = workspaces.map((workspace) => {
        const project = projects.find((item) => item.id === workspace.canvasProjectId);
        const node = project?.nodes.find((item) => item.type === 'text' && [
            `brief-${workspace.canvasProjectId}`, `brief-${workspace.competitionId}`,
        ].includes(item.id));
        const content = node?.metadata?.content || '';
        return { workspace, node, content };
    });
    for (const { workspace, node, content } of briefs) {
        // Sibling tasks share the original discovery source even when a later task omitted its URL.
        const siblings = briefs.filter((entry) => entry.workspace.competitionId === workspace.competitionId);
        const sources = siblings.flatMap((entry) => [entry.workspace.sourceUrl,
            ...Array.from([entry.workspace.brief || '', entry.content].join('\n').matchAll(/^(?:竞赛原文|来源)：\s*(https?:\/\/\S+)\s*$/gm), (match) => match[1]),
        ].filter((source): source is string => Boolean(source)));
        const matching = (items: Report[]) => items.find((item) => item?.id === workspace.competitionId)
            || items.find((item) => sources.some((url) => item?.sourceUrl === url || (Array.isArray(item?.sourceUrls) && item.sourceUrls.includes(url))));
        const report = matching(reports);
        const cached = matching(cachedCompetitionBriefs);
        const sourceText = siblings.map((entry) => [entry.workspace.brief, entry.content].filter(Boolean).join('\n\n')).join('\n\n');
        const field = (label: string) => sourceText.match(new RegExp(`(?:^|\\n)${label}：[ \\t]*([^\\n]+(?:\\n[^\\n]+)*?)(?=\\n\\n|$)`))?.[1].trim();
        const metadata = {
            sourceUrl: report?.sourceUrl || cached?.sourceUrl || sources[0],
            organizer: report?.organizer || sourceText.match(/^主办方：[ \t]*([^\n]+)/m)?.[1].trim(),
            designTypes: report?.designTypes || field('平面赛道')?.split('、').filter(Boolean),
            fee: report?.fee || field('报名费用'),
        };
        for (const key of ['sourceUrl', 'organizer', 'designTypes', 'fee'] as const) {
            const value = metadata[key] || siblings.find((entry) => entry.workspace[key])?.workspace[key];
            if (value && !workspace[key]) {
                Object.assign(workspace, { [key]: value }); changed.workspaces = true;
            }
        }
        const themeTask = [workspace.themeTask, report?.themeTask, cached?.themeTask,
            ...siblings.map((entry) => entry.workspace.themeTask),
            ...siblings.map((entry) => entry.workspace.brief?.match(/(?:^|\n\n)主题与任务：\n([\s\S]*?)(?=\n\n提交清单：)/)?.[1]),
        ].find(knownTheme)?.trim();
        if (themeTask && workspace.themeTask !== themeTask) { workspace.themeTask = themeTask; changed.workspaces = true; }
        if (!node) continue;
        if (node.title !== '创作目标' || content !== competitionCreativeBrief()) {
            if (node.title !== '竞赛 Brief 与投稿要求' || !workspace.brief) continue;
            const prefix = [workspace.title, workspace.brief].filter(Boolean).join('\n\n');
            const suffix = content.startsWith(prefix) ? content.slice(prefix.length) : undefined;
            const autoFields = suffix?.match(/^(?:\n\n主办方：[^\n]+)?(?:\n\n截止：([^\n]+))?(?:\n\n发现 Agent：[^\n]+)?(?:\n\n竞赛原文：https?:\/\/[^\s]+)?$/);
            if (content !== workspace.brief && (!autoFields || (autoFields[1] !== undefined && autoFields[1] !== workspace.deadline))) continue;
        }
        const creativeBrief = competitionCreativeBrief(themeTask, workspace.submissionFormat, workspace.finalSubmissionFormat);
        if (node.title === '创作目标' && content === creativeBrief) continue;
        node.title = '创作目标';
        node.metadata = { ...node.metadata, content: creativeBrief };
        if (workspace.status === 'not_started' && ['整理竞赛 Brief', '明确创作目标'].includes(workspace.nextAction || '')) {
            workspace.nextAction = themeTask ? '开始构思作品' : '明确创作目标'; changed.workspaces = true;
        }
        changed.projects = true;
    }
    return changed;
}
