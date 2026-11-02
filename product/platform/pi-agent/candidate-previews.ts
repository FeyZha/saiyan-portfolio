import type { CandidateFacts } from "./candidate-list.js";
import { openCandidatePreviewLibrary, decodeTaskDirectoryRows } from "./competition-library.js";
import { approvedRecommendationArtifacts, validateRunRecommendation, type RecommendationBinding, type RecommendationArtifact } from "./recommendations.js";
import type { CompetitionPageLink } from "./competition-page-link.js";
import type { SubmissionDeliverable } from "./submission-overview.js";
import { readCompetitionCards } from "./competition-card-store.js";

type Data = Record<string, unknown>;
export type CandidateTaskPreview = { scopePointer: string; choiceId?: string; title: string; description?: string; submission?: string; deliverables?: SubmissionDeliverable[];
    facts?: CandidateFacts; requiredTogether?: boolean; group?: string; category?: string; submissionContext?: { title: string; text: string } };
export type CandidatePreview = { status: "ready" | "unavailable"; description?: string; message?: string; competitionLink?: CompetitionPageLink; tasks: CandidateTaskPreview[] };
const object = (value: unknown): value is Data => Boolean(value) && typeof value === "object" && !Array.isArray(value);
type Run = Parameters<typeof validateRunRecommendation>[1];
/** Read-only UI enrichment: never saved into history or supplied to the model. */
export async function projectCandidatePreviews(root: string, run: Run, artifacts: RecommendationArtifact[]) {
    const approved = new Set(approvedRecommendationArtifacts(run).map(artifact => artifact.id));
    if (!artifacts.some(artifact => ["competition_candidate", "canvas_task"].includes(artifact.kind) && approved.has(artifact.id))) return artifacts;
    const readPreview = await openCandidatePreviewLibrary(root).catch(error => async () => { throw error; });
    return Promise.all(artifacts.map(async artifact => {
        if (artifact.kind === "canvas_task" && approved.has(artifact.id) && run.status === "completed") {
            try { return await validateRunRecommendation(root, run, artifact.id, undefined, undefined, true); }
            catch { return { ...artifact, data: { ...(object(artifact.data) ? artifact.data : {}), submissionOptions: undefined, directionPending: true } }; }
        }
        if (artifact.kind !== "competition_candidate" || !approved.has(artifact.id) || !object(artifact.data)) return artifact;
        const data = artifact.data;
        let preview: CandidatePreview;
        let competitionLink: CompetitionPageLink | undefined;
        try {
            const binding = data.binding as RecommendationBinding | undefined;
            if (!binding || !Array.isArray(binding.scopePointers) || !run.answerReview?.records.some(record => record.competitionId === data.competitionId && record.revision === binding.expectedRevision))
                throw new Error("候选版本或范围无法验证，请重新查询。");
            const { directory, competition, material } = await readPreview(String(data.competitionId), { scopePointers: binding.scopePointers, filters: binding.filters, expectedVersionToken: binding.versionToken, fields: ["title", "submissionForms", "deadline", "fee"] });
            if (competition.revision !== binding.expectedRevision) throw new Error("资料版本已变化，请重新查询。");
            if (material.status !== "ready" || !material.bundle) throw new Error("卡片资料尚未整理，请更新入库资料。");
            const saved = await readCompetitionCards(root, material.bundle);
            competitionLink = saved.competitionLink;
            if (directory.materialStatus === "pending_preparation") throw new Error("创作内容尚待整理，暂不能进入创作。");
            const tasks = decodeTaskDirectoryRows(directory).flatMap(row => {
                const scopePointer = String(row.scopePointer);
                const card = saved.tasks.find(task => task.scopePointer === scopePointer);
                if (!card) throw new Error("卡片任务范围不一致，请更新入库资料。");
                const deadline = object(row.deadline) ? row.deadline : {}, fee = object(row.fee) ? row.fee : {};
                const facts: CandidateFacts = { filterPending: object(row.conditions) && Array.isArray(row.conditions.pending) ? row.conditions.pending.map(String) : [],
                    submissionForms: Array.isArray(row.submissionForms) ? row.submissionForms.map(String) : [],
                    deadlines: [{ status: String(deadline.status || "unknown"), ...(typeof deadline.date === "string" ? { date: deadline.date } : {}) }],
                    fees: [{ status: String(fee.status || "unknown") }] };
                return (card.options || [card]).map(({ scopePointer, title, description, submission, deliverables, group, ...option }) => ({
                    scopePointer, title, description, submission, deliverables, group,
                    ...("choiceId" in option ? { choiceId: String(option.choiceId) } : {}), facts, requiredTogether: row.requiredTogether === true }));
            });
            preview = { status: "ready", ...(tasks.length === 1 ? { description: tasks[0].description } : {}), tasks };
        } catch (error) {
            preview = { status: "unavailable", message: error instanceof Error ? error.message : "创作内容暂时无法读取，请重新查询。", tasks: [] };
        }
        return { ...artifact, data: { ...data, preview: { ...preview, competitionLink } } };
    }));
}
