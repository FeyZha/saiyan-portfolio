import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { readLibraryCompetition, readLibraryTaskDetail, readLibraryTaskEvidence, readSixFieldEntry } from "./competition-library.js";
import { FollowUpBudget, followUpSummary, readFollowUpState } from "./follow-up-budget.js";
import { officialNavigationEntries, sameCompetitionEdition } from "./six-field-ingestion.js";
import { loadPreparedMaterialResources, readPreparedMaterials } from "./prepared-materials.js";
import { ExperimentFiles, artifactId, serializeArtifact } from "./tool-storage.js";
import { isImageMaterial, materialMime, parseMaterial } from "./tool-readers.js";
import type { NetworkDependencies } from "./tool-network.js";
import type { OfficialResearchField, OfficialResearchInput, OfficialResearchPage, OfficialResearchResult } from "./official-research-agent.js";

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue => !!value && typeof value === "object" && !Array.isArray(value);
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const stable = (value: unknown): string => JSON.stringify(value, (_key, item) => object(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const normalize = (value: string) => value.normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
const bindingKey = (value: unknown) => stable(object(value) ? Object.fromEntries(
    ["competitionId", "scopePointer", "revision", "indexHash", "sourceVersion", "versionToken"].map(key => [key, value[key]])) : null);
const fields: OfficialResearchField[] = ["fee", "deadline", "submissionForms", "requirements"];
const unknownValue = (value: unknown) => value === undefined || value === null || value === "" || value === "unknown"
    || value === "unclear" || Array.isArray(value) && !value.length
    || typeof value === "string" && /^(?:未知|待核|不详|未明确|未说明|未提及|暂无|官网未说明)[。\s]*$/.test(value);

export type OfficialVerificationInput = {
    competitionId: string; scopePointer: string; officialUrl?: string;
    questions: { field: OfficialResearchField; question: string }[];
    /** Only usable after the calling session has actually received the local field. */
    gapReason?: string;
};
export type OfficialVerificationContext = {
    runId: string; sessionId: string;
    expected: { revision: string; indexHash: string | null; sourceVersion: string | null; versionToken: string };
    officialUrls?: string[]; explicitFollowUp?: boolean; allowKnownGap?: boolean;
    officialVerificationAllowed?: boolean;
    network?: NetworkDependencies; signal?: AbortSignal;
    research?: (input: OfficialResearchInput, dependencies: { readPage: (url: string, signal?: AbortSignal) => Promise<OfficialResearchPage> }, signal?: AbortSignal) => Promise<OfficialResearchResult>;
};
export type OfficialVerificationResult = {
    status: "local_known" | "verified" | "unknown" | "conflict" | "official_url_required" | "stopped" | "in_progress" | "failed" | "cancelled";
    competitionId: string; scopePointer: string;
    findings: { field: OfficialResearchField; status: "known" | "unknown" | "conflict"; value: unknown;
        evidence?: { sourceId: string; url: string; quote: string }[]; provenance?: string; previousValue?: unknown }[];
    unknowns: string[]; reused?: boolean; record?: string; followUp?: unknown; note?: string;
    previousChecks?: { status: OfficialVerificationResult["status"]; officialUrl: string;
        questions: { field: OfficialResearchField; question: string }[]; attemptedUrls?: string[] }[];
};

function canonicalUrl(value: string) {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("官网链接必须是无登录信息的公开HTTP地址。");
    if (/(^|\.)(?:shejijingsai\.com|bing\.com|google\.[a-z.]+|duckduckgo\.com)$/.test(url.hostname)) throw new Error("聚合页或搜索页不是竞赛官网入口。");
    url.hash = ""; return url.href;
}

/** Presence lookup only. Adoption still passes the full integrity/version checks below. */
export async function hasStoredOfficialCheck(root: string, competitionId: string, scopePointer: string, fields: string[], expected: OfficialVerificationContext["expected"]) {
    artifactId(competitionId);
    const files = new ExperimentFiles(root), binding = { competitionId, scopePointer, ...expected };
    for (const file of await files.list(`official-checks/${competitionId}`)) {
        if (file.kind !== "file" || !/[a-f0-9]{64}\.json$/.test(file.path)) continue;
        const saved = JSON.parse((await files.read(file.path)).toString("utf8"));
        if (bindingKey(saved.binding) === bindingKey(binding) && saved.questions?.some((q: { field: string }) => fields.includes(q.field))) return true;
    }
    return false;
}

/** This registry is append-only Pi evidence, not a mutation or migration of the competition/index. */
export async function verifyCompetitionOfficial(root: string, input: OfficialVerificationInput, context: OfficialVerificationContext): Promise<OfficialVerificationResult> {
    context.signal?.throwIfAborted();
    artifactId(input.competitionId); artifactId(context.runId); artifactId(context.sessionId);
    if (typeof input.scopePointer !== "string" || !Array.isArray(input.questions) || !input.questions.length
        || input.questions.some(question => !object(question) || !fields.includes(question.field) || typeof question.question !== "string" || !question.question.trim()
            || /资格|学历限制|院校限制|年龄限制|个人或团队|AI使用规则|AI许可/.test(question.question))
        || new Set(input.questions.map(question => question.field)).size !== input.questions.length) throw new Error("官网核查仅接受本次任务的费用、截止、作品类型或创作要求，不恢复资格或AI规则分析。");
    const expected = context.expected;
    if (!expected || !/^[a-f0-9]{64}$/.test(expected.revision) || !/^[a-f0-9]{64}$/.test(expected.versionToken)) throw new Error("缺少当前任务版本，请重新查询。");
    const checkVersion = () => readLibraryTaskDetail(root, input.competitionId, { scopePointer: input.scopePointer,
        expectedRevision: expected.revision, expectedIndexHash: expected.indexHash, expectedSourceVersion: expected.sourceVersion,
        expectedVersionToken: expected.versionToken }, false);
    const detail = await checkVersion();
    const { competition } = await readLibraryCompetition(root, input.competitionId);
    const id = competition.libraryId;
    const files = new ExperimentFiles(root);
    const binding = { competitionId: id, scopePointer: input.scopePointer, revision: expected.revision, indexHash: expected.indexHash,
        sourceVersion: expected.sourceVersion, versionToken: expected.versionToken };
    let outdatedCheck = false;
    async function loadChecks() {
        const checks: { path: string; value: ObjectValue }[] = [];
        for (const file of await files.list(`official-checks/${id}`)) {
            if (file.kind !== "file" || !/[a-f0-9]{64}\.json$/.test(file.path)) continue;
            const saved: ObjectValue = JSON.parse((await files.read(file.path)).toString("utf8"));
            if (bindingKey(saved.binding) !== bindingKey(binding)) {
                if (object(saved.binding) && saved.binding.competitionId === id && saved.binding.scopePointer === input.scopePointer
                    && Array.isArray(saved.questions) && saved.questions.some(q => object(q) && input.questions.some(requested => requested.field === q.field))) outdatedCheck = true;
                continue;
            }
            if (saved.version !== 1 || file.path.split("/").at(-1) !== `${saved.fingerprint}.json`
                || !["running", "finished"].includes(String(saved.state)) || !Array.isArray(saved.questions)
                || saved.questions.some(question => !object(question) || !fields.includes(question.field as OfficialResearchField)
                    || typeof question.question !== "string")) throw new Error("已存官网核查记录无法验证，不能自动重开。");
            if (saved.state === "finished") {
                const { integrityHash, ...contents } = saved;
                if (integrityHash !== digest(stable(contents))) throw new Error("已存官网核查记录无法验证，不能用缺口为由自动重开。");
            }
            checks.push({ path: file.path, value: saved });
        }
        return checks.sort((a, b) => String(b.value.finishedAt || b.value.startedAt).localeCompare(String(a.value.finishedAt || a.value.startedAt)) || a.path.localeCompare(b.path));
    }
    let storedChecks = await loadChecks();
    const projectFollowUp = (value: unknown) => object(value) && Array.isArray(value.unknownFields)
        ? { ...value, unknownFields: value.unknownFields.filter(field => input.questions.some(question => question.field === field)) } : value;
    const result = (status: OfficialVerificationResult["status"], additions: Partial<OfficialVerificationResult> = {}): OfficialVerificationResult => ({
        status, competitionId: id, scopePointer: input.scopePointer, findings: [], unknowns: [], ...additions,
        ...(additions.followUp ? { followUp: projectFollowUp(additions.followUp) } : {}) });
    const material = await readPreparedMaterials(root, competition);
    const scoped = material.status === "ready" ? material.bundle?.tasks.find(t => t.scopePointer === input.scopePointer) : undefined;
    if ((detail.status !== "selected_task" || !("task" in detail)) && !scoped) return result("unknown", { unknowns: ["该条目没有确定的任务范围，不能将整篇原文交给子Agent重提取。"] });
    // A known task with missing creative content may be researched; creation remains blocked in the library API.
    const task = ("task" in detail ? detail.task : { title: scoped!.title, content: scoped, facts: {} }) as ObjectValue;
    const content = object(task.content) ? task.content : {};
    const track = object(content.track) && content.track.status === "known" && typeof content.track.title === "string" ? content.track.title : undefined;
    const uniqueTrack = track && material.bundle?.tasks.filter(t => object(t.track) && t.track.title === track).length === 1 ? track : undefined;
    // Use only a source-bound track name that identifies exactly one stored task, never strip titles heuristically.
    const scopeNames = [String(task.title), ...(uniqueTrack ? [uniqueTrack] : [])];
    const taskFacts = object(task.facts) ? task.facts : {};
    const feeProof = input.questions.some(q => q.field === "fee") ? await readLibraryTaskEvidence(root, id, {
        scopePointer: input.scopePointer, field: "fee", expectedRevision: expected.revision, expectedIndexHash: expected.indexHash,
        expectedSourceVersion: expected.sourceVersion, expectedVersionToken: expected.versionToken }, false) : undefined;
    const target = input.scopePointer ? input.scopePointer.slice(1).split("/").reduce<unknown>((value, part) => object(value) || Array.isArray(value)
        ? (value as ObjectValue)[part.replace(/~1/g, "/").replace(/~0/g, "~")] : undefined, competition) : competition;
    const index = await readSixFieldEntry(root, competition);
    const indexedKey = { fee: "feeStatus", deadline: "submissionDeadline", submissionForms: "submissionForms" } as const;
    function localValue(field: OfficialResearchField): unknown {
        if (field === "requirements") {
            if (task.requirementStatus === "conflict") return null;
            const requirements = content.requirements;
            if (object(requirements) && !["unknown", "conflict"].includes(String(requirements.status))
                && !unknownValue(requirements.creativeContent) && !unknownValue(requirements.submission)) return requirements;
            return null;
        }
        const currentFact = taskFacts[indexedKey[field]];
        if (object(currentFact) && (["unknown", "conflict", "unclear"].includes(String(currentFact.status)) || currentFact.factState === "conflict")) return null;
        if (field === "fee" && feeProof && "evidence" in feeProof && feeProof.evidence?.length) return [...new Set(feeProof.evidence.map(e => e.quote))].join("\n\n");
        // Task detail has already resolved exact-scope provenance, effective corrections and conflicts.
        // The search index is deliberately brief and cannot replace this complete stored fee.
        if (field === "fee" && object(currentFact) && !unknownValue(currentFact.value)) return currentFact.value;
        if (field === "deadline" && object(currentFact) && typeof currentFact.date === "string") return currentFact.date;
        // Read actual stored values, not the short query status. A paid flag alone does not say an amount is absent.
        if (index.status === "ready") {
            const value = index.entry!.fields[indexedKey[field]].value;
            if (Array.isArray(value)) {
                const rows = value.filter(row => object(row) && (Array.isArray(row.scopePointers) ? row.scopePointers.includes(input.scopePointer) : input.scopePointer === ""));
                const known = rows.filter(row => object(row) && !unknownValue(row.value) && row.status !== "unknown" && row.status !== "conflict");
                if (known.length) return known.length === 1 ? (known[0] as ObjectValue).value : known.map(row => (row as ObjectValue).value);
            } else if (!unknownValue(value) && input.scopePointer === "") return value;
        }
        if (object(target)) {
            const raw = field === "submissionForms" ? target.designTypes ?? target.creationCategory ?? target.categories : target[field];
            if (!unknownValue(raw)) return raw;
        }
        const fact = taskFacts[indexedKey[field]];
        if (field === "submissionForms" && object(fact) && !unknownValue(fact.categories)) return fact.categories;
        if (object(fact) && ["known", "free", "paid"].includes(String(fact.status)) && !unknownValue(fact.value)) return fact.value;
        return null;
    }
    const local = input.questions.map(question => ({ field: question.field, value: localValue(question.field) }));
    const known = local.filter(item => !unknownValue(item.value));
    const existingConflicts = new Set(input.questions.filter(question => question.field === "requirements" ? task.requirementStatus === "conflict"
        : object(taskFacts[indexedKey[question.field]]) && [(taskFacts[indexedKey[question.field]] as ObjectValue).status,
            (taskFacts[indexedKey[question.field]] as ObjectValue).factState].includes("conflict")).map(question => question.field));
    const knownGap = !!input.gapReason?.trim() && context.allowKnownGap === true;
    const hasPreviousCheck = storedChecks.some(({ value }) => (value.questions as { field: OfficialResearchField }[])
        .some(question => input.questions.some(requested => requested.field === question.field)));
    if (known.length === input.questions.length && !knownGap && !hasPreviousCheck) return result("local_known", {
        findings: known.map(item => ({ ...item, status: "known", provenance: "stored_field_not_new_official_verification" })),
        note: "这是库内已存完整字段，本次简表未返回不等于资料缺失。先用这些值回答；若读后仍有具体缺口，说明缺口再核查。" });
    if (outdatedCheck && !hasPreviousCheck && !context.explicitFollowUp) return result("stopped", {
        unknowns: ["此前官网核查对应的资料版本已变化，旧依据不再适用。只有用户明确要求继续核查，才新开一轮。"] });
    const questions = knownGap || hasPreviousCheck ? input.questions : input.questions.filter(question => !known.some(item => item.field === question.field));
    let entries: { url: string }[] = [];
    // Local raw reads are allowed; only the explicitly identified URL is forwarded, never this text.
    try { entries = officialNavigationEntries(await loadPreparedMaterialResources(root, competition)); }
    catch (error) { if (!String(error).includes("快照")) throw error; }
    const trusted: string[] = [];
    for (const entry of [...entries.map(entry => entry.url), ...(context.officialUrls || []), ...storedChecks.map(({ value }) => value.officialUrl).filter((value): value is string => typeof value === "string")]) {
        try { trusted.push(canonicalUrl(entry)); } catch { /* A third-party/user link is not silently turned into official authority. */ }
    }
    let officialUrl: string;
    try { officialUrl = canonicalUrl(input.officialUrl || trusted[0] || ""); }
    catch { return result("official_url_required", { unknowns: ["没有可核对的竞赛官网入口，请用户提供官网链接；不把聚合来源当官网。"] }); }
    if (!trusted.some(url => new URL(url).origin === new URL(officialUrl).origin)) return result("official_url_required", {
        unknowns: ["该链接尚未由库内官网声明或当前用户提供的官网入口支持，不能仅凭工具参数认定官方归属。"] });
    const research = context.research;
    const fingerprint = digest(stable({ binding, officialUrl, questions, gapReason: knownGap ? input.gapReason : null,
        authorizedRound: context.explicitFollowUp ? context.runId : null }));
    const record = `official-checks/${id}/${fingerprint}.json`, recordPath = await files.resolve(record, true);
    const origin = new URL(officialUrl).origin;
    const approvedOrigins = new Set([origin]);
    const sameWebsite = (value: string, websiteEntry = officialUrl) => {
        const entry = new URL(websiteEntry), url = new URL(value);
        return url.origin === entry.origin || url.protocol === entry.protocol && url.port === entry.port
            && url.hostname.replace(/^www\./, "") === entry.hostname.replace(/^www\./, "");
    };
    const safeError = (error: unknown) => String(error instanceof Error ? error.message : error).replace(/Bearer\s+\S+|\bsk-[A-Za-z0-9_-]+/gi, "[REDACTED]");
    const verifySource = async (sourceId: string, quote: string, requireIdentity = true, websiteEntry = officialUrl) => {
        artifactId(sourceId);
        const source = JSON.parse((await files.read(`sources/${sourceId}/snapshot.json`)).toString("utf8"));
        if (!object(source) || source.id !== sourceId || source.status !== "read" || source.origin !== "official_check"
            || !Number.isInteger(source.httpStatus) || Number(source.httpStatus) < 200 || Number(source.httpStatus) >= 300
            || bindingKey(source.binding) !== bindingKey(binding) || source.websiteEntry !== websiteEntry || typeof source.sourceUrl !== "string" || !sameWebsite(source.sourceUrl, websiteEntry)
            || typeof source.text !== "string" || !quote.trim() || !source.text.includes(quote)
            || typeof source.originalPath !== "string" || !new RegExp(`^sources/${sourceId}/original\\.[a-z0-9]+$`).test(source.originalPath)
            || (requireIdentity && !sameCompetitionEdition(competition, source.text, String(source.title)))) throw new Error("官网证据的来源、同名同届、范围或连续原文不符。");
        const bytes = await files.read(source.originalPath);
        if (digest(bytes) !== source.sha256) throw new Error("官网证据原件哈希不一致。");
        const parsed = await parseMaterial(bytes, source.sourceUrl, String(source.mimeType));
        if (parsed.status !== "read" || !parsed.text?.includes(quote)) throw new Error("引文不在保存的官网原件中。");
        const parsedTitle = parsed.title || parsed.text.split(/\r?\n/u).find(line => line.trim()) || source.sourceUrl;
        if (source.text !== parsed.text || source.title !== parsedTitle
            || requireIdentity && !sameCompetitionEdition(competition, parsed.text, parsedTitle)) throw new Error("官网快照与原件的身份或正文不一致。");
        return { sourceId, url: source.sourceUrl, quote };
    };
    async function checkedResult(saved: ObjectValue): Promise<OfficialVerificationResult> {
        const { integrityHash, ...contents } = saved;
        if (integrityHash !== digest(stable(contents)) || !object(saved.result) || !Array.isArray(saved.result.findings)) throw new Error("核查结果记录损坏，不能自动复用或重开。");
        const websiteEntry = canonicalUrl(String(saved.officialUrl));
        if (new URL(websiteEntry).origin !== origin) throw new Error("已存核查不属于本次官网入口，请重新查询。");
        for (const finding of saved.result.findings) {
            if (!object(finding)) throw new Error("核查结论结构损坏。");
            if (Array.isArray(finding.evidence)) for (const evidence of finding.evidence) await verifySource(evidence.sourceId, evidence.quote, true, websiteEntry);
            if (input.scopePointer && finding.status === "known" && finding.provenance === "official_page_identity_and_quote_checked") {
                const proof = Array.isArray(finding.evidence) && finding.evidence[Number(finding.applicabilityEvidence)];
                if (!Number.isInteger(finding.applicabilityEvidence) || !object(proof) || typeof proof.quote !== "string"
                    || !scopeNames.some(name => normalize(String(proof.quote)).includes(normalize(name)))) throw new Error("核查任务适用依据丢失或无法验证，请重新核查资料状态。");
            }
        }
        await checkVersion();
        return saved.result as OfficialVerificationResult;
    }
    async function previousCheck(saved: ObjectValue, status: OfficialVerificationResult["status"]) {
        const rounds = typeof saved.round === "string" ? [saved.round]
            : [`official-${saved.runId}`, "official-query"];
        let attemptedUrls: string[] | undefined;
        for (const round of rounds) {
            const state = await readFollowUpState(root, id, round);
            if (state) { attemptedUrls = state.visitedUrls; break; }
        }
        return { status, officialUrl: String(saved.officialUrl),
            questions: (saved.questions as { field: OfficialResearchField; question: string }[])
                .filter(question => input.questions.some(requested => requested.field === question.field)),
            ...(attemptedUrls ? { attemptedUrls } : {}) };
    }
    // Different phrasings for the same scope share the local lock; reload after waiting.
    const scopeLock = await files.resolve(`official-checks/${id}/scope-${digest(stable({ binding, origin }))}.lock`, true);
    return serializeArtifact(scopeLock, async () => {
        await checkVersion(); context.signal?.throwIfAborted();
        storedChecks = await loadChecks();
        let savedExists = false;
        try {
            const bytes = await files.read(record); savedExists = true;
            const saved = JSON.parse(bytes.toString("utf8"));
            if (saved.version !== 1 || bindingKey(saved.binding) !== bindingKey(binding) || saved.fingerprint !== fingerprint) throw new Error("核查记录损坏或版本无法验证，不能自动重开。");
            if (saved.state === "running") return result("in_progress", { record, reused: true,
                previousChecks: [await previousCheck(saved, "in_progress")], unknowns: ["同版本核查已有未完成或结果不确定的记录，不自动重复调用子Agent。"] });
            const checked = await checkedResult(saved);
            const findings = checked.findings.filter(finding => input.questions.some(question => question.field === finding.field));
            return { ...checked, ...(checked.followUp ? { followUp: projectFollowUp(checked.followUp) } : {}),
                findings: [...known.filter(item => !findings.some(finding => finding.field === item.field))
                .map(item => ({ ...item, status: "known" as const, provenance: "existing_stored_field" })), ...findings],
                reused: true, record, previousChecks: [await previousCheck(saved, checked.status)] };
        } catch (error) { if (savedExists || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        // A differently worded question can first read prior same-field evidence.
        // local_known supplies material to the main Agent, not proof that every new subquestion is answered.
        const prior = new Map<OfficialResearchField, OfficialVerificationResult["findings"][number]>();
        const previousChecks: NonNullable<OfficialVerificationResult["previousChecks"]> = [];
        const incomplete = new Map<OfficialResearchField, { saved: ObjectValue; candidate: OfficialVerificationResult }>();
        for (const file of storedChecks) {
            if (file.path === record) continue;
            const saved = file.value;
            if (new URL(canonicalUrl(String(saved.officialUrl))).origin !== origin) continue;
            if (!(saved.questions as { field: OfficialResearchField }[]).some(question => questions.some(requested => requested.field === question.field))) continue;
            if (saved.state === "running") return result("in_progress", { reused: true, record: file.path,
                previousChecks: [await previousCheck(saved, "in_progress")],
                unknowns: ["本任务同字段已有未完成或结果不确定的核查，换问法或换会话不自动重开。"] });
            const candidate = await checkedResult(saved);
            previousChecks.push(await previousCheck(saved, candidate.status));
            for (const question of saved.questions as { field: OfficialResearchField }[]) {
                if (questions.some(requested => requested.field === question.field) && !incomplete.has(question.field)) incomplete.set(question.field, { saved, candidate });
            }
            for (const finding of candidate.findings) {
                if (!questions.some(question => question.field === finding.field) || !["known", "conflict"].includes(finding.status)) continue;
                const previous = prior.get(finding.field);
                if (previous && stable(previous.value) !== stable(finding.value)) prior.set(finding.field, { field: finding.field, status: "conflict", value: null,
                    previousValue: previous.value, evidence: [...(previous.evidence || []), ...(finding.evidence || [])], provenance: "stored_official_evidence_conflict" });
                else if (!previous || previous.status !== "conflict") prior.set(finding.field, finding);
            }
        }
        if ((prior.size || incomplete.size) && !context.explicitFollowUp) {
            const missing = questions.filter(question => !prior.has(question.field));
            const latest = missing.map(question => incomplete.get(question.field)).find(item => item !== undefined);
            const status = [...prior.values()].some(item => item.status === "conflict") ? "conflict" : prior.size ? "local_known"
                : latest && ["failed", "cancelled", "stopped"].includes(latest.candidate.status) ? latest.candidate.status : "unknown";
            const savedUnknowns = latest && (latest.saved.questions as { field: OfficialResearchField }[]).every(question => input.questions.some(requested => requested.field === question.field))
                ? latest.candidate.unknowns : [];
            return result(status, {
                findings: [...known.filter(item => !prior.has(item.field)).map(item => ({ ...item, status: "known" as const, provenance: "existing_stored_field" })), ...prior.values()],
                reused: true, previousChecks, ...(latest?.candidate.followUp ? { followUp: latest.candidate.followUp } : {}),
                unknowns: [...savedUnknowns, ...questions.filter(question => !prior.has(question.field) || prior.get(question.field)?.status === "conflict")
                    .map(question => `${question.field}尚未查明或现有依据有冲突，需用户最终核验。`)],
                note: "复用同版本已有依据及核查状态，previousChecks保留原问题和已查入口；换问法不代表新问题已解决，也不自动再查。仍有缺口须如实交代，只有当前用户明确继续核查才另开一轮。" });
        }
        for (const [field, finding] of prior) if (finding.status === "known" && !known.some(item => item.field === field)) known.push({ field, value: finding.value });
        if (context.officialVerificationAllowed === false) return result("unknown", { unknowns: ["当前用户要求不联网，仅复用已存资料；没有触发官网或子Agent请求。"] });
        if (!research) return result("unknown", { unknowns: ["官网核查子Agent尚未接入，未触发网络或模型。"] });
        const budget = await FollowUpBudget.open(root, id, context.explicitFollowUp ? `official-${context.runId}` : "official-query");
        if (budget.state.stopReason || budget.exhausted) return result("stopped", { followUp: followUpSummary(budget.state), unknowns: ["本场官网核查已停止，普通追问或换会话不重置额度；仍缺的信息交用户确认。"] });
        const claim = { version: 1, fingerprint, binding, state: "running", officialUrl, questions, round: budget.round,
            runId: context.runId, sessionId: context.sessionId, startedAt: new Date().toISOString() };
        try {
            const handle = await fs.open(recordPath, "wx", 0o600);
            try { await handle.writeFile(JSON.stringify(claim)); await handle.sync(); } finally { await handle.close(); }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "EEXIST") return result("in_progress", { record, unknowns: ["同一核查已由其他进程占位，不重复发送。"] });
            throw error;
        }
        const pages = new Map<string, OfficialResearchPage>();
        let output: OfficialVerificationResult;
        try {
            await budget.rememberUnknown(questions.map(question => question.field));
            const readPage = async (value: string, signal = context.signal): Promise<OfficialResearchPage> => {
                signal?.throwIfAborted(); context.signal?.throwIfAborted();
                const url = canonicalUrl(value);
                if (!approvedOrigins.has(new URL(url).origin)) throw new Error("只能读取给定竞赛官网及其明确链接的同站地址。");
                const cached = pages.get(url); if (cached) return cached;
                if (budget.state.stopReason || budget.exhausted) throw Object.assign(new Error("官网核查读取额度已停止，保留缺口并交用户确认。"), { code: "OFFICIAL_BUDGET_STOPPED" });
                if (isImageMaterial({ url })) throw new Error("官网核查不读图片、二维码或OCR。");
                const fetched = await budget.read(url, signal, { ...context.network, beforeRequest: async targetUrl => {
                    await context.network?.beforeRequest?.(targetUrl);
                    if (!approvedOrigins.has(new URL(targetUrl).origin)) throw new Error("官网读取发生跨站重定向，已停止，不把第三方当官网。");
                } }).catch(async error => {
                    const current = await readFollowUpState(root, id, budget.round);
                    if (current) budget.state = current;
                    if (budget.state.stopReason || budget.exhausted) throw Object.assign(error instanceof Error ? error : new Error(String(error)), { code: "OFFICIAL_BUDGET_STOPPED" });
                    throw error;
                });
                signal?.throwIfAborted();
                if (!fetched.ok) throw new Error(`官网返回HTTP ${fetched.status}，保留未知。`);
                const mimeType = materialMime(fetched.url, fetched.mimeType);
                const parsed = await parseMaterial(fetched.bytes, fetched.url, mimeType, fetched.contentType);
                if (!["read", "no_text"].includes(parsed.status) || isImageMaterial({ mimeType })) throw new Error("官网材料不是可读取的文字页面。");
                // Preserve even an empty shell. Navigation is usable, but it is not factual evidence.
                const pageText = parsed.text || "";
                const sourceId = randomUUID(), suffix = mimeType === "application/pdf" ? "pdf" : mimeType.includes("wordprocessingml") ? "docx" : mimeType.includes("html") ? "html" : "txt";
                const originalPath = `sources/${sourceId}/original.${suffix}`;
                await files.write(originalPath, fetched.bytes);
                const title = parsed.title || pageText.split(/\r?\n/u).find(line => line.trim()) || fetched.url;
                await files.json(`sources/${sourceId}/snapshot.json`, { id: sourceId, kind: "source", origin: "official_check", binding,
                    websiteEntry: officialUrl,
                    runId: context.runId, sessionId: context.sessionId, requestedUrl: url, sourceUrl: fetched.url,
                    httpStatus: fetched.status, mimeType, originalPath, sha256: digest(fetched.bytes), status: parsed.status, title, text: pageText,
                    readAt: new Date().toISOString() });
                const page: OfficialResearchPage = { sourceId, url: fetched.url, title, text: pageText, links: parsed.links || [],
                    ...(parsed.status === "no_text" ? { availability: parsed.links?.length ? "navigation_only" as const : "dynamic_page_unavailable" as const } : {}) };
                // Only an explicit apex/www link may extend the website origin; no arbitrary subdomains.
                for (const link of page.links) {
                    try {
                        const from = new URL(page.url), to = new URL(link.url);
                        if (from.protocol === to.protocol && from.port === to.port && from.hostname.replace(/^www\./, "") === to.hostname.replace(/^www\./, "")) approvedOrigins.add(to.origin);
                    } catch { /* Invalid links are not repaired. */ }
                }
                pages.set(url, page); pages.set(page.url, page); return page;
            };
            const proposed = await research({ competition: { id, title: String(competition.title) }, scope: { pointer: input.scopePointer, title: uniqueTrack || String(task.title || competition.title) },
                officialUrl, questions, knownFacts: known }, { readPage }, context.signal);
            context.signal?.throwIfAborted();
            await checkVersion();
            if (!proposed || !Array.isArray(proposed.findings) || !Array.isArray(proposed.unknowns)) throw new Error("子Agent输出结构不完整，不自动重试。");
            if (["failed", "cancelled"].includes(proposed.status)) throw Object.assign(new Error("官网核查未完成，保留未知，不自动再次发送。"),
                proposed.status === "cancelled" ? { name: "AbortError" } : {});
            const findings: OfficialVerificationResult["findings"] = [];
            for (const finding of proposed.findings) {
                if (!questions.some(question => question.field === finding.field) || findings.some(item => item.field === finding.field)
                    || !["known", "unknown", "conflict"].includes(finding.status)) throw new Error("子Agent返回了未请求字段或重复字段。");
                if (finding.status === "unknown" || unknownValue(finding.value)) continue;
                if (typeof finding.value !== "string" || !Array.isArray(finding.evidence) || !finding.evidence.length) throw new Error("确定结论缺少连续文字依据。");
                const evidence = await Promise.all(finding.evidence.map(item => verifySource(item.sourceId, item.quote)));
                let applicabilityEvidence: number | undefined;
                if (input.scopePointer) {
                    const proof = finding.scopeQuote;
                    if (!proof || !scopeNames.some(name => normalize(proof.quote).includes(normalize(name)))) {
                        findings.push({ field: finding.field, status: "unknown", value: null, evidence, provenance: "task_applicability_unconfirmed" }); continue;
                    }
                    const verified = await verifySource(proof.sourceId, proof.quote);
                    applicabilityEvidence = evidence.findIndex(item => item.sourceId === verified.sourceId && item.quote === verified.quote);
                    if (applicabilityEvidence < 0) { applicabilityEvidence = evidence.length; evidence.push(verified); }
                }
                const previous = known.find(item => item.field === finding.field);
                const conflict = finding.status === "conflict" || existingConflicts.has(finding.field) || previous && normalize(stable(previous.value)) !== normalize(finding.value);
                // Keep verifiable original text, never adopt the worker's unverified paraphrase or number.
                findings.push({ field: finding.field, status: conflict ? "conflict" : "known", value: conflict ? null : evidence.map(e => e.quote).join("\n\n"),
                    ...(conflict ? { previousValue: previous?.value } : {}), ...(applicabilityEvidence !== undefined ? { applicabilityEvidence } : {}), evidence, provenance: "official_page_identity_and_quote_checked" });
            }
            const missing = questions.filter(question => !findings.some(item => item.field === question.field && item.status === "known"));
            output = result(findings.some(item => item.status === "conflict") ? "conflict" : missing.length ? "unknown" : "verified", {
                findings: [...known.filter(item => !findings.some(finding => finding.field === item.field)).map(item => ({ ...item, status: "known" as const, provenance: "existing_stored_field" })), ...findings],
                unknowns: [...proposed.unknowns.filter((value): value is string => typeof value === "string"), ...missing.map(question => `${question.field}：官网尚未提供可确认且适用于本任务的依据。`)], record,
                note: "仅核查当前缺口；新增依据单独留档，不覆盖旧事实、不改变正式索引。来源与引文校验不等于真实语义准确率已验证。" });
            await budget.finish(output.status === "verified" ? "evidence_sufficient" : "entries_exhausted");
        } catch (error) {
            const cancelled = context.signal?.aborted || error instanceof Error && error.name === "AbortError";
            await budget.finish(cancelled ? "cancelled" : "processing_failed");
            output = result(cancelled ? "cancelled" : "failed", { record, unknowns: [safeError(error)], note: "状态和已读资料已保留，不自动再次发送或重新查全文。" });
        }
        output.followUp = projectFollowUp(followUpSummary(budget.state));
        const finished = { ...claim, state: "finished", result: output, finishedAt: new Date().toISOString() };
        await files.json(record, { ...finished, integrityHash: digest(stable(finished)) });
        return output;
    });
}
