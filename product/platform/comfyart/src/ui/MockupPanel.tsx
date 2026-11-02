import { useRef } from 'react'
import { useEditor, useValue, type TLImageShape } from 'tldraw'

import { thumbUrl } from '../comfy'
import { errorText } from '../jobs'
import { aiBlend, bakeToImage } from '../mockup'
import { MOCKUP, type MockupShape } from '../shapes/MockupShape'
import { useElementSize, useOnlySelected, useSelectionRect } from './selection'
import { t } from '../i18n'

const GAP = 12
const EDGE = 8

function Slider({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="ca-panel__row">
      <span>{label}</span>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="ca-panel__val">{value}</span>
    </label>
  )
}

export function MockupPanel({ onError }: { onError: (msg: string) => void }) {
  const editor = useEditor()
  const shape = useOnlySelected<MockupShape>(MOCKUP)
  const rect = useSelectionRect()
  const panel = useRef<HTMLDivElement>(null)
  const size = useElementSize(panel, { w: 300, h: 420 })
  const designs = useValue('mockup designs', () => editor.getCurrentPageShapes().flatMap((s) => {
    const a = s.type === 'image' && (s as TLImageShape).props.assetId ? editor.getAsset((s as TLImageShape).props.assetId!) : null
    return a?.type === 'image' && a.props.src ? [a.props.src] : []
  }).filter((src, i, all) => all.indexOf(src) === i).reverse(), [editor])
  if (!shape || !rect) return null
  const p = shape.props
  const set = (patch: Partial<MockupShape['props']>) => editor.updateShape<MockupShape>({ id: shape.id, type: MOCKUP, props: patch })
  const host = editor.getContainer().getBoundingClientRect()
  const left = rect.r + GAP + size.w > host.width - EDGE ? Math.max(EDGE, rect.l - size.w - GAP) : rect.r + GAP
  const top = Math.min(Math.max(rect.t, EDGE), host.height - size.h - EDGE)

  return (
    <div ref={panel} className="ca-panel ca-mockpanel" style={{ left, top }} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <div className="ca-panel__head"><span>{t('mockup.title')}</span></div>
      <div className="ca-gen__label">{t('mockup.design')}</div>
      <div className="ca-mockpanel__grid">
        {designs.filter((src) => src !== p.photo).map((src) => (
          <button key={src} type="button" className="ca-mockpanel__cell" data-on={p.design === src || undefined} onClick={() => set({ design: src })}>
            <img src={thumbUrl(src)} alt="" />
          </button>
        ))}
      </div>
      {p.design && (
        <>
          <Slider label={t('mockup.x')} value={Math.round(p.x * 100)} min={0} max={100} onChange={(v) => set({ x: v / 100 })} />
          <Slider label={t('mockup.y')} value={Math.round(p.y * 100)} min={0} max={100} onChange={(v) => set({ y: v / 100 })} />
          <Slider label={t('mockup.size')} value={Math.round(p.scale * 100)} min={5} max={150} onChange={(v) => set({ scale: v / 100 })} />
          <Slider label={t('imageToolbar.angle')} value={Math.round((p.rotation * 180) / Math.PI)} min={-180} max={180} onChange={(v) => set({ rotation: (v * Math.PI) / 180 })} />
          <Slider label={t('mockup.warp')} value={Math.round(p.warp * 100)} min={0} max={100} onChange={(v) => set({ warp: v / 100 })} />
          <div className="ca-panel__foot">
            <button type="button" className="ca-panel__secondary" onClick={() => void bakeToImage(editor, shape).catch((e) => onError(errorText(e)))}>{t('mockup.bake')}</button>
            <button type="button" className="ca-panel__primary" onClick={() => aiBlend(editor, shape, onError)}>{t('mockup.aiBlend')}</button>
          </div>
        </>
      )}
    </div>
  )
}
