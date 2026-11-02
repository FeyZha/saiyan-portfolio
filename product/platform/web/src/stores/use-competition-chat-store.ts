import localforage from "localforage";
import { create } from "zustand";

import type { CompetitionIntent, CompetitionReport } from "@/services/api/competitions";

export type CompetitionChatTurn = {
    id: string;
    question: string;
    intent: CompetitionIntent["intent"];
    reply: string;
    results?: CompetitionReport[];
    pending?: boolean;
    error?: boolean;
    source?: "api" | "codex" | "local";
    filter?: CompetitionIntent;
    excludedIds?: string[];
    choices?: string[];
    updateId?: string;
};
export type CompetitionConversation = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    draft: string;
    turns: CompetitionChatTurn[];
};
type ChatStore = {
    conversations: CompetitionConversation[];
    currentConversationId: string;
    hydrated: boolean;
    storageError: string;
    hydrate: () => Promise<void>;
    retryStorage: () => Promise<void>;
    newConversation: () => string;
    deleteConversation: (id: string) => boolean;
    selectConversation: (id: string) => void;
    setDraft: (id: string, draft: string) => void;
    appendTurn: (id: string, turn: CompetitionChatTurn) => void;
    updateTurn: (conversationId: string, turnId: string, patch: Partial<CompetitionChatTurn>) => void;
};

const storage = localforage.createInstance({ name: "infinite-canvas", storeName: "competition_chats", driver: localforage.INDEXEDDB });
const STORAGE_KEY = "conversations";
let hydration: Promise<void> | undefined;
let saving = false;
let dirty = false;
let expectedSnapshot: string | undefined;
let storageConflict = false;
const createConversation = (): CompetitionConversation => {
    const now = new Date().toISOString();
    return { id: crypto.randomUUID(), title: "新对话", createdAt: now, updatedAt: now, draft: "", turns: [] };
};

const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");
function validFilter(value: unknown): value is CompetitionIntent {
    if (!value || typeof value !== "object") return false;
    const filter = value as CompetitionIntent;
    return ["filter", "clarify", "upload_recognition", "refresh", "help"].includes(filter.intent) && strings(filter.keywords) && strings(filter.designTypes)
        && ["all", "a_class", "recognized"].includes(filter.priority) && typeof filter.reply === "string"
        && (filter.deadlineDays === null || (typeof filter.deadlineDays === "number" && Number.isFinite(filter.deadlineDays)))
        && typeof filter.freeOnly === "boolean"
        && (filter.nextPage === undefined || typeof filter.nextPage === "boolean") && (filter.choices === undefined || strings(filter.choices));
}
function validCreationScope(item: Pick<CompetitionReport, "creationSupport" | "workItems" | "creativeCategories" | "directions">): boolean {
    const support = item.creationSupport;
    return (support === undefined || Boolean(support && typeof support === "object" && ["supported", "partial", "unsupported", "unclear"].includes(support.status) && typeof support.reason === "string"))
        && (item.workItems === undefined || (Array.isArray(item.workItems) && item.workItems.every((work) => work && typeof work === "object"
            && typeof work.name === "string" && ["visual_design", "product_concept", "video", "spatial", "physical", "functional", "document", "photography", "fashion", "other", "unknown"].includes(work.kind)
            && (work.quantity === undefined || typeof work.quantity === "string") && (work.submission_requirements === undefined || typeof work.submission_requirements === "string")
            && ["primary", "supporting"].includes(work.role) && ["required", "optional", "unclear"].includes(work.requirement)
            && ["design_files", "finished_media", "physical_object", "runnable", "unspecified"].includes(work.delivery)
            && work.evidence && typeof work.evidence.url === "string" && typeof work.evidence.quote === "string")))
        && [item.creativeCategories, item.directions].every((children) => children === undefined || (Array.isArray(children) && children.every((child) => child && typeof child === "object" && validCreationScope(child))));
}
function validTurn(value: unknown): value is CompetitionChatTurn {
    if (!value || typeof value !== "object") return false;
    const turn = value as CompetitionChatTurn;
    return typeof turn.id === "string" && Boolean(turn.id) && typeof turn.question === "string" && typeof turn.reply === "string"
        && ["filter", "clarify", "upload_recognition", "refresh", "help"].includes(turn.intent)
        && (turn.pending === undefined || typeof turn.pending === "boolean") && (turn.error === undefined || typeof turn.error === "boolean")
        && (turn.source === undefined || ["api", "codex", "local"].includes(turn.source))
        && (turn.filter === undefined || validFilter(turn.filter)) && (turn.choices === undefined || strings(turn.choices))
        && (turn.excludedIds === undefined || strings(turn.excludedIds))
        && (turn.updateId === undefined || typeof turn.updateId === "string")
        && (turn.results === undefined || (Array.isArray(turn.results) && turn.results.every((item) => item && typeof item === "object"
            && ["id", "title", "track", "themeTask", "eligibility", "submissionFormat", "fee", "registrationUrl", "sourceUrl", "collectedAt"].every((key) => typeof item[key as keyof CompetitionReport] === "string")
            && strings(item.sourceUrls) && (item.designTypes === undefined || strings(item.designTypes))
            && (item.pendingReason === undefined || typeof item.pendingReason === "string")
            && (item.priority === undefined || ["a_class", "recognized"].includes(item.priority))
            && (item.feeStatus === undefined || ["free", "paid", "unknown"].includes(item.feeStatus))
            && (item.graphicStatus === undefined || ["graphic", "non_graphic", "unclear"].includes(item.graphicStatus))
            && validCreationScope(item)
            && (item.recognized === undefined || typeof item.recognized === "boolean")
            && (item.deadline == null || typeof item.deadline === "string"))));
}
function readSnapshot(value: unknown): { conversations: CompetitionConversation[]; currentConversationId: string } {
    if (!value || typeof value !== "object" || (value as { version?: number }).version !== 1) throw new Error("对话存储版本无法识别，原始记录未被覆盖");
    const data = value as { conversations: CompetitionConversation[]; currentConversationId: string };
    if (!Array.isArray(data.conversations) || !data.conversations.every((chat) => chat && [chat.id, chat.title, chat.createdAt, chat.updatedAt, chat.draft].every((text) => typeof text === "string")
        && chat.id && Number.isFinite(Date.parse(chat.createdAt)) && Number.isFinite(Date.parse(chat.updatedAt))
        && Array.isArray(chat.turns) && chat.turns.every(validTurn) && new Set(chat.turns.map((turn) => turn.id)).size === chat.turns.length)
        || new Set(data.conversations.map((chat) => chat.id)).size !== data.conversations.length
        || !data.conversations.some((chat) => chat.id === data.currentConversationId)) throw new Error("本地对话记录损坏，原始记录未被覆盖");
    return {
        currentConversationId: data.currentConversationId,
        conversations: data.conversations.map((chat) => ({ ...chat, turns: chat.turns.map((turn) => turn.pending ? {
            ...turn, pending: false, error: true, reply: turn.intent === "upload_recognition" ? "上次识别已中断，文件未保存，请重新选择 PDF。" : "上次回复已中断，点击重试可继续。",
        } : turn) })),
    };
}

export const useCompetitionChatStore = create<ChatStore>()((set, get) => ({
    conversations: [], currentConversationId: "", hydrated: false, storageError: "",
    hydrate: () => {
        if (get().hydrated) return Promise.resolve();
        if (hydration) return hydration;
        hydration = (async () => {
            try {
                const saved = await storage.getItem(STORAGE_KEY);
                const initial = createConversation();
                const snapshot = saved === null ? { conversations: [initial], currentConversationId: initial.id } : readSnapshot(saved);
                expectedSnapshot = JSON.stringify(saved);
                set({ ...snapshot, hydrated: true, storageError: "" });
                await saveConversations();
            } catch (error) {
                set({ storageError: `无法读取本地对话：${error instanceof Error ? error.message : "请检查浏览器存储权限"}` });
            } finally { hydration = undefined; }
        })();
        return hydration;
    },
    retryStorage: async () => {
        if (!get().hydrated) return get().hydrate();
        if (storageConflict) return;
        set({ storageError: "" });
        await saveConversations();
    },
    newConversation: () => {
        if (!get().hydrated) return "";
        const chat = createConversation();
        set((state) => ({ conversations: [chat, ...state.conversations], currentConversationId: chat.id }));
        return chat.id;
    },
    deleteConversation: (id) => {
        const state = get();
        if (!state.hydrated || state.storageError || !state.conversations.some((chat) => chat.id === id)) return false;
        const conversations = state.conversations.filter((chat) => chat.id !== id);
        if (!conversations.length) conversations.push(createConversation());
        const currentConversationId = state.currentConversationId === id
            ? conversations.reduce((latest, chat) => Date.parse(chat.updatedAt) > Date.parse(latest.updatedAt) ? chat : latest).id
            : state.currentConversationId;
        set({ conversations, currentConversationId });
        return true;
    },
    selectConversation: (id) => { if (get().conversations.some((chat) => chat.id === id)) set({ currentConversationId: id }); },
    setDraft: (id, draft) => set((state) => ({ conversations: state.conversations.map((chat) => chat.id === id ? { ...chat, draft, updatedAt: new Date().toISOString() } : chat) })),
    appendTurn: (id, turn) => set((state) => ({ conversations: state.conversations.map((chat) => chat.id === id ? {
        ...chat, title: chat.turns.length ? chat.title : turn.question, turns: [...chat.turns, turn], updatedAt: new Date().toISOString(),
    } : chat) })),
    updateTurn: (conversationId, turnId, patch) => set((state) => ({ conversations: state.conversations.map((chat) => chat.id === conversationId ? {
        ...chat, turns: chat.turns.map((turn) => turn.id === turnId ? { ...turn, ...patch } : turn), updatedAt: new Date().toISOString(),
    } : chat) })),
}));

async function saveConversations() {
    dirty = true;
    if (saving || !useCompetitionChatStore.getState().hydrated || useCompetitionChatStore.getState().storageError) return;
    saving = true;
    try {
        while (dirty) {
            dirty = false;
            const write = async () => {
                const stored = JSON.stringify(await storage.getItem(STORAGE_KEY));
                if (stored !== expectedSnapshot) {
                    storageConflict = true;
                    throw new Error("历史已在另一页更新，本页改动尚未保存。请先复制未保存内容，再刷新页面");
                }
                const { conversations, currentConversationId } = useCompetitionChatStore.getState();
                const snapshot = { version: 1, conversations, currentConversationId };
                const serialized = JSON.stringify(snapshot);
                if (serialized !== stored) await storage.setItem(STORAGE_KEY, snapshot);
                expectedSnapshot = serialized;
            };
            if (typeof navigator !== "undefined" && navigator.locks) await navigator.locks.request("infinite-canvas:competition-chats", write);
            // ponytail: without Web Locks only one tab can safely write; use a secure-context browser for multi-tab editing.
            else await write();
        }
    } catch (error) {
        useCompetitionChatStore.setState({ storageError: `对话尚未保存，请勿关闭页面：${error instanceof Error ? error.message : "本地存储不可用"}` });
    } finally { saving = false; }
}

useCompetitionChatStore.subscribe((state, previous) => {
    if (state.hydrated && (state.conversations !== previous.conversations || state.currentConversationId !== previous.currentConversationId)) void saveConversations();
});
