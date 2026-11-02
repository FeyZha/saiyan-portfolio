type Data = Record<string, any>;
const norm = (value: unknown) => String(value).normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
const creative = (task: Data) => typeof task.requirements === "object" ? task.requirements?.creativeContent ?? task.requirements?.creative : task.requirements;

type Choice = { index: number; text: string; label: string };
const numberOf = (value: string) => {
    const normalized = value.normalize("NFKC");
    if (/^\d+$/.test(normalized)) return Number(normalized);
    const digits = "一二三四五六七八九";
    if (digits.includes(value) && value.length === 1) return digits.indexOf(value) + 1;
    const parts = value.split("十");
    return parts.length === 2 ? (parts[0] ? digits.indexOf(parts[0]) + 1 : 1) * 10 + (parts[1] ? digits.indexOf(parts[1]) + 1 : 0) : 0;
};

/** Explicit alternatives only: optional media/examples and combinable inspiration are not tasks. */
export function explicitDirectionChoices(text: string): Choice[] {
    const cue = /(?:从|在)?(?:以下|下列)?[一二三四五六七八九十两\d]*个?(?:创作)?(?:方向|命题|主题|类别)[，,、\s]*(?:可|自由)?(?:任选其一|任选一个|择一|选择其中一个|选取其中一个)(?:进行设计)?[：:。]?/.exec(text);
    if (!cue || /或交叉融合|可以融合|可交叉|可融合/.test(text.slice(cue.index, cue.index + cue[0].length + 20))) return [];
    const block = text.slice(cue.index + cue[0].length).split(/\n\s*(?:提交要求|提交规范|作品要求|文件要求|参赛要求|知识产权要求)[：:\s]/)[0];
    const markers = [...block.matchAll(/[（(]([一二三四五六七八九十\d]+)[）)]|([①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳])|(?:^|\n)\s*(\d+)[.．、]|(?:^|\n)\s*方向([一二三四五六七八九十\d]+)[：:、]/g)];
    // Ambiguous/nested numbering is left for review rather than guessed into tasks.
    const sequence = markers;
    if (sequence.length < 2 || sequence.some((marker, index) => numberOf(marker[1] || marker[2] || marker[3] || marker[4]) !== index + 1)) return [];
    const choices = sequence.map((marker, index) => {
        const text = block.slice(marker.index! + marker[0].length, sequence[index + 1]?.index ?? block.length).trim().replace(/[；;。]$/, "");
        return { index: index + 1, text, label: text.split(/[：:。；;，,\n]/)[0].trim() };
    });
    return choices.every(choice => choice.label && choice.label !== choice.text) ? choices : [];
}

/** Apply an explicitly reviewed repair. Never invoked by reads, queries or model retries. */
export function expandReviewedDirections(bundle: Data, plans: { taskId: string; alternatives: { sourceChoice: string; creativeContent: string; workItems: Data[] }[] }[]) {
    const result = structuredClone(bundle), replacements = new Map<string, Data[]>();
    let nextScope = Math.max(-1, ...bundle.tasks.map((task: Data) => Number(/\/(\d+)$/.exec(task.scopePointer)?.[1] ?? -1))) + 1;
    for (const plan of plans) {
        const parent = bundle.tasks.find((task: Data) => task.id === plan.taskId);
        if (!parent || replacements.has(parent.id)) throw new Error("修正任务身份无效或重复");
        const options = formalSubmissionChoices(parent, bundle.evidence);
        if (options.length < 2 || options.length !== plan.alternatives.length || new Set(plan.alternatives.map(item => item.sourceChoice)).size !== options.length)
            throw new Error("修正必须覆盖全部明确方向且不能新增方向");
        const children = options.map(option => {
            const alternative = plan.alternatives.find(item => item.sourceChoice === option.text);
            if (!alternative || !alternative.creativeContent.includes(option.text) || !Array.isArray(alternative.workItems)) throw new Error("修正方向缺少对应原文或作品要求");
            return { ...structuredClone(parent), id: `${parent.id}:direction:${option.index}`, scopePointer: `/preparedTasks/${nextScope++}`,
                title: option.label, shortTheme: option.label, category: parent.title,
                requirements: { ...structuredClone(parent.requirements), creativeContent: alternative.creativeContent }, workItems: structuredClone(alternative.workItems) };
        });
        replacements.set(parent.id, children);
    }
    result.tasks = bundle.tasks.flatMap((task: Data) => replacements.get(task.id) || [structuredClone(task)]);
    if (new Set(result.tasks.map((task: Data) => task.id)).size !== result.tasks.length) throw new Error("方向ID冲突");
    result.rules = bundle.rules.map((rule: Data) => ({ ...structuredClone(rule), appliesTo: rule.appliesTo.flatMap((id: string) => replacements.get(id)?.map(task => task.id) || [id]) }));
    for (const field of ["submissionForms", "feeStatus", "submissionDeadline"]) result.facts[field] = bundle.facts[field].flatMap((fact: Data) => {
        const parent = bundle.tasks.find((task: Data) => task.scopePointer === fact.scopePointer);
        return (replacements.get(parent?.id) || [parent]).map((task: Data) => ({ ...structuredClone(fact), scopePointer: task.scopePointer }));
    });
    if (submissionChoiceIssues(result.tasks, result.evidence).length) throw new Error("修正后仍有未拆分或遗漏方向");
    return result;
}

function groupsFor(task: Data, evidence: Data[]) {
    return evidence.filter(item => task.evidenceRefs?.includes(item.id)).flatMap(item => {
        const options = explicitDirectionChoices(item.quote || "");
        return options.length ? [{ evidenceId: item.id, options }] : [];
    });
}

export function submissionChoiceIssues(tasks: Data[], evidence: Data[]) {
    const issues = tasks.filter(task => formalSubmissionChoices(task, evidence).length).map(task => `formal_submission_choices_not_expanded:${task.id}`);
    const used = new Set(tasks.flatMap(task => task.evidenceRefs || []));
    for (const item of evidence.filter(item => used.has(item.id))) {
        const options = explicitDirectionChoices(item.quote || "");
        for (const option of options) if (!tasks.some(task => task.evidenceRefs?.includes(item.id)
            && norm(`${task.title} ${creative(task)}`).includes(norm(option.label))))
            issues.push(`submission_choice_missing:${item.id}:${option.index}`);
    }
    return issues;
}

/** Official numbered categories, excluding parenthesized examples and bound suites. */
export function formalSubmissionChoices(task: Data, evidence: Data[]) {
    const content = creative(task);
    if (typeof content !== "string") return [];
    for (const group of groupsFor(task, evidence)) {
        const matches = group.options.filter(option => norm(`${task.title || ""} ${content}`).includes(norm(option.label)));
        if (matches.length !== 1) return group.options;
    }
    if (/共同必交|一起提交|必须同时完成|整套投稿|绑定提交|不可拆分/.test(content)) return [];
    for (const item of evidence.filter(item => task.evidenceRefs?.includes(item.id))) {
        const block = /作品类别[：:]([\s\S]*?)(?:提交要求[：:]|$)/.exec(item.quote)?.[1];
        if (!block) continue;
        const options = [...block.matchAll(/^\s*(\d+)[.．、]\s*(.+)$/gm)].map(match => ({ index: Number(match[1]),
            text: match[2].trim().replace(/[；;。]$/, ""), label: match[2].split(/[（(：:]/)[0].trim().replace(/[；;。]$/, "") }));
        if (options.length < 2 || options.some((option, index) => option.index !== index + 1)) continue;
        if (options.filter(option => norm(content).includes(norm(option.label))).length >= 2) return options;
    }
    return [];
}
