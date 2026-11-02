import type { AgentMessage } from "@earendil-works/pi-agent-core";

type Data = Record<string, unknown>;
const object = (value: unknown): value is Data => Boolean(value && typeof value === "object" && !Array.isArray(value));
const sourceReads = new Set(["read_library_resource", "read_competition_url", "read_uploaded_material", "read_experiment_material", "save_competition_supplement"]);
const rawCopies = new Set(["originalRecord", "sourceSnapshot", "sourceText", "binary", "ocr"]);
const hasRawCopy = (value: unknown): boolean => Array.isArray(value) ? value.some(hasRawCopy) : object(value)
    ? Object.entries(value).some(([key, child]) => rawCopies.has(key) || hasRawCopy(child)) : false;

function resultData(message: AgentMessage): Data | undefined {
    if (message.role !== "toolResult") return;
    if (object(message.details)) return message.details;
    try {
        const text = message.content.filter(part => part.type === "text").map(part => part.type === "text" ? part.text : "").join("");
        const parsed: unknown = JSON.parse(text);
        return object(parsed) ? parsed : undefined;
    } catch { return; }
}

/** Project model context only. Original sessions, source files and historical tool records stay intact. */
export function projectQueryContext(messages: AgentMessage[]): AgentMessage[] {
    return messages.map(message => {
        if (message.role === "assistant") return { ...message, content: message.content.map(part => {
            if (part.type !== "toolCall" || !hasRawCopy(part.arguments)) return part;
            const args = object(part.arguments) ? part.arguments : {};
            return { ...part, arguments: { ...Object.fromEntries(["competitionId", "scopePointer", "id", "kind", "title"]
                .filter(key => Object.hasOwn(args, key)).map(key => [key, args[key]])), status: "historical_source_arguments_not_in_query_context" } };
        }) };
        if (message.role !== "toolResult") return message;
        const data = resultData(message);
        let summary: Data | undefined;
        if (sourceReads.has(message.toolName)) {
            summary = { status: "historical_source_not_in_query_context", toolName: message.toolName,
                competitionId: data?.competitionId, sourceId: data?.id,
                instruction: "原件留在本地供用户查阅；普通问答仅查询已整理字段、任务要求或对应证据片段。" };
        } else if (["search_competition_library", "filter_competition_library"].includes(message.toolName)
            && !["competition_table_v1", "competition_table_v2"].includes(String(data?.format))) {
            summary = { status: "historical_query_references_only", total: data?.total, taskTotal: data?.taskTotal,
                libraryRevision: data?.libraryRevision,
                competitionIds: Array.isArray(data?.results) ? data.results.filter(object).map(row => row.libraryId) : [],
                instruction: "旧展开结果不是本轮有效简表；按本次条件及fields查询，不重新发送历史正文。" };
        } else if (message.toolName === "read_library_competition" && (!data?.format || hasRawCopy(data))) {
            const competition = object(data?.competition) ? data.competition : {};
            summary = { status: "historical_detail_requires_prepared_read", competitionId: competition.libraryId ?? competition.id,
                revision: competition.revision, sourceVersion: competition.sourceVersion,
                instruction: "旧详情或全文不进入普通查询上下文；需要时读取当前已存任务，未整理保持待整理。" };
        } else if (["save_competition_artifact", "revise_competition_artifact"].includes(message.toolName) && data) {
            summary = Object.fromEntries(["id", "kind", "title", "path", "revision"].filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]]));
            summary.status = "saved_artifact_reference";
        }
        return summary ? { ...message, content: [{ type: "text" as const, text: JSON.stringify(summary) }], details: JSON.parse(JSON.stringify(summary)) } : message;
    });
}
