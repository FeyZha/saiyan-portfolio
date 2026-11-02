export function Chips<T extends string | number>({ value, options, onPick, gen = false }: { value: T; options: readonly (readonly [T, string])[]; onPick: (v: T) => void; gen?: boolean }) {
  const chip = gen ? 'ca-gen__chip' : 'ca-panel__chip'
  return (
    <div className={gen ? 'ca-gen__chips' : 'ca-panel__chips'}>
      {options.map(([v, label]) => <button key={String(v)} type="button" className={chip} data-on={value === v || undefined} onClick={() => onPick(v)}>{label}</button>)}
    </div>
  )
}
