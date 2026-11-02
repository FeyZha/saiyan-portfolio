import type { LibraryCompetition } from "./competition-library.js";

type JsonObject = Record<string, unknown>;
export const SIX_FIELD_KEYS = ["competitionName", "themeAndOverview", "submissionForms", "participationRequirements", "submissionDeadline", "feeStatus"] as const;
export type SixFieldKey = typeof SIX_FIELD_KEYS[number];
export const BASIC_FIELD_KEYS = ["submissionForms", "feeStatus", "submissionDeadline"] as const;
export type BasicFieldKey = typeof BASIC_FIELD_KEYS[number];
export type SixFieldEvidence = { kind: "record_field"; pointers: string[]; baseRevision: string } | { kind: "source_text"; url: string; quote: string };
export type SixField = { value: unknown; notes: string | null; evidence: SixFieldEvidence[] };
export type SixFieldEntry = {
    version: 1 | 2; libraryId: string; baseRevision: string; sourceVersion: string | null; sourceUrl: string; indexedAt: string;
    method: "legacy_fields" | "approved_deepseek" | "reviewed_codex" | "unavailable";
    fields: Record<BasicFieldKey, SixField> & Partial<Record<Exclude<SixFieldKey, BasicFieldKey>, SixField>>;
    provenance?: JsonObject;
};
export type SixFieldRead = { status: "ready" | "missing" | "stale" | "invalid"; entry?: SixFieldEntry; hash?: string; reason?: string };
const object = (value: unknown): value is JsonObject => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const records = (value: unknown) => Array.isArray(value) ? value.filter(object) : [];
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
const empty = (): SixField => ({ value: null, notes: null, evidence: [] });
// Same fixed vocabulary as web/src/services/api/competitions.ts; no new classification is inferred here.
export const designDirections = ["海报", "插画", "文创", "包装", "品牌/VI", "字体", "书籍装帧", "漫画", "标志", "IP/吉祥物", "信息图形", "综合视觉", "其他", "未知"];

export function sixFieldPreview(value: unknown, source: string | null) {
    const description = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
    return { description: description ? description.slice(0, 180) : null, descriptionSource: description ? source : null, descriptionTruncated: description.length > 180 };
}

type Scope = { record: JsonObject; id: string; title: string | null; parentId: string | null; pointer: string; leaf: boolean };
function scopes(competition: LibraryCompetition) {
    const result: Scope[] = [];
    const visit = (record: JsonObject, pointer: string, parent?: Scope) => {
        const scope: Scope = { record, pointer, id: parent ? text(record.id) || `${parent.id}/scope-${result.length}` : competition.libraryId,
            title: text(record.title), parentId: parent?.id ?? null, leaf: !records(record.directions).length && !records(record.creativeCategories).length };
        result.push(scope);
        for (const field of ["directions", "creativeCategories"]) for (const [index, child] of records(record[field]).entries()) visit(child, `${pointer}/${field}/${index}`, scope);
    };
    visit(competition, "");
    return result;
}

/** Explicit maintenance output, scoped to the stored contest rather than a global approved source draft. */
export function buildReviewedThreeFieldEntry(competition: LibraryCompetition, fields: unknown, options: { provenance?: JsonObject } = {}): SixFieldEntry {
    const entry: SixFieldEntry = { version: 2, libraryId: competition.libraryId, baseRevision: competition.revision,
        sourceVersion: typeof competition.sourceVersion === "string" ? competition.sourceVersion : null, sourceUrl: competition.sourceUrl as string,
        indexedAt: new Date().toISOString(), method: competition.libraryStatus === "ignored" ? "unavailable" : "reviewed_codex",
        fields: structuredClone(fields) as SixFieldEntry["fields"], ...(options.provenance ? { provenance: structuredClone(options.provenance) } : {}) };
    if (!validSixFieldEntry(entry, competition.libraryId) || !validReviewedScopeIds(competition, entry)) throw new Error("三项审核索引或投稿范围无效");
    return entry;
}

export function validReviewedScopeIds(competition: LibraryCompetition, entry: SixFieldEntry) {
    if (entry.method !== "reviewed_codex") return true;
    const all = scopes(competition);
    return BASIC_FIELD_KEYS.every(key => records(entry.fields[key].value).every(item => {
        const pointers = Array.isArray(item.scopePointers) ? item.scopePointers : undefined;
        return (item.scopeIds as string[]).every((id, index) => {
            const matching = all.filter(scope => scope.id === id);
            return pointers ? matching.some(scope => scope.pointer === pointers[index]) : matching.length === 1;
        });
    }));
}

/** A side index of existing facts, never a new official quotation or an independent submission permission. */
export function buildSixFieldEntry(competition: LibraryCompetition, options: { approvedFields?: unknown; provenance?: JsonObject } = {}): SixFieldEntry {
    // Version 1 is read/build compatibility for historical indexes; new extraction publishes only the three basic fields.
    const basic = object(options.approvedFields) && Object.keys(options.approvedFields).length === BASIC_FIELD_KEYS.length
        && BASIC_FIELD_KEYS.every(key => Object.hasOwn(options.approvedFields as JsonObject, key));
    const keys = basic ? BASIC_FIELD_KEYS : SIX_FIELD_KEYS;
    const entry: SixFieldEntry = { version: basic ? 2 : 1, libraryId: competition.libraryId, baseRevision: competition.revision,
        sourceVersion: typeof competition.sourceVersion === "string" ? competition.sourceVersion : null, sourceUrl: competition.sourceUrl as string,
        indexedAt: new Date().toISOString(), method: "unavailable", fields: Object.fromEntries(keys.map(key => [key, empty()])) as SixFieldEntry["fields"],
        ...(options.provenance ? { provenance: structuredClone(options.provenance) } : {}) };
    if (competition.libraryStatus === "ignored") {
        for (const field of Object.values(entry.fields)) field.notes = "原记录是排除来源，未保存竞赛正文；不补造名称或恢复为可参与竞赛。";
        return entry;
    }
    if (options.approvedFields !== undefined) {
        if (competition.ingestionMode !== "source" || records(competition.directions).length || records(competition.creativeCategories).length) throw new Error("批准稿仅可用于无子投稿范围的原文条目，多范围须保留各自事实");
        if (!object(options.approvedFields) || Object.keys(options.approvedFields).length !== keys.length
            || keys.some(key => !object((options.approvedFields as JsonObject)[key]))) throw new Error("基础字段批准稿结构无效");
        entry.method = "approved_deepseek";
        for (const key of keys) {
            const field = options.approvedFields[key] as JsonObject;
            if (!(field.notes === null || typeof field.notes === "string") || !Array.isArray(field.evidence)
                || field.evidence.some(evidence => !object(evidence) || typeof evidence.url !== "string" || typeof evidence.quote !== "string" || !evidence.quote.trim())) throw new Error("基础字段批准稿必须保留原文依据");
            entry.fields[key] = { value: structuredClone(field.value ?? null), notes: field.notes,
                evidence: field.evidence.map(evidence => ({ kind: "source_text", url: evidence.url, quote: evidence.quote })) };
        }
        if (entry.fields.submissionForms.value !== null && !Array.isArray(entry.fields.submissionForms.value)) throw new Error("基础字段投稿类别必须是列表或未知");
        if (Array.isArray(entry.fields.submissionForms.value)) entry.fields.submissionForms.value = entry.fields.submissionForms.value.map(value => {
            if (!object(value) || typeof value.category !== "string" || typeof value.description !== "string" || !Array.isArray(value.evidenceIndexes)
                || value.evidenceIndexes.some(index => !Number.isInteger(index) || index < 0 || index >= entry.fields.submissionForms.evidence.length)) throw new Error("基础字段投稿类别或证据索引无效");
            return { ...value, scopeIds: [competition.libraryId], parentScopeIds: [], relationship: "see_description" };
        });
        if (!validSixFieldEntry(entry, competition.libraryId)) throw new Error("基础字段批准稿无效");
        return entry;
    }
    const all = scopes(competition);
    const evidence = (pointers: string[]): SixFieldEvidence[] => pointers.length ? [{ kind: "record_field", pointers, baseRevision: competition.revision }] : [];
    const title = text(competition.competitionTitle) || text(competition.title);
    entry.fields.competitionName = { value: title, notes: null, evidence: evidence(title ? [text(competition.competitionTitle) ? "/competitionTitle" : "/title"] : []) };
    if (competition.ingestionMode === "source") {
        for (const key of SIX_FIELD_KEYS.filter(key => key !== "competitionName")) entry.fields[key]!.notes = "仅存原文，未提取此字段。";
        return entry;
    }
    entry.method = "legacy_fields";
    const overview = all.map(scope => ({ scopeId: scope.id, scopeTitle: scope.title, value: text(scope.record.themeTask) || text(scope.record.creativeContent),
        pointer: `${scope.pointer}/${text(scope.record.themeTask) ? "themeTask" : "creativeContent"}` })).filter(item => item.value);
    entry.fields.themeAndOverview = { value: overview.length ? overview.map(({ pointer, ...value }) => value) : null, notes: "沿用已有主题，不重新总结或推断。", evidence: evidence(overview.map(item => item.pointer)) };
    const forms: JsonObject[] = [], formEvidence: SixFieldEvidence[] = [];
    for (const scope of all.filter(scope => scope.leaf)) {
        const categories = Array.isArray(scope.record.designTypes) ? [...new Set(scope.record.designTypes.filter((value): value is string => typeof value === "string" && Boolean(value.trim())))] : [];
        const field = ["description", "creativeContent", "themeTask"].find(field => text(scope.record[field]));
        const works = records(scope.record.workItems).map(work => [work.name, work.role === "primary" ? "主体" : work.role === "supporting" ? "配套" : "角色待确认",
            work.requirement === "required" ? "必交" : work.requirement === "optional" ? "选交" : "提交关系待确认"].filter(value => typeof value === "string").join(" / ")).join("；");
        const description = [works, field ? scope.record[field] : null].filter(Boolean).join("；");
        const pointers = [`${scope.pointer}/designTypes`, ...(works ? [`${scope.pointer}/workItems`] : []), ...(field ? [`${scope.pointer}/${field}`] : [])];
        for (const category of categories) {
            const preview = sixFieldPreview(description, "existing_record");
            const prior = forms.find(value => value.category === category && value.description === preview.description && value.descriptionTruncated === preview.descriptionTruncated);
            const evidenceIndex = formEvidence.length;
            formEvidence.push(...evidence(pointers));
            if (prior) {
                (prior.scopeIds as string[]).push(scope.id); (prior.scopeTitles as (string | null)[]).push(scope.title);
                (prior.parentScopeIds as (string | null)[]).push(scope.parentId); (prior.evidenceIndexes as number[]).push(evidenceIndex);
            } else forms.push({ category, ...preview, scopeIds: [scope.id], scopeTitles: [scope.title], parentScopeIds: [scope.parentId], relationship: "within_scope_not_independent", evidenceIndexes: [evidenceIndex] });
        }
    }
    entry.fields.submissionForms = { value: forms.length ? forms : null, notes: "类别是检索标签；同scope作品与主/配套、必交/选交关系仍以原条目和原文为准，截断说明不代表完整投稿要求。", evidence: formEvidence };
    for (const [key, source, statusField] of [["participationRequirements", "eligibility", "eligibilityStatus"], ["submissionDeadline", "deadline", null], ["feeStatus", "fee", "feeStatus"]] as const) {
        const values: JsonObject[] = [], pointers: string[] = [];
        for (const scope of all) {
            const value = text(scope.record[source]);
            const status = statusField ? scope.record[statusField] : undefined;
            if (!value && status === undefined) continue;
            const explicitStatus = key === "feeStatus" ? (["free", "paid"].includes(String(status)) ? status : "unknown")
                : key === "participationRequirements" ? (["eligible", "ineligible"].includes(String(status)) ? status : "unknown") : undefined;
            const prior = values.find(item => item.value === value && item.status === explicitStatus);
            if (prior) { (prior.scopeIds as string[]).push(scope.id); (prior.scopeTitles as (string | null)[]).push(scope.title); }
            else values.push({ value, ...(explicitStatus ? { status: explicitStatus } : {}), scopeIds: [scope.id], scopeTitles: [scope.title] });
            if (value) pointers.push(`${scope.pointer}/${source}`);
            if (statusField && status !== undefined) pointers.push(`${scope.pointer}/${statusField}`);
        }
        entry.fields[key] = { value: values.length ? values : null, notes: "逐范围保留已有记录；不得把不同范围的资格、截止或费用拼成一项可投任务。", evidence: evidence(pointers) };
    }
    return entry;
}

export function validSixFieldEntry(value: unknown, libraryId: string): value is SixFieldEntry {
    if (!object(value) || !(value.version === 1 || value.version === 2) || value.libraryId !== libraryId || !/^[a-zA-Z0-9_-]+$/.test(libraryId)
        || !/^[a-f0-9]{64}$/.test(String(value.baseRevision)) || !(value.sourceVersion === null || /^[a-f0-9]{64}$/.test(String(value.sourceVersion)))
        || typeof value.sourceUrl !== "string" || !/^https?:\/\//.test(value.sourceUrl) || typeof value.indexedAt !== "string" || Number.isNaN(Date.parse(value.indexedAt))
        || !["legacy_fields", "approved_deepseek", "reviewed_codex", "unavailable"].includes(String(value.method)) || !object(value.fields)
        || Object.keys(value.fields).length !== (value.version === 2 ? BASIC_FIELD_KEYS.length : SIX_FIELD_KEYS.length)) return false;
    const keys = value.version === 2 ? BASIC_FIELD_KEYS : SIX_FIELD_KEYS;
    const reviewed = value.method === "reviewed_codex";
    if (reviewed && value.version !== 2) return false;
    const scopeIds = (item: JsonObject) => Array.isArray(item.scopeIds) && item.scopeIds.length > 0 && item.scopeIds.every(id => typeof id === "string" && Boolean(id.trim()));
    const optionalText = (item: unknown) => item === null || typeof item === "string";
    return keys.every(key => {
        const field = (value.fields as JsonObject)[key];
        if (!object(field) || !Object.hasOwn(field, "value") || !(field.notes === null || typeof field.notes === "string") || !Array.isArray(field.evidence)) return false;
        const contents = field.value;
        if (reviewed && contents !== null && !Array.isArray(contents)) return false;
        if (contents !== null) {
            if (reviewed && Array.isArray(contents) && contents.some(item => !object(item) || (item.scopePointers !== undefined
                && (!Array.isArray(item.scopePointers) || !Array.isArray(item.scopeIds) || item.scopePointers.length !== item.scopeIds.length
                    || item.scopePointers.some(pointer => typeof pointer !== "string" || (pointer !== "" && !pointer.startsWith("/"))))))) return false;
            if (key === "competitionName" && typeof contents !== "string") return false;
            if (key === "submissionForms") {
                if (!Array.isArray(contents) || contents.some(item => !object(item) || !designDirections.includes(String(item.category)) || !optionalText(item.description) || !scopeIds(item)
                    || !["within_scope_not_independent", "see_description"].includes(String(item.relationship))
                    || !Array.isArray(item.evidenceIndexes) || !item.evidenceIndexes.length || item.evidenceIndexes.some(index => !Number.isSafeInteger(index) || index < 0 || index >= (field.evidence as unknown[]).length))) return false;
            } else if (Array.isArray(contents)) {
                if (contents.some(item => !object(item) || !optionalText(item.value) || (key === "themeAndOverview" ? typeof item.scopeId !== "string" : !scopeIds(item))
                    || (key === "participationRequirements" && !["eligible", "ineligible", "unknown"].includes(String(item.status)))
                    || (key === "feeStatus" && !["free", "paid", "unknown"].includes(String(item.status))))) return false;
            } else if (key === "feeStatus" ? !["free", "paid", "unknown"].includes(String(contents)) : typeof contents !== "string") return false;
            if (reviewed && Array.isArray(contents) && key !== "submissionForms") {
                const usedScopes = new Set<string>();
                if (contents.some(item => {
                    if (!object(item) || typeof item.hasLocalDoubt !== "boolean" || !Array.isArray(item.evidenceIndexes)
                        || item.evidenceIndexes.some(index => !Number.isSafeInteger(index) || index < 0 || index >= (field.evidence as unknown[]).length)) return true;
                    const known = key === "feeStatus" ? item.status !== "unknown" : item.value !== null;
                    if (known && (typeof item.value !== "string" || !item.value.trim() || !item.evidenceIndexes.length)) return true;
                    return (item.scopeIds as string[]).some((id, index) => {
                        const key = JSON.stringify([id, Array.isArray(item.scopePointers) ? item.scopePointers[index] : null]);
                        if (usedScopes.has(key)) return true; usedScopes.add(key); return false;
                    });
                })) return false;
            }
            if (!reviewed && contents !== "unknown" && (!Array.isArray(contents) || contents.length > 0) && field.evidence.length === 0) return false;
        }
        return field.evidence.every(item => object(item) && (item.kind === "record_field"
                ? item.baseRevision === value.baseRevision && Array.isArray(item.pointers) && item.pointers.length > 0 && item.pointers.every(pointer => typeof pointer === "string" && pointer.startsWith("/")) && !Object.hasOwn(item, "quote")
                : item.kind === "source_text" && typeof item.url === "string" && /^https?:\/\//.test(item.url) && typeof item.quote === "string" && Boolean(item.quote.trim())));
    });
}
