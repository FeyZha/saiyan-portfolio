import { createHash, randomUUID } from "node:crypto";
import { CURRENT_COMPETITION_CONTRACT, currentCreativeContent, normalizeCurrentBundle, validCurrentDeadline } from "./current-contract.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import { isImageMaterial, materialMime, parseMaterial } from "./tool-readers.js";
import { designDirections } from "./six-field-index.js";
import { submissionChoiceIssues } from "./submission-choices.js";
import { unexpandedSubmissionOutcomes } from "./submission-outcome-guard.js";
import { cleanTaskText } from "./creative-text.js";
import { applyOfficialSupplements } from "./official-supplements.js";
import { publishCompetitionCards } from "./competition-card-intake.js";

type Data = Record<string, unknown>;
type Competition = { libraryId: string; sourceUrl?: unknown; sourceVersion?: unknown; revision?: string; title?: unknown };
export type PreparedMaterialResource = { url: string; text: string; kind?: string; resourceIndex?: number; start?: number; end?: number; links?: { url: string; title: string }[] };
export type PreparedFact = Data & { scopePointer: string; value: unknown; status: "known" | "unknown" | "conflict"; evidenceRefs: string[] };
export type PreparedTask = Data & { id: string; scopePointer: string; title: string; shortTheme: string | null; requirements: unknown; workItems: Data[]; ruleRefs: string[]; evidenceRefs: string[] };
export type PreparedRule = Data & { id: string; appliesTo: string[]; status: "explicit" | "unknown" | "conflict"; content: unknown; evidenceRefs: string[] };
export type PreparedEvidence = { id: string; url: string; sourceVersion: string; resourceIndex: number; textHash: string; start: number; end: number; quote: string;
    snapshotSourceUrl?: string; originalSourceVersion?: string; originalResourceIndex?: number; originalUrl?: string; originalTextHash?: string };
export type PreparedMaterialsBundle = { version: 1; contract?: number; identity: { libraryId: string; sourceUrl: string }; contentHash: string; sourceVersion: string;
    recordRevision?: string; baseIndexHash?: string | null; baseBusinessHash?: string; facts: Record<"submissionForms" | "feeStatus" | "submissionDeadline", PreparedFact[]>; tasks: PreparedTask[]; rules: PreparedRule[]; evidence: PreparedEvidence[]; conflicts?: Data[] };
export type PreparedMaterialsRead = { status: "missing" | "claimed" | "ready" | "incomplete" | "failed" | "content_changed" | "invalid" | "stale";
    contentHash: string | null; bundle?: PreparedMaterialsBundle; reason?: string; issues?: string[]; claimPath?: string; reused?: boolean };
export type PreparedMaterialInput = { identity: PreparedMaterialsBundle["identity"]; title: string | null; contentHash: string; mode: "initial" | "supplement";
    resources: (PreparedMaterialResource & { resourceIndex: number; textHash: string; start: number; end: number })[]; context?: Data };
export type PrepareMaterialsOptions = { extract: (input: PreparedMaterialInput) => Promise<unknown>; allowSupplement?: boolean; signal?: AbortSignal };
type Claim = { version: 1; identity: PreparedMaterialsBundle["identity"]; contentHash: string; sourceVersion: string; sequence: number; createdAt: string;
    status: "claimed" | "ready" | "incomplete" | "failed"; sentFragments: { url: string; resourceIndex: number; textHash: string; start: number; end: number }[];
    bundle?: PreparedMaterialsBundle; bundleHash?: string; rawResponse?: unknown; rawResponseHash?: string; issues?: string[]; completedAt?: string; requestState: "reserved" | "returned" | "uncertain" };
const object = (value: unknown): value is Data => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const rows = (value: unknown) => Array.isArray(value) ? value.filter(object) : [];
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const keys = ["submissionForms", "feeStatus", "submissionDeadline"] as const;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");
const canonical = (value: unknown) => JSON.stringify(value, (_key, item) => object(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const containsWholeText = (value: unknown, fullTexts: string[]): boolean => typeof value === "string" ? fullTexts.some(text => text && value.includes(text))
    : Array.isArray(value) ? value.some(item => containsWholeText(item, fullTexts)) : object(value) ? Object.values(value).some(item => containsWholeText(item, fullTexts)) : false;
const containsRetiredAnalysis = (value: unknown): boolean => Array.isArray(value) ? value.some(containsRetiredAnalysis) : object(value)
    && Object.entries(value).some(([key, item]) => ["eligibility", "eligibilityStatus", "participationRequirements", "aiRule", "aiAllowed", "submissionUnit", "reviewSummary", "missingInformation"].includes(key) || containsRetiredAnalysis(item));
const businessHash = (competition: Competition) => digest(canonical(Object.fromEntries(["title", "competitionTitle", "directions", "creativeCategories", "themeTask", "creativeContent", "workItems", "submissionFormat", "finalSubmissionFormat", "designTypes", "deadline", "fee", "feeStatus", "ingestionMode"]
    .filter(key => (competition as unknown as Data)[key] !== undefined).map(key => [key, (competition as unknown as Data)[key]]))));
export { businessHash as preparedMaterialBusinessHash };
function identityOf(competition: Competition) {
    if (!/^[a-zA-Z0-9_-]+$/.test(competition.libraryId) || typeof competition.sourceUrl !== "string") throw new Error("竞赛材料身份无效");
    const url = new URL(competition.sourceUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("竞赛材料来源无效");
    return { libraryId: competition.libraryId, sourceUrl: competition.sourceUrl };
}
async function safePath(root: string, relative: string, create = false) {
    const base = path.resolve(root), target = path.resolve(base, relative), inside = path.relative(base, target);
    if (inside.startsWith("..") || path.isAbsolute(inside)) throw new Error("材料侧车路径越界");
    let current = base;
    for (const part of inside.split(path.sep)) {
        current = path.join(current, part);
        let stat;
        try { stat = await fs.lstat(current); } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            if (create && current !== target) { try { await fs.mkdir(current); } catch (creation) { if ((creation as NodeJS.ErrnoException).code !== "EEXIST") throw creation; } stat = await fs.lstat(current); }
        }
        if (stat?.isSymbolicLink()) throw new Error("材料侧车路径不能包含符号链接");
    }
    return target;
}
async function jsonFile(file: string): Promise<unknown> { return JSON.parse(await fs.readFile(file, "utf8")); }

async function durableJson(file: string, value: unknown, exclusive: boolean) {
    const target = exclusive ? file : `${file}.${randomUUID()}.tmp`, handle = await fs.open(target, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(value, null, 2) + "\n"); await handle.sync(); } finally { await handle.close(); }
    if (!exclusive) await fs.rename(target, file);
}

/** Existing bytes/text only. Does not inspect credentials, fetch sources, create claims, or invoke an extractor. */
export async function loadPreparedMaterialResources(root: string, competition: Competition) {
    identityOf(competition);
    if (typeof competition.sourceVersion !== "string" || !/^[a-f0-9]{64}$/.test(competition.sourceVersion)) return [];
    const file = await safePath(root, `workspace/competition-sources/source-snapshots/${competition.sourceVersion}.json`);
    let snapshot: unknown;
    try { snapshot = await jsonFile(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    if (!object(snapshot) || snapshot.sourceUrl !== competition.sourceUrl || !Array.isArray(snapshot.resources)) throw new Error("材料原文快照无效");
    const result: PreparedMaterialResource[] = [];
    for (const [resourceIndex, item] of snapshot.resources.entries()) {
        if (!object(item) || isImageMaterial(item)) continue;
        if (typeof item.url !== "string") throw new Error("材料文字来源无效");
        let text = typeof item.text === "string" ? item.text : "", links = rows(item.links).filter(link => typeof link.url === "string" && typeof link.title === "string") as { url: string; title: string }[];
        if (typeof item.binary === "string" && item.binary) {
            const encoded = item.binary.replace(/\s/g, ""), bytes = Buffer.from(encoded, "base64");
            if (bytes.toString("base64") !== encoded || (typeof item.sha256 === "string" && digest(bytes) !== item.sha256)) throw new Error("材料原件字节或哈希不一致");
            const parsed = await parseMaterial(bytes, item.url, typeof item.mimeType === "string" ? item.mimeType : materialMime(item.url,
                item.kind === "html" ? "text/html" : item.kind === "pdf" ? "application/pdf" : ""), typeof item.contentType === "string" ? item.contentType : "");
            if (parsed.status !== "read" || !parsed.text) continue;
            text = parsed.text; links = parsed.links || links;
        }
        if (text.trim()) result.push({ url: item.url, kind: typeof item.kind === "string" ? item.kind : undefined, resourceIndex, text, links });
    }
    return result;
}
const contentHashOf = (resources: PreparedMaterialResource[]) => digest(canonical([...new Set(resources.map(resource => digest(resource.text)))].sort()));
async function claimFiles(root: string, identity: PreparedMaterialsBundle["identity"]) {
    const directory = await safePath(root, `workspace/competition-sources/prepared-materials/${digest(identity.libraryId)}/placeholder`);
    const folder = path.dirname(directory);
    let names: string[];
    try { names = await fs.readdir(folder); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { folder, claims: [] as Claim[] }; throw error; }
    const claims: Claim[] = [];
    for (const name of names.filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
        const file = await safePath(root, path.relative(path.resolve(root), path.join(folder, name)));
        const value = await jsonFile(file);
        if (!object(value) || value.version !== 1 || !object(value.identity) || value.identity.libraryId !== identity.libraryId || !["claimed", "ready", "incomplete", "failed"].includes(String(value.status))
            || !Array.isArray(value.sentFragments) || typeof value.contentHash !== "string" || name !== value.contentHash + ".json") throw new Error("材料提取凭据损坏，禁止自动重提");
        claims.push(value as Claim);
    }
    return { folder, claims: claims.sort((a, b) => b.sequence - a.sequence) };
}
function mapEvidence(bundle: PreparedMaterialsBundle, competition: Competition, resources: PreparedMaterialResource[]) {
    return { ...bundle, evidence: bundle.evidence.map(evidence => {
        const resource = resources.find(item => digest(item.text) === evidence.textHash && item.url === evidence.url)
            ?? resources.find(item => digest(item.text) === evidence.textHash)
            ?? resources.find(item => item.url === evidence.url && item.text.slice(evidence.start, evidence.end) === evidence.quote);
        return resource && resource.text.slice(evidence.start, evidence.end) === evidence.quote ? { ...evidence,
            originalSourceVersion: evidence.originalSourceVersion ?? evidence.sourceVersion, originalResourceIndex: evidence.originalResourceIndex ?? evidence.resourceIndex,
            originalUrl: evidence.originalUrl ?? evidence.url, originalTextHash: evidence.originalTextHash ?? evidence.textHash, textHash: digest(resource.text), url: resource.url,
            sourceVersion: String(competition.sourceVersion), snapshotSourceUrl: String(competition.sourceUrl), resourceIndex: resource.resourceIndex ?? 0 } : evidence;
    }) };
}
async function verifyStoredBundle(root: string, claim: Claim, competition: Competition, current: PreparedMaterialResource[]) {
    const bundle = claim.bundle;
    if (!bundle || !claim.bundleHash || digest(canonical(bundle)) !== claim.bundleHash || bundle.version !== 1 || bundle.contract !== CURRENT_COMPETITION_CONTRACT || bundle.identity.libraryId !== competition.libraryId
        || !Array.isArray(bundle.tasks) || !bundle.tasks.length || !Array.isArray(bundle.rules) || !Array.isArray(bundle.evidence) || !object(bundle.facts)
        || Object.keys(bundle.facts).length !== keys.length || keys.some(key => !Array.isArray(bundle.facts[key]))) throw new Error("提取侧车结构或校验摘要无效");
    const evidenceIds = new Set(bundle.evidence.map(item => item.id)), taskIds = new Set(bundle.tasks.map(task => task.id)), ruleIds = new Set(bundle.rules.map(rule => rule.id));
    if (evidenceIds.size !== bundle.evidence.length || taskIds.size !== bundle.tasks.length || ruleIds.size !== bundle.rules.length) throw new Error("提取侧车引用ID重复");
    const validRefs = (value: unknown) => strings(value) && value.every(id => evidenceIds.has(id));
    const validNestedRefs = (value: unknown): boolean => Array.isArray(value) ? value.every(validNestedRefs) : !object(value) || Object.entries(value).every(([key, item]) => key === "evidenceRefs" ? validRefs(item) : validNestedRefs(item));
    const pointers = new Set<string>();
    for (const task of bundle.tasks) {
        if (typeof task.id !== "string" || !task.id || typeof task.scopePointer !== "string" || pointers.has(task.scopePointer) || typeof task.title !== "string"
            || !Object.hasOwn(task, "requirements") || !Array.isArray(task.workItems) || !validRefs(task.evidenceRefs) || !validNestedRefs(task)
            || !strings(task.ruleRefs) || task.ruleRefs.some(id => !ruleIds.has(id))
            || (!currentCreativeContent(task) && task.status !== "unknown")) throw new Error("提取任务引用或结构无效");
        pointers.add(task.scopePointer);
    }
    for (const rule of bundle.rules) if (!["explicit", "unknown", "conflict"].includes(rule.status) || !strings(rule.appliesTo) || rule.appliesTo.some(id => !taskIds.has(id))
        || rule.status === "explicit" && !rule.appliesTo.length || !validRefs(rule.evidenceRefs) || !validNestedRefs(rule)) throw new Error("共用条款适用或引用无效");
    for (const key of keys) {
        const seen = new Set<string>();
        for (const fact of bundle.facts[key]) {
            if (!pointers.has(fact.scopePointer) || seen.has(fact.scopePointer) || !["known", "unknown", "conflict"].includes(fact.status) || !validRefs(fact.evidenceRefs)) throw new Error("三项事实范围或引用无效");
            if (key === "submissionDeadline" && !validCurrentDeadline(fact)) throw new Error("截止日期结构无效，禁止用备注重新推断日期");
            seen.add(fact.scopePointer);
        }
        if (seen.size !== pointers.size) throw new Error("三项事实缺少任务范围");
    }
    const archives = new Map<string, PreparedMaterialResource[]>();
    for (const evidence of bundle.evidence) {
        if (typeof evidence.quote !== "string" || !evidence.quote || !Number.isSafeInteger(evidence.start) || !Number.isSafeInteger(evidence.end)
            || evidence.start < 0 || evidence.end <= evidence.start || !/^[a-f0-9]{64}$/.test(evidence.sourceVersion) || !/^[a-f0-9]{64}$/.test(evidence.textHash)) throw new Error("证据片段定位无效");
        let source = current.find(resource => digest(resource.text) === evidence.textHash && resource.text.slice(evidence.start, evidence.end) === evidence.quote);
        if (!source) {
            const sourceUrl = evidence.snapshotSourceUrl ?? bundle.identity.sourceUrl, cacheKey = canonical([evidence.sourceVersion, sourceUrl]);
            if (!archives.has(cacheKey)) archives.set(cacheKey, await loadPreparedMaterialResources(root, { ...competition, sourceUrl, sourceVersion: evidence.sourceVersion }));
            source = archives.get(cacheKey)!.find(resource => resource.resourceIndex === evidence.resourceIndex && resource.url === evidence.url && digest(resource.text) === evidence.textHash);
        }
        if (!source || source.text.slice(evidence.start, evidence.end) !== evidence.quote) throw new Error("证据不在所存原文版本片段中");
    }
    const fullTexts = [...current, ...[...archives.values()].flat()].map(resource => resource.text);
    if (submissionChoiceIssues(bundle.tasks, bundle.evidence).length) throw new Error("投稿方向尚未完整拆分，不能作为可用任务发布");
    if (containsRetiredAnalysis([bundle.tasks, bundle.rules, bundle.facts]) || containsWholeText([bundle.tasks, bundle.rules, bundle.facts], fullTexts)
        || bundle.evidence.some(evidence => containsWholeText(evidence.quote, fullTexts))) throw new Error("侧车不能恢复退役分析或把原文全文伪装成字段片段");
}
export async function readPreparedMaterials(root: string, competition: Competition, includeSupplements = true): Promise<PreparedMaterialsRead> {
    let contentHash: string | null = null;
    try {
        const identity = identityOf(competition), resources = await loadPreparedMaterialResources(root, competition);
        if (!resources.length) return { status: "missing", contentHash, reason: "no_readable_stored_materials" };
        contentHash = contentHashOf(resources);
        const { folder, claims } = await claimFiles(root, identity), exact = claims.find(claim => claim.contentHash === contentHash);
        const prior = exact?.bundle;
        if (prior && prior.baseBusinessHash !== undefined && prior.baseBusinessHash !== businessHash(competition)) return { status: "stale", contentHash,
                reason: "stored_index_or_business_facts_changed_no_automatic_reextract" };
        if (exact?.status === "ready") await verifyStoredBundle(root, exact, competition, resources);
        else if (exact?.bundle && (exact.bundle.contract !== CURRENT_COMPETITION_CONTRACT || digest(canonical(exact.bundle)) !== exact.bundleHash)) throw new Error("不完整材料版本或摘要无效");
        const mapped = exact?.bundle ? mapEvidence(exact.bundle, competition, resources) : undefined;
        if (exact) return { status: exact.status, contentHash, ...(mapped ? { bundle: includeSupplements && exact.status === "ready" ? await applyOfficialSupplements(root, mapped) : mapped } : {}), issues: exact.issues,
            claimPath: path.relative(root, path.join(folder, contentHash + ".json")).replaceAll("\\", "/"), reused: true };
        let active: unknown;
        try { active = await jsonFile(path.join(folder, "active.json")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        if (active) return { status: "claimed", contentHash, reason: "identity_request_reserved_or_uncertain" };
        return { status: claims.length ? "content_changed" : "missing", contentHash, reason: claims.length ? "explicit_supplement_required" : "not_prepared" };
    } catch { return { status: "invalid", contentHash, reason: "stored_material_or_claim_invalid_no_automatic_retry" }; }
}

export function validatePreparedMaterialDraft(raw: unknown, input: PreparedMaterialInput, competition: Competition, prior?: PreparedMaterialsBundle) {
    let candidate = raw;
    const issues: string[] = [];
    if (typeof raw === "string") { try { candidate = JSON.parse(raw); } catch { issues.push("response_not_json"); candidate = {}; } }
    if (!object(candidate)) { issues.push("response_not_object"); candidate = {}; }
    if (["contract", "dataContract"].some(key => object(candidate) && candidate[key] !== undefined && candidate[key] !== CURRENT_COMPETITION_CONTRACT)) {
        issues.push("response_contract_mismatch_no_automatic_upgrade"); candidate = {};
    }
    const draft = candidate as Data, evidence: PreparedEvidence[] = [], evidenceIds = new Set(prior?.evidence.map(item => item.id) || []);
    // A necessary supplement fragment is not a full source: its textHash still identifies the complete stored resource.
    const fullTexts = input.resources.filter(resource => digest(resource.text) === resource.textHash).map(resource => resource.text);
    if (!Array.isArray(draft.evidence)) issues.push("evidence_array_required");
    else if (rows(draft.evidence).length !== draft.evidence.length) issues.push("invalid_evidence_entries");
    for (const item of rows(draft.evidence)) {
        if (typeof item.id !== "string" || !item.id || evidenceIds.has(item.id) || typeof item.url !== "string" || typeof item.quote !== "string" || !item.quote) { issues.push("invalid_or_duplicate_evidence"); continue; }
        if (containsWholeText(item.quote, fullTexts)) { issues.push(`evidence_copies_whole_source:${item.id}`); continue; }
        const source = input.resources.find(resource => resource.url === item.url && resource.text.includes(item.quote as string));
        if (!source) { issues.push(`evidence_not_in_sent_material:${item.id}`); continue; }
        const local = Number.isSafeInteger(item.start) ? Number(item.start) - source.start : source.text.indexOf(item.quote);
        if (local < 0 || (!Number.isSafeInteger(item.start) && source.text.indexOf(item.quote, local + 1) !== -1)
            || source.text.slice(local, local + item.quote.length) !== item.quote || (item.end !== undefined && item.end !== source.start + local + item.quote.length)) {
            issues.push(`evidence_offset_ambiguous:${item.id}`); continue;
        }
        evidence.push({ id: item.id, url: item.url, sourceVersion: String(competition.sourceVersion), snapshotSourceUrl: String(competition.sourceUrl), resourceIndex: source.resourceIndex, textHash: source.textHash,
            start: source.start + local, end: source.start + local + item.quote.length, quote: item.quote }); evidenceIds.add(item.id);
    }
    const refs = (value: unknown, required = false) => strings(value) && (!required || value.length > 0) && value.every(id => evidenceIds.has(id));
    const nestedRefs = (value: unknown): boolean => Array.isArray(value) ? value.every(nestedRefs) : !object(value) || Object.entries(value).every(([key, item]) => key === "evidenceRefs" ? refs(item) : nestedRefs(item));
    const tasks: PreparedTask[] = [], taskIds = new Set(prior?.tasks.map(task => task.id) || []), pointers = new Set(prior?.tasks.map(task => task.scopePointer) || []), newTaskIds = new Set<string>();
    if (!Array.isArray(draft.tasks) || !draft.tasks.length && !prior?.tasks.length) issues.push("tasks_array_required");
    else if (rows(draft.tasks).length !== draft.tasks.length) issues.push("invalid_task_entries");
    for (const item of rows(draft.tasks)) {
        if (typeof item.id !== "string" || !item.id || typeof item.scopePointer !== "string" || !(item.scopePointer === "" || /^\/preparedTasks\/\d+$/.test(item.scopePointer))
            || typeof item.title !== "string" || !item.title.trim() || !(item.shortTheme === null || typeof item.shortTheme === "string")
            || !Object.hasOwn(item, "requirements") || item.requirements === undefined || (item.requirements === null && item.status !== "unknown") || !Array.isArray(item.workItems) || item.workItems.some(work => !object(work))
            || !strings(item.ruleRefs) || !refs(item.evidenceRefs, item.status !== "unknown") || !nestedRefs(item)
            || (item.track !== undefined && (!object(item.track) || !["known", "unknown", "conflict"].includes(String(item.track.status))
                || !refs(item.track.evidenceRefs, item.track.status === "known") || (item.track.status === "known" && (typeof item.track.id !== "string" || typeof item.track.title !== "string"))))
            || Object.keys(item).some(key => ["sourceText", "sourceSnapshot", "originalRecord", "binary", "rawText", "eligibility", "eligibilityStatus", "participationRequirements", "aiRule", "aiAllowed", "submissionUnit", "reviewSummary", "missingInformation"].includes(key))) { issues.push("invalid_task"); continue; }
        const priorTask = prior?.tasks.find(task => task.id === item.id);
        if (newTaskIds.has(item.id) || (taskIds.has(item.id) && !priorTask) || (pointers.has(item.scopePointer) && priorTask?.scopePointer !== item.scopePointer)) { issues.push(`duplicate_task_identity:${item.id}`); continue; }
        if (containsRetiredAnalysis(item) || containsWholeText(item, fullTexts)) { issues.push(`task_contains_retired_analysis_or_whole_source:${item.id}`); continue; }
        const task = cleanTaskText(structuredClone(item)) as PreparedTask;
        tasks.push(task); taskIds.add(item.id); newTaskIds.add(item.id); pointers.add(item.scopePointer);
    }
    const rules: PreparedRule[] = [], ruleIds = new Set(prior?.rules.map(rule => rule.id) || []), newRuleIds = new Set<string>();
    if (!Array.isArray(draft.rules)) issues.push("rules_array_required");
    else if (rows(draft.rules).length !== draft.rules.length) issues.push("invalid_rule_entries");
    for (const item of rows(draft.rules)) {
        if (containsRetiredAnalysis(item) || containsWholeText(item, fullTexts)) { issues.push("rule_contains_retired_analysis_or_whole_source"); continue; }
        if (typeof item.id !== "string" || !item.id || newRuleIds.has(item.id) || !["explicit", "unknown", "conflict"].includes(String(item.status)) || !strings(item.appliesTo)
            || item.appliesTo.some(id => !taskIds.has(id)) || (item.status === "explicit" && !item.appliesTo.length)
            || !Object.hasOwn(item, "content") || (item.status === "explicit" && (item.content === null || item.content === "")) || !refs(item.evidenceRefs, item.status !== "unknown") || !nestedRefs(item)) { issues.push("invalid_rule_scope_or_evidence"); continue; }
        rules.push(structuredClone(item) as PreparedRule); ruleIds.add(item.id); newRuleIds.add(item.id);
    }
    for (const task of tasks) if (task.ruleRefs.some(id => !ruleIds.has(id))) issues.push(`task_rule_not_found:${task.id}`);
    const facts: PreparedMaterialsBundle["facts"] = { submissionForms: [], feeStatus: [], submissionDeadline: [] };
    if (!object(draft.facts) || Object.keys(draft.facts).some(key => !keys.includes(key as typeof keys[number]))) issues.push("only_three_fact_fields_allowed");
    for (const key of keys) {
        const field = object(draft.facts) ? draft.facts[key] : undefined;
        if (!Array.isArray(field)) { issues.push(`fact_array_required:${key}`); continue; }
        if (rows(field).length !== field.length) issues.push(`invalid_fact_entries:${key}`);
        for (const item of rows(field)) {
            if (containsRetiredAnalysis(item) || containsWholeText(item, fullTexts)) { issues.push(`fact_contains_retired_analysis_or_whole_source:${key}`); continue; }
            const validValue = item.value === null || (key === "submissionForms" ? strings(item.value) && item.value.every(value => designDirections.includes(value))
                : key === "feeStatus" ? ["free", "paid"].includes(String(item.value)) : typeof item.value === "string");
            if (typeof item.scopePointer !== "string" || !pointers.has(item.scopePointer) || !["known", "unknown", "conflict"].includes(String(item.status)) || !validValue
                || (item.status === "known" && (item.value === null || Array.isArray(item.value) && !item.value.length)) || !refs(item.evidenceRefs, item.status !== "unknown")) { issues.push(`invalid_fact:${key}`); continue; }
            if (facts[key].some(row => row.scopePointer === item.scopePointer)) { issues.push(`duplicate_fact:${key}`); continue; }
            facts[key].push(structuredClone(item) as PreparedFact);
        }
    }
    const bundle: PreparedMaterialsBundle = { version: 1, identity: input.identity, contentHash: input.contentHash, sourceVersion: String(competition.sourceVersion),
        ...(competition.revision ? { recordRevision: competition.revision } : {}), facts, tasks, rules, evidence };
    const merged = prior ? mergeBundles(prior, bundle) : bundle;
    issues.push(...submissionChoiceIssues(merged.tasks, merged.evidence), ...unexpandedSubmissionOutcomes(tasks));
    if (!merged.tasks.length) issues.push("no_valid_tasks");
    for (const task of merged.tasks) for (const key of keys) if (!merged.facts[key].some(row => row.scopePointer === task.scopePointer)) issues.push(`task_fact_missing:${task.id}:${key}`);
    return { bundle: normalizeCurrentBundle(merged), issues };
}
function mergeBundles(previous: PreparedMaterialsBundle, proposed: PreparedMaterialsBundle): PreparedMaterialsBundle {
    const result = structuredClone(previous); result.contentHash = proposed.contentHash; result.sourceVersion = proposed.sourceVersion;
    result.evidence.push(...proposed.evidence); result.conflicts ||= [];
    for (const field of keys) for (const row of proposed.facts[field]) {
        const old = result.facts[field].find(item => item.scopePointer === row.scopePointer);
        if (!old) { result.facts[field].push(row); continue; }
        if (old.status === "unknown" && row.status === "known") { Object.assign(old, row); continue; }
        if (row.status === "unknown") continue;
        const evidenceRefs = [...new Set([...old.evidenceRefs, ...row.evidenceRefs])];
        if (canonical(old.value) !== canonical(row.value) || row.status === "conflict") {
            result.conflicts.push({ kind: "fact", field, scopePointer: row.scopePointer, previousValue: old.value, proposedValue: row.value, evidenceRefs });
            old.status = "conflict"; old.alternatives = [...new Set([...(Array.isArray(old.alternatives) ? old.alternatives : []), old.value, row.value].map(canonical))].map(value => JSON.parse(value));
        }
        old.evidenceRefs = evidenceRefs;
    }
    for (const field of ["tasks", "rules"] as const) for (const row of proposed[field]) {
        const old = result[field].find(item => item.id === row.id);
        if (!old) { (result[field] as Data[]).push(row); continue; }
        const { evidenceRefs: _oldRefs, ...oldMeaning } = old, { evidenceRefs: _newRefs, ...newMeaning } = row;
        if (canonical(oldMeaning) !== canonical(newMeaning)) result.conflicts.push({ kind: field === "tasks" ? "task" : "rule", id: row.id, previousRef: old.id, proposed: row });
        else old.evidenceRefs = [...new Set([...old.evidenceRefs, ...row.evidenceRefs])];
    }
    return result;
}

/** A durable claim is written before extract. Existing, failed, partial and uncertain attempts never resend the same material. */
export async function prepareCompetitionMaterials(root: string, competition: Competition, supplied: PreparedMaterialResource[], options: PrepareMaterialsOptions): Promise<PreparedMaterialsRead> {
    const current = await readPreparedMaterials(root, competition);
    if (["ready", "claimed", "incomplete", "failed", "invalid", "stale"].includes(current.status)) return { ...current, reused: true };
    const identity = identityOf(competition), resources = await loadPreparedMaterialResources(root, competition);
    if (!resources.length || !current.contentHash) return { status: "missing", contentHash: null, reason: "no_readable_stored_materials" };
    const { claims } = await claimFiles(root, identity), prior = claims.find(claim => claim.bundle)?.bundle;
    const baseBusinessHash = businessHash(competition);
    if (claims.length && !options.allowSupplement) return { status: "content_changed", contentHash: current.contentHash, reason: "explicit_supplement_required" };
    const sentTexts: string[] = [];
    for (const claim of claims) {
        const originals = await loadPreparedMaterialResources(root, { ...competition, sourceUrl: claim.identity.sourceUrl, sourceVersion: claim.sourceVersion });
        for (const fragment of claim.sentFragments) {
            const source = originals.find(resource => resource.resourceIndex === fragment.resourceIndex && digest(resource.text) === fragment.textHash);
            if (!source) return { status: "invalid", contentHash: current.contentHash, reason: "previous_sent_material_unavailable_no_automatic_retry" };
            sentTexts.push(source.text.slice(fragment.start, fragment.end));
        }
    }
    const selected: PreparedMaterialInput["resources"] = [], seen = new Set<string>();
    for (const item of supplied) {
        const source = resources.find(resource => resource.url === item.url && (item.resourceIndex === undefined || resource.resourceIndex === item.resourceIndex)
            && (item.start !== undefined ? resource.text.slice(item.start, item.end) === item.text : resource.text === item.text));
        if (!source) return { status: "invalid", contentHash: current.contentHash, reason: "input_not_in_current_stored_text" };
        if (sentTexts.some(text => text.includes(item.text))) continue;
        let fragments = [{ text: item.text, start: item.start ?? 0 }];
        for (const sent of sentTexts) fragments = fragments.flatMap(fragment => {
            const intervals: { text: string; start: number }[] = []; let start = 0, at;
            while ((at = fragment.text.indexOf(sent, start)) !== -1) { if (at > start) intervals.push({ text: fragment.text.slice(start, at), start: fragment.start + start }); start = at + sent.length; }
            if (start < fragment.text.length) intervals.push({ text: fragment.text.slice(start), start: fragment.start + start });
            return intervals;
        });
        if (claims.length && item.start === undefined && claims.some(claim => claim.sentFragments.some(fragment => fragment.url === item.url)) && fragments.length === 1 && fragments[0].text === item.text)
            return { status: "content_changed", contentHash: current.contentHash, reason: "changed_existing_document_requires_explicit_fragment" };
        for (const fragment of fragments) if (fragment.text.trim() && !seen.has(digest(fragment.text))) {
            selected.push({ ...source, text: fragment.text, start: fragment.start, end: fragment.start + fragment.text.length, resourceIndex: source.resourceIndex!, textHash: digest(source.text) }); seen.add(digest(fragment.text));
        }
    }
    if (!claims.length && contentHashOf(supplied) !== current.contentHash) return { status: "invalid", contentHash: current.contentHash, reason: "first_preparation_requires_complete_stored_material" };
    if (!selected.length) return { status: "content_changed", contentHash: current.contentHash, reason: "no_new_unsent_fragments" };
    const relative = `workspace/competition-sources/prepared-materials/${digest(identity.libraryId)}/${current.contentHash}.json`, file = await safePath(root, relative, true), activeFile = path.join(path.dirname(file), "active.json");
    const claim: Claim = { version: 1, identity, contentHash: current.contentHash, sourceVersion: String(competition.sourceVersion), sequence: claims.length + 1,
        createdAt: new Date().toISOString(), status: "claimed", requestState: "reserved", sentFragments: selected.map(({ url, resourceIndex, textHash, start, end }) => ({ url, resourceIndex, textHash, start, end })) };
    try { await durableJson(activeFile, { identity, contentHash: current.contentHash, createdAt: claim.createdAt }, true); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return { status: "claimed", contentHash: current.contentHash, reason: "identity_request_reserved_or_uncertain" }; throw error; }
    try { await durableJson(file, claim, true); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") { await fs.unlink(activeFile); return readPreparedMaterials(root, competition); }
        throw error;
    }
    const input: PreparedMaterialInput = { identity, title: typeof competition.title === "string" ? competition.title : null, contentHash: current.contentHash,
            mode: claims.length ? "supplement" : "initial", resources: selected,
            ...(prior ? { context: { facts: prior.facts, tasks: prior.tasks.map(({ id, scopePointer, title }) => ({ id, scopePointer, title })),
                rules: prior.rules.map(({ id, appliesTo, status }) => ({ id, appliesTo, status })) } } : {}) };
    try {
        options.signal?.throwIfAborted();
        const raw = await options.extract(input); claim.rawResponse = raw; claim.requestState = "returned";
        const validated = validatePreparedMaterialDraft(raw, input, competition, prior); claim.bundle = validated.bundle; claim.issues = validated.issues;
        claim.bundle.baseBusinessHash = baseBusinessHash;
        claim.status = validated.issues.length ? "incomplete" : "ready";
        if (claim.status === "ready") { claim.rawResponseHash = digest(typeof raw === "string" ? raw : canonical(raw)); delete claim.rawResponse; }
    } catch (error) {
        claim.status = "failed"; claim.requestState = "uncertain"; claim.issues = ["extractor_failed_or_result_uncertain_no_automatic_retry"];
        if (object(error) && error.rawResponse !== undefined) {
            claim.status = "incomplete"; claim.requestState = "returned"; claim.issues = ["partial_response_retained_no_automatic_retry"];
            claim.rawResponse = error.rawResponse;
            try { const partial = validatePreparedMaterialDraft(error.rawResponse, input, competition, prior); claim.bundle = partial.bundle; claim.issues.push(...partial.issues); } catch { /* The raw partial remains available without a second extraction. */ }
        }
    }
    if (claim.bundle) claim.bundleHash = digest(canonical(claim.bundle));
    claim.completedAt = new Date().toISOString();
    await durableJson(file, claim, false); await fs.unlink(activeFile);
    if (claim.status === "ready" && claim.bundle) await publishCompetitionCards(root, mapEvidence(claim.bundle, competition, resources), resources);
    return { status: claim.status, contentHash: current.contentHash, ...(claim.bundle ? { bundle: mapEvidence(claim.bundle, competition, resources) } : {}), issues: claim.issues, claimPath: relative, reused: false };
}
