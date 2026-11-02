import { useEffect, useRef, useState } from 'react'
import { useEditor, useValue } from 'tldraw'

import { loadImage } from '../adjust'
import { replacePixels } from '../imageOps'
import { errorText } from '../jobs'
import { exitMode, modeAtom } from './mode'
import { useElementSize, useSelectedImage, useSelectionRect } from './selection'
import { t } from '../i18n'
import { useEscape } from './escape'

const GAP = 12
const EDGE = 8
const MAX_SIDE = 2048
const UNDO = 20

function smudge(ctx: CanvasRenderingContext2D, carry: ImageData, x: number, y: number, strength: number): ImageData {
  const d = carry.width
  const r = d / 2
  const target = ctx.getImageData(Math.round(x - r), Math.round(y - r), d, d)
  const a = carry.data
  const b = target.data
  for (let j = 0; j < d; j++) {
    for (let i = 0; i < d; i++) {
      const dist = Math.hypot(i - r + 0.5, j - r + 0.5) / r
      if (dist >= 1) continue
      const k = strength * (1 - dist * dist)
      const p = (j * d + i) * 4
      for (let c = 0; c < 4; c++) b[p + c] = a[p + c] * k + b[p + c] * (1 - k)
    }
  }
  ctx.putImageData(target, Math.round(x - r), Math.round(y - r))
  return target
}

export function SmudgePanel({ onError }: { onError: (msg: string) => void }) {
  const editor = useEditor()
  const mode = useValue(modeAtom)
  const shape = useSelectedImage()
  const rect = useSelectionRect()
  const panel = useRef<HTMLDivElement>(null)
  const view = useRef<HTMLCanvasElement>(null)
  const undo = useRef<ImageData[]>([])
  const drag = useRef<{ last: [number, number]; carry: ImageData } | null>(null)
  const size = useElementSize(panel, { w: 280, h: 200 })
  const [brush, setBrush] = useState(40)
  const [cursor, setCursor] = useState<[number, number] | null>(null)
  const [strength, setStrength] = useState(60)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const active = mode === 'smudge'
  const src = shape?.props.assetId ? editor.getAsset(shape.props.assetId)?.props.src : null

  useEffect(() => {
    setReady(false)
    undo.current = []
    if (!active || !src) return
    let alive = true
    loadImage(src).then((img) => {
      const c = view.current
      if (!alive || !c) return
      const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
      c.width = Math.round(img.naturalWidth * k)
      c.height = Math.round(img.naturalHeight * k)
      c.getContext('2d', { willReadFrequently: true })!.drawImage(img, 0, 0, c.width, c.height)
      setReady(true)
    }).catch((e) => onError(String(e)))
    return () => { alive = false }
  }, [active, src, onError])

  useEscape(active, exitMode)

  useEffect(() => {
    if (active && !shape) exitMode()
  }, [active, shape])

  if (!active || !shape || !rect) return null
  const c = view.current
  const ctx = c?.getContext('2d', { willReadFrequently: true })
  const scale = c ? c.width / (rect.r - rect.l) : 1
  const at = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const b = e.currentTarget.getBoundingClientRect()
    return [((e.clientX - b.left) / b.width) * e.currentTarget.width, ((e.clientY - b.top) / b.height) * e.currentTarget.height]
  }
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.stopPropagation()
    if (!ctx || !c || !ready) return
    e.currentTarget.setPointerCapture(e.pointerId)
    undo.current = [...undo.current.slice(1 - UNDO), ctx.getImageData(0, 0, c.width, c.height)]
    const p = at(e)
    const d = Math.max(2, Math.round(brush * scale))
    drag.current = { last: p, carry: ctx.getImageData(Math.round(p[0] - d / 2), Math.round(p[1] - d / 2), d, d) }
  }
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const b = e.currentTarget.getBoundingClientRect()
    setCursor([e.clientX - b.left + rect.l, e.clientY - b.top + rect.t])
    const s = drag.current
    if (!s || !ctx) return
    const p = at(e)
    const step = Math.max(1, s.carry.width / 4)
    const n = Math.ceil(Math.hypot(p[0] - s.last[0], p[1] - s.last[1]) / step)
    for (let i = 1; i <= n; i++) {
      const x = s.last[0] + ((p[0] - s.last[0]) * i) / n
      const y = s.last[1] + ((p[1] - s.last[1]) * i) / n
      s.carry = smudge(ctx, s.carry, x, y, strength / 100)
    }
    if (n) s.last = p
  }
  const back = () => {
    const last = undo.current.pop()
    if (last && ctx) ctx.putImageData(last, 0, 0)
  }
  const apply = async () => {
    if (!c) return
    setBusy(true)
    try {
      await replacePixels(editor, shape, c)
      exitMode()
    } catch (e) {
      onError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const host = editor.getContainer().getBoundingClientRect()
  const left = rect.r + GAP + size.w > host.width - EDGE ? Math.max(EDGE, rect.l - size.w - GAP) : rect.r + GAP
  const top = Math.min(Math.max(rect.t, EDGE), host.height - size.h - EDGE)

  return (
    <>
      <canvas
        ref={view}
        className="ca-inpaint__mask"
        data-tool="brush"
        style={{ left: rect.l, top: rect.t, width: rect.r - rect.l, height: rect.b - rect.t }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={() => { drag.current = null }}
        onPointerLeave={() => setCursor(null)}
        onWheel={(e) => e.stopPropagation()}
      />
      {cursor && <div className="ca-erase__cursor" style={{ left: cursor[0] - brush / 2, top: cursor[1] - brush / 2, width: brush, height: brush }} />}
      <div ref={panel} className="ca-panel" style={{ left, top }} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
        <div className="ca-panel__head"><span>{t('common.smudge')}</span></div>
        <label className="ca-panel__row"><span>{t('inpaintPanel.brushSize')}</span><input type="range" min={4} max={200} value={brush} onChange={(e) => setBrush(Number(e.target.value))} /><span className="ca-panel__val">{brush}</span></label>
        <label className="ca-panel__row"><span>{t('smudgePanel.smudgeStrength')}</span><input type="range" min={5} max={100} value={strength} onChange={(e) => setStrength(Number(e.target.value))} /><span className="ca-panel__val">{strength}</span></label>
        <div className="ca-panel__chips">
          <button type="button" className="ca-panel__chip" onClick={back}>{t('common.undo')}</button>
        </div>
        <div className="ca-panel__foot">
          <button type="button" className="ca-panel__secondary" onClick={exitMode}>{t('common.cancel')}</button>
          <button type="button" className="ca-panel__primary" disabled={busy || !ready} onClick={() => void apply()}>{t('adjustPanel.apply')}</button>
        </div>
      </div>
    </>
  )
}
