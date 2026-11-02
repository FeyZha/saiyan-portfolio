import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";

import { localForageStorage } from "@/lib/localforage-storage";
import type { CompetitionCandidate, CompetitionWorkspace } from "@/types/workspace";

type WorkspaceStore = {
    hydrated: boolean;
    workspaces: CompetitionWorkspace[];
    competitionOrder: string[];
    archivedCompetitionIds: string[];
    currentWorkspaceId: string;
    lastWorkspaceByCompetition: Record<string, string>;
    selectedCompetitions: CompetitionCandidate[];
    toggleCompetition: (competition: CompetitionCandidate) => void;
    clearSelection: () => void;
    createWorkspace: (input: Omit<CompetitionWorkspace, "id" | "createdAt" | "updatedAt">) => CompetitionWorkspace;
    setCurrentWorkspace: (id: string) => void;
    setCompetitionOrder: (ids: string[]) => void;
    setCompetitionArchived: (id: string, archived: boolean) => void;
    updateWorkspace: (id: string, patch: Partial<Omit<CompetitionWorkspace, "id" | "competitionId" | "createdAt">>) => void;
    removeWorkspace: (id: string) => void;
    removeCompetition: (id: string) => void;
};

export const WORKSPACE_STORE_KEY = "competition-workbench:workspace_store";

export function getCompetitionOrder(workspaces: CompetitionWorkspace[], preferredOrder: string[] = []): string[] {
    const valid = new Set([...workspaces].reverse().filter((task) => task.canvasProjectId && task.competitionId).map((task) => task.competitionId));
    return [...new Set([...preferredOrder, ...valid])].filter((id) => valid.has(id));
}

export const useWorkspaceStore = create<WorkspaceStore>()(
    persist(
        (set) => ({
            hydrated: false,
            workspaces: [],
            competitionOrder: [],
            archivedCompetitionIds: [],
            currentWorkspaceId: "",
            lastWorkspaceByCompetition: {},
            selectedCompetitions: [],
            toggleCompetition: (competition) => set((state) => ({ selectedCompetitions: state.selectedCompetitions.some((item) => item.id === competition.id) ? state.selectedCompetitions.filter((item) => item.id !== competition.id) : [...state.selectedCompetitions, competition] })),
            clearSelection: () => set({ selectedCompetitions: [] }),
            createWorkspace: (input) => {
                const now = new Date().toISOString();
                const workspace = { ...input, id: nanoid(), createdAt: now, updatedAt: now };
                set((state) => {
                    const workspaces = [workspace, ...state.workspaces];
                    return { workspaces, competitionOrder: getCompetitionOrder(workspaces, state.competitionOrder), archivedCompetitionIds: state.archivedCompetitionIds.filter((id) => id !== workspace.competitionId), currentWorkspaceId: workspace.id, lastWorkspaceByCompetition: { ...state.lastWorkspaceByCompetition, [workspace.competitionId]: workspace.id } };
                });
                return workspace;
            },
            setCurrentWorkspace: (currentWorkspaceId) => set((state) => {
                const task = state.workspaces.find((item) => item.id === currentWorkspaceId);
                if (!task) return state;
                const viewedResult = task.status === "review_required" && task.nextAction !== "需要确认后继续";
                return {
                    currentWorkspaceId,
                    archivedCompetitionIds: state.archivedCompetitionIds.filter((id) => id !== task.competitionId),
                    lastWorkspaceByCompetition: { ...state.lastWorkspaceByCompetition, [task.competitionId]: task.id },
                    ...(viewedResult ? { workspaces: state.workspaces.map((item) => item.id === task.id ? { ...item, status: "working" as const, nextAction: "继续完善当前方案" } : item) } : {}),
                };
            }),
            setCompetitionOrder: (ids) => set((state) => {
                const order = getCompetitionOrder(state.workspaces, ids);
                if (ids.some((id) => state.archivedCompetitionIds.includes(id))) return { competitionOrder: order };
                const visible = order.filter((id) => !state.archivedCompetitionIds.includes(id));
                return { competitionOrder: getCompetitionOrder(state.workspaces, state.competitionOrder).map((id) => state.archivedCompetitionIds.includes(id) ? id : visible.shift()!) };
            }),
            setCompetitionArchived: (id, archived) => set((state) => {
                if (!state.workspaces.some((workspace) => workspace.competitionId === id)) return state;
                return {
                    archivedCompetitionIds: archived ? [...new Set([...state.archivedCompetitionIds, id])] : state.archivedCompetitionIds.filter((value) => value !== id),
                    ...(archived && state.workspaces.some((workspace) => workspace.id === state.currentWorkspaceId && workspace.competitionId === id) ? { currentWorkspaceId: "" } : {}),
                };
            }),
            updateWorkspace: (id, patch) => set((state) => {
                const workspaces = state.workspaces.map((workspace) => (workspace.id === id ? { ...workspace, ...patch, updatedAt: new Date().toISOString() } : workspace));
                return { workspaces, ...("canvasProjectId" in patch ? { competitionOrder: getCompetitionOrder(workspaces, getCompetitionOrder(state.workspaces, state.competitionOrder)) } : {}) };
            }),
            removeWorkspace: (id) => set((state) => {
                const workspaces = state.workspaces.filter((workspace) => workspace.id !== id);
                return { workspaces, competitionOrder: getCompetitionOrder(workspaces, getCompetitionOrder(state.workspaces, state.competitionOrder)), archivedCompetitionIds: state.archivedCompetitionIds.filter((competitionId) => workspaces.some((workspace) => workspace.competitionId === competitionId)), currentWorkspaceId: state.currentWorkspaceId === id ? "" : state.currentWorkspaceId, lastWorkspaceByCompetition: Object.fromEntries(Object.entries(state.lastWorkspaceByCompetition).filter(([, taskId]) => taskId !== id)) };
            }),
            removeCompetition: (id) => set((state) => {
                const workspaces = state.workspaces.filter((workspace) => workspace.competitionId !== id);
                return {
                    workspaces,
                    competitionOrder: getCompetitionOrder(workspaces, getCompetitionOrder(state.workspaces, state.competitionOrder)),
                    archivedCompetitionIds: state.archivedCompetitionIds.filter((value) => value !== id),
                    currentWorkspaceId: workspaces.some((workspace) => workspace.id === state.currentWorkspaceId) ? state.currentWorkspaceId : "",
                    lastWorkspaceByCompetition: Object.fromEntries(Object.entries(state.lastWorkspaceByCompetition).filter(([competitionId]) => competitionId !== id)),
                    selectedCompetitions: state.selectedCompetitions.filter((competition) => (competition.competitionId || competition.id) !== id),
                };
            }),
        }),
        {
            name: WORKSPACE_STORE_KEY,
            storage: {
                getItem: async (name) => JSON.parse((await localForageStorage.getItem(name)) || "null"),
                setItem: (name, value) => localForageStorage.setItem(name, JSON.stringify(value)),
                removeItem: (name) => localForageStorage.removeItem(name),
            },
            partialize: (state) => ({ workspaces: state.workspaces, competitionOrder: state.competitionOrder, archivedCompetitionIds: state.archivedCompetitionIds, currentWorkspaceId: state.currentWorkspaceId, lastWorkspaceByCompetition: state.lastWorkspaceByCompetition, selectedCompetitions: state.selectedCompetitions }) as WorkspaceStore,
            onRehydrateStorage: () => () => useWorkspaceStore.setState({ hydrated: true }),
        },
    ),
);
