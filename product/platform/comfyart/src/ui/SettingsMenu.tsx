import { useState, type ReactNode } from 'react'
import { useValue, type Editor } from 'tldraw'

import { saveSettings, settingsAtom } from '../bot'
import { freeMemory } from '../comfy'
import { lang, setLang, t, type Lang } from '../i18n'
import { errorText } from '../jobs'
import { instancesAtom, instanceStatusAtom, loadInstances, targetOptions } from '../instances'
import { pushEnabled, setPush } from '../notices'
import { saveTheme, themeAtom, THEMES } from '../theme'
import { dockAtom, setDock } from './chatDock'
import { reportError, reportSuccess } from './ErrorToasts'
import { Icons } from './icons'
import { InstancesDialog } from './InstancesDialog'
import { Popover } from './Popover'
import { shortcutsAtom } from './Shortcuts'

const LANGS: [Lang, string][] = [['zh', t('settings.langZh')], ['en', t('settings.langEn')]]
const SIDES: ['left' | 'right', string][] = [['left', t('settings.chatLeft')], ['right', t('settings.chatRight')]]

function Choice({ label, hint, on, onPick }: { label: string; hint?: string; on: boolean; onPick: () => void }) {
  return (
    <button type="button" className="ca-menu__item" onClick={onPick}>
      <span className="ca-menu__grow">{label}</span>{hint && <span className="ca-menu__key">{hint}</span>}{on && <span className="ca-icon">{Icons.check}</span>}
    </button>
  )
}

export function SettingsMenu({ editor, trigger }: { editor?: Editor; trigger: (props: { open: boolean; toggle: () => void }) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const [push, setPushOn] = useState(pushEnabled)
  const theme = useValue(themeAtom)
  const dock = useValue(dockAtom)
  const [manage, setManage] = useState(false)
  const settings = useValue(settingsAtom)
  const instances = useValue(instancesAtom)
  const targets = targetOptions(instances, useValue(instanceStatusAtom))
  const cloud = settings['generation-backend'] === 'cloud'
  const target = targets.length > 2 ? (targets.find(([id]) => id === settings['generation-target'])?.[0] ?? 'auto') : 'local'
  const toggle = (next: boolean) => {
    setOpen(next)
    if (next) void loadInstances().catch(() => {})
  }
  return (
    <>
      <Popover open={open} onOpenChange={toggle} side={editor ? 'bottom' : 'top'} align={editor ? 'end' : 'start'} trigger={trigger}>
        <div className="ca-menu ca-settings">
          <div className="ca-gen__label">{t('settings.language')}</div>
          {LANGS.map(([value, label]) => <Choice key={value} label={label} on={lang === value} onPick={() => value !== lang && setLang(value)} />)}
          <div className="ca-menu__sep" />
          <div className="ca-gen__label">{t('projectHeader.theme')}</div>
          {THEMES.map(([value, label]) => <Choice key={value} label={label} on={theme === value} onPick={() => { try { saveTheme(value) } catch (e) { reportError(errorText(e)) } }} />)}
          <div className="ca-menu__sep" />
          <div className="ca-gen__label">{t('settings.backend')}</div>
          {(targets.length > 2 ? targets : targets.filter(([id]) => id === 'local')).map(([id, label, hint]) => (
            <Choice key={id} label={label} hint={hint} on={!cloud && target === id} onPick={() => void saveSettings({ 'generation-backend': 'local', 'generation-target': id }).catch((e) => reportError(errorText(e)))} />
          ))}
          <Choice label={t('settings.backendCloud')} on={cloud} onPick={() => void saveSettings({ 'generation-backend': 'cloud' }).catch((e) => reportError(errorText(e)))} />
          <button type="button" className="ca-menu__item" onClick={() => { setOpen(false); setManage(true) }}>
            <span className="ca-icon">{Icons.settings}</span><span className="ca-menu__grow">{t('settings.manageInstances')}</span>
          </button>
          {editor && (
            <button type="button" className="ca-menu__item" onClick={() => { setOpen(false); void freeMemory().then((busy) => reportSuccess(t(busy ? 'settings.freeMemoryQueued' : 'settings.freeMemoryDone')), (e) => reportError(errorText(e))) }}>
              <span className="ca-icon">{Icons.erase}</span><span className="ca-menu__grow">{t('settings.freeMemory')}</span>
            </button>
          )}
          {editor && (
            <>
              <div className="ca-menu__sep" />
              <div className="ca-gen__label">{t('settings.chatPosition')}</div>
              {SIDES.map(([value, label]) => <Choice key={value} label={label} on={dock === value} onPick={() => setDock(value)} />)}
              <div className="ca-menu__sep" />
              <button type="button" className="ca-menu__item" onClick={() => { setOpen(false); shortcutsAtom.set(true) }}>
                <span className="ca-icon">{Icons.keyboard}</span><span className="ca-menu__grow">{t('shortcuts.keyboardShortcuts')}</span><span className="ca-menu__key">?</span>
              </button>
              <label className="ca-menu__item">
                <span className="ca-icon">{Icons.bell}</span><span className="ca-menu__grow">{t('settings.systemNotifications')}</span>
                <input type="checkbox" checked={push} onChange={(e) => void setPush(e.target.checked).then(setPushOn)} />
              </label>
            </>
          )}
        </div>
      </Popover>
      {manage && <InstancesDialog onClose={() => setManage(false)} />}
    </>
  )
}
