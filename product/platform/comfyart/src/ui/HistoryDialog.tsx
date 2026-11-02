import { useEffect, useState } from 'react'
import { atom, getSnapshot, loadSnapshot, useValue, type Editor } from 'tldraw'

import { listVersions, loadVersion, saveVersion, type Version } from '../history'
import { errorText } from '../jobs'
import { confirmAtom } from './Confirm'
import { Modal } from './Modal'
import { t, timeAgo } from '../i18n'

export const historyAtom = atom('canvas history', false)

export function HistoryDialog({ editor, projectId, onError }: { editor: Editor; projectId: string; onError: (msg: string) => void }) {
  const open = useValue(historyAtom)
  const [versions, setVersions] = useState<Version[] | null>(null)

  useEffect(() => {
    if (!open) return
    setVersions(null)
    void listVersions(projectId).then(setVersions).catch((e) => onError(errorText(e)))
  }, [open, projectId])

  if (!open) return null
  const close = () => historyAtom.set(false)
  const restore = (v: Version) => confirmAtom.set({
    title: t('historyDialog.restoreThisVersion'),
    desc: t('historyDialog.theCurrentCanvasWillBe'),
    ok: t('historyDialog.restore'),
    run: async () => {
      try {
        await saveVersion(projectId, getSnapshot(editor.store), editor.getCurrentPageShapeIds().size)
        loadSnapshot(editor.store, await loadVersion(projectId, v.time))
        close()
      } catch (e) {
        onError(errorText(e))
      }
    },
  })

  return (
    <Modal title={t('historyDialog.canvasHistory')} onClose={close}>
      <div className="ca-history__list">
        {versions?.length === 0 && <div className="ca-side__empty">{t('historyDialog.noCanvasHistoryYet')}</div>}
        {versions?.map((v) => (
          <div key={v.time} className="ca-history__row">
            <span className="ca-menu__grow">{timeAgo(v.time)}</span>
            <span className="ca-menu__key">{t('historyDialog.elements', v.count)}</span>
            <button type="button" className="ca-panel__secondary" onClick={() => restore(v)}>{t('historyDialog.restore')}</button>
          </div>
        ))}
      </div>
    </Modal>
  )
}
