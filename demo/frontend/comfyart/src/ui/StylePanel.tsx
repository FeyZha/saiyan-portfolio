import { useEffect, useRef, useState } from 'react'
import { useEditor, useValue } from 'tldraw'

import * as actions from '../actions'
import { uploadImage, viewUrl } from '../comfy'
import { AssetGrid } from './AssetPicker'
import { Icons } from './icons'
import { exitMode, modeAtom } from './mode'
import { Popover } from './Popover'
import { useElementSize, useSelectedImage, useSelectionRect } from './selection'
import { Chips } from './Chips'
import { t } from '../i18n'
import { useEscape } from './escape'

const GAP = 12
const EDGE = 8
const STYLES: [string, string][] = [
  [t('stylePanel.watercolor'), 'watercolor painting'], [t('stylePanel.oilPainting'), 'oil painting'], [t('common.anime'), 'anime cel-shaded'], [t('common.3d'), 'glossy 3D render'],
  [t('stylePanel.pixel'), 'pixel art'], [t('stylePanel.sketch'), 'pencil sketch'], [t('stylePanel.flatIllustration'), 'flat vector illustration'], [t('stylePanel.cyberpunk'), 'cyberpunk neon'],
  [t('stylePanel.inkWash'), 'Chinese ink wash painting'], [t('stylePanel.clay'), 'claymation'],
]

export function StylePanel({ onError }: { onError: (msg: string) => void }) {
  const editor = useEditor()
  const mode = useValue(modeAtom)
  const shape = useSelectedImage()
  const rect = useSelectionRect()
  const panel = useRef<HTMLDivElement>(null)
  const file = useRef<HTMLInputElement>(null)
  const size = useElementSize(panel, { w: 300, h: 260 })
  const [style, setStyle] = useState(STYLES[0][1])
  const [ref, setRef] = useState<string | null>(null)
  const [pick, setPick] = useState<'menu' | 'assets' | null>(null)
  const active = mode === 'style'

  useEffect(() => { setRef(null) }, [active])
  useEffect(() => { if (active && !shape) exitMode() }, [active, shape])
  useEscape(active, exitMode)

  if (!active || !shape || !rect) return null
  const host = editor.getContainer().getBoundingClientRect()
  const left = rect.r + GAP + size.w > host.width - EDGE ? Math.max(EDGE, rect.l - size.w - GAP) : rect.r + GAP
  const top = Math.min(Math.max(rect.t, EDGE), host.height - size.h - EDGE)
  const upload = async (f: File | undefined) => { if (f) setRef(viewUrl(await uploadImage(f, f.name))) }

  return (
    <div ref={panel} className="ca-panel" style={{ left, top }} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <div className="ca-panel__head"><span>{t('common.styleTransfer')}</span></div>
      <div className="ca-gen__label">{t('stylePanel.styleReference')}</div>
      <div className="ca-gen__refs">
        {ref ? (
          <span className="ca-gen__ref"><img src={ref} alt="" /><button type="button" title={t('common.remove')} onClick={() => setRef(null)}>{Icons.close}</button></span>
        ) : (
          <Popover
            open={!!pick}
            onOpenChange={(o) => setPick(o ? 'menu' : null)}
            contentKey={pick ?? ''}
            trigger={({ toggle }) => <button type="button" className="ca-gen__refadd" onClick={toggle}><span className="ca-icon">{Icons.image}</span><span>{t('genPanel.referenceImage')}</span></button>}
          >
            {pick === 'assets' ? (
              <div className="ca-menu ca-assets-pop"><AssetGrid only="image" onPick={(i) => { setPick(null); setRef(i.src) }} /></div>
            ) : (
              <div className="ca-menu">
                <button type="button" className="ca-menu__item" onClick={() => { setPick(null); file.current?.click() }}><span className="ca-icon">{Icons.upload}</span><span className="ca-menu__grow">{t('genPanel.uploadImage')}</span></button>
                <button type="button" className="ca-menu__item" onClick={() => setPick('assets')}><span className="ca-icon">{Icons.files}</span><span className="ca-menu__grow">{t('genPanel.chooseFromAssets')}</span><span className="ca-icon">{Icons.next}</span></button>
              </div>
            )}
          </Popover>
        )}
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { void upload(e.target.files?.[0]).catch((err) => onError(String(err))); e.target.value = '' }} />
      </div>
      {!ref && (
        <>
          <div className="ca-gen__label">{t('stylePanel.orChooseAStyle')}</div>
          <Chips value={style} options={STYLES.map(([label, value]) => [value, label] as const)} onPick={setStyle} />
        </>
      )}
      <div className="ca-panel__foot">
        <button type="button" className="ca-panel__secondary" onClick={exitMode}>{t('common.cancel')}</button>
        <button type="button" className="ca-panel__primary" onClick={() => { void actions.styleTransfer(editor, shape, style, ref, onError) }}>{t('common.generate')}</button>
      </div>
    </div>
  )
}
