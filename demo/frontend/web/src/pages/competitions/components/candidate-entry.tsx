import { useState } from "react";
import { CalendarDays, ExternalLink } from "lucide-react";
import type { PiRun, PiTaskSelection, PiCandidatePreview } from "@/services/api/pi-competitions";
import { importantGapMessages } from "@/services/api/pi-answer-display";
import { remainingDays } from "./candidate-order";
import { TaskBrowser } from "./task-browser";
import { candidateLineage } from "./candidate-items";

type Candidate = NonNullable<NonNullable<PiRun["answerReview"]>["candidateList"]>["entries"][number];
export function CandidateEntry({ candidate, preview, parentTitle, parentTheme, runId, ready, today, gapFields = [], onOpenTask }: {
    candidate: Candidate; preview?: PiCandidatePreview; parentTitle?: string; parentTheme?: string; runId: string; ready: boolean; today: string; gapFields?: string[];
    onOpenTask: (selection: PiTaskSelection, runId: string, artifactId: string) => Promise<void>;
}) {
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState("");
    const [failedScope, setFailedScope] = useState("");
    const [showDescription, setShowDescription] = useState(false);
    const pending = candidate.status === "pending_preparation";
    const multiple = candidate.taskCount > 1;
    const unavailable = preview?.status === "unavailable";
    const facts = candidate.facts;
    const gaps = importantGapMessages(gapFields, { fee: Boolean(facts?.fees), deadline: Boolean(facts?.deadlines), type: Boolean(facts?.submissionForms), requirements: pending });
    const fees = facts?.fees;
    const feeText = fees?.map(item => `${item.status === "free" ? "免费" : item.status === "paid" ? "收费" : "费用待确认"}${fees.length > 1 && item.taskCount ? ` · ${item.taskCount}项` : ""}`).join(" / ");
    const allFree = fees?.length && fees.every(item => item.status === "free");
    const lineage = candidateLineage(parentTitle, candidate.title, preview?.tasks[0]?.group);
    async function enter(scopePointer: string, choiceId?: string) {
        if (busy !== null || !ready || pending || unavailable) return;
        setBusy(scopePointer); setError(""); setFailedScope(scopePointer);
        try {
            await onOpenTask({ scopePointer, choiceId }, runId, candidate.artifactId);
        } catch (failure) { setError(failure instanceof Error ? failure.message : "暂时无法进入创作，请重新查询。"); }
        finally { setBusy(null); }
    }
    return <section aria-label={candidate.title} data-candidate-card data-choice-id={preview?.tasks.length === 1 ? preview.tasks[0].choiceId : undefined} data-competition-id={candidate.competitionId} data-scope-pointer={preview?.tasks.length === 1 ? preview.tasks[0].scopePointer : undefined} className={`overflow-hidden rounded-2xl border bg-white/80 dark:bg-white/[.035] ${pending ? "border-dashed border-stone-300/70 dark:border-stone-700" : "border-stone-200/80 dark:border-stone-700/70"}`}>
        <div className="px-5 pb-4 pt-4 sm:px-6">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <h3 className="min-w-0 flex-1 basis-60 break-words text-base font-semibold leading-7 tracking-tight text-stone-900 sm:text-[17px] dark:text-stone-100">{candidate.title}</h3>
                {preview?.competitionLink ? <a data-competition-page href={preview.competitionLink.url} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs leading-7 text-stone-500 hover:text-[#c34120] dark:text-stone-400 dark:hover:text-orange-300">{preview.competitionLink.label}<ExternalLink aria-hidden="true" className="size-3" /></a> : null}
            </div>
            {lineage.competition ? <div data-competition-lineage className="mt-2 space-y-1 break-words leading-6 text-stone-500 dark:text-stone-400">
                <p className="m-0 text-[13px]">{lineage.competition}</p>
                {lineage.group ? <p className="m-0 text-xs">{lineage.group}</p> : null}
            </div> : null}
            {parentTheme ? <p className="mt-2 text-xs leading-6 text-stone-500 dark:text-stone-400">{parentTheme}</p> : null}
            {multiple ? <div data-creative-description className="mt-2 text-[13px] leading-6 text-stone-600 dark:text-stone-300">
                <p className={showDescription ? "whitespace-pre-line" : "line-clamp-3"}>{preview?.description || (unavailable ? preview.message : "创作内容简介暂缺，请先查看对应任务的完整要求。")}</p>
                {preview?.description && preview.description.length > 100 ? <button type="button" aria-expanded={showDescription} className="mt-1 text-xs underline underline-offset-4 hover:text-[#c34120]" onClick={() => setShowDescription(value => !value)}>{showDescription ? "收起简介" : "展开简介"}</button> : null}
            </div> : null}
            {pending || feeText || facts?.submissionForms ? <div className="mt-3 flex flex-wrap items-center gap-3 text-xs leading-5">
                {pending ? <span className="text-stone-500 dark:text-stone-400">资料待整理</span> : null}
                {facts?.submissionForms ? <ul aria-label="作品类型" className="m-0 flex flex-wrap gap-1.5">{(facts.submissionForms.length ? facts.submissionForms : ["类型待确认"]).map(type => <li key={type} className="rounded-md bg-stone-100/80 px-2 py-0.5 text-[11px] leading-5 text-stone-600 dark:bg-stone-800/70 dark:text-stone-300">{type}</li>)}</ul> : null}
                {feeText ? <span className={`rounded-full px-2.5 py-0.5 ${allFree ? "bg-[#edf3e9] text-[#506449] dark:bg-[#506449]/20 dark:text-[#b1c7a6]" : "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400"}`}>{feeText}</span> : null}
            </div> : null}
            {facts?.deadlines ? <div aria-label="投稿截止" className="mt-4 flex items-start gap-2 text-xs leading-6 text-stone-500 dark:text-stone-400"><CalendarDays aria-hidden="true" className="mt-1 size-3.5 shrink-0" /><span className="shrink-0">截止</span><div className="flex flex-wrap gap-x-4">{facts.deadlines.map((item, index) => <span key={index} className="inline-flex flex-wrap items-center gap-x-2"><span className="font-medium tabular-nums text-stone-800 dark:text-stone-200">{item.status === "known" && item.date ? item.date : "待确认"}</span>{item.status === "known" && item.date && remainingDays(item.date, today) ? <span data-days-remaining className="rounded-md bg-[#f5eee5] px-2 text-[11px] font-medium tabular-nums text-[#94622f] dark:bg-[#ad7946]/15 dark:text-[#ddb482]">{remainingDays(item.date, today)}</span> : null}{item.taskCount ? <span className="text-[11px]">{item.taskCount}项任务</span> : null}</span>)}</div></div> : null}
            {gaps.length ? <p className="mt-3 text-xs leading-6 text-amber-700 dark:text-amber-300">{gaps.join(" · ")}</p> : null}
        </div>
        {preview?.status === "ready" ? <TaskBrowser title={candidate.title} tasks={preview.tasks} disabled={!ready || pending} busy={busy} error={error ? { scopePointer: failedScope, text: error } : undefined} onCreate={(scope, choiceId) => void enter(scope, choiceId)} /> : <p className="border-t border-stone-100 px-5 py-4 text-xs leading-6 text-amber-700 dark:border-stone-800 dark:text-amber-300">{preview?.message || "具体创作内容和提交形式尚未整理。"}</p>}

    </section>;
}
