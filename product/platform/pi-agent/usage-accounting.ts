export type UsageAccounting = { status: "complete" | "partial" | "unknown" | "not_requested"; knownTokens: number; unreportedRequests: number };
type Run = { status: string; modelRequests?: number; usage?: { totalTokens?: number }; events: { type: string; data: unknown }[] };
/** SDK error messages contain default zero usage. It is not a provider receipt. Never rewrite the original usage. */
export function usageAccounting(run: Run): UsageAccounting {
    let starts = 0, ends = 0, reported = 0;
    for (const event of run.events) {
        if (event.type === "official_usage") {
            ends++; if (Number((event.data as { usage?: { totalTokens?: number } })?.usage?.totalTokens) > 0) reported++;
            continue;
        }
        const message = (event.data as { message?: { role?: string; usage?: { totalTokens?: number } } } | null)?.message;
        if (message?.role !== "assistant") continue;
        if (event.type === "message_start") starts++;
        if (event.type === "message_end") { ends++; if (Number(message.usage?.totalTokens) > 0) reported++; }
    }
    const knownTokens = Math.max(0, Number(run.usage?.totalTokens) || 0);
    if (run.modelRequests === 0 && starts === 0 && ends === 0) return { status: "not_requested", knownTokens: 0, unreportedRequests: 0 };
    const requests = Math.max(run.modelRequests || 0, starts, ends);
    const unreportedRequests = Math.max(0, requests - reported);
    const complete = requests > 0 && !unreportedRequests && knownTokens > 0 && run.status !== "running";
    return { status: complete ? "complete" : knownTokens ? "partial" : "unknown", knownTokens, unreportedRequests: unreportedRequests || (complete ? 0 : 1) };
}
