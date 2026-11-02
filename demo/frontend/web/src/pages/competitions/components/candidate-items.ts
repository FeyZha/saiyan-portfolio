import type { PiCandidatePreview, PiRun } from "@/services/api/pi-competitions";
import type { Candidate } from "./candidate-order";
export type CandidateItem = Candidate & { itemKey: string; parentTitle?: string; parentTheme?: string; preview?: PiCandidatePreview; scopePointer?: string; choiceId?: string };
/** A displayed item is one exact submission scope, never an archive record or an internal work item. */
export function candidateItems(entries: Candidate[], artifacts: PiRun["artifacts"]): CandidateItem[] {
    const items: CandidateItem[] = [], seen = new Set<string>();
    for (const entry of entries) {
        const artifact = artifacts.find(artifact => artifact.id === entry.artifactId && artifact.kind === "competition_candidate");
        const preview = (artifact?.data as { preview?: PiCandidatePreview } | undefined)?.preview;
        if (preview?.status === "ready" && preview.tasks.length) {
            for (const task of preview.tasks) {
                const itemKey = JSON.stringify([entry.competitionId, task.scopePointer, task.choiceId || null]);
                if (seen.has(itemKey)) continue; seen.add(itemKey);
                items.push({ ...entry, itemKey, title: task.title, parentTitle: entry.title, parentTheme: preview.description?.split(/\r?\n/).find(line => /^竞赛主题[：:]/.test(line.trim()))?.trim(), scopePointer: task.scopePointer, choiceId: task.choiceId, taskCount: 1,
                    facts: task.facts || { submissionForms: [], deadlines: [{ status: "unknown" }], fees: [{ status: "unknown" }] },
                    preview: { status: "ready", tasks: [task], description: task.description, competitionLink: preview.competitionLink } });
            }
        } else {
            const itemKey = JSON.stringify([entry.competitionId, null]); if (seen.has(itemKey)) continue; seen.add(itemKey);
            items.push({ ...entry, itemKey, preview });
        }
    }
    return items;
}
/** Keep competition and track as separate display roles; identity and searchable text stay intact. */
export function candidateLineage(parentTitle: string | undefined, title: string, group?: string) {
    if (!parentTitle || parentTitle === title) return { competition: "", group: "" };
    const key = (text: string) => text.normalize("NFKC").replace(/定向主题(?:征集)?/g, "征集").replace(/[^\p{L}\p{N}]/gu, "").toLocaleLowerCase();
    return { competition: parentTitle, group: group && !key(parentTitle).includes(key(group)) && !key(title).includes(key(group)) ? group : "" };
}
export function filterCandidateItems(items: CandidateItem[], filters: { competition: string; query: string }) {
    const query = filters.query.trim().normalize("NFKC").toLocaleLowerCase();
    return items.filter(item => (!filters.competition || item.competitionId === filters.competition)
        && (!query || [item.title, item.parentTitle, ...item.preview?.tasks.flatMap(task => [task.description, task.submission]) || []]
            .filter(Boolean).join("\n").normalize("NFKC").toLocaleLowerCase().includes(query)));
}
