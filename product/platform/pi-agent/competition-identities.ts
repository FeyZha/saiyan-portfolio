/** Resolve user names against real catalogue identities before reading any facts. */
export const nameKey = (value: string) => value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
export type CatalogueEntry = { id: string; title: string; tasks: { title: string; scopePointer: string; taskId?: string }[] };
type TargetQuery = { id: string | undefined; query: string; scopes: string[] | undefined };
export type TargetResolution = { status: "unique" | "ambiguous" | "not_found"; input: string;
    ids: string[]; candidates: { id: string; title: string }[]; queries: TargetQuery[] };
const descriptors = ["作品征集活动", "作品征集大赛", "设计征集活动", "作品征集", "图形图案", "城市标识",
    "设计大赛", "设计比赛", "征集大赛", "征集活动", "设计奖", "全民征集", "主题", "图案", "征集", "大赛", "比赛", "设计", "文创"];
const editionPattern = /第([0-9一二三四五六七八九十百两零〇]+)届/gu;
function editionNumber(value: string) {
    if (/^\d+$/.test(value)) return Number(value);
    const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    let sum = 0, digit = 0;
    for (const char of value) { if (char === "十" || char === "百") { sum += (digit || 1) * (char === "十" ? 10 : 100); digit = 0; }
        else if (digits[char] !== undefined) digit = digits[char]; else return NaN; }
    return sum + digit;
}
function constraintsMatch(query: string, title: string) {
    const input = query.normalize("NFKC").toLocaleLowerCase(), source = title.normalize("NFKC").toLocaleLowerCase();
    const editions = [...input.matchAll(editionPattern)].map(m => editionNumber(m[1]));
    const storedEditions = [...source.matchAll(editionPattern)].map(m => editionNumber(m[1]));
    if (!editions.every(n => storedEditions.includes(n))) return false;
    const withoutEditions = input.replace(editionPattern, ""), storedWithoutEditions = source.replace(editionPattern, "");
    const numbers: string[] = withoutEditions.match(/\d+/g) || [], storedNumbers: string[] = storedWithoutEditions.match(/\d+/g) || [];
    if (!numbers.every(n => storedNumbers.includes(n))) return false;
    const latin = input.match(/[a-z]+/g) || [];
    const storedLatin = [...(source.match(/[a-z]+/g) || []), ...(source.replace(/(?<=[a-z])[\s'’\-]+(?=[a-z])/g, "").match(/[a-z]+/g) || [])];
    return latin.filter(s => !["ip", "vi", "logo"].includes(s)).every(s => storedLatin.includes(s));
}
function nameCore(value: string) {
    let core = value.normalize("NFKC").toLocaleLowerCase().replace(editionPattern, "")
        .replace(/(?<![a-z])(?:ip|vi|logo)(?![a-z])/g, "");
    core = nameKey(core);
    for (const descriptor of descriptors) core = core.replaceAll(descriptor, "");
    return core;
}
function orderedCharacters(needle: string, haystack: string) {
    let cursor = 0;
    for (const char of haystack) if (char === needle[cursor]) cursor++;
    return cursor === needle.length;
}
function hasNameAnchor(core: string, title: string) {
    // Two scattered characters alone are not a reliable name, e.g. 秦卫 must not become 秦小卫.
    return [...core].some((_, i) => i + 1 < core.length && title.includes(core.slice(i, i + 2)) && /\p{L}/u.test(core.slice(i, i + 2)));
}
function preferNamedParent(matches: CatalogueEntry[]) {
    if (matches.length < 2) return matches;
    const parents = matches.filter(entry => matches.every(other => nameKey(other.title).startsWith(nameKey(entry.title))));
    return parents.length === 1 ? parents : matches;
}
function titleMatches(query: string, catalogue: CatalogueEntry[]) {
    const core = nameCore(query);
    if ((core.match(/\p{L}/gu) || []).length < 2) return [];
    const eligible = catalogue.filter(entry => constraintsMatch(query, entry.title));
    // Match the informative name, so a generic suffix such as IP cannot select one city out of several.
    const matches = eligible.filter(entry => {
        const title = nameKey(entry.title);
        return title.includes(core) || hasNameAnchor(core, title) && orderedCharacters(core, title);
    });
    return preferNamedParent(matches);
}
export function taskNames(title: string) {
    const full = nameKey(title);
    return [...new Set([full, full.replace(/(?:作品征集|作品投稿|作品设计|作品|投稿|征集)$/, "")])].filter(Boolean);
}
export function selectNamedTasks<T extends { title: string; taskId?: string }>(tasks: T[], names: string[]): T[] {
    const selected = names.flatMap(name => {
        const exact = tasks.filter(task => task.title === name || task.taskId === name);
        const matches = exact.length ? exact : tasks.filter(task => taskNames(task.title).includes(nameKey(name)));
        if (matches.length !== 1) throw new Error("所选任务名称没有唯一精确匹配，请从当前任务列表选择。");
        return matches;
    });
    return [...new Set(selected)];
}
export function identifyCompetitionTarget(target: string, catalogue: CatalogueEntry[]): TargetResolution {
    const make = (queries: TargetQuery[]): TargetResolution => {
        const ids = [...new Set(queries.map(q => q.id).filter((id): id is string => Boolean(id)))];
        return { status: queries.length === 1 ? "unique" : queries.length ? "ambiguous" : "not_found", input: target, ids,
            candidates: ids.map(id => ({ id, title: catalogue.find(entry => entry.id === id)!.title })), queries };
    };
    const exactId = catalogue.find(entry => entry.id === target);
    if (exactId) return make([{ id: exactId.id, query: exactId.title, scopes: undefined }]);
    const exact = catalogue.filter(entry => nameKey(entry.title) === nameKey(target));
    if (exact.length) return make(exact.map(entry => ({ id: entry.id, query: entry.title, scopes: undefined })));
    // Explicit task/category suffixes keep their exact scope; fuzzy matching never selects a task.
    const key = nameKey(target), combined: TargetQuery[] = [];
    for (const entry of catalogue) for (const task of entry.tasks) for (const alias of taskNames(task.title)) {
        const prefix = key.endsWith(alias) ? key.slice(0, -alias.length) : "";
        if (prefix && titleMatches(prefix, catalogue).some(match => match.id === entry.id))
            combined.push({ id: entry.id, query: entry.title, scopes: [task.scopePointer] });
    }
    const uniqueCombined = [...new Map(combined.map(row => [JSON.stringify([row.id, row.scopes]), row])).values()];
    if (uniqueCombined.length) return make(uniqueCombined);
    return make(titleMatches(target, catalogue).map(entry => ({ id: entry.id, query: entry.title, scopes: undefined })));
}
/** Compatibility helper; the workflow uses structured resolution to render clarification without a tool error. */
export function resolveCompetitionTargets(targets: string[], catalogue: CatalogueEntry[]) {
    return targets.flatMap<TargetQuery>(target => {
        const result = identifyCompetitionTarget(target, catalogue);
        if (result.status === "ambiguous") throw new Error("竞赛名称或任务类别对应多个条目，请补充具体竞赛。");
        return result.status === "unique" ? result.queries : [{ id: undefined, query: target, scopes: undefined }];
    });
}
