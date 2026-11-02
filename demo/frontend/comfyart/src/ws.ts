import { uuid } from './id'

type Handler = (data: any) => void

const handlers = new Map<string, Set<Handler>>()
const RETRY_MS = 2000
let socket: WebSocket | null = null
let opened = false

export const CLIENT_ID = uuid()
const RECONNECTED = 'comfyart:reconnected'

function connect() {
  const url = new URL('/ws', location.href)
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('clientId', CLIENT_ID)
  socket = new WebSocket(url)
  socket.onopen = () => {
    if (opened) for (const h of handlers.get(RECONNECTED) ?? []) h(null)
    opened = true
  }
  socket.onmessage = (e) => {
    if (typeof e.data !== 'string') return
    let msg: { type?: string; data?: unknown }
    try { msg = JSON.parse(e.data) } catch { return }
    for (const h of handlers.get(msg.type ?? '') ?? []) h(msg.data)
  }
  socket.onclose = () => {
    socket = null
    setTimeout(connect, RETRY_MS)
  }
}

export function onComfyEvent(type: string, handler: Handler): () => void {
  if (!socket) connect()
  if (!handlers.has(type)) handlers.set(type, new Set())
  handlers.get(type)!.add(handler)
  return () => handlers.get(type)!.delete(handler)
}

export const onReconnect = (handler: () => void) => onComfyEvent(RECONNECTED, handler)
