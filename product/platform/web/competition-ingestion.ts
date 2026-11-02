import { CODEX_MODEL, assertCodexConfig } from "../pi-agent/product-model";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { readCompetitionLibrary, readLibraryCompetition } from "../pi-agent/competition-library";
import { enrichCompetitionSixFields } from "../pi-agent/six-field-ingestion";
import type { PiModelConfig } from "../pi-agent/model";

type IngestionInput = Record<string, unknown> & { action: "drainQueue" };
export type IngestionRunner = (input: Record<string, unknown>) => Promise<string>;
export type CompetitionIngestionDependencies = {
    loadModelConfig?: () => Promise<PiModelConfig>;
    enrichOne?: typeof enrichCompetitionSixFields;
};
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const message = (error: unknown, apiKey?: unknown) => {
    const text = (error instanceof Error ? error.message : String(error)).replace(/Bearer\s+\S+|\bsk-[A-Za-z0-9_-]+/gi, "[凭据已隐藏]");
    return typeof apiKey === "string" && apiKey ? text.split(apiKey).join("[凭据已隐藏]") : text;
};
const runningProjects = new Set<string>();

/** Archived entry point: old DeepSeek evaluation scripts fail before reading credentials. */
export async function readPreparedDeepSeekConfig(root: string, options: { files?: readonly string[] } = {}): Promise<PiModelConfig> {
    throw new Error("旧 DeepSeek 评测入口已停用；请使用 pi:eval 的 Codex 登录通道。");
}

function validateInput(input: unknown): IngestionInput {
    if (!object(input) || input.action !== "drainQueue") throw new Error("当前仅支持新竞赛增量入库；旧认定目录和意图识别入口已停用。");
    if (input.forceCheck !== undefined && typeof input.forceCheck !== "boolean") throw new Error("竞赛检查参数无效");
    if (["provider", "apiKey", "baseUrl", "apiFormat", "model", "mode"].some(key => input[key] !== undefined) || input.sourceOnly === false)
        throw new Error("新竞赛入库只用 Codex 登录额度，不接受外部模型配置");
    return { action: "drainQueue", forceCheck: input.forceCheck === true, sourceOnly: true };
}

/** Keep the original Python ingestion pipeline; this bridge never invokes recognizeIntent. */
export function createCompetitionIngestion(root: string, injectedRunner?: IngestionRunner, dependencies: CompetitionIngestionDependencies = {}) {
    const projectKey = process.platform === "win32" ? path.resolve(root).toLowerCase() : path.resolve(root);
    const reportFile = path.join(root, "workspace/competition-sources/shejijingsai-report.json");
    const runAgent: IngestionRunner = injectedRunner || (input => new Promise((resolve, reject) => {
        const python = path.join(root, "workspace/competition-agent-venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
        const childEnv: NodeJS.ProcessEnv = { ...process.env, PYTHONIOENCODING: "utf-8", COMPETITION_REPORT_FILE: reportFile };
        for (const key of Object.keys(childEnv)) {
            if (/^(?:DEEPSEEK|OPENAI|ANTHROPIC|CODEX)_.*(?:API_KEY|TOKEN)$/i.test(key)) delete childEnv[key];
        }
        const child = spawn(process.env.PYTHON || (existsSync(python) ? python : "python"), [path.join(root, "platform/competition-agent/agent.py")], {
            cwd: root, env: childEnv,
            windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
        });
        let stdout = "", stderr = "";
        child.stdout.on("data", chunk => { stdout += chunk; });
        child.stderr.on("data", chunk => { stderr += chunk; });
        child.stdin.on("error", error => reject(new Error(`竞赛入库进程输入失败：${message(error, input.apiKey)}`)));
        child.on("error", error => reject(new Error(`无法启动 Python：${message(error, input.apiKey)}；请运行 npm run setup:ingestion`)));
        child.on("close", code => {
            if (code === 0) resolve(stdout);
            else if (stderr.includes("ModuleNotFoundError")) reject(new Error("竞赛入库 Python 依赖未准备好，请运行 npm run setup:ingestion"));
            else reject(new Error(message(stderr.trim().split("\n").at(-1) || "竞赛入库运行失败", input.apiKey)));
        });
        child.stdin.end(JSON.stringify(input));
    }));
    let active: Promise<void> | null = null;
    let checking = false, importing = false;
    let updateError = "", checkError = "";
    let lastUpdate: { id: string; processed: number; failed: number; collected?: number; issues?: string[]; completedAt?: string } | undefined;

    const feed = async () => {
        const library = await readCompetitionLibrary(root);
        const discovery = object(library.discovery) ? library.discovery : {};
        const queue = Array.isArray(discovery.queue) ? discovery.queue : [];
        return { ...library, checking, importing, updating: Boolean(active) && !importing,
            queuedCount: queue.filter(entry => object(entry) && !entry.lastError).length,
            failedCount: queue.filter(entry => object(entry) && entry.lastError).length,
            checkError: checkError || (typeof discovery.checkError === "string" ? discovery.checkError : ""), updateError, lastUpdate,
            discovery: { checkedOn: discovery.checkedOn, checkedAt: discovery.checkedAt, lastBatch: discovery.lastBatch } };
    };

    const run = async (value: unknown): Promise<{ status: number; body: unknown }> => {
        const input = validateInput(value);
        if (runningProjects.has(projectKey)) throw new Error("竞赛资料正在入库，请完成后再导入或更新");
        runningProjects.add(projectKey);
        let startingLibrary: Awaited<ReturnType<typeof readCompetitionLibrary>>;
        try { startingLibrary = await readCompetitionLibrary(root); } // Refuse damaged input before starting the original writer.
        catch (error) { runningProjects.delete(projectKey); throw error; }
        updateError = "";
        let modelConfig: Promise<PiModelConfig> | undefined, secret: string | undefined;
        // Called only inside the extractor after its durable once claim; browsing, cached and failed attempts never read credentials.
        const loadModelConfig = () => modelConfig ||= (dependencies.loadModelConfig || (async () => CODEX_MODEL))().then(config => {
            assertCodexConfig(config); return config;
        });
        const existing = [startingLibrary.items, startingLibrary.pending, startingLibrary.ignored].flat();
        const existingIds = new Set(existing.map(item => item.libraryId)), existingUrls = new Set(existing.map(item => item.sourceUrl));
        const result = { id: randomUUID(), processed: 0, failed: 0, collected: 0, issues: [] as string[] };
        lastUpdate = result;
        active = (async () => {
            checking = true;
            checkError = "";
            try { await runAgent({ action: "checkUpdates", forceCheck: input.forceCheck, preserveExisting: true }); }
            catch (error) { checkError = message(error, secret); }
            finally { checking = false; }
            const library = await readCompetitionLibrary(root);
            const discovery = object(library.discovery) ? library.discovery : {};
            const queued = Array.isArray(discovery.queue) ? discovery.queue.filter(entry => object(entry) && !entry.lastError && object(entry.candidate)
                && typeof entry.candidate.id === "string" && !existingIds.has(entry.candidate.id) && !existingUrls.has(entry.candidate.sourceUrl)) : [];
            for (const entry of queued) {
                const candidate = (entry as { candidate: { id: string } }).candidate;
                try {
                    const saved = JSON.parse(await runAgent({ action: "drainQueue", sourceOnly: true, competitionId: candidate.id, primaryOnly: true }));
                    if (saved.discovery?.lastBatch?.failed) throw new Error("竞赛正文采集未完成，失败资料已保留");
                    const { competition } = await readLibraryCompetition(root, candidate.id);
                    if (competition.ingestionMode !== "source" || existingIds.has(competition.libraryId)) throw new Error("拒绝整理已有竞赛或无效的新原文条目");
                    result.collected++;
                    const indexed = await (dependencies.enrichOne || enrichCompetitionSixFields)(root, candidate.id, loadModelConfig, {
                        appendSourceResources: async (current, resources) => {
                            if (existingIds.has(current.libraryId)) throw new Error("不能补写旧资料");
                            await runAgent({ action: "appendSourceResources", competitionId: current.libraryId, expectedSourceVersion: current.sourceVersion, resources });
                            return (await readLibraryCompetition(root, current.libraryId)).competition;
                        },
                    });
                    if (indexed.status !== "indexed" && indexed.status !== "already_indexed") throw new Error("原文已保留，作品类型、费用和截止时间整理未完成；请查看入库记录");
                    result.processed++;
                } catch (error) {
                    result.failed++;
                    const detail = message(error, secret);
                    result.issues.push(`${candidate.id}：${detail}`);
                    updateError = result.issues.join("；");
                }
            }
        })().catch(error => { updateError = message(error, secret); }).finally(() => {
            lastUpdate = { ...result, completedAt: new Date().toISOString() };
            active = null;
            runningProjects.delete(projectKey);
        });
        return { status: 202, body: await feed() };
    };
    return { feed, run };
}

export type CompetitionIngestion = ReturnType<typeof createCompetitionIngestion>;
