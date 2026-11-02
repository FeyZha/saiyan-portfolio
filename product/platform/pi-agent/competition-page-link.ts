import { officialNavigationEntries } from "./six-field-ingestion.js";

export type CompetitionPageLink = { url: string; label: "竞赛官网" | "查看公告" };
function publicPage(value: unknown): string | undefined {
    if (typeof value !== "string") return;
    try {
        const url = new URL(value);
        if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) return url.href;
    } catch { /* No guessed or executable URLs. */ }
}
/** Navigation only, from archived sources. A sponsor homepage is not the competition homepage. */
export function competitionPageLink(sourceUrl: unknown, resources: Parameters<typeof officialNavigationEntries>[0]): CompetitionPageLink | undefined {
    const official = officialNavigationEntries(resources).find(({ authorityEvidence: proof }) => {
        const beforeUrl = proof.quote.slice(0, proof.quote.indexOf(proof.statedUrl));
        return /(?:大赛|竞赛|赛事|奖|作品展|展览)(?:官方)?(?:官网|网站|平台|系统)\s*[：:（(]?\s*$/u.test(beforeUrl);
    });
    const url = publicPage(official?.url);
    if (url) return { url, label: "竞赛官网" };
    const announcement = publicPage(sourceUrl);
    if (announcement) return { url: announcement, label: "查看公告" };
}
