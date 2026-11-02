import type { JSONContent } from '@tiptap/core'
import { Color, FontFamily, FontSize, TextStyle } from '@tiptap/extension-text-style'
import { EditorContent, useEditor, type Editor as RichEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, type CSSProperties } from 'react'
import { atom } from 'tldraw'

export type RichDoc = JSONContent

export const richEditorAtom = atom<RichEditor | null>('rich text editor', null)
export const richVersionAtom = atom('rich text version', 0)

const EXTENSIONS = [
  StarterKit.configure({ heading: false, blockquote: false, codeBlock: false, code: false, horizontalRule: false, bulletList: false, orderedList: false, listItem: false, listKeymap: false, link: false, trailingNode: false }),
  TextStyle,
  Color,
  FontFamily,
  FontSize,
]

export function docFromText(text: string): RichDoc {
  return { type: 'doc', content: text.split('\n').map((line) => ({ type: 'paragraph', ...(line ? { content: [{ type: 'text', text: line }] } : {}) })) }
}

export function plainOf(doc: RichDoc): string {
  return (doc.content ?? []).map((p) => (p.content ?? []).map((n) => (n.type === 'hardBreak' ? '\n' : n.text ?? '')).join('')).join('\n')
}

export const hasMarks = (doc: RichDoc) => (doc.content ?? []).some((p) => (p.content ?? []).some((n) => n.marks?.some((m) => m.type !== 'textStyle' || Object.values(m.attrs ?? {}).some((v) => v != null))))

function markStyle(marks: JSONContent['marks']): CSSProperties {
  const style: CSSProperties = {}
  for (const m of marks ?? []) {
    if (m.type === 'bold') style.fontWeight = 700
    if (m.type === 'italic') style.fontStyle = 'italic'
    if (m.type === 'underline') style.textDecoration = [style.textDecoration, 'underline'].filter(Boolean).join(' ')
    if (m.type === 'strike') style.textDecoration = [style.textDecoration, 'line-through'].filter(Boolean).join(' ')
    if (m.type === 'textStyle') {
      if (m.attrs?.color) style.color = m.attrs.color
      if (m.attrs?.fontFamily) style.fontFamily = m.attrs.fontFamily
      if (m.attrs?.fontSize) style.fontSize = m.attrs.fontSize
    }
  }
  return style
}

export function RichView({ doc }: { doc: RichDoc }) {
  return (
    <>
      {(doc.content ?? []).map((p, i) => (
        <div key={i}>
          {p.content?.length
            ? p.content.map((n, j) => (n.type === 'hardBreak' ? <br key={j} /> : <span key={j} style={markStyle(n.marks)}>{n.text}</span>))
            : '​'}
        </div>
      ))}
    </>
  )
}

export function RichInput({ doc, style, onChange, onExit }: { doc: RichDoc; style: CSSProperties; onChange: (doc: RichDoc) => void; onExit: () => void }) {
  const rich = useEditor({
    extensions: EXTENSIONS,
    content: doc,
    autofocus: 'all',
    onUpdate: ({ editor }) => onChange(editor.getJSON()),
    onTransaction: () => richVersionAtom.update((v) => v + 1),
    editorProps: {
      handleKeyDown: (_, e) => {
        e.stopPropagation()
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          onExit()
          return true
        }
        return false
      },
    },
  })
  useEffect(() => {
    richEditorAtom.set(rich)
    return () => { richEditorAtom.set(null) }
  }, [rich])
  return <EditorContent editor={rich} className="ca-text__input ca-text__rich" style={style} onPointerDown={(e) => e.stopPropagation()} />
}
