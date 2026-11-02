import { CODEX_MODEL, assertCodexConfig } from "../pi-agent/product-model";
import { streamProductText } from "../pi-agent/product-text";
import { readdirSync, readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin, Connect } from "vite";
import { PiCompetitionRuntime } from "../pi-agent/runtime";
import { readCompetitionLibrary } from "../pi-agent/competition-library";
import { createCompetitionIngestion, type CompetitionIngestion } from "./competition-ingestion";
import type { PiModelConfig } from "../pi-agent/model";
import { streamPiRun } from "./pi-run-stream";
import { readComfyArtHandoff, saveComfyArtHandoff } from "./comfyart-handoff";


function readCachedCompetitionBriefs(root: string) {
    const folder = path.join(root, "workspace", "competition-sources", "details");
    let files: string[];
    try { files = readdirSync(folder); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn("无法读取已缓存竞赛详情，跳过创作目标补全");
        return [];
    }
    return files.filter((file) => /^\d+\.json$/.test(file)).flatMap((file) => {
        try {
            const saved = JSON.parse(readFileSync(path.join(folder, file), "utf8"));
            if (saved?.version !== 1 || typeof saved.id !== "string" || saved.id !== file.slice(0, -5) || typeof saved.sourceUrl !== "string"
                || !["http:", "https:"].includes(new URL(saved.sourceUrl).protocol)) throw new Error("竞赛详情格式无效");
            if (saved.themeTask === undefined) return [];
            if (typeof saved.themeTask !== "string") throw new Error("创作目标格式无效");
            return saved.themeTask.trim() ? [{ id: saved.id, sourceUrl: saved.sourceUrl, themeTask: saved.themeTask }] : [];
        } catch {
            console.warn(`已缓存竞赛详情 ${file} 无效，跳过创作目标补全`);
            return [];
        }
    });
}

async function readJson(req: IncomingMessage) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export type PiHttpRuntime = Pick<PiCompetitionRuntime, "getStatus" | "listSessions" | "getSession" | "start" | "cancel" | "getRun">
    & Partial<Pick<PiCompetitionRuntime, "getRunView" | "getSessionView" | "subscribeView" | "getRecommendationTask">>;
export type PiPresetAvailability = {
    available: boolean;
    requiresValidation: boolean;
    source: "environment" | "project" | "parent" | null;
    reason: string;
};
export type PiHandlerDependencies = {
    resolveText?: typeof streamProductText;
    loadCodexConfig?: (root: string) => Promise<PiModelConfig>;
    loadPreparedDeepSeekConfig?: (root: string) => Promise<PiModelConfig>;
    presetAvailability?: (root: string) => PiPresetAvailability | Promise<PiPresetAvailability>;
    allowedAuthorities?: readonly string[];
    readBootstrap?: (root: string) => unknown | Promise<unknown>;
};

export function readPiPresetAvailability(root: string): PiPresetAvailability {
    return { available: true, requiresValidation: true, source: null,
        reason: "使用本机 Codex 登录，发送时检查登录与账户额度。" };
}

function localAuthorities(dependencies: PiHandlerDependencies) {
    const authorities = dependencies.allowedAuthorities || ["localhost:3000", "127.0.0.1:3000", "[::1]:3000"];
    if (!authorities.length || authorities.some(authority => {
        if (!/^(?:localhost|127\.0\.0\.1|\[::1\]):\d{1,5}$/.test(authority)) return true;
        const port = Number(authority.slice(authority.lastIndexOf(":") + 1));
        return port < 1 || port > 65535;
    })) throw new Error("Pi 工作台只允许明确指定的本机端口。");
    return authorities;
}

export function createPiHandler(root: string, runtime: PiHttpRuntime = new PiCompetitionRuntime(root), ingestion: CompetitionIngestion = createCompetitionIngestion(root), dependencies: PiHandlerDependencies = {}): Connect.NextHandleFunction {
    const authorities = localAuthorities(dependencies);
    return async (req, res, next) => {
        const host = req.headers.host || "";
        const url = new URL(req.url || "/", "http://localhost:3000");
        if (!url.pathname.startsWith("/__workbench/pi/") && !["/__workbench/bootstrap", "/__workbench/competitions"].includes(url.pathname)) return next();
        const origin = req.headers.origin;
        if (!authorities.includes(host) || (origin && origin !== `http://${host}`) || req.headers["sec-fetch-site"] === "cross-site") {
            res.statusCode = 403;
            res.end("仅允许本机工作台访问");
            return;
        }
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        const send = (value: unknown, status = 200) => { res.statusCode = status; res.end(JSON.stringify(value)); };
        try {
            if (url.pathname === "/__workbench/pi/comfyart" && req.method === "POST") {
                if (!runtime.getRecommendationTask) throw new Error("当前入口不能核验创作任务。");
                const input = await readJson(req);
                const artifact = await runtime.getRecommendationTask(input.runId, input.artifactId, input.scopePointer, input.choiceId);
                if (!artifact) { send({ error: "任务已不可用，请重新查询。" }, 409); return; }
                send(await saveComfyArtHandoff(root, artifact));
                return;
            }
            const handoffMatch = url.pathname.match(/^\/__workbench\/pi\/comfyart\/handoffs\/([^/]+)$/);
            if (handoffMatch && req.method === "GET") {
                send(await readComfyArtHandoff(root, handoffMatch[1]));
                return;
            }
            if (url.pathname === "/__workbench/competitions") {
                if (req.method === "GET") send(await ingestion.feed());
                else if (req.method === "POST") {
                    const result = await ingestion.run(await readJson(req));
                    send(result.body, result.status);
                } else send({ error: "不支持的请求方法" }, 405);
                return;
            }
            if (url.pathname === "/__workbench/bootstrap" && req.method === "GET") {
                if (dependencies.readBootstrap) { send(await dependencies.readBootstrap(root)); return; }
                const migration = JSON.parse(readFileSync(path.join(root, "workspace/migration/import.json"), "utf8"));
                const config = JSON.parse(readFileSync(path.join(process.env.CANVAS_AGENT_HOME || path.join(root, "workspace/canvas-agent"), "canvas-agent.json"), "utf8"));
                send({ ...migration, competitionEngine: "pi", cachedCompetitionBriefs: readCachedCompetitionBriefs(root), agent: { url: config.url, token: config.token } });
                return;
            }
            if (url.pathname === "/__workbench/pi/status" && req.method === "GET") {
                const library = await readCompetitionLibrary(root);
                send({ ...await runtime.getStatus(), preset: await (dependencies.presetAvailability || readPiPresetAvailability)(root),
                    library: { items: library.items.length, pending: library.pending.length, ignored: library.ignored.length } });
                return;
            }
            if (url.pathname === "/__workbench/pi/sessions" && req.method === "GET") {
                send({ sessions: await runtime.listSessions() });
                return;
            }
            const sessionMatch = url.pathname.match(/^\/__workbench\/pi\/sessions\/([^/]+)$/);
            if (sessionMatch && req.method === "GET") {
                const id = decodeURIComponent(sessionMatch[1]);
                const session = url.searchParams.get("view") === "compact" && runtime.getSessionView
                    ? await runtime.getSessionView(id) : await runtime.getSession(id);
                send(session ?? { error: "会话不存在" }, session ? 200 : 404);
                return;
            }
            if (url.pathname === "/__workbench/pi/text" && req.method === "POST") {
                const input = await readJson(req);
                // Validate before opening the SSE response; no tools or source access.
                const task = await (dependencies.resolveText || streamProductText)(input.messages);
                res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
                const abort = () => task.abort();
                res.on("close", abort);
                try {
                    for await (const event of task.events) res.write(`data: ${JSON.stringify(event)}\n\n`);
                } finally { res.off("close", abort); res.end(); }
                return;
            }
            if (url.pathname === "/__workbench/pi/runs" && req.method === "POST") {
                const input = await readJson(req);
                if (input?.config?.mode === "preset" && Object.keys(input.config).some(key => key !== "mode"))
                    throw new Error("Codex 通道不接受浏览器密钥、地址或模型覆盖。");
                input.config = await (dependencies.loadCodexConfig || (async () => CODEX_MODEL))(root);
                assertCodexConfig(input.config);
                const run = await runtime.start(input);
                send(url.searchParams.get("view") === "compact" && runtime.getRunView ? await runtime.getRunView(run.runId) : run, 202);
                return;
            }
            const streamMatch = url.pathname.match(/^\/__workbench\/pi\/runs\/([^/]+)\/stream$/);
            if (streamMatch && req.method === "GET") {
                if (!runtime.getRunView || !runtime.subscribeView) { send({ error: "当前运行不支持流式展示" }, 501); return; }
                await streamPiRun(res, { getRunView: runtime.getRunView.bind(runtime), subscribeView: runtime.subscribeView.bind(runtime) }, decodeURIComponent(streamMatch[1]));
                return;
            }
            const taskMatch = url.pathname.match(/^\/__workbench\/pi\/runs\/([^/]+)\/artifacts\/([^/]+)\/task$/);
            if (taskMatch && req.method === "GET") {
                if (!runtime.getRecommendationTask) { send({ error: "当前任务不支持版本校验，请重新查询。" }, 409); return; }
                try {
                    const artifact = await runtime.getRecommendationTask(decodeURIComponent(taskMatch[1]), decodeURIComponent(taskMatch[2]), url.searchParams.has("scopePointer") ? url.searchParams.get("scopePointer")! : undefined, url.searchParams.get("choiceId") ?? undefined);
                    send(artifact ? { artifact } : { error: "运行记录不存在，请重新查询。" }, artifact ? 200 : 404);
                } catch (error) {
                    send({ error: error instanceof Error ? error.message : "任务资料已变化，请重新查询后再进入创作。" }, 409);
                }
                return;
            }
            const runMatch = url.pathname.match(/^\/__workbench\/pi\/runs\/([^/]+)(\/cancel)?$/);
            if (runMatch && ((req.method === "GET" && !runMatch[2]) || (req.method === "POST" && runMatch[2]))) {
                const id = decodeURIComponent(runMatch[1]);
                const compact = url.searchParams.get("view") === "compact" && runtime.getRunView;
                const cancelled = runMatch[2] ? await runtime.cancel(id) : undefined;
                const run = compact ? await runtime.getRunView!(id) : runMatch[2] ? cancelled : await runtime.getRun(id);
                send(run ?? { error: "运行记录不存在" }, run ? 200 : 404);
                return;
            }
            send({ error: "不支持的实验接口或请求方法" }, 405);
        } catch (error) {
            send({ error: error instanceof Error ? error.message : "Pi Agent 请求失败" }, 400);
        }
    };
}

export function workbenchPlugin(options: { root?: string; runtime?: PiHttpRuntime; ingestion?: CompetitionIngestion; handlerDependencies?: PiHandlerDependencies } = {}): Plugin {
    const root = options.root || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const runtime = options.runtime || new PiCompetitionRuntime(root);
    const handler = createPiHandler(root, runtime, options.ingestion, options.handlerDependencies);
    return {
        name: "pi-competition-workbench",
        config() {
            const target = process.env.COMFYART_URL || "http://127.0.0.1:8189";
            const proxy = { "/comfyart": { target }, "/api": { target }, "/ws": { target, ws: true } };
            return { server: { proxy }, preview: { proxy } };
        },
        configureServer(server) { server.middlewares.use(handler); },
        configurePreviewServer(server) { server.middlewares.use(handler); },
    };
}
