export type WorkspaceStatus = "not_started" | "working" | "generating" | "review_required" | "ready" | "submission_preparing" | "submission_ready" | "submitted" | "error";

export type CompetitionWorkspace = {
    id: string;
    competitionId: string;
    directionId?: string;
    directionTitle?: string;
    submissionDirectionId?: string;
    creationCategory?: string;
    submissionFormat?: string;
    finalSubmissionFormat?: string;
    sourceVersion?: string;
    title: string;
    taskTitle?: string;
    draft?: string;
    deadline?: string;
    brief?: string;
    themeTask?: string;
    creativeContent?: string;
    sourceUrl?: string;
    organizer?: string;
    designTypes?: string[];
    fee?: string;
    status: WorkspaceStatus;
    nextAction?: string;
    canvasProjectId?: string;
    agentThreadId?: string;
    submissionStatus?: string;
    createdAt: string;
    updatedAt: string;
};

export type CompetitionCandidate = { id: string; title: string; competitionId?: string; competitionTitle?: string; directionId?: string; submissionDirectionId?: string; creationCategory?: string; submissionFormat?: string; finalSubmissionFormat?: string; sourceVersion?: string; deadline?: string; brief?: string; themeTask?: string; creativeContent?: string; organizer?: string; sourceUrl?: string; designTypes?: string[]; fee?: string };
