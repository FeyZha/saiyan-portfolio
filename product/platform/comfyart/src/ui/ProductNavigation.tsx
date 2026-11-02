import { useEffect, useState } from 'react'
import { useValue, type Editor } from 'tldraw'
import { competitionHref, navigateProduct, rememberProject, studioHref } from '../../../shared/product-navigation'
import '../../../shared/product-navigation.css'
import { saveNow, saveStateAtom } from '../autosave'
import { chatsAtom } from '../bot'
import { docsAtom, draftAtom, extraRefsAtom, kitsAtom } from '../agent'
import { jobOf } from '../jobs'
import { saveTheme, themeAtom } from '../theme'
import { Icons } from './icons'

export function ProductNavigation({ projectId, editor }: { projectId?: string; editor?: Editor | null }) {
  const [error, setError] = useState('')
  const [leaving, setLeaving] = useState(false)
  const theme = useValue(themeAtom)
  const running = useValue('ongoing creation', () => chatsAtom.get().some(c => c.busy) || !!editor?.store.query.records('shape').get().some(s => jobOf(s)), [editor])
  const hasDraft = useValue('unsent creation input', () => !!draftAtom.get() || docsAtom.get().length > 0 || extraRefsAtom.get().length > 0 || kitsAtom.get().length > 0, [])
  useEffect(() => {
    if (projectId) try { rememberProject(projectId, new URL(location.href).searchParams.get('fromSession')) }
    catch { setError('无法记住返回位置，当前项目内容不受影响。') }
  }, [projectId])
  async function go(href: string) {
    if (leaving) return
    setLeaving(true); setError('')
    try {
      if (running || hasDraft) { navigateProduct(href, true); return }
      await saveNow()
      if (projectId && saveStateAtom.get().state !== 'saved') {
        setError(saveStateAtom.get().state === 'conflict' ? '此页版本已过期，请先查看页面上方的更新提示。' : '画布尚未保存，已留在当前页面。请点击保存状态重试。'); return
      }
      navigateProduct(href)
    } catch (failure) { setError(failure instanceof Error ? failure.message : '暂时无法切换页面，请重试。') }
    finally { setLeaving(false) }
  }
  const disabled = leaving || (!!projectId && !editor)
  return <nav className="sy-product-nav ca-product-nav" aria-label="赛研主导航">
    <button type="button" className="sy-product-brand" aria-label="赛研首页" title="返回欢迎页" disabled={disabled} onClick={() => void go('/')}>赛研</button>
    <div className="sy-product-links">
      <button type="button" disabled={disabled} title={running || hasDraft ? '保留当前创作，在新页面打开竞赛' : '返回竞赛对话'} onClick={() => void go(competitionHref(projectId, new URL(location.href).searchParams.get('fromSession')))}>发现竞赛</button>
      <button type="button" aria-current="page" disabled={disabled} onClick={() => { if (!projectId) void go(studioHref()) }}>创作空间</button>
    </div>
    {error && <span role="alert" className="sy-product-error">{error}</span>}
    <button type="button" className="sy-product-library" disabled={disabled} onClick={() => void go('/comfyart/?view=projects')}>我的作品</button>
    <button type="button" className="sy-product-theme" aria-label={`切换到${theme === 'light' ? '深' : '浅'}色主题`} title={`切换到${theme === 'light' ? '深' : '浅'}色主题`} onClick={() => {
      try { saveTheme(theme === 'light' ? 'dark' : 'light'); setError('') }
      catch (failure) { setError(failure instanceof Error ? failure.message : '主题切换失败，请重试。') }
    }}><span aria-hidden="true">{theme === 'light' ? Icons.sun : Icons.moon}</span><span>{theme === 'light' ? '浅色' : '深色'}</span></button>
  </nav>
}
