import { cloneElement, type CSSProperties, type ReactElement } from 'react'
import { FrameShapeUtil, Vec, type Editor, type SvgExportContext, type TLFrameShape, type TLShapeId } from 'tldraw'

import { t } from '../i18n'
import { canvasBlob } from '../canvasBlob'

export interface ArtboardStyle { fill?: string; stroke?: string; radius?: number }

const ARC_STEPS = 6

export const artboardStyle = (shape: TLFrameShape) => (shape.meta.style as ArtboardStyle | undefined) ?? {}

const radiusOf = (shape: TLFrameShape) => Math.min(artboardStyle(shape).radius ?? 0, shape.props.w / 2, shape.props.h / 2)

type ImageOpts = NonNullable<Parameters<Editor['toImage']>[1]>
const MIME = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' } as const

export async function exportImage(editor: Editor, ids: TLShapeId[], opts: ImageOpts) {
  const frame = ids.length === 1 ? editor.getShape(ids[0]) : null
  const style = frame?.type === 'frame' ? artboardStyle(frame as TLFrameShape) : {}
  if (!frame || (!style.fill && !style.stroke && !style.radius)) return editor.toImage(ids, opts)
  const { w, h } = (frame as TLFrameShape).props
  const r = radiusOf(frame as TLFrameShape)
  const fill = style.fill || '#FFFFFF'
  if (opts.format === 'svg') {
    const res = await editor.getSvgString(ids, { ...opts, background: false })
    if (!res) throw new Error('nothing to export')
    const b = editor.getShapePageBounds(frame)!
    const rect = `<rect x="${b.x}" y="${b.y}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="${fill}"${style.stroke ? ` stroke="${style.stroke}"` : ''}/>`
    const svg = res.svg.replace(/(<svg[^>]*>)/, `$1${rect}`)
    return { blob: new Blob([svg], { type: 'image/svg+xml' }), width: res.width, height: res.height }
  }
  const { blob, width, height } = await editor.toImage(ids, { ...opts, format: 'png', background: false })
  const img = await createImageBitmap(blob)
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  const ctx = c.getContext('2d')!
  const k = img.width / w
  if (opts.format === 'jpeg') {
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, c.width, c.height)
  }
  ctx.beginPath()
  ctx.roundRect(0, 0, c.width, c.height, r * k)
  ctx.fillStyle = fill
  ctx.fill()
  ctx.drawImage(img, 0, 0)
  if (style.stroke) {
    ctx.strokeStyle = style.stroke
    ctx.lineWidth = k
    ctx.stroke()
  }
  const type = MIME[opts.format as keyof typeof MIME] ?? MIME.png
  return { blob: await canvasBlob(c, type), width, height }
}

export class ArtboardShapeUtil extends FrameShapeUtil.configure({
  getCustomDisplayValues: (_editor, shape) => {
    const { fill, stroke } = artboardStyle(shape)
    return { ...(fill ? { fillColor: fill } : {}), ...(stroke ? { strokeColor: stroke } : {}) }
  },
}) {
  override component(shape: TLFrameShape) {
    const r = radiusOf(shape)
    const empty = shape.meta.refFrame === true && !this.editor.getSortedChildIdsForParent(shape.id).length
    return (
      <div style={{ display: 'contents', '--ca-frame-r': `${r}px` } as CSSProperties}>
        {super.component(shape)}
        {empty && <div className="ca-reframe__hint">{t('chatFrame.dropHint')}</div>}
      </div>
    )
  }

  override toSvg(shape: TLFrameShape, ctx: SvgExportContext) {
    const svg = super.toSvg(shape, ctx) as ReactElement<{ children: ReactElement[] }>
    const r = radiusOf(shape)
    if (!r) return svg
    const [body, ...rest] = svg.props.children
    return <>{cloneElement(body as ReactElement<{ rx: number; ry: number }>, { rx: r, ry: r })}{rest}</>
  }

  override getClipPath(shape: TLFrameShape) {
    const r = radiusOf(shape)
    if (!r) return super.getClipPath(shape)
    const { w, h } = shape.props
    const corners: [number, number, number][] = [[w - r, r, -90], [w - r, h - r, 0], [r, h - r, 90], [r, r, 180]]
    return corners.flatMap(([cx, cy, start]) => Array.from({ length: ARC_STEPS + 1 }, (_, i) => {
      const a = ((start + (i * 90) / ARC_STEPS) * Math.PI) / 180
      return new Vec(cx + r * Math.cos(a), cy + r * Math.sin(a))
    }))
  }
}
