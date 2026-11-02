import { atom, useValue } from 'tldraw'
import { useState } from 'react'
import { createPortal } from 'react-dom'

import { Modal } from './Modal'
import { t } from '../i18n'
import { reportError } from './ErrorToasts'
import { errorText } from '../jobs'

interface Ask { title: string; desc: string; ok: string; danger?: boolean; run: () => unknown }

export const confirmAtom = atom<Ask | null>('confirm', null)

export function Confirm() {
  const ask = useValue(confirmAtom)
  const [busy, setBusy] = useState(false)
  if (!ask) return null
  const close = () => { if (!busy) confirmAtom.set(null) }
  const run = async () => {
    if (busy) return
    setBusy(true)
    try { await ask.run(); confirmAtom.set(null) }
    catch (e) { reportError(errorText(e)) }
    finally { setBusy(false) }
  }
  return createPortal(
    <Modal title={ask.title} onClose={close}>
      <div className="ca-rename__body">
        <div>{ask.desc}</div>
        <div className="ca-panel__foot">
          <button type="button" className="ca-panel__secondary" disabled={busy} onClick={close}>{t('common.cancel')}</button>
          <button type="button" disabled={busy} aria-busy={busy} className={ask.danger ? 'ca-panel__primary ca-panel__danger' : 'ca-panel__primary'} onClick={() => void run()}>{ask.ok}</button>
        </div>
      </div>
    </Modal>, document.body
  )
}
