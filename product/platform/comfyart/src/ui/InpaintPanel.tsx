import { useEffect, useMemo, useRef, useState } from 'react'
import { useEditor, useValue } from 'tldraw'

import * as actions from '../actions'
import { loadImage } from '../adjust'
import { queuePrompt, viewUrl, waitForImages } from '../comfy'
import { errorText } from '../jobs'
import { annotated, samGraph } from '../workflows'
import { exitMode, modeAtom } from './mode'
import { useElementSize, useSelectedImage, useSelectionRect } from './selection'
import { Chips } from './Chips'
import { t } from '../i18n'
import { useEscape } from './escape'

const GAP = 12
const EDGE = 8
const MAX_SIDE = 1536
const UNDO = 20

type Tool = 'brush' | 'eraser' | 'lasso' | 'rect' | 'smart' | 'drag'
const TOOLS: [Tool, string][] = [['brush', t('inpaintPanel.brush')], ['eraser', t('inpaintPanel.eraser')], ['lasso', t('inpaintPanel.lasso')], ['rect', t('dock.boxSelect')], ['smart', t('inpaintPanel.smart')]]
const INPAINT_STYLES: [string, string][] = [
  [t('inpaintPanel.keepOriginal'), ''],
  [t('inpaintPanel.realistic'), 'photorealistic'],
  [t('inpaintPanel.photorealistic'), 'professional portrait photography'],
  [t('inpaintPanel.anime'), 'anime illustration'],
  [t('common.illustration'), 'artistic illustration'],
  [t('common.3d'), '3D render'],
  [t('inpaintPanel.gameConceptArt'), 'game CG artwork'],
]
const SUBJECTS: [string, string][] = [[t('inpaintPanel.subject'), 'main subject'], [t('inpaintPanel.face'), 'face'], [t('inpaintPanel.skin'), 'skin'], [t('inpaintPanel.hair'), 'hair']]

export function InpaintPanel({ onError }: { onError: (msg: string) => void }) {
  const editor = useEditor()
  const mode = useValue(modeAtom)
  const shape = useSelectedImage()
  const rect = useSelectionRect()
  const panel = useRef<HTMLDivElement>(null)
  const view = useRef<HTMLCanvasElement>(null)
  const mask = useRef<HTMLCanvasElement | null>(null)
  const undo = useRef<ImageData[]>([])
  const drag = useRef<[number, number][]>([])
  const size = useElementSize(panel, { w: 300, h: 360 })
  const [tool, setTool] = useState<Tool>('brush')
  const [brush, setBrush] = useState(40)
  const [cursor, setCursor] = useState<[number, number] | null>(null)
  const [feather, setFeather] = useState(8)
  const [prompt, setPrompt] = useState('')
  const [style, setStyle] = useState('')
  const [version, setVersion] = useState(0)
  const [busy, setBusy] = useState(false)
  const [offset, setOffset] = useState<[number, number]>([0, 0])
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const move = mode === 'move'
  const active = mode === 'inpaint' || move
  const asset = shape?.props.assetId ? editor.getAsset(shape.props.assetId) : null
  const src = asset?.type === 'image' ? asset.props.src : null
  const hasSelection = useMemo(() => active && !!mask.current && !!actions.maskBounds(mask.current), [active, version])

  useEffect(() => {
    if (!active || !asset || asset.type !== 'image') return
    const k = Math.min(1, MAX_SIDE / Math.max(asset.props.w, asset.props.h))
    const c = document.createElement('canvas')
    c.width = Math.round(asset.props.w * k)
    c.height = Math.round(asset.props.h * k)
    mask.current = c
    undo.current = []
    setPrompt('')
    setOffset([0, 0])
    setTool(mode === 'move' ? 'lasso' : 'brush')
    setVersion((v) => v + 1)
    if (mode === 'move' && asset.props.src) void loadImage(asset.props.src).then(setImg).catch((e) => onError(String(e)))
  }, [active, asset?.id])

  useEffect(() => {
    const c = view.current
    const m = mask.current
    if (!c || !m) return
    c.width = m.width
    c.height = m.height
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.drawImage(m, 0, 0)
    ctx.globalCompositeOperation = 'source-in'
    ctx.fillStyle = 'rgba(59,130,246,.5)'
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.globalCompositeOperation = 'source-over'
    if (img && (offset[0] || offset[1])) {
      const cut = document.createElement('canvas')
      cut.width = c.width
      cut.height = c.height
      const k = cut.getContext('2d')!
      k.drawImage(img, 0, 0, c.width, c.height)
      k.globalCompositeOperation = 'destination-in'
      k.drawImage(m, 0, 0)
      ctx.drawImage(cut, offset[0], offset[1])
    }
    const pts = drag.current
    if (pts.length > 1 && (tool === 'lasso' || tool === 'rect')) {
      ctx.strokeStyle = '#3b82f6'
      ctx.lineWidth = Math.max(2, c.width / 400)
      ctx.setLineDash([8, 6])
      ctx.beginPath()
      if (tool === 'rect') {
        const [[x0, y0], [x1, y1]] = [pts[0], pts[pts.length - 1]]
        ctx.rect(x0, y0, x1 - x0, y1 - y0)
      } else pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      ctx.stroke()
    }
  }, [version, tool, offset, img])

  useEscape(active, exitMode)

  useEffect(() => {
    if (active && !shape) exitMode()
  }, [active, shape])

  if (!active || !shape || !rect || !mask.current || !src) return null
  const m = mask.current
  const ctx = m.getContext('2d', { willReadFrequently: true })!
  const scale = m.width / (rect.r - rect.l)
  const redraw = () => setVersion((v) => v + 1)
  const snapshot = () => {
    undo.current = [...undo.current.slice(1 - UNDO), ctx.getImageData(0, 0, m.width, m.height)]
  }
  const at = (e: React.PointerEvent): [number, number] => {
    const b = e.currentTarget.getBoundingClientRect()
    return [((e.clientX - b.left) / b.width) * m.width, ((e.clientY - b.top) / b.height) * m.height]
  }
  const paint = (from: [number, number], to: [number, number]) => {
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'
    ctx.strokeStyle = '#fff'
    ctx.lineCap = 'round'
    ctx.lineWidth = brush * scale
    ctx.beginPath()
    ctx.moveTo(...from)
    ctx.lineTo(to[0] + 0.01, to[1])
    ctx.stroke()
    ctx.globalCompositeOperation = 'source-over'
  }

  const smart = async (target: { text: string } | { x: number; y: number }) => {
    setBusy(true)
    try {
      const { graph, result } = samGraph(annotated(src), target)
      const [ref] = await waitForImages(await queuePrompt(graph), result)
      const found = await loadImage(viewUrl(ref))
      const tmp = actions.lumaToAlpha(found, m.width, m.height)
      snapshot()
      ctx.drawImage(tmp, 0, 0)
      redraw()
    } catch (e) {
      onError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.stopPropagation()
    const p = at(e)
    if (tool === 'smart') {
      void smart({ x: p[0] * (asset!.props as { w: number }).w / m.width, y: p[1] * (asset!.props as { h: number }).h / m.height })
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    if (tool === 'drag') { drag.current = [p]; return }
    snapshot()
    drag.current = [p]
    if (tool === 'brush' || tool === 'eraser') paint(p, p)
    redraw()
  }
  const pointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const b = e.currentTarget.getBoundingClientRect()
    setCursor([e.clientX - b.left + rect.l, e.clientY - b.top + rect.t])
    if (!drag.current.length) return
    const p = at(e)
    if (tool === 'drag') {
      const [x0, y0] = drag.current[drag.current.length - 1]
      setOffset(([dx, dy]) => [dx + p[0] - x0, dy + p[1] - y0])
      drag.current.push(p)
      return
    }
    if (tool === 'brush' || tool === 'eraser') paint(drag.current[drag.current.length - 1], p)
    drag.current.push(p)
    redraw()
  }
  const up = () => {
    const pts = drag.current
    drag.current = []
    if (pts.length > 1 && (tool === 'lasso' || tool === 'rect')) {
      ctx.fillStyle = '#fff'
      ctx.beginPath()
      if (tool === 'rect') {
        const [[x0, y0], [x1, y1]] = [pts[0], pts[pts.length - 1]]
        ctx.rect(x0, y0, x1 - x0, y1 - y0)
      } else pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      ctx.fill()
    }
    redraw()
  }
  const invert = () => {
    snapshot()
    const px = ctx.getImageData(0, 0, m.width, m.height)
    for (let i = 0; i < px.data.length; i += 4) {
      px.data[i] = px.data[i + 1] = px.data[i + 2] = 255
      px.data[i + 3] = 255 - px.data[i + 3]
    }
    ctx.putImageData(px, 0, 0)
    redraw()
  }
  const clear = () => { snapshot(); ctx.clearRect(0, 0, m.width, m.height); redraw() }
  const back = () => {
    const last = undo.current.pop()
    if (last) { ctx.putImageData(last, 0, 0); redraw() }
  }
  const run = () => {
    if (!hasSelection) return
    if (move) void actions.moveObject(editor, shape, m, offset[0], offset[1], onError)
    else void actions.inpaint(editor, shape, m, feather, style ? `${prompt.trim()}, ${style} style` : prompt.trim(), onError)
  }
  const tools = move ? [...TOOLS, ['drag', t('inpaintPanel.drag')] as [Tool, string]] : TOOLS

  const host = editor.getContainer().getBoundingClientRect()
  const left = rect.r + GAP + size.w > host.width - EDGE ? Math.max(EDGE, rect.l - size.w - GAP) : rect.r + GAP
  const top = Math.min(Math.max(rect.t, EDGE), host.height - size.h - EDGE)

  return (
    <>
      <canvas
        ref={view}
        className="ca-inpaint__mask"
        data-tool={tool}
        style={{ left: rect.l, top: rect.t, width: rect.r - rect.l, height: rect.b - rect.t }}
        onPointerDown={down}
        onPointerMove={pointerMove}
        onPointerUp={up}
        onPointerLeave={() => setCursor(null)}
        onWheel={(e) => e.stopPropagation()}
      />
      {cursor && (tool === 'brush' || tool === 'eraser') && <div className="ca-erase__cursor" style={{ left: cursor[0] - brush / 2, top: cursor[1] - brush / 2, width: brush, height: brush }} />}
      <div ref={panel} className="ca-panel" style={{ left, top }} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
        <div className="ca-panel__head"><span>{move ? t('common.moveObject') : t('common.inpaint')}</span>{busy && <span className="ca-trim__time">{t('inpaintPanel.autoSelecting')}</span>}</div>
        <Chips value={tool} options={tools} onPick={setTool} />
        {(tool === 'brush' || tool === 'eraser') && (
          <label className="ca-panel__row"><span>{t('inpaintPanel.brushSize')}</span><input type="range" min={4} max={200} value={brush} onChange={(e) => setBrush(Number(e.target.value))} /><span className="ca-panel__val">{brush}</span></label>
        )}
        {tool === 'smart' && (
          <>
            <div className="ca-chat__hint">{t('inpaintPanel.clickTheImageToAuto')}</div>
            <div className="ca-panel__chips">
              {SUBJECTS.map(([label, text]) => <button key={text} type="button" className="ca-panel__chip" disabled={busy} onClick={() => void smart({ text })}>{label}</button>)}
            </div>
          </>
        )}
        <div className="ca-panel__chips">
          <button type="button" className="ca-panel__chip" onClick={invert}>{t('inpaintPanel.invert')}</button>
          <button type="button" className="ca-panel__chip" onClick={clear}>{t('inpaintPanel.clearSelection')}</button>
          <button type="button" className="ca-panel__chip" onClick={back}>{t('common.undo')}</button>
        </div>
        {move && <div className="ca-chat__hint">{tool === 'drag' ? t('inpaintPanel.dragTheSelectionToThe') : t('inpaintPanel.firstCircleTheObjectTo')}</div>}
        {!move && <label className="ca-panel__row"><span>{t('inpaintPanel.feather')}</span><input type="range" min={0} max={40} value={feather} onChange={(e) => setFeather(Number(e.target.value))} /><span className="ca-panel__val">{feather}</span></label>}
        {!move && (
          <Chips value={style} options={INPAINT_STYLES.map(([label, value]) => [value, label] as const)} onPick={setStyle} />
        )}
        {!move && <textarea
          className="ca-panel__prompt ca-panel__prompt--boxed"
          value={prompt}
          placeholder={t('inpaintPanel.describeWhatToRedraw')}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />}
        <div className="ca-panel__foot">
          <button type="button" className="ca-panel__secondary" onClick={exitMode}>{t('common.cancel')}</button>
          <button type="button" className="ca-panel__primary" disabled={busy || !hasSelection || (move ? !offset[0] && !offset[1] : !prompt.trim())} onClick={run}>{t('common.generate')}</button>
        </div>
      </div>
    </>
  )
}
