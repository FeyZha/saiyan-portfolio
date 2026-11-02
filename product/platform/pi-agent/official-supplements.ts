import { createHash } from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";
import { ExperimentFiles, serializeArtifact } from "./tool-storage.js";
import { calendarDeadline, currentCreativeContent } from "./current-contract.js";
import { designDirections } from "./six-field-index.js";
import { submissionChoiceIssues } from "./submission-choices.js";
import type { PreparedMaterialsBundle, PreparedFact } from "./prepared-materials.js";
import type { OfficialVerificationResult } from "./official-verification.js";
import { publishCompetitionCards } from "./competition-card-intake.js";

const hash = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
const stable = (v: unknown): string => JSON.stringify(v, (_k, x) => x && typeof x === "object" && !Array.isArray(x)
    ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);
class SupplementFiles extends ExperimentFiles { override readonly base: string;
    constructor(root: string) { super(root); this.base = path.resolve(root, "workspace/competition-sources"); } }
type Finding = OfficialVerificationResult["findings"][number];
type Entry = { version: 1; baseHash: string; competitionId: string; scope: string; field: Finding["field"];
    fact: Record<string, any>; evidence: { sourceId: string; url: string; quote: string; snapshotHash: string }[] };
const factKey = { deadline: "submissionDeadline", fee: "feeStatus", submissionForms: "submissionForms" } as const;

/** Date selection uses explicit submission/regular-period wording, never the latest number on a page. */
export function officialDeadline(quotes: string[]) {
    const periods = quotes.flatMap(q => q.split(/[\r\n；;]+/)).filter(q => !/(?:评审|评选|公示|颁奖|报名)(?:期|时间|截止|截至)/.test(q));
    const regular = periods.filter(q => /常规(?:参赛|投稿|征集|征稿)?期|正式征集期|最终(?:投稿|提交|征集)?截止/.test(q));
    const selected = regular.length ? regular : periods.filter(q => /截止|截至|征集(?:时间|期)|征稿(?:时间|期)|投稿(?:时间|期)|作品提交时间/.test(q));
    const values = selected.flatMap(q => {
        const range = q.match(/(\d{4}[年\-/]\d{1,2}[月\-/]\d{1,2}日?)\s*(?:至|到|—|~|～)\s*(\d{4}[年\-/]\d{1,2}[月\-/]\d{1,2}日?)/);
        const date = calendarDeadline(range ? range[2] : q);
        if (!date) return [];
        const dateText = range?.[2] || q.match(/\d{4}[年\-/]\d{1,2}[月\-/]\d{1,2}日?/)?.[0];
        const suffix = dateText ? q.slice(q.indexOf(dateText) + dateText.length) : "";
        const endOfDay = /^\s*24(?:时|:00|：00)/.test(suffix);
        const time = suffix.match(/^\s*([01]?\d|2[0-3])[:：时]([0-5]\d)?/);
        return [{ date, time: time ? `${time[1].padStart(2, "0")}:${time[2] || "00"}` : null,
            timeZone: /北京时间/.test(q) ? "Asia/Shanghai" : null, endOfDay }];
    });
    return values.length && new Set(values.map(v => stable(v))).size === 1 ? values[0] : undefined;
}
function derive(finding: Finding) {
    const quotes = (finding.evidence || []).map(e => e.quote);
    if (finding.field === "deadline") {
        const d = officialDeadline(quotes); return d ? { status: "known", value: d.date, ...d } : undefined;
    }
    if (finding.field === "fee") {
        const relevant = quotes.filter(q => /费用|报名费|参赛费|收费|免费|[0-9一二三四五六七八九十]元|退款|退费/.test(q));
        const free = relevant.some(q => /免费|不收取.{0,6}(?:费用|报名费|参赛费)/.test(q));
        const paid = relevant.some(q => /[1-9]\d*(?:\.\d+)?\s*元|收费/.test(q));
        return relevant.length ? { status: free && paid ? "conflict" : free || paid ? "known" : "unknown",
            value: paid ? "paid" : free ? "free" : null, detail: relevant.join("\n") } : undefined;
    }
    if (finding.field === "submissionForms") {
        const value = designDirections.filter(d => d !== "其他" && quotes.some(q => q.includes(d)));
        return value.length ? { status: "known", value } : undefined;
    }
    const creativeContent = quotes.filter(q => /创作|设计|主题|命题/.test(q) && !/作品征集通知$/.test(q));
    const submission = quotes.filter(q => /提交|格式|尺寸|分辨率|文件|展板/.test(q));
    return creativeContent.length || submission.length ? { creativeContent: creativeContent.join("\n"), submission: submission.join("\n") } : undefined;
}
async function checkedEvidence(root: string, entry: Entry, bundle: PreparedMaterialsBundle) {
    const sources = new ExperimentFiles(root);
    return Promise.all(entry.evidence.map(async e => {
        const bytes = await sources.read(`sources/${e.sourceId}/snapshot.json`), snapshot = JSON.parse(bytes.toString("utf8"));
        if (hash(bytes) !== e.snapshotHash || snapshot.binding?.competitionId !== bundle.identity.libraryId
            || snapshot.binding?.sourceVersion !== bundle.sourceVersion || snapshot.binding?.scopePointer !== entry.scope
            || snapshot.sourceUrl !== e.url || snapshot.origin !== "official_check" || snapshot.status !== "read"
            || !new RegExp(`^sources/${e.sourceId}/original\\.[a-z]+$`).test(snapshot.originalPath)
            || hash(await sources.read(snapshot.originalPath)) !== snapshot.sha256 || !snapshot.text.includes(e.quote)) throw new Error("补证原件或适用范围校验失败");
        return { id: `official-${hash(e.sourceId + e.quote)}`, url: e.url, quote: e.quote, sourceVersion: bundle.sourceVersion,
            resourceIndex: -1, textHash: hash(snapshot.text), start: snapshot.text.indexOf(e.quote), end: snapshot.text.indexOf(e.quote) + e.quote.length };
    }));
}

/** Append verified facts to the formal database. Original prepared material and history stay immutable. */
export async function storeOfficialSupplement(root: string, base: PreparedMaterialsBundle, check: OfficialVerificationResult) {
    const files = new SupplementFiles(root), sources = new ExperimentFiles(root); let added = 0;
    if (check.competitionId !== base.identity.libraryId || !base.tasks.some(t => t.scopePointer === check.scopePointer)) throw new Error("补证任务范围无效");
    for (const finding of check.findings) {
        if (finding.status !== "known" || finding.provenance !== "official_page_identity_and_quote_checked" || !finding.evidence?.length) continue;
        const fact = derive(finding); if (!fact) continue;
        const entry: Entry = { version: 1, competitionId: check.competitionId, baseHash: hash(stable(base)), scope: check.scopePointer, field: finding.field, fact,
            evidence: await Promise.all(finding.evidence.map(async e => ({ ...e, snapshotHash: hash(await sources.read(`sources/${e.sourceId}/snapshot.json`)) }))) };
        await checkedEvidence(root, entry, base);
        if (entry.field === "requirements") {
            const tasks = structuredClone(base.tasks), task = tasks.find(t => t.scopePointer === entry.scope)!;
            const old = task.requirements as Record<string, any>;
            task.requirements = { ...old, creativeContent: currentCreativeContent(task) || fact.creativeContent, submission: old?.submission || fact.submission };
            if (submissionChoiceIssues(tasks, entry.evidence).length) continue;
        }
        const relative = `official-supplements/${hash(base.identity.libraryId)}/${hash(stable([entry.baseHash, entry.scope, entry.field]))}.json`;
        await serializeArtifact(await files.resolve(relative, true), async () => {
            try { await files.read(relative); return; } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
            let handle;
            try { handle = await fs.open(await files.resolve(relative, true), "wx", 0o600); }
            catch (e) { if ((e as NodeJS.ErrnoException).code === "EEXIST") return; throw e; }
            try { await handle.writeFile(JSON.stringify({ ...entry, integrityHash: hash(stable(entry)) }, null, 2)); await handle.sync(); }
            finally { await handle.close(); }
            added++;
        });
    }
    if (added) {
        const { loadPreparedMaterialResources } = await import("./prepared-materials.js");
        await publishCompetitionCards(root, await applyOfficialSupplements(root, base), await loadPreparedMaterialResources(root,
            { libraryId: base.identity.libraryId, sourceUrl: base.identity.sourceUrl, sourceVersion: base.sourceVersion }));
    }
    return added;
}

/** Every query, filter, card and creation check reads the same current, source-verified facts. */
export async function applyOfficialSupplements(root: string, base: PreparedMaterialsBundle) {
    const files = new SupplementFiles(root), bundle = structuredClone(base);
    for (const file of await files.list(`official-supplements/${hash(base.identity.libraryId)}`)) {
        if (file.kind !== "file" || !file.path.endsWith(".json")) continue;
        const { integrityHash, ...entry } = JSON.parse((await files.read(file.path)).toString("utf8")) as Entry & { integrityHash: string };
        if (entry.baseHash !== hash(stable(base))) continue;
        if (entry.version !== 1 || entry.competitionId !== base.identity.libraryId || integrityHash !== hash(stable(entry))) throw new Error("补证数据库记录损坏");
        const task = bundle.tasks.find(t => t.scopePointer === entry.scope); if (!task) throw new Error("补证任务不存在");
        const evidence = await checkedEvidence(root, entry, base), refs = evidence.map(e => e.id);
        for (const e of evidence) if (!bundle.evidence.some(old => old.id === e.id)) bundle.evidence.push(e);
        if (entry.field === "requirements") {
            const requirements = typeof task.requirements === "object" && task.requirements ? task.requirements as Record<string, any> : {};
            task.requirements = { ...requirements, creativeContent: currentCreativeContent(task) || entry.fact.creativeContent,
                submission: requirements.submission || entry.fact.submission, evidenceRefs: [...new Set([...(requirements.evidenceRefs || []), ...refs])] };
            if (currentCreativeContent(task)) task.status = "known";
        } else {
            const rows = bundle.facts[factKey[entry.field]], old = rows.find(r => r.scopePointer === entry.scope);
            if (old?.status === "known" || old?.status === "conflict") continue;
            const next = { scopePointer: entry.scope, ...entry.fact, evidenceRefs: refs } as PreparedFact;
            if (old) Object.assign(old, next); else rows.push(next);
        }
    }
    return bundle;
}
