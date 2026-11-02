import { getPiRun, piRunActive, type PiActivity, type PiPresentation, type PiRun, type PiSession } from "./pi-competitions";

export type PiLiveEvent =
    | { type: "snapshot"; run: PiRun; revision: number }
    | { type: "final"; run: PiRun; revision: number }
    | { type: "text_delta"; runId: string; sessionId: string; revision: number; delta: string; kind: "text" | "delivery" }
    | { type: "answer_reset"; runId: string; sessionId: string; revision: number; answer: string; kind: "text" | "delivery" }
    | { type: "activity"; runId: string; sessionId: string; revision: number; activity?: PiActivity; phase: PiPresentation["phase"] };

/** A reconnect starts with an authoritative snapshot, never replays a model request. */
export function applyPiLiveEvent(current: PiRun, event: PiLiveEvent): PiRun {
    const snapshot = event.type === "snapshot" || event.type === "final";
    const id = snapshot ? event.run.runId : event.runId;
    const session = snapshot ? event.run.sessionId : event.sessionId;
    if (id !== current.runId || session !== current.sessionId || !Number.isSafeInteger(event.revision)) return current;
    if (!piRunActive(current) && (!snapshot || piRunActive(event.run))) return current;
    // After a server restart the in-memory display revision resets, while its
    // saved run becomes terminal/interrupted. That authoritative snapshot must
    // end the old live view without restarting any model work.
    const recoveredTerminal = snapshot && piRunActive(current) && !piRunActive(event.run);
    if (event.revision < (current.presentation?.revision ?? -1) && !recoveredTerminal) return current;
    if (snapshot) return { ...event.run, events: [] };
    if (!piRunActive(current) || event.revision === current.presentation?.revision) return current;
    const presentation: PiPresentation = { draftAnswer: "", draftKind: "text", phase: "running", ...current.presentation, revision: event.revision };
    if (event.type === "text_delta") {
        presentation.draftAnswer += event.delta; presentation.draftKind = event.kind;
    } else if (event.type === "answer_reset") {
        presentation.draftAnswer = event.answer; presentation.draftKind = event.kind;
    } else { presentation.activity = event.activity; presentation.phase = event.phase; }
    return { ...current, presentation };
}

/** A delayed history read cannot replace newer streamed text in the same run. */
export function mergePiSessionSnapshot(current: PiSession | null, incoming: PiSession): PiSession {
    if (!current || current.id !== incoming.id) return incoming;
    const runs = incoming.runs.slice();
    for (const local of current.runs) {
        const index = runs.findIndex(run => run.runId === local.runId);
        if (index < 0) runs.push(local);
        else runs[index] = applyPiLiveEvent(local, { type: "snapshot", run: runs[index], revision: runs[index].presentation?.revision ?? 0 });
    }
    return { ...incoming, updatedAt: current.updatedAt > incoming.updatedAt ? current.updatedAt : incoming.updatedAt, runs };
}

export function subscribePiRun(id: string, callbacks: {
    event: (event: PiLiveEvent) => void; connection: (message: string) => void;
}, signal: AbortSignal) {
    const stream = new EventSource(`/__workbench/pi/runs/${encodeURIComponent(id)}/stream`);
    let checking = false;
    const stop = () => stream.close();
    for (const type of ["snapshot", "text_delta", "answer_reset", "activity", "final"]) {
        stream.addEventListener(type, event => {
            if (signal.aborted) return;
            try {
                const data = JSON.parse((event as MessageEvent<string>).data) as PiLiveEvent;
                if (data.type !== type) return;
                callbacks.connection(""); callbacks.event(data);
                if (type === "final") stop();
            } catch { callbacks.connection("实时显示暂时中断，正在重新连接。"); }
        });
    }
    stream.onopen = () => { if (!signal.aborted) callbacks.connection(""); };
    stream.onerror = () => {
        if (signal.aborted) return;
        callbacks.connection("实时显示暂时中断，正在重新连接；任务仍在后台运行。");
        // Covers a completion during a dropped connection. EventSource handles
        // reconnects; this read never starts or resumes model work.
        if (checking) return;
        checking = true;
        void getPiRun(id, signal).then(run => {
            if (!signal.aborted && !piRunActive(run)) {
                callbacks.event({ type: "final", run, revision: run.presentation?.revision ?? 0 });
                callbacks.connection(""); stop();
            }
        }).catch(() => {}).finally(() => { checking = false; });
    };
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
    return () => { signal.removeEventListener("abort", stop); stop(); };
}
