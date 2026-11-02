import { useState } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight, LoaderCircle, Search } from "lucide-react";
import type { PiCandidateTaskPreview } from "@/services/api/pi-competitions";
import { browseTasks } from "./task-browse";

export function TaskBrowser({ title, tasks, disabled, busy, error, onCreate }: {
    title: string; tasks: PiCandidateTaskPreview[]; disabled: boolean; busy: string | null;
    error?: { scopePointer: string; text: string };
    onCreate: (scopePointer: string, choiceId?: string) => void;
}) {
    const [group, setGroup] = useState("");
    const [category, setCategory] = useState("");
    const [query, setQuery] = useState("");
    const [page, setPage] = useState(0);
    const large = tasks.length > 6;
    const groups = tasks.some(task => task.group) ? [...new Set(tasks.map(task => task.group || "未分赛道"))] : [];
    const effectiveGroup = group || (large && !query ? groups[0] || "" : "");
    const inGroup = tasks.filter(task => !effectiveGroup || (task.group || "未分赛道") === effectiveGroup);
    const categories = [...new Set(inGroup.map(task => task.category).filter((value): value is string => Boolean(value)))];
    const result = browseTasks(tasks, { group: effectiveGroup, category, query, page }, large ? 4 : tasks.length || 1);
    return <div data-task-browser className="border-t border-stone-100 dark:border-stone-800">
        {large ? <div className="space-y-4 bg-[#faf7f2] px-5 py-5 sm:px-6 dark:bg-white/[.02]">
            <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs font-medium text-stone-600 dark:text-stone-300">选赛道，再看具体任务 <span className="ml-2 font-normal text-stone-400">共{tasks.length}项</span></p>
                <label className="flex min-h-9 w-full items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 sm:w-56 dark:border-stone-700 dark:bg-stone-900"><Search aria-hidden="true" className="size-3.5 shrink-0 text-stone-400" /><input aria-label={`在${title}中查找任务`} placeholder="搜索主题、内容或提交形式" value={query} onChange={event => { setQuery(event.target.value); setGroup(""); setCategory(""); setPage(0); }} className="min-w-0 w-full bg-transparent text-xs outline-none" /></label>
            </div>
            {groups.length > 1 ? <div aria-label="赛道选择" className="flex flex-wrap gap-2">{groups.map(value => <button type="button" key={value} aria-pressed={effectiveGroup === value} onClick={() => { setGroup(value); setCategory(""); setPage(0); }} className={`rounded-lg border px-3 py-2 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-[#c34120] ${effectiveGroup === value ? "border-stone-800 bg-stone-800 text-white dark:border-stone-200 dark:bg-stone-200 dark:text-stone-900" : "border-stone-200 bg-white text-stone-600 hover:border-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300"}`}>{value}<span className="ml-2 tabular-nums opacity-65">{tasks.filter(task => (task.group || "未分赛道") === value).length}</span></button>)}</div> : null}
            {categories.length > 1 && categories.length <= 8 ? <div aria-label="设计类别" className="flex flex-wrap gap-x-2 gap-y-1"><button type="button" aria-pressed={!category} onClick={() => { setCategory(""); setPage(0); }} className={`rounded px-2 py-1 text-xs ${!category ? "bg-[#f0e5d9] text-[#873f27] dark:bg-[#ff9277]/10 dark:text-[#ffab94]" : "text-stone-500"}`}>全部类别</button>{categories.map(value => <button type="button" key={value} aria-pressed={category === value} onClick={() => { setCategory(value); setPage(0); }} className={`rounded px-2 py-1 text-xs ${category === value ? "bg-[#f0e5d9] text-[#873f27] dark:bg-[#ff9277]/10 dark:text-[#ffab94]" : "text-stone-500 hover:text-stone-900 dark:text-stone-400"}`}>{value}</button>)}</div> : null}
        </div> : null}
        <div aria-label={`${title} · 投稿任务`} className={`grid gap-3 ${tasks.length === 1 ? "px-5 py-5 sm:px-6" : "p-4 sm:p-5"} ${large ? "lg:grid-cols-2" : "grid-cols-1"}`}>
            {result.tasks.map(task => <section key={`${task.scopePointer}:${task.choiceId || ""}`} data-task-summary className={`flex min-w-0 flex-col ${tasks.length > 1 ? "rounded-xl border border-stone-200/80 bg-white/70 p-4 dark:border-stone-700 dark:bg-white/[.025]" : ""}`}>
                {tasks.length > 1 ? <h4 className="mb-3 text-sm font-semibold leading-6 text-stone-900 dark:text-stone-100">{task.title}</h4> : null}
                <dl className="flex-1 space-y-4 text-[13px] leading-6">
                    <div><dt className="mb-1 text-[11px] font-medium text-stone-400">创作要求</dt><dd className="whitespace-pre-line text-stone-700 dark:text-stone-300">{task.description || "具体创作要求尚未记录，需确认。"}</dd></div>
                    <div><dt className="mb-1 text-[11px] font-medium text-stone-400">交付成果</dt><dd className="text-stone-700 dark:text-stone-300">
                        {task.deliverables?.length ? <ul data-deliverables className="space-y-2">{task.deliverables.map((item, index) => <li key={`${index}:${item.name}`}><span className="font-medium">{item.name}</span>{item.condition ? <span className="ml-1.5 text-stone-500 dark:text-stone-400">（{item.condition}）</span> : null}{item.details ? <p data-deliverable-form className="whitespace-pre-line">{item.details}</p> : null}{item.description ? <p data-deliverable-description>{item.description}</p> : null}</li>)}</ul>
                            : <span className="text-amber-700 dark:text-amber-300">本任务的交付成果尚未明确。</span>}
                    </dd></div>
                </dl>
                {error?.scopePointer === task.scopePointer ? <p role="alert" className="mt-3 text-xs leading-6 text-amber-700 dark:text-amber-300">{error.text}</p> : null}
                <div className="mt-4 flex justify-end border-t border-stone-100 pt-3 dark:border-stone-800"><button type="button" aria-label={`${task.title} · 进入创作`} disabled={disabled || busy !== null || !task.description} onClick={() => onCreate(task.scopePointer, task.choiceId)} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#292722] px-3.5 py-2 text-xs font-medium text-white hover:bg-[#c34120] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c34120] disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900">{busy === task.scopePointer ? <><LoaderCircle className="size-3.5 animate-spin" />准备中</> : <>进入创作<ArrowUpRight aria-hidden="true" className="size-3.5" /></>}</button></div>
            </section>)}
            {!result.total ? <p className="py-5 text-xs text-stone-500">没有找到匹配的任务，试试其他关键词或赛道。</p> : null}
        </div>
        {large ? <div aria-label="任务分页" className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 px-5 py-3 text-xs text-stone-500 dark:border-stone-800 sm:px-6"><span>{result.total ? `展示第${result.start + 1}—${result.start + result.tasks.length}项，共${result.total}项` : "0项任务"}</span><div className="flex items-center gap-3"><button type="button" aria-label="上一页任务" disabled={!result.page} onClick={() => setPage(result.page - 1)} className="rounded p-2 hover:bg-stone-100 disabled:opacity-30 dark:hover:bg-stone-800"><ChevronLeft className="size-4" /></button><span className="tabular-nums">{result.page + 1} / {result.pages || 1}</span><button type="button" aria-label="下一页任务" disabled={result.page + 1 >= result.pages} onClick={() => setPage(result.page + 1)} className="rounded p-2 hover:bg-stone-100 disabled:opacity-30 dark:hover:bg-stone-800"><ChevronRight className="size-4" /></button></div></div> : null}
    </div>;
}
