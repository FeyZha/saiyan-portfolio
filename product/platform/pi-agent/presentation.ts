import type { AgentEvent } from "@earendil-works/pi-agent-core";

export type PiActivity = { id: string; agent: "main" | "official"; label: string; status: "running" | "completed" | "failed" };
export type PiPresentation = {
    revision: number;
    draftAnswer: string;
    draftKind: "text" | "delivery";
    phase: "running" | "reviewing" | "completed" | "failed" | "cancelled" | "interrupted";
    activity?: PiActivity;
};

// Only real, recognized tool boundaries create a public activity. Raw arguments,
// tool results and model reasoning never form part of this projection.
const labels: Record<string, string> = {
    request_competition: "查询并整理竞赛结果",
    filter_competition_library: "筛选竞赛资料",
    search_competition_library: "查找竞赛资料",
    read_library_task_directory: "查看匹配任务目录",
    read_library_competition: "读取选中任务要求",
    read_library_evidence: "核对已存依据",
    verify_competition_official: "核查竞赛官网信息",
    deliver_competition_answer: "交付回答",
    save_competition_artifact: "整理创作任务",
    revise_competition_artifact: "更新创作任务",
    read_official_page: "读取官网相关文字",
    finish_official_check: "提交官网核查结果",
};

export function activityOf(event: AgentEvent, agent: PiActivity["agent"] = "main"): PiActivity | undefined {
    if (event.type !== "tool_execution_start" && event.type !== "tool_execution_end") return;
    const label = labels[event.toolName];
    if (!label) return;
    return { id: `${agent}:${event.toolCallId}`, agent, label,
        status: event.type === "tool_execution_start" ? "running" : event.isError ? "failed" : "completed" };
}

/** SDK partial.arguments is already parsed JSON. Never parse arbitrary streamed JSON or expose sibling arguments. */
export function publicAnswerOf(event: AgentEvent): { answer: string; kind: PiPresentation["draftKind"] } | undefined {
    const message = event.type === "message_update" && "partial" in event.assistantMessageEvent ? event.assistantMessageEvent.partial
        : event.type === "message_end" ? event.message : undefined;
    if (!message || message.role !== "assistant") return;
    const delivery = message.content.find(part => part.type === "toolCall" && part.name === "deliver_competition_answer");
    if (delivery?.type === "toolCall" && delivery.arguments && typeof delivery.arguments === "object"
        && typeof delivery.arguments.answer === "string") return { answer: delivery.arguments.answer, kind: "delivery" };
    // Thinking deltas can carry an earlier text block in `partial`; they must not
    // create text output. Ordinary public text is handled only at text boundaries.
    if (event.type === "message_update" && !["text_start", "text_delta", "text_end"].includes(event.assistantMessageEvent.type)) return;
    const text = message.content.filter(part => part.type === "text").map(part => part.text).join("\n");
    if (text) return { answer: text, kind: "text" };
}

export function initialPresentation(status: PiPresentation["phase"] = "running"): PiPresentation {
    return { revision: 0, draftAnswer: "", draftKind: "text", phase: status };
}

/** Display legacy network errors without rewriting the saved failed run. */
export function publicRunError(error: string | undefined): string | undefined {
    if (error && /fetch failed|terminated|Codex stream ended without a stop reason|response headers timed out|ECONNRESET|UND_ERR_SOCKET/i.test(error))
        return "模型连接中断，本轮回答未完成；已完成的查询记录已保留，未自动重发。";
    return error;
}
