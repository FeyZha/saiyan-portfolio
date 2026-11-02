import type { ReactNode } from 'react'

import { useEscape } from './escape'
import { Icons } from './icons'
import { t } from '../i18n'

export function Modal({ title, className = 'ca-rename', onClose, children }: { title: ReactNode; className?: string; onClose: () => void; children: ReactNode }) {
  useEscape(true, onClose)
  return (
    <div className="ca-modal" onPointerDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose() }}>
      <div className={['ca-modal__card', className].filter(Boolean).join(' ')}>
        <div className="ca-side__head">
          <span>{title}</span>
          <button type="button" className="ca-panel__icon" title={t('common.close')} onClick={onClose}>{Icons.close}</button>
        </div>
        {children}
      </div>
    </div>
  )
}
