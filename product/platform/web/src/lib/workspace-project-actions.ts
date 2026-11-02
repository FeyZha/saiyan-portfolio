import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useWorkspaceStore } from "@/stores/use-workspace-store";

export function archiveCompetitionProject(competitionId: string) {
    useWorkspaceStore.getState().setCompetitionArchived(competitionId, true);
}

export function deleteCompetitionProject(competitionId: string) {
    const store = useWorkspaceStore.getState();
    const tasks = store.workspaces.filter((task) => task.competitionId === competitionId);
    const projectIds = tasks.flatMap((task) => task.canvasProjectId || []);
    const canvases = useCanvasStore.getState();
    if (tasks.some((task) => task.status === "generating" || task.nextAction === "需要确认后继续") || canvases.projects.some((project) => projectIds.includes(project.id) && project.nodes.some((node) => node.metadata?.status === "loading" || node.metadata?.images?.some((image) => image.status === "loading") || node.metadata?.texts?.some((text) => text.status === "loading")))) {
        throw new Error("该项目仍有任务运行或等待确认，请先结束任务再删除；也可以先归档。");
    }
    canvases.deleteProjects(projectIds);
    store.removeCompetition(competitionId);
}
