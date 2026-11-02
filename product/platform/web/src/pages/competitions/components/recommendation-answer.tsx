import { useEffect, useId, useState } from "react";
import { readNavigationView, saveNavigationView } from '../../../../../shared/product-navigation';
import { ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Streamdown } from "streamdown";
import { competitionMarkdownPlugins } from "./competition-markdown";

import type { PiRun, PiTaskSelection } from "@/services/api/pi-competitions";
import { competitionAnswerForDisplay, importantGapMessages } from "@/services/api/pi-answer-display";
import { recommendationSections } from "@/services/api/pi-recommendation-layout";
import { taskBlockReason } from "./task-entry-guards";
export { isLibraryTaskCard, taskBlockReason } from "./task-entry-guards";
import { candidateItems, filterCandidateItems } from "./candidate-items";
import { CandidateEntry } from "./candidate-entry";
import { beijingDate, orderCandidates, type CandidateOrder } from "./candidate-order";

export function RecommendationAnswer({ answer, run, ready, onOpenTask }: {
    answer: string;
    run: PiRun;
    ready: boolean;
    onOpenTask: (selection: PiTaskSelection, runId: string, artifactId: string) => Promise<void>;
}) {
    const list = run.status === "completed" ? run.answerReview?.candidateList : undefined;
    if (list) return <CandidateCollection list={list} run={run} ready={ready} onOpenTask={onOpenTask} />;
    return <div className="space-y-4">{recommendationSections(competitionAnswerForDisplay(answer), run).map((section, index) => <div key={index}>
        {section.markdown ? <Streamdown plugins={competitionMarkdownPlugins}>{section.markdown}</Streamdown> : null}
        {section.entries.length ? <div aria-label="已选创作任务" className="mb-5 mt-3 space-y-2">{section.entries.map(({ artifact, task }) => {
            const blocked = taskBlockReason(task);
            const gaps = importantGapMessages(run.answerReview?.gaps?.filter(gap => gap.competitionId === task.competitionId).flatMap(gap => gap.fields) || []);
            return <div key={`${artifact.id}:${task.id}`}>
                <button type="button" disabled={!ready || Boolean(blocked)}
                    aria-label={`${task.title} · 进入创作画布`}
                    title={blocked || task.title}
                    className="group flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-[#c34120]/20 bg-[#ff5c35]/[.04] px-3 py-2 text-left text-sm text-[#a93418] transition hover:border-[#c34120]/45 hover:bg-[#ff5c35]/[.08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c34120] disabled:cursor-not-allowed disabled:opacity-45 dark:border-[#ff9277]/20 dark:text-[#ffab94] dark:hover:border-[#ff9277]/45"
                    onClick={() => onOpenTask(task.agentData as PiTaskSelection, run.runId, artifact.id)}>
                    <span className="min-w-0"><span className="block text-xs text-stone-500">{task.competitionTitle}</span><span className="block">{task.title}</span></span>
                    <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium">进入创作<ArrowUpRight aria-hidden="true" className="size-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" /></span>
                </button>
                {gaps.length ? <p className="mt-1 text-xs leading-5 text-amber-700 dark:text-amber-300">{gaps.join(" · ")}</p> : null}
                {blocked ? <p className="mt-1 text-xs leading-5 text-amber-700 dark:text-amber-300">{blocked}</p> : null}
            </div>;
        })}</div> : null}
    </div>)}</div>;
}

function CandidateCollection({ list, run, ready, onOpenTask }: {
    list: NonNullable<NonNullable<PiRun["answerReview"]>["candidateList"]>;
    run: PiRun; ready: boolean; onOpenTask: (selection: PiTaskSelection, runId: string, artifactId: string) => Promise<void>;
}) {
    const [initial] = useState(() => readNavigationView('browse:' + run.runId, { order: { deadline: 'asc', fee: 'any', types: [] } as CandidateOrder, competition: '', query: '', page: 0 }));
    const [order, setOrder] = useState<CandidateOrder>(initial.order);
    const preferenceHint = useId();
    const [competition, setCompetition] = useState(initial.competition);
    const [query, setQuery] = useState(initial.query);
    const [page, setPage] = useState(initial.page);
    useEffect(() => {
        try { saveNavigationView('browse:' + run.runId, { order, competition, query, page }); } catch { /* Keep browsing usable if storage is unavailable. */ }
    }, [run.runId, order, competition, query, page]);
    const [today, setToday] = useState(beijingDate);
    useEffect(() => {
        // Refresh on Beijing midnight, also after returning to a backgrounded tab.
        let timer: ReturnType<typeof setTimeout>;
        const refresh = () => {
            setToday(beijingDate());
            clearTimeout(timer);
            const now = Date.now();
            timer = setTimeout(refresh, 86_400_000 - (now + 8 * 3_600_000) % 86_400_000 + 50);
        };
        refresh();
        window.addEventListener("focus", refresh);
        return () => { clearTimeout(timer); window.removeEventListener("focus", refresh); };
    }, []);
    const allItems = candidateItems(list.entries, run.artifacts);
    const types = [...new Set(allItems.flatMap(candidate => candidate.facts?.submissionForms || []))].sort((a, b) => a.localeCompare(b, "zh-CN"));
    const selectedTypes = order.types.filter(type => types.includes(type));
    const entries = orderCandidates(filterCandidateItems(allItems, { competition, query }), { ...order, types: selectedTypes });
    const pages = Math.ceil(entries.length / 6), currentPage = Math.min(page, Math.max(0, pages - 1));
    const visible = entries.slice(currentPage * 6, currentPage * 6 + 6);
    const hasPreferences = order.fee !== "any" || selectedTypes.length > 0;
    const footer = list.footer.replace("下一步：选一场竞赛或告诉我想做的作品类型，我再给你对应任务和完整创作要求。", "").trim();
    const selectClass = "min-h-9 max-w-full rounded-lg border border-stone-200 bg-white/70 px-2 text-xs text-stone-600 focus-visible:outline-2 focus-visible:outline-[#c34120] dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300";
    return <div className="space-y-3">
        {list.introduction ? <div data-delivery-introduction><Streamdown plugins={competitionMarkdownPlugins}>{list.introduction}</Streamdown></div> : null}
        {list.notice ? <p className="mb-4 text-sm leading-7 text-stone-600 dark:text-stone-300">{list.notice}</p> : null}
        <div className="mb-4 space-y-2.5 text-xs text-stone-500 dark:text-stone-400">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <span>创作条目 <span className="ml-1 tabular-nums">{entries.length}</span><span className="ml-3 text-stone-400">来自{new Set(entries.map(entry => entry.competitionId)).size}场竞赛</span></span>
                {hasPreferences ? <button type="button" onClick={() => { setOrder(current => ({ ...current, fee: "any", types: [] })); setPage(0); }} className="rounded px-1 py-1 text-stone-500 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-[#c34120]">清除偏好</button> : null}
            </div>
            <div aria-label="查找创作条目" className="flex flex-wrap gap-2">
                <label className="flex min-h-9 w-full items-center gap-2 rounded-lg border border-stone-200 bg-white/70 px-3 sm:w-64 dark:border-stone-700 dark:bg-stone-900"><Search aria-hidden="true" className="size-3.5 text-stone-400" /><input aria-label="搜索创作任务" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} placeholder="搜索要做的内容或提交形式" className="min-w-0 w-full bg-transparent text-xs outline-none" /></label>
                <select aria-label="所属竞赛" className={`${selectClass} w-full sm:w-64`} value={competition} onChange={event => { setCompetition(event.target.value); setPage(0); }}><option value="">全部竞赛</option>{list.entries.map(entry => <option key={entry.competitionId} value={entry.competitionId}>{entry.title}</option>)}</select>
            </div>
            <div aria-label="候选排列偏好" className="flex flex-wrap items-center gap-2">
                <select aria-label="截止日期排序" value={order.deadline} onChange={event => { setOrder(current => ({ ...current, deadline: event.target.value as CandidateOrder["deadline"] })); setPage(0); }} className={selectClass}>
                    <option value="asc">截止日期 · 由近到远</option><option value="desc">截止日期 · 由远到近</option>
                </select>
                <select aria-label="费用优先" aria-describedby={preferenceHint} title="符合偏好的优先显示，其余候选保留" value={order.fee} onChange={event => { setOrder(current => ({ ...current, fee: event.target.value as CandidateOrder["fee"] })); setPage(0); }} className={selectClass}>
                    <option value="any">费用 · 不限</option><option value="free">费用 · 免费优先</option><option value="paid">费用 · 收费优先</option>
                </select>
                {types.length ? <details className="group relative w-full sm:w-auto" onToggle={event => { if (event.currentTarget.open && window.matchMedia("(max-width: 639px)").matches) event.currentTarget.querySelector("fieldset")?.scrollIntoView({ block: "nearest" }); }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.open = false; }}>
                    <summary aria-label="作品类型优先（可多选）" aria-describedby={preferenceHint} title="符合偏好的优先显示，其余候选保留" className={`${selectClass} flex w-fit cursor-pointer list-none items-center gap-3 py-2 [&::-webkit-details-marker]:hidden`}>作品类型 · {selectedTypes.length ? `已选${selectedTypes.length}项` : "不限"}<ChevronDown aria-hidden="true" className="size-3.5 transition-transform group-open:rotate-180 motion-reduce:transition-none" /></summary>
                    <fieldset className="mt-2 w-60 max-w-[calc(100vw-4rem)] sm:absolute sm:left-0 sm:z-20 rounded-xl border border-stone-200 bg-white p-3 shadow-lg dark:border-stone-700 dark:bg-stone-900">
                        <legend className="sr-only">优先作品类型，命中任一种即可</legend>
                        <p className="mb-2 px-1 text-[11px] text-stone-400">可多选，命中任一种即优先</p>
                        <div className="grid max-h-64 grid-cols-2 gap-1 overflow-y-auto">{types.map(type => <label key={type} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-2 text-xs text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-800">
                            <input type="checkbox" checked={selectedTypes.includes(type)} onChange={() => { setOrder(current => ({ ...current, types: current.types.includes(type) ? current.types.filter(value => value !== type) : [...current.types, type] })); setPage(0); }} className="size-3.5 shrink-0 accent-[#c34120]" /><span>{type}</span>
                        </label>)}</div>
                    </fieldset>
                </details> : null}
            </div>
            <p id={preferenceHint} className="sr-only">费用或任一作品类型符合偏好即优先，同组按截止日期排列；其余候选保留。</p>
            {selectedTypes.length ? <div aria-label="已选作品类型" className="flex flex-wrap gap-1.5">{selectedTypes.map(type => <button key={type} type="button" aria-label={`移除${type}偏好`} onClick={() => setOrder(current => ({ ...current, types: current.types.filter(value => value !== type) }))} className="rounded-md bg-[#f5eee5] px-2 py-1 text-[11px] text-[#94622f] focus-visible:outline-2 focus-visible:outline-[#c34120] dark:bg-[#ad7946]/15 dark:text-[#ddb482]">{type}<span aria-hidden="true" className="ml-1.5">×</span></button>)}</div> : null}
        </div>
        <div data-creation-item-list className="space-y-3">{visible.map((candidate) => run.artifacts.some(artifact => artifact.id === candidate.artifactId && artifact.kind === "competition_candidate")
            ? <CandidateEntry key={candidate.itemKey} candidate={candidate} parentTitle={candidate.parentTitle} parentTheme={candidate.parentTheme} preview={candidate.preview} runId={run.runId} ready={ready} today={today} gapFields={run.answerReview?.gaps?.filter(gap => gap.competitionId === candidate.competitionId).flatMap(gap => gap.fields)} onOpenTask={onOpenTask} />
            : <Streamdown key={candidate.itemKey} plugins={competitionMarkdownPlugins}>{candidate.markdown}</Streamdown>)}</div>
        {!entries.length ? <p className="py-8 text-sm text-stone-500">没有匹配的创作条目，试试其他内容或竞赛。</p> : null}
        {pages > 1 ? <nav aria-label="创作条目分页" className="flex items-center justify-between gap-3 py-3 text-xs text-stone-500"><span>第{currentPage * 6 + 1}—{Math.min((currentPage + 1) * 6, entries.length)}项，共{entries.length}项</span><div className="flex items-center gap-3"><button type="button" aria-label="上一页创作条目" disabled={!currentPage} onClick={() => setPage(currentPage - 1)} className="rounded p-2 hover:bg-stone-100 disabled:opacity-30 dark:hover:bg-stone-800"><ChevronLeft className="size-4" /></button><span>{currentPage + 1} / {pages}</span><button type="button" aria-label="下一页创作条目" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)} className="rounded p-2 hover:bg-stone-100 disabled:opacity-30 dark:hover:bg-stone-800"><ChevronRight className="size-4" /></button></div></nav> : null}

        {footer ? <div className="text-xs leading-6 text-stone-500"><Streamdown plugins={competitionMarkdownPlugins}>{footer}</Streamdown></div> : null}
    </div>;
}
