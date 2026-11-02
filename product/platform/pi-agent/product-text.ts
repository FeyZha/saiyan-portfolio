import { normalizeContext } from "@earendil-works/pi-ai";
import { resolveProductModel, CODEX_MODEL } from "./product-model.js";

export async function streamProductText(messages: unknown, resolve = resolveProductModel) {
    if (!Array.isArray(messages) || !messages.length) throw new Error("文字任务缺少消息。");
    const converted = messages.map((message: any) => {
        if (!["system", "user", "assistant"].includes(message?.role)) throw new Error("文字消息角色无效。");
        const parts = typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content;
        if (!Array.isArray(parts)) throw new Error("文字消息内容无效。");
        const content = parts.map((part: any) => {
            if (part?.type === "text" && typeof part.text === "string") return part;
            const match = part?.type === "image_url" && /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(part.image_url?.url || "");
            if (match) return { type: "image", mimeType: match[1], data: match[2] };
            throw new Error("图片问答请使用已加载的图片；不自动访问外部网址。");
        });
        return { role: message.role, content, timestamp: Date.now(), ...(message.role === "assistant" ? {
            api: "openai-codex-responses", provider: "openai-codex", model: CODEX_MODEL.model, stopReason: "stop",
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        } : {}) };
    });
    const resolved = await resolve(CODEX_MODEL), controller = new AbortController();
    const redact = (text: string) => resolved.secrets.reduce((value, secret) => value.replaceAll(secret, "[凭据已隐藏]"), text);
    async function* events() {
        try {
            const stream = await resolved.streamFn(resolved.model, normalizeContext({ messages: converted }), { signal: controller.signal, maxRetries: 0 });
            for await (const event of stream) if (event.type === "text_delta") yield { type: "delta", text: redact(event.delta) };
            const answer = await stream.result();
            if (!["stop", "length"].includes(answer.stopReason)) throw new Error(answer.errorMessage || "Codex 未完成文字任务。");
            yield { type: "done", text: redact(answer.content.filter(p => p.type === "text").map(p => p.text).join("\n")), model: resolved.modelInfo };
        } catch (error) { yield { type: "error", error: redact(error instanceof Error ? error.message : "Codex 文字任务失败") }; }
    }
    return { events: events(), abort: () => controller.abort() };
}
