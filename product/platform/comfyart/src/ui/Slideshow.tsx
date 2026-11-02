import { useEffect, useRef, useState } from 'react'
import { atom, useValue, type Editor, type TLShapeId } from 'tldraw'

import { exportImage } from '../shapes/ArtboardShape'
import { Icons } from './icons'
import { t } from '../i18n'

export const slideshowAtom = atom<{ ids: TLShapeId[]; index: number } | null>('slideshow', null)

const SCALE = 2

export function Slideshow({ editor }: { editor: Editor }) {
  const show = useValue(slideshowAtom)
  const root = useRef<HTMLDivElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  const id = show?.ids[show.index]

  useEffect(() => {
    if (!id) return
    let alive = true
    let made: string | null = null
    void exportImage(editor, [id], { format: 'png', scale: SCALE, background: true }).then(({ blob }) => {
      if (!alive) return
      made = URL.createObjectURL(blob)
      setUrl(made)
    })
    return () => {
      alive = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [editor, id])

  useEffect(() => {
    if (!show) return
    void root.current?.requestFullscreen?.().catch(() => undefined)
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation()
      const s = slideshowAtom.get()
      if (!s) return
      if (e.key === 'Escape') close()
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') slideshowAtom.set({ ...s, index: Math.min(s.ids.length - 1, s.index + 1) })
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') slideshowAtom.set({ ...s, index: Math.max(0, s.index - 1) })
    }
    const onExit = () => { if (!document.fullscreenElement) slideshowAtom.set(null) }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('fullscreenchange', onExit)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('fullscreenchange', onExit)
    }
  }, [!!show])

  if (!show) return null
  function close() {
    slideshowAtom.set(null)
    setUrl(null)
    if (document.fullscreenElement) void document.exitFullscreen()
  }
  const go = (d: number) => slideshowAtom.set({ ...show, index: Math.max(0, Math.min(show.ids.length - 1, show.index + d)) })

  return (
    <div ref={root} className="ca-slideshow" onPointerDown={(e) => e.stopPropagation()} onClick={() => go(1)}>
      {url && <img src={url} alt="" />}
      <div className="ca-slideshow__bar" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="ca-bar__btn ca-bar__btn--icon" title={t('slideshow.previous')} disabled={!show.index} onClick={() => go(-1)}><span className="ca-icon ca-slideshow__prev">{Icons.next}</span></button>
        <span>{show.index + 1} / {show.ids.length}</span>
        <button type="button" className="ca-bar__btn ca-bar__btn--icon" title={t('slideshow.next')} disabled={show.index >= show.ids.length - 1} onClick={() => go(1)}><span className="ca-icon">{Icons.next}</span></button>
        <button type="button" className="ca-bar__btn ca-bar__btn--icon" title={t('slideshow.exit')} onClick={close}><span className="ca-icon">{Icons.close}</span></button>
      </div>
    </div>
  )
}
