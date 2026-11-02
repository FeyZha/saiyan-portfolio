import type { SixFieldEntry, SixFieldEvidence } from "./six-field-index.js";
import { isImageMaterial } from "./tool-readers.js";

type Data = Record<string, unknown>;
export type TaskDetailScope = { record: Data; scopeId: string; pointer: string; scopeTitle: string | null; parents: TaskDetailScope[] };
const object = (value: unknown): value is Data => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const records = (value: unknown) => Array.isArray(value) ? value.filter(object) : [];
const retired = new Set(["eligibility", "eligibilityStatus", "participationRequirements", "aiRule", "aiAllowed"]);
const metadata = new Set(["id", "title", "libraryId", "libraryStatus", "revision", "sourceVersion", "originalRecord", "information", "unassignedNotes",
    "supplements", "directions", "creativeCategories", "competitionId", "competitionTitle", "directionId", "collectedAt", "recognized", "priority", "coverageStatus",
    "designTypes", "deadline", "fee", "feeStatus", "sourceSnapshot", "detail", "binary"]);

/** Requirements keep their complete saved values; source quotations are read separately by reference. */
export function projectTaskRecord(record: Data) {
    const clean = (value: unknown, key?: string): unknown => {
        if (Array.isArray(value)) return value.filter(item => !(typeof item === "string" && (key === "missingInformation" || key === "notes")
            && /^\s*(?:参赛资格|参赛条件|AI使用规则|AI使用许可|身份|学历|院校|年龄)[：:]/.test(item))).map(item => clean(item));
        if (!object(value)) return value;
        return Object.fromEntries(Object.entries(value).filter(([field]) => !retired.has(field) && !["binary", "evidence", "bindingEvidence"].includes(field)).map(([field, item]) => [field, clean(item, field)]));
    };
    return Object.fromEntries(Object.entries(record).filter(([key]) => !metadata.has(key) && !retired.has(key) && !["evidence", "bindingEvidence"].includes(key)).map(([key, value]) => [key, clean(value, key)]));
}

export function taskEvidencePointers(record: Data, scopePointer: string) {
    const result: { ref: string; pointer: string; kind: string }[] = [];
    const token = (key: string) => key.replaceAll("~", "~0").replaceAll("/", "~1");
    const walk = (value: unknown, pointer: string) => {
        if (Array.isArray(value)) value.forEach((item, index) => walk(item, `${pointer}/${index}`));
        else if (object(value)) {
            if (isImageMaterial(value)) return;
            if (typeof value.quote === "string") result.push({ ref: `record:${pointer}`, pointer, kind: "stored_quote" });
            else for (const [key, item] of Object.entries(value)) if (!["directions", "creativeCategories", "originalRecord", "supplements"].includes(key)) walk(item, `${pointer}/${token(key)}`);
        }
    };
    walk(record, scopePointer);
    return result;
}

/** Keep the selected index rows and their exact evidence, never a sibling's values or the whole index. */
export function projectTaskIndex(entry: SixFieldEntry | undefined, selected: TaskDetailScope, scopes: TaskDetailScope[]) {
    if (!entry) return null;
    const lineage = new Set([selected.pointer, ...selected.parents.map(parent => parent.pointer)]);
    const relevantPointer = (pointer: string) => {
        const owner = scopes.filter(scope => !scope.pointer || pointer === scope.pointer || pointer.startsWith(scope.pointer + "/"))
            .sort((a, b) => b.pointer.length - a.pointer.length)[0];
        const local = owner ? pointer.slice(owner.pointer.length) : "";
        return owner && lineage.has(owner.pointer) && local !== "/directions" && local !== "/creativeCategories";
    };
    return Object.fromEntries((["submissionForms", "feeStatus", "submissionDeadline"] as const).map(key => {
        const field = entry.fields[key], isRootApproved = entry.method === "approved_deepseek" && selected.pointer === "";
        const selectedRows = records(field.value).filter(row => Array.isArray(row.scopeIds) && row.scopeIds.some((id, index) => id === selected.scopeId
            && (Array.isArray(row.scopePointers) ? row.scopePointers[index] === selected.pointer : scopes.filter(scope => scope.scopeId === id).length === 1)));
        const indexes = new Set(selectedRows.flatMap(row => Array.isArray(row.evidenceIndexes) ? row.evidenceIndexes as number[] : []));
        const evidence: SixFieldEvidence[] = [], remapped = new Map<number, number>();
        field.evidence.forEach((item, index) => {
            if (!isRootApproved && ((entry.method === "reviewed_codex" && !indexes.has(index))
                || (key === "submissionForms" && indexes.size && !indexes.has(index)))) return;
            const projected = isRootApproved ? item : item.kind === "source_text" ? indexes.has(index) ? item : null
                : { ...item, pointers: item.pointers.filter(relevantPointer) };
            if (!projected || (projected.kind === "record_field" && !projected.pointers.length)) return;
            remapped.set(index, evidence.length); evidence.push(projected);
        });
        const value = isRootApproved ? field.value : selectedRows.map(row => {
            const { evidenceIndexes: _indexes, scopeIds: _ids, scopePointers: _pointers, scopeTitles: _titles, parentScopeIds: _parents, ...fact } = row;
            const originalIndexes = Array.isArray(row.evidenceIndexes) ? row.evidenceIndexes as number[] : [];
            const evidenceIndexes = originalIndexes.filter(index => remapped.has(index)).map(index => remapped.get(index)!);
            return { ...fact, scopeIds: [selected.scopeId], scopePointers: [selected.pointer], evidenceIndexes,
                ...(originalIndexes.length && evidenceIndexes.length !== originalIndexes.length ? { evidenceStatus: "partly_or_not_scope_located", conclusionStatus: "requires_source_review" } : {}) };
        });
        return [key, { value, evidence, ...(field.notes ? selected.pointer === "" ? { notes: field.notes, notesScope: "whole_task_index_context" }
            : { notesStatus: "unscoped_index_notes_omitted" } : {}) }];
    }));
}

export type CompleteTaskFee = Data & { status?: unknown; value?: unknown; factState?: unknown; valueSource?: string; completeness: string;
    alternatives?: { value: unknown; source: string }[] };
/** A detail value is not an index preview. Only this selected legacy scope can complete it. */
export function projectCompleteTaskFee(input: { selected: TaskDetailScope; entry?: SixFieldEntry; revision: string; fact: Data; supplements?: unknown[] }): CompleteTaskFee {
    const { selected, entry, revision, fact } = input, raw = selected.record.fee;
    const present = (value: unknown) => value !== undefined && value !== null && value !== "";
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    const ownCorrection = (correction: Data) => correction.field === "fee" && (selected.pointer === ""
        ? correction.directionId === undefined : /^\/directions\/\d+$/.test(selected.pointer) && correction.directionId === selected.scopeId);
    const corrections = (input.supplements || []).filter(object).filter(item => !item.currentBaseChanged)
        .flatMap(item => records(item.corrections).filter(ownCorrection));
    const unresolved = corrections.filter(item => item.status === "conflict");
    const conflict = (alternatives: { value: unknown; source: string }[]) => ({ ...fact, status: "unknown", factState: "conflict", value: null,
        alternatives: alternatives.filter((item, index) => present(item.value) && alternatives.findIndex(previous => same(previous.value, item.value)) === index),
        valueSource: "stored_fee_conflict", completeness: "unresolved" });
    if (unresolved.length) return conflict([{ value: raw, source: "selected_record.fee" },
        ...unresolved.map(item => ({ value: item.value, source: "conflicting_supplement" }))]);
    // The current fact can encode reviewed doubts, relation conflicts or a newer explicit unknown.
    // Preserve it; a familiar old amount is never permission to upgrade that status.
    if (fact.status === "conflict" || fact.factState === "conflict") return conflict([
        { value: fact.value, source: "current_fact" }, { value: raw, source: "selected_record.fee" }]);
    if (!present(raw)) return { ...fact, completeness: "index_value_only" };
    const effective = corrections.find(item => item.status === "effective" && same(item.value, raw));
    if (effective) return { ...fact, value: raw, valueSource: "effective_selected_fee_correction", completeness: "selected_stored_field" };
    if (fact.status === "unknown" || fact.factState === "unknown" || fact.status === "unclear") return {
        ...fact, value: same(fact.value, raw) || !present(fact.value) ? raw : fact.value,
        completeness: same(fact.value, raw) || !present(fact.value) ? "selected_stored_field" : "unresolved" };
    const feeField = entry?.fields.feeStatus;
    const selectedRows = records(feeField?.value).filter(row => Array.isArray(row.scopeIds) && row.scopeIds.some((id, index) => id === selected.scopeId
        && (Array.isArray(row.scopePointers) ? row.scopePointers[index] === selected.pointer : selected.pointer === "")));
    if (selectedRows.some(row => row.status === "conflict")) return conflict([
        { value: fact.value, source: "current_index" }, { value: raw, source: "selected_record.fee" }]);
    if (selectedRows.some(row => row.status === "unknown" || row.hasLocalDoubt === true)) return { ...fact, status: "unknown", completeness: "unresolved" };
    const numericAmounts = (value: unknown) => typeof value === "string" ? [...value.normalize("NFKC").replaceAll(",", "").matchAll(
        /(?:人民币|CNY|RMB|￥|¥)\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:元|人民币|CNY|RMB)/gi)].map(match => Number(match[1] ?? match[2])) : [];
    const groups = (value: unknown) => typeof value === "string" ? [...value.normalize("NFKC").matchAll(
        /(学生|专业)(?:组)?[^。；;\d]{0,12}(?:人民币|￥|¥|CNY|RMB)?\s*(\d+(?:\.\d+)?)\s*(?:元|人民币)?/gi)].map(match => [match[1], Number(match[2])] as const) : [];
    const originalAmounts = numericAmounts(raw), indexedAmounts = numericAmounts(fact.value), originalGroups = new Map(groups(raw));
    const explicitFree = typeof raw === "string" && /(?:免费参赛|参赛免费|免费投稿|投稿免费|(?:不收取|不收|免收)(?:参赛|报名|投稿)(?:费|费用)|^\s*(?:本赛事|本次比赛|全程)?免费[。.]?\s*$)/.test(raw);
    const contradictory = ((selected.record.feeStatus === "free" || explicitFree) && fact.status === "paid") || (selected.record.feeStatus === "paid" && fact.status === "free")
        || originalAmounts.length > 0 && indexedAmounts.some(amount => !originalAmounts.includes(amount))
        || groups(fact.value).some(([group, amount]) => originalGroups.has(group) && originalGroups.get(group) !== amount);
    if (contradictory) return conflict([{ value: fact.value, source: "current_index" }, { value: raw, source: "selected_record.fee" }]);
    const referenced = new Set(selectedRows.flatMap(row => Array.isArray(row.evidenceIndexes) ? row.evidenceIndexes as number[] : []));
    const linkedToOwnFee = feeField?.evidence.some((proof, index) => proof.kind === "record_field" && proof.baseRevision === revision
        && proof.pointers.includes(`${selected.pointer}/fee`) && (entry?.method !== "reviewed_codex" || referenced.has(index)));
    // A current source-text or otherwise unrelated index is not silently replaced with legacy text.
    if (!entry || entry.method === "legacy_fields" || linkedToOwnFee || same(fact.value, raw)) return {
        ...fact, value: raw, valueSource: "selected_record.fee", completeness: "selected_stored_field" };
    return { ...fact, completeness: "index_value_only" };
}
