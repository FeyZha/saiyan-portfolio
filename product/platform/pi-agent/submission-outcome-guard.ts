type Data = Record<string, any>;
/** New intake only: never retroactively invalidate preserved material/history during reads. */
export function unexpandedSubmissionOutcomes(tasks: Data[]) {
    return tasks.flatMap(task => {
        const works: Data[] = task.workItems || [];
        const primary = works.filter(work => /^主体/.test(String(work.role)));
        const groups = new Set(works.flatMap(work => String(work.role || "").match(/提交选项[一二三四五六七八九\d]+/g) || []));
        const alternatives = primary.filter(work => typeof work.required === "string" && /选择.+(?:必交|二选一)|类必交/.test(work.required));
        const submission = String(task.requirements?.submission || "");
        // File exports, optional demonstration videos, review stages and mandatory bundles do not qualify.
        const explicit = groups.size > 1 || alternatives.length > 1
            || primary.filter(work => work.role === "主体作品形式之一").length > 1
            || /(?:本任务)?提交内容[（(：:\s]*(?:可)?二选一/.test(submission);
        return explicit ? [`alternative_submission_results_not_expanded:${task.id}`] : [];
    });
}
