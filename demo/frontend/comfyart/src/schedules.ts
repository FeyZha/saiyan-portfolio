import { atom, type Editor } from 'tldraw'

import { errorText } from './jobs'
import { sendToAgent } from './agent'
import { chatIdAtom, chatsAtom, openChat } from './bot'
import { readUserJson, writeUserJson } from './comfy'
import type { ErrorSink } from './jobs'
import { currentProject, notify } from './notices'
import { t } from './i18n'

export type Repeat = 'once' | 'daily' | 'weekly'
export interface Schedule { id: string; name: string; prompt: string; project: string; repeat: Repeat; time: string; date?: string; weekdays?: number[]; enabled: boolean; created: number; lastRun?: number }

const FILE = 'comfyart/schedules.json'
const TICK = 30000
const DAY = 86400000
const channel = new BroadcastChannel('comfyart-schedules')

export const schedulesAtom = atom<Schedule[]>('schedules', [])
export const schedulesOpenAtom = atom<{ prompt?: string } | null>('schedules open', null)
export const REPEAT_LABELS: Record<Repeat, string> = { once: t('schedules.once'), daily: t('schedules.daily'), weekly: t('schedules.weekly') }
export const WEEKDAYS = [t('schedules.sun'), t('schedules.mon'), t('schedules.tue'), t('schedules.wed'), t('schedules.thu'), t('schedules.fri'), t('schedules.sat')]

const read = () => readUserJson<Schedule[]>(FILE, [])

export async function loadSchedules() {
  const list = await read()
  schedulesAtom.set(list)
  return list
}

export async function saveSchedules(list: Schedule[]) {
  await writeUserJson(FILE, list)
  schedulesAtom.set(list)
  channel.postMessage('changed')
}

channel.onmessage = () => void loadSchedules()

function at(day: Date, time: string) {
  const [h, m] = time.split(':').map(Number)
  const d = new Date(day)
  d.setHours(h, m, 0, 0)
  return d.getTime()
}

export function nextRun(s: Schedule): number | null {
  if (s.repeat === 'once') return s.lastRun || !s.date ? null : at(new Date(`${s.date}T00:00`), s.time)
  const from = s.lastRun ?? s.created
  const days = s.repeat === 'weekly' ? s.weekdays ?? [] : [0, 1, 2, 3, 4, 5, 6]
  for (let i = 0; i <= 7; i++) {
    const t = at(new Date(from + i * DAY), s.time)
    if (t > from && days.includes(new Date(t).getDay())) return t
  }
  return null
}

async function run(editor: Editor, s: Schedule) {
  await openChat(null)
  await sendToAgent(editor, s.prompt, [], null)
  void notify({ kind: 'schedule', title: t('schedules.scheduledTaskStarted', s.name), body: s.prompt, chat: chatIdAtom.get() ?? undefined })
}

export async function runNow(editor: Editor, s: Schedule) {
  await saveSchedules(schedulesAtom.get().map((x) => (x.id === s.id ? { ...x, lastRun: Date.now() } : x)))
  await run(editor, s)
}

export function startScheduler(editor: Editor, onError: ErrorSink) {
  let busy = false
  const tick = async () => {
    if (busy || chatsAtom.get().some((c) => c.busy)) return
    busy = true
    try {
      const now = Date.now()
      const list = schedulesAtom.get()
      const due = list.find((s) => s.enabled && s.project === currentProject() && (nextRun(s) ?? Infinity) <= now)
      if (!due) return
      await saveSchedules(list.map((s) => (s.id === due.id ? { ...s, lastRun: now, enabled: s.repeat !== 'once' && s.enabled } : s)))
      await run(editor, due)
    } catch (e) {
      onError(errorText(e))
    } finally {
      busy = false
    }
  }
  void loadSchedules().then(tick, (e) => onError(errorText(e)))
  const timer = window.setInterval(() => void tick(), TICK)
  return () => clearInterval(timer)
}
