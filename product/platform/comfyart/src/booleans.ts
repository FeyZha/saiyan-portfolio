import { createShapeId, type Editor, type TLShapeId } from 'tldraw'

import { polygonPoints, VECTOR, type VectorShape } from './shapes/VectorShape'
import { loadPaper, normalized, scalePath } from './vectorPath'

export type BoolOp = 'unite' | 'subtract' | 'intersect' | 'exclude'
type Paper = Awaited<ReturnType<typeof loadPaper>>

function itemOf(paper: Paper, editor: Editor, shape: VectorShape): paper.PathItem {
  const { kind, w, h, radius, sides, d } = shape.props
  const rectangle = new paper.Rectangle(0, 0, w, h)
  const item = kind === 'rect'
    ? new paper.Path.Rectangle({ rectangle, radius: Math.min(radius, w / 2, h / 2), insert: false })
    : kind === 'ellipse'
      ? new paper.Path.Ellipse({ rectangle, insert: false })
      : kind === 'path'
        ? new paper.CompoundPath({ pathData: scalePath(d, w, h), insert: false })
        : new paper.Path({ segments: polygonPoints(kind, w, h, sides), closed: true, insert: false })
  const m = editor.getShapePageTransform(shape.id)
  item.transform(new paper.Matrix(m.a, m.b, m.c, m.d, m.e, m.f))
  return item
}

export async function booleanOp(editor: Editor, ids: TLShapeId[], op: BoolOp) {
  const paper = await loadPaper()
  const shapes = editor.getCurrentPageShapesSorted().filter((s): s is VectorShape => ids.includes(s.id) && s.type === VECTOR)
  if (shapes.length < 2) return
  const result = shapes.slice(1).reduce((acc, s) => acc[op](itemOf(paper, editor, s), { insert: false }), itemOf(paper, editor, shapes[0]))
  if (result.isEmpty()) throw new Error('the result is empty')
  const n = normalized(paper, result)
  const base = shapes[0]
  const at = editor.getPointInParentSpace(base.id, { x: n.x, y: n.y })
  const id = createShapeId()
  editor.run(() => {
    editor.deleteShapes(shapes.map((s) => s.id))
    editor.createShape<VectorShape>({ id, type: VECTOR, parentId: base.parentId, index: base.index, x: at.x, y: at.y, props: { ...base.props, kind: 'path', w: n.w, h: n.h, d: n.d } })
  })
  editor.select(id)
}
