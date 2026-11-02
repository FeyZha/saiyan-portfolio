import {
  atom,
  BaseBoxShapeUtil,
  createShapeId,
  HTMLContainer,
  StateNode,
  T,
  type RecordProps,
  type TLShape,
  type TLShapeId,
} from 'tldraw'

export const DOODLE = 'doodle'

declare module 'tldraw' {
  export interface TLGlobalShapePropsMap {
    [DOODLE]: {
      w: number
      h: number
      nw: number
      nh: number
      color: string
      size: number
      points: string
    }
  }
}

export type DoodleShape = TLShape<typeof DOODLE>

export const doodleColorAtom = atom('doodle color', '#000000')
export const doodleSizeAtom = atom('doodle size', 10)

function pathOf(points: string): string {
  const pts = points.split(' ').map((p) => p.split(',').map(Number))
  if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}l0.01,0`
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i]
    const [nx, ny] = pts[i + 1]
    d += `Q${x},${y} ${(x + nx) / 2},${(y + ny) / 2}`
  }
  const [lx, ly] = pts[pts.length - 1]
  return `${d}L${lx},${ly}`
}

export class DoodleShapeUtil extends BaseBoxShapeUtil<DoodleShape> {
  static override type = DOODLE
  static override props: RecordProps<DoodleShape> = {
    w: T.number,
    h: T.number,
    nw: T.number,
    nh: T.number,
    color: T.string,
    size: T.number,
    points: T.string,
  }

  override getDefaultProps(): DoodleShape['props'] {
    return { w: 1, h: 1, nw: 1, nh: 1, color: '#000000', size: 10, points: '0,0' }
  }

  override canEdit() {
    return false
  }

  override component(shape: DoodleShape) {
    const { w, h, nw, nh, color, size, points } = shape.props
    return (
      <HTMLContainer style={{ overflow: 'visible', pointerEvents: 'none' }}>
        <svg width={w} height={h} viewBox={`0 0 ${nw} ${nh}`} preserveAspectRatio="none" style={{ overflow: 'visible' }}>
          <path d={pathOf(points)} fill="none" stroke={color} strokeWidth={size} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </HTMLContainer>
    )
  }

  override getIndicatorPath(shape: DoodleShape) {
    const path = new Path2D()
    path.rect(0, 0, shape.props.w, shape.props.h)
    return path
  }
}

export class DoodleTool extends StateNode {
  static override id = DOODLE
  private stroke: { id: TLShapeId; points: [number, number][] } | null = null

  override onEnter() {
    this.editor.setCursor({ type: 'cross', rotation: 0 })
  }

  override onCancel() {
    this.editor.setCurrentTool('select')
  }

  override onPointerDown() {
    const p = this.editor.inputs.getCurrentPagePoint()
    this.stroke = { id: createShapeId(), points: [[p.x, p.y]] }
    this.update(true)
  }

  override onPointerMove() {
    if (!this.stroke || !this.editor.inputs.getIsPointing()) return
    const p = this.editor.inputs.getCurrentPagePoint()
    this.stroke.points.push([p.x, p.y])
    this.update(false)
  }

  override onPointerUp() {
    this.stroke = null
  }

  private update(create: boolean) {
    const { id, points } = this.stroke!
    const xs = points.map(([x]) => x)
    const ys = points.map(([, y]) => y)
    const [l, t] = [Math.min(...xs), Math.min(...ys)]
    const [w, h] = [Math.max(Math.max(...xs) - l, 1), Math.max(Math.max(...ys) - t, 1)]
    const props = { w, h, nw: w, nh: h, points: points.map(([x, y]) => `${(x - l).toFixed(1)},${(y - t).toFixed(1)}`).join(' ') }
    if (create) {
      this.editor.createShape<DoodleShape>({ id, type: DOODLE, x: l, y: t, props: { ...props, color: doodleColorAtom.get(), size: doodleSizeAtom.get() } })
    } else {
      this.editor.updateShape<DoodleShape>({ id, type: DOODLE, x: l, y: t, props })
    }
  }
}
