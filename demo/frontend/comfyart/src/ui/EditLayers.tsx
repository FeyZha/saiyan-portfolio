import { useEffect, useRef, useState } from 'react'
import { useEditor, useValue, type TLAssetId } from 'tldraw'

import { drawStrokes, type Pads } from '../actions'
import { boxesAtom, brushAtom, modeAtom, padsAtom, strokesAtom } from './mode'
import { useSelectedImage, useSelectionRect, type ScreenRect } from './selection'
import { t } from '../i18n'

function imageSize(editor: ReturnType<typeof useEditor>, assetId: string | null): [number, number] {
  const asset = assetId ? editor.getAsset(assetId as TLAssetId) : null
  return asset?.type === 'image' ? [asset.props.w, asset.props.h] : [1, 1]
}

function EraseLayer({ rect }: { rect: ScreenRect }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const strokes = useValue(strokesAtom)
  const brush = useValue(brushAtom)
  const [cursor, setCursor] = useState<[number, number] | null>(null)
  const drawing = useRef(false)
  const [w, h] = [rect.r - rect.l, rect.b - rect.t]

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const dpr = devicePixelRatio || 1
    c.width = Math.max(1, Math.round(w * dpr))
    c.height = Math.max(1, Math.round(h * dpr))
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.strokeStyle = 'rgba(59,130,246,.5)'
    drawStrokes(ctx, strokes, c.width, c.height)
  }, [strokes, w, h])

  const uv = (e: React.PointerEvent): [number, number] => {
    const b = canvas.current!.getBoundingClientRect()
    return [Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), Math.min(1, Math.max(0, (e.clientY - b.top) / b.height))]
  }

  return (
    <>
      <canvas
        ref={canvas}
        className="ca-erase"
        style={{ left: rect.l, top: rect.t, width: w, height: h }}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.stopPropagation()
          e.currentTarget.setPointerCapture(e.pointerId)
          drawing.current = true
          strokesAtom.set([...strokesAtom.get(), { points: [uv(e)], r: brush / 2 / Math.max(1, w) }])
        }}
        onPointerMove={(e) => {
          const b = canvas.current!.getBoundingClientRect()
          setCursor([e.clientX - b.left + rect.l, e.clientY - b.top + rect.t])
          if (!drawing.current) return
          e.stopPropagation()
          const all = strokesAtom.get()
          const last = all[all.length - 1]
          strokesAtom.set([...all.slice(0, -1), { ...last, points: [...last.points, uv(e)] }])
        }}
        onPointerUp={() => { drawing.current = false }}
        onPointerLeave={() => setCursor(null)}
      />
      {cursor && <div className="ca-erase__cursor" style={{ left: cursor[0] - brush / 2, top: cursor[1] - brush / 2, width: brush, height: brush }} />}
    </>
  )
}

function ExpandLayer({ rect, imageW }: { rect: ScreenRect; imageW: number }) {
  const pads = useValue(padsAtom)
  const drag = useRef<{ side: keyof Pads; x: number; y: number; v: number } | null>(null)
  const s = (rect.r - rect.l) / Math.max(1, imageW)
  const outer = { l: rect.l - pads.l * s, t: rect.t - pads.t * s, r: rect.r + pads.r * s, b: rect.b + pads.b * s }

  const handle = (side: keyof Pads) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation()
      e.currentTarget.setPointerCapture(e.pointerId)
      drag.current = { side, x: e.clientX, y: e.clientY, v: padsAtom.get()[side] }
    },
    onPointerMove: (e: React.PointerEvent) => {
      const d = drag.current
      if (!d) return
      const delta = side === 'l' ? d.x - e.clientX : side === 'r' ? e.clientX - d.x : side === 't' ? d.y - e.clientY : e.clientY - d.y
      padsAtom.set({ ...padsAtom.get(), [side]: Math.max(0, Math.round(d.v + delta / s)) })
    },
    onPointerUp: () => { drag.current = null },
  })

  return (
    <div className="ca-expand" style={{ left: outer.l, top: outer.t, width: outer.r - outer.l, height: outer.b - outer.t }}>
      <div className="ca-expand__strip" style={{ left: 0, top: 0, right: 0, height: pads.t * s }} />
      <div className="ca-expand__strip" style={{ left: 0, bottom: 0, right: 0, height: pads.b * s }} />
      <div className="ca-expand__strip" style={{ left: 0, top: pads.t * s, width: pads.l * s, height: rect.b - rect.t }} />
      <div className="ca-expand__strip" style={{ right: 0, top: pads.t * s, width: pads.r * s, height: rect.b - rect.t }} />
      {(['l', 't', 'r', 'b'] as const).map((side) => <div key={side} className="ca-expand__handle" data-side={side} {...handle(side)} />)}
    </div>
  )
}

function BoxLayer({ rect }: { rect: ScreenRect }) {
  const boxes = useValue(boxesAtom)
  const [draft, setDraft] = useState<[number, number, number, number] | null>(null)
  const [w, h] = [rect.r - rect.l, rect.b - rect.t]
  const uv = (e: React.PointerEvent): [number, number] => {
    const b = e.currentTarget.getBoundingClientRect()
    return [Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), Math.min(1, Math.max(0, (e.clientY - b.top) / b.height))]
  }
  const norm = ([x0, y0, x1, y1]: [number, number, number, number]): [number, number, number, number] => [Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)]
  return (
    <div
      className="ca-boxes"
      style={{ left: rect.l, top: rect.t, width: w, height: h }}
      onPointerDown={(e) => {
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        const [x, y] = uv(e)
        setDraft([x, y, x, y])
      }}
      onPointerMove={(e) => { if (draft) { const [x, y] = uv(e); setDraft([draft[0], draft[1], x, y]) } }}
      onPointerUp={() => {
        if (draft) {
          const box = norm(draft)
          if (box[2] > 0.02 && box[3] > 0.02) boxesAtom.set([...boxes, box])
        }
        setDraft(null)
      }}
    >
      {[...boxes, ...(draft ? [norm(draft)] : [])].map(([x, y, bw, bh], i) => (
        <div key={i} className="ca-boxes__box" style={{ left: x * w, top: y * h, width: bw * w, height: bh * h }}>
          <span>{i + 1}</span>
          {i < boxes.length && <button type="button" title={t('common.remove')} onPointerDown={(e) => e.stopPropagation()} onClick={() => boxesAtom.set(boxes.filter((_, j) => j !== i))}>×</button>}
        </div>
      ))}
    </div>
  )
}

const HANDLES: [string, number, number][] = [['nw', 0, 0], ['n', 0.5, 0], ['ne', 1, 0], ['e', 1, 0.5], ['se', 1, 1], ['s', 0.5, 1], ['sw', 0, 1], ['w', 0, 0.5]]

function SingleBoxLayer({ rect }: { rect: ScreenRect }) {
  const box = useValue(boxesAtom)[0] ?? null
  const drag = useRef<{ h: string; from: [number, number]; edges: [number, number, number, number] } | null>(null)
  const [w, h] = [rect.r - rect.l, rect.b - rect.t]
  const uv = (e: React.PointerEvent): [number, number] => {
    const b = e.currentTarget.getBoundingClientRect()
    return [Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), Math.min(1, Math.max(0, (e.clientY - b.top) / b.height))]
  }
  return (
    <div
      className="ca-boxes"
      style={{ left: rect.l, top: rect.t, width: w, height: h }}
      onPointerDown={(e) => {
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        const p = uv(e)
        const handle = (e.target as HTMLElement).dataset.h
        drag.current = handle && box ? { h: handle, from: p, edges: [box[0], box[1], box[0] + box[2], box[1] + box[3]] } : { h: 'new', from: p, edges: [p[0], p[1], p[0], p[1]] }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        const [x, y] = uv(e)
        let [l, t, r, b] = d.edges
        if (d.h === 'new') [r, b] = [x, y]
        else if (d.h === 'move') {
          const dx = Math.min(Math.max(x - d.from[0], -l), 1 - r)
          const dy = Math.min(Math.max(y - d.from[1], -t), 1 - b)
          ;[l, t, r, b] = [l + dx, t + dy, r + dx, b + dy]
        } else {
          if (d.h.includes('w')) l = x
          if (d.h.includes('e')) r = x
          if (d.h.includes('n')) t = y
          if (d.h.includes('s')) b = y
        }
        boxesAtom.set([[Math.min(l, r), Math.min(t, b), Math.abs(r - l), Math.abs(b - t)]])
      }}
      onPointerUp={() => {
        drag.current = null
        const [, , bw, bh] = boxesAtom.get()[0] ?? [0, 0, 0, 0]
        if (bw < 0.01 || bh < 0.01) boxesAtom.set([])
      }}
    >
      {box && (
        <div className="ca-boxes__box" data-h="move" style={{ left: box[0] * w, top: box[1] * h, width: box[2] * w, height: box[3] * h, cursor: 'move' }}>
          {HANDLES.map(([id, x, y]) => <i key={id} className="ca-boxes__handle" data-h={id} style={{ left: `${x * 100}%`, top: `${y * 100}%`, cursor: `${id}-resize` }} />)}
        </div>
      )}
    </div>
  )
}

export function EditLayers() {
  const editor = useEditor()
  const mode = useValue(modeAtom)
  const shape = useSelectedImage()
  const rect = useSelectionRect()
  if (!shape || !rect) return null
  if (mode === 'erase') return <EraseLayer rect={rect} />
  if (mode === 'expand') return <ExpandLayer rect={rect} imageW={imageSize(editor, shape.props.assetId)[0]} />
  if (mode === 'layers') return <BoxLayer rect={rect} />
  if (mode === 'separate') return <SingleBoxLayer rect={rect} />
  return null
}
