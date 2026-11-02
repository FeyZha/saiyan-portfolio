import { createHash } from "node:crypto";
import { cleanCreativeText, cleanTaskText } from "./creative-text.js";
import { readLibraryTaskDetail, readLibraryTaskDirectory, readLibraryTaskEvidence, decodeTaskDirectoryRows,
    openCandidatePreviewLibrary, type CompetitionSearchOptions, type LibraryTaskDetailOptions } from "./competition-library.js";

import { readCompetitionCards } from "./competition-card-store.js";

type Data = Record<string, unknown>;
const object = (value: unknown): value is Data => Boolean(value && typeof value === "object" && !Array.isArray(value));
const rows = (value: unknown): Data[] => Array.isArray(value) ? value.filter(object) : [];
const text = (value: unknown) => typeof value === "string" ? value : "";
const hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export type RecommendationInput = { competitionId: string; scopePointer?: string; choiceId?: string; reason?: string };
export type RecommendationArtifact = { id: string; kind: string; title: string; path?: string; data?: unknown };
export type RecommendationBinding = { scopePointers: string[]; versionToken: string; expectedRevision: string;
    expectedIndexHash: string | null; expectedSourceVersion: string | null; title?: string; filters?: CompetitionSearchOptions["filters"] };
export type RecommendationReference = { artifactId: string; competitionId: string; scopePointer?: string; status: string };

/** Saved requirements are projected locally into the existing canvas-task contract, without a model summary. */
export async function buildLibraryCanvasTask(root: string, detail: unknown, options: { reason?: string; choiceId?: string; requireChoice?: boolean } = {}) {
    if (!object(detail) || detail.status !== "selected_task" || !object(detail.competition) || !object(detail.task)
        || !object(detail.task.content) || typeof detail.task.scopePointer !== "string") throw new Error("只有已整理的精确投稿任务可以进入创作。");
    const competition = detail.competition, selected = detail.task;
    const competitionId = text(competition.libraryId), scopePointer = text(selected.scopePointer);
    if (!competitionId || !hash(competition.revision) || !hash(detail.versionToken)) throw new Error("创作任务的当前版本绑定缺失，请重新查询。");
    const read = await openCandidatePreviewLibrary(root);
    const { material } = await read(competitionId, { scopePointers: [scopePointer], expectedVersionToken: String(detail.versionToken) });
    if (!material.bundle || material.status !== "ready") throw new Error("卡片资料尚待整理。");
    const cards = await readCompetitionCards(root, material.bundle);
    const card = cards.tasks.find(task => task.scopePointer === scopePointer);
    if (!card) throw new Error("卡片任务范围无效。");
    const choices = card.options || [];
    const chosen = choices.find(choice => choice.choiceId === options.choiceId);
    if (options.choiceId !== undefined && !chosen) throw new Error("所选提交形式已失效或不属于该任务，请重新选择。");
    if (choices.length && !chosen && options.requireChoice) throw new Error("请选择一种提交形式后进入创作。");
    const evidenceRefs = Array.isArray(selected.evidenceRefs) ? selected.evidenceRefs.filter((ref): ref is string => typeof ref === "string") : [];
    // A fragment is read from the local archive only. A missing mapping never falls back to full source text.
    const proof = evidenceRefs.length ? await readLibraryTaskEvidence(root, competitionId, { scopePointer, evidenceRefs,
        expectedRevision: String(competition.revision), expectedVersionToken: String(detail.versionToken),
        expectedIndexHash: typeof detail.sixFieldIndexHash === "string" ? detail.sixFieldIndexHash : null,
        expectedSourceVersion: typeof competition.sourceVersion === "string" ? competition.sourceVersion : null }) : undefined;
    const facts = object(selected.facts) ? selected.facts : {}, fee = object(facts.feeStatus) ? facts.feeStatus : {},
        deadline = object(facts.submissionDeadline) ? facts.submissionDeadline : {}, forms = object(facts.submissionForms) ? facts.submissionForms : {};
    const make = (content: Data, rules: Data[], title: unknown, choiceId?: string) => {
        const { content: _content, ...context } = selected;
        const taskContext = { ...context, rules, ruleRefs: rules.map(rule => rule.id) };
        const taskIdentity = createHash("sha256").update(JSON.stringify(choiceId ? [competitionId, scopePointer, choiceId] : [competitionId, scopePointer])).digest("hex");
        const requirements = object(content.requirements) ? content.requirements : {};
        const creativeContent = typeof content.creativeContent === "string" ? content.creativeContent
            : typeof requirements.creativeContent === "string" ? requirements.creativeContent
            : typeof requirements.creative === "string" ? requirements.creative
            : typeof content.requirements === "string" ? content.requirements : "";
        if (!cleanCreativeText(creativeContent)) throw new Error("具体创作要求尚待整理，暂不能进入创作。");
        const submissionFormat = [content.submissionFormat ?? content.submissionRequirements ?? requirements.submission,
            ...rules.map(rule => object(rule.content) && typeof rule.content.submission === "string" ? rule.content.submission : "")]
            .filter(value => typeof value === "string" && value.trim()).join("\n\n");
        return { ...cleanTaskText(content), id: `pi:${taskIdentity}`, directionId: `pi:${taskIdentity}`, competitionId, libraryId: competitionId,
            competitionTitle: competition.title, title: title || competition.title, scopePointer, ...(choiceId ? { choiceId } : {}),
            sourceUrl: competition.sourceUrl, sourceVersion: competition.sourceVersion, revision: competition.revision,
            versionToken: detail.versionToken, sixFieldIndexHash: detail.sixFieldIndexHash, materialStatus: detail.materialStatus,
            themeTask: cleanCreativeText(text(content.themeTask ?? content.shortTheme ?? content.description)),
            creativeContent: cleanCreativeText(creativeContent),
            submissionFormat: cleanCreativeText(submissionFormat),
            finalSubmissionFormat: content.finalSubmissionFormat,
            deadline: typeof deadline.date === "string" ? deadline.date : undefined,
            fee: fee.value ?? null, feeStatus: fee.status === "free" || fee.status === "paid" ? fee.status : "unknown",
            designTypes: Array.isArray(forms.categories) ? forms.categories : [],
            evidence: rows(proof && "evidence" in proof ? proof.evidence : []), evidenceStatus: proof?.status ?? "mapping_unknown",
            // Parent context and explicit shared rules remain distinct; no automatic applicability is invented.
            taskContext, taskRelations: detail.taskRelations,
            directionPending: selected.requirementStatus === "conflict",
            ...(options.reason ? { reason: options.reason } : {}),
            recommendationPresentation: { source: "explicit_delivery",
                label: "推荐任务", automaticCanvasCreation: false } };
    };
    if (chosen) return make(chosen.content, chosen.rules, chosen.title, chosen.choiceId);
    const base = make(selected.content as Data, rows(selected.rules), selected.title);
    return choices.length ? { ...base, submissionOptions: choices.map(choice => make(choice.content, choice.rules, choice.title, choice.choiceId)) } : base;
}

/** Resolve only an explicit recommendation within the current query's exact scope and complete version. */
export async function prepareRecommendationArtifact(root: string, input: RecommendationInput, binding: RecommendationBinding, requireChoice = false) {
    if (!input.competitionId || !binding.scopePointers.length || !hash(binding.versionToken)) throw new Error("推荐须引用本轮已查询的竞赛和任务范围。");
    if (input.scopePointer !== undefined && !binding.scopePointers.includes(input.scopePointer)) throw new Error("推荐任务不在本次匹配范围，请重新查询后选择。");
    const scopePointer = input.scopePointer ?? (binding.scopePointers.length === 1 ? binding.scopePointers[0] : undefined);
    const directory = await readLibraryTaskDirectory(root, input.competitionId, { scopePointers: binding.scopePointers,
        filters: binding.filters, expectedVersionToken: binding.versionToken });
    if (scopePointer === undefined) return { kind: "competition_recommendation", title: binding.title || input.competitionId,
        data: { competitionId: input.competitionId, competitionTitle: binding.title, reason: input.reason, status: "task_selection_required", taskDirectory: directory,
            instruction: "请选择一个完整投稿任务后再进入创作。", automaticCanvasCreation: false,
            recommendationPresentation: { source: "explicit_delivery", label: "推荐任务", automaticCanvasCreation: false } }, status: "task_selection_required" };
    const version: LibraryTaskDetailOptions = { scopePointer, expectedVersionToken: binding.versionToken,
        expectedRevision: binding.expectedRevision, expectedIndexHash: binding.expectedIndexHash, expectedSourceVersion: binding.expectedSourceVersion };
    const detail: Data = await readLibraryTaskDetail(root, input.competitionId, version, true);
    const competition = detail.competition as Data;
    if (detail.status !== "selected_task") return { kind: "competition_recommendation", title: String(competition.title || input.competitionId),
        data: { competitionId: input.competitionId, competitionTitle: competition.title, reason: input.reason,
            scopePointer, status: "pending_preparation", materialStatus: detail.materialStatus, taskDirectory: directory,
            instruction: "当前任务尚待整理，不能用摘要替代完整创作要求。", automaticCanvasCreation: false,
            recommendationPresentation: { source: "explicit_delivery", label: "推荐任务", automaticCanvasCreation: false } }, status: "pending_preparation", scopePointer };
    const data = await buildLibraryCanvasTask(root, detail, { ...input, requireChoice });
    return { kind: "canvas_task", title: String((detail.task as Data).title || competition.title || input.competitionId), data,
        scopePointer, status: "selected_task" };
}

type RecommendationRun = { status: string; settled?: boolean; artifacts: RecommendationArtifact[];
    answerReview?: { records: { competitionId: string; revision: string }[]; recommendations?: RecommendationReference[]; candidateList?: { entries: { artifactId: string; competitionId: string }[] } };
    events: { type: string; data: unknown }[]; runId: string };

/** A partially failed delivery may leave saved files; only final-review references publish explicit recommendations. */
export function approvedRecommendationArtifacts(run: Pick<RecommendationRun, "artifacts" | "answerReview">): RecommendationArtifact[] {
    return run.artifacts.filter(artifact => {
        const data = object(artifact.data) ? artifact.data : undefined;
        if (artifact.kind === "competition_candidate") return Boolean(data && run.answerReview?.candidateList?.entries.some(ref => ref.artifactId === artifact.id && ref.competitionId === data.competitionId));
        if (!["canvas_task", "competition_recommendation"].includes(artifact.kind)) return true;
        if (!data || !object(data.recommendationPresentation) || data.recommendationPresentation.source !== "explicit_delivery") return false;
        return Boolean(run.answerReview?.recommendations?.some(ref => ref.artifactId === artifact.id
            && ref.competitionId === data.competitionId && ref.scopePointer === data.scopePointer));
    });
}
/** Creation starts from a server-owned card ID; browser task fields never supply identity, versions or requirements. */
export async function validateRunRecommendation(root: string, run: RecommendationRun, artifactId: string, selectedScopePointer?: string, choiceId?: string, allowChoiceList = false): Promise<RecommendationArtifact> {
    if (run.status !== "completed" || !run.answerReview) throw new Error("这轮回答尚未完成检查，请完成后再选择创作任务。");
    if (run.artifacts.some(artifact => artifact.id === artifactId)
        && !approvedRecommendationArtifacts(run).some(artifact => artifact.id === artifactId))
        throw new Error("该任务卡未包含在本轮最终推荐中，请使用已完成检查的推荐任务。");
    const saved = run.artifacts.find(artifact => artifact.id === artifactId);
    if (saved?.kind === "competition_candidate" && object(saved.data)) {
        const data = saved.data, binding = object(data.binding) ? data.binding : undefined;
        if (!binding || !Array.isArray(binding.scopePointers) || !hash(binding.versionToken) || !hash(binding.expectedRevision)
            || !run.answerReview.candidateList?.entries.some(ref => ref.artifactId === saved.id && ref.competitionId === data.competitionId)
            || !run.answerReview.records.some(record => record.competitionId === data.competitionId && record.revision === binding.expectedRevision))
            throw new Error("候选版本或范围无法验证，请重新查询。");
        if (data.status === "pending_preparation") throw new Error("完整创作要求尚待整理，暂不能进入创作。");
        const item = await prepareRecommendationArtifact(root, { competitionId: String(data.competitionId), ...(selectedScopePointer !== undefined ? { scopePointer: selectedScopePointer } : {}), choiceId }, binding as RecommendationBinding, !allowChoiceList);
        if (item.kind === "canvas_task") return { ...saved, kind: item.kind, title: item.title, data: item.data };
        const details = item.data as Data;
        return { ...saved, kind: item.kind, data: { ...details, candidateTasks: details.taskDirectory ? decodeTaskDirectoryRows(details.taskDirectory as Parameters<typeof decodeTaskDirectoryRows>[0]).map(row => ({ scopePointer: row.scopePointer, title: row.title })) : [] } };
    }
    if (!saved || saved.kind !== "canvas_task" || !object(saved.data)) throw new Error("该任务卡不存在或尚未选定完整投稿任务，请重新查询。");
    const task = saved.data;
    if (selectedScopePointer !== undefined && selectedScopePointer !== task.scopePointer) throw new Error("所选任务不在该创作入口范围内。");
    if (typeof task.competitionId !== "string" || typeof task.scopePointer !== "string" || !hash(task.versionToken) || !hash(task.revision)
        || (task.sixFieldIndexHash !== null && !hash(task.sixFieldIndexHash))
        || (task.sourceVersion !== null && task.sourceVersion !== undefined && !hash(task.sourceVersion)))
        throw new Error("该任务卡缺少可验证的当前版本，请重新查询后再进入创作。");
    const detail = await readLibraryTaskDetail(root, task.competitionId, { scopePointer: task.scopePointer,
        expectedRevision: String(task.revision), expectedVersionToken: String(task.versionToken),
        expectedIndexHash: task.sixFieldIndexHash as string | null,
        expectedSourceVersion: typeof task.sourceVersion === "string" ? task.sourceVersion : null }, true);
    if (detail.status !== "selected_task") throw new Error("该任务尚待整理，不能用推荐摘要替代完整要求。");
    return { ...saved, data: await buildLibraryCanvasTask(root, detail, { reason: typeof task.reason === "string" ? task.reason : undefined, choiceId, requireChoice: !allowChoiceList }) };
}
