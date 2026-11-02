import { useEffect, useState } from 'react'
import { useValue, type Editor } from 'tldraw'

import { errorText } from '../jobs'
import { currentProject } from '../notices'
import { loadSchedules, nextRun, REPEAT_LABELS, runNow, saveSchedules, schedulesAtom, schedulesOpenAtom, WEEKDAYS, type Repeat, type Schedule } from '../schedules'
import { confirmAtom } from './Confirm'
import { Icons } from './icons'
import { Chips } from './Chips'
import { t } from '../i18n'
import { uuid } from '../id'
import { Modal } from './Modal'
import { reportError } from './ErrorToasts'

const today = () => new Date().toLocaleDateString('sv')

function describe(s: Schedule) {
  const when = s.repeat === 'once' ? `${s.date} ${s.time}` : s.repeat === 'daily' ? t('scheduleDialog.daily', s.time) : t('scheduleDialog.weekly', (s.weekdays ?? []).map((d) => WEEKDAYS[d]).join(t('common.listSep')), s.time)
  const next = s.enabled ? nextRun(s) : null
  return `${when}${next ? t('scheduleDialog.nextRun', new Date(next).toLocaleString()) : s.enabled ? '' : t('scheduleDialog.paused')}`
}

function Form({ initial, onDone }: { initial: Schedule; onDone: (s: Schedule | null) => void | Promise<void> }) {
  const [s, setS] = useState(initial)
  const [saving, setSaving] = useState(false)
  const submit = async () => {
    if (saving) return
    setSaving(true)
    try { await onDone({ ...s, name: s.name.trim(), prompt: s.prompt.trim(), enabled: true, lastRun: undefined, created: Date.now() }) }
    catch (e) { reportError(errorText(e)) }
    finally { setSaving(false) }
  }
  const set = (patch: Partial<Schedule>) => setS({ ...s, ...patch })
  const valid = s.name.trim() && s.prompt.trim() && (s.repeat !== 'weekly' || s.weekdays?.length) && (s.repeat !== 'once' || s.date)
  return (
    <div className="ca-rename__body">
      <label className="ca-rename__field">
        <span>{t('referencePanel.name')}</span>
        <input className="ca-panel__input" value={s.name} placeholder={t('scheduleDialog.namePlaceholder')} onChange={(e) => set({ name: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
      </label>
      <label className="ca-rename__field">
        <span>{t('scheduleDialog.whatShouldTheAgentDo')}</span>
        <textarea className="ca-panel__input ca-schedule__prompt" value={s.prompt} placeholder={t('scheduleDialog.promptPlaceholder')} onChange={(e) => set({ prompt: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
      </label>
      <div className="ca-rename__field">
        <span>{t('scheduleDialog.repeat')}</span>
        <Chips value={s.repeat} options={(Object.keys(REPEAT_LABELS) as Repeat[]).map((r) => [r, REPEAT_LABELS[r]] as const)} onPick={(r) => set({ repeat: r })} />
      </div>
      {s.repeat === 'weekly' && (
        <div className="ca-panel__chips">
          {WEEKDAYS.map((d, i) => {
            const on = s.weekdays?.includes(i)
            return <button key={d} type="button" className="ca-panel__chip" data-on={on || undefined} onClick={() => set({ weekdays: on ? s.weekdays!.filter((x) => x !== i) : [...(s.weekdays ?? []), i].sort() })}>{d}</button>
          })}
        </div>
      )}
      <div className="ca-style__row">
        {s.repeat === 'once' && <input type="date" className="ca-panel__input" value={s.date ?? ''} min={today()} onChange={(e) => set({ date: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />}
        <input type="time" className="ca-panel__input" value={s.time} onChange={(e) => set({ time: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
      </div>
      <div className="ca-panel__foot">
        <button type="button" className="ca-panel__secondary" disabled={saving} onClick={() => onDone(null)}>{t('common.cancel')}</button>
        <button type="button" className="ca-panel__primary" disabled={!valid || saving} aria-busy={saving} onClick={() => void submit()}>{t('common.save')}</button>
      </div>
    </div>
  )
}

export function ScheduleDialog({ editor, onError }: { editor: Editor; onError: (msg: string) => void }) {
  const open = useValue(schedulesOpenAtom)
  const schedules = useValue(schedulesAtom)
  const [editing, setEditing] = useState<Schedule | null>(null)
  const fail = (e: unknown) => onError(errorText(e))

  useEffect(() => {
    if (!open) return
    void loadSchedules().catch(fail)
    setEditing(open.prompt ? { id: uuid().slice(0, 8), name: open.prompt.slice(0, 16), prompt: open.prompt, project: currentProject(), repeat: 'daily', time: '09:00', enabled: true, created: Date.now() } : null)
  }, [open])

  if (!open) return null
  const close = () => schedulesOpenAtom.set(null)
  const save = (list: Schedule[]) => void saveSchedules(list).catch(fail)
  const mine = schedules.filter((s) => s.project === currentProject())
  const others = schedules.length - mine.length

  return (
    <Modal title={editing ? t('scheduleDialog.editScheduledTask') : t('composer.scheduledTask')} className="ca-rename ca-memory" onClose={close}>
      {editing && (
        <Form
          key={editing.id}
          initial={editing}
          onDone={async (s) => {
            if (s) await saveSchedules(schedules.some((x) => x.id === s.id) ? schedules.map((x) => (x.id === s.id ? s : x)) : [...schedules, s])
            setEditing(null)
          }}
        />
      )}
      {!editing && (
        <div className="ca-rename__body">
          <div className="ca-chat__hint">{t('scheduleDialog.whenItsTimeThe')}</div>
          <button type="button" className="ca-lib__new" onClick={() => setEditing({ id: uuid().slice(0, 8), name: '', prompt: '', project: currentProject(), repeat: 'daily', time: '09:00', enabled: true, created: Date.now() })}>
            <span className="ca-icon">{Icons.plus}</span>{t('scheduleDialog.newSchedule')}
          </button>
          {mine.length === 0 && <div className="ca-side__empty">{t('scheduleDialog.thisProjectHasNoScheduled')}</div>}
          {mine.map((s) => (
            <div key={s.id} className="ca-memory__row" data-off={!s.enabled || undefined}>
              <span className="ca-icon">{Icons.bell}</span>
              <span className="ca-menu__grow" title={s.prompt}>{s.name}<span className="ca-menu__key"> · {describe(s)}</span></span>
              <button type="button" className="ca-panel__chip" data-on={s.enabled || undefined} onClick={() => save(schedules.map((x) => (x.id === s.id ? (x.enabled ? { ...x, enabled: false } : { ...x, enabled: true, lastRun: undefined, created: Date.now() }) : x)))}>{s.enabled ? t('scheduleDialog.active') : t('scheduleDialog.paused')}</button>
              <button type="button" className="ca-history__del" title={t('scheduleDialog.runNow')} onClick={() => { close(); void runNow(editor, s).catch(fail) }}>{Icons.play}</button>
              <button type="button" className="ca-history__del" title={t('common.edit')} onClick={() => setEditing(s)}>{Icons.textTool}</button>
              <button type="button" className="ca-history__del" title={t('common.delete')} onClick={() => confirmAtom.set({ danger: true, title: t('scheduleDialog.deleteScheduledTask', s.name), desc: t('scheduleDialog.itWillNoLongerRun'), ok: t('common.delete'), run: () => saveSchedules(schedules.filter((x) => x.id !== s.id)) })}>{Icons.trash}</button>
            </div>
          ))}
          {others > 0 && <div className="ca-chat__hint">{t('scheduleDialog.othersHint', others)}</div>}
        </div>
      )}
    </Modal>
  )
}
