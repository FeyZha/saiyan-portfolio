import { submissionFormFacts } from "./submission-form-facts.js";
type Data = Record<string, unknown>;
export type SubmissionDeliverable = { name: string; details?: string; description?: string; condition?: string };
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const missing = /未(?:说明|注明|明确|公布)|待确认|未知/;
const administration = /报名|登记表|承诺书|授权书|身份证|支付凭证|付款凭证|参赛表|信息表|版权协议|法律声明|汇总表|参赛文件夹/;
const internalReference = /(?:详见|参见|另见|见|按(?:照)?|依据|参照)?\s*\br\d+(?:\s*[、,，/及和]\s*r?\d+)*\b/gi;
const routine = /原文|本片段|未(?:说明|注明|明确|公布|规定|明示|载)|待确认|未知|命名|上传|报名|邮件|邮箱|发送至|发至|打印|签字|签名|盖章|文件夹|支付|缴费|汇款|登记表|承诺|授权|[\w.+-]+@[\w.-]+|https?:|www\./i;
const clausesOf = (value: string) => value.replace(internalReference, "").split(/[；;。\n]/).map(value => value.trim()).filter(Boolean);
/** Keep whole content clauses from this work item, not a keyword list or a guessed brief. */
function contentDescription(specs: string, requirements: string, name: string): string | undefined {
    // Parenthetical production details stay in the full instructions; the main list remains readable.
    const content = [specs, requirements.replace(/[（(][^（）()]*[）)]/g, "")].join("；");
    const clauses = clausesOf(content).filter(value => {
        if (routine.test(value) || /方向标题|获奖后|^(?:按|另见|详见|参见|见|适用|图片规格|提交规范|共用规则|共同规则|提交|要求|规格)$/.test(value)) return false;
        if (/^(?:无需|不要求|不必|按.*(?:规范|规则|格式)|作为.*提交|随.*提交|纳入.*(?:方案|设计|源文件)|总体要求必交|如有)/.test(value)) return false;
        // A format or measurement alone is already covered by details below.
        if (/dpi|RGB|CMYK|\d\s*(?:[MG](?:B)?\b|fps)|H\.26[45]|编码/i.test(value)) return false;
        const prose = value.replace(/\b(?:A[0-6]|[248]K|\d+P|PDF|PPT|MP4|JPG|PNG|GIF|ZIP|OBJ|FBX|STL|CAD|DWG|EXIF)\b/gi, "")
            .replace(/[\d\s\p{P}\p{S}a-z]/giu, "").replace(/格式|压缩包|尺寸|幅面|横竖不限|竖版|横版|横屏|竖屏|高清|分辨率|不低于|不超过|不少于|每件|每个|单张|张电子文档|时长|分钟|以内|以上|或|秒/g, "");
        return Boolean(prose) && !name.includes(value);
    });
    // Two complete statements describe the outcome without reprinting production instructions.
    return [...new Set(clauses)].slice(0, 2).join("；") || undefined;
}
/** A screening view of the saved work list, never a replacement for submission instructions. */
export function submissionDeliverables(record: Data, rules: Data[] = []): SubmissionDeliverable[] {
    const works = Array.isArray(record.workItems) ? record.workItems : [];
    return works.flatMap(work => {
        if (!work || typeof work !== "object" || !text(work.name) || administration.test(text(work.name))) return [];
        const name = text(work.name), requirements = text(work.submission_requirements);
        const quantity = clausesOf(text(work.quantity)).filter(part => !missing.test(part) && !routine.test(part)).join("；");
        const details = submissionFormFacts(text(work.specifications), requirements, rules, name, quantity,
            (value, scoped) => clausesOf(value).flatMap(part => scoped ? part.split(/[，,]/) : [part]).filter(part => !routine.test(part)).join("；"));
        // Common rules provide form facts only; do not turn general contest administration into a work description.
        const description = contentDescription(text(work.specifications), requirements, name);
        const condition = work.required === false ? "选交" : typeof work.required === "string" ? work.required.trim()
            : work.required == null && /^如有[，,]/.test(requirements) ? requirements.replace(/[。.]$/, "") : undefined;
        return [{ name, details, ...(description ? { description } : {}), condition }];
    });
}
