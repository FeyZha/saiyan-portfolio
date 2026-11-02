import { buildApiUrl, decodeChannelModel, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";

export const DESIGN_DIRECTIONS = ["海报", "插画", "文创", "包装", "品牌/VI", "字体", "书籍装帧", "漫画", "标志", "IP/吉祥物", "信息图形", "综合视觉", "其他", "未知"] as const;
export type DesignDirection = (typeof DESIGN_DIRECTIONS)[number];

export type CompetitionWorkItem = {
    name: string;
    quantity?: string;
    submission_requirements?: string;
    kind: "visual_design" | "product_concept" | "video" | "spatial" | "physical" | "functional" | "document" | "photography" | "fashion" | "other" | "unknown";
    role: "primary" | "supporting";
    requirement: "required" | "optional" | "unclear";
    delivery: "design_files" | "finished_media" | "physical_object" | "runnable" | "unspecified";
    evidence: { url: string; quote: string };
};
export type CompetitionCreationSupport = { status: "supported" | "partial" | "unsupported" | "unclear"; reason: string };

export type CompetitionReport = {
    id: string;
    competitionId?: string;
    competitionTitle?: string;
    displayTitle?: string;
    directionId?: string;
    submissionDirectionId?: string;
    creationCategory?: string;
    creationScope?: string;
    directionThemeTask?: string;
    creativeCategories?: { id: string; title: string; description: string; submissionFormat?: string; finalSubmissionFormat?: string; evidence?: { url: string; quote: string }; workItems?: CompetitionWorkItem[]; creationSupport?: CompetitionCreationSupport }[];
    workItems?: CompetitionWorkItem[];
    creationSupport?: CompetitionCreationSupport;
    directions?: CompetitionReport[];
    matchedDirectionIds?: string[];
    directionPending?: boolean;
    independence?: "confirmed" | "unclear";
    sourceHeading?: string;
    sourceHeadings?: string[];
    bindingEvidence?: { url: string; quote: string } | null;
    sourceVersion?: string;
    ingestionMode?: "source";
    coverageStatus?: "checked_headings" | "needs_review";
    evidence?: { url: string; quote: string }[];
    missingInformation?: string[];
    eligibilityStatus?: "eligible" | "ineligible" | "unclear";
    title: string;
    track: string;
    designTypes?: DesignDirection[];
    eligibility: string;
    themeTask: string;
    deadline?: string | null;
    submissionFormat: string;
    finalSubmissionFormat?: string;
    fee: string;
    feeStatus?: "free" | "paid" | "unknown";
    graphicStatus?: "graphic" | "non_graphic" | "unclear";
    recognized?: boolean;
    registrationUrl: string;
    sourceUrl: string;
    sourceUrls: string[];
    collectedAt: string;
    pendingReason?: string;
    priority?: "a_class" | "recognized";
};

export type CompetitionFeed = {
    version: number;
    source: string;
    sourceUrl: string;
    fetchedAt: string | null;
    items: CompetitionReport[];
    pending: CompetitionReport[];
    recognizedNames: string[];
    aClassSourceUrl?: string;
    importResult?: { nameCount: number; matchedCount: number };
    updating?: boolean;
    updateError?: string;
    checking?: boolean;
    queuedCount?: number;
    failedCount?: number;
    reprocessing?: boolean;
    directionErrors?: Record<string, string>;
    checkError?: string;
    lastUpdate?: { id: string; processed: number; failed: number; completedAt?: string };
    discovery?: {
        checkedOn?: string | null;
        checkedAt?: string | null;
        checkError?: string;
        lastBatch?: { processed: number; failed: number };
    };
};

export type CompetitionIntent = {
    intent: "filter" | "upload_recognition" | "refresh" | "help" | "clarify";
    keywords: string[];
    designTypes: DesignDirection[];
    deadlineDays: number | null;
    priority: "a_class" | "recognized" | "all";
    freeOnly: boolean;
    nextPage?: boolean;
    choices?: string[];
    reply: string;
};

export type CompetitionConversationContext = {
    filter?: CompetitionIntent;
    lastQuestion?: string;
    clarification?: string;
};

export function competitionAgentConfigured(config: AiConfig) {
    return true;
}

function competitionRequestConfig(_config: AiConfig) {
    return { provider: "codex" as const };
}

export async function recognizeCompetitionIntent(_question: string, _config: AiConfig, _context?: CompetitionConversationContext): Promise<CompetitionIntent> {
    throw new Error("旧意图识别入口已停用，请使用当前竞赛对话。");
}

async function requestCompetition<T = CompetitionFeed>(method: "GET" | "POST", config?: AiConfig, payload?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const model = config ? competitionRequestConfig(config) : undefined;
    const body = model || payload ? { ...model, ...payload } : undefined;
    const response = await fetch("/__workbench/competitions", {
        method,
        cache: "no-store",
        signal,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await response.json()) as T & { error?: string };
    if (!response.ok) throw new Error(data.error || "竞赛信息获取失败");
    return data;
}

export const getCompetitionFeed = (signal?: AbortSignal) => requestCompetition("GET", undefined, undefined, signal);
export const refreshCompetitionFeed = (_config: AiConfig, forceCheck = false) => requestCompetition("POST", undefined, { action: "drainQueue", forceCheck, sourceOnly: true });
export const prepareCompetitionDirections = (config: AiConfig, competitionId: string) => requestCompetition("POST", config, { action: "drainQueue", competitionId });

export async function importRecognitionDocument(_file: File, _config: AiConfig): Promise<CompetitionFeed> {
    throw new Error("认定目录入口已停用，当前只支持作品类型、费用和截止查询。");
}
