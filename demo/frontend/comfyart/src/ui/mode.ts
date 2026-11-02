import { atom } from 'tldraw'

import type { Pads, Stroke } from '../actions'

export type Mode = 'quick' | 'text' | 'erase' | 'angles' | 'expand' | 'animate' | 'layers' | 'separate' | 'adjust' | 'effects' | 'inpaint' | 'style' | 'move' | 'smudge'
export const OWN_PANEL: Mode[] = ['adjust', 'effects', 'inpaint', 'style', 'move', 'smudge']

export const modeAtom = atom<Mode | null>('mode', null)
export const strokesAtom = atom<Stroke[]>('strokes', [])
export const brushAtom = atom('brush', 40)
export const padsAtom = atom<Pads>('pads', { l: 0, t: 0, r: 0, b: 0 })
export const boxesAtom = atom<[number, number, number, number][]>('split boxes', [])

export function enterMode(mode: Mode) {
  strokesAtom.set([])
  padsAtom.set({ l: 0, t: 0, r: 0, b: 0 })
  boxesAtom.set([])
  modeAtom.set(mode)
}

export function exitMode() {
  modeAtom.set(null)
}
