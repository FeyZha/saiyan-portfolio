import {
  atom,
  BaseBoxShapeUtil,
  createShapeId,
  createShapePropsMigrationIds,
  createShapePropsMigrationSequence,
  HTMLContainer,
  StateNode,
  T,
  type RecordProps,
  type TLShape,
  type TLShapeId,
} from 'tldraw'

import { scalePath } from '../vectorPath'

export const VECTOR = 'ca-shape'
export type VectorKind = 'rect' | 'ellipse' | 'polygon' | 'star'
export interface GradientStop { offset: number; color: string }

declare module 'tldraw' {
  export interface TLGlobalShapePropsMap {
    [VECTOR]: {
      w: number
      h: number
      kind: string
      fill: string
      radius: number
      sides: number
      fillType: string
      stops: GradientStop[]
      image: string
      blend: string
      angle: number
      stroke: string
      strokeWidth: number
      strokeAlign: string
      dash: string
      d: string
    }
  }
}

export type VectorShape = TLShape<typeof VECTOR>

const versions = createShapePropsMigrationIds(VECTOR, { AddStrokeGradient: 1, AddPaint: 2, AddPath: 3 })

export const vectorKindAtom = atom<VectorKind>('vector kind', 'rect')
export const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity']

const CLICK_W = 320
const RECT_H = 200
const MIN_DRAG = 4

export function polygonPoints(kind: string, w: number, h: number, sides: number): [number, number][] {
  const n = kind === 'star' ? sides * 2 : sides
  return Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n
    const r = kind === 'star' && i % 2 ? 0.45 : 1
    return [w / 2 + (Math.cos(a) * r * w) / 2, h / 2 + (Math.sin(a) * r * h) / 2]
  })
}

const points = (kind: string, w: number, h: number, sides: number) => polygonPoints(kind, w, h, sides).map((p) => p.join(',')).join(' ')

function Stops({ stops }: { stops: GradientStop[] }) {
  return <>{[...stops].sort((a, b) => a.offset - b.offset).map((s, i) => <stop key={i} offset={s.offset} stopColor={s.color} />)}</>
}

export class VectorShapeUtil extends BaseBoxShapeUtil<VectorShape> {
  static override type = VECTOR
  static override props: RecordProps<VectorShape> = {
    w: T.number,
    h: T.number,
    kind: T.string,
    fill: T.string,
    radius: T.number,
    sides: T.number,
    fillType: T.string,
    stops: T.arrayOf(T.object({ offset: T.number, color: T.string })),
    image: T.string,
    blend: T.string,
    angle: T.number,
    stroke: T.string,
    strokeWidth: T.number,
    strokeAlign: T.string,
    dash: T.string,
    d: T.string,
  }

  static override migrations = createShapePropsMigrationSequence({
    sequence: [
      {
        id: versions.AddStrokeGradient,
        up: (props) => Object.assign(props, { fillType: 'solid', fill2: '#FFFFFF', angle: 90, stroke: '', strokeWidth: 4, strokeAlign: 'center', dash: 'solid' }),
      },
      {
        id: versions.AddPaint,
        up: (props) => {
          Object.assign(props, { stops: [{ offset: 0, color: props.fill }, { offset: 1, color: props.fill2 }], image: '', blend: 'normal' })
          delete props.fill2
        },
      },
      { id: versions.AddPath, up: (props) => { props.d = '' } },
    ],
  })

  override getDefaultProps(): VectorShape['props'] {
    return {
      w: CLICK_W, h: RECT_H, kind: 'rect', fill: '#CCCCCC', radius: 0, sides: 5,
      fillType: 'solid', stops: [{ offset: 0, color: '#CCCCCC' }, { offset: 1, color: '#FFFFFF' }], image: '', blend: 'normal',
      angle: 90, stroke: '#333333', strokeWidth: 2, strokeAlign: 'center', dash: 'solid', d: '',
    }
  }

  override canEdit(shape: VectorShape) {
    return shape.props.kind === 'path'
  }

  override component(shape: VectorShape) {
    const { w, h, kind, fill, radius, sides, fillType, stops, image, blend, angle, stroke, strokeWidth, strokeAlign, dash, d } = shape.props
    const gid = `g-${shape.id.replace(/\W/g, '')}`
    const cid = `c-${shape.id.replace(/\W/g, '')}`
    const paint = fillType === 'solid' || (fillType === 'image' && !image) ? fill : `url(#${gid})`
    const sw = stroke ? strokeWidth * (strokeAlign === 'center' ? 1 : 2) : 0
    const dashArray = dash === 'dashed' ? `${strokeWidth * 3} ${strokeWidth * 2}` : dash === 'dotted' ? `0 ${strokeWidth * 2}` : undefined
    const outline = kind === 'rect'
      ? <rect width={w} height={h} rx={Math.min(radius, w / 2, h / 2)} />
      : kind === 'ellipse'
        ? <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} />
        : kind === 'path'
          ? <path d={scalePath(d, w, h)} fillRule="evenodd" />
          : <polygon points={points(kind, w, h, sides)} />
    const rad = (angle * Math.PI) / 180
    return (
      <HTMLContainer style={{ pointerEvents: 'none', mixBlendMode: blend === 'normal' ? undefined : blend as React.CSSProperties['mixBlendMode'] }}>
        <svg width={w} height={h} style={{ overflow: 'visible', display: 'block' }}>
          <defs>
            {fillType === 'linear' && (
              <linearGradient id={gid} x1={0.5 - Math.cos(rad) / 2} y1={0.5 - Math.sin(rad) / 2} x2={0.5 + Math.cos(rad) / 2} y2={0.5 + Math.sin(rad) / 2}>
                <Stops stops={stops} />
              </linearGradient>
            )}
            {fillType === 'radial' && <radialGradient id={gid}><Stops stops={stops} /></radialGradient>}
            {fillType === 'image' && image && (
              <pattern id={gid} patternUnits="userSpaceOnUse" width={w} height={h}>
                <image href={image} width={w} height={h} preserveAspectRatio="xMidYMid slice" />
              </pattern>
            )}
            {strokeAlign === 'inside' && <clipPath id={cid}>{outline}</clipPath>}
          </defs>
          {strokeAlign !== 'outside' && <g fill={paint}>{outline}</g>}
          {stroke && (
            <g
              fill="none"
              stroke={stroke}
              strokeWidth={sw}
              strokeDasharray={dashArray}
              strokeLinecap={dash === 'dotted' ? 'round' : undefined}
              clipPath={strokeAlign === 'inside' ? `url(#${cid})` : undefined}
            >
              {outline}
            </g>
          )}
          {strokeAlign === 'outside' && <g fill={paint}>{outline}</g>}
        </svg>
      </HTMLContainer>
    )
  }

  override getIndicatorPath(shape: VectorShape) {
    const { kind, d, w, h } = shape.props
    if (kind === 'path' && d) return new Path2D(scalePath(d, w, h))
    const path = new Path2D()
    path.rect(0, 0, w, h)
    return path
  }
}

export class VectorTool extends StateNode {
  static override id = VECTOR
  private draft: { id: TLShapeId; x: number; y: number } | null = null

  override onEnter() {
    this.editor.setCursor({ type: 'cross', rotation: 0 })
  }

  override onCancel() {
    this.editor.setCurrentTool('select')
  }

  override onPointerDown() {
    const p = this.editor.inputs.getCurrentPagePoint()
    const id = createShapeId()
    this.editor.createShape<VectorShape>({ id, type: VECTOR, x: p.x, y: p.y, props: { kind: vectorKindAtom.get(), w: 1, h: 1 } })
    this.draft = { id, x: p.x, y: p.y }
  }

  override onPointerMove() {
    if (!this.draft || !this.editor.inputs.getIsDragging()) return
    this.track()
  }

  override onPointerUp() {
    const editor = this.editor
    if (!this.draft) return
    this.track()
    const shape = editor.getShape<VectorShape>(this.draft.id)
    if (shape && Math.max(shape.props.w, shape.props.h) < MIN_DRAG) {
      const h = shape.props.kind === 'rect' ? RECT_H : CLICK_W
      editor.updateShape<VectorShape>({ id: shape.id, type: VECTOR, x: this.draft.x - CLICK_W / 2, y: this.draft.y - h / 2, props: { w: CLICK_W, h } })
    }
    const id = this.draft.id
    this.draft = null
    editor.setCurrentTool('select')
    editor.select(id)
  }

  private track() {
    const { id, x, y } = this.draft!
    const p = this.editor.inputs.getCurrentPagePoint()
    let [w, h] = [Math.abs(p.x - x), Math.abs(p.y - y)]
    if (this.editor.inputs.getShiftKey()) w = h = Math.max(w, h)
    this.editor.updateShape<VectorShape>({
      id,
      type: VECTOR,
      x: p.x < x ? x - w : x,
      y: p.y < y ? y - h : y,
      props: { w: Math.max(w, 1), h: Math.max(h, 1) },
    })
  }
}
