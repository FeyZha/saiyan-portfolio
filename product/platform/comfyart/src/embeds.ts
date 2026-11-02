import { unzipSync } from 'fflate'
import { createShapeId, type Editor, type VecLike } from 'tldraw'

import { AUDIO_EXTS, uploadImage, viewUrl } from './comfy'
import { AUDIO, AUDIO_SIZE, HTML, LOTTIE, MODEL } from './shapes/EmbedShapes'

export const MODEL_EXTS = ['glb', 'gltf', 'obj', 'fbx', 'stl', 'ply']
const LOTTIE_LONG = 480
const MODEL_SIZE = 480
const HTML_SIZE: [number, number] = [960, 640]

const extOf = (file: File) => file.name.toLowerCase().split('.').pop() ?? ''

async function lottieJson(file: File): Promise<string | null> {
  if (extOf(file) === 'lottie') {
    const files = unzipSync(new Uint8Array(await file.arrayBuffer()))
    const entry = Object.keys(files).find((k) => k.startsWith('animations/') && k.endsWith('.json'))
    return entry ? new TextDecoder().decode(files[entry]) : null
  }
  if (extOf(file) !== 'json') return null
  const text = await file.text()
  try {
    const data = JSON.parse(text)
    return data && Array.isArray(data.layers) && data.fr ? text : null
  } catch {
    return null
  }
}

function spot(editor: Editor, w: number, h: number, at?: VecLike) {
  const c = at ?? editor.getViewportPageBounds().center
  return { x: c.x - w / 2, y: c.y - h / 2 }
}

function finish(editor: Editor, id: ReturnType<typeof createShapeId>) {
  editor.select(id)
  editor.zoomToSelectionIfOffscreen(64, { animation: { duration: 200 } })
}

export function placeHtml(editor: Editor, html: string, name: string, at?: VecLike) {
  const [w, h] = HTML_SIZE
  const id = createShapeId()
  editor.createShape({ id, type: HTML, ...spot(editor, w, h, at), props: { w, h, html, name } })
  finish(editor, id)
  return id
}

export async function placeEmbed(editor: Editor, file: File, at?: VecLike): Promise<boolean> {
  const ext = extOf(file)
  if (ext === 'html' || ext === 'htm') {
    placeHtml(editor, await file.text(), file.name, at)
    return true
  }
  const json = await lottieJson(file)
  if (json) {
    const data = JSON.parse(json) as { w?: number; h?: number }
    const ref = await uploadImage(new Blob([json], { type: 'application/json' }), file.name.replace(/\.lottie$/i, '.json'))
    const k = LOTTIE_LONG / Math.max(data.w ?? LOTTIE_LONG, data.h ?? LOTTIE_LONG)
    const [w, h] = [(data.w ?? LOTTIE_LONG) * k, (data.h ?? LOTTIE_LONG) * k]
    const id = createShapeId()
    editor.createShape({ id, type: LOTTIE, ...spot(editor, w, h, at), props: { w, h, src: viewUrl(ref), name: file.name } })
    finish(editor, id)
    return true
  }
  if (AUDIO_EXTS.includes(ext)) {
    const ref = await uploadImage(file, file.name)
    const id = createShapeId()
    editor.createShape({ id, type: AUDIO, ...spot(editor, AUDIO_SIZE[0], AUDIO_SIZE[1], at), props: { src: viewUrl(ref), name: file.name } })
    finish(editor, id)
    return true
  }
  if (MODEL_EXTS.includes(ext)) {
    const ref = await uploadImage(file, file.name)
    const id = createShapeId()
    editor.createShape({ id, type: MODEL, ...spot(editor, MODEL_SIZE, MODEL_SIZE, at), props: { w: MODEL_SIZE, h: MODEL_SIZE, src: viewUrl(ref), name: file.name, ext } })
    finish(editor, id)
    return true
  }
  return false
}
