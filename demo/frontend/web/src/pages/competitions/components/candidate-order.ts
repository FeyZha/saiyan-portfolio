import type { PiRun } from "@/services/api/pi-competitions";

export type Candidate = NonNullable<NonNullable<PiRun["answerReview"]>["candidateList"]>["entries"][number];
export type CandidateOrder = {
    deadline: "asc" | "desc";
    fee: "any" | "free" | "paid";
    types: string[];
};
const dayMs = 86_400_000;
export { beijingDate } from "../../../../../pi-agent/competition-clock";
function dayNumber(date: string): number | undefined {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
    const stamp = Date.parse(date + "T00:00:00Z");
    return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === date ? stamp / dayMs : undefined;
}
export function remainingDays(date: string, today: string): string | undefined {
    const end = dayNumber(date), start = dayNumber(today);
    if (end === undefined || start === undefined) return undefined;
    const days = end - start;
    return days > 0 ? `还剩${days}天` : days === 0 ? "今天截止" : "已截止";
}
function deadline(candidate: Candidate): string | undefined {
    const dates = candidate.facts?.deadlines;
    return dates?.length && dates.every(item => item.status === "known" && item.date && dayNumber(item.date) !== undefined)
        ? dates.map(item => item.date!).sort()[0] : undefined;
}
/** Parallel preferences use OR, never a score or a required intersection. */
function preferenceRank(candidate: Candidate, options: CandidateOrder): number {
    const fees = candidate.facts?.fees;
    const forms = candidate.facts?.submissionForms;
    const feeMatches = options.fee !== "any" && fees?.length && fees.every(item => item.status === options.fee);
    const typeMatches = options.types.some(type => forms?.includes(type));
    if (feeMatches || typeMatches) return 0;
    if (options.fee === "any" && !options.types.length) return 0;
    const feeUnknown = options.fee !== "any" && (!fees?.length || !fees.every(item => item.status === "free" || item.status === "paid"));
    const typeUnknown = options.types.length > 0 && !forms?.length;
    return feeUnknown || typeUnknown ? 2 : 1;
}
export function orderCandidates<T extends Candidate>(entries: T[], options: CandidateOrder): T[] {
    return [...entries].sort((a, b) => {
        const left = deadline(a), right = deadline(b);
        const preference = preferenceRank(a, options) - preferenceRank(b, options);
        const date = left && right ? left.localeCompare(right) * (options.deadline === "desc" ? -1 : 1) : left ? -1 : right ? 1 : 0;
        return preference || date || a.title.localeCompare(b.title, "zh-CN") || a.competitionId.localeCompare(b.competitionId);
    });
}
