import type { Box, Editor, TLImageShape, TLVideoShape } from 'tldraw'

import { loadImage } from './adjust'
import { queuePrompt, uploadImage, viewUrl, waitForImages } from './comfy'
import type { CommentShape } from './shapes/CommentShape'
import { resultsAtom, spawnHolder, startJob, type ErrorSink, type MediaKind } from './jobs'
import { notify } from './notices'
import { annotated, anglesGraph, creativeUpscaleGraph, cutoutGraph, editGraph, eraseGraph, expandGraph, layersGraph, moveGraph, samGraph, styleGraph, touchGraph, upscaleGraph, type Built, type Crop } from './workflows'
import { animateGraph, cutoutVideoGraph, extendGraph, upscaleVideoGraph } from './videoGraphs'
import { t } from './i18n'
import type { Edit } from './videoEdit'
import { timelineGraph } from './videoRender'
import { canvasBlob } from './canvasBlob'

export interface Pads { l: number; t: number; r: number; b: number }
export interface Stroke { points: [number, number][]; r: number }

type MediaShape = TLImageShape | TLVideoShape
interface Source { image: string; name: string; w: number; h: number }

function source(editor: Editor, shape: MediaShape): Source | null {
  const asset = shape.props.assetId ? editor.getAsset(shape.props.assetId) : null
  if (asset?.type !== shape.type || !asset.props.src) return null
  return { image: annotated(asset.props.src), name: asset.props.name || (shape.type === 'video' ? t('common.video') : t('common.image')), w: asset.props.w, h: asset.props.h }
}

function run(
  editor: Editor,
  shape: MediaShape,
  label: string,
  onError: ErrorSink,
  build: (src: Source) => Promise<Built>,
  opts: { size?: [number, number]; kind?: MediaKind; placer?: string; runOn?: string; extra?: (src: Source) => Record<string, unknown> } = {},
) {
  const src = source(editor, shape)
  if (!src) return
  const holder = spawnHolder(editor, shape, opts.size)
  void startJob(editor, holder, build(src), {
    name: `${src.name} · ${label}`,
    kind: opts.kind,
    placer: opts.placer,
    runOn: opts.runOn,
    extra: opts.extra?.(src),
  }, onError)
  return holder
}

export const upscale = (e: Editor, s: TLImageShape, factor: number, err: ErrorSink) =>
  run(e, s, t('common.upscale'), err, (src) => upscaleGraph(src.image, src.w, src.h, factor))

export const creativeUpscale = (e: Editor, s: TLImageShape, factor: number, style: string, strength: number, err: ErrorSink) =>
  run(e, s, t('common.upscale'), err, (src) => creativeUpscaleGraph(src.image, factor, src.w, src.h, style, strength))

export const cutout = (e: Editor, s: TLImageShape, err: ErrorSink) =>
  run(e, s, t('common.removeBackground'), err, (src) => cutoutGraph(src.image))

export const quickEdit = (e: Editor, s: TLImageShape, prompt: string, err: ErrorSink) =>
  run(e, s, t('common.quickEdit'), err, (src) => editGraph(src.image, prompt))

export const editText = (e: Editor, s: TLImageShape, edits: [string, string][], err: ErrorSink) =>
  run(e, s, t('common.editText'), err, (src) => editGraph(src.image,
    `${edits.map(([from, to]) => (to ? `Change the text "${from}" to "${to}" in the same font, color, size and position` : `Remove the text "${from}" and fill its area with the surrounding background`)).join('. ')}. Keep everything else in the image unchanged.`))

export const angles = (e: Editor, s: TLImageShape, h: number, v: number, z: number, err: ErrorSink) =>
  run(e, s, t('common.multiAngle'), err, (src) => anglesGraph(src.image, h, v, z))

export const expand = (e: Editor, s: TLImageShape, pads: Pads, prompt: string, err: ErrorSink) => {
  const src = source(e, s)
  if (!src) return
  const k = s.props.w / src.w
  return run(e, s, t('common.expand'), err, () => expandGraph(src.image, pads, prompt),
    { size: [(src.w + pads.l + pads.r) * k, (src.h + pads.t + pads.b) * k] })
}

export const editVideo = (e: Editor, s: TLVideoShape, edit: Edit, err: ErrorSink) =>
  run(e, s, t('common.edit'), err, (src) => timelineGraph(edit, src.w, src.h), { kind: 'video', runOn: 'local' })

export const animate = (e: Editor, s: TLImageShape, prompt: string, err: ErrorSink, loop = true) =>
  run(e, s, t('common.animateImage'), err, (src) => animateGraph(src.image, src.w, src.h, prompt, loop))

export const upscaleVideo = (e: Editor, s: TLVideoShape, long: number, err: ErrorSink) =>
  run(e, s, t('actions.upscaleVideo'), err, (src) => upscaleVideoGraph(src.image, src.w, src.h, long), { kind: 'video' })

export const cutoutVideo = (e: Editor, s: TLVideoShape, err: ErrorSink) =>
  run(e, s, t('common.removeBackground'), err, async (src) => cutoutVideoGraph(src.image), { kind: 'video' })

export const extendVideo =(e: Editor, s: TLVideoShape, prompt: string, duration: number, err: ErrorSink) =>
  run(e, s, t('common.extendVideo'), err, (src) => extendGraph(src.image, src.w, src.h, prompt, duration), { kind: 'video' })

export const styleTransfer = (e: Editor, s: TLImageShape, style: string, ref: string | null, err: ErrorSink) =>
  run(e, s, t('common.styleTransfer'), err, (src) => styleGraph(src.image, style, ref ? annotated(ref) : null))

export const splitLayers = (e: Editor, s: TLImageShape, layers: number, prompt: string, err: ErrorSink) =>
  run(e, s, t('common.splitLayers'), err, (src) => layersGraph(src.image, layers, prompt),
    { placer: 'layers', extra: (src) => ({ source: src.image, base: src.name }) })

export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[], w: number, h: number) {
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const s of strokes) {
    ctx.lineWidth = s.r * 2 * w
    ctx.beginPath()
    s.points.forEach(([u, v], i) => (i ? ctx.lineTo(u * w, v * h) : ctx.moveTo(u * w, v * h)))
    if (s.points.length === 1) ctx.lineTo(s.points[0][0] * w + 0.01, s.points[0][1] * h)
    ctx.stroke()
  }
}

export async function maskFile(w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void): Promise<string> {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.globalCompositeOperation = 'destination-out'
  paint(ctx)
  const ref = await uploadImage(await canvasBlob(c), `mask-${Date.now()}.png`)
  return `${ref.subfolder ? `${ref.subfolder}/` : ''}${ref.filename} [${ref.type}]`
}

const eraseWith = (e: Editor, s: TLImageShape, err: ErrorSink, paint: (ctx: CanvasRenderingContext2D, src: Source) => void) =>
  run(e, s, t('common.eraser'), err, async (src) => eraseGraph(src.image, await maskFile(src.w, src.h, (ctx) => paint(ctx, src))))

export const erase = (e: Editor, s: TLImageShape, strokes: Stroke[], err: ErrorSink) =>
  eraseWith(e, s, err, (ctx, src) => drawStrokes(ctx, strokes, src.w, src.h))

export const eraseRegion = (e: Editor, s: TLImageShape, r: Crop, err: ErrorSink) =>
  eraseWith(e, s, err, (ctx) => ctx.fillRect(r.x, r.y, r.w, r.h))

const TOUCH_PAD = 0.25
const TOUCH_MIN = 384
const TOUCH_POINT = 0.3

export function cropAround(region: Crop, w: number, h: number): Crop {
  const grow = (len: number, full: number) => Math.min(full, Math.max(len * (1 + TOUCH_PAD * 2), TOUCH_MIN))
  const cw = Math.min(w, Math.round(grow(region.w, w) / 8) * 8)
  const ch = Math.min(h, Math.round(grow(region.h, h) / 8) * 8)
  const clamp = (v: number, size: number, full: number) => Math.round(Math.min(Math.max(v, 0), full - size))
  return { x: clamp(region.x + region.w / 2 - cw / 2, cw, w), y: clamp(region.y + region.h / 2 - ch / 2, ch, h), w: cw, h: ch }
}

export function inpaint(e: Editor, shape: TLImageShape, mask: HTMLCanvasElement, feather: number, prompt: string, err: ErrorSink) {
  const src = source(e, shape)
  if (!src) return
  const bounds = maskBounds(mask)
  if (!bounds) return
  const k = src.w / mask.width
  const crop = cropAround({ x: bounds.x * k, y: bounds.y * k, w: bounds.w * k, h: bounds.h * k }, src.w, src.h)
  const holder = spawnHolder(e, shape)
  void startJob(e, holder, (async () => {
    const file = await maskFile(crop.w, crop.h, (ctx) => {
      ctx.filter = `blur(${feather}px)`
      ctx.drawImage(mask, crop.x / k, crop.y / k, crop.w / k, crop.h / k, 0, 0, crop.w, crop.h)
    })
    return touchGraph(src.image, crop, file, prompt)
  })(), { name: t('actions.inpaint', src.name) }, err)
  return holder
}

export function editRegion(e: Editor, shape: TLImageShape, region: Crop, prompt: string, err: ErrorSink) {
  const src = source(e, shape)
  if (!src) return
  const crop = cropAround(region, src.w, src.h)
  const feather = Math.max(4, Math.min(crop.w, crop.h) * 0.04)
  const holder = spawnHolder(e, shape)
  void startJob(e, holder, (async () => {
    const mask = await maskFile(crop.w, crop.h, (ctx) => {
      ctx.filter = `blur(${feather}px)`
      ctx.fillRect(region.x - crop.x, region.y - crop.y, region.w, region.h)
    })
    return touchGraph(src.image, crop, mask, prompt)
  })(), { name: t('actions.localEdit', src.name) }, err)
  return holder
}

export function moveObject(e: Editor, shape: TLImageShape, mask: HTMLCanvasElement, dx: number, dy: number, err: ErrorSink) {
  const src = source(e, shape)
  const bounds = maskBounds(mask)
  if (!src || !bounds) return
  const k = src.w / mask.width
  const from = { x: Math.round(bounds.x * k), y: Math.round(bounds.y * k), w: Math.round(bounds.w * k), h: Math.round(bounds.h * k) }
  const to = { x: Math.round(from.x + dx * k), y: Math.round(from.y + dy * k) }
  const holder = spawnHolder(e, shape)
  void startJob(e, holder, (async () => {
    const file = await maskFile(src.w, src.h, (ctx) => ctx.drawImage(mask, 0, 0, src.w, src.h))
    return moveGraph(src.image, file, from, to)
  })(), { name: t('actions.moveObject', src.name) }, err)
  return holder
}

export function moveTarget(e: Editor, shape: TLImageShape, target: { text: string } | { x: number; y: number }, dx: number, dy: number, err: ErrorSink) {
  const src = source(e, shape)
  if (!src) return
  const holder = spawnHolder(e, shape)
  void startJob(e, holder, (async () => {
    const sam = samGraph(src.image, target)
    const [ref] = await waitForImages(await queuePrompt(sam.graph), sam.result)
    const mask = lumaToAlpha(await loadImage(viewUrl(ref)), src.w, src.h)
    const from = maskBounds(mask)
    if (!from) throw new Error(t('actions.noObjectFound'))
    const file = await maskFile(src.w, src.h, (ctx) => ctx.drawImage(mask, 0, 0))
    return moveGraph(src.image, file, from, { x: Math.round(from.x + dx), y: Math.round(from.y + dy) })
  })(), { name: t('actions.moveObject', src.name) }, err)
  return holder
}

export function maskBounds(mask: HTMLCanvasElement): Crop | null {
  const { data, width, height } = mask.getContext('2d')!.getImageData(0, 0, mask.width, mask.height)
  let [l, t, r, b] = [width, height, -1, -1]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] < 16) continue
      if (x < l) l = x
      if (x > r) r = x
      if (y < t) t = y
      if (y > b) b = y
    }
  }
  return r < 0 ? null : { x: l, y: t, w: r - l + 1, h: b - t + 1 }
}

export function lumaToAlpha(img: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, w, h)
  const px = ctx.getImageData(0, 0, w, h)
  for (let i = 0; i < px.data.length; i += 4) {
    px.data[i + 3] = px.data[i]
    px.data[i] = px.data[i + 1] = px.data[i + 2] = 255
  }
  ctx.putImageData(px, 0, 0)
  return c
}

export interface Mark { image: string; src: string; box: Crop }
export type MarkState = Mark | 'loading' | 'none'

export const markOf = (comment: CommentShape) => comment.meta.mark as MarkState | undefined
export const extraPointsOf = (comment: CommentShape) => (comment.meta.points as [number, number][] | undefined) ?? []

export async function markObject(e: Editor, comment: CommentShape) {
  const box = e.getShapePageBounds(comment)!
  const shape = imageUnder(e, box)
  const src = shape && source(e, shape)
  if (!shape || !src) return
  const set = (mark: MarkState) => e.getShape(comment.id) && e.updateShape<CommentShape>({ id: comment.id, type: comment.type, meta: { ...e.getShape(comment.id)!.meta, mark: mark as any } })
  set('loading')
  try {
    const b = e.getShapePageBounds(shape)!
    const k = src.w / b.w
    const pts: [number, number][] = [[box.center.x, box.center.y], ...extraPointsOf(e.getShape<CommentShape>(comment.id) ?? comment)]
    const { graph, result } = samGraph(src.image, { points: pts.map(([x, y]) => ({ x: (x - b.x) * k, y: (y - b.y) * k })) })
    const [ref] = await waitForImages(await queuePrompt(graph), result)
    const url = viewUrl(await uploadImage(await (await fetch(viewUrl(ref))).blob(), `mark-${Date.now()}.png`))
    const found = maskBounds(lumaToAlpha(await loadImage(url), src.w, src.h))
    set(found ? { image: shape.id, src: url, box: found } : 'none')
  } catch {
    set('none')
  }
}

export function imageUnder(editor: Editor, box: Box): TLImageShape | null {
  const hits = editor.getCurrentPageShapesSorted().filter((s): s is TLImageShape => {
    if (s.type !== 'image') return false
    return editor.getShapePageBounds(s)?.containsPoint(box.center) ?? false
  })
  return hits.at(-1) ?? null
}

export function commentTarget(e: Editor, comment: CommentShape) {
  const box = e.getShapePageBounds(comment)!
  const shape = imageUnder(e, box)
  const src = shape && source(e, shape)
  if (!shape || !src) return null
  const b = e.getShapePageBounds(shape)!
  const k = src.w / b.w
  const mark = markOf(comment)
  const marked = comment.props.kind === 'point' && !!mark && typeof mark === 'object' ? mark : null
  const side = Math.min(src.w, src.h) * TOUCH_POINT
  const region: Crop = marked ? marked.box : comment.props.kind === 'point'
    ? { x: (box.center.x - b.x) * k - side / 2, y: (box.center.y - b.y) * k - side / 2, w: side, h: side }
    : { x: (box.x - b.x) * k, y: (box.y - b.y) * k, w: box.w * k, h: box.h * k }
  return { shape, src, marked, region }
}

export function touchEdit(e: Editor, comment: CommentShape, err: ErrorSink) {
  const target = commentTarget(e, comment)
  if (!target) return
  const { shape, src, marked, region } = target
  const { kind, path } = comment.props
  const crop = cropAround(region, src.w, src.h)
  const [cw, ch] = [crop.w, crop.h]
  const feather = Math.max(4, Math.min(cw, ch) * 0.04)
  const holder = spawnHolder(e, shape)
  void startJob(e, holder, (async () => {
    const object = marked && lumaToAlpha(await loadImage(marked.src), src.w, src.h)
    const mask = await maskFile(cw, ch, (ctx) => {
      const [rx, ry, rw, rh] = [region.x - crop.x, region.y - crop.y, region.w, region.h]
      ctx.filter = `blur(${feather}px)`
      if (object) {
        for (let i = 0; i < 3; i++) ctx.drawImage(object, -crop.x, -crop.y)
        return
      }
      ctx.beginPath()
      if (kind === 'lasso') path.split(' ').map((p) => p.split(',').map(Number)).forEach(([u, v], i) => (i ? ctx.lineTo(rx + u * rw, ry + v * rh) : ctx.moveTo(rx + u * rw, ry + v * rh)))
      else if (kind === 'point') ctx.ellipse(rx + rw / 2, ry + rh / 2, rw / 2, rh / 2, 0, 0, Math.PI * 2)
      else ctx.rect(rx, ry, rw, rh)
      ctx.fill()
    })
    return touchGraph(src.image, crop, mask, comment.props.text)
  })(), { name: t('actions.localEdit', src.name) }, err).then(() => {
    const r = resultsAtom.get()[holder]
    if (r) void notify({ kind: 'comment', title: r.error ? t('actions.commentEditFailed') : t('actions.commentEditDone'), body: comment.props.text.trim() || undefined, srcs: r.srcs })
  })
  return holder
}
