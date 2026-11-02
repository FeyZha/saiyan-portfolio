import { useEffect, useRef, useState } from "react";
import { ArrowUp, Bot, FileText, History, LoaderCircle, MessageSquarePlus, Paperclip, Settings2, Square, X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Streamdown } from "streamdown";
import { competitionMarkdownPlugins } from "./components/competition-markdown";
import { usageLabel } from "@/services/api/pi-usage-display";

import { createPiComfyArt, cancelPiRun, getPiSession, getPiStatus, listPiSessions, piModelMode, piRunModel, piRunActive, readPiFile, startPiRun, type PiRun, type PiSession, type PiSessionSummary, type PiStatus, type PiTaskSelection } from "@/services/api/pi-competitions";
import { applyPiLiveEvent, mergePiSessionSnapshot, subscribePiRun } from "@/services/api/pi-stream";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { flushPiPreferences, usePiCompetitionStore } from "@/stores/use-pi-competition-store";
import { navigateProduct, readNavigationView, rememberCompetition, rememberProject, saveNavigationView } from '../../../../shared/product-navigation';
import { useWorkspaceStore } from "@/stores/use-workspace-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { CompetitionLibraryControls } from "./components/competition-library-controls";
import { RecommendationAnswer } from "./components/recommendation-answer";

const SUGGESTIONS = ["我想做国潮海报，从库里帮我挑几场还来得及参加的竞赛", "我想做包装或文创，请筛选并比较未截止的竞赛，费用不限，未知保留", "帮我找没有明确收费的视觉设计竞赛，费用未知请说明", "我想做品牌视觉设计，请推荐竞赛并说明匹配理由"];
const ACTION_STYLE = "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition hover:bg-black/5 dark:hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40";
const STATUS_LABELS: Record<PiRun["status"], string> = { running: "查阅中", completed: "已完成", failed: "未完成", cancelled: "已停止", interrupted: "运行已中断" };

export default function CompetitionsPage() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const linkedSession = searchParams.get("session");
    const restoredLink = useRef<string | null>(null);
    const config = useEffectiveConfig();
    const selectedId = usePiCompetitionStore((state) => state.sessionId);
    const preferredMode = usePiCompetitionStore((state) => state.mode);
    const modeChosen = usePiCompetitionStore((state) => state.modeChosen);
    const mode = piModelMode(config, preferredMode, modeChosen);
    const hydrated = usePiCompetitionStore((state) => state.hydrated);
    const storageError = usePiCompetitionStore((state) => state.storageError);
    const input = usePiCompetitionStore((state) => state.drafts[state.sessionId] || "");
    const workspaceReady = useWorkspaceStore((state) => state.hydrated);
    const canvasReady = useCanvasStore((state) => state.hydrated);
    const [sessions, setSessions] = useState<PiSessionSummary[]>([]);
    const [session, setSession] = useState<PiSession | null>(null);
    const [status, setStatus] = useState<PiStatus | null>(null);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [starting, setStarting] = useState(false);
    const [stopping, setStopping] = useState(false);
    const [error, setError] = useState("");
    const [connectionError, setConnectionError] = useState("");
    const [filesBySession, setFilesBySession] = useState<Record<string, File[]>>({});
    const [dragging, setDragging] = useState(false);
    const fileInput = useRef<HTMLInputElement>(null);
    const scrollArea = useRef<HTMLDivElement>(null);
    const restoredScroll = useRef<string | null>(null);
    const startPending = useRef(false);
    const mounted = useRef(true);
    const dragDepth = useRef(0);
    const files = filesBySession[selectedId] || [];
    const visibleSession = session?.id === selectedId ? session : null;
    const runs = visibleSession?.runs || [];
    const running = runs.find(piRunActive);
    const busy = Boolean(running) || starting || loading;

    useEffect(() => {
        usePiCompetitionStore.setState({ hasPendingFiles: files.length > 0 });
        return () => { usePiCompetitionStore.setState({ hasPendingFiles: false }); };
    }, [files.length]);

    useEffect(() => {
        mounted.current = true;
        void usePiCompetitionStore.getState().hydrate();
        const controller = new AbortController();
        void listPiSessions(controller.signal).then((data) => { if (!controller.signal.aborted) setSessions(data.sessions); }).catch((failure) => { if (!controller.signal.aborted) setError(errorText(failure)); });
        void getPiStatus(controller.signal).then((next) => { if (!controller.signal.aborted) setStatus(next); }).catch((failure) => { if (!controller.signal.aborted) setConnectionError(errorText(failure)); });
        return () => { mounted.current = false; controller.abort(); };
    }, []);

    useEffect(() => {
        if (!linkedSession) { restoredLink.current = null; return; }
        if (!hydrated || restoredLink.current === linkedSession || !sessions.some(item => item.id === linkedSession)) return;
        restoredLink.current = linkedSession;
        usePiCompetitionStore.getState().selectSession(linkedSession);
    }, [hydrated, linkedSession, sessions]);

    useEffect(() => {
        if (!hydrated || !selectedId) { setSession(null); setLoading(false); return; }
        const controller = new AbortController();
        setLoading(true);
        setError("");
        void getPiSession(selectedId, controller.signal).then((next) => {
            if (!controller.signal.aborted) setSession(current => mergePiSessionSnapshot(current, next));
        }).catch((failure) => { if (!controller.signal.aborted) setError(errorText(failure)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => controller.abort();
    }, [selectedId, hydrated]);

    useEffect(() => {
        if (!running) return;
        const controller = new AbortController();
        const disconnect = subscribePiRun(running.runId, {
            event: (event) => {
                if (controller.signal.aborted) return;
                setSession(current => {
                    if (!current || current.id !== running.sessionId) return current;
                    return { ...current, runs: current.runs.map(run => run.runId === running.runId ? applyPiLiveEvent(run, event) : run) };
                });
                if (event.type === "final") void listPiSessions(controller.signal).then(data => setSessions(data.sessions)).catch(() => {});
            },
            connection: message => { if (!controller.signal.aborted) setConnectionError(message); },
        }, controller.signal);
        return () => { controller.abort(); disconnect(); };
    }, [running?.runId]);

    useEffect(() => {
        if (hydrated) try { rememberCompetition(selectedId); } catch { /* Navigation still has an explicit session URL. */ }
    }, [hydrated, selectedId]);

    useEffect(() => {
        if (!scrollArea.current || !visibleSession || loading) return;
        if (restoredScroll.current !== selectedId) {
            restoredScroll.current = selectedId;
            const top = readNavigationView<number | null>('scroll:' + selectedId, null);
            if (typeof top === 'number' && Number.isFinite(top)) { scrollArea.current.scrollTo({ top }); return; }
        }
        scrollArea.current.scrollTo({ top: scrollArea.current.scrollHeight, behavior: "smooth" });
    }, [selectedId, loading, runs.length, running?.answer, running?.presentation?.draftAnswer]);

    function attachFiles(incoming: File[]) {
        setFilesBySession((current) => {
            const all = [...(current[selectedId] || []), ...incoming];
            const unique = all.filter((file, index) => all.findIndex((other) => other.name === file.name && other.size === file.size && other.lastModified === file.lastModified) === index);
            return { ...current, [selectedId]: unique };
        });
    }

    async function send() {
        const question = input.trim();
        if (startPending.current || busy || !hydrated || (!question && !files.length)) return;
        startPending.current = true;
        setStarting(true);
        setError("");
        const draftId = selectedId;
        try {
            const model = piRunModel(config, mode);
            const attachments = await Promise.all(files.map(readPiFile));
            const next = await startPiRun({ question: question || "请阅读这些资料，告诉我你发现了什么以及下一步可以怎样探索。", sessionId: draftId || undefined, config: model, files: attachments });
            const state = usePiCompetitionStore.getState();
            if ((state.drafts[draftId] || "").trim() === question) state.setDraft(draftId, "");
            if (!mounted.current) return;
            const continuingHere = state.sessionId === draftId;
            setFilesBySession((current) => {
                const remaining = (current[draftId] || []).filter((file) => !files.includes(file));
                return continuingHere && next.sessionId !== draftId
                    ? { ...current, [draftId]: [], [next.sessionId]: [...(current[next.sessionId] || []), ...remaining] }
                    : { ...current, [draftId]: remaining };
            });
            if (state.sessionId === draftId) {
                if (next.sessionId !== draftId) {
                    state.setDraft(next.sessionId, usePiCompetitionStore.getState().drafts[draftId] || "");
                    state.setDraft(draftId, "");
                }
                state.selectSession(next.sessionId);
                setSession((current) => current?.id === next.sessionId
                    ? { ...current, updatedAt: next.updatedAt, runs: [...current.runs.filter((run) => run.runId !== next.runId), next] }
                    : { id: next.sessionId, title: question || "资料探索", createdAt: next.createdAt, updatedAt: next.updatedAt, runs: [next] });
            }
            void listPiSessions().then((data) => { if (mounted.current) setSessions(data.sessions); }).catch(() => {});
        } catch (failure) { if (mounted.current) setError(errorText(failure)); }
        finally { startPending.current = false; if (mounted.current) setStarting(false); }
    }

    async function stop() {
        if (!running || stopping) return;
        setStopping(true);
        try {
            const next = await cancelPiRun(running.runId);
            if (mounted.current) setSession((current) => applyRunSnapshot(current, next));
        } catch (failure) { if (mounted.current) setError(errorText(failure)); }
        finally { if (mounted.current) setStopping(false); }
    }

    async function openTask(selection: PiTaskSelection, runId: string, artifactId: string) {
        if (!workspaceReady || !canvasReady) return;
        try {
            await flushPiPreferences();
            const result = await createPiComfyArt(runId, artifactId, selection);
            const destination = new URL(result.url, window.location.origin);
            if (destination.origin !== window.location.origin || destination.pathname !== '/comfyart/') throw new Error('创作入口无效。');
            destination.searchParams.set('fromSession', selectedId);
            rememberCompetition(selectedId);
            rememberProject(result.projectId, selectedId);
            navigateProduct(destination.href, usePiCompetitionStore.getState().hasPendingFiles);
        } catch (failure) { setError(`创作任务未创建：${errorText(failure)}`); }
    }

    return <div className="sy-discovery flex h-full min-h-0 flex-col bg-[#f5f2eb] text-stone-900 dark:bg-[#171715] dark:text-stone-100"
        onDragEnter={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); dragDepth.current++; setDragging(true); } }}
        onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
        onDragLeave={(event) => { event.preventDefault(); if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } }}
        onDrop={(event) => { if (!event.dataTransfer.files.length) return; event.preventDefault(); dragDepth.current = 0; setDragging(false); attachFiles(Array.from(event.dataTransfer.files)); }}>
        <header className="mx-auto flex w-full max-w-3xl shrink-0 items-start justify-between gap-3 px-5 py-4 md:px-8">
            <CompetitionLibraryControls />
            <div className="flex items-center gap-1"><button type="button" aria-label="新建对话" title="新建对话" className={ACTION_STYLE} onClick={() => { usePiCompetitionStore.getState().selectSession(""); navigate("/competitions", { replace: true }); setError(""); }}><MessageSquarePlus className="size-4" /><span className="hidden sm:inline">新对话</span></button><button type="button" aria-expanded={historyOpen} aria-controls="pi-history" className={ACTION_STYLE} onClick={() => setHistoryOpen((open) => !open)}><History className="size-4" /><span className="hidden sm:inline">历史</span></button></div>
        </header>
        {historyOpen ? <section id="pi-history" aria-label="对话历史" className="mx-auto w-full max-w-5xl px-5 pb-4 md:px-8"><div className="max-h-52 overflow-y-auto rounded-xl border border-black/10 p-2 dark:border-white/10">{sessions.length ? sessions.map((item) => <button type="button" key={item.id} className={`${ACTION_STYLE} w-full justify-between text-left ${selectedId === item.id ? "bg-black/5 dark:bg-white/10" : ""}`} onClick={() => { usePiCompetitionStore.getState().selectSession(item.id); navigate(`/competitions?session=${encodeURIComponent(item.id)}`, { replace: true }); setHistoryOpen(false); }}><span className="min-w-0 truncate">{item.title}</span><span className="shrink-0 text-xs text-stone-500">{item.runCount} 轮</span></button>) : <p className="px-3 py-4 text-sm text-stone-500">暂无对话记录。</p>}</div></section> : null}
        <div ref={scrollArea} onScroll={() => { if (visibleSession && !loading && scrollArea.current) try { saveNavigationView('scroll:' + selectedId, scrollArea.current.scrollTop); } catch { /* Read-only browser storage must not interrupt browsing. */ } }} className="min-h-0 flex-1 overflow-y-auto"><main className="mx-auto w-full max-w-3xl px-5 pb-10 pt-6 md:px-8">
            {!runs.length && !loading ? <div className="py-10 md:py-16"><h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">你想做什么样的创作？</h1><p className="mt-4 max-w-xl text-sm leading-7 text-stone-600 dark:text-stone-400">说说想做的作品、费用和时间要求。</p><div className="mt-7 flex flex-wrap gap-2">{SUGGESTIONS.map((suggestion) => <button key={suggestion} type="button" className="rounded-xl border border-black/10 px-3 py-2 text-left text-xs leading-5 transition hover:border-[#ff5c35]/60 dark:border-white/10" onClick={() => usePiCompetitionStore.getState().setDraft(selectedId, suggestion)}>{suggestion}</button>)}</div></div> : null}
            {loading ? <p role="status" className="flex items-center gap-2 py-8 text-sm text-stone-500"><LoaderCircle className="size-4 animate-spin" />正在恢复对话记录…</p> : null}
            <div className="space-y-9">{runs.map((run) => <RunView key={run.runId} run={run} ready={workspaceReady && canvasReady} onOpenTask={openTask} />)}</div>
            {starting ? <p role="status" className="mt-7 flex items-center gap-2 text-sm text-stone-500"><LoaderCircle className="size-4 animate-spin" />正在准备资料并开始查阅…</p> : null}
        </main></div>
        <footer className="mx-auto w-full max-w-3xl px-5 pb-4 md:px-8">
            {storageError ? <p role="alert" className="mb-2 text-xs text-red-600 dark:text-red-400">{storageError} <button type="button" className="underline" onClick={() => void usePiCompetitionStore.getState().hydrate()}>重试读取</button></p> : null}
            {error ? <p role="alert" className="mb-2 break-words text-sm text-red-600 dark:text-red-400">{error}</p> : null}
            {connectionError ? <p role="status" className="mb-2 text-xs text-amber-700 dark:text-amber-300">{connectionError}</p> : null}
            {dragging ? <p role="status" className="mb-2 rounded-xl border border-dashed border-[#ff5c35] p-4 text-center text-sm">松开鼠标，将文件加入本轮资料</p> : null}
            <div className="rounded-2xl border border-black/10 bg-white/70 p-3 dark:border-white/10 dark:bg-white/[.04]">
                {files.length ? <ul className="mb-2 flex flex-wrap gap-2">{files.map((file, index) => <li key={`${file.name}-${file.lastModified}-${index}`} className="flex max-w-full items-center gap-2 rounded-lg bg-black/5 px-2 py-1 text-xs dark:bg-white/10"><FileText className="size-3 shrink-0" /><span className="truncate">{file.name}</span><button type="button" aria-label={`移除 ${file.name}`} onClick={() => setFilesBySession((current) => ({ ...current, [selectedId]: files.filter((_, fileIndex) => fileIndex !== index) }))}><X className="size-3" /></button></li>)}</ul> : null}
                <textarea aria-label="创作需求与竞赛问题" title="Enter 发送，Shift + Enter 换行" placeholder="例如：想做包装或文创，帮我比较未截止的竞赛，费用不限，未知请说明…" rows={3} className="w-full resize-none bg-transparent px-1 text-sm leading-6 outline-none placeholder:text-stone-400" value={input} onChange={(event) => usePiCompetitionStore.getState().setDraft(selectedId, event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
                <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-1"><input ref={fileInput} type="file" accept=".pdf,.docx,.txt,.md,.csv,.json,.html,.htm,.xml" multiple className="hidden" onChange={(event) => { attachFiles(Array.from(event.target.files || [])); event.target.value = ""; }} /><button type="button" className={ACTION_STYLE} aria-label="添加文字资料" title="添加文字资料，图片不读取" onClick={() => fileInput.current?.click()}><Paperclip className="size-4" /></button><button type="button" aria-expanded={settingsOpen} aria-controls="pi-model-settings" className={ACTION_STYLE} onClick={() => setSettingsOpen((open) => !open)}><Settings2 className="size-4" /><span className="text-xs">Codex</span></button></div>{running ? <button type="button" disabled={stopping || running.status === "cancelled"} onClick={() => void stop()} className={`${ACTION_STYLE} text-red-600 dark:text-red-400`}><Square className="size-3 fill-current" />{stopping || running.status === "cancelled" ? "停止中…" : "停止"}</button> : <button type="button" aria-label="发送并查询" disabled={busy || !hydrated || (!input.trim() && !files.length)} onClick={() => void send()} className="grid size-9 place-items-center rounded-full bg-[#191816] text-white transition hover:bg-[#d8431f] disabled:opacity-35 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-[#ff9277]"><ArrowUp className="size-4" /></button>}</div>
            </div>
            {settingsOpen ? <section id="pi-model-settings" aria-label="模型设置" className="mt-2 rounded-xl border border-black/10 p-3 text-xs dark:border-white/10"><p className="leading-5 text-stone-500 dark:text-stone-400">文字任务统一使用本机 Codex 登录额度。{status?.oauth?.available === false ? status.oauth.reason : "无需配置 API Key。"}</p></section> : null}
        </footer>
    </div>;
}

function RunView({ run, ready, onOpenTask }: { run: PiRun; ready: boolean; onOpenTask: (selection: PiTaskSelection, runId: string, artifactId: string) => Promise<void> }) {
    const active = piRunActive(run);
    const draft = run.presentation?.draftAnswer || (!run.reviewRequired ? run.answer : "");
    const answer = run.answerReview ? run.answer : active ? draft : !run.reviewRequired ? run.answer : "";
    const activity = active ? run.presentation?.activity : undefined;
    const usage = usageLabel(run);
    const duration = Math.max(0, Date.parse(run.updatedAt) - Date.parse(run.createdAt));
    return <article className="space-y-5"><div className="flex justify-end"><div className="max-w-[90%] rounded-[18px_18px_4px_18px] bg-[#191816] px-4 py-3 text-white dark:bg-stone-100 dark:text-stone-900"><p className="whitespace-pre-wrap break-words text-sm leading-6" style={{ margin: 0 }}>{run.question}</p>{run.files?.length ? <ul className="mt-2 space-y-1 text-xs opacity-75">{run.files.map((file) => <li key={file.path} className="flex items-center gap-1 break-all"><FileText className="size-3 shrink-0" />{file.name}</li>)}</ul> : null}</div></div><div className="flex gap-3"><div className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-[#ff5c35]/15 text-[#c34120] dark:text-[#ff9277]"><Bot className="size-4" /></div><div className="min-w-0 flex-1">
        {active ? <div role="status" className="mb-3 flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400"><LoaderCircle className="size-3.5 shrink-0 animate-spin" /><span>{activity ? `${activity.agent === "official" ? "官网核查 · " : ""}${activity.status === "running" ? "正在" : activity.status === "failed" ? "未完成 · " : "已完成 · "}${activity.label}` : draft ? "正在生成回答" : "正在处理你的问题"}</span></div> : null}
        {answer ? <div aria-label={active && !run.answerReview ? "正在生成的回答" : "竞赛回答"} className="text-sm leading-7">{active && !run.answerReview ? <><p className="mb-2 text-[11px] text-stone-500">生成中 · 待核对</p><Streamdown plugins={competitionMarkdownPlugins}>{answer}</Streamdown></> : <RecommendationAnswer answer={answer} run={run} ready={ready} onOpenTask={onOpenTask} />}</div> : !active ? <p className="text-sm text-stone-500">{runStatusLabel(run)}</p> : null}
        {run.error ? <p role="alert" className="mt-3 break-words text-sm text-red-600 dark:text-red-400">{run.error}</p> : null}
        {!active ? <p aria-label="回答状态" className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-stone-500 dark:text-stone-400"><span>{runStatusLabel(run)} · {(duration / 1000).toFixed(1)} 秒</span>{run.model ? <span>{run.model.id}</span> : null}<span>{usage}</span></p> : null}
    </div></div></article>;
}

function errorText(error: unknown) { return error instanceof Error ? error.message : "操作未完成，请重试"; }
function applyRunSnapshot(current: PiSession | null, next: PiRun): PiSession | null {
    if (current?.id !== next.sessionId) return current;
    const old = current.runs.find((run) => run.runId === next.runId);
    if (old && ((old.presentation?.revision ?? old.events?.length ?? 0) > (next.presentation?.revision ?? next.events?.length ?? 0) || (old.settled === true && next.settled === false) || (old.status !== "running" && next.status === "running"))) return current;
    return { ...current, updatedAt: next.updatedAt, runs: current.runs.map((run) => run.runId === next.runId ? next : run) };
}
function runStatusLabel(run: PiRun) { return run.status === "cancelled" && piRunActive(run) ? "停止中" : STATUS_LABELS[run.status]; }
