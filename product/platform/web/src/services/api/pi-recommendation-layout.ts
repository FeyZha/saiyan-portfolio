import { artifactTasks, type PiArtifact, type PiRun, type PiTask } from "./pi-competitions";

export type RecommendationEntry = { artifact: PiArtifact; task: PiTask };
export type RecommendationSection = { markdown: string; entries: RecommendationEntry[] };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));

/** Prose is display-only. Only the final delivery's exact, approved task references publish entries. */
export function recommendationSections(answer: string, run: PiRun): RecommendationSection[] {
    const entries: RecommendationEntry[] = [], seen = new Set<string>();
    if (run.status === "completed" && run.answerReview) for (const ref of run.answerReview.recommendations || []) {
        if (ref.status !== "selected_task" || typeof ref.scopePointer !== "string") continue;
        const artifact = run.artifacts.find(item => item.id === ref.artifactId && item.kind === "canvas_task");
        const data = artifact && object(artifact.data) ? artifact.data : undefined;
        if (!artifact || !data || data.competitionId !== ref.competitionId || data.scopePointer !== ref.scopePointer
            || !object(data.recommendationPresentation) || data.recommendationPresentation.source !== "explicit_delivery"
            || !run.answerReview.records.some(record => record.competitionId === ref.competitionId && record.revision === data.revision)) continue;
        const key = JSON.stringify([ref.competitionId, ref.scopePointer]);
        if (seen.has(key)) continue;
        seen.add(key);
        for (const task of artifactTasks(artifact)) entries.push({ artifact, task });
    }
    return [{ markdown: answer, entries }];
}
