import type { PreparedMaterialsBundle, PreparedMaterialResource } from "./prepared-materials.js";
import { cleanCreativeText } from "./creative-text.js";
import { submissionDeliverables } from "./submission-overview.js";
import { competitionPageLink } from "./competition-page-link.js";
import { compileSubmissionOptions } from "./submission-options-intake.js";
import { compileSubmissionChoicePlan, readSubmissionChoicePlans, type SubmissionChoicePlan } from "./submission-choice-plan.js";
import { unexpandedSubmissionOutcomes } from "./submission-outcome-guard.js";
import { COMPETITION_CARD_VERSION, cardHash, saveCompetitionCards, type StoredCompetitionCards } from "./competition-card-store.js";
type Data = Record<string, unknown>;
const object = (value: unknown): value is Data => Boolean(value) && typeof value === "object" && !Array.isArray(value);
/** Only saved, explicit creative fields. Never infer a brief from a title, category or sibling. */
export function savedCreativeDescription(record: Data): string | undefined {
    const requirements = object(record.requirements) ? record.requirements : {};
    for (const value of [requirements.creativeContent, requirements.creative])
        if (typeof value === "string" && value.trim() && !/^(?:未知|未记录|待整理|待确认|未说明)[。.]?$/.test(value.trim())) return cleanCreativeText(value) || undefined;
    for (const key of ["creativeContent", "themeTask", "requirements", "description", "shortTheme"]) {
        const value = record[key];
        if (typeof value === "string" && value.trim() && !/^(?:未知|未记录|待整理|待确认|未说明)[。.]?$/.test(value.trim())) {
            const content = cleanCreativeText(value);
            if (!content) return undefined;
            if (/^(?:注[：:]\s*)?(?:定向主题)?要求详见.*官网[。.]?$/.test(content)) continue;
            return content;
        }
    }
}
export function savedSubmissionText(record: Data): string | undefined {
    const requirements = object(record.requirements) ? record.requirements : {};
    for (const value of [record.finalSubmissionFormat, record.submissionFormat, record.submissionRequirements, requirements.submission])
        if (typeof value === "string" && value.trim() && !/^(?:未知|未记录|未公布|待整理|待确认|未说明)[。.]?$/.test(value.trim())) return cleanCreativeText(value) || undefined;
    const works = Array.isArray(record.workItems) ? record.workItems.filter(object) : [];
    const lines = works.map(work => [work.name, work.quantity, work.submission_requirements || work.specifications].filter(value => typeof value === "string" && value.trim()).join(" · ")).filter(Boolean);
    return lines.length ? lines.join("\n") : undefined;
}

/** Compile once on intake or an explicit library rebuild, never from a query/page read. */
export function compileCompetitionCards(bundle: PreparedMaterialsBundle, resources: PreparedMaterialResource[], plans: Record<string, SubmissionChoicePlan> = {}): StoredCompetitionCards {
    const tasks = bundle.tasks.map(record => {
        const scopedRules = bundle.rules.filter(rule => rule.appliesTo.includes(record.id) && record.ruleRefs.includes(rule.id));
        const shared = bundle.rules.filter(rule => rule.status === "explicit" && rule.appliesTo.includes(record.id)
            && record.ruleRefs.includes(rule.id) && !bundle.conflicts?.some(conflict => conflict.kind === "rule" && conflict.id === rule.id));
        const submission = cleanCreativeText([savedSubmissionText(record), ...shared.map(rule => object(rule.content) ? rule.content.submission : "")]
            .filter(value => typeof value === "string" && value).join("\n\n")) || undefined;
        const choices = plans[record.scopePointer] ? compileSubmissionChoicePlan(record, scopedRules, plans[record.scopePointer]) : compileSubmissionOptions(record, shared);
        const options = choices.map(option => ({ ...option,
            scopePointer: record.scopePointer, title: option.content.title, description: record.status === "unknown" || record.requirements === null ? undefined : savedCreativeDescription(option.content),
            submission: savedSubmissionText(option.content), deliverables: submissionDeliverables(option.content, option.rules),
            ...(object(record.track) && record.track.status === "known" && typeof record.track.title === "string" ? { group: record.track.title } : {}) }));
        return { scopePointer: record.scopePointer, title: record.title,
            description: record.status === "unknown" || record.requirements === null ? undefined : savedCreativeDescription(record),
            submission, deliverables: submissionDeliverables(record, shared), ...(options.length ? { options } : {}),
            ...(object(record.track) && record.track.status === "known" && typeof record.track.title === "string" ? { group: record.track.title } : {}) };
    });
    return { version: COMPETITION_CARD_VERSION, identity: bundle.identity, materialHash: cardHash(bundle),
        competitionLink: competitionPageLink(bundle.identity.sourceUrl, resources), tasks };
}
export async function publishCompetitionCards(root: string, bundle: PreparedMaterialsBundle, resources: PreparedMaterialResource[]) {
    const plans = await readSubmissionChoicePlans(root, bundle);
    if (unexpandedSubmissionOutcomes(bundle.tasks.filter(task => !plans[task.scopePointer])).length)
        throw new Error("可选提交结果尚未分别整理，不能发布合并卡片。");
    return saveCompetitionCards(root, bundle, compileCompetitionCards(bundle, resources, plans));
}
