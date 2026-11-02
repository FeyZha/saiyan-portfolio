import { useEffect, useState, type ReactNode } from 'react'

import { alphaOf } from '../palette'
import { Popover } from './Popover'
import { t } from '../i18n'
import { isEnter } from './keys'

const SWATCHES = ['#000000', '#FFFFFF', '#F5F5F5', '#9E9E9E', '#424242', '#E53935', '#FB8C00', '#FDD835', '#43A047', '#1E88E5', '#8E24AA', '#EC407A']

const valid = (v: string) => /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v)
const rgbOf = (v: string) => v.slice(0, 7).toUpperCase()
const withAlpha = (rgb: string, a: number) => (a >= 1 ? rgb : `${rgb}${Math.round(a * 255).toString(16).padStart(2, '0').toUpperCase()}`)

export function ColorPicker({ value, onChange, title, trigger, allowNone, alpha }: {
  value: string
  onChange: (v: string) => void
  title: string
  trigger?: (props: { open: boolean; toggle: () => void }) => ReactNode
  allowNone?: boolean
  alpha?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [hex, setHex] = useState(value)
  useEffect(() => setHex(value), [value])
  const a = alphaOf(value)
  const set = (v: string) => { if (!v || valid(v)) onChange(alpha ? withAlpha(rgbOf(v), v.length === 9 ? alphaOf(v) : a) : rgbOf(v)) }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="top"
      trigger={trigger ?? (({ open: o, toggle }) => (
        <button type="button" className="ca-bar__btn ca-bar__btn--icon" title={title} data-open={o || undefined} onClick={toggle}>
          <span className="ca-tools__dot" data-none={!value || undefined} style={{ background: value || undefined }} />
        </button>
      ))}
    >
      <div className="ca-menu ca-bg">
        <div className="ca-gen__title">{title}</div>
        <div className="ca-bg__swatches ca-bg__swatches--wrap">
          {allowNone && <button type="button" className="ca-bg__swatch ca-bg__none" title={t('common.none')} data-on={!value || undefined} onClick={() => onChange('')} />}
          {SWATCHES.map((c) => (
            <button key={c} type="button" className="ca-bg__swatch" data-on={rgbOf(value) === c || undefined} style={{ background: c }} onClick={() => set(c)} />
          ))}
          <label className="ca-bg__swatch ca-bg__custom" title={t('common.custom')}>
            <input type="color" value={valid(value) ? rgbOf(value).toLowerCase() : '#000000'} onChange={(e) => set(e.target.value)} />
          </label>
        </div>
        <label className="ca-bg__hex">
          <span>#</span>
          <input
            value={hex.replace('#', '')}
            maxLength={alpha ? 8 : 6}
            onChange={(e) => setHex(`#${e.target.value}`)}
            onBlur={() => set(hex)}
            onKeyDown={(e) => { e.stopPropagation(); if (isEnter(e)) set(hex) }}
          />
        </label>
        {alpha && value && (
          <label className="ca-panel__row">
            <span>{t('adjustPanel.opacity')}</span>
            <input type="range" min={0} max={100} value={Math.round(a * 100)} onChange={(e) => onChange(withAlpha(rgbOf(value), Number(e.target.value) / 100))} />
            <span className="ca-panel__val">{Math.round(a * 100)}%</span>
          </label>
        )}
      </div>
    </Popover>
  )
}
