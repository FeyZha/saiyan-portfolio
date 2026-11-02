type Data = Record<string, unknown>;
export type TableField = "title" | "submissionForms" | "fee" | "deadline";
const records = (value: unknown): Data[] => Array.isArray(value) ? value.filter(value => value && typeof value === "object" && !Array.isArray(value)) : [];
const list = (value: unknown): string[] => Array.isArray(value) ? value.filter((value): value is string => typeof value === "string") : [];

/** Business values only. The initial table never carries task identities, requirements or evidence. */
export function compactTaskFields(result: Data, tasks: Data[], fields: readonly TableField[]) {
    const output: Data = {};
    if (fields.includes("submissionForms")) {
        output.submissionForms = [...new Set(tasks.flatMap(task => list((task.submissionForms as Data | undefined)?.categories)))];
        const states = tasks.map(task => (task.submissionForms as Data | undefined)?.factState);
        if (states.includes("conflict")) output.submissionFormsState = "conflict";
        else if (states.includes("unknown")) output.submissionFormsState = "unknown";
    }
    for (const field of ["fee", "deadline"] as const) {
        if (!fields.includes(field)) continue;
        const rules = records(result[field]), values = new Map<string, Data & { taskCount: number }>();
        for (const task of tasks) {
            const rule = rules[Number(task[field === "fee" ? "feeRule" : "deadlineRule"])] || {};
            const value = { ...(field === "fee" ? { status: rule.status === "free" || rule.status === "paid" ? rule.status : "unknown" }
                : { date: typeof rule.date === "string" ? rule.date : null, status: typeof rule.date === "string" ? "known" : "unknown" }),
                ...(rule.factState && rule.factState !== "known" ? { factState: rule.factState } : {}) };
            const key = JSON.stringify(value), found = values.get(key);
            if (found) found.taskCount++;
            else values.set(key, { ...value, taskCount: 1 });
        }
        const variants = [...values.values()];
        if (variants.length === 1) { const { taskCount: _count, ...value } = variants[0]; output[field] = value; }
        else output[field] = { status: variants.length ? "varies" : "unknown", variants };
    }
    return output;
}

export function compactDirectoryTask(result: Data, task: Data, fields: readonly TableField[]) {
    const relations = task.taskRelations as Data | undefined;
    return { taskId: task.taskId, scopeId: task.scopeId, scopePointer: task.scopePointer, title: task.title,
        conditions: { status: task.status, pending: Object.entries((task.conditions || {}) as Data)
            .filter(([, value]) => value === "unknown").map(([field]) => field) },
        ...(task.requiredTogether ? { requiredTogether: true } : {}),
        ...(relations ? { relation: { status: relations.status, pending: relations.pending } } : {}),
        ...compactTaskFields(result, [task], fields) };
}

export function compactTableRow(result: Data, fields: readonly TableField[], versionToken: string) {
    const tasks = records(result.submissionTasks), confirmation = result.confirmation as Data | undefined;
    const labels: Record<string, string> = { submissionForms: "作品类型", fee: "收费情况", deadline: "截止时间", designTypes: "作品类型", feeStatus: "收费情况", deadlineFrom: "投稿截止下限", deadlineTo: "投稿截止上限" };
    const relevant = new Set([...fields, ...list((result.conditions as Data | undefined)?.pending)].map(field => labels[field]));
    const pending = list(confirmation?.unverifiedConditions).filter(label => relevant.has(label) || /关联|独立|任务范围/.test(label));
    return { libraryId: result.libraryId, versionToken, conditions: result.conditions, taskCount: tasks.length,
        ...(confirmation ? { confirmation: { status: pending.length ? "needs_user_confirmation" : "matches_recorded_conditions", pending } } : {}),
        ...(fields.includes("title") ? { title: result.title } : {}), ...compactTaskFields(result, tasks, fields) };
}

type PendingRows = [string, string[]][];
type QueryPending = { filters: PendingRows; fields: PendingRows; relations: PendingRows };
export type ColumnRows = { columns: string[]; rows: unknown[][] };
export type CompactCompetitionTable = ColumnRows & {
    format: "competition_table_v2"; pending: QueryPending;
    material: { default: string; exceptions: [string, string, unknown?][] };
};
export type CompactTaskDirectory = ColumnRows & {
    format: "submission_task_directory_v2"; libraryId: string; taskCount: number;
    pending: QueryPending; relations: [string, unknown][]; requiredTogether: string[];
    materialStatus: string;
};
const conditionLabels: Record<string, string> = { designTypes: "作品类型", feeStatus: "收费情况", deadlineFrom: "投稿截止下限", deadlineTo: "投稿截止上限" };
const stateMeaning = "rows按columns读取；null表示未记录，空类型表示未知，未请求列不表示缺失。pending.filters仅本次筛选未知，其余筛选条件匹配；pending.fields为所选字段待核，pending.relations为关联/独立性待核。无待核记录不等于资料齐全、官网复核或独立投稿已确认。legacy_prepared_record为旧整理，pending_preparation为待整理。";

function pendingRows(rows: Data[], identity: string): QueryPending {
    const pending: QueryPending = { filters: [], fields: [], relations: [] };
    for (const row of rows) {
        const id = String(row[identity]), unknown = list((row.conditions as Data | undefined)?.pending);
        if (unknown.length) pending.filters.push([id, unknown]);
        const labels = new Set(unknown.map(key => conditionLabels[key] || key));
        if (unknown.some(key => key === "deadlineFrom" || key === "deadlineTo")) labels.add("截止时间");
        const additional = list((row.confirmation as Data | undefined)?.pending).filter(label => !labels.has(label));
        const relations = additional.filter(label => /关联|独立|任务范围|冲突/.test(label));
        const fields = additional.filter(label => !relations.includes(label));
        if (fields.length) pending.fields.push([id, fields]);
        if (relations.length) pending.relations.push([id, relations]);
    }
    return pending;
}

/** Column names and default states occur once; full identities/versions stay in the library's read state. */
export function packCompetitionTable(rows: Data[], fields: readonly TableField[]): CompactCompetitionTable & { meaning: string } {
    const columns = ["libraryId", "taskCount", ...fields];
    if (fields.includes("submissionForms") && rows.some(row => row.submissionFormsState !== undefined)) columns.push("submissionFormsState");
    return { format: "competition_table_v2", columns, rows: rows.map(row => columns.map(column => row[column] ?? null)),
        pending: pendingRows(rows, "libraryId"), meaning: stateMeaning,
        material: { default: "legacy_prepared_record", exceptions: rows.filter(row => row.materialStatus !== "legacy_prepared_record" || row.preparationState !== undefined)
            .map(row => row.preparationState === undefined ? [String(row.libraryId), String(row.materialStatus)]
                : [String(row.libraryId), String(row.materialStatus), row.preparationState]) } };
}

/** Pure decoder for consumers and saved offline comparisons; it never restores a version from model text. */
export function decodeColumnRows(table: ColumnRows): Data[] {
    if (!Array.isArray(table.columns) || table.columns.some(column => typeof column !== "string") || new Set(table.columns).size !== table.columns.length
        || !Array.isArray(table.rows) || table.rows.some(row => !Array.isArray(row) || row.length !== table.columns.length)) throw new Error("查询列与行结构无效");
    return table.rows.map(row => Object.fromEntries(table.columns.map((column, index) => [column, row[index]])));
}

function restorePending(row: Data, id: string, pending: QueryPending) {
    const unknown = pending.filters.find(([key]) => key === id)?.[1] || [];
    const additional = [...pending.fields.filter(([key]) => key === id).flatMap(([, value]) => value),
        ...pending.relations.filter(([key]) => key === id).flatMap(([, value]) => value)];
    const unverified = [...unknown.map(key => conditionLabels[key] || key), ...additional];
    return { ...row, conditions: { status: unknown.length ? "unknown" : "match", pending: unknown },
        confirmation: { status: unverified.length ? "needs_user_confirmation" : "matches_recorded_conditions", pending: unverified } };
}

export function decodeCompetitionTableRows(table: CompactCompetitionTable): Data[] {
    return decodeColumnRows(table).map(row => {
        const id = String(row.libraryId), material = table.material.exceptions.find(([key]) => key === id);
        return { ...restorePending(row, id, table.pending), materialStatus: material?.[1] || table.material.default,
            ...(material?.[2] !== undefined ? { preparationState: material[2] } : {}) };
    });
}

export function packTaskDirectory(libraryId: string, tasks: Data[], fields: readonly TableField[], materialStatus: string): CompactTaskDirectory & { meaning: string } {
    const columns = ["scopePointer", "title", ...fields.filter(field => field !== "title")];
    if (fields.includes("submissionForms") && tasks.some(row => row.submissionFormsState !== undefined)) columns.push("submissionFormsState");
    const rows = tasks.map(task => ({ ...task, confirmation: { pending: [] } }));
    const pending = pendingRows(rows, "scopePointer");
    pending.relations = tasks.flatMap(task => {
        const unknown = list((task.relation as Data | undefined)?.pending);
        return unknown.length ? [[String(task.scopePointer), unknown] as [string, string[]]] : [];
    });
    return { format: "submission_task_directory_v2", libraryId, columns, rows: rows.map(row => columns.map(column => (row as Data)[column] ?? null)),
        pending, taskCount: tasks.length, materialStatus, meaning: stateMeaning,
        relations: tasks.flatMap(task => task.relation ? [[String(task.scopePointer), (task.relation as Data).status] as [string, unknown]] : []),
        requiredTogether: tasks.filter(task => task.requiredTogether).map(task => String(task.scopePointer)) };
}

export function decodeTaskDirectoryRows(directory: CompactTaskDirectory): Data[] {
    return decodeColumnRows(directory).map(row => {
        const pointer = String(row.scopePointer), relation = directory.relations.find(([key]) => key === pointer);
        return { ...restorePending(row, pointer, directory.pending),
            ...(relation ? { relation: { status: relation[1], pending: directory.pending.relations.find(([key]) => key === pointer)?.[1] || [] } } : {}),
            ...(directory.requiredTogether.includes(pointer) ? { requiredTogether: true } : {}) };
    });
}
