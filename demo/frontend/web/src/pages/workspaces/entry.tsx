import { Navigate, useParams } from "react-router-dom";
import { CanvasRefreshShell } from "@/components/canvas/canvas-refresh-shell";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useWorkspaceStore } from "@/stores/use-workspace-store";

export default function WorkspaceEntry() {
    const { id } = useParams();
    const { hydrated, workspaces, currentWorkspaceId, archivedCompetitionIds } = useWorkspaceStore();
    const canvasHydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    if (!hydrated || !canvasHydrated) return <CanvasRefreshShell />;
    if (id && projects.some((project) => project.id === id)) return null;
    const available = workspaces.filter((workspace) => !archivedCompetitionIds.includes(workspace.competitionId) && projects.some((project) => project.id === workspace.canvasProjectId));
    const workspace = available.find((item) => item.id === currentWorkspaceId) || available[0];
    return <Navigate replace to={workspace ? `/canvas/${workspace.canvasProjectId}` : archivedCompetitionIds.length ? "/workspaces" : "/competitions"} />;
}
