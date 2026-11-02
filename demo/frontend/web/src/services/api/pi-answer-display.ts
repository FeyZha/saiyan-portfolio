/** Display only business-relevant, program-recorded gaps, never model self-assessments. */
export function importantGapMessages(fields: string[], alreadyShown: { fee?: boolean; deadline?: boolean; type?: boolean; requirements?: boolean } = {}): string[] {
    const messages = new Set<string>();
    for (const field of fields) {
        if (/费用|收费/.test(field) && !alreadyShown.fee) messages.add("费用待确认");
        if (/截止/.test(field) && !alreadyShown.deadline) messages.add("截止日期待确认");
        if (/作品类型/.test(field) && !alreadyShown.type) messages.add("作品类型待确认");
        if (/任务.*(?:关联|独立|范围)|(?:关联|独立).*任务/.test(field)) messages.add("投稿任务关系待确认");
        if (/规格|要求|必交|配套/.test(field) && !alreadyShown.requirements) messages.add("完整创作要求待确认");
    }
    return [...messages];
}

/** Current answers have no historical footer or generated self-review. */
export function competitionAnswerForDisplay(answer: string): string { return answer; }
