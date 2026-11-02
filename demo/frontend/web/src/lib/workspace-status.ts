import i18n from "@/i18n";
import { useWorkspaceStore } from "@/stores/use-workspace-store";
import type { WorkspaceStatus } from "@/types/workspace";

export function workspaceStatusLabel(status: WorkspaceStatus) {
    return i18n.t(`workspace.status.${status}`);
}

export function workspaceStatusColor(status: WorkspaceStatus) {
    if (status === "generating") return "#2563eb";
    if (status === "review_required" || status === "submission_preparing") return "#d97706";
    if (status === "ready" || status === "submission_ready" || status === "submitted") return "#16a34a";
    if (status === "error") return "#dc2626";
    return "#78716c";
}

export function updateWorkspaceStatus(workspaceId: string, status: WorkspaceStatus, nextAction?: string) {
    useWorkspaceStore.getState().updateWorkspace(workspaceId, { status, nextAction });
}

export const workspaceEvents = {
    generationStarted: (workspaceId: string) => updateWorkspaceStatus(workspaceId, "generating", i18n.t("workspace.next.waitGeneration")),
    generationCompleted: (workspaceId: string) => updateWorkspaceStatus(workspaceId, "review_required", i18n.t("workspace.next.reviewResult")),
    generationFailed: (workspaceId: string) => updateWorkspaceStatus(workspaceId, "error", i18n.t("workspace.next.checkFailure")),
    generationCanceled: (workspaceId: string) => updateWorkspaceStatus(workspaceId, "working", i18n.t("workspace.next.continueWork")),
    reviewCompleted: (workspaceId: string) => updateWorkspaceStatus(workspaceId, "ready", i18n.t("workspace.next.continueWork")),
};
