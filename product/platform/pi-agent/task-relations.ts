import { createHash } from "node:crypto";
import type { LibraryCompetition } from "./competition-library.js";
import { isImageMaterial, materialMime, parseMaterial } from "./tool-readers.js";

type JsonObject = Record<string, unknown>;
export type TaskRef = { libraryId: string; scopeId: string; scopePointer: string; revision: string; indexHash: string | null; sourceVersion: string | null };
export type TaskRelationContext = { competition: LibraryCompetition; record: JsonObject; ref: TaskRef; resources: JsonObject[] };
export type TaskRelationKind = "same_task" | "possible_same" | "overview" | "independence" | "component_choices";
export type TaskRelationCitation = { resourceIndex: number; url: string; sha256: string; quote: string };
export type TaskRelationProof = { taskName: string; rules: { memberIndex: number; rule: TaskRelationCitation; authority: TaskRelationCitation }[] };
type TaskRelation = { id: string; kind: TaskRelationKind; members: TaskRef[]; canonical?: { libraryId: string; scopePointer: string }; note: string; proof?: TaskRelationProof };
export type ResolvedTaskRelation = { id: string; kind: TaskRelationKind; status: "confirmed" | "pending" | "stale" | "invalid";
    members: TaskRef[]; canonicalKey?: string; note: string; reason: string; sourceUrls: string[] };
export type TaskRelationsRead = { status: "missing" | "ready" | "invalid"; hash: string | null; relations: ResolvedTaskRelation[] };

const object = (value: unknown): value is JsonObject => Boolean(value && typeof value === "object" && !Array.isArray(value));
const text = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim()) && !value.includes("\0");
const sha256 = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const keys = (value: JsonObject, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
const kinds: TaskRelationKind[] = ["same_task", "possible_same", "overview", "independence", "component_choices"];

export function taskRefKey(ref: { libraryId: string; scopePointer: string }): string {
    return JSON.stringify([ref.libraryId, ref.scopePointer]);
}

function validRef(value: unknown): value is TaskRef {
    return object(value) && keys(value, ["libraryId", "scopeId", "scopePointer", "revision", "indexHash", "sourceVersion"])
        && text(value.libraryId) && text(value.scopeId) && typeof value.scopePointer === "string"
        && !value.scopePointer.includes("\0") && (value.scopePointer === "" || value.scopePointer.startsWith("/"))
        && text(value.revision) && (value.indexHash === null || text(value.indexHash)) && (value.sourceVersion === null || text(value.sourceVersion));
}
function validUrl(value: unknown): value is string {
    if (typeof value !== "string") return false;
    try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password; }
    catch { return false; }
}
function validCitation(value: unknown): value is TaskRelationCitation {
    return object(value) && keys(value, ["resourceIndex", "url", "sha256", "quote"])
        && Number.isSafeInteger(value.resourceIndex) && (value.resourceIndex as number) >= 0 && validUrl(value.url) && sha256(value.sha256) && text(value.quote);
}
function validProof(value: unknown): value is TaskRelationProof {
    return object(value) && keys(value, ["taskName", "rules"]) && text(value.taskName) && Array.isArray(value.rules)
        && value.rules.every(row => object(row) && keys(row, ["memberIndex", "rule", "authority"])
            && Number.isSafeInteger(row.memberIndex) && (row.memberIndex as number) >= 0 && validCitation(row.rule) && validCitation(row.authority));
}
function validRelation(value: unknown): value is TaskRelation {
    if (!object(value) || !keys(value, ["id", "kind", "members", "canonical", "note", "proof"]) || !text(value.id)
        || !kinds.includes(value.kind as TaskRelationKind) || typeof value.note !== "string" || !Array.isArray(value.members)
        || !value.members.every(validRef) || value.members.length < (["independence", "component_choices"].includes(value.kind as string) ? 1 : 2)
        || new Set(value.members.map(taskRefKey)).size !== value.members.length) return false;
    if (value.canonical !== undefined && (!object(value.canonical) || !keys(value.canonical, ["libraryId", "scopePointer"])
        || !text(value.canonical.libraryId) || typeof value.canonical.scopePointer !== "string")) return false;
    return value.proof === undefined || validProof(value.proof);
}
function equalRef(left: TaskRef, right: TaskRef) {
    return ["libraryId", "scopeId", "scopePointer", "revision", "indexHash", "sourceVersion"].every(key => left[key as keyof TaskRef] === right[key as keyof TaskRef]);
}

async function reparse(context: TaskRelationContext, citation: TaskRelationCitation) {
    const resource = context.resources[citation.resourceIndex];
    if (!object(resource) || resource.url !== citation.url || isImageMaterial(resource) || typeof resource.binary !== "string" || !resource.binary)
        throw new Error("关系证据缺少对应文字原件，旧缓存文字不能确认同一任务");
    const encoded = resource.binary.replace(/\s/g, ""), bytes = Buffer.from(encoded, "base64");
    if (bytes.toString("base64") !== encoded || digest(bytes) !== citation.sha256 || resource.sha256 !== undefined && resource.sha256 !== citation.sha256)
        throw new Error("关系证据的原件编码或SHA不符");
    const parsed = await parseMaterial(bytes, citation.url, typeof resource.mimeType === "string" ? resource.mimeType
        : materialMime(citation.url, resource.kind === "html" ? "text/html" : resource.kind === "pdf" ? "application/pdf" : ""),
        typeof resource.contentType === "string" ? resource.contentType : "");
    if (parsed.status !== "read" || !parsed.text?.includes(citation.quote)) throw new Error("关系引文不在原件重提取的连续正文中");
    return parsed;
}

function materialSignature(record: JsonObject, block: string) {
    if ([record.themeTask, record.creativeContent].some(value => value !== undefined && value !== null && typeof value !== "string"))
        throw new Error("成员的主要主题或创作内容结构不明确");
    const themes = [record.themeTask, record.creativeContent].filter(text);
    if (!themes.length || themes.some(theme => !block.includes(theme))) throw new Error("共享规则没有覆盖成员的完整主要主题或创作内容");
    if (!Array.isArray(record.workItems) || !record.workItems.length) throw new Error("成员缺少完整作品事实，不能仅凭展板或标题归并");
    const materials = record.workItems.map(work => {
        if (!object(work) || !text(work.name) || !["visual_design", "product_concept", "video", "spatial", "physical", "functional", "document", "photography", "fashion", "other"].includes(work.kind as string)
            || !["primary", "supporting"].includes(work.role as string) || !["required", "optional"].includes(work.requirement as string)
            || !["design_files", "finished_media", "physical_object", "runnable", "unspecified"].includes(work.delivery as string))
            throw new Error("作品事实不完整或主体/配套/必交关系不明确");
        if ([work.quantity, work.submission_requirements].some(value => value !== undefined && value !== null && typeof value !== "string"))
            throw new Error("作品数量或提交要求结构不明确");
        const quantity = typeof work.quantity === "string" ? work.quantity : "", requirements = typeof work.submission_requirements === "string" ? work.submission_requirements : "";
        const evidence = Array.isArray(work.evidence) ? work.evidence : [work.evidence];
        if (!evidence.length || evidence.some(item => !object(item) || !validUrl(item.url) || !text(item.quote) || item.transcription
            || !block.includes(item.quote) || !item.quote.includes(work.name as string) || quantity && !item.quote.includes(quantity) || requirements && !item.quote.includes(requirements)))
            throw new Error("共享规则未连续覆盖全部作品的名称、数量及提交要求原文依据");
        return { name: work.name, kind: work.kind, role: work.role, requirement: work.requirement, delivery: work.delivery, quantity, submission_requirements: requirements };
    });
    if (!materials.some(work => work.role === "primary" && work.requirement === "required")) throw new Error("作品事实没有明确的必交主体");
    return JSON.stringify(materials.map(material => JSON.stringify(material)).sort());
}

async function confirmSameTask(relation: TaskRelation, contexts: TaskRelationContext[]) {
    const proof = relation.proof;
    if (!proof || proof.rules.length !== relation.members.length || new Set(proof.rules.map(row => row.memberIndex)).size !== relation.members.length
        || proof.rules.some(row => row.memberIndex >= relation.members.length)) throw new Error("同一任务需要逐成员的完整官方原件证据");
    const first = proof.rules[0].rule;
    if (!first.quote.includes(proof.taskName) || proof.rules.some(row => row.rule.url !== first.url || row.rule.sha256 !== first.sha256 || row.rule.quote !== first.quote))
        throw new Error("成员未引用同一完整任务规则块");
    // Ingestion also exposes tools backed by competition-library. Resolve its helpers only after
    // the library has initialized, avoiding a library → relations → ingestion → tools import cycle.
    const { officialNavigationEntries, sameCompetitionEdition } = await import("./six-field-ingestion.js");
    const signatures: string[] = [];
    for (const row of proof.rules) {
        const context = contexts[row.memberIndex];
        if ([context.record.directions, context.record.creativeCategories].some(value => value !== undefined && value !== null
            && (!Array.isArray(value) || value.length > 0))) throw new Error("同一任务只允许实际叶子范围，仍有赛道或可选类别的父层不能整体归并");
        const rule = await reparse(context, row.rule), authority = await reparse(context, row.authority);
        const official = officialNavigationEntries([{ url: row.authority.url, text: authority.text! }]).some(entry =>
            row.authority.quote.includes(entry.authorityEvidence.quote) && new URL(entry.url).origin === new URL(row.rule.url).origin);
        if (!official) throw new Error("原件没有明示同源官网入口，不能把第三方规则当官方关系依据");
        if (!sameCompetitionEdition(context.competition, rule.text!, rule.title)) throw new Error("官方规则未通过每成员的同名同届校验");
        signatures.push(materialSignature(context.record, first.quote));
    }
    if (new Set(signatures).size !== 1) throw new Error("成员的完整材料事实不同，不能仅合并同类标签");
}

/** Read-only, conservative relation projection. Never follows URLs or rewrites library/canvas facts. */
export async function resolveTaskRelations(raw: unknown, inspect: (ref: TaskRef) => Promise<TaskRelationContext | undefined>): Promise<TaskRelationsRead> {
    if (raw === undefined) return { status: "missing", hash: null, relations: [] };
    let hash: string | null = null;
    try { const serialized = JSON.stringify(raw); if (serialized !== undefined) hash = digest(serialized); }
    catch { return { status: "invalid", hash, relations: [] }; }
    if (!object(raw) || !keys(raw, ["version", "relations"]) || raw.version !== 1 || !Array.isArray(raw.relations)
        || !raw.relations.every(validRelation) || new Set(raw.relations.map(relation => relation.id)).size !== raw.relations.length)
        return { status: "invalid", hash, relations: [] };
    const relations: ResolvedTaskRelation[] = [];
    for (const relation of raw.relations) {
        const resolved: ResolvedTaskRelation = { id: relation.id, kind: relation.kind, status: "pending", members: structuredClone(relation.members), note: relation.note,
            reason: "仅保留关系待确认；总览、可能相同或独立性说明不等于同一投稿任务", sourceUrls: [...new Set(relation.proof?.rules.flatMap(row => [row.rule.url, row.authority.url]) || [])] };
        relations.push(resolved);
        const contexts: TaskRelationContext[] = [];
        try {
            for (const member of relation.members) {
                const context = await inspect(member);
                if (!context || !equalRef(member, context.ref) || context.competition.libraryId !== member.libraryId
                    || context.competition.revision !== member.revision || (context.competition.sourceVersion ?? null) !== member.sourceVersion)
                    throw new Error("关系成员、原记录、索引或来源版本已变化，保留原候选待确认");
                contexts.push(context);
            }
        } catch (error) { resolved.status = "stale"; resolved.reason = error instanceof Error ? error.message : String(error); continue; }
        if (relation.kind !== "same_task") continue;
        if (!relation.canonical || !relation.members.some(member => taskRefKey(member) === taskRefKey(relation.canonical!))) {
            resolved.status = "invalid"; resolved.reason = "同一任务缺少有效成员作为canonical，不应用归并"; continue;
        }
        try {
            await confirmSameTask(relation, contexts);
            resolved.status = "confirmed"; resolved.canonicalKey = taskRefKey(relation.canonical); resolved.reason = "同一完整投稿任务及逐成员官方原件、同届、材料与版本均已核验";
        } catch (error) { resolved.reason = error instanceof Error ? error.message : String(error); }
    }
    // Competing identity groups cannot choose a canonical silently. Other relationship kinds are orthogonal:
    // a possible A/B/C relation must never extend a confirmed A/B group to C or revoke the proven A/B identity.
    const membership = new Map<string, ResolvedTaskRelation[]>();
    for (const relation of relations.filter(relation => relation.kind === "same_task")) for (const member of relation.members) {
        const key = taskRefKey(member); membership.set(key, [...(membership.get(key) || []), relation]);
    }
    for (const linked of membership.values()) if (linked.length > 1) for (const relation of linked) {
        relation.status = "pending"; delete relation.canonicalKey; relation.reason = "不同关系重叠或相互冲突，保留待确认，不链式归并或隐藏任务";
    }
    return { status: "ready", hash, relations };
}
