import { atom } from 'tldraw'

import { readUserJson, writeUserJson } from './comfy'
import { t } from './i18n'
import { uuid } from './id'

export interface Memory { id: string; text: string; time: number; category?: string }
export interface MemoryInput { text: string; category?: string }
export interface MemoryLog { time: number; action: 'add' | 'update' | 'forget' | 'skill'; text: string; source: string }
export interface Correction { old: string; new: string }

export const MEMORY_CATEGORIES: [string, string, string][] = [
  ['about', t('memory.basics'), 'About the user'], ['taste', t('memory.aestheticPreferences'), 'Visual taste'], ['work', t('memory.collaborationStyle'), 'Way of working'], ['assets', t('memory.frequentAssets'), 'Long-term assets'],
]
const CATEGORY_IDS = MEMORY_CATEGORIES.map(([id]) => id)

export function toInputs(value: unknown): MemoryInput[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((v) => {
    const text = typeof v === 'string' ? v : typeof v?.text === 'string' ? v.text : ''
    const category = CATEGORY_IDS.includes(v?.category) ? v.category : undefined
    return text.trim() ? [{ text: text.trim(), category }] : []
  })
}

export function memoryPrompt(): string {
  const memory = memoryAtom.get()
  if (!memory.length) return ''
  const groups = [...MEMORY_CATEGORIES.map(([id, , en]) => [en, memory.filter((m) => m.category === id)] as const), ['Other', memory.filter((m) => !m.category || !CATEGORY_IDS.includes(m.category))] as const]
  return `Remembered about the user (respect these):\n${groups.filter(([, list]) => list.length).map(([en, list]) => `${en}:\n${list.map((m) => `- ${m.text}`).join('\n')}`).join('\n')}`
}

const FILE = 'comfyart/memory.json'
const LOG_FILE = 'comfyart/memory-log.json'

export const memoryAtom = atom<Memory[]>('memory', [])
export const memoryLogAtom = atom<MemoryLog[]>('memory log', [])

export async function loadMemory(): Promise<Memory[]> {
  const [list, log] = await Promise.all([readUserJson<Memory[]>(FILE, []), readUserJson<MemoryLog[]>(LOG_FILE, [])])
  memoryAtom.set(list)
  memoryLogAtom.set(log)
  return list
}

export async function logMemory(entries: Omit<MemoryLog, 'time'>[]) {
  if (!entries.length) return
  const next = [...entries.map((e) => ({ ...e, time: Date.now() })), ...memoryLogAtom.get()]
  memoryLogAtom.set(next)
  await writeUserJson(LOG_FILE, next)
}

const same = (a: string, b: string) => a === b || a.includes(b) || b.includes(a)

export async function forget(texts: string[], source: string): Promise<string[]> {
  const list = await loadMemory()
  const gone = list.filter((m) => texts.some((t) => t.trim() && same(m.text, t.trim())))
  if (!gone.length) return []
  await saveMemory(list.filter((m) => !gone.includes(m)))
  await logMemory(gone.map((m) => ({ action: 'forget' as const, text: m.text, source })))
  return gone.map((m) => m.text)
}

export async function correct(items: Correction[], source: string): Promise<string[]> {
  const list = await loadMemory()
  const done: string[] = []
  const next = list.map((m) => {
    const c = items.find((x) => same(m.text, x.old))
    if (!c) return m
    done.push(`${m.text} → ${c.new}`)
    return { ...m, text: c.new, time: Date.now() }
  })
  if (!done.length) return []
  await saveMemory(next)
  await logMemory(done.map((text) => ({ action: 'update' as const, text, source })))
  return done
}

export async function saveMemory(list: Memory[]) {
  await writeUserJson(FILE, list)
  memoryAtom.set(list)
}

export async function remember(items: MemoryInput[], source = t('botCommands.chat')) {
  const known = new Set((await loadMemory()).map((m) => m.text))
  const fresh = items.filter((m) => !known.has(m.text))
  if (!fresh.length) return
  await saveMemory([...memoryAtom.get(), ...fresh.map((m) => ({ id: uuid().slice(0, 8), text: m.text, time: Date.now(), ...(m.category ? { category: m.category } : {}) }))])
  await logMemory(fresh.map((m) => ({ action: 'add' as const, text: m.text, source })))
}
