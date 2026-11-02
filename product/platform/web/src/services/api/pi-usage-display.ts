import type { PiRun } from "./pi-competitions";

export function usageLabel(run: PiRun): string {
    const accounting = run.usageAccounting;
    if (accounting?.status === "not_requested") return "未调用模型";
    if (accounting?.status === "complete") return `用量 ${accounting.knownTokens.toLocaleString()} tokens`;
    if (accounting?.knownTokens) return `已知用量 ${accounting.knownTokens.toLocaleString()} tokens · 用量不完整`;
    // A restored old run can lack accounting. Its SDK zero is also not proof of zero consumption.
    const tokens = (run.usage as { totalTokens?: number } | undefined)?.totalTokens;
    if (!accounting && typeof tokens === "number" && tokens > 0)
        return `已知用量 ${tokens.toLocaleString()} tokens · 用量完整性未确认`;
    return "用量未知";
}
