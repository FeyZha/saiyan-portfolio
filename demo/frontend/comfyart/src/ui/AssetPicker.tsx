import { useEffect, useRef, useState } from 'react'

import { listAssets, type AssetItem } from '../assets'
import { thumbUrl } from '../comfy'
import { errorText } from '../jobs'
import { t } from '../i18n'
import { Icons } from './icons'

const TABS: [string, string][] = [['input,output', t('common.all')], ['output', t('common.generate')], ['input', t('assetPicker.upload')]]

function Thumb({ item }: { item: AssetItem }) {
  const [broken, setBroken] = useState(false)
  if (broken) return <span className="ca-side__missing">{item.kind === 'video' ? Icons.video : Icons.image}</span>
  return <img src={thumbUrl(item.src)} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
}

export function AssetGrid({ onPick, only }: { onPick: (item: AssetItem) => void; only?: AssetItem['kind'] }) {
  const [tab, setTab] = useState(TABS[0][0])
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<AssetItem[] | null>(null)
  const [next, setNext] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const sentinel = useRef<HTMLDivElement>(null)
  const query = useRef(0)

  const load = (after?: string) => {
    const id = query.current
    setLoading(true)
    listAssets(tab, search.trim(), after)
      .then((page) => {
        if (id !== query.current) return
        const list = only ? page.items.filter((i) => i.kind === only) : page.items
        setItems((prev) => (after && prev ? [...prev, ...list] : list))
        setNext(page.next)
      })
      .catch((e) => id === query.current && setError(errorText(e)))
      .finally(() => id === query.current && setLoading(false))
  }

  useEffect(() => {
    query.current += 1
    setItems(null)
    setNext(null)
    setError('')
    const timer = setTimeout(() => load(), 200)
    return () => clearTimeout(timer)
  }, [tab, search, only])

  useEffect(() => {
    if (!next || loading || !sentinel.current) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) load(next)
    }, { rootMargin: '300px' })
    observer.observe(sentinel.current)
    return () => observer.disconnect()
  }, [next, loading])

  return (
    <div className="ca-assets">
      <div className="ca-assets__bar">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" className="ca-panel__chip" data-on={tab === key || undefined} onClick={() => setTab(key)}>{label}</button>
        ))}
        <input className="ca-assets__search" value={search} placeholder={t('assetPicker.search')} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      </div>
      {error && <div className="ca-side__empty">{error}</div>}
      {!error && items === null && <div className="ca-side__empty">{t('assetPicker.loading')}</div>}
      {!error && items?.length === 0 && !next && <div className="ca-side__empty">{t('assetPicker.noAssetsYet')}</div>}
      <div className="ca-assets__grid">
        {items?.map((i) => (
          <button key={i.id} type="button" className="ca-side__cell" title={i.name} onClick={() => onPick(i)}>
            <Thumb item={i} />
            {i.kind === 'video' && <span className="ca-side__badge">{Icons.video}</span>}
          </button>
        ))}
        {next && <div ref={sentinel} className="ca-assets__more" />}
      </div>
    </div>
  )
}
