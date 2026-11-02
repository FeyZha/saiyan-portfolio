import { useEffect, useState } from 'react'
import { useValue } from 'tldraw'

import { t } from '../i18n'
import { addInstance, instancesAtom, instanceState, instanceStatusAtom, loadInstances, removeInstance, updateInstance } from '../instances'
import { Icons } from './icons'
import { Modal } from './Modal'

export function InstancesDialog({ onClose }: { onClose: () => void }) {
  const instances = useValue(instancesAtom)
  const statuses = useValue(instanceStatusAtom)
  const [label, setLabel] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState(8188)
  const [error, setError] = useState('')

  useEffect(() => { loadInstances().catch((e) => setError(String(e))) }, [])

  const run = (task: Promise<unknown>) => task.then(() => setError('')).catch((e) => setError(e instanceof Error ? e.message : String(e)))
  const add = () => run(addInstance({ label, host, port }).then(() => { setLabel(''); setHost('') }))
  const stop = (e: React.KeyboardEvent) => { e.stopPropagation(); if (e.key === 'Enter' && host.trim()) void add() }

  return (
    <Modal title={t('instances.title')} className="ca-rename ca-instances" onClose={onClose}>
      <div className="ca-rename__body">
        <div className="ca-chat__hint">{t('instances.hint')}</div>
        {instances.map((inst) => (
          <div key={inst.id} className="ca-instances__row">
            <div className="ca-instances__name">
              <span>{inst.label}</span>
              <span className="ca-chat__hint">{inst.host}:{inst.port} · {inst.enabled ? instanceState(statuses[inst.id]) : t('instances.disabled')}</span>
            </div>
            <label className="ca-instances__toggle">
              <input type="checkbox" checked={inst.enabled} onChange={(e) => void run(updateInstance(inst.id, { enabled: e.target.checked }))} />
              {t('instances.enabled')}
            </label>
            <button type="button" className="ca-panel__icon" title={t('common.delete')} onClick={() => void run(removeInstance(inst.id))}>{Icons.trash}</button>
          </div>
        ))}
        <div className="ca-instances__add">
          <input className="ca-panel__input" value={label} placeholder={t('instances.name')} onChange={(e) => setLabel(e.target.value)} onKeyDown={stop} />
          <input className="ca-panel__input" value={host} placeholder="192.168.0.140" onChange={(e) => setHost(e.target.value)} onKeyDown={stop} />
          <input className="ca-panel__input" type="number" min={1} max={65535} value={port} onChange={(e) => setPort(Number(e.target.value) || 8188)} onKeyDown={stop} />
        </div>
        {error && <div className="ca-instances__error">{error}</div>}
        <div className="ca-panel__foot">
          <button type="button" className="ca-panel__secondary" onClick={() => void run(loadInstances())}>{t('instances.refresh')}</button>
          <button type="button" className="ca-panel__primary" disabled={!host.trim()} onClick={() => void add()}>{t('instances.add')}</button>
        </div>
      </div>
    </Modal>
  )
}
