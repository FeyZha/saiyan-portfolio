import {
  DefaultColorStyle,
  DefaultDashStyle,
  DefaultSizeStyle,
  getColorValue,
  useEditor,
  useValue,
  type StyleProp,
} from 'tldraw'
import { t } from '../i18n'

const NATIVE = ['line', 'arrow', 'draw', 'geo']
const TOOLS = ['line', 'arrow']
const COLORS = ['black', 'grey', 'white', 'red', 'light-red', 'orange', 'yellow', 'green', 'light-green', 'blue', 'light-blue', 'violet', 'light-violet'] as const
const SIZES = [['s', 2], ['m', 4], ['l', 6], ['xl', 9]] as const
const DASHES = [['solid', t('nativeStyleBar.solid')], ['dashed', t('nativeStyleBar.dashed')], ['dotted', t('nativeStyleBar.dotted')], ['draw', t('nativeStyleBar.handDrawn')]] as const

export function NativeStyleBar() {
  const editor = useEditor()
  const state = useValue('native styles', () => {
    const shapes = editor.getSelectedShapes()
    const selected = shapes.length > 0 && shapes.every((s) => NATIVE.includes(s.type))
    if (!selected && !TOOLS.includes(editor.getCurrentToolId())) return null
    const styles = editor.getSharedStyles()
    const read = <T,>(p: StyleProp<T>) => {
      const v = styles.get(p)
      return v?.type === 'shared' ? v.value : editor.getStyleForNextShape(p)
    }
    const colors = editor.getCurrentTheme().colors[editor.getColorMode()]
    return {
      selected,
      color: read(DefaultColorStyle),
      size: read(DefaultSizeStyle),
      dash: read(DefaultDashStyle),
      swatches: COLORS.map((c) => [c, getColorValue(colors, c, 'solid')] as const),
    }
  }, [editor])
  if (!state) return null

  const set = <T,>(style: StyleProp<T>, value: T) => editor.run(() => {
    if (state.selected) editor.setStyleForSelectedShapes(style, value)
    editor.setStyleForNextShapes(style, value)
  })

  return (
    <div className="ca-bar ca-doodle" onPointerDown={(e) => e.stopPropagation()}>
      {state.swatches.map(([name, hex]) => (
        <button key={name} type="button" className="ca-doodle__swatch ca-native__swatch" data-on={state.color === name || undefined} title={name} onClick={() => set(DefaultColorStyle, name)}>
          <span style={{ background: hex }} />
        </button>
      ))}
      <div className="ca-bar__sep" />
      {SIZES.map(([name, dot]) => (
        <button key={name} type="button" className="ca-bar__btn ca-native__size" data-on={state.size === name || undefined} onClick={() => set(DefaultSizeStyle, name)}>
          <span style={{ height: dot }} />
        </button>
      ))}
      <div className="ca-bar__sep" />
      {DASHES.map(([name, label]) => (
        <button key={name} type="button" className="ca-bar__btn" data-on={state.dash === name || undefined} onClick={() => set(DefaultDashStyle, name)}>{label}</button>
      ))}
    </div>
  )
}
