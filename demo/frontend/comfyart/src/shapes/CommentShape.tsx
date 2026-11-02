import {
  atom,
  BaseBoxShapeUtil,
  createShapeId,
  HTMLContainer,
  StateNode,
  T,
  useEditor,
  useValue,
  type RecordProps,
  type TLShape,
  type TLShapeId,
} from 'tldraw'

import { Icons } from '../ui/icons'

export const COMMENT = 'comment'
export type CommentKind = 'point' | 'lasso' | 'box'

declare module 'tldraw' {
  export interface TLGlobalShapePropsMap {
    [COMMENT]: {
      w: number
      h: number
      kind: string
      path: string
      text: string
      done: boolean
    }
  }
}

export type CommentShape = TLShape<typeof COMMENT>

export const commentKindAtom = atom<CommentKind>('comment kind', 'point')

export const COMMENT_SIZE = 32
const POINT_SIZE = COMMENT_SIZE
const MIN_DRAG = 6

function Pin({ shape }: { shape: CommentShape }) {
  const editor = useEditor()
  const zoom = useValue('zoom', () => editor.getZoomLevel(), [editor])
  const selected = useValue('comment selected', () => editor.getSelectedShapeIds().includes(shape.id), [editor, shape.id])
  const { w, h, kind, path, done } = shape.props
  const s = 1 / zoom
  const mark = shape.meta.mark as { image: TLShapeId; src: string } | undefined
  const target = useValue('marked image', () => (selected && !!mark && typeof mark === 'object' ? editor.getShapePageBounds(mark.image) : null), [editor, selected, mark])
  const outline = kind === 'box'
    ? <rect x={0} y={0} width={w} height={h} />
    : kind === 'lasso'
      ? <polygon points={path.split(' ').map((p) => p.split(',').map(Number)).map(([u, v]) => `${u * w},${v * h}`).join(' ')} />
      : null
  return (
    <HTMLContainer className="ca-comment" data-done={done || undefined} data-selected={selected || undefined}>
      {target && (
        <div
          className="ca-comment__mark"
          style={{ left: target.x - shape.x, top: target.y - shape.y, width: target.w, height: target.h, maskImage: `url("${mark!.src}")`, WebkitMaskImage: `url("${mark!.src}")` }}
        />
      )}
      {selected && ((shape.meta.points as [number, number][] | undefined) ?? []).map(([x, y], i) => (
        <span key={i} className="ca-comment__dot" style={{ left: x - shape.x, top: y - shape.y, transform: `scale(${s})` }} />
      ))}
      {outline && (
        <svg className="ca-comment__outline" width={w} height={h} style={{ strokeWidth: 1.5 * s, strokeDasharray: `${4 * s} ${3 * s}` }}>
          {outline}
        </svg>
      )}
      <span
        className="ca-comment__pin"
        style={{ transform: `scale(${s})`, left: kind === 'point' ? w / 2 : w, top: kind === 'point' ? h / 2 : 0 }}
      >
        <span className="ca-icon">{done ? Icons.check : Icons.comment}</span>
      </span>
    </HTMLContainer>
  )
}

export class CommentShapeUtil extends BaseBoxShapeUtil<CommentShape> {
  static override type = COMMENT
  static override props: RecordProps<CommentShape> = {
    w: T.number,
    h: T.number,
    kind: T.string,
    path: T.string,
    text: T.string,
    done: T.boolean,
  }

  override getDefaultProps(): CommentShape['props'] {
    return { w: POINT_SIZE, h: POINT_SIZE, kind: 'point', path: '', text: '', done: false }
  }

  override canEdit() {
    return false
  }

  override canResize() {
    return false
  }

  override hideSelectionBoundsFg() {
    return true
  }

  override hideResizeHandles() {
    return true
  }

  override hideRotateHandle() {
    return true
  }

  override component(shape: CommentShape) {
    return <Pin shape={shape} />
  }

  override getIndicatorPath(shape: CommentShape) {
    const path = new Path2D()
    path.rect(0, 0, shape.props.w, shape.props.h)
    return path
  }
}

export class CommentTool extends StateNode {
  static override id = COMMENT
  private draft: { id: TLShapeId; points: [number, number][] } | null = null

  override onEnter() {
    this.editor.setCursor({ type: 'cross', rotation: 0 })
  }

  override onExit() {
    this.draft = null
  }

  override onCancel() {
    this.editor.setCurrentTool('select')
  }

  override onPointerDown() {
    const editor = this.editor
    const p = editor.inputs.getCurrentPagePoint()
    const selected = editor.getOnlySelectedShape()
    if (editor.inputs.getShiftKey() && selected?.type === COMMENT && (selected as CommentShape).props.kind === 'point') {
      const points = (selected.meta.points as [number, number][] | undefined) ?? []
      if (points.length < 9) editor.updateShape<CommentShape>({ id: selected.id, type: COMMENT, meta: { ...selected.meta, points: [...points, [p.x, p.y]], mark: null } })
      return
    }
    const hit = editor.getShapeAtPoint(p, { hitInside: true })
    if (hit?.type === COMMENT) {
      editor.select(hit.id)
      return
    }
    const id = createShapeId()
    editor.createShape({ id, type: COMMENT, x: p.x - POINT_SIZE / 2, y: p.y - POINT_SIZE / 2 })
    editor.select(id)
    this.draft = { id, points: [[p.x, p.y]] }
  }

  override onPointerMove() {
    if (this.editor.inputs.getIsDragging()) this.track()
  }

  private track() {
    const editor = this.editor
    if (!this.draft) return
    const kind = commentKindAtom.get()
    if (kind === 'point') return
    const p = editor.inputs.getCurrentPagePoint()
    this.draft.points.push([p.x, p.y])
    const pts = kind === 'box' ? [this.draft.points[0], [p.x, p.y]] : this.draft.points
    const xs = pts.map(([x]) => x)
    const ys = pts.map(([, y]) => y)
    const [l, t] = [Math.min(...xs), Math.min(...ys)]
    const [w, h] = [Math.max(Math.max(...xs) - l, 1), Math.max(Math.max(...ys) - t, 1)]
    const path = kind === 'lasso' ? pts.map(([x, y]) => `${((x - l) / w).toFixed(4)},${((y - t) / h).toFixed(4)}`).join(' ') : ''
    editor.updateShape<CommentShape>({ id: this.draft.id, type: COMMENT, x: l, y: t, props: { w, h, kind, path } })
  }

  override onPointerUp() {
    const editor = this.editor
    if (!this.draft) return
    this.track()
    const shape = editor.getShape<CommentShape>(this.draft.id)
    if (shape && shape.props.kind !== 'point' && Math.max(shape.props.w, shape.props.h) < MIN_DRAG) {
      const [x, y] = this.draft.points[0]
      editor.updateShape<CommentShape>({ id: shape.id, type: COMMENT, x: x - POINT_SIZE / 2, y: y - POINT_SIZE / 2, props: { w: POINT_SIZE, h: POINT_SIZE, kind: 'point', path: '' } })
    }
    this.draft = null
  }
}
