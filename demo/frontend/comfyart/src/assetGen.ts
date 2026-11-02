import { createShapeId, type Editor, type TLImageShape, type TLShapeId } from 'tldraw'

import { cloudMode, loadNamed } from './comfy'
import { freeSpot, GAP, registerPlacer, rowSpots, selectResults, spawnHolder, startJob, type ErrorSink } from './jobs'
import { AUDIO, AUDIO_SIZE, MODEL } from './shapes/EmbedShapes'
import { GENERATOR } from './shapes/GeneratorShape'
import { annotated, randomSeed, type Built } from './workflows'
import { t } from './i18n'

const KOKORO_VOICES = ['zf_xiaoxiao', 'zf_xiaoyi', 'zf_xiaobei', 'zf_xiaoni', 'zm_yunxi', 'zm_yunjian', 'zm_yunyang', 'zm_yunxia', 'af_heart', 'af_bella', 'af_nicole', 'am_adam', 'am_michael', 'bf_emma', 'bm_george', 'jf_alpha', 'jm_kumo']
const QWEN_VOICES = ['Serena', 'Vivian', 'Uncle_fu', 'Dylan', 'Eric', 'Ryan', 'Aiden', 'Ono_anna', 'Sohee']
export const voices = () => (cloudMode() ? QWEN_VOICES : KOKORO_VOICES)
const LANGS: Record<string, string> = { a: 'English', b: 'English (British)', j: 'Japanese', z: 'Mandarin Chinese', e: 'Spanish', f: 'French', h: 'Hindi', i: 'Italian', p: 'Brazilian Portuguese' }
export const MUSIC_SECONDS = [15, 30, 60, 120]
export const MUSIC_MODELS = [
  { id: 'music-minimax3.api.json', label: 'MiniMax Music 3', desc: 'Complete songs with stable structure and strong vocals. Put genre, tempo, key, language and vocal style in the prompt.' },
  { id: 'music-ace-step15.api.json', label: 'ACE-Step 1.5', desc: 'Fast. Takes tempo (bpm), lyrics language and key as settings.' },
]
export const SFX_SECONDS = [3, 5, 8, 15]
const MODEL_SIZE = 480

export type AudioSpec =
  | { kind: 'music'; model: string; prompt: string; lyrics: string; seconds: number; bpm?: number; language?: string; key?: string }
  | { kind: 'speech'; text: string; voice: string }
  | { kind: 'clone'; text: string; reference: string }
  | { kind: 'sfx'; prompt: string; seconds: number }

async function audioGraph(spec: AudioSpec): Promise<Built> {
  if (spec.kind === 'music') {
    const { graph: g, id } = await loadNamed(spec.model, 'prompt', 'seconds', 'sampler', 'save')
    const seed = randomSeed()
    const lyrics = spec.lyrics || '[instrumental]'
    if (g[id.prompt].class_type === 'MiniMaxMusic3TextEncode') {
      Object.assign(g[id.prompt].inputs, { caption: spec.prompt, lyrics, seed, max_duration: spec.seconds })
    } else {
      Object.assign(g[id.prompt].inputs, { tags: spec.prompt, lyrics, seed, duration: spec.seconds, ...(spec.bpm ? { bpm: spec.bpm } : {}), ...(spec.language ? { language: spec.language } : {}), ...(spec.key ? { keyscale: spec.key } : {}) })
      g[id.seconds].inputs.seconds = spec.seconds
    }
    g[id.sampler].inputs.seed = seed
    return { graph: g, result: id.save }
  }
  if (spec.kind === 'sfx') {
    const { graph: g, id } = await loadNamed('sfx-stable-audio.api.json', 'prompt', 'seconds', 'sampler', 'save')
    g[id.prompt].inputs.text = spec.prompt
    g[id.seconds].inputs.seconds = spec.seconds
    g[id.sampler].inputs.seed = randomSeed()
    return { graph: g, result: id.save }
  }
  if (spec.kind === 'speech' && cloudMode()) {
    const { graph: g, id } = await loadNamed('speech-qwen3tts.api.json', 'prompt', 'save')
    Object.assign(g[id.prompt].inputs, { text: spec.text, speaker: spec.voice, seed: randomSeed() })
    return { graph: g, result: id.save }
  }
  if (spec.kind === 'speech') {
    const { graph: g, id } = await loadNamed('speech-kokoro.api.json', 'voice', 'prompt', 'save')
    g[id.voice].inputs.speaker_name = spec.voice
    Object.assign(g[id.prompt].inputs, { text: spec.text, lang: LANGS[spec.voice[0]] ?? 'English' })
    return { graph: g, result: id.save }
  }
  if (cloudMode()) {
    const { graph: g, id } = await loadNamed('voice-clone-qwen3tts.api.json', 'voice', 'prompt', 'save')
    g[id.voice].inputs.audio = annotated(spec.reference)
    Object.assign(g[id.prompt].inputs, { target_text: spec.text, seed: randomSeed() })
    return { graph: g, result: id.save }
  }
  const { graph: g, id } = await loadNamed('voice-clone-indextts.api.json', 'voice', 'prompt', 'save')
  g[id.voice].inputs.audio = annotated(spec.reference)
  Object.assign(g[id.prompt].inputs, { text: spec.text, seed: randomSeed() })
  return { graph: g, result: id.save }
}

const LABELS: Record<AudioSpec['kind'], string> = { music: t('audio.music'), speech: t('audio.voiceover'), clone: t('audio.voiceover'), sfx: t('audio.soundEffect') }

export function generateAudio(editor: Editor, spec: AudioSpec, onError: ErrorSink, quiet = false): TLShapeId {
  const [w, h] = AUDIO_SIZE
  const [x, y] = freeSpot(editor, w, h)
  const id = createShapeId()
  editor.createShape({ id, type: GENERATOR, x, y, props: { w, h }, meta: { temp: true, quiet } })
  if (!quiet) editor.zoomToBounds({ x, y, w, h }, { inset: 200, animation: { duration: 200 } })
  const text = spec.kind === 'speech' || spec.kind === 'clone' ? spec.text : spec.prompt
  void startJob(editor, id, audioGraph(spec), { name: `${LABELS[spec.kind]} · ${text.slice(0, 24)}`, kind: 'audio', placer: 'audio' }, onError)
  return id
}

export type Model3d = 'trellis2' | 'pixal3d'

async function modelGraph(image: string, model: Model3d): Promise<Built> {
  const { graph: g, id } = await (model === 'pixal3d'
    ? loadNamed('image-to-3d-pixal3d.api.json', 'image', 'save')
    : loadNamed('image-to-3d-trellis2.api.json', 'image', 'save'))
  g[id.image].inputs.image = image
  return { graph: g, result: id.save }
}

const VIEWS = ['front', 'left', 'back', 'right'] as const
export const MAX_VIEWS = VIEWS.length

async function multiViewGraph(images: string[]): Promise<Built> {
  const { graph: g, id } = await loadNamed('image-to-3d-pixal3d-multiview.api.json', ...VIEWS, 'views', 'save')
  VIEWS.forEach((view, i) => {
    if (images[i]) {
      g[id[view]].inputs.image = images[i]
      return
    }
    const gone = new Set([id[view]])
    for (let grew = true; grew;) {
      grew = false
      for (const [k, node] of Object.entries(g)) {
        if (k !== id.views && !gone.has(k) && Object.values(node.inputs).some((v) => Array.isArray(v) && gone.has(v[0]))) {
          gone.add(k)
          grew = true
        }
      }
    }
    gone.forEach((k) => delete g[k])
    delete g[id.views].inputs[view]
  })
  return { graph: g, result: id.save }
}

export function viewsTo3d(editor: Editor, shapes: TLImageShape[], onError: ErrorSink) {
  const srcs = shapes.flatMap((s) => {
    const asset = s.props.assetId ? editor.getAsset(s.props.assetId) : null
    return asset?.type === 'image' && asset.props.src ? [annotated(asset.props.src)] : []
  }).slice(0, MAX_VIEWS)
  if (!srcs.length) return
  const holder = spawnHolder(editor, shapes[shapes.length - 1], [MODEL_SIZE, MODEL_SIZE])
  void startJob(editor, holder, multiViewGraph(srcs), { name: `${t('imageToolbar.multiViewTo3d')} · ${srcs.length}`, kind: 'model', placer: 'model' }, onError)
  return holder
}

export function imageTo3d(editor: Editor, shape: TLImageShape, onError: ErrorSink, model: Model3d = 'trellis2') {
  const asset = shape.props.assetId ? editor.getAsset(shape.props.assetId) : null
  if (asset?.type !== 'image' || !asset.props.src) return
  const holder = spawnHolder(editor, shape, [MODEL_SIZE, MODEL_SIZE])
  void startJob(editor, holder, modelGraph(annotated(asset.props.src), model), { name: `${asset.props.name || t('common.image')} · 3D`, kind: 'model', placer: 'model' }, onError)
  return holder
}

registerPlacer('audio', async (editor, holder, media, job) => {
  const ids: TLShapeId[] = []
  editor.run(() => {
    editor.deleteShape(holder.id)
    media.forEach((m, i) => {
      const id = createShapeId()
      editor.createShape({ id, type: AUDIO, x: holder.x, y: holder.y + i * (AUDIO_SIZE[1] + GAP), parentId: holder.parentId, props: { src: m.src, name: job.name } })
      ids.push(id)
    })
  }, { history: 'ignore' })
  selectResults(editor, holder, ids)
})

registerPlacer('model', async (editor, holder, media, job) => {
  const { w, h } = holder.props as { w: number; h: number }
  const b = editor.getShapePageBounds(holder)!
  const ids: TLShapeId[] = []
  editor.run(() => {
    editor.deleteShape(holder.id)
    rowSpots(editor, holder, media.map(() => [w, h]), [b.minX, b.minY]).forEach((p, i) => {
      const id = createShapeId()
      editor.createShape({ id, type: MODEL, x: p.x, y: p.y, parentId: holder.parentId, props: { w, h, src: media[i].src, name: job.name, ext: 'glb' } })
      ids.push(id)
    })
  }, { history: 'ignore' })
  selectResults(editor, holder, ids)
})
