import { loadPreparedMaterialResources } from "./prepared-materials.js";
import { resolveDirectoryReferences, type DirectoryReference } from "./directory-references.js";
import { nameKey, type CatalogueEntry } from "./competition-identities.js";
import { createHash, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { CURRENT_COMPETITION_CONTRACT, currentCreativeContent } from "./current-contract.js";
import { currentDeadlineExpired } from "./competition-clock.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ExperimentFiles, serializeArtifact } from "./tool-storage.js";
import { isImageMaterial, parseHtml, parseMaterial, type FormCondition } from "./tool-readers.js";
import { isOcrProvenance, isOcrEvidenceProof, type OcrProvenance, type OcrEvidenceProof } from "./tool-ocr.js";
import { BASIC_FIELD_KEYS, sixFieldPreview, validSixFieldEntry, validReviewedScopeIds, type SixFieldEntry, type SixFieldRead } from "./six-field-index.js";
import { readFollowUpState, followUpSummary } from "./follow-up-budget.js";
import { resolveTaskRelations, taskRefKey, type TaskRef, type ResolvedTaskRelation } from "./task-relations.js";
import { projectTaskRecord, projectTaskIndex, projectCompleteTaskFee, taskEvidencePointers } from "./task-detail.js";
import { compactTableRow, compactDirectoryTask, packCompetitionTable, packTaskDirectory } from "./compact-query.js";
export { decodeCompetitionTableRows, decodeTaskDirectoryRows } from "./compact-query.js";
import { readPreparedMaterials, type PreparedMaterialsRead, type PreparedFact } from "./prepared-materials.js";
import { WELL_KNOWN_VISUAL_LIST, wellKnownVisualEvent } from "./well-known-events.js";
export { buildSixFieldEntry, buildReviewedThreeFieldEntry, BASIC_FIELD_KEYS, SIX_FIELD_KEYS, type SixFieldEntry, type SixFieldRead } from "./six-field-index.js";

type JsonObject = Record<string, unknown>;
type LibraryStatus = "items" | "pending" | "ignored";
export const CORRECTION_FIELDS = ["deadline", "themeTask", "creativeContent", "submissionFormat", "finalSubmissionFormat", "eligibility", "fee", "registrationUrl", "organizer"] as const;
export type CorrectionField = typeof CORRECTION_FIELDS[number];
export type CompetitionCorrection = {
    field: CorrectionField; directionId?: string; previousValue: string | null; value: string | null;
    status?: "effective" | "superseded" | "stale" | "conflict";
};
type StoredCompetitionCorrection = Omit<CompetitionCorrection, "field" | "status"> & {
    field: CorrectionField | "aiRule"; status?: CompetitionCorrection["status"] | "retired";
};
export type CompetitionSupplement = {
    version: 1; id: string; competitionId: string; note: string; createdAt: string;
    runId: string; sessionId: string; baseSourceVersion?: string; baseRecordHash: string; currentBaseChanged?: boolean;
    evidence: { sourceId: string; quote: string; url: string; sha256: string; originalPath: string; formConditions?: FormCondition[]; ocr?: OcrProvenance & { evidence: OcrEvidenceProof } }[];
    expectedRevision?: string; corrections?: StoredCompetitionCorrection[];
};
export type LibraryCompetition = JsonObject & { libraryId: string; libraryStatus: LibraryStatus; revision: string; originalRecord: JsonObject; supplements: CompetitionSupplement[] };
export type CompetitionLibrary = JsonObject & {
    version: 1; status: "ready" | "missing";
    items: LibraryCompetition[]; pending: LibraryCompetition[]; ignored: LibraryCompetition[];
};
export type SupplementInput = { note: string; evidence: { sourceId: string; quote: string }[]; expectedRevision?: string; corrections?: CompetitionCorrection[] };
export type SupplementContext = { runId: string; sessionId: string; signal?: AbortSignal };

const groups: LibraryStatus[] = ["items", "pending", "ignored"];
const sixFieldIndexes = new WeakMap<CompetitionLibrary, Map<string, SixFieldRead>>();
const taskRelationIndexes = new WeakMap<CompetitionLibrary, Awaited<ReturnType<typeof resolveTaskRelations>>>();
type TaskScopeView = { summary: ReturnType<typeof scopeSummary>; deadlineValue: unknown; feeValue: unknown; hidden: boolean;
    taskId: string; linkedSources: (TaskRef & { title: string; sourceUrl: string })[]; relations: ResolvedTaskRelation[]; pending: string[] };
const taskScopeViews = new WeakMap<CompetitionLibrary, Map<string, TaskScopeView>>();
const safeId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]+$/.test(value);
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const sha256 = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const object = (value: unknown): value is JsonObject => Boolean(value) && typeof value === "object" && !Array.isArray(value);
function sourceUrl(value: unknown): value is string {
    if (typeof value !== "string") return false;
    try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; }
    catch { return false; }
}

// Paths are built by this module, never supplied by the model; check parents before mkdir follows them.
async function libraryPath(repoRoot: string, relative: string, createParents = false) {
    const root = path.resolve(repoRoot);
    const base = path.join(root, "workspace/competition-sources");
    const target = path.resolve(base, relative);
    const inside = path.relative(base, target);
    if (inside === ".." || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside)) throw new Error("竞赛资料路径越界");
    let current = root;
    const parts = path.relative(root, target).split(path.sep);
    for (const [index, part] of parts.entries()) {
        current = path.join(current, part);
        let stat;
        try { stat = await fs.lstat(current); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            if (createParents && index < parts.length - 1) {
                try { await fs.mkdir(current); }
                catch (creationError) { if ((creationError as NodeJS.ErrnoException).code !== "EEXIST") throw creationError; }
                stat = await fs.lstat(current);
            }
        }
        if (stat?.isSymbolicLink()) throw new Error("竞赛资料路径不能包含符号链接");
        if (stat && index < parts.length - 1 && !stat.isDirectory()) throw new Error("竞赛资料父路径不是目录");
    }
    return target;
}

async function readJson(repoRoot: string, relative: string): Promise<unknown> {
    const file = await libraryPath(repoRoot, relative);
    let text;
    try { text = await fs.readFile(file, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
    try { return JSON.parse(text); }
    catch { throw new Error(`竞赛资料 JSON 损坏：${relative}`); }
}

function validateRecord(value: unknown, detailed: boolean): asserts value is JsonObject {
    if (!object(value) || !sourceUrl(value.sourceUrl)
        || (detailed && (!safeId(value.id) || typeof value.title !== "string" || !value.title.trim()))
        || (value.id !== undefined && !safeId(value.id))
        || (value.sourceVersion !== undefined && !sha256(value.sourceVersion))) throw new Error("竞赛资料条目的 ID、来源或版本无效");
    if (value.directions !== undefined && (!Array.isArray(value.directions) || value.directions.some(direction =>
        !object(direction) || typeof direction.id !== "string" || !/^[a-zA-Z0-9_:-]+$/.test(direction.id)
        || typeof direction.title !== "string" || !sourceUrl(direction.sourceUrl)))) throw new Error("竞赛方向资料结构无效");
}

async function indexedLibrary(_repoRoot: string, library: CompetitionLibrary) {
    // The current contract has one material bundle per record. Retired indexes,
    // supplements and inferred cross-record relations are never consulted.
    for (const competition of groups.flatMap(group => library[group])) competition.revision = digest(Buffer.from(JSON.stringify(competition.originalRecord)));
    sixFieldIndexes.set(library, new Map());
    taskScopeViews.set(library, new Map());
    return library;
}

// New captures keep the archived parser output and bytes; extraction, citation checks and Pi share this exact text parser.
async function sourceText(resource: JsonObject) {
    if (resource.textParser !== "pi-material-v1") return typeof resource.text === "string" ? resource.text : "";
    if (isImageMaterial(resource) || typeof resource.binary !== "string" || !resource.binary) throw new Error("新文字来源缺少可校验的原件");
    const encoded = resource.binary.replace(/\s/g, ""), bytes = Buffer.from(encoded, "base64");
    if (bytes.toString("base64") !== encoded || digest(bytes) !== resource.sha256) throw new Error("新文字来源原件编码或哈希不符");
    const parsed = await parseMaterial(bytes, resource.url as string, typeof resource.mimeType === "string" ? resource.mimeType
        : resource.kind === "html" ? "text/html" : resource.kind === "pdf" ? "application/pdf" : "", typeof resource.contentType === "string" ? resource.contentType : "");
    if (parsed.status !== "read" || !parsed.text) throw new Error("新文字来源原件没有可读取正文");
    return parsed.text;
}

export async function readSixFieldEntry(_repoRoot: string, _competition: LibraryCompetition): Promise<SixFieldRead> {
    return { status: "missing" };
}

export async function publishSixFieldEntry(_repoRoot: string, _entry: SixFieldEntry) {
    throw new Error("旧索引入口已停用，请通过当前竞赛材料整理入口保存。");
}

export async function readCompetitionLibrary(repoRoot: string): Promise<CompetitionLibrary> {
    const report = await readJson(repoRoot, "shejijingsai-report.json");
    if (report === undefined) return { version: 1, status: "missing", items: [], pending: [], ignored: [] };
    if (!object(report) || report.dataContract !== CURRENT_COMPETITION_CONTRACT || report.version !== 1 || typeof report.source !== "string" || !sourceUrl(report.sourceUrl)
        || groups.some(group => !Array.isArray(report[group]))) throw new Error("竞赛资料库版本或结构无效，拒绝使用损坏资料");
    const library = { ...report, status: "ready" } as CompetitionLibrary;
    const ids = new Map<string, LibraryCompetition>();
    for (const group of groups) {
        library[group] = (report[group] as unknown[]).map(value => {
            validateRecord(value, group !== "ignored");
            if (Object.keys(value).some(key => !["id", "title", "sourceUrl", "sourceVersion", "category", "collectedAt", "ingestionMode"].includes(key))
                || group !== "ignored" && value.ingestionMode !== "source") throw new Error("竞赛条目不符合当前统一格式，拒绝退回旧字段。");
            const libraryId = typeof value.id === "string" ? value.id : `source-${digest(Buffer.from(value.sourceUrl as string))}`;
            // Projection metadata never becomes the next original record or its revision basis.
            const { libraryId: _id, libraryStatus: _status, supplements: _supplements, revision: _revision, originalRecord: _original, ...raw } = value;
            const originalRecord = structuredClone(raw);
            const competition = { ...structuredClone(raw), libraryId, libraryStatus: group, revision: "", originalRecord, supplements: [] } as LibraryCompetition;
            if (ids.has(libraryId)) throw new Error(`竞赛资料 ID 重复：${libraryId}`);
            ids.set(libraryId, competition);
            return competition;
        });
    }
    return indexedLibrary(repoRoot, library);
}

async function readDetails(repoRoot: string, competition: LibraryCompetition) {
    let sourceSnapshot: unknown = null;
    if (typeof competition.sourceVersion === "string") {
        sourceSnapshot = await readJson(repoRoot, `source-snapshots/${competition.sourceVersion}.json`);
        if (sourceSnapshot !== undefined && (!object(sourceSnapshot) || sourceSnapshot.sourceUrl !== competition.sourceUrl || !Array.isArray(sourceSnapshot.resources))) throw new Error("竞赛原文快照结构或来源无效");
        if (object(sourceSnapshot)) sourceSnapshot = { ...sourceSnapshot, resources: await Promise.all((sourceSnapshot.resources as unknown[]).map(async (value, resourceIndex) => {
            if (!object(value) || !sourceUrl(value.url) || (value.binary !== undefined && typeof value.binary !== "string")) throw new Error("竞赛原文资源结构无效");
            const { binary, ...resource } = value;
            if (isImageMaterial(value)) return { url: value.url, kind: value.kind, resourceIndex, status: "unsupported_image", policy: "text_only", hasStoredBinary: typeof binary === "string" && Boolean(binary) };
            if (value.textParser === "pi-material-v1") resource.text = await sourceText(value);
            // Visibility is a reading aid derived from the original HTML; it never changes records or their revision.
            if (value.kind === "html" && typeof binary === "string" && !resource.formConditions) {
                const encoded = binary.replace(/\s/g, ""), bytes = Buffer.from(encoded, "base64");
                if (encoded && bytes.toString("base64") === encoded) {
                    const conditions = parseHtml(bytes, value.url as string).formConditions;
                    if (conditions) resource.formConditions = conditions;
                }
            }
            return { ...resource, resourceIndex, hasStoredBinary: typeof binary === "string" && Boolean(binary),
                ...(typeof binary === "string" ? { storedBinaryBytes: Buffer.byteLength(binary, "base64") } : {}) };
        })) };
    }
    const detail = typeof competition.id === "string" ? await readJson(repoRoot, `details/${competition.id}.json`) : undefined;
    if (detail !== undefined && (!object(detail) || detail.version !== 1 || detail.id !== competition.id || detail.sourceUrl !== competition.sourceUrl)) throw new Error("竞赛详情结构或来源无效");
    const reading = competition.ingestionMode === "source"
        ? { sourceOverview: { title: competition.title, sourceUrl: competition.sourceUrl, mode: "source", resourceCount: object(sourceSnapshot) ? (sourceSnapshot.resources as unknown[]).length : 0 } }
        : competitionInformation(competition);
    const sixFieldIndex = await readSixFieldEntry(repoRoot, competition);
    return { competition, ...reading, sixFields: sixFieldIndex.entry ? Object.fromEntries(BASIC_FIELD_KEYS.map(key => [key, sixFieldIndex.entry!.fields[key]])) : null,
        sixFieldIndexStatus: sixFieldIndex.status, sixFieldIndexHash: sixFieldIndex.hash ?? null,
        followUp: basicFollowUp(await readFollowUpState(repoRoot, competition.libraryId)),
        sourceSnapshot: sourceSnapshot ?? null, detail: detail ?? null,
        sourceSnapshotStatus: sourceSnapshot ? "available" : competition.sourceVersion ? "missing" : "not_recorded",
        detailStatus: detail ? "available" : "missing" };
}

function basicFollowUp(state: Parameters<typeof followUpSummary>[0]) {
    const summary = followUpSummary(state);
    return summary ? { ...summary, unknownFields: summary.unknownFields.filter(key => (BASIC_FIELD_KEYS as readonly string[]).includes(key)) } : summary;
}

async function linkedFollowUps(repoRoot: string, library: CompetitionLibrary, competition: LibraryCompetition) {
    const ids = [...new Set(searchScopes(competition).flatMap(scope => taskScopeViews.get(library)?.get(taskRefKey({ libraryId: competition.libraryId,
        scopePointer: scope.pointer }))?.linkedSources.map(source => source.libraryId) || []))].filter(id => id !== competition.libraryId);
    const states = await Promise.all(ids.map(async competitionId => ({ competitionId, followUp: basicFollowUp(await readFollowUpState(repoRoot, competitionId)) })));
    return states.filter((state): state is typeof state & { followUp: NonNullable<typeof state.followUp> } => Boolean(state.followUp));
}

function informationNote(note: unknown) {
    return typeof note === "string" ? note.match(/^([^：:]+)[：:]\s*(\S[\s\S]*)$/) : null;
}

function competitionInformation(record: JsonObject): { information: Record<string, JsonObject>; unassignedNotes: unknown[] } {
    const entries = (value: unknown) => Array.isArray(value) ? value.filter(object) : [];
    const information: Record<string, JsonObject> = {
        "竞赛名称": { title: record.competitionTitle || record.title },
        "投稿结构": {
            directions: entries(record.directions).map(direction => ({ id: direction.id, title: direction.title, ...competitionInformation({ ...direction, competitionTitle: record.competitionTitle || record.title }) })),
            creativeCategories: entries(record.creativeCategories).map(category => ({ id: category.id, title: category.title, ...competitionInformation({ ...category, competitionTitle: record.competitionTitle || record.title, themeTask: category.description }) })),
        },
        "设计分类": { designTypes: record.designTypes },
        "主题与任务": { themeTask: record.themeTask, creativeContent: record.creativeContent },
        "作品清单": { workItems: record.workItems },
        "参赛资格": { eligibilityStatus: record.eligibilityStatus, eligibility: record.eligibility },
        "截止时间": { deadline: record.deadline },
        "投稿要求": { submissionFormat: record.submissionFormat, finalSubmissionFormat: record.finalSubmissionFormat, registrationUrl: record.registrationUrl },
        "收费情况": { feeStatus: record.feeStatus, fee: record.fee },
        "来源证据": { sourceUrl: record.sourceUrl, sourceUrls: record.sourceUrls, evidence: record.evidence, supplements: record.supplements },
    };
    for (const field of Object.values(information)) field.notes = [];
    const unassignedNotes: unknown[] = [];
    for (const note of Array.isArray(record.missingInformation) ? record.missingInformation : []) {
        const match = informationNote(note);
        if (match && Object.hasOwn(information, match[1].trim())) (information[match[1].trim()].notes as string[]).push(match[2]);
        else unassignedNotes.push(note);
    }
    return { information, unassignedNotes };
}

export async function readLibraryCompetition(repoRoot: string, competitionId: string, forAgent = false) {
    if (!safeId(competitionId)) throw new Error("竞赛 ID 无效");
    const library = await readCompetitionLibrary(repoRoot);
    const competition = groups.flatMap(group => library[group]).find(item => item.libraryId === competitionId || item.id === competitionId);
    if (!competition || competition.libraryStatus === "ignored") throw new Error(`本地资料库不存在可用竞赛：${competitionId}`);
    if (forAgent && competitionExpired(library, competition, new Date())) throw new Error("该竞赛已明确截止，已从 Agent 查询范围隐藏；原资料保留。");
    const relationIndex = taskRelationIndexes.get(library);
    return { ...await readDetails(repoRoot, competition), libraryRevision: competitionLibraryRevision(library), relatedFollowUps: await linkedFollowUps(repoRoot, library, competition),
        ...(relationIndex?.status !== "missing" ? { taskRelations: { status: relationIndex?.status, hash: relationIndex?.hash,
            relations: relationIndex?.relations.filter(item => item.members.some(member => member.libraryId === competition.libraryId)).map(relationMetadata) } } : {}) };
}

export type LibraryTaskDetailOptions = { scopePointer?: string; expectedRevision?: string; expectedIndexHash?: string | null;
    expectedSourceVersion?: string | null; expectedVersionToken?: string };

type LibraryReadView = { library: CompetitionLibrary; materials: Map<string, PreparedMaterialsRead>; directoryReferences: DirectoryReference[]; revision: string };
const requestLibraryView = new AsyncLocalStorage<{ root: string; view: LibraryReadView }>();
async function readLibraryView(repoRoot: string, fresh = false): Promise<LibraryReadView> {
    const current = requestLibraryView.getStore();
    if (!fresh && current?.root === path.resolve(repoRoot)) return current.view;
    const library = await readCompetitionLibrary(repoRoot);
    const materials = new Map(await Promise.all(groups.flatMap(group => library[group]).map(async competition =>
        [competition.libraryId, await readPreparedMaterials(repoRoot, competition)] as const)));
    const prepared = [...materials].filter(([, state]) => state.status !== "missing");
    const revision = prepared.length ? digest(Buffer.from(JSON.stringify({ base: competitionLibraryRevision(library),
        prepared: prepared.map(([id, state]) => [id, state.status, state.contentHash, state.bundle ? digest(Buffer.from(JSON.stringify(state.bundle))) : null]) })))
        : competitionLibraryRevision(library);
    const directoryReferences = await resolveDirectoryReferences([...library.items, ...library.pending], materials, async id => {
        const competition = [...library.items, ...library.pending].find(item => item.libraryId === id)!;
        return (await loadPreparedMaterialResources(repoRoot, competition)).map(r => r.text).join("\n");
    });
    return { library, materials, directoryReferences, revision };
}

export async function competitionDirectoryReferences(repoRoot: string) { return (await readLibraryView(repoRoot)).directoryReferences; }

export async function competitionCatalogue(repoRoot: string): Promise<CatalogueEntry[]> {
    const view = await readLibraryView(repoRoot);
    return [...view.library.items, ...view.library.pending].map(entry => ({ id: entry.libraryId, title: String(entry.title),
        tasks: (view.materials.get(entry.libraryId)?.bundle?.tasks || []).map(task => ({ title: task.title, scopePointer: task.scopePointer, taskId: task.id })) }));
}

export async function getCompetitionQueryRevision(repoRoot: string, fresh = false) { return (await readLibraryView(repoRoot, fresh)).revision; }

/** One request reads one immutable view. Publication and creation still validate against fresh storage. */
export async function withCompetitionLibraryView<T>(repoRoot: string, operation: () => Promise<T>): Promise<T> {
    const root = path.resolve(repoRoot), view = await readLibraryView(root, true);
    return requestLibraryView.run({ root, view }, operation);
}

function viewToken(view: LibraryReadView, competition: LibraryCompetition) {
    return digest(Buffer.from(JSON.stringify([view.revision, competition.libraryId, competition.revision,
        sixFieldIndexes.get(view.library)?.get(competition.libraryId)?.hash ?? null, competition.sourceVersion ?? null])));
}

async function userSourceAccess(repoRoot: string, competition: LibraryCompetition) {
    const snapshot = typeof competition.sourceVersion === "string" ? await readJson(repoRoot, `source-snapshots/${competition.sourceVersion}.json`) : undefined;
    if (snapshot !== undefined && (!object(snapshot) || snapshot.sourceUrl !== competition.sourceUrl || !Array.isArray(snapshot.resources))) throw new Error("竞赛原文快照结构或来源无效");
    return { status: "user_source_view_only", resources: object(snapshot) ? entries(snapshot.resources).map((resource, resourceIndex) => {
        if (!sourceUrl(resource.url)) throw new Error("竞赛原文来源无效");
        return { resourceIndex, url: resource.url, kind: resource.kind, status: isImageMaterial(resource) ? "unsupported_image" : "user_readable_source" };
    }) : [],
        sourceSnapshotStatus: snapshot ? "available" : competition.sourceVersion ? "missing" : "not_recorded" };
}

/** Local deadlines override the parent; only explicitly applicable stored common rules may fill a missing date. */
function preparedDeadline(state: PreparedMaterialsRead, pointer: string): PreparedFact | undefined {
    const bundle = state.bundle, local = bundle?.facts.submissionDeadline.find(row => row.scopePointer === pointer);
    if (bundle?.contract === CURRENT_COMPETITION_CONTRACT) return local;
    if (!bundle || local?.status === "known" || local?.status === "conflict") return local;
    const task = bundle.tasks.find(task => task.scopePointer === pointer);
    const dates = bundle.rules.filter(rule => rule.status === "explicit" && task?.ruleRefs.includes(rule.id) && rule.appliesTo.includes(task.id)
        && !bundle.conflicts?.some(conflict => conflict.kind === "rule" && conflict.id === rule.id))
        .flatMap(rule => {
            const text = typeof rule.content === "string" ? rule.content : object(rule.content) ? Object.values(rule.content).filter(value => typeof value === "string").join("\n") : "";
            return text.split(/[；;。\n]/).filter(part => /截止|截至/.test(part)).flatMap(value => explicitDeadline(value)
                ? [{ scopePointer: pointer, value, status: "known" as const, evidenceRefs: rule.evidenceRefs }] : []);
        });
    return new Set(dates.map(row => explicitDeadline(row.value))).size === 1 ? dates[0] : local;
}
function preparedFacts(state: PreparedMaterialsRead, pointer: string) {
    const facts = state.bundle?.facts;
    if (!facts) return null;
    const row = (key: keyof typeof facts) => facts[key].find(item => item.scopePointer === pointer);
    const forms = row("submissionForms"), fee = row("feeStatus"), deadline = preparedDeadline(state, pointer);
    return { submissionForms: { categories: forms?.status === "known" ? forms.value : null, status: forms?.status ?? "unknown" },
        feeStatus: { status: fee?.status === "known" && ["free", "paid"].includes(String(fee.value)) ? fee.value : "unknown",
            factState: fee?.status ?? "unknown", value: fee?.value ?? null, ...(fee?.alternatives ? { alternatives: fee.alternatives } : {}) },
        submissionDeadline: { value: deadline?.value ?? null, date: deadline?.status === "known" ? typeof deadline.date === "string" ? deadline.date : null : null,
            status: deadline?.status ?? "unknown", ...(deadline?.alternatives ? { alternatives: deadline.alternatives } : {}) } };
}
function preparedContentReady(state: PreparedMaterialsRead, pointers?: unknown[]) {
    return state.status === "ready" && Boolean(state.bundle?.tasks.some(task => task.status !== "unknown" && Boolean(currentCreativeContent(task))
        && (!pointers || pointers.includes(task.scopePointer))));
}

function preparedLocalConflicts(state: PreparedMaterialsRead, pointer: string) {
    const task = state.bundle?.tasks.find(task => task.scopePointer === pointer);
    return task ? (state.bundle?.conflicts || []).filter(conflict => conflict.kind === "task" && conflict.id === task.id
        || conflict.kind === "rule" && task.ruleRefs.includes(String(conflict.id)) || conflict.kind === "fact" && conflict.scopePointer === pointer) : [];
}
function conflictEvidenceRefs(conflicts: JsonObject[]) {
    return [...new Set(conflicts.flatMap(conflict => [conflict.evidenceRefs, object(conflict.previous) ? conflict.previous.evidenceRefs : [],
        object(conflict.proposed) ? conflict.proposed.evidenceRefs : []].flatMap(value => Array.isArray(value) ? value.filter((ref): ref is string => typeof ref === "string") : [])))];
}
function scopedEvidenceRefs(value: unknown): string[] {
    if (Array.isArray(value)) return [...new Set(value.flatMap(scopedEvidenceRefs))];
    if (!object(value)) return [];
    return [...new Set(Object.entries(value).flatMap(([key, child]) => key === "evidenceRefs" && Array.isArray(child)
        ? child.filter((ref): ref is string => typeof ref === "string") : scopedEvidenceRefs(child)))];
}
function needsMaterialReview(view: LibraryReadView, competition: LibraryCompetition) {
    const material = view.materials.get(competition.libraryId), index = sixFieldIndexes.get(view.library)?.get(competition.libraryId);
    return Boolean(material && material.status !== "ready" && competition.libraryStatus !== "ignored");
}

/** A task reading projection only; original records, source text, task identity and canvas storage stay unchanged. */
export async function readLibraryTaskDetail(repoRoot: string, competitionId: string, options: LibraryTaskDetailOptions = {}, forAgent = true) {
    if (!safeId(competitionId) || !object(options) || Object.keys(options).some(key => !["scopePointer", "expectedRevision", "expectedIndexHash", "expectedSourceVersion", "expectedVersionToken"].includes(key))
        || (options.scopePointer !== undefined && typeof options.scopePointer !== "string")
        || (options.expectedRevision !== undefined && !sha256(options.expectedRevision))
        || (options.expectedVersionToken !== undefined && !sha256(options.expectedVersionToken))
        || [options.expectedIndexHash, options.expectedSourceVersion].some(value => value !== undefined && value !== null && !sha256(value))) throw new Error("投稿任务定位或读取版本无效");
    const readView = await readLibraryView(repoRoot), { library } = readView;
    const competition = groups.flatMap(group => library[group]).find(item => item.libraryId === competitionId || item.id === competitionId);
    if (!competition || competition.libraryStatus === "ignored") throw new Error(`本地资料库不存在可用竞赛：${competitionId}`);
    const index = sixFieldIndexes.get(library)?.get(competition.libraryId), sourceVersion = typeof competition.sourceVersion === "string" ? competition.sourceVersion : null;
    if ((options.expectedRevision !== undefined && options.expectedRevision !== competition.revision)
        || (options.expectedIndexHash !== undefined && options.expectedIndexHash !== (index?.hash ?? null))
        || (options.expectedSourceVersion !== undefined && options.expectedSourceVersion !== sourceVersion)
        || (options.expectedVersionToken !== undefined && options.expectedVersionToken !== viewToken(readView, competition))) throw new Error("竞赛记录、索引或来源版本已变化，请重新查询后读取任务");
    const now = new Date();
    const material = readView.materials.get(competition.libraryId)!;
    const common = { format: "submission_task_detail_v2", competition: { libraryId: competition.libraryId, id: competition.id, title: competition.title,
        revision: competition.revision, sourceVersion, sourceUrl: competition.sourceUrl, libraryStatus: competition.libraryStatus },
        libraryRevision: readView.revision, versionToken: viewToken(readView, competition), preparationState: material.status,
        sixFieldIndexStatus: index?.status ?? "missing", sixFieldIndexHash: index?.hash ?? null,
        followUp: basicFollowUp(await readFollowUpState(repoRoot, competition.libraryId)), relatedFollowUps: await linkedFollowUps(repoRoot, library, competition) };
    if (material.status === "ready" && material.bundle) {
        const available = material.bundle.tasks.filter(task => !forAgent || !preparedTaskExpired(material, task.scopePointer, now));
        if (forAgent && !available.length) throw new Error("该竞赛所有已整理投稿任务均已明确截止。");
        const selected = options.scopePointer === undefined && available.length === 1 ? available[0] : available.find(task => task.scopePointer === options.scopePointer);
        if (options.scopePointer !== undefined && !selected) throw new Error("预整理投稿任务不存在或已明确截止，请重新读取短目录。");
        if (!selected) return { ...common, status: "task_selection_required", taskDirectoryTool: "read_library_task_directory", taskCount: available.length };
        if (selected.status === "unknown" || !currentCreativeContent(selected)) return { ...common, status: "pending_preparation", materialStatus: "pending_preparation",
            preparation: { state: "unknown_task_content", automaticExtraction: false, reason: "本任务的具体创作内容尚待整理，不能用名称或提交规范代替。" },
            userSourceAccess: await userSourceAccess(repoRoot, competition) };
        const conflicts = preparedLocalConflicts(material, selected.scopePointer), conflictedRules = new Set(conflicts.filter(conflict => conflict.kind === "rule").map(conflict => conflict.id));
        const applied = material.bundle.rules.filter(rule => selected.ruleRefs.includes(rule.id) && rule.status === "explicit" && rule.appliesTo.includes(selected.id) && !conflictedRules.has(rule.id));
        const pending = material.bundle.rules.filter(rule => selected.ruleRefs.includes(rule.id) && !applied.includes(rule)
            || rule.appliesTo.length === 0 && rule.status !== "explicit");
        const { id, scopePointer, title, ruleRefs, evidenceRefs, ...content } = selected;
        return { ...common, status: "selected_task", materialStatus: "ready", task: { taskId: id, scopeId: id, scopePointer, title,
            content, facts: preparedFacts(material, scopePointer), ruleRefs: applied.map(rule => rule.id),
            rules: applied.map(({ evidenceRefs: _evidence, appliesTo: _targets, ...rule }) => ({ ...rule, appliesToTask: true })),
            unresolvedRules: pending.map(rule => ({ id: rule.id, status: conflictedRules.has(rule.id) ? "conflict" : rule.status, applicability: "unknown" })),
            ...(conflicts.length ? { requirementStatus: "conflict", conflicts: conflicts.map(conflict => ({ kind: conflict.kind, id: conflict.id, field: conflict.field, status: "conflict" })) } : {}),
            evidenceRefs: [...new Set([...evidenceRefs, ...applied.flatMap(rule => rule.evidenceRefs),
                ...pending.flatMap(rule => rule.evidenceRefs), ...conflictEvidenceRefs(conflicts),
                ...BASIC_FIELD_KEYS.flatMap(key => material.bundle!.facts[key].filter(row => row.scopePointer === scopePointer).flatMap(row => row.evidenceRefs))])],
            coverage: { status: "prepared_task_and_explicit_shared_rules", officialSourceReview: "not_performed_by_query", commonRules: pending.length ? "some_rules_unknown" : "explicit_rules_only" } },
            userSourceAccess: await userSourceAccess(repoRoot, competition) };
    }
    if (needsMaterialReview(readView, competition)) return { ...common, status: "pending_preparation", materialStatus: material.status,
        preparation: { state: material.status, automaticExtraction: false, reason: "当前创作任务尚待整理，暂不能进入创作。" },
        userSourceAccess: await userSourceAccess(repoRoot, competition) };
    throw new Error("当前竞赛材料不可用，禁止回退旧任务字段。");
}

/** Internal resource bytes are consumed by the material tool, never serialized into model text. */
export async function readLibraryResource(repoRoot: string, competitionId: string, resourceIndex: number): Promise<Record<string, unknown>> {
    if (!Number.isSafeInteger(resourceIndex) || resourceIndex < 0) throw new Error("竞赛原文资源索引无效");
    const { competition } = await readLibraryCompetition(repoRoot, competitionId);
    if (typeof competition.sourceVersion !== "string") throw new Error("该竞赛没有已保存的原文快照");
    const snapshot = await readJson(repoRoot, `source-snapshots/${competition.sourceVersion}.json`);
    if (!object(snapshot) || snapshot.sourceUrl !== competition.sourceUrl || !Array.isArray(snapshot.resources)) throw new Error("竞赛原文快照缺失或来源无效");
    const resource = snapshot.resources[resourceIndex];
    if (!object(resource) || !sourceUrl(resource.url)) throw new Error("指定的竞赛原文资源不存在或来源无效");
    return resource;
}

export const SEARCH_RESULT_FIELDS = ["title", "submissionForms", "deadline", "fee"] as const;
export function competitionLibraryRevision(library: CompetitionLibrary) {
    const indexes = sixFieldIndexes.get(library);
    const records = groups.flatMap(group => library[group]).map(record => {
        const index = indexes?.get(record.libraryId);
        return [record.libraryId, record.revision, index?.status ?? "missing", index?.hash ?? null];
    }).sort((a, b) => a[0]!.localeCompare(b[0]!));
    const relations = taskRelationIndexes.get(library);
    return digest(Buffer.from(JSON.stringify(relations?.status === "missing" || !relations ? records : { records, relations: [relations.status, relations.hash,
        relations.relations.map(({ id, kind, status, canonicalKey, reason }) => ({ id, kind, status, canonicalKey, reason }))] })));
}
export type CompetitionSearchOptions = {
    discoveryList?: typeof WELL_KNOWN_VISUAL_LIST;
    filters?: { designTypes?: string[]; feeStatus?: "free" | "paid"; deadlineFrom?: string; deadlineTo?: string };
    fields?: (typeof SEARCH_RESULT_FIELDS[number])[];
    sort?: { field: "title" | "deadline"; direction?: "asc" | "desc" };
    offset?: number; limit?: number;
};
type ConditionState = "match" | "mismatch" | "unknown";
export const CANDIDATE_CONDITION_LABELS: Record<string, string> = { designTypes: "作品类型", feeStatus: "收费情况",
    deadlineFrom: "投稿截止下限", deadlineTo: "投稿截止上限", submissionForms: "作品类型", submissionDeadline: "投稿截止时间" };
type SearchScope = { record: JsonObject; scopeId: string; pointer: string; scopeTitle: string | null; parentScopeId: string | null; parents: SearchScope[]; leaf: boolean };
const entries = (value: unknown) => Array.isArray(value) ? value.filter(object) : [];

function shortDescription(value: unknown, field: string | null) {
    return sixFieldPreview(value, field);
}

function beijingDeadlineText(value: string) {
    if (!/北京时间/.test(value)) return value;
    const normalized = value.replace(/\b(?:UTC|GMT)\s*\+\s*0?8(?::?00)?(?![\d:.A-Za-z])/gi, "");
    return /\+\s*\d/.test(normalized) ? value : normalized;
}

/** Dates are used only when one complete, valid calendar day is explicit; never infer a year or choose a stage. */
function explicitDeadline(input: unknown): string | null {
    if (typeof input !== "string" || /暂定|拟定|预计|待定|待确认|待核|尚未确定|未确定|另行公布|另行通知|未知|冲突|不明确|未明确|尚待|可能/.test(input)) return null;
    const value = beijingDeadlineText(input.replace(/(?:未|没有|尚未)(?:注明|说明|标明|标注)时区/g, ""));
    if (/\b[A-Z]{2,5}\b/i.test(value) || /时区|当地时间|美国|英国|欧洲|日本|韩国|夏令|[+-]\d{2}:?\d{2}|\d{2}:\d{2}Z/i.test(value)) return null;
    const matches = [...value.matchAll(/(?<!\d)(\d{4})(?:年|[-/.])(\d{1,2})(?:月|[-/.])(\d{1,2})(?:日)?(?!\d)/g)];
    if (matches.length !== 1) return null;
    const match = matches[0], rest = value.slice(0, match.index) + value.slice(match.index! + match[0].length);
    const before = value.slice(0, match.index), after = value.slice(match.index! + match[0].length);
    const segment = before.split(/[，,；;。\n]/).at(-1)! + match[0] + after.split(/[，,；;。\n]/)[0];
    if (/(?<!\d)\d{1,2}月\d{1,2}日?|(?<!\d)\d{1,2}[-/.]\d{1,2}(?!\d)/.test(rest) || /^\s*(?:至|到|~|～)/.test(after)
        || (/报名/.test(segment) && !/投稿|作品提交|提交作品/.test(segment))
        || (/赛期|比赛时间|举行时间|展览时间|初赛|决赛|开赛|开始|启动|报名/.test(segment) && !/截止|截至/.test(segment))) return null;
    const [, year, month, day] = matches[0], iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    const date = new Date(`${iso}T00:00:00Z`);
    return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== iso ? null : iso;
}

function validateSearchOptions(options: CompetitionSearchOptions) {
    if (!object(options) || Object.keys(options).some(key => !["filters", "fields", "sort", "offset", "limit", "discoveryList"].includes(key))
        || (options.discoveryList !== undefined && options.discoveryList !== WELL_KNOWN_VISUAL_LIST)) throw new Error("资料库查询选项无效");
    for (const key of ["offset", "limit"] as const) if (options[key] !== undefined && (!Number.isSafeInteger(options[key]) || options[key]! < 0)) throw new Error("分页须为非负整数");
    if (options.fields !== undefined && (!Array.isArray(options.fields) || options.fields.some(field => !SEARCH_RESULT_FIELDS.includes(field)))) throw new Error("查询返回字段不在轻量白名单内");
    if (options.sort !== undefined && (!object(options.sort) || Object.keys(options.sort).some(key => !["field", "direction"].includes(key))
        || !["title", "deadline"].includes(options.sort.field) || (options.sort.direction !== undefined && !["asc", "desc"].includes(options.sort.direction)))) throw new Error("查询排序无效");
    const filters = options.filters;
    if (filters === undefined) return;
    if (!object(filters) || Object.keys(filters).some(key => !["designTypes", "feeStatus", "deadlineFrom", "deadlineTo"].includes(key))
        || (filters.designTypes !== undefined && (!Array.isArray(filters.designTypes) || filters.designTypes.some(value => typeof value !== "string" || !value.trim())))
        || (filters.feeStatus !== undefined && !["free", "paid"].includes(filters.feeStatus))) throw new Error("资料库筛选条件无效");
    for (const key of ["deadlineFrom", "deadlineTo"] as const) if (filters[key] !== undefined
        && (!/^\d{4}-\d{2}-\d{2}$/.test(filters[key]!) || explicitDeadline(filters[key]) !== filters[key])) throw new Error("截止范围须为明确有效的 YYYY-MM-DD 日期");
    if (filters.deadlineFrom && filters.deadlineTo && filters.deadlineFrom > filters.deadlineTo) throw new Error("截止日期范围起止顺序无效");
}

function searchScopes(competition: LibraryCompetition) {
    const scopes: SearchScope[] = [];
    const visit = (record: JsonObject, pointer: string, parent?: SearchScope) => {
        const directions = entries(record.directions), categories = entries(record.creativeCategories);
        const scope: SearchScope = { record, pointer, scopeId: parent ? (typeof record.id === "string" ? record.id : `${parent.scopeId}/scope-${scopes.length}`) : competition.libraryId,
            scopeTitle: typeof record.title === "string" ? record.title : null, parentScopeId: parent?.scopeId ?? null,
            parents: parent ? [parent, ...parent.parents] : [], leaf: !directions.length && !categories.length };
        scopes.push(scope);
        for (const [field, children] of [["directions", directions], ["creativeCategories", categories]] as const)
            for (const [index, child] of children.entries()) visit(child, `${pointer}/${field}/${index}`, scope);
    };
    visit(competition, "");
    return scopes;
}

function scopeFact(scope: SearchScope, field: "deadline" | "fee") {
    if (field === "deadline" && !scope.record.deadline && scope.record.deadlineStatus !== "conflict") {
        const parent = scope.parents.find(parent => typeof parent.record.deadline === "string" && explicitDeadline(parent.record.deadline)
            && !/不同赛道|分别|各不|各异|另行|详见各|以各/.test(parent.record.deadline));
        if (parent) return { record: parent.record, scopeId: parent.scopeId };
    }
    if (scope.record[field] !== undefined || scope.record[`${field}Status`] !== undefined) return { record: scope.record, scopeId: scope.scopeId };
    // Only inherit explicitly common rules, never use a sibling direction or an aggregate parent's category tags.
    const common = scope.parents.find(parent => typeof parent.record[field] === "string"
        && /(?:所有|全部|各)(?:赛道|命题|类别|参赛者|参赛人员|参赛作品|作品|报名者)|全体(?:参赛|报名|学生)|统一(?:要求|规则|适用|执行|规定|报名|截止|收费|免费|参赛条件|资格)|(?:共同|共通)适用/.test(parent.record[field] as string)
        && !/不同赛道|分别|各不|各异|另行|详见各|以各/.test(parent.record[field] as string));
    return common ? { record: common.record, scopeId: common.scopeId } : { record: scope.record, scopeId: scope.scopeId };
}

function hasLocalDoubt(record: JsonObject, field: "deadline" | "fee") {
    const groups = { deadline: ["截止时间", "截止日期"], fee: ["收费情况", "费用"] }[field];
    return [record.missingInformation, record.notes].some(value => Array.isArray(value) && value.some(note => {
        const match = informationNote(note);
        return match ? groups.includes(match[1].trim()) : typeof note === "string" && groups.includes(note.trim());
    }));
}

function knownStatus(competition: LibraryCompetition, record: JsonObject, field: "fee", reviewed = false) {
    const status = record[`${field}Status`], text = typeof record[field] === "string" ? record[field] as string : "";
    const corrected = competition.supplements.some(supplement => supplement.corrections?.some(correction => correction.status === "effective" && correction.field === field
        && (correction.directionId === undefined ? record === competition : record.id === correction.directionId)));
    if (corrected || hasLocalDoubt(record, field) || (!reviewed && /待确认|待核|未明确|不明确|未知|未说明|未提及/.test(text))) return "unknown";
    if (reviewed) {
        // The reviewed semantic status is authoritative unless the same named step contains a direct contradiction.
        // Free preliminary stages, optional production and uncertain exact prices do not establish free participation.
        const steps = ["参赛", "报名", "提名", "评审", "注册", "投稿"], paid = new Set<string>(), free = new Set<string>();
        const chargeText = text.replace(/(?:免收|不收取|不收)(?:参赛|报名|提名|评审|注册|投稿)(?:费|费用)/g, "");
        for (const step of steps) {
            const joined = `${step}(?:[\\/、和及]+(?:${steps.join("|")}))*`;
            const amount = `(?:费|费用)\\s*(?:为|[:：]|人民币|￥|¥)?\\s*[1-9]\\d*`;
            if (new RegExp(`${joined}\\s*(?:${amount}|(?:作品|每件|每人|每项|每组|统一|一律)*(?:需|须|应|需要|应当)?(?:收费|缴费|付费)|(?:需|须|应|需要|应当)(?:缴纳|支付))|(?<!无需|无须|不必|不用|不需要|不)(?:缴纳|支付|收取)${step}(?:费|费用)`).test(chargeText)) paid.add(step);
            if (new RegExp(`${step}(?:费|费用)?\\s*(?:为|是|均|全程|一律|统一)?\\s*(?:免费|不收费|免收费|无需缴费)|(?:免收|不收取|不收)${step}(?:费|费用)`).test(text)) free.add(step);
        }
        if (status === "free" && paid.size) return "unknown";
        if (status === "paid" && ([...paid].some(step => free.has(step)) || (!paid.size && (["参赛", "报名", "提名", "投稿"].some(step => free.has(step))
            || /^\s*(?:本赛事|本次比赛|全程)?(?:免费|不收费|免收费)[。.]?\s*$/.test(text))))) return "unknown";
        return status === "free" || status === "paid" ? status : "unknown";
    }
    const charges = text.replace(/不收费|免收费|免收(?:报名|参赛|评审|注册)(?:费|费用)/g, "");
    if (status === "free" && /(?:报名|参赛|评审|注册)(?:费|费用)\s*(?:为|[:：]|人民币|￥|¥)?\s*[1-9]\d*|(?:须|需|应)缴(?:纳|费)|收费/.test(charges)) return "unknown";
    if (status === "paid" && /免费|免收(?:报名|参赛|评审|注册)费|不收费/.test(text)) return "unknown";
    return status === "free" || status === "paid" ? status : "unknown";
}

function scopeDeadline(competition: LibraryCompetition, scope: SearchScope, approved?: SixFieldEntry) {
    const fact = scopeFact(scope, "deadline"), field = approved?.fields.submissionDeadline;
    const reviewed = approved?.method === "reviewed_codex", row = reviewed ? reviewedScopeValue(approved, "submissionDeadline", scope) : undefined;
    const unresolved = competition.supplements.some(supplement => supplement.corrections?.some(correction => correction.field === "deadline"
        && correction.status === "conflict" && (correction.directionId === undefined || correction.directionId === scope.scopeId
            || scope.parents.some(parent => parent.scopeId === correction.directionId))));
    const doubt = unresolved || hasLocalDoubt(scope.record, "deadline") || hasLocalDoubt(fact.record, "deadline")
        || (reviewed ? row?.hasLocalDoubt === true : Boolean(field?.notes && /未知|待确认|待核|冲突|不明确|未明确|未确定/.test(field.notes)));
    const value = reviewed ? row?.value ?? null : field ? field.value : fact.record.deadline;
    return { value, summary: { scopeId: scope.scopeId, ...(reviewed ? { scopePointer: scope.pointer } : {}), sourceScopeId: reviewed ? scope.scopeId : fact.scopeId, date: doubt ? null : explicitDeadline(value), hasLocalDoubt: doubt,
        ...shortDescription(value, field ? "sixFields.submissionDeadline" : "deadline") } };
}

function scopeSummary(competition: LibraryCompetition, scope: SearchScope) {
    const record = scope.record, designTypes = Array.isArray(record.designTypes) ? record.designTypes.filter((value): value is string => typeof value === "string" && Boolean(value.trim())) : [];
    const descriptionField = ["description", "creativeContent", "themeTask"].find(field => typeof record[field] === "string" && (record[field] as string).trim());
    const works = entries(record.workItems).map(work => [work.name,
        work.role === "primary" ? "主体" : work.role === "supporting" ? "配套" : "角色待确认",
        work.requirement === "required" ? "必交" : work.requirement === "optional" ? "选交" : "提交关系待确认"].filter(value => typeof value === "string").join(" / ")).join("；");
    const fee = scopeFact(scope, "fee"), feeDoubt = hasLocalDoubt(record, "fee") || hasLocalDoubt(fee.record, "fee");
    return {
        submissionForms: { scopeId: scope.scopeId, scopeTitle: scope.scopeTitle, parentScopeId: scope.parentScopeId, categories: designTypes.length ? [...new Set(designTypes)] : null,
            ...shortDescription([works, descriptionField ? record[descriptionField] : null].filter(Boolean).join("；"),
                [works ? "workItems" : null, descriptionField].filter(Boolean).join("+") || null) },
        deadline: scopeDeadline(competition, scope).summary,
        fee: { scopeId: scope.scopeId, sourceScopeId: fee.scopeId, status: feeDoubt ? "unknown" : knownStatus(competition, fee.record, "fee"), hasLocalDoubt: feeDoubt, ...shortDescription(fee.record.fee, "fee") },
    };
}

function reviewedRowApplies(value: JsonObject, scope: SearchScope) {
    return Array.isArray(value.scopeIds) && value.scopeIds.some((id, index) => id === scope.scopeId
        && (!Array.isArray(value.scopePointers) || value.scopePointers[index] === scope.pointer));
}

function reviewedScopeValue(entry: SixFieldEntry, key: "feeStatus" | "submissionDeadline", scope: SearchScope) {
    return entries(entry.fields[key].value).find(value => reviewedRowApplies(value, scope));
}

function relationMetadata(relation: ResolvedTaskRelation) {
    return { id: relation.id, kind: relation.kind, status: relation.status, members: relation.members, canonicalKey: relation.canonicalKey,
        note: relation.note, reason: relation.reason, sourceUrls: relation.sourceUrls };
}

/** A read-time visibility rule: keep uncertain dates and competitions with any open/unknown submission scope. */
function competitionExpired(library: CompetitionLibrary, competition: LibraryCompetition, now: Date) {
    return searchScopes(competition).filter(scope => scope.leaf).every(scope => scopeExpired(library, competition, scope, now));
}

function scopeExpired(library: CompetitionLibrary, competition: LibraryCompetition, scope: SearchScope, now: Date) {
    const index = sixFieldIndexes.get(library)?.get(competition.libraryId);
    const approved = index?.status === "ready" && ["approved_deepseek", "reviewed_codex"].includes(index.entry?.method ?? "") ? index.entry : undefined;
        const view = taskScopeViews.get(library)?.get(taskRefKey({ libraryId: competition.libraryId, scopePointer: scope.pointer }));
        const { value, summary } = view ? { value: view.deadlineValue, summary: view.summary.deadline } : scopeDeadline(competition, scope, approved), day = summary.date;
        return savedDeadlineExpired(value, day, now);
}

function savedDeadlineExpired(value: unknown, day: string | null, now: Date) {
        if (!day || typeof value !== "string") return false;
        if (now.valueOf() >= Date.parse(`${day}T00:00:00+08:00`) + 86_400_000) return true;
        // Chinese library dates use Beijing time. Other/ambiguous time zones and clocks stay unknown.
        if (/上午|下午|晚上|中午|凌晨|(?:未|没有|尚未)(?:注明|说明|标明|标注)时区/.test(value)) return false;
        const clocks = [...beijingDeadlineText(value).matchAll(/(?<!\d)(\d{1,2})(?:[:：](\d{2})(?:[:：](\d{2}))?|时(?:(\d{1,2})分)?)(?!\d)/g)];
        if (clocks.length > 1) return false;
        if (!clocks.length) return false;
        const [, hour, minute = "00", second = "00", chineseMinute] = clocks[0];
        if (+hour > 23 || +(chineseMinute ?? minute) > 59 || +second > 59) return false;
        const cutoff = Date.parse(`${day}T${hour.padStart(2, "0")}:${(chineseMinute ?? minute).padStart(2, "0")}:${second}+08:00`);
        return now.valueOf() > cutoff;
}

function preparedTaskExpired(state: PreparedMaterialsRead, pointer: string, now: Date) {
    const row = preparedDeadline(state, pointer);
    return currentDeadlineExpired(row, now);
}

export async function searchCompetitionLibrary(repoRoot: string, query: string, options: CompetitionSearchOptions = {}) {
    if (typeof query !== "string") throw new Error("资料库查询必须是文本");
    validateSearchOptions(options);
    return searchCurrentMaterials(repoRoot, await readLibraryView(repoRoot), query, options);
}

async function searchCurrentMaterials(repoRoot: string, view: LibraryReadView, query: string, options: CompetitionSearchOptions, forAgent = true) {
    const selected = new Map<string, JsonObject>();
    for (const competition of [...view.library.items, ...view.library.pending]) {
        if (options.discoveryList && !wellKnownVisualEvent(competition.title)) continue;
        const result = await preparedResult(repoRoot, view, competition, options, query, forAgent);
        if (result) selected.set(competition.libraryId, result);
    }
    for (const ref of view.directoryReferences) {
        const parent = selected.get(ref.parentId);
        if (!parent || !entries(parent.submissionTasks).some(task => task.scopePointer === ref.scopePointer)) continue;
        const child = [...view.library.items, ...view.library.pending].find(c => c.libraryId === ref.competitionId)!;
        const result = await preparedResult(repoRoot, view, child, options, "", forAgent);
        if (result) selected.set(child.libraryId, result);
        // The directory row is replaced by the independently filtered current tasks, never by borrowed facts.
        parent.submissionTasks = entries(parent.submissionTasks).filter(task => task.scopePointer !== ref.scopePointer);
    }
    const raw = [...selected.values()].filter(row => entries(row.submissionTasks).length);
    const sort = options.sort ?? { field: "title", direction: "asc" }, multiplier = sort.direction === "desc" ? -1 : 1;
    raw.sort((a, b) => {
        const pending = Number((a.conditions as JsonObject).status === "unknown") - Number((b.conditions as JsonObject).status === "unknown");
        if (pending) return pending;
        if (sort.field === "deadline") {
            const date = (row: JsonObject) => { const dates = entries(row.deadline).map(rule => rule.date); return dates.length && dates.every(Boolean) && new Set(dates).size === 1 ? String(dates[0]) : null; };
            const left = date(a), right = date(b);
            if (left === null || right === null) { if (left !== right) return left === null ? 1 : -1; }
            else { const compared = left.localeCompare(right); if (compared) return compared * multiplier; }
        }
        return String(a.title).localeCompare(String(b.title), "zh-CN") * multiplier || String(a.libraryId).localeCompare(String(b.libraryId));
    });
    const unknownConditionCounts: Record<string, number> = Object.fromEntries(Object.keys(options.filters || {}).map(key => [key, 0]));
    for (const result of raw) for (const key of (result.conditions as { pending: string[] }).pending) unknownConditionCounts[key]++;
    const total = raw.length, offset = options.offset ?? 0, limit = options.limit ?? 20, results = raw.slice(offset, offset + limit);
    return { total, taskTotal: raw.reduce((n, row) => n + entries(row.submissionTasks).length, 0),
        matchedTotal: raw.filter(row => (row.conditions as JsonObject).status === "match").length,
        unknownTotal: raw.filter(row => (row.conditions as JsonObject).status === "unknown").length,
        confirmationPendingTotal: raw.filter(row => (row.confirmation as JsonObject).status === "needs_user_confirmation").length,
        unknownConditionCounts, pagination: { offset, limit, returned: results.length, hasMore: offset + results.length < total,
            nextOffset: offset + results.length < total && limit > 0 ? offset + results.length : null }, results };
}

function taskConditions(categories: string[] | null, fee: unknown, deadline: string | null, filters: NonNullable<CompetitionSearchOptions["filters"]>) {
    const conditions: Record<string, ConditionState> = {};
    if (filters.designTypes?.length) conditions.designTypes = categories?.some(category => filters.designTypes!.includes(category)) ? "match"
        : !categories || categories.some(category => ["未知", "其他", "综合视觉"].includes(category)) ? "unknown" : "mismatch";
    if (filters.feeStatus) conditions.feeStatus = fee !== "free" && fee !== "paid" ? "unknown" : fee === filters.feeStatus ? "match" : "mismatch";
    if (filters.deadlineFrom) conditions.deadlineFrom = !deadline ? "unknown" : deadline >= filters.deadlineFrom ? "match" : "mismatch";
    if (filters.deadlineTo) conditions.deadlineTo = !deadline ? "unknown" : deadline <= filters.deadlineTo ? "match" : "mismatch";
    const states = Object.values(conditions), status: ConditionState = states.includes("mismatch") ? "mismatch" : states.includes("unknown") ? "unknown" : "match";
    return { status, conditions };
}

function pendingMaterialResult(view: LibraryReadView, competition: LibraryCompetition, options: CompetitionSearchOptions, query: string) {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.every(term => String(competition.title || "").toLocaleLowerCase().includes(term))) return undefined;
    const condition = taskConditions(null, "unknown", null, options.filters || {}), pending = Object.keys(condition.conditions);
    const fields = options.fields ?? SEARCH_RESULT_FIELDS;
    const task: JsonObject = { taskId: competition.libraryId, scopeId: competition.libraryId, scopePointer: "", title: competition.title, ...condition };
    if (fields.includes("submissionForms")) task.submissionForms = { categories: null, factState: "unknown" };
    if (fields.includes("fee")) task.feeRule = 0;
    if (fields.includes("deadline")) task.deadlineRule = 0;
    return { libraryId: competition.libraryId, revision: competition.revision, sixFieldIndexHash: null,
        sourceVersion: competition.sourceVersion ?? null, title: competition.title, conditions: { status: condition.status, pending },
        confirmation: { status: "needs_user_confirmation", unverifiedConditions: pending.map(key => CANDIDATE_CONDITION_LABELS[key] || key) },
        submissionTasks: [task], ...(fields.includes("fee") ? { fee: [{ status: "unknown", factState: "unknown" }] } : {}),
        ...(fields.includes("deadline") ? { deadline: [{ date: null, factState: "unknown" }] } : {}) };
}

async function preparedResult(repoRoot: string, view: LibraryReadView, competition: LibraryCompetition, options: CompetitionSearchOptions, query: string, forAgent = true) {
    if (needsMaterialReview(view, competition)) return pendingMaterialResult(view, competition, options, query);
    const material = view.materials.get(competition.libraryId)!;
    if (material.status !== "ready" || !material.bundle) return undefined;
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length) {
        const text = [String(competition.title || ""), JSON.stringify(material.bundle.tasks)].join("\n").toLocaleLowerCase();
        if (!terms.every(term => text.includes(term))) return undefined;
    }
    const fields = options.fields ?? SEARCH_RESULT_FIELDS, fee: JsonObject[] = [], deadline: JsonObject[] = [], now = new Date();
    const tasks = material.bundle.tasks.flatMap(task => {
        if (forAgent && preparedTaskExpired(material, task.scopePointer, now)) return [];
        const facts = preparedFacts(material, task.scopePointer)!;
        const categories = Array.isArray(facts.submissionForms.categories) ? facts.submissionForms.categories.filter((value): value is string => typeof value === "string") : null;
        const condition = taskConditions(categories, facts.feeStatus.status, facts.submissionDeadline.date, options.filters || {});
        if (condition.status === "mismatch") return [];
        const row: JsonObject = { taskId: task.id, scopeId: task.id, scopePointer: task.scopePointer, title: task.title,
            ...condition };
        if (preparedLocalConflicts(material, task.scopePointer).some(conflict => conflict.kind === "task" || conflict.kind === "rule"))
            row.taskRelations = { status: "needs_user_confirmation", pending: ["任务要求或共同规则关联冲突待核"] };
        if (fields.includes("submissionForms")) row.submissionForms = { categories, factState: facts.submissionForms.status };
        if (fields.includes("fee")) { row.feeRule = fee.length; fee.push({ status: facts.feeStatus.status, factState: facts.feeStatus.factState }); }
        if (fields.includes("deadline")) { row.deadlineRule = deadline.length; deadline.push({ date: facts.submissionDeadline.date, factState: facts.submissionDeadline.status }); }
        return [row];
    });
    if (!tasks.length) return undefined;
    const status = tasks.some(task => task.status === "match") ? "match" : "unknown";
    const pending = status === "match" ? [] : [...new Set(tasks.flatMap(task => Object.entries(task.conditions as JsonObject)
        .filter(([, state]) => state === "unknown").map(([key]) => key)))];
    const followUp = basicFollowUp(await readFollowUpState(repoRoot, competition.libraryId)), relatedFollowUps = await linkedFollowUps(repoRoot, view.library, competition);
    const relations = taskRelationIndexes.get(view.library)?.relations.filter(relation => relation.members.some(member => member.libraryId === competition.libraryId)) || [];
    const unverified = [...new Set([...pending, ...(followUp?.unknownFields || []), ...relatedFollowUps.flatMap(state => state.followUp.unknownFields),
        ...(relations.length ? ["预整理任务与既有关联范围尚未映射"] : []),
        ...tasks.flatMap(task => object(task.taskRelations) && Array.isArray(task.taskRelations.pending) ? task.taskRelations.pending as string[] : [])])];
    const index = sixFieldIndexes.get(view.library)?.get(competition.libraryId);
    return { libraryId: competition.libraryId, revision: competition.revision, sixFieldIndexHash: index?.hash ?? null, sourceVersion: competition.sourceVersion ?? null,
        title: competition.title, materialStatus: "ready", conditions: { status, pending },
        confirmation: { status: unverified.length ? "needs_user_confirmation" : "matches_recorded_conditions", unverifiedConditions: unverified.map(key => CANDIDATE_CONDITION_LABELS[key] || key) },
        submissionTasks: tasks, ...(fields.includes("fee") ? { fee } : {}), ...(fields.includes("deadline") ? { deadline } : {}) };
}

export type TableSelection = { scopePointers: string[]; filters?: CompetitionSearchOptions["filters"]; revision: string; indexHash: string | null; sourceVersion: string | null;
    libraryRevision: string; versionToken: string; confirmation: unknown; sourceUrls: string[]; title: unknown; linkedSources: JsonObject[] };
const tableSelections = new WeakMap<object, Map<string, TableSelection>>();
const tableStates = new WeakMap<object, { libraryRevision: string; filters?: CompetitionSearchOptions["filters"]; selections: Map<string, TableSelection> }>();
export type TaskDirectorySelection = Omit<TableSelection, "confirmation" | "sourceUrls" | "title" | "linkedSources"> & { tasks: JsonObject[] };
const directorySelections = new WeakMap<object, TaskDirectorySelection>();
/** Full selection bindings never enter model-visible query JSON. */
export function getCompetitionTableSelection(table: object) { return tableSelections.get(table) || new Map<string, TableSelection>(); }
export function getCompetitionTableState(table: object) { return tableStates.get(table); }
export function getTaskDirectorySelection(directory: object) { return directorySelections.get(directory); }

/** Strict field-limited initial table; the original rich search remains an internal baseline. */
export async function queryCompetitionTable(repoRoot: string, query: string, options: CompetitionSearchOptions = {}, forAgent = true) {
    if (typeof query !== "string") throw new Error("资料库查询必须是文本");
    validateSearchOptions(options);
    const view = await readLibraryView(repoRoot), fields = options.fields ?? SEARCH_RESULT_FIELDS;
    const internalFields = [...new Set([...fields, "title" as const, ...(options.sort?.field === "deadline" ? ["deadline" as const] : [])])];
    const baseline = await searchCurrentMaterials(repoRoot, view, query, { ...options, fields: internalFields }, forAgent);
    const raw = baseline.results, pagination = baseline.pagination;
    const totals = { total: baseline.total, taskTotal: baseline.taskTotal, matchedTotal: baseline.matchedTotal,
        unknownTotal: baseline.unknownTotal, confirmationPendingTotal: baseline.confirmationPendingTotal, unknownConditionCounts: baseline.unknownConditionCounts };
    const selections = new Map<string, TableSelection>();
    const results = raw.map(row => {
        const competition = groups.flatMap(group => view.library[group]).find(item => item.libraryId === row.libraryId)!;
        const versionToken = viewToken(view, competition);
        const material = view.materials.get(competition.libraryId)!;
        const compact = { ...compactTableRow(row, fields, versionToken), materialStatus: preparedContentReady(material, entries(row.submissionTasks).map(task => task.scopePointer)) ? "ready" : "pending_preparation",
            ...material.status !== "missing" && material.status !== "ready" ? { preparationState: material.status } : {} };
        selections.set(competition.libraryId, { scopePointers: entries(row.submissionTasks).map(task => String(task.scopePointer)), filters: options.filters, revision: competition.revision,
            indexHash: typeof row.sixFieldIndexHash === "string" ? row.sixFieldIndexHash : null, sourceVersion: typeof row.sourceVersion === "string" ? row.sourceVersion : null,
            libraryRevision: view.revision, versionToken, confirmation: { ...(row.confirmation as JsonObject), ...(compact.confirmation as JsonObject) },
            sourceUrls: Array.isArray((row.confirmation as JsonObject)?.sourceUrls) ? (row.confirmation as { sourceUrls: string[] }).sourceUrls : [String(competition.sourceUrl)],
            title: competition.title, linkedSources: entries(row.submissionTasks).flatMap(task => entries(task.linkedSources)) });
        return compact;
    });
    const table = { ...packCompetitionTable(results, fields), ...totals, pagination,
        ...(options.discoveryList ? { discovery: { list: options.discoveryList,
            meaning: "仅常用知名赛事名单内的库内候选；非评分、排名或当前开放确认。母赛/专项、届次和任务仍各自保留；未命中不代表全库无赛事。" } } : {}) };
    tableSelections.set(table, selections);
    tableStates.set(table, { libraryRevision: view.revision, filters: options.filters, selections });
    return table;
}

export type TaskDirectoryOptions = { filters?: CompetitionSearchOptions["filters"]; fields?: CompetitionSearchOptions["fields"];
    scopePointers?: string[]; expectedVersionToken?: string };
export async function readLibraryTaskDirectory(repoRoot: string, competitionId: string, options: TaskDirectoryOptions = {}, forAgent = true) {
    return taskDirectoryFromView(repoRoot, await readLibraryView(repoRoot), competitionId, options, forAgent);
}

/** One immutable library view per answer projection, never shared across requests or used for creation. */
export async function openCandidatePreviewLibrary(repoRoot: string) {
    const view = await readLibraryView(repoRoot);
    return async (competitionId: string, options: TaskDirectoryOptions) => {
        const directory = await taskDirectoryFromView(repoRoot, view, competitionId, options, true);
        const competition = groups.flatMap(group => view.library[group]).find(row => row.libraryId === competitionId || row.id === competitionId)!;
        return { directory, competition, material: view.materials.get(competition.libraryId)! };
    };
}

async function taskDirectoryFromView(repoRoot: string, view: LibraryReadView, competitionId: string, options: TaskDirectoryOptions, forAgent: boolean) {
    if (!safeId(competitionId) || !object(options) || Object.keys(options).some(key => !["filters", "fields", "scopePointers", "expectedVersionToken"].includes(key))
        || (options.scopePointers !== undefined && (!Array.isArray(options.scopePointers) || options.scopePointers.some(pointer => typeof pointer !== "string")))
        || (options.expectedVersionToken !== undefined && !sha256(options.expectedVersionToken))) throw new Error("任务短目录参数无效");
    validateSearchOptions({ filters: options.filters, fields: options.fields });
    const competition = groups.flatMap(group => view.library[group]).find(row => row.libraryId === competitionId || row.id === competitionId);
    if (!competition) throw new Error("竞赛不存在");
    if (options.expectedVersionToken !== undefined && options.expectedVersionToken !== viewToken(view, competition)) throw new Error("资料版本已变化，请重新查询。");
    const fields = options.fields ?? SEARCH_RESULT_FIELDS, material = view.materials.get(competition.libraryId)!;
    if (forAgent && material.status === "ready" && material.bundle?.tasks.every(task => preparedTaskExpired(material, task.scopePointer, new Date()))) throw new Error("该竞赛所有已整理投稿任务均已明确截止。");
    const prepared = await preparedResult(repoRoot, view, competition, { filters: options.filters, fields: [...fields] }, "", forAgent);
    const index = sixFieldIndexes.get(view.library)?.get(competition.libraryId);
    const result: JsonObject = prepared || { submissionTasks: [] };
    const all = entries(result.submissionTasks), available = new Set(all.map(task => task.scopePointer));
    if (options.scopePointers?.some(pointer => !available.has(pointer))) throw new Error("任务白名单已不符合当前范围，请重新查询。");
    const tasks = all.filter(task => !options.scopePointers || options.scopePointers.includes(String(task.scopePointer))).map(task => compactDirectoryTask(result, task, fields));
    const directory = { ...packTaskDirectory(competition.libraryId, tasks, fields,
        preparedContentReady(material, tasks.map(task => task.scopePointer)) ? "ready" : "pending_preparation"),
        ...(material.status !== "missing" && material.status !== "ready" ? { preparationState: material.status } : {}),
        ...(needsMaterialReview(view, competition) ? { scopeCatalogStatus: "pending_preparation" } : {}) };
    directorySelections.set(directory, { scopePointers: tasks.map(task => String(task.scopePointer)), filters: options.filters,
        revision: competition.revision, indexHash: index?.hash ?? null, sourceVersion: typeof competition.sourceVersion === "string" ? competition.sourceVersion : null,
        libraryRevision: view.revision, versionToken: viewToken(view, competition), tasks });
    return directory;
}

export type TaskEvidenceOptions = LibraryTaskDetailOptions & { scopePointer: string; field?: string; evidenceRefs?: string[] };
export const TASK_EVIDENCE_FIELDS = ["submissionForms", "feeStatus", "submissionDeadline", "fee", "deadline", "themeTask", "creativeContent", "description",
    "requirements", "submissionFormat", "finalSubmissionFormat", "workItems", "bindingEvidence", "rules", "applicability", "unresolvedRules", "track"] as const;
/** Existing scoped fragments only. Missing mappings never cause a source-text fallback. */
export async function readLibraryTaskEvidence(repoRoot: string, competitionId: string, options: TaskEvidenceOptions, forAgent = true) {
    if (!object(options) || typeof options.scopePointer !== "string" || Object.keys(options).some(key => !["scopePointer", "field", "evidenceRefs", "expectedRevision", "expectedIndexHash", "expectedSourceVersion", "expectedVersionToken"].includes(key))
        || (options.field !== undefined && !(TASK_EVIDENCE_FIELDS as readonly string[]).includes(options.field))
        || (options.evidenceRefs !== undefined && (!Array.isArray(options.evidenceRefs) || options.evidenceRefs.some(ref => typeof ref !== "string")))) throw new Error(`任务证据参数无效。field只能使用：${TASK_EVIDENCE_FIELDS.join("、")}；具体引用可用evidenceRefs。`);
    const { field, evidenceRefs, ...selection } = options;
    const detail = await readLibraryTaskDetail(repoRoot, competitionId, selection, forAgent);
    const common = { format: "submission_task_evidence_v1", libraryId: detail.competition.libraryId, scopePointer: options.scopePointer,
        versionToken: detail.versionToken, libraryRevision: detail.libraryRevision };
    if (detail.status !== "selected_task") return { ...common, status: "pending_preparation", evidence: [], sourceFallback: false };
    const view = await readLibraryView(repoRoot), competition = groups.flatMap(group => view.library[group]).find(row => row.libraryId === detail.competition.libraryId)!;
    if (viewToken(view, competition) !== detail.versionToken) throw new Error("资料已变化，请重新读取当前任务后查证。");
    const material = view.materials.get(competition.libraryId)!, normalizedField = field === "fee" ? "feeStatus" : field === "deadline" ? "submissionDeadline" : field;
    if (material.status === "ready" && material.bundle) {
        const task = material.bundle.tasks.find(task => task.scopePointer === options.scopePointer)!;
        const conflicts = preparedLocalConflicts(material, task.scopePointer), conflictedRules = new Set(conflicts.filter(conflict => conflict.kind === "rule").map(conflict => conflict.id));
        const rules = material.bundle.rules.filter(rule => task.ruleRefs.includes(rule.id) || rule.appliesTo.length === 0 && rule.status !== "explicit");
        const rulesRequested = field === "rules" || field === "applicability" || field === "unresolvedRules";
        const trackRefs = scopedEvidenceRefs(task.track), taskRefs = scopedEvidenceRefs(task), ruleRefs = scopedEvidenceRefs(rules);
        const allowed = new Set([...taskRefs, ...ruleRefs, ...conflictEvidenceRefs(conflicts),
            ...BASIC_FIELD_KEYS.flatMap(key => material.bundle!.facts[key].filter(row => row.scopePointer === task.scopePointer).flatMap(row => row.evidenceRefs))]);
        const matching = field === "track" ? trackRefs : rulesRequested ? [...new Set([...rules.flatMap(rule => rule.evidenceRefs), ...conflictEvidenceRefs(conflicts.filter(conflict => conflict.kind === "rule"))])] : normalizedField && (BASIC_FIELD_KEYS as readonly string[]).includes(normalizedField)
            ? material.bundle.facts[normalizedField as typeof BASIC_FIELD_KEYS[number]].filter(row => row.scopePointer === task.scopePointer).flatMap(row => row.evidenceRefs)
            : [...new Set([...taskRefs, ...ruleRefs, ...conflictEvidenceRefs(conflicts)])];
        if (evidenceRefs?.some(ref => !allowed.has(ref) || (field && !matching.includes(ref)))) throw new Error("证据引用不属于本次任务或所问字段。");
        const requested = evidenceRefs ?? (field ? matching : []);
        const evidence = material.bundle.evidence.filter(item => requested.includes(item.id)).map(item => ({ ref: item.id, kind: "stored_source_fragment", ...item }));
        return { ...common, status: rulesRequested && rules.some(rule => rule.status !== "explicit" || !rule.appliesTo.includes(task.id) || conflictedRules.has(rule.id)) ? "pending_applicability"
            : evidence.length ? "available" : field || evidenceRefs ? "mapping_unknown" : "evidence_selection_required",
            ...(field || evidenceRefs ? { evidence } : { availableRefs: [...allowed] }),
            ...(rulesRequested ? { applicability: rules.map(rule => ({ ruleId: rule.id, status: conflictedRules.has(rule.id) ? "conflict" : rule.status,
                appliesToTask: rule.status === "explicit" && rule.appliesTo.includes(task.id) && !conflictedRules.has(rule.id) })) } : {}), sourceFallback: false };
    }
    return { ...common, status: "pending_preparation", evidence: [], sourceFallback: false };
}

async function verifyEvidence(repoRoot: string, evidence: SupplementInput["evidence"][number], context: SupplementContext) {
    context.signal?.throwIfAborted();
    if (!object(evidence) || !safeId(evidence.sourceId) || typeof evidence.quote !== "string" || !evidence.quote.trim()) throw new Error("补充资料必须提供来源 ID 和连续原文引用");
    const files = new ExperimentFiles(repoRoot);
    const source = JSON.parse((await files.read(`sources/${evidence.sourceId}/snapshot.json`)).toString("utf8"));
    if (!object(source) || source.id !== evidence.sourceId || source.kind !== "source" || source.status !== "read"
        || source.runId !== context.runId || source.sessionId !== context.sessionId || !sourceUrl(source.sourceUrl)
        || !sourceUrl(source.requestedUrl) || !sha256(source.sha256) || typeof source.mimeType !== "string"
        || typeof source.text !== "string" || !source.text.includes(evidence.quote)
        || typeof source.originalPath !== "string" || !new RegExp(`^sources/${evidence.sourceId}/original\\.[a-z0-9]+$`).test(source.originalPath)) throw new Error("来源未成功读取、引用不实或不属于本轮会话");
    if (isImageMaterial(source)) throw new Error("仅接受文字来源，图片及 OCR 转写不能用于新增补证");
    for (const url of [source.sourceUrl, source.requestedUrl]) {
        if (/(^|\.)(bing\.com|duckduckgo\.com|google\.[a-z.]+)$/.test(new URL(url).hostname) || source.purpose === "search") throw new Error("搜索结果不能作为竞赛事实证据");
    }
    const bytes = await files.read(source.originalPath);
    if (digest(bytes) !== source.sha256) throw new Error("来源原件哈希不一致，拒绝补充");
    if (source.origin === "library_resource") {
        if (!safeId(source.competitionId) || !Number.isSafeInteger(source.resourceIndex) || !sha256(source.sourceVersion)) throw new Error("库内来源关联无效");
        const { competition } = await readLibraryCompetition(repoRoot, source.competitionId);
        if (competition.sourceVersion !== source.sourceVersion) throw new Error("库内原图版本已变化，请重读");
        const resource = await readLibraryResource(repoRoot, source.competitionId, source.resourceIndex as number);
        const encoded = typeof resource.binary === "string" ? resource.binary.replace(/\s/g, "") : "";
        const original = Buffer.from(encoded, "base64");
        if (!encoded || original.toString("base64") !== encoded || resource.url !== source.sourceUrl || digest(original) !== source.sha256) throw new Error("库内原件、来源或图片哈希不一致");
    } else if (!Number.isInteger(source.httpStatus) || Number(source.httpStatus) < 200 || Number(source.httpStatus) >= 300) {
        throw new Error("来源 HTTP 状态未成功");
    }
    const verified = { sourceId: evidence.sourceId, quote: evidence.quote, url: source.sourceUrl, sha256: source.sha256, originalPath: source.originalPath };
    const parsed = await parseMaterial(bytes, source.sourceUrl, source.mimeType);
    if (parsed.status !== "read" || !parsed.text?.includes(evidence.quote)) throw new Error("引用未出现在来源原件正文中");
    return { ...verified, ...(parsed.formConditions ? { formConditions: parsed.formConditions } : {}) };
}

/** Task summaries remain separate from source records and cite continuous text from the version read this turn. */
export async function verifyCompetitionTaskEvidence(repoRoot: string, competition: LibraryCompetition, evidence: unknown, context: SupplementContext) {
    if (!Array.isArray(evidence) || !evidence.length) throw new Error("原文创作任务须提供来源网址和连续原文引用");
    const verified = [];
    for (const item of evidence) {
        context.signal?.throwIfAborted();
        if (!object(item) || !sourceUrl(item.url) || typeof item.quote !== "string" || !item.quote.trim()) throw new Error("创作任务来源或连续原文引用无效");
        if (item.sourceId !== undefined) {
            if (!safeId(item.sourceId)) throw new Error("创作任务来源 ID 无效");
            const source = await verifyEvidence(repoRoot, { sourceId: item.sourceId, quote: item.quote }, context);
            if (source.url !== item.url) throw new Error("创作任务引文网址与来源不符");
            verified.push(source);
            continue;
        }
        const { sourceSnapshot } = await readDetails(repoRoot, competition);
        let found = false;
        if (object(sourceSnapshot)) {
            for (const [resourceIndex, value] of (sourceSnapshot.resources as unknown[]).entries()) {
                if (!object(value) || value.url !== item.url || isImageMaterial(value) || typeof value.text !== "string" || !value.text.includes(item.quote)) continue;
                const resource = await readLibraryResource(repoRoot, competition.libraryId, resourceIndex);
                if (typeof resource.binary === "string" && resource.binary) {
                    const encoded = resource.binary.replace(/\s/g, ""), bytes = Buffer.from(encoded, "base64");
                    if (bytes.toString("base64") !== encoded) throw new Error("创作任务原件编码无效");
                    const mime = typeof resource.mimeType === "string" ? resource.mimeType : resource.kind === "html" ? "text/html" : resource.kind === "pdf" ? "application/pdf" : "";
                    const parsed = await parseMaterial(bytes, item.url, mime, typeof resource.contentType === "string" ? resource.contentType : "");
                    if (parsed.status !== "read" || !parsed.text?.includes(item.quote)) throw new Error("创作任务引文未出现在来源原件正文中");
                }
                verified.push({ url: item.url, quote: item.quote, sourceVersion: competition.sourceVersion, resourceIndex });
                found = true;
                break;
            }
        }
        if (!found) throw new Error("创作任务引用不在已读竞赛的文字原文中；新来源请提供本轮 sourceId");
    }
    context.signal?.throwIfAborted();
    if ((await readLibraryCompetition(repoRoot, competition.libraryId)).competition.revision !== competition.revision) throw new Error("竞赛资料版本已变化，请重读后再生成任务");
    return verified;
}

export async function saveCompetitionSupplement(_repoRoot: string, _competitionId: string, _input: SupplementInput, _context: SupplementContext): Promise<JsonObject> {
    throw new Error("旧补充记录入口已停用，请通过当前竞赛材料整理入口保存。");
}
