import { useEffect, useRef } from 'react'

const stack: (() => void)[] = []

function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !stack.length) return
  e.stopPropagation()
  stack.at(-1)!()
}

function pushEscape(close: () => void) {
  stack.push(close)
  if (stack.length === 1) document.addEventListener('keydown', onKey, true)
  return () => {
    stack.splice(stack.lastIndexOf(close), 1)
    if (!stack.length) document.removeEventListener('keydown', onKey, true)
  }
}

export function useEscape(active: boolean, close: () => void) {
  const latest = useRef(close)
  latest.current = close
  useEffect(() => (active ? pushEscape(() => latest.current()) : undefined), [active])
}
