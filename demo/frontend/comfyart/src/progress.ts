import { atom } from 'tldraw'

import { onComfyEvent } from './ws'

export interface Progress { value: number; max: number }

export const progressAtom = atom<Record<string, Progress>>('job progress', {})

const drop = (d: { prompt_id?: string }) => {
  if (!d?.prompt_id || !(d.prompt_id in progressAtom.get())) return
  const { [d.prompt_id]: _, ...rest } = progressAtom.get()
  progressAtom.set(rest)
}

onComfyEvent('progress', (d: { prompt_id?: string; value?: number; max?: number }) => {
  if (!d?.prompt_id) return
  progressAtom.update((all) => ({ ...all, [d.prompt_id!]: { value: Number(d.value) || 0, max: Number(d.max) || 0 } }))
})
onComfyEvent('execution_success', drop)
onComfyEvent('execution_error', drop)
onComfyEvent('execution_interrupted', drop)
