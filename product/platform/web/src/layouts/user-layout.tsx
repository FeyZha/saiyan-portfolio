import { useEffect, useState, type ReactNode } from "react";
import { useMatch } from "react-router-dom";

import { AgentPanel } from "@/components/agent/agent-panel";
import { AppTopNav } from "@/components/layout/app-top-nav";
import { WorkspaceSession } from "@/components/workspace/workspace-session";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useWorkspaceStore } from "@/stores/use-workspace-store";
import { defaultAgentStore } from "@/stores/use-agent-store";

export default function UserLayout({ children }: { children: ReactNode }) {
    const match = useMatch("/canvas/:id");
    const projectId = match?.params.id;
    const projects = useCanvasStore((state) => state.projects);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const workspaceHydrated = useWorkspaceStore((state) => state.hydrated);
    const workspaces = useWorkspaceStore((state) => state.workspaces);
    const restoring = workspaces.filter((task) => task.status === "generating" || task.nextAction === "需要确认后继续").flatMap((task) => task.canvasProjectId || []);
    const restoringKey = restoring.join(",");
    const [visited, setVisited] = useState<string[]>([]);
    useEffect(() => { defaultAgentStore.setState({ visible: !projectId }); }, [projectId]);
    useEffect(() => {
        setVisited((ids) => {
            const next = [...new Set([...ids, ...restoring, ...(projectId ? [projectId] : [])])];
            return next.length === ids.length ? ids : next;
        });
    }, [projectId, restoringKey]);
    const sessions = hydrated && workspaceHydrated ? [...new Set([...visited, ...restoring, ...(projectId ? [projectId] : [])])].filter((id) => projects.some((project) => project.id === id)) : [];
    return (
        <div className="relative flex h-dvh overflow-hidden bg-background text-foreground">
            <div className="min-w-0 flex-1 flex-col overflow-hidden" style={{ display: projectId ? "none" : "flex" }}>
                <AppTopNav />
                <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
            </div>
            {sessions.map((id) => <WorkspaceSession key={id} projectId={id} active={id === projectId} />)}
            <div className="flex" style={{ display: projectId ? "none" : "flex" }}><AgentPanel /></div>
        </div>
    );
}
