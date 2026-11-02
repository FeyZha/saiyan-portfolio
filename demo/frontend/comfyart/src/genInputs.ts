import { atom, type Editor, type TLShapeId } from 'tldraw'

import { mediaMeta, refKind, type RefKind } from './comfy'
import { capRefs, nearestRatio, refsOf, targetSize, videoModeOf } from './generate'
import { DURATIONS, VIDEO_RATIOS } from './genOptions'
import { agentModels, isVideo, modelOf } from './models'
import { refLimit } from './refModes'
import { MAX_VIDEO_REF_KINDS } from './videoGraphs'
import { GENERATOR, type GeneratorShape } from './shapes/GeneratorShape'

export type Target = 'ref' | 'base' | 'last' | 'motion' | 'speech'

export const canvasPickAtom = atom<{ id: TLShapeId; to: Target } | null>('canvas pick', null)

export const isMediaRefs = (shape: GeneratorShape) => isVideo(shape.props.workflow) && !Array.isArray(shape.meta.scenes) && videoModeOf(shape) === 'refs'

export function maxRefsOf(shape: GeneratorShape) {
  if (isMediaRefs(shape)) return Object.values(MAX_VIDEO_REF_KINDS).reduce((a, b) => a + b)
  return isVideo(shape.props.workflow) ? 1 : refLimit(modelOf(shape.props.workflow) ?? agentModels(false)[0])
}

export function acceptsKind(shape: GeneratorShape, to: Target, kind: RefKind) {
  if (to === 'motion') return kind === 'video'
  if (to === 'speech') return kind === 'audio'
  return kind === 'image' || (to === 'ref' && isMediaRefs(shape))
}

export async function fillTarget(editor: Editor, id: TLShapeId, to: Target, srcs: string[]) {
  const shape = editor.getShape<GeneratorShape>(id)
  if (!shape) return
  const setMeta = (patch: Record<string, unknown>) => editor.updateShape<GeneratorShape>({ id, type: GENERATOR, meta: { ...editor.getShape<GeneratorShape>(id)!.meta, ...patch } as GeneratorShape['meta'] })
  const src = srcs[0]
  if (to === 'ref') {
    const refs = refsOf(shape)
    const added = srcs.filter((x) => !refs.includes(x) && acceptsKind(shape, to, refKind(x)))
    return setMeta({ refs: isMediaRefs(shape) ? capRefs([...refs, ...added]) : [...refs, ...added].slice(-maxRefsOf(shape)) })
  }
  if (!src) return
  if (to === 'motion') {
    const { seconds, w: vw, h: vh } = await mediaMeta(src, 'video')
    const props = { ...shape.props, ratio: nearestRatio(vw / vh, VIDEO_RATIOS), duration: DURATIONS.filter((d) => d <= seconds).pop() ?? DURATIONS[0] }
    const [w, h] = targetSize(props)
    editor.updateShape<GeneratorShape>({ id, type: GENERATOR, props: { ...props, w, h } })
    return setMeta({ motion: src })
  }
  setMeta(to === 'base' ? { base: src } : to === 'speech' ? { speech: src } : { lastFrame: src })
}
