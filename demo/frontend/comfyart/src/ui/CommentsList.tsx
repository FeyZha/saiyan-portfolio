import { useState } from 'react'
import { useValue, type Editor } from 'tldraw'

import { imageUnder, touchEdit } from '../actions'
import { agentModeAtom, commentNotes, commentsToChat, sendToAgent } from '../agent'
import { errorText } from '../jobs'
import { COMMENT, type CommentShape } from '../shapes/CommentShape'
import { Icons } from './icons'
import { t } from '../i18n'

type Filter = 'all' | 'open' | 'done'
const FILTERS: [Filter, string][] = [['all', t('common.allComments')], ['open', t('commentsList.open')], ['done', t('commentsList.resolved')]]

export function allComments(editor: Editor): CommentShape[] {
  return editor.store.query.records('shape').get().filter((s): s is CommentShape => s.type === COMMENT)
}

export function CommentsList({ editor, onError }: { editor: Editor; onError: (msg: string) => void }) {
  const [filter, setFilter] = useState<Filter>('all')
  const comments = useValue('comments', () => allComments(editor), [editor])
  const shown = comments.filter((c) => (filter === 'all' ? true : filter === 'done' ? c.props.done : !c.props.done))
  const open = comments.filter((c) => !c.props.done && c.props.text.trim())

  const focus = (c: CommentShape) => {
    const page = editor.getAncestorPageId(c.id)
    if (page) editor.setCurrentPage(page)
    editor.select(c.id)
    editor.zoomToSelection({ animation: { duration: 200 } })
  }
  const setDone = (c: CommentShape, done: boolean) => editor.updateShape<CommentShape>({ id: c.id, type: COMMENT, props: { done } })
  const runAll = () => {
    for (const c of open) {
      const box = editor.getShapePageBounds(c)
      if (!box || !imageUnder(editor, box)) continue
      void touchEdit(editor, c, onError)
      setDone(c, true)
    }
  }
  const summarize = () => {
    if (!open.length) return
    agentModeAtom.set('agent')
    const { text, images } = commentNotes(editor, open)
    void sendToAgent(editor, t('commentsList.summarize', text), images, null).catch((e) => onError(errorText(e)))
  }

  return (
    <>
      <div className="ca-assets__bar ca-comments__bar">
        {FILTERS.map(([f, label]) => <button key={f} type="button" className="ca-panel__chip" data-on={filter === f || undefined} onClick={() => setFilter(f)}>{label}</button>)}
      </div>
      {shown.length === 0 && <div className="ca-side__empty">{t('commentsList.noCommentsYet')}</div>}
      {shown.map((c) => (
        <div key={c.id} className="ca-comment-row" data-done={c.props.done || undefined} onClick={() => focus(c)}>
          <span className="ca-icon">{c.props.done ? Icons.check : Icons.comment}</span>
          <span className="ca-comment-row__text">{c.props.text.trim() || t('commentsList.noDescription')}</span>
          <button type="button" className="ca-layer__act" title={c.props.done ? t('commentsList.markAsUnresolved') : t('commentsList.markAsResolved')} onClick={(e) => { e.stopPropagation(); setDone(c, !c.props.done) }}>
            <span className="ca-icon">{c.props.done ? Icons.restore : Icons.check}</span>
          </button>
          <button type="button" className="ca-layer__act" title={t('common.delete')} onClick={(e) => { e.stopPropagation(); editor.deleteShape(c.id) }}>
            <span className="ca-icon">{Icons.trash}</span>
          </button>
        </div>
      ))}
      <div className="ca-comments__foot">
        <button type="button" className="ca-panel__secondary" disabled={!open.length} onClick={() => commentsToChat(editor, open)}>{t('commentsList.addToChat', open.length)}</button>
        <button type="button" className="ca-panel__secondary" disabled={!open.length} onClick={summarize}>{t('commentsList.summarizeAllComments')}</button>
        <button type="button" className="ca-panel__primary" disabled={!open.length} onClick={runAll}>{t('commentsList.runAll')}</button>
      </div>
    </>
  )
}
