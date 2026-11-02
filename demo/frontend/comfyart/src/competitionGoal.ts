export type CompetitionTask = {
  themeTask?: string
  creativeContent?: string
  finalSubmissionFormat?: string
  submissionFormat?: string
}

export type CompetitionBrief = { goal: string; fullTask: CompetitionTask }

// Keep the saved task text intact: browsing summaries and canvas defaults are not requirements.
export function competitionGoal(task: CompetitionTask): string {
  const submission = task.submissionFormat || ''
  const final = task.finalSubmissionFormat || ''
  const delivery = [final && !submission.includes(final) ? final : '', submission].filter(Boolean).join('\n\n')
  return [
    task.themeTask && `创作主题\n${task.themeTask}`,
    task.creativeContent && `要完成什么\n${task.creativeContent}`,
    delivery && `最终交付物与提交要求\n${delivery}`,
  ].filter(Boolean).join('\n\n')
}
