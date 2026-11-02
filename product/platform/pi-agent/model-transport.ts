/** Verifiable transport facts only: no request body, headers, URLs or raw error messages. */
export type ModelTransportFailure = {
    at: string; phase: "response_headers" | "response_body"; kind: "connection" | "cancelled";
    codes: string[]; httpStatus?: number; delivery: "unknown"; automaticRetry: false;
};
export function transportFailure(error: unknown, phase: ModelTransportFailure["phase"], signal?: AbortSignal | null, httpStatus?: number): ModelTransportFailure {
    const codes = new Set<string>(), seen = new Set<unknown>();
    function visit(value: any) {
        if (!value || typeof value !== "object" || seen.has(value)) return;
        seen.add(value);
        if (typeof value.code === "string" && /^(?:E[A-Z0-9_]+|UND_ERR_[A-Z0-9_]+|ERR_[A-Z0-9_]+)$/.test(value.code)) codes.add(value.code);
        if (value.name === "TimeoutError") codes.add("ETIMEDOUT");
        visit(value.cause);
        if (Array.isArray(value.errors)) value.errors.forEach(visit);
    }
    visit(error); visit(signal?.reason);
    return { at: new Date().toISOString(), phase, kind: signal?.aborted && signal.reason?.name !== "TimeoutError" ? "cancelled" : "connection",
        codes: [...codes], ...(httpStatus === undefined ? {} : { httpStatus }), delivery: "unknown", automaticRetry: false };
}
export function observedModelFetch(fetcher: typeof globalThis.fetch, failures: ModelTransportFailure[]): typeof globalThis.fetch {
    return async (input, init) => {
        const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
        const fail = (error: unknown, phase: ModelTransportFailure["phase"], status?: number) => {
            const fact = transportFailure(error, phase, signal, status);
            // A local review gate, validation or persistence error is not a network failure.
            if (phase === "response_headers" && !signal?.aborted && !fact.codes.length
                && !(error instanceof Error && /fetch failed|network error|failed to fetch/i.test(error.message))) return error;
            failures.push(fact);
            // The SDK flattens Error.cause; keep machine facts separately and pass a useful public message.
            if (fact.kind === "cancelled") return Object.assign(new Error("请求已停止。"), { name: "AbortError" });
            return new Error("模型连接中断，本轮回答未完成；已完成的查询记录已保留，未自动重发。", { cause: error });
        };
        let response: Response;
        try { response = await fetcher(input, init); }
        catch (error) { throw fail(error, "response_headers"); }
        if (!response.body) return response;
        const reader = response.body.getReader();
        return new Response(new ReadableStream<Uint8Array>({
            async pull(controller) {
                try {
                    const result = await reader.read();
                    if (result.done) { controller.close(); reader.releaseLock(); }
                    else controller.enqueue(result.value);
                } catch (error) { controller.error(fail(error, "response_body", response.status)); reader.releaseLock(); }
            },
            async cancel(reason) { try { await reader.cancel(reason); } finally { reader.releaseLock(); } },
        }), { status: response.status, statusText: response.statusText, headers: response.headers });
    };
}
