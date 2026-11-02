import { createShapeId, type Editor } from 'tldraw'
import { TEXT, type TextShape } from './shapes/TextShape'
import { createGenerator } from './generate'
import { GENERATOR, type GeneratorShape } from './shapes/GeneratorShape'
import { competitionGoal, type CompetitionBrief } from './competitionGoal'

// Only an explicit handoff creates shapes. Existing automatic text may be expanded, never user edits.
export async function loadCompetitionHandoff(editor: Editor, projectId: string, alive = () => true) {
  let changed = false
  const doc = editor.getDocumentSettings()
  const saved = doc.meta.competition as CompetitionBrief | undefined
  const note = editor.getShape<TextShape>(createShapeId('competition-goal'))
  if (saved?.goal && saved.fullTask) {
    const goal = competitionGoal(saved.fullTask)
    if (goal && goal !== saved.goal) {
      if (note?.type === TEXT && !note.props.rich && note.props.text === `创作目标\n\n${saved.goal}`) {
        editor.updateShape<TextShape>({ id: note.id, type: TEXT, props: { text: `创作目标\n\n${goal}` } })
      }
      for (const shape of editor.store.query.records('shape').get()) {
        if (shape.type === GENERATOR && !shape.meta.job && shape.props.prompt === saved.goal) {
          editor.updateShape<GeneratorShape>({ id: shape.id, type: GENERATOR, props: { prompt: goal } })
        }
      }
      editor.updateDocumentSettings({ meta: { ...doc.meta, competition: { ...saved, goal } } })
      changed = true
    }
  }
  if (saved?.goal && note?.type === TEXT && !note.props.rich && note.props.text === `创作目标\n\n${saved.goal}` && note.props.color === '#000000') {
    editor.updateShape<TextShape>({ id: note.id, type: TEXT, props: { color: 'var(--ca-text)' } })
    changed = true
  }
  const url = new URL(location.href)
  const id = url.searchParams.get('competition')
  if (!id) return changed
  if (id !== projectId || !/^pi-[a-f0-9]{64}$/.test(id)) throw new Error('创作任务与当前项目不一致。')
  if (!doc.meta.competition) {
    const response = await fetch(`/__workbench/pi/comfyart/handoffs/${id}`)
    if (!response.ok) throw new Error('无法读取完整竞赛任务，请返回竞赛页面重新选择。')
    const task = await response.json()
    if (task.projectId !== id || typeof task.goal !== 'string' || !task.fullTask) throw new Error('创作任务资料无效。')
    if (!alive() || editor.getDocumentSettings().meta.competition) return
    task.goal = competitionGoal(task.fullTask)
    if (!task.goal) throw new Error('创作任务缺少完整要求，请返回竞赛页面重新选择。')
    editor.updateDocumentSettings({ name: task.title, meta: { ...doc.meta, competition: task } })
    editor.createShape({ id: createShapeId('competition-goal'), type: TEXT, x: 80, y: 80,
      props: { text: `创作目标\n\n${task.goal}`, w: 620, size: 26, color: 'var(--ca-text)', autoSize: false } })
    // Empty generator: importing a brief never starts a model request.
    const format = task.fullTask.finalSubmissionFormat || ''
    const dimensions = /(\d+(?:\.\d+)?)\s*(?:mm|cm|px)?\s*[×x*：:]\s*(\d+(?:\.\d+)?)/i.exec(format)
    const ratio = dimensions && Number(dimensions[1]) > 0 && Number(dimensions[2]) > 0 ? `${dimensions[1]}:${dimensions[2]}`
      : /正方形|方形/.test(format) ? '1:1' : /横版|横向/.test(format) ? '3:2' : '2:3'
    const generator = createGenerator(editor, false, { prompt: task.goal, ratio }, false, [780, 80])
    const shape = editor.getShape<GeneratorShape>(generator)!
    editor.updateShape<GeneratorShape>({ id: generator, type: GENERATOR, props: { w: 480, h: 480 * shape.props.h / shape.props.w } })
    changed = true
  }
  url.searchParams.delete('competition')
  history.replaceState(null, '', url)
  return changed
}
