import { createHash } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

type Data = Record<string, any>;
export type EvidenceSelection = { competitionId: string; scopePointer: string; field?: string; evidenceRefs?: string[] };
const object = (value: unknown): value is Data => Boolean(value && typeof value === "object" && !Array.isArray(value));
const fieldKey = (field?: string) => field === "fee" ? "feeStatus" : field === "deadline" ? "submissionDeadline" : field;
export const evidenceKey = (input: EvidenceSelection) => JSON.stringify([input.competitionId, input.scopePointer, fieldKey(input.field) || null,
    input.evidenceRefs ? [...new Set(input.evidenceRefs)].sort() : null]);
export function trustedReadState(value: unknown, sessionId: string) {
    if (!object(value)) return false;
    const { stateHash, ...state } = value;
    return state.version === 1 && state.sessionId === sessionId && typeof stateHash === "string"
        && createHash("sha256").update(JSON.stringify(state)).digest("hex") === stateHash;
}

/** Only successful persisted tool results, never assistant prose, can seed reuse. */
export function savedEvidence(history: AgentMessage[], sessionId: string) {
    const calls = new Map<string, EvidenceSelection>();
    const reads: { selection: EvidenceSelection; record: Data; toolCallId: string; messageIndex: number }[] = [];
    history.forEach((message, messageIndex) => {
        if (message.role === "assistant") for (const part of message.content) {
            if (part.type === "toolCall" && part.name === "read_library_evidence" && object(part.arguments)) calls.set(part.id, part.arguments as EvidenceSelection);
        }
        if (message.role !== "toolResult" || message.toolName !== "read_library_evidence" || message.isError || !object(message.details)) return;
        const { internalReadState, evidenceSelection, evidenceReuse: _reuse, ...record } = message.details as Data;
        const selection = evidenceSelection || calls.get(message.toolCallId);
        if (!trustedReadState(internalReadState, sessionId) || !object(selection) || !selection.competitionId || typeof selection.scopePointer !== "string"
            || record.format !== "submission_task_evidence_v1" || record.status !== "available" || !Array.isArray(record.evidence)
            || record.libraryId !== selection.competitionId || record.scopePointer !== selection.scopePointer
            || typeof record.libraryRevision !== "string" || typeof record.versionToken !== "string") return;
        reads.push({ selection: selection as EvidenceSelection, record, toolCallId: message.toolCallId, messageIndex });
    });
    return reads;
}

export class EvidenceReuse {
    private entries = new Map<string, Promise<Data>>();
    private presented = new Set<string>();
    constructor(history: AgentMessage[], sessionId: string) {
        for (const read of savedEvidence(history, sessionId)) {
            const key = this.key(read.selection, read.record.versionToken, read.record.libraryRevision);
            this.entries.set(key, Promise.resolve(read.record)); this.presented.add(key);
        }
    }
    private key(selection: EvidenceSelection, version: string, revision: string) { return JSON.stringify([evidenceKey(selection), version, revision]); }
    markPresented(selection: EvidenceSelection, record: Data) {
        if (record.status === "available") this.presented.add(this.key(selection, record.versionToken, record.libraryRevision));
    }
    async read(selection: EvidenceSelection, version: string, revision: string, load: () => Promise<Data>) {
        const key = this.key(selection, version, revision), existing = this.entries.get(key);
        if (existing) return { record: structuredClone(await existing), reused: true, presented: this.presented.has(key) };
        const pending = load(); this.entries.set(key, pending);
        try {
            const record = await pending;
            if (record.status !== "available") this.entries.delete(key);
            return { record, reused: false, presented: false };
        } catch (error) { this.entries.delete(key); throw error; }
    }
}

/** Narrow, explicit source-only follow-ups can be answered without model reasoning. New questions stay on the normal path. */
export function evidenceFollowupIntent(question: string) {
    const q = question.trim().replace(/[？?。！!\s]/g, "");
    return q.match(/^(?:请|麻烦)?(?:给我看看|给我看|告诉我|提供|列出|展示)?(?:一下)?(?:(?:这个|这些|刚才|上述|上面|前面|刚才的|上面的))?(费用|报名费|截止(?:日期|时间)?|提交要求|创作要求)?(?:结论|回答)?的?(?:依据|来源|出处|证据)(?:在哪里|是什么|在哪|链接|原文|呢|一下|吗|给我看看)?$/);
}
export function evidenceFollowup(question: string, history: AgentMessage[], sessionId: string, libraryRevision: string) {
    const request = evidenceFollowupIntent(question);
    if (!request) return;
    const lastUser = history.findLastIndex(message => message.role === "user");
    const delivered = history.slice(lastUser + 1).findLast(message => message.role === "toolResult" && message.toolName === "deliver_competition_answer" && !message.isError);
    if (!delivered || delivered.role !== "toolResult" || !object(delivered.details)) return;
    const review = delivered.details as Data;
    if (review.libraryRevision !== libraryRevision || review.candidateList || review.recommendations?.length) return;
    const field = request[1]?.includes("费") ? "feeStatus" : request[1]?.includes("截止") ? "submissionDeadline" : request[1] ? "requirements" : undefined;
    const reads = savedEvidence(history, sessionId).filter(read => read.messageIndex > lastUser && read.record.libraryRevision === libraryRevision
        && (!field || fieldKey(read.selection.field) === field)
        && review.records?.some((record: Data) => record.competitionId === read.selection.competitionId && record.versionToken === read.record.versionToken
            && record.scopePointers?.includes(read.selection.scopePointer)));
    if (!reads.length) return;
    // A generic pronoun is safe only when the previous evidence has one competition/field focus.
    if (new Set(reads.map(read => read.selection.competitionId)).size !== 1
        || !field && new Set(reads.map(read => fieldKey(read.selection.field))).size !== 1) return;
    const seen = new Set<string>(), blocks: string[] = [];
    for (const read of reads) for (const evidence of read.record.evidence) {
        if (typeof evidence.quote !== "string" || !evidence.quote.trim() || typeof evidence.url !== "string") return;
        let url: URL; try { url = new URL(evidence.url); } catch { return; }
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return;
        const key = JSON.stringify([evidence.url, evidence.quote]); if (seen.has(key)) continue; seen.add(key);
        blocks.push(`> ${evidence.quote.replace(/\r?\n/g, "\n> ")}\n\n[查看来源](${url.href.replace(/[()]/g, encodeURIComponent)})`);
    }
    if (!blocks.length) return;
    return { answer: `刚才结论的已存依据：\n\n${blocks.join("\n\n")}`, records: review.records,
        libraryRevision, evidenceReads: reads.map(read => ({ toolCallId: read.toolCallId, ...read.selection, versionToken: read.record.versionToken })) };
}
