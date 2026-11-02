import type { ServerResponse } from "node:http";
import type { PiRunView, PiViewEvent } from "../pi-agent/runtime";

type StreamRuntime = {
    getRunView: (id: string) => Promise<PiRunView | undefined>;
    subscribeView: (id: string, listener: (event: PiViewEvent) => void) => () => void;
};

/** A reconnect always gets the current compact snapshot. A slow reader receives
 * one fresh snapshot after drain, rather than an unbounded queue of old deltas. */
export async function streamPiRun(res: ServerResponse, runtime: StreamRuntime, id: string) {
    let closed = false, ready = false, blocked = false, dirty = false, refreshing = false;
    let unsubscribe = () => {};
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        if (heartbeat) clearInterval(heartbeat);
    };
    res.on("close", close);
    const send = (event: PiViewEvent) => {
        if (closed || res.destroyed || res.writableEnded) return;
        blocked = !res.write(`event: ${event.type}\nid: ${event.revision}\ndata: ${JSON.stringify(event)}\n\n`);
        if (event.type === "final") { close(); res.end(); }
    };
    const refresh = async () => {
        if (refreshing || closed || blocked || !ready) return;
        refreshing = true;
        dirty = false;
        try {
            const run = await runtime.getRunView(id);
            if (closed) return;
            if (!run) { close(); res.end(); return; }
            send({ type: run.settled ? "final" : "snapshot", revision: run.presentation.revision, run });
        } catch {
            close(); res.end();
        } finally {
            refreshing = false;
            if (dirty && !closed && !blocked) void refresh();
        }
    };
    // Subscribe before the first asynchronous read so a completion during setup
    // cannot disappear between snapshot and subscription.
    unsubscribe = runtime.subscribeView(id, event => {
        if (!ready || blocked || refreshing) { dirty = true; return; }
        send(event);
    });
    let run: PiRunView | undefined;
    try { run = await runtime.getRunView(id); }
    catch (error) { close(); throw error; }
    if (closed) return;
    if (!run) { close(); res.statusCode = 404; res.end(JSON.stringify({ error: "运行记录不存在" })); return; }
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    ready = true;
    // The initial event is always a snapshot, including for a completed run.
    send({ type: "snapshot", revision: run.presentation.revision, run });
    if (run.settled) { send({ type: "final", revision: run.presentation.revision, run }); return; }
    res.on("drain", () => { blocked = false; if (dirty) void refresh(); });
    heartbeat = setInterval(() => {
        if (!closed && !blocked) blocked = !res.write(": heartbeat\n\n");
    }, 15000);
    heartbeat.unref();
    if (dirty && !blocked) void refresh();
}
