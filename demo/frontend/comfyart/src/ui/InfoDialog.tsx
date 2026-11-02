import { atom, useValue, type Editor, type TLShapeId } from 'tldraw'

import { genInfoOf, regenerate, remix } from '../generate'
import { errorText, mediaAsset } from '../jobs'
import { loraLabel, type LoraPick } from '../loras'
import { isVideo, modelOf } from '../models'
import { t } from '../i18n'
import { copyText } from '../clipboard'
import { Modal } from './Modal'

export const infoAtom = atom<TLShapeId | null>('gen info', null)

export function InfoDialog({ editor, onError }: { editor: Editor; onError: (msg: string) => void }) {
  const id = useValue(infoAtom)
  const shape = useValue('info shape', () => (id ? editor.getShape(id) : null), [editor, id])
  if (!id || !shape) return null
  const info = genInfoOf(shape)
  const asset = mediaAsset(editor, shape)
  const close = () => infoAtom.set(null)
  const model = modelOf(info?.workflow ?? '')?.label
  const rows: [string, string | undefined][] = [
    [t('infoDialog.action'), info?.tool],
    [t('agentPicker.model'), model],
    [t('genSettings.aspectRatio'), info?.ratio],
    [t('infoDialog.size'), asset && 'w' in asset.props ? `${asset.props.w} × ${asset.props.h}` : undefined],
    [t('common.duration'), info?.duration && isVideo(info.workflow ?? '') ? `${info.duration}s` : undefined],
    [t('genAdvanced.seed'), info?.seed?.toString()],
    [t('genAdvanced.negativePrompt'), (info?.inputs?.negative as string | undefined) || undefined],
    ['LoRA', (info?.inputs?.loras as LoraPick[] | undefined)?.map((l) => `${loraLabel(l.name)} ${l.strength}%`).join(', ') || undefined],
  ]

  return (
    <Modal title={t('imageToolbar.generationInfo')} onClose={close}>
      <div className="ca-rename__body">
        {!info && <div className="ca-side__empty">{t('infoDialog.thisImageHasNoGeneration')}</div>}
        {info?.prompt && (
          <div className="ca-rename__field">
            <span>{t('infoDialog.prompt')}</span>
            <div className="ca-info__prompt">{info.prompt}</div>
          </div>
        )}
        {info?.refs && <div className="ca-chat__thumbs">{info.refs.map((r) => <img key={r} className="ca-info__ref" src={r} alt="" />)}</div>}
        {rows.filter(([, v]) => v).map(([k, v]) => <div key={k} className="ca-keys__row"><span>{k}</span><span className="ca-menu__key">{v}</span></div>)}
        {info?.prompt && (
          <div className="ca-panel__foot">
            <button type="button" className="ca-panel__secondary" onClick={() => void copyText(info.prompt!).catch((e) => onError(errorText(e)))}>{t('imageToolbar.copyPrompt')}</button>
            <button type="button" className="ca-panel__secondary" onClick={() => { close(); remix(editor, shape) }}>{t('imageToolbar.remix')}</button>
            <button type="button" className="ca-panel__primary" onClick={() => { close(); void regenerate(editor, shape, onError) }}>{t('common.regenerate')}</button>
          </div>
        )}
      </div>
    </Modal>
  )
}
