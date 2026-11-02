import { flushCanvasPersistence, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { competitionCreativeBrief } from "@/lib/competition-brief";
import { useWorkspaceStore } from "@/stores/use-workspace-store";
import type { CompetitionCandidate, CompetitionWorkspace } from "@/types/workspace";

export function createWorkspaceFromCompetition(competition: CompetitionCandidate, taskTitle?: string) {
    const competitionId = competition.competitionId || competition.id;
    const existing = useWorkspaceStore.getState().workspaces.find((item) => item.competitionId === competitionId && item.directionId === competition.directionId);
    const content = competitionCreativeBrief(competition.themeTask, competition.submissionFormat, competition.finalSubmissionFormat, competition.creativeContent);
    if (existing && !taskTitle) {
        const project = useCanvasStore.getState().projects.find((item) => item.id === existing.canvasProjectId);
        const source = project?.nodes.find((node) => node.id === `pi-brief-${project.id}` && node.type === "text" && node.metadata?.content === competition.brief);
        const goal = project?.nodes.find((node) => node.id === `brief-${project.id}`);
        if (competition.directionId?.startsWith("pi:") && project && source && existing.brief === competition.brief
            && ((!goal && !existing.directionTitle) || (goal?.title === "创作目标" && goal.metadata?.content === competitionCreativeBrief(existing.themeTask, existing.submissionFormat, existing.finalSubmissionFormat, existing.creativeContent)))) {
            const fields = { directionTitle: competition.title, themeTask: competition.themeTask, creativeContent: competition.creativeContent, submissionFormat: competition.submissionFormat, finalSubmissionFormat: competition.finalSubmissionFormat, deadline: competition.deadline };
            useWorkspaceStore.getState().updateWorkspace(existing.id, fields);
            // shortcut: cached canvas views need one refresh after this one-time graft; add live node sync if repeated external updates are needed.
            useCanvasStore.getState().updateProject(project.id, { nodes: goal
                ? project.nodes.map((node) => node === goal ? { ...node, metadata: { ...node.metadata, content } } : node)
                : [...project.nodes, { id: `brief-${project.id}`, type: "text", title: "创作目标", position: { x: source.position.x + source.width + 80, y: source.position.y }, width: 760, height: 500, metadata: { content, fontSize: 18 } }] });
            return { ...existing, ...fields };
        }
        return existing;
    }
    const title = taskTitle || (competition.directionId ? competition.title : "创作任务");
    const canvasProjectId = useCanvasStore.getState().createProject(title);
    useCanvasStore.getState().updateProject(canvasProjectId, {
        nodes: [
            { id: `brief-${canvasProjectId}`, type: "text", title: "创作目标", position: { x: 80, y: 120 }, width: 760, height: 500, metadata: { content, fontSize: 18 } },
            ...(competition.directionId?.startsWith("pi:") ? [{ id: `pi-brief-${canvasProjectId}`, type: "text", title: "Agent 任务书", position: { x: 80, y: 720 }, width: 760, height: 500, metadata: { content: competition.brief || "", fontSize: 18 } }] : []),
        ],
        backgroundMode: "dots",
        viewport: { x: 40, y: 80, k: 0.8 },
    });
    return useWorkspaceStore.getState().createWorkspace({
        competitionId,
        directionId: competition.directionId,
        directionTitle: competition.directionId ? competition.title : undefined,
        submissionDirectionId: competition.submissionDirectionId,
        creationCategory: competition.creationCategory,
        submissionFormat: competition.submissionFormat,
        finalSubmissionFormat: competition.finalSubmissionFormat,
        sourceVersion: competition.sourceVersion,
        title: competition.competitionTitle || competition.title,
        taskTitle: title,
        deadline: competition.deadline,
        brief: competition.brief,
        themeTask: competition.themeTask,
        creativeContent: competition.creativeContent,
        sourceUrl: competition.sourceUrl,
        organizer: competition.organizer,
        designTypes: competition.designTypes,
        fee: competition.fee,
        status: "not_started",
        nextAction: competition.themeTask ? "开始构思作品" : "明确创作目标",
        canvasProjectId,
    });
}

export async function createWorkspaceTask(workspace: CompetitionWorkspace) {
    const count = useWorkspaceStore.getState().workspaces.filter((item) => item.competitionId === workspace.competitionId && item.directionId === workspace.directionId).length;
    const created = createWorkspaceFromCompetition({ ...workspace, id: workspace.directionId || workspace.competitionId, competitionTitle: workspace.title, title: workspace.directionTitle || workspace.title }, `${workspace.directionTitle || workspace.taskTitle || "创作任务"} ${count + 1}`);
    await flushCanvasPersistence();
    return created;
}
