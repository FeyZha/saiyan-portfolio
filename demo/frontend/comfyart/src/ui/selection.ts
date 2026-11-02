import { useLayoutEffect, useState, type RefObject } from 'react'
import { useEditor, useValue, type Box, type TLImageShape, type TLShape } from 'tldraw'

import { GENERATOR, type GeneratorShape } from '../shapes/GeneratorShape'

export interface ScreenRect { l: number; t: number; r: number; b: number }

export function toolbarPosition(rect: ScreenRect, width: number, host: { width: number; height: number }) {
  const left = Math.max(8, Math.min((rect.l + rect.r - width) / 2, host.width - width - 8))
  const preferred = rect.t - 66 < 8 ? rect.b + 22 : rect.t - 66
  return { left, top: Math.max(8, Math.min(preferred, host.height - 152)) }
}

export function useSelectionRect(): ScreenRect | null {
  const editor = useEditor()
  return useValue('selection rect', () => {
    if (editor.getCroppingShapeId() || editor.isIn('select.resizing') || editor.isIn('select.translating')) return null
    const bounds: Box | undefined = editor.getSelectionPageBounds() ?? undefined
    if (!bounds) return null
    const a = editor.pageToViewport({ x: bounds.minX, y: bounds.minY })
    const b = editor.pageToViewport({ x: bounds.maxX, y: bounds.maxY })
    return { l: a.x, t: a.y, r: b.x, b: b.y }
  }, [editor])
}

export function useOnlySelected<T extends TLShape>(type: T['type']): T | null {
  const editor = useEditor()
  return useValue('only selected', () => {
    const shape = editor.getOnlySelectedShape()
    return shape?.type === type ? (shape as T) : null
  }, [editor, type])
}

export const useSelectedImage = () => useOnlySelected<TLImageShape>('image')
export const useSelectedGenerator = () => useOnlySelected<GeneratorShape>(GENERATOR)

export function useElementSize(ref: RefObject<HTMLElement | null>, initial: { w: number; h: number }) {
  const [size, setSize] = useState(initial)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const [w, h] = [el.offsetWidth, el.offsetHeight]
    setSize((s) => (s.w === w && s.h === h ? s : { w, h }))
  })
  return size
}
