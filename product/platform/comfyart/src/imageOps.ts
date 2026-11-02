import { AssetRecordType, type Editor, type JsonObject, type TLAssetId, type TLImageShape } from 'tldraw'

import type { Adjust } from './adjust'
import { uploadImage, viewUrl } from './comfy'
import { canvasBlob } from './canvasBlob'

export interface Adjusted { source: TLAssetId; adjust: Adjust }

function assetOf(editor: Editor, shape: TLImageShape) {
  const asset = shape.props.assetId ? editor.getAsset(shape.props.assetId) : null
  return asset?.type === 'image' && asset.props.src ? asset : null
}

export function originalOf(shape: TLImageShape): string | null {
  return (shape.meta.original as string | undefined) ?? null
}

export const adjustedOf = (shape: TLImageShape) => (shape.meta.adjusted as Adjusted | undefined) ?? null

export function sourceAsset(editor: Editor, shape: TLImageShape) {
  const id = adjustedOf(shape)?.source
  const source = id ? editor.getAsset(id) : null
  return source?.type === 'image' && source.props.src ? source : assetOf(editor, shape)
}

async function uploadCanvas(editor: Editor, canvas: HTMLCanvasElement, name: string) {
  const ref = await uploadImage(await canvasBlob(canvas), `${name || 'image'}.png`.replace(/(\.png)+$/, '.png'))
  const assetId = AssetRecordType.createId()
  editor.createAssets([{ id: assetId, typeName: 'asset', type: 'image', props: { name, src: viewUrl(ref), w: canvas.width, h: canvas.height, mimeType: 'image/png', isAnimated: false }, meta: {} }])
  return assetId
}

function setSource(editor: Editor, shape: TLImageShape, src: string, w: number, h: number, name: string, original: string | null) {
  const assetId = AssetRecordType.createId()
  editor.createAssets([{ id: assetId, typeName: 'asset', type: 'image', props: { name, src, w, h, mimeType: 'image/png', isAnimated: false }, meta: {} }])
  editor.updateShape<TLImageShape>({ id: shape.id, type: 'image', props: { assetId, crop: null }, meta: { ...shape.meta, adjusted: null, original } })
}

export async function replacePixels(editor: Editor, shape: TLImageShape, canvas: HTMLCanvasElement) {
  const asset = assetOf(editor, shape)
  if (!asset) return
  const ref = await uploadImage(await canvasBlob(canvas), `${asset.props.name || 'image'}.png`.replace(/(\.png)+$/, '.png'))
  const current = editor.getShape<TLImageShape>(shape.id) ?? shape
  setSource(editor, current, viewUrl(ref), canvas.width, canvas.height, asset.props.name, originalOf(current) ?? asset.props.src)
}

export async function applyAdjust(editor: Editor, shape: TLImageShape, adjust: Adjust | null, render: () => HTMLCanvasElement) {
  const source = sourceAsset(editor, shape)
  if (!source) return
  if (!adjust) {
    editor.updateShape<TLImageShape>({ id: shape.id, type: 'image', props: { assetId: source.id }, meta: { ...shape.meta, adjusted: null } })
    return
  }
  const assetId = await uploadCanvas(editor, render(), source.props.name)
  const current = editor.getShape<TLImageShape>(shape.id) ?? shape
  editor.updateShape<TLImageShape>({ id: shape.id, type: 'image', props: { assetId }, meta: { ...current.meta, adjusted: { source: source.id, adjust } as unknown as JsonObject } })
}

export function restoreOriginal(editor: Editor, shape: TLImageShape) {
  const src = originalOf(shape)
  const asset = assetOf(editor, shape)
  if (!src || !asset) return
  const img = new Image()
  img.onload = () => setSource(editor, shape, src, img.naturalWidth, img.naturalHeight, asset.props.name, null)
  img.src = src
}
