import { codexEditGraph } from './codexImages'
import { loadNamed, type PromptGraph } from './comfy'
import { customGraph } from './customWorkflows'

export const randomSeed = () => Math.floor(Math.random() * 2 ** 31)

export interface Built { graph: PromptGraph; result: string; partial?: string[] }

export function annotated(src: string): string {
  const q = new URL(src, location.origin).searchParams
  const sub = q.get('subfolder')
  return `${sub ? `${sub}/` : ''}${q.get('filename')} [${q.get('type') || 'input'}]`
}

export async function upscaleGraph(image: string, w: number, h: number, factor: number): Promise<Built> {
  return codexEditGraph(image, '高清增强原图，保留构图、文字、主体身份与材质，不重新设计。', [], false, [Math.round(w * factor), Math.round(h * factor)])
}

export async function creativeUpscaleGraph(image: string, factor: number, w: number, h: number, style: string, strength: number): Promise<Built> {
  return codexEditGraph(image, `在保持原图内容与构图的基础上增强细节和清晰度。细节增强强度 ${Math.round(strength * 100)}%。${style}`, [], false, [Math.round(w * factor), Math.round(h * factor)])
}

export async function cutoutGraph(image: string): Promise<Built> {
  return codexEditGraph(image, '移除背景，保留前景主体及细节，输出真实透明背景。', [], true)
}

export async function eraseGraph(image: string, mask: string): Promise<Built> {
  return codexEditGraph(image, '根据第二张遮罩移除标记区域的内容并自然补全背景，其他区域保持不变。', [mask])
}

export async function expandGraph(image: string, pads: { l: number; t: number; r: number; b: number }, prompt: string): Promise<Built> {
  return codexEditGraph(image, `向外扩展画面，保留原图内容。扩展像素：左${pads.l}、上${pads.t}、右${pads.r}、下${pads.b}。${prompt}`, [], false, undefined, pads)
}

export async function editGraph(image: string, prompt: string): Promise<Built> {
  return codexEditGraph(image, prompt)
}

export async function moveGraph(image: string, mask: string, from: Crop, to: { x: number; y: number }): Promise<Built> {
  return codexEditGraph(image, `按第二张遮罩选取对象，从 (${from.x},${from.y},${from.w},${from.h}) 移动到 (${to.x},${to.y})，补全原位置背景，其他内容保持不变。`, [mask])
}

export async function styleGraph(image: string, style: string, ref: string | null): Promise<Built> {
  return codexEditGraph(image, ref ? '将图 1 转为图 2 的视觉风格。保留图 1 的主体、布局与文字。' : `将原图转为 ${style} 风格，保留主体、布局和文字。`, ref ? [ref] : [])
}

export interface Crop { x: number; y: number; w: number; h: number }

export async function touchGraph(image: string, crop: Crop, mask: string, prompt: string): Promise<Built> {
  return codexEditGraph(image, `局部编辑原图：${prompt}。只修改第二张遮罩标记的区域，区域位置 (${crop.x},${crop.y},${crop.w},${crop.h})。其他区域保持不变。`, [mask])
}

const AZIMUTHS: [number, string][] = [
  [0, 'front view'], [45, 'front-right quarter view'], [90, 'right side view'], [135, 'back-right quarter view'],
  [180, 'back view'], [225, 'back-left quarter view'], [270, 'left side view'], [315, 'front-left quarter view'],
]

export function anglePrompt(horizontal: number, vertical: number, zoom: number): string {
  const az = ((horizontal % 360) + 360) % 360
  const azKw = AZIMUTHS.reduce((best, cur) => {
    const d = (a: number) => Math.min(Math.abs(az - a), 360 - Math.abs(az - a))
    return d(cur[0]) < d(best[0]) ? cur : best
  })[1]
  const elKw = vertical <= -15 ? 'low-angle shot' : vertical <= 15 ? 'eye-level shot' : vertical <= 45 ? 'elevated shot' : 'high-angle shot'
  const distKw = zoom >= 7 ? 'close-up' : zoom >= 3 ? 'medium shot' : 'wide shot'
  return `<qma> ${azKw} ${elKw} ${distKw}`
}

export async function anglesGraph(image: string, horizontal: number, vertical: number, zoom: number): Promise<Built> {
  return codexEditGraph(image, `保持主体身份、材质和细节，调整观察角度为：${anglePrompt(horizontal, vertical, zoom).replace("<qma>", "")}`)
}

export async function layersGraph(image: string, layers: number, prompt: string): Promise<Built> {
  const custom = await customGraph('layers', { image, prompt: prompt || undefined, count: layers })
  if (custom) return custom
  const { graph: g, id } = await loadNamed('layers-qwen-image-layered.api.json', 'image', 'scale', 'prompt', 'latent', 'sampler', 'save')
  g[id.image].inputs.image = image
  g[id.scale].inputs.largest_size = 1024
  g[id.prompt].inputs.value = prompt || 'An image with a foreground subject and a background.'
  g[id.latent].inputs.layers = layers
  g[id.sampler].inputs.seed = randomSeed()
  return { graph: g, result: id.save }
}

export function samGraph(image: string, target: { text: string } | { x: number; y: number } | { points: { x: number; y: number }[] }): Built {
  const graph: PromptGraph = {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sam3.1_multiplex_fp16.safetensors' } },
    '2': { class_type: 'LoadImage', inputs: { image } },
    '4': { class_type: 'SAM3_Detect', inputs: { model: ['1', 0], image: ['2', 0], threshold: 0.4, refine_iterations: 2, individual_masks: false } },
    '5': { class_type: 'MaskToImage', inputs: { mask: ['4', 0] } },
    '6': { class_type: 'PreviewImage', inputs: { images: ['5', 0] } },
  }
  if ('text' in target) {
    graph['3'] = { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: target.text } }
    graph['4'].inputs.conditioning = ['3', 0]
  } else {
    const points = 'points' in target ? target.points : [target]
    graph['4'].inputs.positive_coords = JSON.stringify(points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })))
  }
  return { graph, result: '6' }
}

export function samBoxesGraph(image: string, boxes: Crop[]): Built {
  const graph: PromptGraph = {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sam3.1_multiplex_fp16.safetensors' } },
    '2': { class_type: 'LoadImage', inputs: { image } },
  }
  let batch: [string, number] | null = null
  boxes.forEach((b, i) => {
    graph[`d${i}`] = { class_type: 'SAM3_Detect', inputs: { model: ['1', 0], image: ['2', 0], threshold: 0.4, refine_iterations: 2, individual_masks: false, bboxes: { x: b.x, y: b.y, width: b.w, height: b.h } } }
    graph[`m${i}`] = { class_type: 'MaskToImage', inputs: { mask: [`d${i}`, 0] } }
    if (batch) graph[`b${i}`] = { class_type: 'ImageBatch', inputs: { image1: batch, image2: [`m${i}`, 0] } }
    batch = batch ? [`b${i}`, 0] : [`m${i}`, 0]
  })
  graph['9'] = { class_type: 'PreviewImage', inputs: { images: batch! } }
  return { graph, result: '9' }
}
