import { useEditor, useValue } from 'tldraw'

import { effectsOf } from './AdjustPanel'

export function Effects() {
  const editor = useEditor()
  const css = useValue('effects css', () => editor.getCurrentPageShapes().flatMap((s) => {
    if (!s.meta.effects) return []
    const { shadow, blur } = effectsOf(s)
    const filters = [shadow && `drop-shadow(${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.color})`, blur && `blur(${blur}px)`].filter(Boolean)
    return filters.length ? [`.tl-shape[data-shape-id="${s.id}"]{filter:${filters.join(' ')}}`] : []
  }).join('\n'), [editor])
  return css ? <style>{css}</style> : null
}
