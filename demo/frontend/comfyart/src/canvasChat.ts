import { atom, type Editor, type TLShapeId, type VecLike } from 'tldraw'

import { isRefShape, refKindOf, type RefShape } from './agent'
import { t } from './i18n'

export const canvasChatAtom = atom<{ anchor: VecLike; refs: TLShapeId[] } | null>('canvas chat', null)

export function openCanvasChat(editor: Editor) {
  const bounds = editor.getSelectionPageBounds()
  if (!bounds) return
  const refs = editor.getSelectedShapes().filter(isRefShape).map((s) => s.id)
  canvasChatAtom.set({ anchor: { x: bounds.center.x, y: bounds.maxY }, refs })
}

const [PRE, POST] = t('canvasChat.tag', '\u0000').split('\u0000')
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const TAG = new RegExp(`${escape(PRE)}(\\d+)${escape(POST)}`, 'g')

export const tagOf = (n: number) => t('canvasChat.tag', n)

export function renumber(text: string, map: (n: number) => number | null): string {
  return text.replace(TAG, (_, n: string) => {
    const next = map(Number(n))
    return next ? tagOf(next) : ''
  })
}

export function promptFor(text: string, refs: RefShape[], runRefs: RefShape[]): string {
  return text.replace(TAG, (_, n: string) => {
    const ref = refs[Number(n) - 1]
    const i = runRefs.indexOf(ref)
    return i < 0 ? ' ' : ` ${refKindOf(ref)} ${i + 1} `
  }).replace(/[ \t]{2,}/g, ' ').replace(/ ([,.:;!?，。：；！？])/g, '$1').trim()
}
