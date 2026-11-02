import localforage from "localforage";
import { create } from "zustand";

type Preferences = { sessionId: string; drafts: Record<string, string>; mode: "preset" | "oauth" | "api"; modeChosen: boolean };
type PiStore = Preferences & {
    hasPendingFiles: boolean;
    hydrated: boolean; storageError: string;
    hydrate: () => Promise<void>;
    selectSession: (id: string) => void;
    setDraft: (id: string, value: string) => void;
    setMode: (mode: Preferences["mode"]) => void;
};
const storage = localforage.createInstance({ name: "infinite-canvas", storeName: "pi_exploration_preferences" });
let hydration: Promise<void> | undefined;
let saving = false;
let dirty = false;
let expected: string | undefined;
let pendingSave: Promise<void> = Promise.resolve();

export async function flushPiPreferences() {
    await pendingSave;
    if (!usePiCompetitionStore.getState().hydrated || usePiCompetitionStore.getState().storageError) throw new Error('竞赛草稿尚未保存');
}

export const usePiCompetitionStore = create<PiStore>()((set, get) => ({
    sessionId: "", drafts: {}, mode: "preset", modeChosen: false, hydrated: false, storageError: "", hasPendingFiles: false,
    hydrate: () => {
        if (get().hydrated) return Promise.resolve();
        if (hydration) return hydration;
        hydration = (async () => {
            try {
                if (!localStorage.getItem("competition-current:retired-chats-cleared")) {
                    await localforage.createInstance({ name: "infinite-canvas", storeName: "competition_chats", driver: localforage.INDEXEDDB }).clear();
                    localStorage.setItem("competition-current:retired-chats-cleared", "2");
                }
                let saved = await storage.getItem<Omit<Preferences, "modeChosen"> & { version: number; modeChosen?: boolean }>("preferences");
                // Competition-only reset: never clear the canvas database or media stores.
                if (saved && saved.version !== 2) { await storage.removeItem("preferences"); saved = null; }
                if (saved && (typeof saved.sessionId !== "string" || !["preset", "oauth", "api"].includes(saved.mode)
                    || !saved.drafts || typeof saved.drafts !== "object" || Object.values(saved.drafts).some(draft => typeof draft !== "string"))) throw new Error("竞赛草稿格式无效");
                for (const key of Object.keys(localStorage)) if (key.startsWith("shown-real-run:")) localStorage.removeItem(key);
                expected = JSON.stringify(saved);
                set({ ...(saved || {}), modeChosen: saved ? saved.modeChosen ?? true : false, hydrated: true, storageError: "" });
            } catch (error) {
                set({ storageError: error instanceof Error ? error.message : "探索草稿无法读取" });
            } finally { hydration = undefined; }
        })();
        return hydration;
    },
    selectSession: (sessionId) => set({ sessionId }),
    setDraft: (id, value) => set((state) => ({ drafts: { ...state.drafts, [id]: value } })),
    setMode: (mode) => set({ mode, modeChosen: true }),
}));

async function save() {
    dirty = true;
    if (saving || !usePiCompetitionStore.getState().hydrated || usePiCompetitionStore.getState().storageError) return;
    saving = true;
    try {
        while (dirty) {
            dirty = false;
            const write = async () => {
                if (JSON.stringify(await storage.getItem("preferences")) !== expected) throw new Error("探索草稿已在其他页面更新，请保存输入后刷新");
                const { sessionId, drafts, mode, modeChosen } = usePiCompetitionStore.getState();
                const snapshot = { version: 2, sessionId, drafts, mode, modeChosen };
                await storage.setItem("preferences", snapshot);
                expected = JSON.stringify(snapshot);
            };
            if (navigator.locks) await navigator.locks.request("infinite-canvas:pi-exploration", write);
            else await write();
        }
    } catch (error) {
        usePiCompetitionStore.setState({ storageError: `草稿尚未保存：${error instanceof Error ? error.message : "浏览器存储不可用"}` });
    } finally { saving = false; }
}
usePiCompetitionStore.subscribe((state, previous) => {
    if (state.hydrated && previous.hydrated && (state.sessionId !== previous.sessionId || state.drafts !== previous.drafts || state.mode !== previous.mode || state.modeChosen !== previous.modeChosen)) {
        dirty = true;
        if (!saving) pendingSave = save();
    }
});
