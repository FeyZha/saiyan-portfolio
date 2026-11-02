/** Remove source-omission commentary by clause, keeping substantive clauses and source evidence untouched. */
export function cleanCreativeText(value: string): string {
    let omission = false;
    const content = value.replace(/(?:原文|公告|资料)(?:未|没有)(?:标明|注明|说明)[^，,；;。！？\n的]+的(?=文件|材料|作品)/g, "");
    const chunks = content.match(/[^，,；;。！？\n]+[，,；;。！？\n]?|[，,；;。！？\n]/g) || [];
    return chunks.map(chunk => {
        const text = chunk.trim().replace(/[，,；;。！？]$/, "");
        const source = /^(?:(?:任务内容未知|缺口说明|整理备注|资料说明)[：:]\s*)?(?:(?:现有|所给|本次|当前|所提供的|本次提供的)?(?:原文|公告|资料|材料))(?:中)?/.exec(text);
        const body = source ? text.slice(source[0].length) : "";
        const missing = source && /^(?:(?:未|没有)(?:(?:另行|另|单独|分别|进一步|明确|统一|具体|再))*(?:设|列|给出|提供|说明|规定|限定|细化|描述|标明|注明|明确|确定|要求)|(?:仅|只)(?:列|提供|说明)|另提示见官网|另指|指向附件|[“"「].*(?:未提供|未列出))/.test(body);
        const continuation = omission && /^(?:(?:也|亦|且|并|同时|本次|目前)?(?:未|没有)|(?:无法|不能)(?:确认|据此|进一步|确定|恢复|拆分)|[“"「].*(?:未提供|未说明|未明确))/.test(text);
        const remove = Boolean(missing || continuation);
        omission = /[。！？\n]$/.test(chunk) ? false : remove;
        return remove ? "" : chunk;
    }).join("").trim().replace(/[；;，,]+$/, "。");
}

/** Only derived task text is cleaned; identities, facts, evidence refs and quotes are never traversed. */
export function cleanTaskText<T extends Record<string, unknown>>(record: T): T {
    const copy: Record<string, unknown> = { ...record };
    for (const key of ["shortTheme", "creativeContent", "themeTask", "description", "submissionFormat", "finalSubmissionFormat", "submissionRequirements"])
        if (typeof copy[key] === "string") copy[key] = cleanCreativeText(copy[key]);
    if (typeof copy.requirements === "string") copy.requirements = cleanCreativeText(copy.requirements);
    else if (copy.requirements && typeof copy.requirements === "object" && !Array.isArray(copy.requirements)) {
        const requirements = { ...copy.requirements } as Record<string, unknown>;
        for (const key of ["creativeContent", "creative", "submission"]) if (typeof requirements[key] === "string") requirements[key] = cleanCreativeText(requirements[key]);
        copy.requirements = requirements;
    }
    return copy as T;
}
