import { atom } from 'tldraw'

import { applyProductTheme, readProductTheme, saveProductTheme, subscribeProductTheme, type ProductTheme } from '../../shared/product-theme'
import { t } from './i18n'

export type Theme = ProductTheme
export const THEMES: [Theme, string][] = [['light', t('projectHeader.themeLight')], ['dark', t('projectHeader.themeDark')]]

export const themeAtom = atom<Theme>('theme', readProductTheme())
let stopTheme: (() => void) | undefined

export function initTheme() {
  stopTheme?.()
  stopTheme = subscribeProductTheme(theme => {
    applyProductTheme(theme)
    themeAtom.set(theme)
  })
}

export function saveTheme(theme: Theme) {
  saveProductTheme(theme)
}

if (import.meta.hot) import.meta.hot.dispose(() => stopTheme?.())
