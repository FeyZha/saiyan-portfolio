import { decodeCompetitionTableRows, packCompetitionTable, type CompactCompetitionTable, type TableField } from "./compact-query.js";

/** Only already returned pages of the same query; never fetch additional results for delivery. */
export function mergeCandidatePages<T extends CompactCompetitionTable>(previous: CompactCompetitionTable | undefined, next: T): T {
    if (!previous) return next;
    const rows = new Map([...decodeCompetitionTableRows(previous), ...decodeCompetitionTableRows(next)].map(row => [String(row.libraryId), row]));
    const fields = next.columns.filter((field): field is TableField => ["title", "submissionForms", "deadline", "fee"].includes(field));
    const source = next as CompactCompetitionTable & { total?: number };
    const total = source.total ?? rows.size;
    return { ...next, ...packCompetitionTable([...rows.values()], fields), pagination: { offset: 0, returned: rows.size,
        hasMore: rows.size < total, nextOffset: rows.size < total ? rows.size : null } };
}

export type CandidateFacts = { submissionForms?: string[]; deadlines?: { date?: string; status: string; taskCount?: number }[]; fees?: { status: string; taskCount?: number }[]; filterPending?: string[] };
export function candidateFilterNotice(pending: string[] = []): string | undefined {
    const labels: Record<string, string> = { designTypes: "作品类型", feeStatus: "费用", deadlineFrom: "截止日期", deadlineTo: "截止日期" };
    return pending.length ? `筛选条件待确认：${[...new Set(pending.map(key => labels[key] || key))].join("、")}` : undefined;
}
type Row = Record<string, unknown>;
function cardFacts(row: Row): CandidateFacts {
    const count = (item: Row) => typeof item.taskCount === "number" ? { taskCount: item.taskCount } : {};
    return {
        filterPending: object(row.conditions).pending as string[] || [],
        ...(Object.hasOwn(row, "submissionForms") ? { submissionForms: Array.isArray(row.submissionForms) ? row.submissionForms.map(String) : [] } : {}),
        ...(Object.hasOwn(row, "deadline") ? { deadlines: variants(row.deadline).map(item => ({ status: String(item.status || "unknown"), ...(typeof item.date === "string" ? { date: item.date } : {}), ...count(item) })) } : {}),
        ...(Object.hasOwn(row, "fee") ? { fees: variants(row.fee).map(item => ({ status: String(item.status || "unknown"), ...count(item) })) } : {}),
    };
}
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const escape = (value: unknown) => String(value).replace(/[\\`*_{}[\]<>#|]/g, "\\$&").replace(/[\r\n]+/g, " ");
function variants(value: unknown): Row[] {
    const item = object(value);
    return item.status === "varies" && Array.isArray(item.variants) ? item.variants.map(object) : [item];
}
function dateKey(row: Row): string | undefined {
    const items = variants(row.deadline);
    const dates = items.map(item => item.status === "known" && typeof item.date === "string" ? item.date : undefined);
    return dates.length && dates.every(Boolean) ? (dates as string[]).sort()[0] : undefined;
}
function deadline(value: unknown): string {
    return variants(value).map(item => `${item.status === "known" && item.date ? escape(item.date) : "待确认"}${item.taskCount ? `（${item.taskCount}项任务）` : ""}`).join("；");
}
function fee(value: unknown): string {
    return variants(value).map(item => `${item.status === "free" ? "免费" : item.status === "paid" ? "收费" : "待确认"}${item.taskCount ? `（${item.taskCount}项任务）` : ""}`).join("；");
}

/** Candidate directions only: saved facts and ordering belong to the program, not model prose. */
export function renderCandidateList(table: CompactCompetitionTable, selectedIds?: string[], fallbackDate?: string): { notice?: string; answer: string; competitionIds: string[]; sections: { competitionId: string; markdown: string; facts: CandidateFacts }[]; footer: string } {
    const rows = decodeCompetitionTableRows(table);
    const allowed = new Set(rows.map(row => String(row.libraryId)));
    if (selectedIds?.some(id => !allowed.has(id))) throw new Error("候选必须来自本次已返回的查库结果，不能猜测竞赛ID。");
    const selected = selectedIds ? new Set(selectedIds) : undefined;
    // A shortlist may prioritize known matches, but cannot silently discard uncertain filter matches.
    const uncertain = new Set(table.pending.filters.map(([id]) => id));
    const ordered = rows.filter(row => (!selected || selected.has(String(row.libraryId)) || !fallbackDate && uncertain.has(String(row.libraryId))) && (!fallbackDate || Boolean(dateKey(row) && dateKey(row)! >= fallbackDate))).sort((a, b) => {
        // Preserve the database's order within each group, including its paging boundaries.
        return Number(uncertain.has(String(a.libraryId))) - Number(uncertain.has(String(b.libraryId)));
    });
    const blocks = ordered.map((row, index) => {
        const facts: string[] = [];
        if (Object.hasOwn(row, "submissionForms")) facts.push(`作品类型：${Array.isArray(row.submissionForms) && row.submissionForms.length ? row.submissionForms.map(escape).join("、") : "待确认"}`);
        if (Object.hasOwn(row, "deadline")) facts.push(`截止：${deadline(row.deadline)}`);
        if (Object.hasOwn(row, "fee")) facts.push(`费用：${fee(row.fee)}`);
        if (row.materialStatus === "pending_preparation") facts.push("完整创作要求待整理");
        const pending = candidateFilterNotice(cardFacts(row).filterPending);
        if (pending) facts.push(pending);
        return `**${index + 1}. ${escape(row.title || row.libraryId)}**\n\n${facts.join(" · ")}`;
    });
    const pagination = table as CompactCompetitionTable & { pagination?: { hasMore?: boolean } };
    const scope = pagination.pagination?.hasMore ? "\n\n以上为本次已返回的候选，仍有后续页面。" : "";
    const footer = scope + "\n\n下一步：选一场竞赛或告诉我想做的作品类型，我再给你对应任务和完整创作要求。";
    const notice = fallbackDate ? blocks.length ? "暂未找到符合你这类需求的竞赛，先看看常用赛事名单内尚未截止的候选。" : "暂未找到符合你这类需求的竞赛，常用赛事名单内也暂无已知未截止的候选。你可以按作品类型、费用或截止日期继续查找。"
        : ordered.some(row => uncertain.has(String(row.libraryId))) ? (ordered.every(row => uncertain.has(String(row.libraryId)))
            ? "本次返回的候选均有筛选条件待确认，暂未找到已确认满足全部条件的竞赛。"
            : `明确满足筛选条件的候选优先；另保留${ordered.filter(row => uncertain.has(String(row.libraryId))).length}项条件待确认的候选。`) : undefined;
    return { ...(notice ? { notice } : {}), competitionIds: ordered.map(row => String(row.libraryId)), sections: ordered.map((row, index) => ({ competitionId: String(row.libraryId), markdown: blocks[index], facts: cardFacts(row) })), footer: blocks.length ? footer : "", answer: blocks.length
        ? (notice ? notice + "\n\n" : "") + blocks.join("\n\n") + footer
        : fallbackDate ? "暂未找到符合你这类需求的竞赛，常用赛事名单内也暂无已知未截止的候选。你可以按作品类型、费用或截止日期继续查找。" : "本次查询没有返回候选。你可以换一个主题或作品类型继续查找。" };
}
