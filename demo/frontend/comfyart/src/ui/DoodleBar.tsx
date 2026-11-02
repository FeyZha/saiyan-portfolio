import { useEditor, useValue } from 'tldraw'

import { DOODLE, doodleColorAtom, doodleSizeAtom, type DoodleShape } from '../shapes/DoodleShape'
import { ColorPicker } from './ColorPicker'
import { t } from '../i18n'

export function DoodleBar() {
  const editor = useEditor()
  const color = useValue(doodleColorAtom)
  const size = useValue(doodleSizeAtom)
  const selected = useValue('doodles', () => {
    const s = editor.getSelectedShapes()
    return s.length > 0 && s.every((x) => x.type === DOODLE) ? (s as DoodleShape[]) : null
  }, [editor])
  const tool = useValue('tool', () => editor.getCurrentToolId(), [editor])
  if (tool !== DOODLE && !selected) return null

  const apply = (patch: Partial<DoodleShape['props']>) => {
    if (patch.color) doodleColorAtom.set(patch.color)
    if (patch.size) doodleSizeAtom.set(patch.size)
    if (selected) editor.updateShapes(selected.map((s) => ({ id: s.id, type: DOODLE, props: patch })))
  }
  const shown = selected ? selected[0].props : { color, size }

  return (
    <div className="ca-bar ca-doodle" onPointerDown={(e) => e.stopPropagation()}>
      <ColorPicker
        value={shown.color}
        title={t('common.color')}
        onChange={(c) => c && apply({ color: c })}
        trigger={({ toggle }) => (
          <button type="button" className="ca-doodle__swatch" title={t('common.color')} onClick={toggle}>
            <span style={{ background: shown.color }} />
          </button>
        )}
      />
      <div className="ca-bar__sep" />
      <label className="ca-doodle__width" title={t('doodleBar.size')}>
        <span className="ca-doodle__lines" />
        <input
          type="number"
          min={1}
          max={200}
          value={shown.size}
          onChange={(e) => { const v = Number(e.target.value); if (v >= 1) apply({ size: Math.min(200, v) }) }}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <span className="ca-doodle__unit">Px</span>
      </label>
    </div>
  )
}
