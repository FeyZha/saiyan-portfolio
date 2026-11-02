import { useEffect, useRef, useState } from 'react'
import { useEditor, useValue } from 'tldraw'

import { VECTOR, type VectorShape } from '../shapes/VectorShape'
import { loadPaper, normalized } from '../vectorPath'

type Paper = Awaited<ReturnType<typeof loadPaper>>
type Part = 'point' | 'in' | 'out'

export function PathEditor() {
  const editor = useEditor()
  const shape = useValue('editing path', () => {
    const id = editor.getEditingShapeId()
    const s = id ? editor.getShape(id) : null
    return s?.type === VECTOR && (s as VectorShape).props.kind === 'path' ? (s as VectorShape) : null
  }, [editor])
  useValue('camera', () => editor.getCamera(), [editor])
  const [paper, setPaper] = useState<Paper | null>(null)
  const drag = useRef<{ item: paper.CompoundPath; seg: paper.Segment; part: Part } | null>(null)

  useEffect(() => { if (shape && !paper) void loadPaper().then(setPaper) }, [shape, paper])

  if (!shape || !paper) return null
  const { w, h, d } = shape.props
  const xf = editor.getShapePageTransform(shape.id)
  const item = drag.current?.item ?? new paper.CompoundPath({ pathData: d, insert: false })
  const screen = (p: paper.Point) => editor.pageToViewport(xf.applyToPoint({ x: p.x * w, y: p.y * h }))
  const local = (e: React.PointerEvent) => {
    const page = editor.screenToPage({ x: e.clientX, y: e.clientY })
    const q = xf.clone().invert().applyToPoint(page)
    return new paper.Point(q.x / w, q.y / h)
  }

  const start = (seg: paper.Segment, part: Part) => (e: React.PointerEvent) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { item, seg, part }
  }
  const move = (e: React.PointerEvent) => {
    const g = drag.current
    if (!g) return
    const p = local(e)
    if (g.part === 'point') g.seg.point = p
    else if (g.part === 'in') g.seg.handleIn = p.subtract(g.seg.point)
    else g.seg.handleOut = p.subtract(g.seg.point)
    editor.updateShape<VectorShape>({ id: shape.id, type: VECTOR, props: { d: g.item.pathData } })
  }
  const end = () => {
    const g = drag.current
    drag.current = null
    if (!g) return
    const n = normalized(paper, g.item)
    const page = xf.applyToPoint({ x: n.x * w, y: n.y * h })
    const at = editor.getPointInParentSpace(shape.id, page)
    editor.updateShape<VectorShape>({ id: shape.id, type: VECTOR, x: at.x, y: at.y, props: { w: n.w * w, h: n.h * h, d: n.d } })
  }

  const segments = (item.children as paper.Path[]).flatMap((path) => path.segments)
  return (
    <svg className="ca-pathedit" onPointerMove={move} onPointerUp={end}>
      {segments.map((seg, i) => {
        const a = screen(seg.point)
        const hin = seg.handleIn.isZero() ? null : screen(seg.point.add(seg.handleIn))
        const hout = seg.handleOut.isZero() ? null : screen(seg.point.add(seg.handleOut))
        return (
          <g key={i}>
            {hin && <line x1={a.x} y1={a.y} x2={hin.x} y2={hin.y} />}
            {hout && <line x1={a.x} y1={a.y} x2={hout.x} y2={hout.y} />}
            {hin && <circle className="ca-pathedit__handle" cx={hin.x} cy={hin.y} r={4} onPointerDown={start(seg, 'in')} />}
            {hout && <circle className="ca-pathedit__handle" cx={hout.x} cy={hout.y} r={4} onPointerDown={start(seg, 'out')} />}
            <rect className="ca-pathedit__node" x={a.x - 5} y={a.y - 5} width={10} height={10} onPointerDown={start(seg, 'point')} />
          </g>
        )
      })}
    </svg>
  )
}
