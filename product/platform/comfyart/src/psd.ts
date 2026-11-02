import { mediaAsset } from './jobs'
import { writePsd, type Layer } from 'ag-psd'
import type { Editor, TLShape } from 'tldraw'

const MAX_SIDE = 8000

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`cannot load ${src}`))
    img.src = src
  })
}

function assetOf(editor: Editor, shape: TLShape) {
  const asset = mediaAsset(editor, shape)
  return asset?.type === 'image' ? asset : null
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export async function downloadUrl(src: string, name: string) {
  download(await (await fetch(src)).blob(), name)
}

export async function exportPsd(editor: Editor, shapes: TLShape[], name: string) {
  const bounds = editor.getSelectionPageBounds()!
  const density = Math.max(1, ...shapes.map((s) => {
    const asset = assetOf(editor, s)
    return asset ? asset.props.w / editor.getShapePageBounds(s)!.w : 1
  }))
  const scale = Math.min(density, MAX_SIDE / Math.max(bounds.w, bounds.h))
  const [w, h] = [Math.round(bounds.w * scale), Math.round(bounds.h * scale)]
  const ordered = editor.getCurrentPageShapesSorted().filter((s) => shapes.some((x) => x.id === s.id))
  const children: Layer[] = []
  for (const shape of ordered) {
    const b = editor.getShapePageBounds(shape)!
    const asset = assetOf(editor, shape)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(b.w * scale))
    canvas.height = Math.max(1, Math.round(b.h * scale))
    const ctx = canvas.getContext('2d')!
    if (asset && !shape.rotation) {
      ctx.drawImage(await load(asset.props.src!), 0, 0, canvas.width, canvas.height)
    } else {
      const { blob } = await editor.toImage([shape.id], { format: 'png', scale, background: false, padding: 0 })
      ctx.drawImage(await load(URL.createObjectURL(blob)), 0, 0, canvas.width, canvas.height)
    }
    children.push({
      name: asset?.props.name || shape.type,
      left: Math.round((b.x - bounds.x) * scale),
      top: Math.round((b.y - bounds.y) * scale),
      canvas,
    })
  }
  const merged = document.createElement('canvas')
  merged.width = w
  merged.height = h
  const mctx = merged.getContext('2d')!
  for (const l of children) mctx.drawImage(l.canvas!, l.left!, l.top!)
  const buffer = writePsd({ width: w, height: h, children, canvas: merged })
  download(new Blob([buffer], { type: 'image/vnd.adobe.photoshop' }), `${name}.psd`)
}
