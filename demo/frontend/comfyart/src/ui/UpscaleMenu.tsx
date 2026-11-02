import { useState } from 'react'
import type { Editor, TLImageShape } from 'tldraw'

import * as actions from '../actions'
import { Chips } from './Chips'
import { t } from '../i18n'

const STYLES: [string, string][] = [
  [t('modePanel.general'), ''],
  [t('upscaleMenu.realisticPortrait'), 'realistic portrait photo, natural skin texture'],
  [t('common.anime'), 'anime style, clean line art'],
  [t('inpaintPanel.gameConceptArt'), 'game CG artwork'],
  [t('common.illustration'), 'artistic illustration'],
  [t('common.3d'), '3D render'],
]
const TARGETS: [string, number][] = [['2K', 2048], ['4K', 4096], ['8K', 8192]]

export function UpscaleMenu({ editor, shape, w, h, onDone, onError }: { editor: Editor; shape: TLImageShape; w: number; h: number; onDone: () => void; onError: (msg: string) => void }) {
  const [detail, setDetail] = useState(false)
  const [style, setStyle] = useState('')
  const [strength, setStrength] = useState(30)
  const long = Math.max(w, h)
  const go = (k: number) => {
    onDone()
    if (detail) actions.creativeUpscale(editor, shape, k, style, strength / 100, onError)
    else actions.upscale(editor, shape, k, onError)
  }
  return (
    <div className="ca-menu ca-upscale">
      <div className="ca-panel__chips">
        <button type="button" className="ca-panel__chip" data-on={!detail || undefined} onClick={() => setDetail(false)}>{t('upscaleMenu.faithfulToOriginal')}</button>
        <button type="button" className="ca-panel__chip" data-on={detail || undefined} onClick={() => setDetail(true)}>{t('upscaleMenu.enhanceDetails')}</button>
      </div>
      {detail && (
        <>
          <Chips value={style} options={STYLES.map(([label, value]) => [value, label] as const)} onPick={setStyle} />
          <label className="ca-panel__row"><span>{t('upscaleMenu.detailStrength')}</span><input type="range" min={10} max={70} value={strength} onChange={(e) => setStrength(Number(e.target.value))} /><span className="ca-panel__val">{strength}</span></label>
        </>
      )}
      {TARGETS.map(([label, target]) => {
        const k = target / long
        return (
          <button key={label} type="button" className="ca-menu__item" disabled={target <= long} onClick={() => go(k)}>
            <span className="ca-menu__grow">{label}</span><span className="ca-menu__key">{Math.round(w * k)}×{Math.round(h * k)}</span>
          </button>
        )
      })}
    </div>
  )
}
