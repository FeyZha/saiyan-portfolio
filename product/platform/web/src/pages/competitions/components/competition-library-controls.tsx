import { useEffect, useRef, useState } from "react";
import { Database, RefreshCw } from "lucide-react";
import { getCompetitionFeed, refreshCompetitionFeed, type CompetitionFeed } from "@/services/api/competitions";
import { useEffectiveConfig } from "@/stores/use-config-store";

type IngestionFeed = CompetitionFeed & { importing?: boolean };
const buttonStyle = "inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition hover:bg-black/5 dark:hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40";

export function CompetitionLibraryControls() {
    const config = useEffectiveConfig();
    const mounted = useRef(false);
    const submittingRef = useRef(false);
    const [feed, setFeed] = useState<IngestionFeed>();
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const running = Boolean(feed?.checking || feed?.updating || feed?.importing);

    useEffect(() => {
        mounted.current = true;
        const controller = new AbortController();
        getCompetitionFeed(controller.signal).then(next => {
            if (!controller.signal.aborted) setFeed(next);
        }).catch(failure => {
            if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "资料库状态读取失败");
        });
        return () => { mounted.current = false; controller.abort(); };
    }, []);

    useEffect(() => {
        if (!running) return;
        const controller = new AbortController();
        let timer: number;
        async function poll() {
            try {
                const next = await getCompetitionFeed(controller.signal);
                if (!controller.signal.aborted) setFeed(next);
            } catch (failure) {
                if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "入库状态读取失败");
            } finally {
                if (!controller.signal.aborted) timer = window.setTimeout(() => void poll(), 2000);
            }
        }
        timer = window.setTimeout(() => void poll(), 2000);
        return () => { controller.abort(); window.clearTimeout(timer); };
    }, [running]);

    async function update() {
        if (submittingRef.current || running) return;
        submittingRef.current = true;
        setSubmitting(true); setError("");
        try {
            const next = await refreshCompetitionFeed(config, true);
            if (mounted.current) setFeed(next);
        } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "增量入库未启动"); }
        finally { submittingRef.current = false; if (mounted.current) setSubmitting(false); }
    }

    return <details className="min-w-0 flex-1 text-stone-600 dark:text-stone-400">
        <summary className="w-fit cursor-pointer list-none rounded-md px-2 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/10"><span className="inline-flex items-center gap-1.5"><Database className="size-3.5" />资料入库{running || submitting ? " · 进行中" : ""}</span></summary>
        <section aria-label="竞赛资料入库" className="mt-2 max-w-md rounded-xl border border-black/10 p-3 dark:border-white/10">
            <p className="text-xs leading-6">{feed ? `已有 ${feed.items.length} 场可查资料，${feed.pending.length} 场待确认。` : "正在读取本地资料库…"}</p>
            <p className="mt-1 text-xs leading-6">收集设计竞赛网的新竞赛，使用 Codex 额度整理。</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" disabled={submitting || running} className={buttonStyle} onClick={() => void update()}><RefreshCw className={`size-3.5 ${running ? "animate-spin" : ""}`} />收集新竞赛</button>
            </div>
            {running || submitting ? <p role="status" className="mt-2 text-xs leading-6">{submitting ? "正在等待本机入库流程…" : feed?.checking ? "正在检查新竞赛…" : "正在保存文字、整理三项并核对缺项…"}{feed?.queuedCount ? ` 待处理 ${feed.queuedCount} 场。` : ""}</p> : feed?.lastUpdate?.completedAt ? <p role="status" className="mt-2 text-xs leading-6">本次完成三项整理 {feed.lastUpdate.processed} 场，未完成 {feed.lastUpdate.failed} 场；已采得的原文保留。</p> : null}
            {error || feed?.updateError || feed?.checkError ? <p role="alert" className="mt-2 text-xs leading-6 text-red-700 dark:text-red-300">{error || feed?.updateError || feed?.checkError}</p> : null}
        </section>
    </details>;
}
