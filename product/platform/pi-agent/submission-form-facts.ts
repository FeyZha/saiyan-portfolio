type Rule = Record<string, unknown>;
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
type Block = { label: string; content: string };
// These are explicit headings in saved requirements, not classifications guessed from a work title.
const heading = /(?:^|[。；;\n：:①②③④⑤⑥⑦⑧⑨⑩])\s*((?:(?:如|若)(?:另附|采用|提交)?|另附|选交|适用于)?(?:静态设计作品|动态媒体、视频作品|平面及数字类效果图|短视频、微纪录片|动态海报|动态短片|线上展览文件|线下展览文件|宣传海报|作品设计图|展示视频|平面设计类|平面视觉类|平面类|图片类稿件|视频类稿件|动态类作品|图片类|图片规格|静态作品|静态文件|静态类|动态呈现作品|动态作品|动态文件|动态类|视频类|视频（动画）|数字影像类|数字文创类|设计方案类|创意产品类|实物文创类|实物类|交互类|动图|静态|动态))(?=[：:，,、\s]|以|提交|须|需|按|单|展示|时长|尺寸|高清|分辨率|作品|规格|不|在|一律|统一|为|[A-Z0-9])/g;
export const submissionFormFamily = (label: string) => /动态|视频|影像|动图|纪录片/.test(label) ? "motion" : /平面|图片|静态|海报|设计图|展览文件/.test(label) ? "image" : label.replace(/^(?:如|若)(?:另附|采用|提交)?/, "");
export function submissionFormBlocks(value: string): Block[] {
    const hits = [...value.matchAll(heading)];
    if (!hits.length) return [{ label: "", content: value }];
    return [ ...(hits[0].index! > 0 ? [{ label: "", content: value.slice(0, hits[0].index) }] : []),
        ...hits.map((hit, i) => ({ label: hit[1], content: value.slice(hit.index! + hit[0].length, hits[i + 1]?.index ?? value.length) })) ];
}
function basics(value: string, name: string, quantity: string): string[] {
    const content = value.replace(/横屏或(?:\d+:\d+)?竖屏/g, "横屏或竖屏")
        // A separately required companion is not a specification of the current outcome.
        .split(/[。；;](?=\s*(?:另须提交|另需提交|须另附|获奖后))/)[0];
    const result: string[] = [];
    const measurements = /\bA[0-6]\b|\b[248]K(?:高清)?|横竖不限|横竖屏均可|横竖版均可|横竖屏自选|横屏、竖屏皆可|横屏或竖屏|竖版|横版|竖式|横式|横屏|竖屏|(?:不超过|不少于|至少|至多|≤|≥)?\d+(?:\s*(?:分钟|秒))?[—–~～-]\d+\s*(?:分钟|秒)(?:以内|以上|左右)?|(?:不超过|不少于|至少|至多|≤|≥)?\d+\s*(?:分钟|秒)(?:以内|以上|左右)?|\d+(?:\.\d+)?\s*(?:cm|mm)\s*[×x*]\s*\d+(?:\.\d+)?\s*(?:cm|mm)/gi;
    for (const match of content.matchAll(measurements)) {
        const prefix = content.slice(0, match.index).split(/[，,；;。]/).at(-1) || "";
        if (/不要求|无需|不必|不限于|例如|如$/.test(prefix)) continue;
        if (/cm|mm/i.test(match[0]) && /\bA[0-6]\b/i.test(content)) continue;
        if (name.includes(match[0]) || quantity.includes(match[0])) continue;
        const qualifier = /推荐|建议/.test(prefix) ? "推荐" : /可选/.test(prefix) ? "可选" : prefix.match(/(?:大于|小于|不小于|不低于|至少|不少于)\s*$/)?.[0].trim() || "";
        result.push(qualifier + match[0]);
    }
    const formats: string[] = [];
    for (const clause of content.split(/[；;。]/)) {
        if (/不要求|无需|不必|获奖|命名/.test(clause)) continue;
        for (const match of clause.matchAll(/\b(?:PDF|PPT|MP4|OBJ|FBX|STL)\b/gi)) {
            const prefix = clause.slice(0, match.index).split(/[，,、]/).at(-1) || "";
            formats.push((/推荐|建议/.test(prefix) ? "推荐" : "") + match[0].toUpperCase());
        }
    }
    if (formats.length) result.push([...new Set(formats)].join("/"));
    return [...new Set(result)];
}
/** Intake-only: preserve each format's applicability before extracting any compact facts. */
export function submissionFormFacts(specs: string, requirements: string, rules: Rule[], name: string, quantity: string, cleanShared: (value: string, scoped: boolean) => string): string | undefined {
    const groups = new Map<string, string[]>();
    const own = basics(specs, name, quantity).join(" ");
    const ownImage = /\bA[0-6]\b|\d\s*(?:cm|mm)/i.test(own) || /\b(?:PNG|JPG|JPEG)\b/i.test(specs), ownMotion = /\bMP4\b|秒|分钟/i.test(own);
    const ownFamily = !/同时|均须|都须|一并/.test(specs + requirements) && ownImage !== ownMotion ? ownImage ? "image" : "motion" : "";
    const add = (block: Block) => {
        const values = basics(block.content, name, quantity);
        if (values.length) groups.set(block.label, [...new Set([...(groups.get(block.label) || []), ...values])]);
    };
    submissionFormBlocks(specs).forEach(add);
    // Bind each reference to its local qualifier: "图片规格见r3" cannot import r3's video section.
    const references = new Map<string, Set<string>>();
    for (const clause of [specs, requirements].flatMap(value => value.split(/[；;。\n]/))) {
        const labels = submissionFormBlocks(clause).map(block => block.label).filter(Boolean);
        // Reference qualifiers can follow ordinary prose, e.g. "须提交，图片规格见r3".
        const qualifier = clause.match(/(图片规格|平面类|动态类|设计方案类|数字文创类|实物文创类)[^；。]*\br\d+\b/);
        if (qualifier) labels.push(qualifier[1]);
        for (const ref of clause.match(/\br\d+\b/gi) || []) {
            const selected = references.get(ref) || new Set<string>();
            (labels.length ? labels : [""]).forEach(label => selected.add(submissionFormFamily(label)));
            references.set(ref, selected);
        }
    }
    for (const rule of rules) {
        const selected = references.get(String(rule.id)); if (!selected) continue;
        const content = typeof rule.content === "string" ? rule.content
            : rule.content && typeof rule.content === "object" ? text((rule.content as Rule).submission) : "";
        const sections = submissionFormBlocks(content), hasSections = sections.some(block => block.label);
        const effective = selected.has("") && ownFamily ? new Set([ownFamily]) : selected;
        for (const block of sections) {
            if (effective.has("") || (!hasSections && !block.label) || effective.has(submissionFormFamily(block.label))) {
                if (/^(?:选交)?(?:作品设计图|宣传海报|展示视频)$/.test(block.label) && !name.includes(block.label.replace(/^选交/, ""))) continue;
                const cleaned = cleanShared(block.content, Boolean(block.label));
                const facts = basics(cleaned, name, quantity).join(" ");
                if (!block.label && ownFamily === "motion" && /\bA[0-6]\b|\d\s*(?:cm|mm)/i.test(facts)) continue;
                if (!block.label && ownFamily === "image" && /\bMP4\b|秒|分钟/i.test(facts)) continue;
                add({ ...block, content: cleaned });
            }
        }
    }
    const qualified = [...groups].filter(([label]) => label).flatMap(([, facts]) => facts);
    const plain = [...new Set([quantity, ...(groups.get("") || []).filter(fact => !qualified.includes(fact))].filter(Boolean))].join(" · ");
    const scoped = [...groups].filter(([label]) => label).map(([label, facts]) => `${label}：${facts.join(" · ")}`);
    return [plain, ...scoped].filter(Boolean).join("\n") || undefined;
}
