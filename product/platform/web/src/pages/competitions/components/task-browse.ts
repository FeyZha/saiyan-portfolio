import type { PiCandidateTaskPreview } from "@/services/api/pi-competitions";
export function browseTasks(tasks: PiCandidateTaskPreview[], options: { group: string; category: string; query: string; page: number }, pageSize: number) {
    const query = options.query.trim().normalize("NFKC").toLocaleLowerCase();
    const matched = tasks.filter(task => (!options.group || (task.group || "未分赛道") === options.group) && (!options.category || task.category === options.category)
        && (!query || [task.title, task.description, task.submission].filter(Boolean).join("\n").normalize("NFKC").toLocaleLowerCase().includes(query)));
    const pages = Math.ceil(matched.length / pageSize), page = Math.min(Math.max(0, options.page), Math.max(0, pages - 1)), start = page * pageSize;
    return { tasks: matched.slice(start, start + pageSize), total: matched.length, pages, page, start };
}

/** Submitted requirements stay complete regardless of wording or heading format. */
export function coreSubmissionText(text: string) {
    return text.trim();
}
