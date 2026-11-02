import { cardHash } from "./competition-card-store.js";
import type { PreparedTask, PreparedRule, PreparedMaterialsBundle } from "./prepared-materials.js";
import fs from "node:fs/promises";
import path from "node:path";

type Data = Record<string, unknown>;
export type SubmissionChoicePlan = {
    taskHash: string;
    evidenceRefs: string[];
    /** Shared companions must survive every alternative, including conditional later-stage delivery. */
    sharedWorkIndices: number[];
    conditionalRuleIds: string[];
    alternatives: {
        label: string;
        works: { index: number; values?: Data }[];
        /** Exact excerpts from applicable saved rules; never borrow from another task. */
        ruleParts: Record<string, string[]>;
        creativeContent?: string;
    }[];
};
const ruleText = (rule: PreparedRule) => typeof rule.content === "string" ? rule.content
    : rule.content && typeof rule.content === "object" ? String((rule.content as Data).submission || "") : "";

/** Intake/explicit maintenance only. The reviewed plan is version-bound, complete and source scoped. */
export function compileSubmissionChoicePlan(task: PreparedTask, rules: PreparedRule[], plan: SubmissionChoicePlan) {
    const fail = () => { throw new Error(`提交结果编排范围或配套不完整：${task.id}`); };
    if (plan.taskHash !== cardHash(task) || plan.alternatives.length < 2 || !plan.evidenceRefs.length) fail();
    const evidence = new Set([...task.evidenceRefs, ...rules.flatMap(rule => rule.evidenceRefs)]);
    if (plan.evidenceRefs.some(id => !evidence.has(id)) || plan.conditionalRuleIds.some(id => !rules.some(rule => rule.id === id))) fail();
    const covered = new Set<number>(), labels = new Set<string>();
    const mandatoryCompanions = task.workItems.flatMap((work, index) => work.required === true && /^配套/.test(String(work.role)) ? [index] : []);
    if (mandatoryCompanions.some(index => !plan.sharedWorkIndices.includes(index))) fail();
    const result = plan.alternatives.map(option => {
        if (!option.label.trim() || labels.has(option.label)) fail();
        labels.add(option.label);
        const indices = new Set(option.works.map(work => work.index));
        if (indices.size !== option.works.length || plan.sharedWorkIndices.some(index => !indices.has(index))) fail();
        const workItems = option.works.map(({ index, values }) => {
            if (!Number.isInteger(index) || !task.workItems[index]) fail();
            if (values && Object.keys(values).some(key => !["name", "required", "quantity", "specifications", "submission_requirements"].includes(key))) fail();
            covered.add(index);
            return { ...structuredClone(task.workItems[index]), ...values };
        });
        for (const [id, parts] of Object.entries(option.ruleParts)) {
            const rule = rules.find(rule => rule.id === id);
            if (!rule || !parts.length || parts.some(part => !part.trim() || !ruleText(rule).includes(part))) fail();
        }
        const selectedRules = rules.flatMap(rule => {
            const parts = option.ruleParts[rule.id];
            if (plan.conditionalRuleIds.includes(rule.id) && !parts) return [];
            return [{ ...structuredClone(rule), ...(parts ? { content: typeof rule.content === "string" ? parts.join("\n")
                : { ...(rule.content as Data), submission: parts.join("\n") } } : {}) }];
        });
        const submission = workItems.map(work => [work.name, typeof work.required === "string" ? work.required : "", work.quantity,
            work.specifications, work.submission_requirements].filter(Boolean).join("；")).join("\n\n");
        const requirements = task.requirements && typeof task.requirements === "object" ? task.requirements as Data : { creativeContent: task.requirements };
        const content: PreparedTask = { ...structuredClone(task), title: `${task.title} · ${option.label}`, workItems,
            requirements: task.status === "unknown" || task.requirements === null ? null : { ...requirements,
                ...(option.creativeContent ? { creativeContent: option.creativeContent } : {}), submission },
            submissionFormat: submission, submissionRequirements: submission, finalSubmissionFormat: submission,
            ruleRefs: selectedRules.map(rule => rule.id) };
        return { choiceId: cardHash({ scopePointer: task.scopePointer, content, rules: selectedRules }), label: option.label, content, rules: selectedRules };
    });
    // Nothing disappears merely because it looks like an administrative attachment or an optional add-on.
    if (covered.size !== task.workItems.length) fail();
    return result;
}

const planPath = (root: string, bundle: PreparedMaterialsBundle, task: PreparedTask) => path.join(root, "workspace/competition-sources/submission-plans/v1",
    cardHash(bundle.identity.libraryId), `${cardHash({ source: bundle.sourceVersion, task,
        rules: bundle.rules.filter(rule => task.ruleRefs.includes(rule.id) && rule.appliesTo.includes(task.id)) })}.json`);
/** Persist reviewed intake relations separately; raw material and real test records stay byte-for-byte intact. */
export async function saveSubmissionChoicePlans(root: string, bundle: PreparedMaterialsBundle, plans: Record<string, SubmissionChoicePlan>) {
    for (const [scope, plan] of Object.entries(plans)) {
        const task = bundle.tasks.find(task => task.scopePointer === scope);
        if (!task) throw new Error("提交结果编排任务不存在");
        compileSubmissionChoicePlan(task, bundle.rules.filter(rule => task.ruleRefs.includes(rule.id) && rule.appliesTo.includes(task.id)), plan);
        const file = planPath(root, bundle, task), value = JSON.stringify({ plan, integrityHash: cardHash(plan) }, null, 2);
        await fs.mkdir(path.dirname(file), { recursive: true });
        try { await fs.writeFile(file, value, { flag: "wx" }); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST" || await fs.readFile(file, "utf8") !== value) throw error;
        }
    }
}
/** Called by intake/rebuild only, never queries. Changed source/task/rules cannot reuse an old decision. */
export async function readSubmissionChoicePlans(root: string, bundle: PreparedMaterialsBundle) {
    const plans: Record<string, SubmissionChoicePlan> = {};
    for (const task of bundle.tasks) {
        try {
            const { plan, integrityHash } = JSON.parse(await fs.readFile(planPath(root, bundle, task), "utf8"));
            if (integrityHash !== cardHash(plan)) throw new Error("提交结果编排校验失败");
            plans[task.scopePointer] = plan;
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    return plans;
}
