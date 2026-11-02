/** One calendar convention for relative query dates, expiry and the desktop countdown. */
export const COMPETITION_TIME_ZONE = "Asia/Shanghai";
const snapshotInstant = (globalThis as { SAIYAN_SNAPSHOT_NOW?: string }).SAIYAN_SNAPSHOT_NOW;
export function beijingDate(now = new Date(snapshotInstant || Date.now())): string {
    return new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}
export function resolveQueryDate(value: string | undefined, now = new Date()): string | undefined {
    if (value === undefined) return;
    const offset = ({ yesterday: -1, today: 0, tomorrow: 1 } as Record<string, number>)[value];
    return offset === undefined ? value : beijingDate(new Date(now.getTime() + offset * 86_400_000));
}
export function competitionClockPrompt(instant: string): string {
    return `本轮开始时间（UTC）：${instant}。业务时区：${COMPETITION_TIME_ZONE}（北京时间）。本轮今天：${beijingDate(new Date(instant))}。相对日期查询必须使用today/tomorrow/yesterday，由程序换算；不要截取UTC日期或自行换算。“今天还来得及”表示截止下限today，不等于只找今天截止。日期冲突或时区不明保留未知，不把未截止说成已开放。`;
}
export function currentDeadlineExpired(fact: { status?: unknown; date?: unknown; time?: unknown; timeZone?: unknown } | undefined, now = new Date()): boolean {
    if (fact?.status !== "known" || typeof fact.date !== "string") return false;
    if (fact.date < beijingDate(now)) return true;
    // A clock without an explicit zone cannot establish an intraday cutoff.
    return fact.timeZone === COMPETITION_TIME_ZONE && typeof fact.time === "string"
        && now.getTime() > Date.parse(`${fact.date}T${fact.time}:00+08:00`);
}
