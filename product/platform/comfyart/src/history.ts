import type { TLEditorSnapshot } from 'tldraw'

import { call } from './projects'

const INTERVAL = 5 * 60 * 1000

export interface Version { time: number; count: number }

const versions = (id: string, rest = '') => `/comfyart/projects/${encodeURIComponent(id)}/versions${rest}`
let last = 0

export async function listVersions(id: string): Promise<Version[]> {
  return (await call<{ versions: Version[] }>(versions(id)))?.versions ?? []
}

export async function saveVersion(id: string, snapshot: TLEditorSnapshot, count: number) {
  last = Date.now()
  await call(versions(id), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ snapshot, count }) })
}

export function maybeSaveVersion(id: string, snapshot: () => TLEditorSnapshot, count: number) {
  if (Date.now() - last < INTERVAL) return
  void saveVersion(id, snapshot(), count)
}

export async function loadVersion(id: string, time: number): Promise<TLEditorSnapshot> {
  const snapshot = await call<TLEditorSnapshot>(versions(id, `/${time}`))
  if (!snapshot) throw new Error(`version ${time} not found`)
  return snapshot
}
