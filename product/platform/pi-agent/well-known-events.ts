/** A small editorial discovery list, not a quality score, ranking or submission permission. */
export const WELL_KNOWN_VISUAL_LIST = "well_known_visual" as const;
export const WELL_KNOWN_VISUAL_EVENTS = [
    { id: "milan", name: "米兰设计周—中国高校设计学科师生优秀作品展", url: "https://www.milan-aap.org.cn/",
        pattern: /^米兰设计周-?中国高校设计学科师生优秀作品展/u },
    { id: "cdec", name: "中国好创意暨全国数字艺术设计大赛", url: "https://www.cdec.org.cn/",
        pattern: /^(?:\d{4}年?)?(?:第[\d一二三四五六七八九十百]+届)?(?:中国)?好创意(?:暨|大赛|[丨|｜·])/u },
    { id: "oda", name: "东方设计奖·全国高校创新设计大赛", url: "https://www.oda.org.cn/",
        pattern: /^(?:\d{4}年?)?(?:第[\d一二三四五六七八九十百]+届)?东方设计奖(?:$|[·\-（(]|全国高校创新设计大赛|主视觉|命题|非命题)/u },
    { id: "ncda", name: "未来设计师·全国高校数字艺术设计大赛（NCDA）", url: "https://www.ncda.org.cn/",
        pattern: /^未来设计师[·-]?全国高校数字艺术设计大赛/u },
    { id: "daguangsai", name: "全国大学生广告艺术大赛（大广赛）", url: "https://www.sun-ada.net/",
        pattern: /^全国大学生广告艺术大赛/u },
    { id: "academy", name: "大学生广告艺术节学院奖", url: "https://www.admen.cn/content/32332",
        pattern: /^(?:中国)?大学生广告艺术节[·-]?学院奖/u },
    { id: "golden-calf", name: "时报金犊奖国际竞赛", url: "https://www.timesawards.com.tw/",
        pattern: /^(?:(?:时报|時報)(?:广告|廣告)?金[犊犢][奖奬獎]|金[犊犢][奖奬獎]国际竞赛)/u },
    { id: "platinum", name: "白金创意国际大学生平面设计大赛", url: "https://www.platinumaward.org/",
        pattern: /^(?:设计你的镇馆之宝[|｜](?:第[\d一二三四五六七八九十百]+届)?)?白金创意(?:国际大学生平面设计大赛|主题竞赛)/u },
    { id: "ktk", name: "KTK设计奖·全球华人设计比赛（靳埭强设计奖）", url: "https://www.ktkda.cn/",
        pattern: /^(?:KTK设计奖|靳埭强设计奖)/iu },
    { id: "huacan", name: "新锐设计竞赛·华灿奖", url: "https://www.huacanjiang.com/",
        pattern: /^(?:两岸)?新锐设计竞赛[·-]?华灿奖/u },
    { id: "gdc", name: "GDC设计奖", url: "https://www.gdcaward.com/",
        pattern: /^GDC设计奖/iu },
] as const;

export function wellKnownVisualEvent(title: unknown) {
    if (typeof title !== "string") return undefined;
    const normalized = title.normalize("NFKC").replace(/[\s“”"'‘’「」『』《》]/gu, "")
        .replace(/[—–－]/gu, "-").replace(/[•・‧]/gu, "·")
        .replace(/^(?:\d{4}(?:[-/]\d{4})?年?)?(?:第[\d一二三四五六七八九十百]+届)?/u, "");
    return WELL_KNOWN_VISUAL_EVENTS.find(event => event.pattern.test(normalized));
}
