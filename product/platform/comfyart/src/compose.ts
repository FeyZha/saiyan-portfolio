import { createShapeId, type Editor, type TLFrameShape, type TLShape, type TLShapeId } from 'tldraw'

import { uploadImage, viewUrl } from './comfy'
import { freeSpot, spawnHolder, startJob, type ErrorSink } from './jobs'
import { download } from './psd'
import { exportImage } from './shapes/ArtboardShape'
import { GENBLOCK, QR, type GenBlockShape } from './shapes/ComposeShapes'
import { annotated, editGraph } from './workflows'
import { t } from './i18n'

const RENDER_SCALE = 2
const RENDER_LONG = 2048
const BOARD_SIZE = [1080, 1350]
const SEAM_PROMPT = 'Fix only the seams between the elements of this design: blend edges, contact shadows and lighting so nothing looks pasted on. Every object stays complete with all of its parts, in the same place, size and shape. Keep the background, all text, logos, layout and colors exactly as they are. Do not add or remove anything.'
const LAYOUT_PROMPT = 'Image 1 is a layout. Turn it into one finished, polished design. Fill every flat gray area with new content as described below, blended naturally into the design. Keep all text exactly as written, and keep logos, photos, QR codes, shapes and doodles in the same place, size and color.'

export interface Snapshot { sig: string; label: string }
export interface Changes { added: TLShape[]; changed: TLShape[]; removed: string[] }

export const isBoard = (frame: TLFrameShape) => !!(frame.meta.compose || frame.meta.elements)

function descendants(editor: Editor, frame: TLFrameShape): TLShape[] {
  return [...editor.getShapeAndDescendantIds([frame.id])].filter((id) => id !== frame.id).map((id) => editor.getShape(id)!)
}

const pct = (v: number, of: number) => Math.round((v / of) * 100)

export function composePrompt(editor: Editor, frame: TLFrameShape): string {
  const blocks = descendants(editor, frame).filter((s): s is GenBlockShape => s.type === GENBLOCK)
  if (!blocks.length) return SEAM_PROMPT
  const fb = editor.getShapePageBounds(frame)!
  const lines = blocks.map((b, i) => {
    const r = editor.getShapePageBounds(b)!
    return `Area ${i + 1} (left ${pct(r.x - fb.x, fb.w)}%, top ${pct(r.y - fb.y, fb.h)}%, width ${pct(r.w, fb.w)}%, height ${pct(r.h, fb.h)}%): ${b.props.description.trim() || 'content that fits the design'}.`
  })
  return [LAYOUT_PROMPT, ...lines].join('\n')
}

function labelOf(shape: TLShape) {
  const p = shape.props as { text?: string; description?: string; url?: string; name?: string }
  return (p.text || p.description || p.url || p.name || shape.type).slice(0, 40)
}

function signature(shape: TLShape) {
  const p = shape.props as Record<string, unknown>
  return JSON.stringify([shape.type, Math.round(shape.x), Math.round(shape.y), shape.rotation, p.w, p.h, p.text, p.rich, p.description, p.url, p.assetId, p.color, p.fill, p.font, p.size, p.weight])
}

export function changesOf(editor: Editor, frame: TLFrameShape): Changes | null {
  const before = frame.meta.rendered as Record<string, Snapshot> | undefined
  if (!before) return null
  const now = descendants(editor, frame)
  return {
    added: now.filter((s) => !before[s.id]),
    changed: now.filter((s) => before[s.id] && before[s.id].sig !== signature(s)),
    removed: Object.entries(before).filter(([id]) => !editor.getShape(id as TLShapeId)).map(([, s]) => s.label),
  }
}

export function renderBoard(editor: Editor, frame: TLFrameShape, onError: ErrorSink) {
  const holder = spawnHolder(editor, frame)
  const { w, h, name } = frame.props
  const prompt = composePrompt(editor, frame)
  const rendered = Object.fromEntries(descendants(editor, frame).map((s) => [s.id, { sig: signature(s), label: labelOf(s) }]))
  editor.updateShape<TLFrameShape>({ id: frame.id, type: 'frame', meta: { ...frame.meta, rendered } })
  void startJob(editor, holder, (async () => {
    const { blob } = await exportImage(editor, [frame.id], { format: 'png', background: true, pixelRatio: 1, scale: Math.min(RENDER_SCALE, RENDER_LONG / Math.max(w, h)) })
    const ref = await uploadImage(blob, `${name || 'board'}-render.png`)
    return editGraph(annotated(viewUrl(ref)), prompt)
  })(), { name: t('compose.renderName', name) }, onError)
  return holder
}

export function createBoard(editor: Editor) {
  const id = createShapeId()
  const [w, h] = BOARD_SIZE
  const [x, y] = freeSpot(editor, w, h)
  editor.createShape<TLFrameShape>({ id, type: 'frame', x, y, props: { w, h, name: t('compose.board') }, meta: { compose: true } })
  editor.select(id)
  editor.zoomToSelectionIfOffscreen(64, { animation: { duration: 200 } })
}

export function addComposeShape(editor: Editor, type: typeof GENBLOCK | typeof QR) {
  const selected = editor.getOnlySelectedShape()
  const frame = selected?.type === 'frame' ? selected : selected && editor.getShape(selected.parentId as TLShapeId)?.type === 'frame' ? editor.getShape(selected.parentId as TLShapeId)! : null
  const util = editor.getShapeUtil(type)
  const { w, h } = util.getDefaultProps() as { w: number; h: number }
  const center = frame ? { x: (frame.props as { w: number }).w / 2, y: (frame.props as { h: number }).h / 2 } : editor.getViewportPageBounds().center
  const id = createShapeId()
  editor.createShape({ id, type, x: center.x - w / 2, y: center.y - h / 2, ...(frame ? { parentId: frame.id } : {}) })
  editor.select(id)
  editor.setEditingShape(id)
}

export function exportLayout(editor: Editor, frame: TLFrameShape) {
  const content = editor.getContentFromCurrentPage([frame.id])
  if (!content) return
  const shapes = content.shapes.map((s) => (s.id === frame.id ? { ...s, meta: { ...s.meta, rendered: null } } : s))
  download(new Blob([JSON.stringify({ ...content, shapes })], { type: 'application/json' }), `${frame.props.name || 'layout'}.layout.json`)
}

export async function importLayout(editor: Editor, file: File) {
  editor.putContentOntoCurrentPage(JSON.parse(await file.text()), { point: editor.getViewportPageBounds().center, select: true })
}
