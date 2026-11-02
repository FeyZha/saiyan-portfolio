import { useRef, useState } from 'react'
import { getIndexBetween, useValue, type Editor, type TLFrameShape, type TLParentId, type TLShape, type TLShapeId } from 'tldraw'

import { mediaAsset } from '../jobs'
import { GENERATOR } from '../shapes/GeneratorShape'
import { isVideo } from '../models'
import { Icons } from './icons'
import { t } from '../i18n'
import { isEnter } from './keys'

const TYPE_NAMES: Record<string, string> = { image: t('common.image'), video: t('common.video'), frame: t('common.artboard'), group: t('shortcuts.group'), draw: t('common.draw'), doodle: t('common.draw'), comment: t('common.comment'), text: t('common.text'), 'ca-text': t('common.text') }
const VECTOR_NAMES: Record<string, string> = { rect: t('common.rectangle'), ellipse: t('sidePanel.ellipse'), polygon: t('dock.polygon'), star: t('dock.star') }

export interface Media { src: string; name: string; video: boolean }
type Drop = 'above' | 'below' | 'into'

export function mediaOf(editor: Editor, shape: TLShape): Media | null {
  const asset = mediaAsset(editor, shape)
  if (!asset) return null
  return { src: asset.props.src, name: asset.props.name, video: asset.type === 'video' }
}

export function generated(editor: Editor): (Media & { id: TLShapeId })[] {
  return editor.store.query.records('shape').get().flatMap((s) => {
    const m = mediaOf(editor, s)
    return m && m.src.includes('type=output') ? [{ ...m, id: s.id }] : []
  }).reverse()
}

export function Preview({ m }: { m: Media }) {
  return m.video ? <video src={m.src} muted preload="metadata" /> : <img src={m.src} alt="" />
}

function typeName(shape: TLShape) {
  if (shape.type === 'ca-shape') return VECTOR_NAMES[(shape.props as { kind: string }).kind] ?? t('sidePanel.shape')
  if (shape.type === GENERATOR) return isVideo((shape.props as { workflow: string }).workflow) ? t('selectionLabel.videoGenerator') : t('selectionLabel.imageGenerator')
  return TYPE_NAMES[shape.type] ?? t('sidePanel.shape')
}

const canContain = (shape: TLShape) => shape.type === 'frame' || shape.type === 'group'
const childrenOf = (editor: Editor, id: TLParentId) => [...editor.getSortedChildIdsForParent(id)].reverse()

function rename(editor: Editor, shape: TLShape, name: string) {
  if (shape.type === 'frame') editor.updateShape<TLFrameShape>({ id: shape.id, type: 'frame', props: { name } })
  else editor.updateShape({ id: shape.id, type: shape.type, meta: { ...shape.meta, name } })
}

function move(editor: Editor, ids: TLShapeId[], target: TLShape, drop: Drop) {
  if (ids.some((id) => id === target.id || editor.hasAncestor(target, id))) return
  if (drop === 'into') {
    const top = editor.getSortedChildIdsForParent(target.id).at(-1)
    editor.reparentShapes(ids, target.id, getIndexBetween(top ? editor.getShape(top)!.index : null, null))
    return
  }
  const siblings = editor.getSortedChildIdsForParent(target.parentId).filter((id) => !ids.includes(id)).map((id) => editor.getShape(id)!)
  const at = siblings.findIndex((s) => s.id === target.id)
  const [below, above] = drop === 'above' ? [siblings[at], siblings[at + 1]] : [siblings[at - 1], siblings[at]]
  editor.reparentShapes(ids, target.parentId, getIndexBetween(below?.index ?? null, above?.index ?? null))
}

interface RowProps {
  editor: Editor
  id: TLShapeId
  depth: number
  names: Map<TLShapeId, string>
  collapsed: Set<TLShapeId>
  onToggle: (id: TLShapeId) => void
  onPick: (id: TLShapeId, e: React.MouseEvent) => void
  dragging: React.MutableRefObject<TLShapeId[]>
}

function Row(p: RowProps) {
  const { editor, id, depth, names, collapsed } = p
  const shape = useValue('layer', () => editor.getShape(id), [editor, id])
  const selected = useValue('layer selected', () => editor.getSelectedShapeIds().includes(id), [editor, id])
  const children = useValue('layer children', () => childrenOf(editor, id), [editor, id])
  const [editing, setEditing] = useState(false)
  const [drop, setDrop] = useState<Drop | null>(null)
  if (!shape) return null
  const media = mediaOf(editor, shape)
  const hidden = !!shape.meta.hidden
  const open = !collapsed.has(id)
  const flag = (patch: Partial<TLShape>) => (e: React.MouseEvent) => {
    e.stopPropagation()
    editor.run(() => editor.updateShape({ id, type: shape.type, ...patch } as TLShape), { ignoreShapeLock: true })
  }
  const zoneOf = (e: React.DragEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    const k = (e.clientY - r.top) / r.height
    return canContain(shape) && k > 0.25 && k < 0.75 ? 'into' : k < 0.5 ? 'above' : 'below'
  }
  return (
    <>
      <div
        className="ca-layer"
        data-on={selected || undefined}
        data-off={hidden || undefined}
        data-drop={drop ?? undefined}
        style={{ paddingLeft: 4 + depth * 16 }}
        draggable={!editing}
        onClick={(e) => p.onPick(id, e)}
        onDoubleClick={() => setEditing(true)}
        onDragStart={(e) => {
          p.dragging.current = selected ? editor.getSelectedShapeIds().filter((s) => editor.getShape(s)) : [id]
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', id)
        }}
        onDragOver={(e) => {
          if (!p.dragging.current.length) return
          e.preventDefault()
          setDrop(zoneOf(e))
        }}
        onDragLeave={() => setDrop(null)}
        onDrop={(e) => {
          e.preventDefault()
          setDrop(null)
          move(editor, p.dragging.current, shape, zoneOf(e))
          p.dragging.current = []
        }}
        onDragEnd={() => { p.dragging.current = [] }}
      >
        <button type="button" className="ca-layer__fold" data-flip={open || undefined} style={{ visibility: children.length ? undefined : 'hidden' }} onClick={(e) => { e.stopPropagation(); p.onToggle(id) }}>
          <span className="ca-icon">{Icons.chevron}</span>
        </button>
        <span className="ca-layer__thumb">{media ? <Preview m={media} /> : <span className="ca-icon">{shape.type === GENERATOR ? Icons.genImage : Icons.layers}</span>}</span>
        {editing ? (
          <input
            className="ca-layer__input"
            autoFocus
            defaultValue={names.get(id)}
            onClick={(e) => e.stopPropagation()}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => {
              const name = e.currentTarget.value.trim()
              if (name && name !== names.get(id)) rename(editor, shape, name)
              setEditing(false)
            }}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (isEnter(e)) e.currentTarget.blur()
              if (e.key === 'Escape') setEditing(false)
            }}
          />
        ) : <span className="ca-layer__name">{names.get(id)}</span>}
        <button type="button" className="ca-layer__act" data-keep={shape.isLocked || undefined} title={shape.isLocked ? t('sidePanel.unlock') : t('sidePanel.lock')} onClick={flag({ isLocked: !shape.isLocked })}>
          <span className="ca-icon">{shape.isLocked ? Icons.lock : Icons.unlock}</span>
        </button>
        <button type="button" className="ca-layer__act" data-keep={hidden || undefined} title={hidden ? t('sidePanel.show') : t('sidePanel.hide')} onClick={flag({ meta: { ...shape.meta, hidden: !hidden } })}>
          <span className="ca-icon">{hidden ? Icons.eyeOff : Icons.eye}</span>
        </button>
      </div>
      {open && children.map((c) => <Row key={c} {...p} id={c} depth={depth + 1} />)}
    </>
  )
}

export function LayerTree({ editor }: { editor: Editor }) {
  const top = useValue('layer roots', () => childrenOf(editor, editor.getCurrentPageId()), [editor])
  const [collapsed, setCollapsed] = useState<Set<TLShapeId>>(new Set())
  const anchor = useRef<TLShapeId | null>(null)
  const dragging = useRef<TLShapeId[]>([])
  const names = useValue('layer names', () => {
    const count: Record<string, number> = {}
    const out = new Map<TLShapeId, string>()
    for (const s of editor.getCurrentPageShapesSorted()) {
      const base = typeName(s)
      count[base] = (count[base] ?? 0) + 1
      out.set(s.id, (s.meta.name as string | undefined) || (s.type === 'frame' && (s.props as { name: string }).name) || mediaOf(editor, s)?.name || `${base} ${count[base]}`)
    }
    return out
  }, [editor])
  const visible = () => {
    const out: TLShapeId[] = []
    const walk = (ids: TLShapeId[]) => ids.forEach((id) => {
      out.push(id)
      if (!collapsed.has(id)) walk(childrenOf(editor, id))
    })
    walk(top)
    return out
  }
  const onToggle = (id: TLShapeId) => {
    const next = new Set(collapsed)
    if (!next.delete(id)) next.add(id)
    setCollapsed(next)
  }
  const onPick = (id: TLShapeId, e: React.MouseEvent) => {
    if (e.shiftKey && anchor.current) {
      const rows = visible()
      const [a, b] = [rows.indexOf(anchor.current), rows.indexOf(id)]
      if (a >= 0 && b >= 0) return editor.select(...rows.slice(Math.min(a, b), Math.max(a, b) + 1))
    }
    anchor.current = id
    if (e.ctrlKey || e.metaKey) {
      const sel = editor.getSelectedShapeIds()
      return editor.select(...(sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id]))
    }
    editor.select(id)
    editor.zoomToSelectionIfOffscreen(64, { animation: { duration: 200 } })
  }
  return <>{top.map((id) => <Row key={id} editor={editor} id={id} depth={0} names={names} collapsed={collapsed} onToggle={onToggle} onPick={onPick} dragging={dragging} />)}</>
}
