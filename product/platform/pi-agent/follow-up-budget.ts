import { ExperimentFiles, artifactId, serializeArtifact } from "./tool-storage.js";
import { requestResource, type NetworkDependencies } from "./tool-network.js";

export const FOLLOW_UP_LIMITS = { searches: 2, reads: 5 } as const;
export type FollowUpStopReason = "evidence_sufficient" | "search_budget_exhausted" | "read_budget_exhausted" | "entries_exhausted" | "cancelled" | "processing_failed";
export type FollowUpState = {
    version: 1; competitionId: string; roundId: string; searchCount: number; readCount: number;
    visitedUrls: string[]; stopReason: FollowUpStopReason | null; unknownFields: string[]; updatedAt: string;
};
export const followUpUrl = (value: string) => { const url = new URL(value); url.hash = ""; return url.href; };
const ledgerPath = (id: string, round = "intake") => `follow-up/${artifactId(id)}/${artifactId(round)}.json`;

export async function readFollowUpState(root: string, id: string, round = "intake"): Promise<FollowUpState | null> {
    try {
        const state = JSON.parse((await new ExperimentFiles(root).read(ledgerPath(id, round))).toString("utf8")) as FollowUpState;
        if (state.version !== 1 || state.competitionId !== id || state.roundId !== round
            || !Number.isSafeInteger(state.searchCount) || state.searchCount < 0 || state.searchCount > FOLLOW_UP_LIMITS.searches
            || !Number.isSafeInteger(state.readCount) || state.readCount < 0 || state.readCount > FOLLOW_UP_LIMITS.reads
            || !Array.isArray(state.visitedUrls) || state.visitedUrls.length !== state.readCount || state.visitedUrls.some(url => typeof url !== "string")
            || !Array.isArray(state.unknownFields) || state.unknownFields.some(field => typeof field !== "string")) throw new Error("补查计数记录无效，保留原件并拒绝重置额度");
        return state;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

export function followUpSummary(state: FollowUpState | null) {
    if (!state) return null;
    return { searchCount: state.searchCount, readCount: state.readCount, limits: FOLLOW_UP_LIMITS, stopReason: state.stopReason,
        unknownFields: state.unknownFields, automaticFollowUp: state.stopReason ? "stopped_until_explicit_user_request" : "bounded_round_in_progress" };
}

/** One durable ledger per contest/round, independent of source revision, extraction and tool choice. */
export class FollowUpBudget {
    private constructor(readonly root: string, readonly id: string, readonly round: string, public state: FollowUpState) {}

    static async open(root: string, id: string, round = "intake") {
        const files = new ExperimentFiles(root), file = ledgerPath(id, round);
        const state = await serializeArtifact(await files.resolve(file), async () => {
            const previous = await readFollowUpState(root, id, round);
            if (previous) return previous;
            const initial: FollowUpState = { version: 1, competitionId: id, roundId: round, searchCount: 0, readCount: 0,
                visitedUrls: [], stopReason: null, unknownFields: [], updatedAt: new Date().toISOString() };
            await files.json(file, initial);
            return initial;
        });
        return new FollowUpBudget(root, id, round, state);
    }

    get exhausted(): FollowUpStopReason | null {
        return this.state.readCount >= FOLLOW_UP_LIMITS.reads ? "read_budget_exhausted"
            : this.state.searchCount >= FOLLOW_UP_LIMITS.searches ? "search_budget_exhausted" : null;
    }
    hasRead(url: string) { return this.state.visitedUrls.includes(followUpUrl(url)); }

    private async update(change: (state: FollowUpState) => void) {
        const files = new ExperimentFiles(this.root), file = ledgerPath(this.id, this.round);
        await serializeArtifact(await files.resolve(file), async () => {
            const state = await readFollowUpState(this.root, this.id, this.round);
            if (!state) throw new Error("补查计数记录丢失，拒绝重置额度");
            change(state); state.updatedAt = new Date().toISOString();
            await files.json(file, state); this.state = state;
        });
    }

    async reserve(kind: "search" | "read", url?: string, signal?: AbortSignal) {
        signal?.throwIfAborted();
        await this.update(state => {
            signal?.throwIfAborted();
            if (state.stopReason || state.searchCount >= FOLLOW_UP_LIMITS.searches || state.readCount >= FOLLOW_UP_LIMITS.reads)
                throw new Error("本场补查已停止，不能继续联网或重置额度");
            if (kind === "search") state.searchCount++;
            else {
                const canonical = followUpUrl(url!);
                if (state.visitedUrls.includes(canonical)) throw new Error("同一网址已尝试读取，不重复联网");
                state.visitedUrls.push(canonical); state.readCount++;
            }
            // Persist exhaustion before the last allowed request, so even an interrupted process cannot reopen it.
            if (state.readCount === FOLLOW_UP_LIMITS.reads) state.stopReason = "read_budget_exhausted";
            else if (state.searchCount === FOLLOW_UP_LIMITS.searches) state.stopReason = "search_budget_exhausted";
        });
    }

    async rememberUnknown(fields: string[]) { await this.update(state => { state.unknownFields = fields; }); }
    async finish(reason: FollowUpStopReason) { await this.update(state => { state.stopReason ??= reason; }); }

    async read(url: string, signal?: AbortSignal, network: NetworkDependencies = {}) {
        // Reserve before DNS/transport: failures consume allowance. Redirect targets share the same budget.
        await this.reserve("read", url, signal);
        let initial = true;
        return requestResource(url, signal, { ...network, beforeRequest: async target => {
            await network.beforeRequest?.(target);
            if (initial && followUpUrl(target) === followUpUrl(url)) initial = false;
            else await this.reserve("read", target, signal);
        } });
    }
}

/** Only the current human message can authorize a fresh round; selection/participation is not verification. */
export function explicitFollowUpRequested(question: string) {
    return !/(?:不|别|无需|无须|不要|暂不|先不|不必|不用|不需要).{0,8}(?:查证|核实|补查|核查|查官网)/.test(question)
        && /^\s*(?:请|帮我|麻烦你|我想|我要|我需要)?\s*(?:继续|重新|再)\s*(?:查证|核实|补查|核查|查官网)/.test(question);
}
