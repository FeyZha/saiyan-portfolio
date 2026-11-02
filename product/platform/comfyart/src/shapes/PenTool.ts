import { StateNode, createShapeId, type TLKeyboardEventInfo, type TLShapeId } from 'tldraw'

import { nodesToPath, type PenNode } from '../vectorPath'
import { VECTOR, type VectorShape } from './VectorShape'

export const PEN = 'ca-pen'
const CLOSE_PX = 10
const OPEN_FILL = '#00000000'
const CLOSED_FILL = '#CCCCCC'

export class PenTool extends StateNode {
  static override id = PEN
  private nodes: PenNode[] = []
  private shape: TLShapeId | null = null
  private dragging = false

  override onEnter() {
    this.editor.setCursor({ type: 'cross', rotation: 0 })
    this.nodes = []
    this.shape = null
  }

  override onExit() {
    this.commit(false)
  }

  override onPointerDown() {
    const p = this.editor.inputs.getCurrentPagePoint()
    const first = this.nodes[0]
    if (first && this.nodes.length > 2 && Math.hypot(p.x - first.x, p.y - first.y) * this.editor.getZoomLevel() < CLOSE_PX) return this.finish(true)
    this.nodes.push({ x: p.x, y: p.y, hx: 0, hy: 0 })
    this.dragging = true
    this.sync(false)
  }

  override onPointerMove() {
    if (!this.dragging || !this.editor.inputs.getIsDragging()) return
    const p = this.editor.inputs.getCurrentPagePoint()
    const last = this.nodes[this.nodes.length - 1]
    Object.assign(last, { hx: p.x - last.x, hy: p.y - last.y })
    this.sync(false)
  }

  override onPointerUp() {
    this.dragging = false
  }

  override onDoubleClick() {
    this.nodes.pop()
    this.finish(false)
  }

  override onKeyDown(info: TLKeyboardEventInfo) {
    if (info.key === 'Enter') this.finish(false)
  }

  override onCancel() {
    this.finish(false)
  }

  private sync(closed: boolean) {
    const { x, y, w, h, d } = nodesToPath(this.nodes, closed)
    const props = { w, h, d, ...(closed ? { fill: CLOSED_FILL } : {}) }
    if (this.shape) return this.editor.updateShape<VectorShape>({ id: this.shape, type: VECTOR, x, y, props })
    this.shape = createShapeId()
    this.editor.createShape<VectorShape>({ id: this.shape, type: VECTOR, x, y, props: { ...props, kind: 'path', fill: OPEN_FILL, stroke: '#333333', strokeWidth: 2 } })
  }

  private commit(closed: boolean) {
    const id = this.shape
    const kept = !!id && this.nodes.length >= 2
    if (kept) this.sync(closed)
    else if (id) this.editor.deleteShape(id)
    this.nodes = []
    this.shape = null
    return kept ? id : null
  }

  private finish(closed: boolean) {
    const id = this.commit(closed)
    this.editor.setCurrentTool('select')
    if (id) this.editor.select(id)
  }
}
