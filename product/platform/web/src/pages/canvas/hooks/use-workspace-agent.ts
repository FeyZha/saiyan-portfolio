import { useEffect } from "react";

import { useAgentStoreApi, useAgentStore } from "@/stores/use-agent-store";
import { useWorkspaceStore } from "@/stores/use-workspace-store";

export function useWorkspaceAgent(projectId: string, active: boolean) {
    const agentStore = useAgentStoreApi();
    const workspaces = useWorkspaceStore((state) => state.workspaces);
    const workspace = workspaces.find((item) => item.canvasProjectId === projectId);
    const connected = useAgentStore((state) => state.connected);
    const request = useAgentStore((state) => state.workspaceThreadRequest);
    const ready = useAgentStore((state) => state.workspaceThreadReady);

    useEffect(() => {
        if (active && workspace) useWorkspaceStore.getState().setCurrentWorkspace(workspace.id);
    }, [active, workspace?.id]);

    useEffect(() => {
        if (!connected || !workspace) return;
        if (ready?.workspaceId === workspace.id && ready.threadId === (workspace.agentThreadId || "")) return;
        if (request?.workspaceId === workspace.id && request.threadId === (workspace.agentThreadId || "")) return;
        agentStore.getState().setAgentState({
            workspaceThreadRequest: { requestId: (request?.requestId || 0) + 1, workspaceId: workspace.id, threadId: workspace.agentThreadId || "" },
        });
    }, [connected, request, ready, workspace]);

    useEffect(() => {
        if (!workspace || ready?.workspaceId !== workspace.id || !ready.threadId || ready.threadId === workspace.agentThreadId) return;
        useWorkspaceStore.getState().updateWorkspace(workspace.id, { agentThreadId: ready.threadId });
    }, [ready, workspace]);

    return workspace;
}
