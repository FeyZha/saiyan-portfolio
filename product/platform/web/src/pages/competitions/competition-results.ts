import { DESIGN_DIRECTIONS, type CompetitionCreationSupport, type CompetitionFeed, type CompetitionIntent, type CompetitionReport, type DesignDirection } from "@/services/api/competitions";
import { competitionTextMissing, competitionThemeDescription } from "@/lib/competition-brief";

export function competitionDesignTypes(item: CompetitionReport): DesignDirection[] {
    const types = item.designTypes?.filter((direction) => DESIGN_DIRECTIONS.includes(direction));
    return types?.length ? types : ["综合视觉"];
}

export function competitionFeeStatus(item: CompetitionReport): "free" | "paid" | "unknown" {
    if (item.feeStatus) return item.feeStatus;
    // Optional certificates, travel and postage are not mandatory entry fees.
    const fee = (item.fee || "").replace(/(?:奖金|奖品价值|奖励金额)[^。；;\n，,]*/g, "")
        .split(/[。；;\n，]|,(?!\d)/).filter((part) => !/自愿|可选|交通|差旅|食宿|寄送|邮寄/.test(part));
    const noFee = /(?:免收|不收取|不收|(?:无需|不需)[^。；;]*费|无报名费|无参赛费|(?:报名|参赛)费[用：:\s]*0\s*元)/;
    const paid = fee.filter((part) => !noFee.test(part)).some((part) =>
        /(?:[1-9]\d*(?:[,.]\d+)*\s*(?:元|美元|欧元|日元|英镑|人民币|USD|EUR|CNY|JPY)|[$€£]\s*[1-9]\d*)/i.test(part)
        || /(?:需缴|须缴|需支付|须支付|有偿|收费参赛)/.test(part));
    if (paid) return "paid";
    return fee.some((part) => !/注册|账号|账户/.test(part) && (noFee.test(part) || /免费/.test(part))) ? "free" : "unknown";
}

export function competitionReports(feed: CompetitionFeed): CompetitionReport[] {
    const seen = new Set<string>();
    return [...feed.items, ...feed.pending].flatMap<CompetitionReport>((competition) => {
        const source = competition.sourceUrl || competition.id;
        if (seen.has(source)) return [];
        seen.add(source);
        if (!competition.directions?.length) return [{ ...competition, directionPending: competition.directionPending || Boolean(feed.directionErrors?.[competition.id]),
            pendingReason: [competition.pendingReason, competition.coverageStatus === "needs_review" && "原文组别完整性待核对", feed.directionErrors?.[competition.id]].filter(Boolean).join("；") }];
        // Titles follow the complete competition structure, before filtering or pagination, for every ingestion.
        const directions = competition.directions.map((direction) => ({ ...direction, competitionId: competition.id,
            competitionTitle: competition.title, priority: competition.priority, recognized: competition.recognized,
            displayTitle: competition.directions!.length > 1 && direction.title !== competition.title ? `${competition.title} · ${direction.title}` : competition.title,
            pendingReason: [direction.pendingReason, competition.coverageStatus === "needs_review" && "原文组别完整性待核对", feed.directionErrors?.[competition.id] && `本次整理未完成，显示上次资料：${feed.directionErrors[competition.id]}`].filter(Boolean).join("；"),
            sourceVersion: competition.sourceVersion, coverageStatus: competition.coverageStatus }));
        return [{ ...competition, directions, designTypes: [...new Set(directions.flatMap(competitionDesignTypes))] }];
    });
}

export function competitionCreationSupport(item: Pick<CompetitionReport, "creationSupport" | "graphicStatus">): CompetitionCreationSupport & { source: "work_items" | "legacy" } {
    if (item.creationSupport) return { ...item.creationSupport, source: "work_items" };
    // Saved reports remain unchanged until the user explicitly requests reprocessing.
    return { status: item.graphicStatus === "graphic" ? "supported" : item.graphicStatus === "non_graphic" ? "unsupported" : "unclear",
        reason: item.graphicStatus === "non_graphic" ? "不属于已保存的工作台创作范围" : "", source: "legacy" };
}

export function competitionDirections(feed: CompetitionFeed): CompetitionReport[] {
    return competitionReports(feed).flatMap((item) => item.directions?.length ? item.directions : [item]);
}

export function competitionCreationTasks(item: CompetitionReport): CompetitionReport[] {
    return (item.directions?.length ? item.directions : [item]).flatMap((direction) => direction.creativeCategories?.length
        ? direction.creativeCategories!.map((category) => {
            const theme = competitionThemeDescription(category.description) ? "" : competitionThemeDescription(direction.themeTask);
            return { ...direction,
                id: `${direction.id}/${category.id}`, directionId: `${direction.directionId || direction.id}/${category.id}`,
                submissionDirectionId: direction.directionId || direction.id, creationCategory: category.title, creationScope: category.description, creativeCategories: undefined,
                title: direction.title === category.title ? direction.title : `${direction.title} · ${category.title}`,
                displayTitle: direction.title === category.title ? direction.displayTitle || direction.competitionTitle || direction.title : `${direction.displayTitle || direction.competitionTitle || direction.title} · ${category.title}`,
                directionThemeTask: direction.themeTask,
                themeTask: competitionTextMissing(category.description) ? category.description
                    : direction.themeTask.trim() && competitionTextMissing(direction.themeTask) && !competitionThemeDescription(category.description) ? direction.themeTask
                    : [`本次创作类别：${category.title}`, category.description, theme && `创作主题：${theme}`].filter(Boolean).join("\n"),
                submissionFormat: category.submissionFormat || direction.submissionFormat,
                finalSubmissionFormat: category.finalSubmissionFormat || direction.finalSubmissionFormat,
                workItems: category.workItems,
                creationSupport: category.creationSupport,
                graphicStatus: category.workItems || category.creationSupport ? undefined : direction.graphicStatus,
            };
        }) : [direction]);
}

export function directionBlockReason(item: Pick<CompetitionReport, "ingestionMode" | "directionPending" | "creationSupport" | "graphicStatus" | "eligibilityStatus" | "deadline" | "themeTask" | "submissionFormat" | "creativeCategories"> & { creativeContent?: string }): string {
    if (item.directionPending) return "投稿结构尚待核对";
    const support = competitionCreationSupport(item);
    if (support.status === "unsupported") return support.reason || "当前工作台暂不支持此创作任务";
    if (support.source === "work_items" && support.status === "unclear") return support.reason || "主要创作任务尚未明确";
    if (item.eligibilityStatus === "ineligible") return "不符合当前参赛资格";
    if (item.deadline && item.deadline < new Date().toLocaleDateString("sv-SE")) return "已截止";
    if (item.ingestionMode === "source") {
        if (competitionTextMissing(item.themeTask) && competitionTextMissing(item.creativeContent)) return "请先选择本次创作内容";
        return (item.creativeCategories?.length || 0) > 1 ? "请选择本次创作类别" : "";
    }
    if (competitionTextMissing(item.themeTask)) return "创作主题尚未提供";
    if (competitionTextMissing(item.submissionFormat)) return "主要交付内容尚未提供";
    if ((item.creativeCategories?.length || 0) > 1) return "请选择本次创作类别";
    return "";
}

function candidates(feed: CompetitionFeed, intent: CompetitionIntent, excludedIds: string[]) {
    const today = new Date();
    const todayNumber = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    const excluded = new Set(excludedIds);
    return competitionDirections(feed).flatMap((item) => {
        if (excluded.has(item.id) || excluded.has(item.competitionId || item.id) || competitionCreationSupport(item).status === "unsupported" || item.eligibilityStatus === "ineligible") return [];
        const remaining = item.deadline ? (Date.parse(`${item.deadline}T00:00:00Z`) - todayNumber) / 86_400_000 : null;
        if (remaining !== null && (remaining < 0 || (intent.deadlineDays && remaining > intent.deadlineDays))) return [];
        if (intent.priority === "a_class" && item.priority !== "a_class") return [];
        if (intent.priority === "recognized" && !item.recognized && item.priority !== "recognized") return [];
        const feeStatus = competitionFeeStatus(item);
        if (intent.freeOnly !== false && feeStatus === "paid") return [];
        const uncertainTrack = competitionCreationSupport(item).status === "unclear";
        const content = [item.title, item.competitionTitle, item.track, item.themeTask, item.submissionFormat, item.eligibility].join(" ").toLowerCase();
        if (intent.keywords.length && !intent.keywords.some((word) => content.includes(word.toLowerCase()))) return [];
        if (intent.designTypes.length && !uncertainTrack && !intent.designTypes.some((direction) => competitionDesignTypes(item).includes(direction))) return [];
        return [{ ...item, feeStatus, pendingReason: directionBlockReason({ ...item, creativeCategories: undefined }) }];
    });
}

function orderedReports(feed: CompetitionFeed, intent: CompetitionIntent, excludedIds: string[] = []) {
    const rank = (item: CompetitionReport) => item.priority === "a_class" ? 0 : item.priority === "recognized" ? 1 : 2;
    const matched = candidates(feed, intent, excludedIds).filter((item) => !item.directionPending)
        .sort((a, b) => Number(Boolean(a.pendingReason)) - Number(Boolean(b.pendingReason)) || rank(a) - rank(b)
        || (a.deadline || "9999").localeCompare(b.deadline || "9999"));
    const primary = matched.filter((item) => !item.pendingReason);
    return primary.length >= 5 ? primary : matched;
}

export function selectCompetitionResults(feed: CompetitionFeed, intent: CompetitionIntent, excludedIds: string[] = []): CompetitionReport[] {
    return orderedReports(feed, intent, excludedIds).slice(0, 5);
}

export function defaultCompetitionReports(feed: CompetitionFeed): CompetitionReport[] {
    return orderedReports(feed, { intent: "filter", keywords: [], designTypes: [], deadlineDays: null, priority: "all", freeOnly: true, reply: "" });
}
