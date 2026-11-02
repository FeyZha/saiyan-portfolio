import { useState } from 'react'
import { atom, useValue } from 'tldraw'

import { chatIdAtom, chatsAtom, defaultProvider, loadProviders, messagesAtom, newProviderAtom, openChat, providersAtom, saveSettings, settingsAtom, updateChat } from '../bot'
import { errorText } from '../jobs'
import { Icons } from './icons'
import { Popover } from './Popover'
import { t } from '../i18n'

export const botSettingsOpenAtom = atom('bot settings open', false)

export function AgentPicker({ onError }: { onError: (msg: string) => void }) {
  const [open, setOpen] = useState(false)
  const providers = useValue(providersAtom)
  const settings = useValue(settingsAtom)
  const chat = useValue('current chat', () => chatsAtom.get().find((c) => c.id === chatIdAtom.get()) ?? null, [])
  const started = useValue('chat started', () => messagesAtom.get().length > 0, [])
  const pending = useValue(newProviderAtom)
  const providerId = chat?.provider ?? (pending || defaultProvider())
  const provider = providers.find((p) => p.id === providerId)
  const modelKey = `bot-model-${providerId}`
  const model = String(settings[modelKey] ?? '')
  const options = provider?.model_options ?? provider?.models.map((m) => ({ value: m, label: m, group: '' })) ?? []
  const fail = (e: unknown) => onError(errorText(e))

  const pick = (id: string) => {
    newProviderAtom.set(id)
    void saveSettings({ 'bot-provider': id }).catch(fail)
    if (chat && started) void openChat(null)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => { setOpen(o); if (o) void loadProviders().catch(fail) }}
      side="top"
      trigger={({ open: o, toggle }) => (
        <button type="button" className="ca-bar__btn ca-composer__mode" title={t('agentPicker.selectAgent')} data-open={o || undefined} onClick={toggle}>
          <span className="ca-menu__grow">{provider?.label ?? t('agentPicker.selectAgent')}</span><span className="ca-icon">{Icons.chevron}</span>
        </button>
      )}
    >
      <div className="ca-menu ca-agentpick">
        <div className="ca-gen__title">Agent</div>
        {providers.map((p) => (
          <button key={p.id} type="button" className="ca-menu__item" disabled={!p.available} title={p.detail || p.version} onClick={() => pick(p.id)}>
            <span className="ca-menu__grow">{p.label}{!p.available && <span className="ca-menu__key"> {t('agentPicker.unavailable')}</span>}</span>
            {p.id === providerId && <span className="ca-icon">{Icons.check}</span>}
          </button>
        ))}
        {provider && !provider.available && provider.detail && <div className="ca-chat__hint">{provider.detail}</div>}
        {chat && started && <div className="ca-chat__hint">{t('agentPicker.switchingAgentStartsANew')}</div>}
        {options.length > 0 && (
          <>
            <div className="ca-menu__sep" />
            <div className="ca-gen__title">{t('agentPicker.model')}</div>
            <select className="ca-panel__input" value={model} onChange={(e) => void saveSettings({ [modelKey]: e.target.value }).catch(fail)}>
              <option value="">{t('common.default')}</option>
              {options.map((o) => <option key={o.value} value={o.value}>{o.group ? `${o.group} · ` : ''}{o.label}</option>)}
            </select>
          </>
        )}
        <div className="ca-menu__sep" />
        <label className="ca-notice__push">
          <input
            type="checkbox"
            checked={chat?.run_mode === 'ask'}
            disabled={!chat}
            onChange={(e) => chat && void updateChat(chat.id, { run_mode: e.target.checked ? 'ask' : 'auto' }).catch(fail)}
          />
          <span>{t('agentPicker.askBeforeGenerating', chat ? '' : t('agentPicker.availableAfterTheFirstMessage'))}</span>
        </label>
        <button type="button" className="ca-menu__item" onClick={() => { setOpen(false); botSettingsOpenAtom.set(true) }}>
          <span className="ca-icon">{Icons.adjust}</span><span className="ca-menu__grow">{t('agentPicker.agentSettings')}</span>
        </button>
      </div>
    </Popover>
  )
}
