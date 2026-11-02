import { useEffect, useRef } from 'react'
import { Box, createShapeId, useEditor, useValue } from 'tldraw'

import { extraPointsOf, imageUnder, markObject, markOf, touchEdit } from '../actions'
import { commentsToChat } from '../agent'
import { COMMENT, COMMENT_SIZE, type CommentShape } from '../shapes/CommentShape'
import { Icons } from './icons'
import { useElementSize, useOnlySelected, useSelectionRect } from './selection'
import { t } from '../i18n'
import { isEnter } from './keys'

const GAP = 12
const EDGE = 8

export function CommentPanel({ onError }: { onError: (msg: string) => void }) {
  const editor = useEditor()
  const shape = useOnlySelected<CommentShape>(COMMENT)
  const rect = useSelectionRect()
  const panel = useRef<HTMLDivElement>(null)
  const text = useRef<HTMLTextAreaElement>(null)
  const size = useElementSize(panel, { w: 300, h: 160 })
  const onImage = useValue('comment on image', () => {
    const s = shape && editor.getShape(shape.id)
    const box = s && editor.getShapePageBounds(s)
    return !!box && !!imageUnder(editor, box)
  }, [editor, shape?.id])

  const points = useValue('mark points', () => {
    const s = shape && editor.getShape<CommentShape>(shape.id)
    return s ? extraPointsOf(s).length : 0
  }, [editor, shape?.id])

  useEffect(() => {
    if (shape) requestAnimationFrame(() => text.current?.focus())
  }, [shape?.id])

  useEffect(() => {
    const host = editor.getContainer()
    const onDown = (e: PointerEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.button !== 0 || editor.getCurrentToolId() !== 'select') return
      const p = editor.screenToPage({ x: e.clientX, y: e.clientY })
      const size = COMMENT_SIZE
      if (!imageUnder(editor, new Box(p.x - size / 2, p.y - size / 2, size, size))) return
      e.preventDefault()
      e.stopPropagation()
      const id = createShapeId()
      editor.createShape({ id, type: COMMENT, x: p.x - size / 2, y: p.y - size / 2 })
      editor.select(id)
    }
    host.addEventListener('pointerdown', onDown, true)
    return () => host.removeEventListener('pointerdown', onDown, true)
  }, [editor])

  useEffect(() => {
    const s = shape && editor.getShape<CommentShape>(shape.id)
    if (s && onImage && s.props.kind === 'point' && !markOf(s)) void markObject(editor, s)
  }, [shape?.id, onImage, points])

  if (!shape || !rect) return null
  const host = editor.getContainer().getBoundingClientRect()
  let left = rect.r + GAP
  if (left + size.w > host.width - EDGE) left = Math.max(EDGE, rect.l - size.w - GAP)
  const top = Math.min(Math.max(rect.t, EDGE), host.height - size.h - EDGE)
  const value = shape.props.text
  const mark = markOf(shape)
  const set = (patch: Partial<CommentShape['props']>) => editor.updateShape<CommentShape>({ id: shape.id, type: COMMENT, props: patch })

  const run = () => {
    if (!value.trim()) return
    void touchEdit(editor, shape, onError)
    set({ done: true })
    editor.selectNone()
  }

  return (
    <div ref={panel} className="ca-panel ca-cpanel" style={{ left, top }} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <div className="ca-panel__head">
        <span>{t('common.comment')}</span>
        {mark === 'loading' && <span className="ca-trim__time ca-cpanel__mark">{t('commentPanel.detecting')}</span>}
        {!!mark && typeof mark === 'object' && <span className="ca-trim__time ca-cpanel__mark">{t('commentPanel.markedObject', points > 0 ? t('commentPanel.markers', points + 1) : '')}</span>}
        {mark === 'none' && <span className="ca-trim__time ca-cpanel__mark">{t('commentPanel.noSelectableObjectsFound')}</span>}
        <span className="ca-menu__grow" />
        <button type="button" className="ca-panel__icon" title={t('common.delete')} onClick={() => editor.deleteShape(shape.id)}>{Icons.trash}</button>
      </div>
      <textarea
        ref={text}
        className="ca-panel__prompt ca-panel__prompt--boxed"
        value={value}
        placeholder={onImage ? t('commentPanel.howShouldThisChange') : t('commentPanel.addADescription')}
        onChange={(e) => set({ text: e.target.value, done: false })}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (isEnter(e) && !e.shiftKey && onImage) {
            e.preventDefault()
            run()
          }
        }}
      />
      <div className="ca-panel__foot">
        <button
          type="button"
          className="ca-panel__secondary"
          disabled={!value.trim()}
          onClick={() => commentsToChat(editor, [shape])}
        >
          {t('libraryPanel.addToChat')}
        </button>
        {onImage && <button type="button" className="ca-panel__primary" disabled={!value.trim()} onClick={run}>{t('common.generate')}</button>}
      </div>
    </div>
  )
}
