export function competitionTextMissing(value?: string): boolean {
    return !value?.trim() || /^(未公布|未说明|未提供|未确认|暂无|待定|待确认|详见官网)[。！.!]?$/.test(value.trim());
}

export function detailParagraphs(value: string): string[] {
    // Split explicit topic markers without changing their requirements or choices.
    return value.replace(/([。；;、，])\s*(?=(?:主题|命题|任务|方向)[一二三四五六七八九十\d]+(?:[（(：:]|含|为)|(?:核心要求|总体要求)[：:])/g, "$1\n\n")
        .split(/\r?\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
}

export function legacyCompetitionCreativeBrief(themeTask?: string, submissionFormat?: string): string {
    const delivery = submissionFormat?.trim() && submissionFormat.trim() !== "未公布" ? `\n\n交付要求\n${submissionFormat.trim()}` : "";
    // Use an explicit quoted theme when present; never guess a theme from the competition title.
    const theme = themeTask?.trim().match(/^(?:赛事主题|大赛主题|主题)[：:\s]*[“「"]([^”」"]+)[”」"][。；;]?\s*([\s\S]*)$/);
    if (theme?.[2]) return `主题\n${theme[1]}\n\n最终作品\n${detailParagraphs(theme[2]).join("\n\n")}${delivery}`;
    const paragraphs = detailParagraphs(themeTask || "");
    return `主题与最终作品\n\n${paragraphs.length && themeTask?.trim() !== "未公布" ? paragraphs.join("\n\n") : "待明确：补充创作主题和要完成的作品。"}${delivery}`;
}

export function compactCompetitionCreativeBrief(themeTask?: string, submissionFormat?: string): string {
    const source = themeTask?.trim() === "未公布" ? "" : themeTask?.trim() || "";
    const technical = /(?:JPE?G|PNG|GIF|PDF|RGB|CMYK|DPI|MP4|H\.264|\d\s*(?:MB|dpi|mm|px)|分辨率|文件大小|色彩模式|格式提交|源文件|字体转曲)/i;
    const artwork = /(?:图稿|形象图|三视图|动态展示|表情包|场景图|效果图|设计图|平铺图|版面|海报|短片|视频|条漫|漫画|动画|样品|作品集|报告书|提案|包装|标志|Logo|VI|IP|故事|模型)/i;
    const rules = /^(?:(?:共通|共同|通用|总体)(?:参赛)?(?:要求|规则)|参赛要求|版权|原创要求|AI使用|AI规则|报名|投稿方式|提交方式|格式规范|尺寸要求|源文件|输出文件|作品规范|参赛资格|所属赛道|背景介绍)[：:（(\s]/;
    const parts = detailParagraphs(source.replace(/(?=(?:(?:共通|共同|通用|总体)(?:参赛)?(?:要求|规则)|本赛道内容要求|设计内容|创作范围)[：:])/g, "\n"))
        .map((part) => part.replace(/^(?:共通主题|赛事主题|大赛主题|创作主题|主题)[：:\s]*[“「"]?[^。\n]+?[”」"]?[。]\s*/, "")).filter(Boolean);
    const category = source.match(/^本次创作类别[：:]\s*([^\n]+)/m)?.[1]?.trim();
    const categoryScope = category ? parts.find((part) => /^创作范围[：:]/.test(part)) : undefined;
    const scopeStart = parts.findIndex((part) => /^(?:创作范围|本赛道内容要求)[：:]/.test(part));
    const task = (categoryScope ? [categoryScope] : parts.slice(Math.max(0, scopeStart)).filter((part) => !rules.test(part) && !/^核心要求[：:](?:\s*(?:原创|不得抄袭|不得侵权|禁止抄袭|禁止侵权)[，,。；;]?)+$/.test(part) && !/^(?:共通主题|赛事主题|大赛主题|创作主题|主题|本次创作类别)[：:\s“「"]/.test(part)))
        .map((part) => part.replace(/^(?:创作范围|本赛道内容要求|本赛道任务|设计内容|创作任务|任务[一二三四五六七八九十\d]*)[：:]\s*/, "")
            .replace(/[，,。；;]\s*(?:评审|评分|评选)[\s\S]*$/, "").trim()).filter(Boolean).join("\n");
    // ponytail: use explicit theme labels/phrases; unfamiliar prose stays a task instead of guessing a theme.
    const theme = source.match(/(?:以|围绕)[“「"]([^”」"]+)[”」"](?:为(?:核心|主题)|主题)/)?.[1]
        || source.match(/(?:赛事主题|大赛主题|创作主题|共通主题|主题)(?:[：:]\s*|\s*(?=[“「"]))[“「"]?([^”」"\n。；]+)/)?.[1];
    const content: string[] = [];
    const delivery = (submissionFormat || "").split(/(?:适用的)?(?:(?:共通|共同|通用|总体)(?:参赛)?(?:要求|规则)|作品规范)[：:（(]/)[0];
    for (const line of detailParagraphs(delivery)) {
        if (rules.test(line)) continue;
        const lineStart = content.length;
        const clauses = line.replace(/^(?:(?:[一二三四五六七八九十\d]+[、.．]|[（(][一二三四五六七八九十\d]+[）)])\s*|(?:格式要求|提交要求|交付要求)[：:]\s*)/, "")
            .split(/[，,；;](?![^（()）]*[）)])/);
        for (const clause of clauses) {
            let item = clause.trim().replace(/[。；;]$/, "");
            // Retain a named work when its first clause immediately switches to file specifications.
            if (technical.test(item) && artwork.test(item.split(/[：:]/)[0]) && /[：:]/.test(item)) item = item.split(/[：:]/)[0];
            // A file format inside a named work must not erase that work or its contents.
            if (artwork.test(item)) item = item.replace(/\b(?:JPE?G|PNG|GIF|PDF|MP4)(?:格式)?[，,、]?/gi, "").replace(/[（(]\s*[）)]/g, "");
            if (!item || /(?:无需|不需|版权|侵权|原创性|作者|学校|报名|上传|存证|格式|模式|分辨率|大小|文件|尺寸)/.test(item) || technical.test(item)) continue;
            if (artwork.test(item) || /(?:任选|二选一|必交|选交|必须.*(?:完成|提交)|全部.*(?:完成|提交))/.test(item)) content.push(item);
            else if (content.length > lineStart && /(?:[一二两三四五六七八九十\d]+\s*(?:幅|张|个|款|组|秒|分钟)|或|二选一)/.test(item)) content[content.length - 1] += `，${item}`;
        }
    }
    return [
        `要做什么\n${category && !task.includes(category) ? `${category}\n` : ""}${task || [...new Set(content)].join("；") || "待明确：要完成的作品。"}`,
        theme ? `创作主题\n${theme}` : "",
        content.length ? `作品内容\n${[...new Set(content)].map((item) => `• ${item}`).join("\n")}` : "",
    ].filter(Boolean).join("\n\n");
}

export function competitionThemeDescription(themeTask?: string): string {
    // ponytail: use explicit themes or a single named assignment's opening overview; other prose remains a task.
    const paragraphs = detailParagraphs((themeTask || "").replace(/(?=(?:本次创作类别|创作范围|本赛道内容要求|创作任务|设计内容|作品类别|创作类别|作品类型|所属赛道|所属设计领域|赛道原始说明|(?:共通|共同|通用|总体)(?:参赛)?(?:要求|规则))[：:])/g, "\n"));
    const theme: string[] = [];
    let collecting = false;
    for (const paragraph of paragraphs) {
        const heading = paragraph.match(/^(?:共通主题|赛事主题|大赛主题|创作主题|主题)(?:[：:]\s*|(?=[“「"]))([\s\S]*)/);
        if (heading) {
            collecting = true;
            theme.push(heading[1]);
        } else if (/^(?:本次创作类别|创作范围|本赛道内容要求|本赛道任务|创作任务|设计内容|作品类别|创作类别|作品类型|所属赛道|所属设计领域|任务[一二三四五六七八九十\d]*|赛道原始说明|(?:共通|共同|通用|总体)(?:参赛)?(?:要求|规则)|核心要求|参赛资格|背景介绍)[：:]/.test(paragraph)) {
            collecting = false;
        } else if (collecting) theme.push(paragraph);
    }
    if (theme.length) return theme.join("\n");
    const assignment = /^(?:【命题[一二三四五六七八九十\d]+】|命题[一二三四五六七八九十\d]+[：:])/;
    if (!assignment.test(paragraphs[0] || "") || paragraphs.filter((paragraph) => assignment.test(paragraph)).length !== 1) return "";
    const overview = (paragraphs[1] || "").replace(/[，,；;]?\s*(?:作品|创作|设计)内容(?:须|需|应)?(?:包含|包括)(?:但不限于)?以下(?:方面|内容|部分)?[：:]?$/, "").trim();
    return /^(?:请)?(?:以|围绕|根据|结合|立足)/.test(overview) && /(?:主题|原型|文化|精神|理念|记忆)/.test(overview) && /(?:创作|设计)/.test(overview)
        && !/(?:格式|分辨率|色彩模式|源文件|文件大小|JPE?G|PNG|PDF|DPI|CMYK|RGB)/i.test(overview) ? overview : "";
}

export function previousCompetitionCreativeBrief(themeTask?: string, submissionFormat?: string): string {
    const compact = new Map(compactCompetitionCreativeBrief(themeTask, submissionFormat).split("\n\n").map((section) => {
        const [label, ...lines] = section.split("\n");
        return [label, lines.join("\n")];
    }));
    const task = compact.get("要做什么") || "";
    const works = compact.get("作品内容") || "";
    const delivery = (submissionFormat?.trim() === "未公布" ? "" : submissionFormat || "")
        .split(/(?:适用的)?(?:(?:共通|共同|通用|总体)(?:参赛)?(?:要求|规则)|作品规范)[：:（(]/)[0];
    return [
        `主题阐述\n${competitionThemeDescription(themeTask) || compact.get("创作主题") || "资料未单独说明，以创作内容中的命题为准。"}`,
        `创作内容\n${[task, works].filter(Boolean).join("\n")}`,
        `提交形式\n${detailParagraphs(delivery).join("\n") || "资料未明确提交形式。"}`,
    ].join("\n\n");
}

export const DEFAULT_FINAL_SUBMISSION_FORMAT = "A3 展板（默认）";

export function submissionImageRatio(finalSubmissionFormat?: string): string {
    if (!/\bA3\b/i.test(finalSubmissionFormat || "")) return "";
    return /横版|横向|landscape/i.test(finalSubmissionFormat || "") ? "3:2" : "2:3";
}

export function previousBoardCompetitionCreativeBrief(themeTask?: string, submissionFormat?: string, finalSubmissionFormat?: string): string {
    const previous = previousCompetitionCreativeBrief(themeTask, submissionFormat);
    const [creative, delivery] = previous.split("\n\n提交形式\n");
    const final = detailParagraphs(finalSubmissionFormat || "").join("\n");
    return `${creative}\n\n最终提交形式\n${final || `${delivery}\n以上为已存交付要求，最终提交形式尚未单独确认。请核对展板尺寸、张数、分辨率及文件格式。`}\n创作方式：直接生成完整展板，将所需作品与说明编排在整张画面内；多张展板逐张生成，额外必交材料仍按竞赛要求保留。`;
}

export function competitionCreativeBrief(themeTask?: string, submissionFormat?: string, finalSubmissionFormat?: string, creativeContent?: string): string {
    if (creativeContent !== undefined) return `创作主题\n${themeTask || "资料未明确主题。"}\n\n要完成什么\n${creativeContent}\n\n最终提交物\n${finalSubmissionFormat || DEFAULT_FINAL_SUBMISSION_FORMAT}`;
    const sections = new Map(previousCompetitionCreativeBrief(themeTask, submissionFormat).split("\n\n").map((section) => {
        const [label, ...lines] = section.split("\n");
        return [label, lines.join("\n")];
    }));
    return [
        `创作主题\n${sections.get("主题阐述")}`,
        `要完成什么\n${sections.get("创作内容")}`,
        `最终提交物\n${detailParagraphs(finalSubmissionFormat || "").join("\n") || DEFAULT_FINAL_SUBMISSION_FORMAT}`,
    ].join("\n\n");
}
