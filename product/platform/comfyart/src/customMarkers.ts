import { titleTags, type PromptGraph } from './comfy'
import { t } from './i18n'

export type CustomAction = 'generate' | 'edit' | 'style' | 'inpaint' | 'expand' | 'upscale' | 'cutout' | 'erase' | 'angles' | 'layers' | 'video' | 'animate'
export type Marker = 'image' | 'image2' | 'mask' | 'last' | 'prompt' | 'size' | 'width' | 'height' | 'count' | 'seconds' | 'unet' | 'save'

export type CustomGroup = 'image' | 'edit' | 'tools' | 'video'

interface ActionSpec { id: CustomAction; group: CustomGroup; required: Marker[]; optional: Marker[]; needsImages?: boolean; note: string }

export const CUSTOM_ACTIONS: ActionSpec[] = [
  { id: 'generate', group: 'image', required: ['prompt', 'size'], optional: ['count', 'unet'], note: 'Text to image. Shows up as an extra model in the image generator. Reference and base images are not passed. Transparent output is added by ComfyArt after @save, so @save needs an images input. LoRAs picked under Advanced need @unet.' },
  { id: 'edit', group: 'edit', required: ['image', 'prompt'], optional: [], note: 'Instruction edit: quick edit, edit text, compose and mockup blending. @prompt receives the edit instruction.' },
  { id: 'style', group: 'edit', required: ['image', 'prompt'], optional: ['image2'], note: 'Style transfer. @image2 is the style reference; without one ComfyArt passes the source image again. A reference given to a workflow with no @image2 is an error.' },
  { id: 'inpaint', group: 'edit', required: ['image', 'prompt'], optional: [], needsImages: true, note: 'Edit a region. @image receives the cropped region; ComfyArt pastes the result back into the full image, so @save needs an images input.' },
  { id: 'expand', group: 'edit', required: ['image', 'mask', 'prompt'], optional: [], note: 'Outpaint. ComfyArt pads the image itself: @image receives the padded image and @mask the new area (white = fill).' },
  { id: 'angles', group: 'edit', required: ['image', 'prompt'], optional: [], note: '@prompt receives a camera description such as "<qma> front-right quarter view eye-level shot medium shot".' },
  { id: 'upscale', group: 'tools', required: ['image'], optional: [], needsImages: true, note: 'ComfyArt resizes the result to the factor the user picked, so @save needs an images input.' },
  { id: 'cutout', group: 'tools', required: ['image'], optional: [], note: 'Background removal. The result should keep an alpha channel.' },
  { id: 'erase', group: 'tools', required: ['image', 'mask'], optional: [], note: 'Object removal, also used to fill the background behind edited elements and split layers. @mask is the area to remove (white = remove).' },
  { id: 'layers', group: 'tools', required: ['image'], optional: ['prompt', 'count'], note: '@count receives the number of layers. The result is several RGBA images.' },
  { id: 'video', group: 'video', required: ['prompt', 'size'], optional: ['image', 'last', 'seconds'], note: 'Replaces the built-in model in the video generator\'s first/last frame mode (reference, motion, lip sync and storyboard modes stay built in). A first or last frame given to a workflow without @image / @last is an error.' },
  { id: 'animate', group: 'video', required: ['image', 'prompt'], optional: ['size', 'seconds', 'last'], note: 'Animate an image into a short clip. With loop on, @last receives the source image again so the clip ends where it starts.' },
]

export const MARKERS: { id: Marker; fill: string }[] = [
  { id: 'image', fill: 'Load Image (LoadImage or LoadImageMask): the input image' },
  { id: 'image2', fill: 'Load Image: a second image' },
  { id: 'mask', fill: 'LoadImageMask (channel is set to alpha) or LoadImage (use its MASK output): white = area to change' },
  { id: 'last', fill: 'Load Image: the last frame of a video' },
  { id: 'prompt', fill: 'a node holding the text as a widget, e.g. CLIPTextEncode (text), TextEncodeQwenImageEdit (prompt), String (Multiline) (value)' },
  { id: 'size', fill: 'a node with width and height widgets, e.g. EmptyLatentImage; its batch_size also gets the image count when there is no @count' },
  { id: 'width', fill: 'an Int node or any node with a width widget' },
  { id: 'height', fill: 'an Int node or any node with a height widget' },
  { id: 'count', fill: 'an Int node or a node with batch_size / amount: how many results' },
  { id: 'seconds', fill: 'an Int or Float node or a node with seconds / duration: video length in seconds (not frames)' },
  { id: 'unet', fill: 'the node whose first output is the MODEL, e.g. Load Diffusion Model or Load Checkpoint: LoRAs picked under Advanced are chained after it' },
  { id: 'save', fill: 'the output node (Save Image, Save Video, Preview Image...). Needed only when the workflow has more than one end node' },
]

const LOADERS = ['LoadImage', 'LoadImageMask']
const IMAGE_MARKERS: Marker[] = ['image', 'image2', 'mask', 'last']
const TEXT_KEYS = ['text', 'prompt', 'value', 'string']
const NUMBER_KEYS: Partial<Record<Marker, string[]>> = {
  width: ['value', 'width'], height: ['value', 'height'], count: ['value', 'batch_size', 'amount'], seconds: ['value', 'seconds', 'duration'],
}

export type Markers = Partial<Record<Marker, string>>

export const specOf = (action: CustomAction) => CUSTOM_ACTIONS.find((a) => a.id === action)!
const label = (graph: PromptGraph, id: string) => `${id} (${graph[id].class_type})`

export function parseApiWorkflow(text: string): PromptGraph {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(t('customWorkflows.notJson'))
  }
  return asApiWorkflow(data)
}

export function asApiWorkflow(data: unknown): PromptGraph {
  if (!data || typeof data !== 'object' || Array.isArray(data) || 'nodes' in data) throw new Error(t('customWorkflows.notApiFormat'))
  const nodes = Object.values(data as Record<string, unknown>)
  if (!nodes.length || !nodes.every((n) => n && typeof n === 'object' && 'class_type' in n && 'inputs' in n)) throw new Error(t('customWorkflows.notApiFormat'))
  return data as PromptGraph
}

export function findMarkers(graph: PromptGraph): Markers {
  const found: Markers = {}
  for (const [id, node] of Object.entries(graph) as [string, PromptGraph[string]][]) {
    for (const tag of titleTags(node)) {
      const marker = MARKERS.find((m) => tag === `@${m.id}`)?.id
      if (marker && !found[marker]) found[marker] = id
    }
  }
  return found
}

function sinkOf(graph: PromptGraph): string | null {
  const used = new Set<string>()
  for (const node of Object.values(graph)) for (const v of Object.values(node.inputs)) if (Array.isArray(v) && typeof v[0] === 'string') used.add(v[0])
  const sinks = Object.keys(graph).filter((id) => !used.has(id))
  return sinks.length === 1 ? sinks[0] : null
}

export const outputOf = (graph: PromptGraph, markers: Markers) => markers.save ?? sinkOf(graph)

function textKey(node: PromptGraph[string]): string | null {
  const keys = Object.keys(node.inputs).filter((k) => typeof node.inputs[k] === 'string')
  return TEXT_KEYS.find((k) => keys.includes(k)) ?? (keys.length === 1 ? keys[0] : null)
}

function numberKey(node: PromptGraph[string], marker: Marker): string | null {
  const keys = Object.keys(node.inputs).filter((k) => typeof node.inputs[k] === 'number')
  return (NUMBER_KEYS[marker] ?? []).find((k) => keys.includes(k)) ?? null
}

function fillProblem(graph: PromptGraph, id: string, marker: Marker): string | null {
  const node = graph[id]
  if (IMAGE_MARKERS.includes(marker)) return LOADERS.includes(node.class_type) ? null : t('customWorkflows.needsLoader', `@${marker}`, label(graph, id))
  if (marker === 'prompt') return textKey(node) ? null : t('customWorkflows.noTextWidget', label(graph, id))
  if (marker === 'size') return ['width', 'height'].every((k) => typeof node.inputs[k] === 'number') ? null : t('customWorkflows.noSizeWidgets', label(graph, id))
  if (marker === 'save' || marker === 'unet') return null
  return numberKey(node, marker) ? null : t('customWorkflows.noNumberWidget', `@${marker}`, label(graph, id))
}

export interface Check { markers: Markers; errors: string[]; warnings: string[] }

export function checkWorkflow(graph: PromptGraph, action: CustomAction): Check {
  const spec = specOf(action)
  const markers = findMarkers(graph)
  const errors: string[] = []
  const warnings: string[] = []
  const has = (m: Marker) => !!markers[m] || (m === 'size' && !!markers.width && !!markers.height)
  const missing = spec.required.filter((m) => !has(m))
  if (missing.length) errors.push(t('customWorkflows.missingMarkers', missing.map((m) => (m === 'size' ? '@size (or @width + @height)' : `@${m}`)).join(', ')))
  const titles = new Map<string, string[]>()
  for (const [id, node] of Object.entries(graph) as [string, PromptGraph[string]][]) {
    for (const tag of titleTags(node)) titles.set(tag, [...(titles.get(tag) ?? []), id])
  }
  const usable: Marker[] = [...spec.required, ...spec.optional, 'save', ...(spec.required.includes('size') || spec.optional.includes('size') ? ['width', 'height'] as Marker[] : [])]
  for (const [title, ids] of titles) {
    const marker = MARKERS.find((m) => `@${m.id}` === title)?.id
    if (ids.length > 1) errors.push(t('customWorkflows.duplicateMarker', title, ids.join(', ')))
    if (!marker) warnings.push(t('customWorkflows.unknownMarker', title, ids[0]))
    else if (!usable.includes(marker)) warnings.push(t('customWorkflows.unusedMarker', title, t(`customWorkflows.action.${action}`)))
  }
  for (const [marker, id] of Object.entries(markers) as [Marker, string][]) {
    if (!usable.includes(marker)) continue
    const problem = fillProblem(graph, id, marker)
    if (problem) errors.push(problem)
  }
  const out = outputOf(graph, markers)
  if (!out) errors.push(t('customWorkflows.noOutput'))
  else if (spec.needsImages && !Array.isArray(graph[out].inputs.images)) errors.push(t('customWorkflows.outputNeedsImages', label(graph, out)))
  return { markers, errors, warnings }
}

export interface CustomValues { image?: string; image2?: string; mask?: string; last?: string; prompt?: string; width?: number; height?: number; count?: number; seconds?: number }

export function fillWorkflow(graph: PromptGraph, markers: Markers, values: CustomValues) {
  for (const [marker, id] of Object.entries(markers) as [Marker, string][]) {
    const value = marker === 'size' || marker === 'save' || marker === 'unet' ? undefined : values[marker]
    if (value === undefined) continue
    const node = graph[id]
    if (IMAGE_MARKERS.includes(marker)) {
      node.inputs.image = value
      if (node.class_type === 'LoadImageMask') node.inputs.channel = 'alpha'
    } else node.inputs[marker === 'prompt' ? textKey(node)! : numberKey(node, marker)!] = value
  }
  if (markers.size && values.width && values.height) {
    const size = graph[markers.size].inputs
    Object.assign(size, { width: values.width, height: values.height })
    if (values.count && typeof size.batch_size === 'number' && !markers.count) size.batch_size = values.count
  }
  for (const node of Object.values(graph)) {
    for (const k of ['seed', 'noise_seed']) if (typeof node.inputs[k] === 'number') node.inputs[k] = Math.floor(Math.random() * 2 ** 31)
  }
}

export function rulesText(): string {
  const markers = MARKERS.map((m) => `- @${m.id}: ${m.fill}`).join('\n')
  const actions = CUSTOM_ACTIONS.map((a) => `- ${a.id}: needs ${a.required.map((m) => `@${m}`).join(', ')}${a.optional.length ? `; optional ${a.optional.map((m) => `@${m}`).join(', ')}` : ''}. ${a.note}`).join('\n')
  return [
    'Connect a user\'s own ComfyUI workflow to a ComfyArt feature. ComfyArt finds the nodes to fill by their title (_meta.title in API format), so the job is to title the right nodes and install the workflow.',
    'Steps:\n1. The workflow must be API format (Workflow > Export (API) in ComfyUI): an object of node id -> {class_type, inputs, _meta}. A UI-format file (with "nodes" and "links") cannot be used; ask the user to export it as API.\n2. Pick the feature (action) and set _meta.title of the nodes listed for it below. Titles are case-insensitive. Each marker goes on exactly one node; a node that receives several values carries several markers separated by spaces, e.g. "@prompt @size". Other words in the title are ignored, so "Positive @prompt" works. Only change _meta.title and, when a value has no node to receive it, add the smallest node that can (for example a PrimitiveInt for @seconds feeding a frame-count input through a math node). Do not change the user\'s models or settings.\n3. Call custom_workflow with action check, the workflow and the feature; fix every error it reports.\n4. Call custom_workflow with action install, a short name, the workflow and the feature. It saves the file to comfyart/workflows/<feature>/ in the ComfyUI user folder and assigns it to that feature. There is no delete: to remove a workflow, the user deletes its file there.\n5. Tell the user which feature now uses it; assign with file "" switches back to built in.',
    `Markers (the node title is @ plus the name):\n${markers}`,
    `Features:\n${actions}`,
    'ComfyArt randomizes every seed and noise_seed input on each run and maps model file names to the subfolder they are in, so seeds and model paths need no marker. The workflows ComfyArt ships (custom_nodes/ComfyArt/workflows/*.api.json) carry the same titles and are good examples; other @ names in them (besides @unet) are internal and ignored for custom workflows. Features not listed above (storyboard, video extend, creative upscale, move object, video upscale) always use the built-in workflows.',
  ].join('\n\n')
}
