import { useState } from "react";
import { ArchiveRestore, ArrowRight, CalendarDays, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { createWorkspaceFromCompetition } from "@/lib/workspace-actions";
import { useWorkspaceStore } from "@/stores/use-workspace-store";
import { WorkspaceStatusBadge } from "@/components/workspace/workspace-status-badge";

export default function WorkspaceOverview() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const workspaces = useWorkspaceStore((state) => state.workspaces);
    const currentId = useWorkspaceStore((state) => state.currentWorkspaceId);
    const setCurrent = useWorkspaceStore((state) => state.setCurrentWorkspace);
    const archivedIds = useWorkspaceStore((state) => state.archivedCompetitionIds);
    const [showArchived, setShowArchived] = useState(false);
    const visible = workspaces.filter((workspace) => archivedIds.includes(workspace.competitionId) === showArchived);
    const competitionCount = new Set(workspaces.map((workspace) => workspace.competitionId)).size;

    const open = (id: string, canvasProjectId?: string) => {
        if (!canvasProjectId) return;
        setCurrent(id);
        navigate(`/canvas/${canvasProjectId}`);
    };
    const create = () => {
        const workspace = createWorkspaceFromCompetition({ id: `competition-${Date.now()}`, title: `新竞赛 ${workspaces.length + 1}` });
        open(workspace.id, workspace.canvasProjectId);
    };

    return (
        <main className="h-full overflow-y-auto bg-[#f7f7f5] px-6 py-10 text-stone-950 dark:bg-stone-950 dark:text-stone-100 md:px-12">
            <div className="mx-auto max-w-5xl">
                <header className="mb-8 flex items-end justify-between gap-6">
                    <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">{t("workspace.count", { count: competitionCount })}</p>
                        <h1 className="text-3xl font-semibold tracking-tight">{t("workspace.overview")}</h1>
                        <p className="mt-2 text-sm text-stone-500">{t("workspace.overviewDescription")}</p>
                    </div>
                    <button type="button" onClick={create} className="inline-flex items-center gap-2 rounded-xl bg-stone-950 px-4 py-2.5 text-sm font-semibold transition hover:bg-stone-800" style={{ color: "white" }}>
                        <Plus className="size-4" />
                        {t("workspace.create")}
                    </button>
                </header>
                <div className="mb-4 flex gap-5" aria-label="项目范围">
                    {[false, true].map((archived) => <button key={String(archived)} type="button" aria-pressed={showArchived === archived} onClick={() => setShowArchived(archived)} className={`border-b-2 pb-2 text-sm transition ${showArchived === archived ? "border-current font-semibold" : "border-transparent text-stone-500 hover:text-stone-700 dark:hover:text-stone-300"}`}>
                        {archived ? "已归档" : "在进行"} {archived ? archivedIds.length : competitionCount - archivedIds.length}
                    </button>)}
                </div>
                {showArchived && <p className="mb-4 text-xs text-stone-500">归档保留画布、对话与作品，后台任务继续运行。点击项目可恢复并继续创作。</p>}
                <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
                    {visible.map((workspace, index) => (
                        <button
                            key={workspace.id}
                            type="button"
                            onClick={() => open(workspace.id, workspace.canvasProjectId)}
                            className={`group grid w-full grid-cols-[minmax(0,1fr)_auto] gap-6 px-5 py-5 text-left transition hover:bg-stone-50 dark:hover:bg-stone-800/60 ${index ? "border-t border-stone-100 dark:border-stone-800" : ""}`}
                        >
                            <span className="min-w-0">
                                <span className="flex items-center gap-2">
                                    <span className="truncate text-base font-semibold">{workspace.title}{workspace.taskTitle ? ` · ${workspace.taskTitle}` : ""}</span>
                                    {workspace.id === currentId ? <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold text-stone-500 dark:bg-stone-800">{t("workspace.current")}</span> : null}
                                </span>
                                <span className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-stone-500">
                                    <WorkspaceStatusBadge status={workspace.status} />
                                    {workspace.deadline ? (
                                        <span className="inline-flex items-center gap-1.5">
                                            <CalendarDays className="size-3.5" />
                                            {t("workspace.deadline")} {workspace.deadline}
                                        </span>
                                    ) : null}
                                    <span>
                                        {t("workspace.nextAction")} · {workspace.nextAction || t("workspace.next.continueWork")}
                                    </span>
                                </span>
                            </span>
                            {showArchived ? <span className="inline-flex items-center gap-1.5 text-xs text-stone-500"><ArchiveRestore className="size-4" />恢复项目</span> : <ArrowRight className="mt-1 size-4 text-stone-300 transition group-hover:translate-x-0.5 group-hover:text-stone-700 dark:group-hover:text-stone-200" />}
                        </button>
                    ))}
                    {!visible.length && <p className="px-5 py-10 text-center text-sm text-stone-500">{showArchived ? "暂无归档项目" : "暂无进行中的项目"}</p>}
                </div>
            </div>
        </main>
    );
}
