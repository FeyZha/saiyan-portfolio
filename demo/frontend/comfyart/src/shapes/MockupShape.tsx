import { useEffect, useRef } from 'react'
import { BaseBoxShapeUtil, HTMLContainer, T, type RecordProps, type TLShape } from 'tldraw'

import { bakeMockup, MockupRenderer, type MockupSources, type Placement } from '../mockupGl'

export const MOCKUP = 'ca-mockup'
const VIEW_LONG = 1024

declare module 'tldraw' {
  export interface TLGlobalShapePropsMap {
    [MOCKUP]: { w: number; h: number; name: string; photo: string; depth: string; mask: string; design: string; x: number; y: number; scale: number; rotation: number; warp: number }
  }
}

export type MockupShape = TLShape<typeof MOCKUP>

export const sourcesOf = (p: MockupShape['props']): MockupSources => ({ photo: p.photo, depth: p.depth, mask: p.mask, design: p.design })
export const placementOf = (p: MockupShape['props']): Placement => ({ x: p.x, y: p.y, scale: p.scale, rotation: p.rotation, warp: p.warp })

function MockupView({ shape }: { shape: MockupShape }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const renderer = useRef<MockupRenderer | null>(null)
  const p = shape.props

  useEffect(() => {
    let alive = true
    const r = renderer.current ?? (renderer.current = new MockupRenderer(canvas.current!))
    void r.load(sourcesOf(p)).then(() => {
      if (!alive) return
      const [w, h] = r.size
      const k = Math.min(1, VIEW_LONG / Math.max(w, h))
      if (canvas.current!.width !== Math.round(w * k)) [canvas.current!.width, canvas.current!.height] = [Math.round(w * k), Math.round(h * k)]
      r.draw(placementOf(p))
    })
    return () => { alive = false }
  }, [p.photo, p.depth, p.mask, p.design, p.x, p.y, p.scale, p.rotation, p.warp])

  return <canvas ref={canvas} className="ca-mockup" />
}

export class MockupShapeUtil extends BaseBoxShapeUtil<MockupShape> {
  static override type = MOCKUP
  static override props: RecordProps<MockupShape> = {
    w: T.number, h: T.number, name: T.string, photo: T.string, depth: T.string, mask: T.string, design: T.string,
    x: T.number, y: T.number, scale: T.number, rotation: T.number, warp: T.number,
  }
  override getDefaultProps(): MockupShape['props'] {
    return { w: 512, h: 512, name: 'Mockup', photo: '', depth: '', mask: '', design: '', x: 0.5, y: 0.5, scale: 0.4, rotation: 0, warp: 0.5 }
  }
  override component(shape: MockupShape) {
    return <HTMLContainer className="ca-embed"><MockupView shape={shape} /></HTMLContainer>
  }
  override getIndicatorPath(shape: MockupShape) {
    const path = new Path2D()
    path.rect(0, 0, shape.props.w, shape.props.h)
    return path
  }
  override async toSvg(shape: MockupShape) {
    const blob = await bakeMockup(sourcesOf(shape.props), placementOf(shape.props))
    const href = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(blob) })
    return <image href={href} width={shape.props.w} height={shape.props.h} />
  }
}
