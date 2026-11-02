import { useLayoutEffect, useRef, useState } from 'react'
import { atom, useEditor, useValue, type TLShape } from 'tldraw'

import { uploadImage } from '../comfy'
import { errorText, placeMedia, toMedia } from '../jobs'
import { download, downloadUrl } from '../psd'
import { AUDIO, HTML, LOTTIE, MODEL, snapshots, type HtmlShape, type ModelShape } from '../shapes/EmbedShapes'
import { ColorPicker } from './ColorPicker'
import { Icons } from './icons'
import { useSelectionRect } from './selection'
import { t } from '../i18n'

const GAP = 22
const EDGE = 8
const EMBEDS = [LOTTIE, MODEL, HTML, AUDIO]

export const htmlPreviewAtom = atom<string | null>('html preview', null)

export function HtmlPreview() {
  const html = useValue(htmlPreviewAtom)
  if (html === null) return null
  return (
    <div className="ca-modal ca-htmlpreview" onPointerDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) htmlPreviewAtom.set(null) }}>
      <iframe title={t('embedToolbar.preview')} sandbox="allow-scripts" srcDoc={html} />
      <button type="button" className="ca-panel__icon ca-htmlpreview__close" title={t('embedToolbar.closePreview')} onClick={() => htmlPreviewAtom.set(null)}>{Icons.close}</button>
    </div>
  )
}

export function EmbedToolbar({ onError }: { onError: (msg: string) => void }) {
  const editor = useEditor()
  const shape = useValue('embed', () => {
    const s = editor.getOnlySelectedShape()
    return s && EMBEDS.includes(s.type) ? s : null
  }, [editor]) as TLShape | null
  const editing = useValue('embed editing', () => !!shape && editor.getEditingShapeId() === shape.id, [editor, shape?.id])
  const rect = useSelectionRect()
  const bar = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    if (bar.current && bar.current.offsetWidth !== width) setWidth(bar.current.offsetWidth)
  })
  if (!shape || !rect) return null
  const host = editor.getContainer().getBoundingClientRect()
  const left = Math.min(Math.max((rect.l + rect.r) / 2 - width / 2, EDGE), host.width - width - EDGE)
  let top = rect.t - GAP - 44
  if (top < EDGE) top = rect.b + GAP
  const p = shape.props as { name: string; src?: string }
  const fail = (e: unknown) => onError(errorText(e))

  const exportView = async () => {
    const snap = snapshots.get(shape.id)
    if (!snap) return
    const ref = await uploadImage(await snap(), `${p.name}-view.png`)
    const b = editor.getShapePageBounds(shape)!
    editor.select(placeMedia(editor, await toMedia(ref, 'image'), t('embedToolbar.snapshot', p.name), b.maxX + 40, b.y, b.w))
  }

  return (
    <div ref={bar} className="ca-bar ca-toolbar" style={{ left, top }} onPointerDown={(e) => e.stopPropagation()}>
      <span className="ca-bar__label">{p.name}</span>
      <div className="ca-bar__sep" />
      {shape.type === MODEL && (
        <>
          <button type="button" className="ca-bar__btn" onClick={() => editor.updateShape<ModelShape>({ id: shape.id as ModelShape['id'], type: MODEL, props: { spin: !(shape as ModelShape).props.spin } })}>
            <span className="ca-icon">{Icons.rotate}</span><span>{(shape as ModelShape).props.spin ? t('embedToolbar.stopRotating') : t('embedToolbar.startRotating')}</span>
          </button>
          <ColorPicker value={(shape as ModelShape).props.bg} title={t('library.background')} allowNone onChange={(v) => editor.updateShape<ModelShape>({ id: shape.id as ModelShape['id'], type: MODEL, props: { bg: v } })} />
          <button type="button" className="ca-bar__btn" onClick={() => void exportView().catch(fail)}><span className="ca-icon">{Icons.image}</span><span>{t('embedToolbar.exportCurrentView')}</span></button>
        </>
      )}
      {shape.type === HTML && (
        <button type="button" className="ca-bar__btn" onClick={() => htmlPreviewAtom.set((shape as HtmlShape).props.html)}><span className="ca-icon">{Icons.preview}</span><span>{t('embedToolbar.preview')}</span></button>
      )}
      {shape.type !== LOTTIE && shape.type !== AUDIO && (
        <button type="button" className="ca-bar__btn" data-on={editing || undefined} onClick={() => (editing ? editor.setEditingShape(null) : editor.setEditingShape(shape.id))}>
          <span className="ca-icon">{Icons.hand}</span><span>{editing ? t('embedToolbar.exitInteraction') : t('embedToolbar.interact')}</span>
        </button>
      )}
      <div className="ca-bar__sep" />
      <button
        type="button"
        className="ca-bar__btn ca-bar__btn--icon"
        title={t('common.download')}
        onClick={() => (shape.type === HTML
          ? download(new Blob([(shape as HtmlShape).props.html], { type: 'text/html' }), p.name.endsWith('.html') ? p.name : `${p.name}.html`)
          : void downloadUrl(p.src!, p.name).catch(fail))}
      >
        <span className="ca-icon">{Icons.download}</span>
      </button>
    </div>
  )
}
