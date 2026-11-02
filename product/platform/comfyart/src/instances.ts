import { atom } from 'tldraw'

import { api, LAN_ID, setLan } from './comfy'
import { t } from './i18n'

export interface Instance { id: string; label: string; host: string; port: number; enabled: boolean }
export interface InstanceStatus { id: string; online: boolean; queue?: number; models?: string[]; error?: string }
export type InstanceFields = Partial<Omit<Instance, 'id'>>

export const instancesAtom = atom<Instance[]>('lan instances', [])
export const instanceStatusAtom = atom<Record<string, InstanceStatus>>('lan instance status', {})

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await api(path, init)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error?.message ?? body.error ?? `${path} failed: ${res.status}`)
  return body as T
}

const send = (body: unknown, method: string): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export async function refreshInstanceStatus() {
  const { statuses } = await json<{ statuses: InstanceStatus[] }>('/comfyart/instances/status')
  instanceStatusAtom.set(Object.fromEntries(statuses.map((s) => [s.id, s])))
}

export async function loadInstances() {
  const { instances } = await json<{ instances: Instance[] }>('/comfyart/instances')
  setLan(instances.filter((i) => i.enabled).map((i) => i.id))
  instancesAtom.set(instances)
  await refreshInstanceStatus()
}

export async function addInstance(fields: InstanceFields) {
  await json('/comfyart/instances', send(fields, 'POST'))
  await loadInstances()
}

export async function updateInstance(id: string, fields: InstanceFields) {
  await json(`/comfyart/instances/${id}`, send(fields, 'PATCH'))
  await loadInstances()
}

export async function removeInstance(id: string) {
  await json(`/comfyart/instances/${id}`, { method: 'DELETE' })
  await loadInstances()
}

export type TargetOption = [id: string, label: string, hint?: string]

export function instanceState(status: InstanceStatus | undefined): string {
  if (!status) return t('instances.disabled')
  return status.online ? t('instances.online', status.queue ?? 0) : t('instances.offline')
}

export function targetOptions(instances: Instance[], statuses: Record<string, InstanceStatus>): TargetOption[] {
  return [
    ['auto', t('runOn.auto')],
    ['local', t('settings.backendLocal')],
    ...instances.filter((i) => i.enabled).map((i): TargetOption => [i.id, i.label, instanceState(statuses[i.id])]),
  ]
}

export function lanHas(files: string[], runOn: string): boolean {
  const statuses = Object.values(instanceStatusAtom.get()).filter((s) => s.online && (runOn === 'auto' || s.id === runOn))
  return files.length > 0 && statuses.some((s) => files.every((f) => s.models?.includes(f)))
}

export function runsOn(jobId: string): string {
  if (!jobId.startsWith(LAN_ID)) return t('settings.backendLocal')
  const id = jobId.slice(LAN_ID.length).split(':')[0]
  return instancesAtom.get().find((i) => i.id === id)?.label ?? id
}
