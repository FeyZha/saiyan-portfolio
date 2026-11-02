import type { PreparedTask, PreparedRule } from "./prepared-materials.js";
import { submissionFormBlocks, submissionFormFamily } from "./submission-form-facts.js";
import { cardHash } from "./competition-card-store.js";

type Data = Record<string, unknown>;
const text = (value: unknown) => typeof value === "string" ? value : "";
const object = (value: unknown): value is Data => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const ruleText = (rule: PreparedRule) => typeof rule.content === "string" ? rule.content : object(rule.content) ? text(rule.content.submission) : "";
const selectable = (label: string) => /^(?:平面类|平面设计类|静态类|图片类|动态类|视频类|数字文创类|设计方案类|创意产品类|实物文创类|实物类)$/.test(label);
const together = /(?:平面|静态|图片).{0,12}(?:和|与|及|、).{0,8}(?:动态|视频).{0,12}(?:均须|都须|必交|同时|一并)|(?:须同时|必须同时|同时提交|均须提交).{0,15}(?:平面|静态|图片).{0,10}(?:动态|视频)/;

/** Intake only. A choice needs locally explicit alternative forms, never title guesses or formatted card prose. */
export function compileSubmissionOptions(task: PreparedTask, rules: PreparedRule[]) {
    const primaries = task.workItems.filter(work => work.role === "主体");
    const primary = primaries.length === 1 ? primaries[0] : task.workItems.length === 1 ? task.workItems[0] : undefined;
    if (!primary || task.requiredTogether === true || primaries.length > 1) return [];
    const requirement = text(primary.submission_requirements), specs = text(primary.specifications);
    const whole = requirement + specs + (object(task.requirements) ? text(task.requirements.submission) : "");
    if (together.test(whole) || !/列举形式未要求全部提交|任选|择一|二选一|按所选|如采用|平面类.{0,100}[；;].{0,10}动态类/s.test(whole)) return [];
    const sections = submissionFormBlocks(requirement).filter(block => selectable(block.label));
    const families = [...new Set(sections.map(section => submissionFormFamily(section.label)))];
    if (families.length < 2) return [];
    // Multiple local sections of the same family are one choice, not multiple exports of the same work.
    return families.map(family => {
        const ownSections = sections.filter(section => submissionFormFamily(section.label) === family);
        const label = ownSections[0].label;
        const selectedText = ownSections.map(section => `${section.label}${section.content}`).join("；");
        const refs = new Set(selectedText.match(/\br\d+\b/g) || []);
        const allRefs = new Set(sections.flatMap(section => section.content.match(/\br\d+\b/g) || []));
        const selectedRules = rules.flatMap(rule => {
            if (allRefs.has(rule.id) && !refs.has(rule.id)) return [];
            if (!refs.has(rule.id)) return [structuredClone(rule)];
            const blocks = submissionFormBlocks(ruleText(rule));
            const scoped = blocks.filter(block => !block.label || submissionFormFamily(block.label) === family);
            const content = scoped.map(block => `${block.label}${block.content}`).join("\n");
            return content ? [{ ...structuredClone(rule), content: typeof rule.content === "string" ? content : { ...(rule.content as Data), submission: content } }] : [];
        });
        const works = task.workItems.flatMap<Data>(work => {
            if (work === primary) return [{ ...structuredClone(work), name: `${text(work.name).replace(/[（(].*?[）)]/g, "")} · ${label}`,
                specifications: specs.replace(/列举形式未要求全部提交[；;。]?/g, ""), submission_requirements: selectedText }];
            const condition = text(work.required);
            const conditional = condition.match(/(平面类|静态类|图片类|动态类|视频类|数字文创类|设计方案类|创意产品类|实物文创类|实物类)/);
            if (conditional && submissionFormFamily(conditional[1]) !== family) return [];
            return [{ ...structuredClone(work), ...(conditional ? { required: /必交|须交/.test(condition) ? true : work.required } : {}) }];
        });
        const submission = [selectedText, ...selectedRules.filter(rule => refs.has(rule.id)).map(ruleText),
            ...works.filter(work => work.role === "配套").map(work => text(work.submission_requirements))].filter(Boolean).join("\n\n");
        const content: PreparedTask = { ...structuredClone(task), title: `${task.title} · ${label}`, workItems: works,
            requirements: { ...(object(task.requirements) ? task.requirements : { creativeContent: task.requirements }), submission },
            submissionFormat: submission, submissionRequirements: submission, finalSubmissionFormat: submission,
            ruleRefs: selectedRules.map(rule => rule.id) };
        return { choiceId: cardHash({ scopePointer: task.scopePointer, family, content, rules: selectedRules }), label, content, rules: selectedRules };
    });
}
