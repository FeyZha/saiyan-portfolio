import qrcode from 'qrcode-generator'
import { BaseBoxShapeUtil, HTMLContainer, T, useEditor, useValue, type RecordProps, type TLShape } from 'tldraw'

import { t } from '../i18n'

export const GENBLOCK = 'ca-genblock'
export const QR = 'ca-qr'
export const PLACEHOLDER_GRAY = '#9E9E9E'

declare module 'tldraw' {
  export interface TLGlobalShapePropsMap {
    [GENBLOCK]: { w: number; h: number; description: string }
    [QR]: { w: number; h: number; url: string; color: string }
  }
}

export type GenBlockShape = TLShape<typeof GENBLOCK>
export type QrShape = TLShape<typeof QR>

function useEditing(id: string) {
  const editor = useEditor()
  return useValue('editing', () => editor.getEditingShapeId() === id, [editor, id])
}

function GenBlockView({ shape }: { shape: GenBlockShape }) {
  const editor = useEditor()
  const editing = useEditing(shape.id)
  const { w, h, description } = shape.props
  return (
    <HTMLContainer className="ca-genblock" style={{ width: w, height: h }}>
      <span className="ca-genblock__tag">{t('compose.aiBlock')}</span>
      {editing ? (
        <textarea
          className="ca-genblock__text"
          autoFocus
          value={description}
          placeholder={t('compose.describeThisArea')}
          onChange={(e) => editor.updateShape<GenBlockShape>({ id: shape.id, type: GENBLOCK, props: { description: e.target.value } })}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') editor.setEditingShape(null) }}
        />
      ) : (
        <span className="ca-genblock__text" data-empty={!description || undefined}>{description || t('compose.describeThisArea')}</span>
      )}
    </HTMLContainer>
  )
}

export class GenBlockShapeUtil extends BaseBoxShapeUtil<GenBlockShape> {
  static override type = GENBLOCK
  static override props: RecordProps<GenBlockShape> = { w: T.number, h: T.number, description: T.string }

  override getDefaultProps(): GenBlockShape['props'] {
    return { w: 400, h: 300, description: '' }
  }

  override canEdit() {
    return true
  }

  override component(shape: GenBlockShape) {
    return <GenBlockView shape={shape} />
  }

  override getIndicatorPath(shape: GenBlockShape) {
    const path = new Path2D()
    path.rect(0, 0, shape.props.w, shape.props.h)
    return path
  }

  override toSvg(shape: GenBlockShape) {
    return <rect width={shape.props.w} height={shape.props.h} fill={PLACEHOLDER_GRAY} />
  }
}

function qrPath(url: string) {
  const qr = qrcode(0, 'M')
  qr.addData(url || ' ')
  qr.make()
  const n = qr.getModuleCount()
  let d = ''
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) d += `M${x} ${y}h1v1h-1z`
  return { d, n }
}

function QrSvg({ shape }: { shape: QrShape }) {
  const { w, h, url, color } = shape.props
  const { d, n } = qrPath(url)
  return (
    <svg width={w} height={h} viewBox={`-2 -2 ${n + 4} ${n + 4}`} shapeRendering="crispEdges">
      <rect x={-2} y={-2} width={n + 4} height={n + 4} fill="#FFFFFF" />
      <path d={d} fill={color} />
    </svg>
  )
}

function QrView({ shape }: { shape: QrShape }) {
  const editor = useEditor()
  const editing = useEditing(shape.id)
  return (
    <HTMLContainer className="ca-qr" style={{ width: shape.props.w, height: shape.props.h }}>
      <QrSvg shape={shape} />
      {editing && (
        <input
          className="ca-qr__url"
          autoFocus
          value={shape.props.url}
          placeholder="https://"
          onChange={(e) => editor.updateShape<QrShape>({ id: shape.id, type: QR, props: { url: e.target.value } })}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape' || e.key === 'Enter') editor.setEditingShape(null) }}
        />
      )}
    </HTMLContainer>
  )
}

export class QrShapeUtil extends BaseBoxShapeUtil<QrShape> {
  static override type = QR
  static override props: RecordProps<QrShape> = { w: T.number, h: T.number, url: T.string, color: T.string }

  override getDefaultProps(): QrShape['props'] {
    return { w: 240, h: 240, url: 'https://comfyart.org', color: '#000000' }
  }

  override isAspectRatioLocked() {
    return true
  }

  override canEdit() {
    return true
  }

  override component(shape: QrShape) {
    return <QrView shape={shape} />
  }

  override getIndicatorPath(shape: QrShape) {
    const path = new Path2D()
    path.rect(0, 0, shape.props.w, shape.props.h)
    return path
  }

  override toSvg(shape: QrShape) {
    return <QrSvg shape={shape} />
  }
}
