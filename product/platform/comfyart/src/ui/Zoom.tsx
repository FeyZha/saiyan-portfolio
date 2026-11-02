import { useState } from 'react'
import { useEditor, useValue } from 'tldraw'

import { Popover } from './Popover'
import { shortcutsAtom } from './Shortcuts'
import { t } from '../i18n'

export function Zoom() {
  const editor = useEditor()
  const zoom = useValue('zoom', () => Math.round(editor.getZoomLevel() * 100), [editor])
  const [open, setOpen] = useState(false)
  const act = (fn: () => void) => () => { setOpen(false); fn() }
  const zoomTo = (z: number) => {
    const c = editor.getViewportPageBounds().center
    const s = editor.getViewportScreenBounds()
    editor.setCamera({ x: s.w / 2 / z - c.x, y: s.h / 2 / z - c.y, z }, { animation: { duration: 200 } })
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="top"
      align="end"
      trigger={({ open: o, toggle }) => (
        <button type="button" className="ca-bar__btn ca-zoom__btn" data-open={o || undefined} onClick={toggle}>{zoom}%</button>
      )}
    >
      <div className="ca-menu">
        <button type="button" className="ca-menu__item" onClick={act(() => editor.zoomIn())}><span className="ca-menu__grow">{t('common.zoomIn')}</span><span className="ca-menu__key">Ctrl +</span></button>
        <button type="button" className="ca-menu__item" onClick={act(() => editor.zoomOut())}><span className="ca-menu__grow">{t('common.zoomOut')}</span><span className="ca-menu__key">Ctrl -</span></button>
        <button type="button" className="ca-menu__item" onClick={act(() => editor.zoomToFit())}><span className="ca-menu__grow">{t('zoom.fitAll')}</span><span className="ca-menu__key">Shift 1</span></button>
        <button type="button" className="ca-menu__item" onClick={act(() => zoomTo(0.5))}><span className="ca-menu__grow">{t('zoom.zoomTo', 50)}</span></button>
        <button type="button" className="ca-menu__item" onClick={act(() => editor.resetZoom())}><span className="ca-menu__grow">{t('shortcuts.zoomTo100')}</span><span className="ca-menu__key">Ctrl 0</span></button>
        <button type="button" className="ca-menu__item" onClick={act(() => zoomTo(2))}><span className="ca-menu__grow">{t('zoom.zoomTo', 200)}</span></button>
        <div className="ca-menu__sep" />
        <button type="button" className="ca-menu__item" onClick={act(() => shortcutsAtom.set(true))}><span className="ca-menu__grow">{t('shortcuts.keyboardShortcuts')}</span><span className="ca-menu__key">?</span></button>
      </div>
    </Popover>
  )
}
