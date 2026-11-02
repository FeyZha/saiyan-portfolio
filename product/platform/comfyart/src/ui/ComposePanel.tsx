import { useState } from 'react'
import { useEditor, useValue, type TLFrameShape } from 'tldraw'

import { changesOf, composePrompt, exportLayout } from '../compose'
import { t } from '../i18n'
import { Icons } from './icons'
import { Popover } from './Popover'

export function ComposePanel({ frame }: { frame: TLFrameShape }) {
  const editor = useEditor()
  const [open, setOpen] = useState(false)
  const changes = useValue('board changes', () => (open ? changesOf(editor, frame) : null), [editor, frame, open])
  const prompt = useValue('board prompt', () => (open ? composePrompt(editor, frame) : ''), [editor, frame, open])
  const name = (s: { props: object; type: string }) => {
    const p = s.props as { text?: string; description?: string; url?: string }
    return (p.text || p.description || p.url || s.type).slice(0, 40)
  }
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={({ toggle }) => (
        <button type="button" className="ca-bar__btn ca-bar__btn--icon" title={t('compose.changesAndDetails')} data-open={open || undefined} onClick={toggle}>
          <span className="ca-icon">{Icons.list}</span>
        </button>
      )}
    >
      <div className="ca-menu ca-compose">
        <div className="ca-gen__label">{t('compose.changes')}</div>
        {!changes && <div className="ca-compose__empty">{t('compose.notRenderedYet')}</div>}
        {changes && !changes.added.length && !changes.changed.length && !changes.removed.length && <div className="ca-compose__empty">{t('compose.noChanges')}</div>}
        {changes?.added.map((s) => <div key={s.id} className="ca-compose__row"><span className="ca-compose__tag" data-kind="added">{t('compose.added')}</span>{name(s)}</div>)}
        {changes?.changed.map((s) => <div key={s.id} className="ca-compose__row"><span className="ca-compose__tag" data-kind="changed">{t('compose.changed')}</span>{name(s)}</div>)}
        {changes?.removed.map((label, i) => <div key={i} className="ca-compose__row"><span className="ca-compose__tag" data-kind="removed">{t('compose.removed')}</span>{label}</div>)}
        <div className="ca-gen__label">{t('compose.requestDetails')}</div>
        <pre className="ca-compose__prompt">{prompt}</pre>
        <div className="ca-menu__sep" />
        <button type="button" className="ca-menu__item" onClick={() => { setOpen(false); exportLayout(editor, frame) }}>
          <span className="ca-icon">{Icons.download}</span><span className="ca-menu__grow">{t('compose.exportLayout')}</span>
        </button>
      </div>
    </Popover>
  )
}
