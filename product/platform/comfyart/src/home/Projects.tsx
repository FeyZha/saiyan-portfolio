import { useEffect, useState } from 'react'

import { thumbUrl } from '../comfy'
import { lang, t } from '../i18n'
import { duplicateProject, fillCovers, listProjects, newProject, openProject, renameProject, setPinned, UNTITLED, type ProjectEntry } from '../projects'
import { Icons } from '../ui/icons'
import { isEnter } from '../ui/keys'
import { Popover } from '../ui/Popover'
import { confirmDelete } from './confirmDelete'
import { reportError } from '../ui/ErrorToasts'
import { errorText } from '../jobs'

const fail = (e: unknown) => reportError(errorText(e))

const dateText = (time: number) => new Date(time).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' })

export async function loadEntries(limit?: number): Promise<ProjectEntry[]> {
  return fillCovers((await listProjects()).slice(0, limit))
}

export function ProjectCard({ entry, onChanged, selecting, selected, onToggle }: {
  entry: ProjectEntry
  onChanged: () => void
  selecting?: boolean
  selected?: boolean
  onToggle?: () => void
}) {
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const covers = entry.covers ?? []
  const rename = (name: string) => {
    setRenaming(false)
    if (name.trim() && name.trim() !== entry.name) void renameProject(entry.id, name.trim()).then(onChanged).catch(fail)
  }
  return (
    <div className="ca-pcard" data-on={selected || undefined}>
      <button type="button" className="ca-pcard__cover" data-count={covers.length} aria-label={entry.name || UNTITLED} onClick={() => (selecting ? onToggle?.() : openProject(entry.id))}>
        {covers.map((src) => <img key={src} src={thumbUrl(src, 512)} alt="" loading="lazy" />)}
        {selecting && <span className="ca-pcard__check">{selected && Icons.check}</span>}
        {entry.pinned && !selecting && <span className="ca-pcard__pin ca-icon" title={t('home.pinned')}>{Icons.pin}</span>}
      </button>
      <div className="ca-pcard__row">
        {renaming
          ? <input autoFocus className="ca-pcard__input" defaultValue={entry.name} onBlur={(e) => rename(e.target.value)} onKeyDown={(e) => { if (isEnter(e)) e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(false) }} />
          : <span className="ca-pcard__name">{entry.name || UNTITLED}</span>}
        {!selecting && !renaming && (
          <Popover open={menu} onOpenChange={setMenu} align="end" trigger={({ open, toggle }) => <button type="button" className="ca-pcard__more" data-open={open || undefined} title={t('home.more')} onClick={toggle}><span className="ca-icon">{Icons.more}</span></button>}>
            <div className="ca-menu ca-pcard__menu">
              <button type="button" className="ca-menu__item" onClick={() => { setMenu(false); void setPinned(entry.id, !entry.pinned).then(onChanged).catch(fail) }}>{entry.pinned ? t('home.unpin') : t('home.pin')}</button>
              <button type="button" className="ca-menu__item" onClick={() => { setMenu(false); setRenaming(true) }}>{t('home.rename')}</button>
              <button type="button" className="ca-menu__item" onClick={() => { setMenu(false); void duplicateProject(entry.id).then(onChanged).catch(fail) }}>{t('common.duplicate')}</button>
              <button type="button" className="ca-menu__item ca-menu__item--danger" onClick={() => { setMenu(false); confirmDelete([entry.id], onChanged) }}>{t('common.delete')}</button>
            </div>
          </Popover>
        )}
      </div>
      <div className="ca-pcard__date">{t('home.updatedOn', dateText(entry.updated))}</div>
    </div>
  )
}

export function Projects() {
  const [entries, setEntries] = useState<ProjectEntry[] | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const reload = () => void loadEntries().then(setEntries).catch(fail)
  useEffect(reload, [])

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const stop = () => { setSelecting(false); setSelected([]) }
  const all = entries?.map((e) => e.id) ?? []

  return (
    <div className="ca-projects">
      <div className="ca-projects__head">
        <h1>{t('home.projects')}</h1>
        <button type="button" className="ca-rail__btn" title={t('home.select')} data-on={selecting || undefined} onClick={() => (selecting ? stop() : setSelecting(true))}><span className="ca-icon">{Icons.select}</span></button>
      </div>
      <div className="ca-projects__grid">
        {!selecting && (
          <div className="ca-pcard">
            <button type="button" className="ca-pcard__cover ca-pcard__new" onClick={() => newProject()}><span className="ca-icon">{Icons.plus}</span></button>
            <div className="ca-pcard__row"><span className="ca-pcard__name">{t('projectHeader.newProject')}</span></div>
          </div>
        )}
        {entries?.map((e) => <ProjectCard key={e.id} entry={e} onChanged={reload} selecting={selecting} selected={selected.includes(e.id)} onToggle={() => toggle(e.id)} />)}
      </div>
      {entries?.length === 0 && <div className="ca-projects__empty">{t('home.noProjectsYet')}</div>}
      {selecting && (
        <div className="ca-projects__bar">
          <button type="button" className="ca-panel__secondary" onClick={() => setSelected(selected.length === all.length ? [] : all)}>{t('home.selectAll', selected.length)}</button>
          <button type="button" className="ca-panel__primary ca-panel__danger" disabled={!selected.length} onClick={() => confirmDelete(selected, () => { stop(); reload() })}>{t('common.delete')}</button>
          <button type="button" className="ca-panel__secondary" onClick={stop}>{t('common.cancel')}</button>
        </div>
      )}
    </div>
  )
}
