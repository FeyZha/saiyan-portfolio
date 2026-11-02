import { atom } from 'tldraw'

import { readLocal, writeLocal } from '../localPrefs'

const KEY = 'comfyart.dock'

export const dockAtom = atom<'left' | 'right'>('chat dock', readLocal(KEY) === 'right' ? 'right' : 'left')

export function setDock(side: 'left' | 'right') {
  dockAtom.set(side)
  writeLocal(KEY, side)
}
