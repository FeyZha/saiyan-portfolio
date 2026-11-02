import { useEffect, useState } from 'react'
import { useValue } from 'tldraw'

import { botEnabledAtom, saveSettings, settingsAtom, type BotSettings } from '../bot'
import { errorText } from '../jobs'
import { ABILITY_SETTINGS, runsToday, type Ability } from '../proactive'
import { botSettingsOpenAtom } from './AgentPicker'
import { Chips } from './Chips'
import { t } from '../i18n'

const DAILY_CHOICES = [1, 3, 5, 10, 20]

const ABILITIES: [Ability, string, string][] = [
  ['memory', t('abilities.memoryTitle'), t('abilities.memoryDesc')],
  ['review', t('abilities.reviewTitle'), t('abilities.reviewDesc')],
  ['skills', t('abilities.skillsTitle'), t('abilities.skillsDesc')],
]

function Switch({ on, disabled, onChange }: { on: boolean; disabled?: boolean; onChange: (on: boolean) => void }) {
  return <button type="button" className="ca-switch" role="switch" aria-checked={on} data-on={on || undefined} disabled={disabled} onClick={() => onChange(!on)}><span /></button>
}

export function AbilitiesPanel({ onError }: { onError: (msg: string) => void }) {
  const settings = useValue(settingsAtom)
  const bot = useValue(botEnabledAtom)
  const [runs, setRuns] = useState<Partial<Record<Ability, number>>>({})
  const daily = Number(settings['proactive-daily']) || 0
  const memoryOn = settings['memory-enabled'] !== false
  const save = (patch: BotSettings) => void saveSettings(patch).catch((e) => onError(errorText(e)))

  useEffect(() => { void runsToday().then(setRuns) }, [])

  return (
    <>
      <div className="ca-memory__row ca-ability">
        <span className="ca-menu__grow"><b>{t('abilities.useMemory')}</b><span className="ca-chat__hint">{t('abilities.useMemoryDesc')}</span></span>
        <Switch on={memoryOn} onChange={(on) => save({ 'memory-enabled': on })} />
      </div>
      {!bot && (
        <div className="ca-chat__hint">
          {t('abilities.needsAgent')} <button type="button" className="ca-panel__chip" onClick={() => botSettingsOpenAtom.set(true)}>{t('agentPanel.openAgentSettings')}</button>
        </div>
      )}
      {ABILITIES.map(([id, title, desc]) => {
        const on = settings[ABILITY_SETTINGS[id]] === true
        return (
          <div key={id} className="ca-memory__row ca-ability">
            <span className="ca-menu__grow">
              <b>{title}</b>
              <span className="ca-chat__hint">{desc}</span>
              {on && <span className="ca-chat__hint">{t('abilities.runsToday', runs[id] ?? 0, daily)}</span>}
            </span>
            <Switch on={on} disabled={!bot || (id === 'memory' && !memoryOn)} onChange={(v) => save({ [ABILITY_SETTINGS[id]]: v })} />
          </div>
        )
      })}
      <div className="ca-memory__row ca-ability">
        <span className="ca-menu__grow"><b>{t('abilities.dailyRuns')}</b></span>
        <Chips value={daily} options={DAILY_CHOICES.map((n) => [n, String(n)] as const)} onPick={(n) => save({ 'proactive-daily': n })} />
      </div>
    </>
  )
}
