import { useEffect } from 'react'
import { useEditor, useValue } from 'tldraw'

import { refKind } from '../comfy'
import { acceptsKind, canvasPickAtom, fillTarget } from '../genInputs'
import { errorText, fileSrc } from '../jobs'
import type { GeneratorShape } from '../shapes/GeneratorShape'
import { t } from '../i18n'

export function CanvasPick({ onError }: { onError: (msg: string) => void }) {
  const editor = useEditor()
  const pick = useValue(canvasPickAtom)
  const selected = useValue('pick selection', () => editor.getSelectedShapeIds(), [editor])

  useEffect(() => {
    if (!pick || selected.length === 1 && selected[0] === pick.id) return
    const target = editor.getShape<GeneratorShape>(pick.id)
    if (!target) {
      canvasPickAtom.set(null)
      return
    }
    const srcs = selected.flatMap((id) => {
      const src = fileSrc(editor, editor.getShape(id))
      return src && acceptsKind(target, pick.to, refKind(src)) ? [src] : []
    })
    if (selected.length && !srcs.length) return
    canvasPickAtom.set(null)
    if (srcs.length) fillTarget(editor, pick.id, pick.to, srcs).catch((e) => onError(errorText(e)))
    editor.select(pick.id)
  }, [pick, selected])

  if (!pick) return null
  return (
    <div className="ca-bar ca-toolbar ca-pickbar" onPointerDown={(e) => e.stopPropagation()}>
      <span>{t(pick.to === 'motion' ? 'genPanel.pickVideoOnCanvas' : pick.to === 'speech' ? 'genPanel.pickAudioOnCanvas' : 'genPanel.pickImageOnCanvas')}</span>
      <button type="button" className="ca-bar__btn" onClick={() => { canvasPickAtom.set(null); editor.select(pick.id) }}>{t('common.cancel')}</button>
    </div>
  )
}
