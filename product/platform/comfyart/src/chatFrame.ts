import { createShapeId, type Editor, type TLFrameShape, type TLShape, type TLShapeId } from 'tldraw'

import { chatsAtom } from './bot'
import { fileSrc, freeSpot } from './jobs'
import { TEXT, type TextShape } from './shapes/TextShape'
import { onComfyEvent } from './ws'
import { t } from './i18n'

const FRAME_W = 1200
const FRAME_H = 800

const frames = (editor: Editor, anyPage = false) => (anyPage ? editor.store.query.records('shape').get() : editor.getCurrentPageShapes()).filter((s): s is TLFrameShape => s.type === 'frame')

export const chatFrameOf = (editor: Editor, chatId: string, anyPage = false) => frames(editor, anyPage).find((f) => f.meta.chatId === chatId) ?? null

const chatTitle = (chatId: string) => chatsAtom.get().find((c) => c.id === chatId)?.title || t('chatFrame.untitled')

function createFrame(editor: Editor, name: string, meta: Record<string, string | boolean>): TLFrameShape {
  const id = createShapeId()
  const [x, y] = freeSpot(editor, FRAME_W, FRAME_H)
  editor.createShape<TLFrameShape>({ id, type: 'frame', x, y, props: { w: FRAME_W, h: FRAME_H, name }, meta: { layout: 'auto', wMode: 'hug', hMode: 'hug', ...meta } })
  return editor.getShape<TLFrameShape>(id)!
}

function ensureChatFrame(editor: Editor, chatId: string): TLFrameShape {
  return chatFrameOf(editor, chatId, true) ?? createFrame(editor, chatTitle(chatId), { chatId })
}

export function placeInChatFrame(editor: Editor, id: TLShapeId, chatId: string) {
  const frame = ensureChatFrame(editor, chatId)
  editor.reparentShapes([id], frame.id)
  const shape = editor.getShape(id)!
  editor.updateShape({ id, type: shape.type, x: 0, y: frame.props.h })
}

export function locateChatFrame(editor: Editor, chatId: string) {
  const frame = chatFrameOf(editor, chatId, true)
  if (!frame) return
  if (editor.getAncestorPageId(frame) !== editor.getCurrentPageId()) editor.setCurrentPage(editor.getAncestorPageId(frame)!)
  editor.select(frame.id)
  editor.zoomToSelection({ animation: { duration: 200 } })
}

export const refFrameOf = (editor: Editor) => frames(editor).find((f) => f.meta.refFrame) ?? null

export function createRefFrame(editor: Editor): TLFrameShape {
  const frame = createFrame(editor, t('chatFrame.refFrame'), { refFrame: true })
  editor.select(frame.id)
  editor.zoomToSelectionIfOffscreen(64, { animation: { duration: 200 } })
  return frame
}

export function refFrameContents(editor: Editor, frame: TLFrameShape) {
  const shapes = editor.getSortedChildIdsForParent(frame.id).map((id) => editor.getShape(id)).filter((s): s is TLShape => !!s)
  return {
    media: shapes.filter((s) => fileSrc(editor, s)),
    notes: shapes.filter((s): s is TextShape => s.type === TEXT).map((s) => s.props.text.trim()).filter(Boolean),
  }
}

export const refLinkedOf = (editor: Editor) => !!editor.getDocumentSettings().meta.refLinked

export function setRefLinked(editor: Editor, linked: boolean) {
  const doc = editor.getDocumentSettings()
  editor.updateDocumentSettings({ meta: { ...doc.meta, refLinked: linked } })
}

export function startChatFrames(editor: Editor) {
  return onComfyEvent('comfyart-bot', (e: { event: string; chat_id: string; title?: string }) => {
    if (e.event !== 'turn_done' || !e.title) return
    const frame = chatFrameOf(editor, e.chat_id, true)
    if (frame && frame.props.name === t('chatFrame.untitled')) editor.updateShape<TLFrameShape>({ id: frame.id, type: 'frame', props: { name: e.title } })
  })
}
