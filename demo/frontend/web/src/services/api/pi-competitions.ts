import { type AiConfig } from "@/stores/use-config-store";
import { competitionTextMissing, competitionThemeDescription } from "@/lib/competition-brief";
import type { CompetitionReport, CompetitionWorkItem } from "@/services/api/competitions";
import type { CompetitionCandidate } from "@/types/workspace";

export type PiModelConfig =
    | { mode: "preset" }
    | { mode: "oauth"; provider: "openai-codex"; model?: string }
    | { mode: "api"; baseUrl: string; apiKey: string; model: string; apiFormat: "openai" };
export type PiModelMode = PiModelConfig["mode"];
export type PiFile = { name: string; mimeType: string; dataBase64: string };
export type PiEvent = { seq: number; type: string; at: string; data: unknown };
export type PiCandidateFacts = { submissionForms?: string[]; deadlines?: { date?: string; status: string; taskCount?: number }[]; fees?: { status: string; taskCount?: number }[] };
export type PiCandidateTaskPreview = { scopePointer: string; choiceId?: string; title: string; description?: string; submission?: string; deliverables?: { name: string; details?: string; description?: string; condition?: string }[]; facts?: PiCandidateFacts; requiredTogether?: boolean; group?: string; category?: string; submissionContext?: { title: string; text: string } };
export type PiCandidatePreview = { status: "ready" | "unavailable"; description?: string; message?: string; competitionLink?: { url: string; label: "竞赛官网" | "查看公告" }; tasks: PiCandidateTaskPreview[] };
export type PiArtifact = { id: string; kind: string; title: string; path?: string; data?: unknown };
export type PiActivity = { id: string; agent: "main" | "official"; label: string; status: "running" | "completed" | "failed" };
export type PiPresentation = { revision: number; draftAnswer: string; draftKind: "text" | "delivery";
    phase: "running" | "reviewing" | "completed" | "failed" | "cancelled" | "interrupted"; activity?: PiActivity; visibleItems?: number };
export type PiRun = {
    runId: string; sessionId: string; question: string; answer: string;
    status: "running" | "completed" | "failed" | "cancelled" | "interrupted";
    settled?: boolean;
    createdAt: string; updatedAt: string; events: PiEvent[]; artifacts: PiArtifact[];
    error?: string; model?: { provider: string; id: string }; usage?: unknown;
    usageAccounting?: { status: "complete" | "partial" | "unknown" | "not_requested"; knownTokens: number; unreportedRequests: number };
    answerReview?: { gaps?: { competitionId: string; fields: string[] }[]; records: { competitionId: string; revision: string }[]; reviewedAt: string; path: string;
        candidateList?: { entries: { artifactId: string; competitionId: string; title: string; taskCount: number; status: string; markdown: string; facts?: { submissionForms?: string[]; deadlines?: { date?: string; status: string; taskCount?: number }[]; fees?: { status: string; taskCount?: number }[] } }[]; footer: string; notice?: string; introduction?: string };
        recommendations?: { artifactId: string; competitionId: string; scopePointer?: string; status: string }[] };
    reviewRequired?: boolean;
    presentation?: PiPresentation;
    files?: { name: string; mimeType: string; path: string }[];
};
export type PiSessionSummary = { id: string; title: string; createdAt: string; updatedAt: string; runCount: number; lastRunId?: string };
export type PiSession = Omit<PiSessionSummary, "runCount"> & { runs: PiRun[] };
export type PiStatus = { preset?: { available: boolean; reason?: string }; oauth?: { available: boolean; reason?: string }; library?: { items: number; pending: number; ignored: number }; [key: string]: unknown };
export type PiTask = CompetitionCandidate & Pick<CompetitionReport, "themeTask" | "submissionFormat" | "registrationUrl" | "workItems" | "directionPending" | "creationSupport" | "graphicStatus"> & { feeStatus?: "free" | "paid" | "unknown"; reason?: string; evidence?: { url: string; quote: string }[]; agentData: unknown };
export type PiTaskSelection = { scopePointer?: string; choiceId?: string };

export const piRunActive = (run: PiRun) => run.settled === false || (run.settled === undefined && run.status === "running");

async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`/__workbench/pi${path}`, {
        method: body === undefined ? "GET" : "POST", cache: "no-store", signal,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(data.error || "探索服务暂时不可用");
    return data;
}

export const getPiStatus = (signal?: AbortSignal) => request<PiStatus>("/status", undefined, signal);
export const listPiSessions = (signal?: AbortSignal) => request<{ sessions: PiSessionSummary[] }>("/sessions", undefined, signal);
export const getPiSession = (id: string, signal?: AbortSignal) => request<PiSession>(`/sessions/${encodeURIComponent(id)}?view=compact`, undefined, signal);
export const getPiRun = (id: string, signal?: AbortSignal) => request<PiRun>(`/runs/${encodeURIComponent(id)}?view=compact`, undefined, signal);
export const cancelPiRun = (id: string) => request<PiRun>(`/runs/${encodeURIComponent(id)}/cancel?view=compact`, {});
export const getPiRecommendationTask = (runId: string, artifactId: string, scopePointer?: string, choiceId?: string) => request<{ artifact: PiArtifact }>(`/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}/task${scopePointer !== undefined ? `?scopePointer=${encodeURIComponent(scopePointer)}${choiceId !== undefined ? `&choiceId=${encodeURIComponent(choiceId)}` : ""}` : ""}`);
export const createPiComfyArt = (runId: string, artifactId: string, selection: PiTaskSelection) =>
    request<{ projectId: string; url: string }>("/comfyart", { runId, artifactId, scopePointer: selection.scopePointer, choiceId: selection.choiceId });
export const startPiRun = (input: { question: string; sessionId?: string; config: PiModelConfig; files?: PiFile[] }) => request<PiRun>("/runs?view=compact", input);

export function piModelMode(config: Pick<AiConfig, "competitionAgent">, preferred: PiModelMode, modeChosen: boolean): PiModelMode {
    return "oauth";
}

export function piRunModel(_config: AiConfig, _mode: PiModelMode): PiModelConfig {
    return { mode: "oauth", provider: "openai-codex", model: "gpt-6.1-sol" };
}

// Kept for old imports; new requests always use Codex.
export const piApiModel = (config: AiConfig): PiModelConfig => piRunModel(config, "oauth");

export function readPiFile(file: File): Promise<PiFile> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error(`无法读取 ${file.name}`));
        reader.onload = () => resolve({ name: file.name, mimeType: file.type || "application/octet-stream", dataBase64: String(reader.result).split(",", 2)[1] || "" });
        reader.readAsDataURL(file);
    });
}

function taskText(value: unknown): string {
    return typeof value === "string" ? value : value == null ? "" : JSON.stringify(value, null, 2);
}

function taskWorkItems(value: unknown): CompetitionWorkItem[] {
    return (Array.isArray(value) ? value : []).filter((work) => work && typeof work === "object" && !Array.isArray(work)).map((work) => {
        const text = (value: unknown) => typeof value === "string" ? value : "";
        return { ...work, name: text(work.name),
            ...(work.quantity === undefined ? {} : { quantity: text(work.quantity) }),
            ...(work.submission_requirements === undefined ? {} : { submission_requirements: text(work.submission_requirements) }),
            evidence: { url: text(work.evidence?.url), quote: text(work.evidence?.quote) } };
    });
}

export function competitionWorkItemText(work: CompetitionWorkItem) {
    return { name: work.name?.trim() ? work.name : "未说明", quantity: work.quantity?.trim() ? work.quantity : "未说明",
        role: work.role === "primary" ? "主体" : work.role === "supporting" ? "配套" : "未说明",
        requirement: work.requirement === "required" ? "必交" : work.requirement === "optional" ? "选交" : "必交关系未明",
        submissionRequirements: work.submission_requirements?.trim() ? work.submission_requirements : "未说明" };
}

function workItemsCreativeContent(value: unknown): string | undefined {
    const works = taskWorkItems(value);
    if (!works.length || !works.every((work) => work && typeof work.name === "string" && work.name.trim()
        && ["primary", "supporting"].includes(work.role) && ["required", "optional", "unclear"].includes(work.requirement))
        || !works.some((work) => work.role === "primary")) return undefined;
    return works.map((work) => { const text = competitionWorkItemText(work);
        return `${text.name}｜数量：${text.quantity}｜${text.role} · ${text.requirement}｜提交要求：${text.submissionRequirements}`;
    }).join("\n");
}

export function artifactTask(artifact: PiArtifact): PiTask | null {
    if (artifact.kind !== "canvas_task") return null;
    const task = artifact.data && typeof artifact.data === "object" ? artifact.data as Record<string, unknown> : {};
    const deadline = task.deadline && typeof task.deadline === "object" ? task.deadline as { date?: unknown } : undefined;
    const evidence = Array.isArray(task.evidence) ? task.evidence : task.evidence && typeof task.evidence === "object" ? [task.evidence] : [];
    return { ...task, id: typeof task.id === "string" && task.id ? task.id : artifact.id,
        title: typeof task.title === "string" ? task.title : artifact.title,
        themeTask: taskText(task.themeTask),
        creativeContent: task.creativeContent === undefined ? undefined : taskText(task.creativeContent),
        submissionFormat: taskText(task.submissionFormat),
        competitionId: typeof task.competitionId === "string" ? task.competitionId : undefined,
        competitionTitle: typeof task.competitionTitle === "string" ? task.competitionTitle : undefined,
        finalSubmissionFormat: taskText(task.finalSubmissionFormat) || (task.recommendationPresentation ? "最终形式与规格未说明，待核" : undefined),
        registrationUrl: typeof task.registrationUrl === "string" ? task.registrationUrl : "",
        workItems: taskWorkItems(task.workItems),
        evidence: evidence.filter((item) => item && typeof item.url === "string" && typeof item.quote === "string"),
        sourceUrl: typeof task.sourceUrl === "string" ? task.sourceUrl : undefined,
        deadline: typeof deadline?.date === "string" ? deadline.date : taskText(task.deadline) || undefined,
        reason: typeof task.reason === "string" ? task.reason : undefined,
        agentData: artifact.data };
}

export function artifactTasks(artifact: PiArtifact): PiTask[] {
    const base = artifactTask(artifact);
    if (!base) return [];
    const raw = artifact.data && typeof artifact.data === "object" ? artifact.data as Record<string, unknown> : {};
    const records = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item)) : [];
    if (Array.isArray(raw.submissionOptions)) return records(raw.submissionOptions).flatMap(data => {
        const task = artifactTask({ ...artifact, data }); return task ? [task] : [];
    });
    if (raw.recommendationPresentation && typeof raw.recommendationPresentation === "object" && (raw.recommendationPresentation as Record<string, unknown>).source === "explicit_delivery") return [base];
    const directions = records(raw.directions);
    return (directions.length ? directions : [raw]).flatMap((source, index) => {
        const id = typeof source.id === "string" && source.id ? source.id : directions.length ? `${base.id}:direction:${index}` : base.id;
        const inheritedTheme = competitionThemeDescription(taskText(raw.themeTask));
        const sourceTheme = taskText(source.themeTask);
        const direction: Record<string, unknown> = { ...raw, ...source, id,
            competitionId: base.competitionId || base.id, competitionTitle: base.competitionTitle || base.title,
            registrationUrl: typeof source.registrationUrl === "string" && source.registrationUrl.trim() ? source.registrationUrl
                : typeof raw.registrationUrl === "string" && raw.registrationUrl.trim() ? raw.registrationUrl : "",
            directionId: directions.length ? source.directionId || id : source.directionId,
            title: typeof source.title === "string" && source.title ? source.title : base.title,
            themeTask: directions.length && !competitionTextMissing(sourceTheme) && inheritedTheme && !competitionThemeDescription(sourceTheme)
                ? `${sourceTheme}\n创作主题：${inheritedTheme}` : sourceTheme || raw.themeTask,
            creativeContent: directions.length ? source.creativeContent : raw.creativeContent,
            directions: undefined };
        const categories = records(source.creativeCategories);
        const choices = categories.length ? categories.map((category, categoryIndex) => {
            const categoryId = typeof category.id === "string" && category.id ? category.id : String(categoryIndex);
            const title = typeof category.title === "string" && category.title ? category.title : "创作类别";
            const description = taskText(category.description);
            const parentTheme = taskText(direction.themeTask);
            const theme = competitionThemeDescription(description) ? "" : competitionThemeDescription(taskText(direction.themeTask));
            return { ...direction, ...category, id: `${id}/${categoryId}`, directionId: `${direction.directionId || id}/${categoryId}`,
                submissionDirectionId: direction.directionId || id, creationCategory: title,
                registrationUrl: typeof category.registrationUrl === "string" && category.registrationUrl.trim() ? category.registrationUrl : direction.registrationUrl,
                title: direction.title === title ? title : `${direction.title} · ${title}`,
                themeTask: competitionTextMissing(description) ? description
                    : parentTheme.trim() && competitionTextMissing(parentTheme) && !competitionThemeDescription(description) ? parentTheme
                    : [`本次创作类别：${title}`, description, theme && `创作主题：${theme}`].filter(Boolean).join("\n"),
                creativeContent: category.creativeContent ?? workItemsCreativeContent(category.workItems) ?? (description || undefined),
                submissionFormat: category.submissionFormat || direction.submissionFormat,
                finalSubmissionFormat: category.finalSubmissionFormat || direction.finalSubmissionFormat,
                workItems: category.workItems, creationSupport: category.creationSupport,
                graphicStatus: category.workItems || category.creationSupport ? undefined : direction.graphicStatus,
                creativeCategories: undefined };
        }) : [{ ...direction, creativeCategories: undefined }];
        return choices.map((choice) => { const task = artifactTask({ ...artifact, data: choice })!;
            return { ...task, creativeContent: competitionTextMissing(task.creativeContent) ? workItemsCreativeContent(task.workItems) ?? task.creativeContent : task.creativeContent, agentData: artifact.data };
        });
    });
}
