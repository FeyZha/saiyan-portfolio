import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { atom, DefaultToasts, useEditor, useToasts, useValue } from 'tldraw'
import { Modal } from './Modal'

const errorAtom = atom<{ text: string; n: number; severity: 'error' | 'success' } | null>('error', null)
let count = 0

export const reportError = (text: string) => errorAtom.set({ text, n: ++count, severity: 'error' })
export const reportSuccess = (text: string) => errorAtom.set({ text, n: ++count, severity: 'success' })

export function HomeErrors() {
  const error = useValue(errorAtom)
  if (!error || error.severity !== 'error') return null
  return <Modal title="操作未完成" onClose={() => errorAtom.set(null)}><div className="ca-rename__body" role="alert">{error.text}</div></Modal>
}

// Toasts belong to the whole workspace, including the maximized chat and dialogs.
export function WorkspaceToasts() {
  const editor = useEditor()
  const dark = useValue('toast theme', () => editor.user.getIsDarkMode(), [editor])
  return createPortal(<div className={`tl-container ca-toasts tl-theme__${dark ? 'dark' : 'light'}`}><DefaultToasts /></div>, document.body)
}

export function ErrorToasts() {
  const toasts = useToasts()
  const error = useValue(errorAtom)
  useEffect(() => {
    if (!error) return
    const [title, ...rest] = error.text.split('\n')
    toasts.addToast({ id: `error-${error.n}`, title, description: rest.join('\n') || undefined, severity: error.severity })
  }, [error, toasts])
  return null
}
