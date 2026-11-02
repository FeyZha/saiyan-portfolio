import { useState } from 'react'
import type { TLShapeId } from 'tldraw'

import type { RefShape } from '../agent'
import { Icons } from './icons'
import { t } from '../i18n'

export function useEach() {
  const [on, setOn] = useState(false)
  const [shared, setShared] = useState<TLShapeId[]>([])
  return {
    on,
    setOn,
    isShared: (id: TLShapeId) => shared.includes(id),
    toggleShared: (id: TLShapeId) => setShared((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])),
    targets: (refs: RefShape[]) => (on ? refs.filter((r) => !shared.includes(r.id)) : []),
    reset: () => { setOn(false); setShared([]) },
  }
}

export function EachButton({ on, onChange, compact }: { on: boolean; onChange: (on: boolean) => void; compact?: boolean }) {
  return (
    <button type="button" className={`ca-bar__btn ca-each${compact ? ' ca-bar__btn--icon' : ''}`} data-on={on || undefined} title={`${t('each.label')}: ${t('each.hint')}`} onClick={() => onChange(!on)}>
      <span className="ca-icon">{Icons.grid}</span>{!compact && <span>{t('each.label')}</span>}
    </button>
  )
}

export function EachRole({ shared, onToggle }: { shared: boolean; onToggle: () => void }) {
  return <button type="button" className="ca-each__role" data-shared={shared || undefined} title={t('each.roleHint')} onClick={onToggle}>{shared ? t('each.shared') : t('each.perItem')}</button>
}
