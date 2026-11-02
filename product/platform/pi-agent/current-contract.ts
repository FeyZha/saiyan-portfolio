import { cleanTaskText, cleanCreativeText } from "./creative-text.js";

export const CURRENT_COMPETITION_CONTRACT = 2;
export const CURRENT_COMPETITION_EPOCH = "competition-current-20261025";
const object = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const pick = (value: Record<string, any>, keys: string[]) => Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, structuredClone(value[key])]));

export function currentCreativeContent(task: Record<string, any>): string {
    const requirements = task.requirements;
    return cleanCreativeText(typeof requirements === "string" ? requirements : object(requirements)
        ? typeof requirements.creativeContent === "string" ? requirements.creativeContent : typeof requirements.creative === "string" ? requirements.creative : "" : "");
}

/** Calendar facts are independent of commentary. Never infer a year, choose a stage, or resolve a conflict. */
export function calendarDeadline(input: unknown): string | null {
    if (typeof input !== "string") return null;
    if (/暂定|拟定|预计|待定|待确认|待核|尚未确定|未确定|另行公布|另行通知|冲突|不明确|未明确|尚待|可能|当地时间|美国|英国|欧洲|日本|韩国|夏令/.test(input)) return null;
    const text = input.replace(/[（(][^）)]*(?:未注明|未说明|未标明|没有注明)[^）)]*[）)]/g, "")
        .replace(/(?:未|没有|尚未)(?:注明|说明|标明|标注)(?:年份[、，,和及]*)?(?:时刻[、，,和及]*)?时区/g, "");
    if (/暂定|拟定|预计|待定|待确认|待核|尚未确定|未确定|另行公布|另行通知|未知|冲突|不明确|未明确|尚待|可能|当地时间|美国|英国|欧洲|日本|韩国|夏令/.test(text)) return null;
    const normalized = text.replace(/北京时间/g, "").replace(/\b(?:UTC|GMT)\s*\+\s*0?8(?::?00)?(?![\d:.A-Za-z])/gi, "");
    if (/\b[A-Z]{2,5}\b|时区|[+-]\d{2}:?\d{2}|\d{2}:\d{2}Z/i.test(normalized)) return null;
    const matches = [...normalized.matchAll(/(?<!\d)(\d{4})(?:年|[-/.])(\d{1,2})(?:月|[-/.])(\d{1,2})(?:日)?(?!\d)/g)];
    if (matches.length !== 1) return null;
    const match = matches[0], rest = normalized.slice(0, match.index) + normalized.slice(match.index! + match[0].length);
    if (/(?<!\d)\d{1,2}月\d{1,2}日?|(?<!\d)\d{1,2}[-/.]\d{1,2}(?!\d)/.test(rest) || /^\s*(?:至|到|~|～)/.test(normalized.slice(match.index! + match[0].length))) return null;
    if (/报名|赛期|比赛时间|举行时间|展览时间|初赛|决赛|开赛|开始|启动/.test(normalized) && !/截止|截至|投稿|作品提交|提交作品/.test(normalized)) return null;
    if (/报名/.test(normalized) && !/投稿|作品提交|提交作品/.test(normalized)) return null;
    const iso = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
    const date = new Date(`${iso}T00:00:00Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

export function normalizeCurrentBundle<T extends Record<string, any>>(input: T): T {
    if (input.contract !== undefined && input.contract !== CURRENT_COMPETITION_CONTRACT)
        throw new Error("旧任务材料不能通过添加当前版本标记升级，请使用当前入库格式。");
    const result: Record<string, any> = structuredClone(input);
    result.contract = CURRENT_COMPETITION_CONTRACT;
    result.tasks = input.tasks.map((task: Record<string, any>) => cleanTaskText(pick(task,
        ["id", "scopePointer", "title", "shortTheme", "requirements", "workItems", "ruleRefs", "evidenceRefs", "track", "category", "status"])));
    for (const task of result.tasks) if (!currentCreativeContent(task)) task.status = "unknown";
    result.rules = input.rules.map((rule: Record<string, any>) => ({ ...pick(rule, ["id", "appliesTo", "status", "content", "evidenceRefs"]),
        content: typeof rule.content === "string" ? cleanCreativeText(rule.content) : rule.content }));
    for (const key of ["submissionForms", "feeStatus", "submissionDeadline"]) result.facts[key] = input.facts[key].map((original: Record<string, any>) => {
        const fact = pick(original, ["scopePointer", "value", "status", "evidenceRefs", "alternatives"]);
        if (key !== "submissionDeadline") return fact;
        // A task's explicit date wins. A conflicting task never inherits a common date.
        if (fact.status === "unknown") {
            const task = result.tasks.find((task: Record<string, any>) => task.scopePointer === fact.scopePointer);
            const rules = result.rules.filter((rule: Record<string, any>) => rule.status === "explicit" && task?.ruleRefs.includes(rule.id) && rule.appliesTo.includes(task.id)
                && !input.conflicts?.some((conflict: Record<string, any>) => conflict.kind === "rule" && conflict.id === rule.id));
            const dates = rules.flatMap((rule: Record<string, any>) => {
                const text = typeof rule.content === "string" ? rule.content : object(rule.content) ? Object.values(rule.content).filter(value => typeof value === "string").join("\n") : "";
                return text.split(/[；;。\n]/).filter(part => /截止|截至/.test(part)).flatMap(part => calendarDeadline(part) ? [{ value: part, date: calendarDeadline(part), refs: rule.evidenceRefs }] : []);
            });
            if (new Set(dates.map((row: any) => row.date)).size === 1) Object.assign(fact, { status: "known", value: dates[0].value, evidenceRefs: [...new Set(dates.flatMap((row: any) => row.refs))] });
        }
        fact.date = fact.status === "known" ? calendarDeadline(fact.value) : null;
        fact.time = null; fact.timeZone = null;
        if (fact.date) {
            const value = String(fact.value), clock = value.match(/(?<!\d)([01]?\d|2[0-3])[:：]([0-5]\d)(?!\d)/) ?? value.match(/(?<!\d)([01]?\d|2[0-3])时(?:([0-5]?\d)分)?/);
            fact.time = clock ? `${clock[1].padStart(2, "0")}:${(clock[2] || "00").padStart(2, "0")}` : null;
            fact.timeZone = /北京时间|\b(?:UTC|GMT)\s*\+\s*0?8(?::?00)?/i.test(value) ? "Asia/Shanghai" : null;
            fact.value = fact.date + (fact.time ? ` ${fact.time}` : "") + (fact.timeZone ? " 北京时间" : "");
        } else if (fact.status === "known") { fact.status = "unknown"; fact.value = null; }
        return fact;
    });
    delete result.baseIndexHash;
    return result as T;
}

export function validCurrentDeadline(fact: Record<string, any>) {
    return Object.hasOwn(fact, "date") && (fact.date === null ? fact.status !== "known" : fact.status === "known"
        && typeof fact.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fact.date) && calendarDeadline(fact.value) === fact.date)
        && (fact.time === null || typeof fact.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(fact.time))
        && [null, "Asia/Shanghai"].includes(fact.timeZone);
}
