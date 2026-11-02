import { useEffect, useRef, useState } from 'react'
import { atom, useValue } from 'tldraw'

import { errorText } from '../jobs'
import { deleteSkill, importFolder, listVersions, loadSkills, saveSkill, skillAtom, uploadSkillImage, type Skill, type SkillVersion } from '../skills'
import { confirmAtom } from './Confirm'
import { Icons } from './icons'
import { t } from '../i18n'
import { uuid } from '../id'
import { Modal } from './Modal'
import { reportError } from './ErrorToasts'

export const skillsOpenAtom = atom('skills open', false)

type View = { kind: 'list' } | { kind: 'edit'; skill: Skill } | { kind: 'history'; skill: Skill; versions: SkillVersion[] | null }

export function SkillForm({ initial, onDone }: { initial: Skill; onDone: (s: Skill | null) => void | Promise<void> }) {
  const [draft, setDraft] = useState(initial)
  const [saving, setSaving] = useState(false)
  const submit = async () => {
    if (saving) return
    setSaving(true)
    try { await onDone({ ...draft, name: draft.name.trim() }) }
    catch (e) { reportError(errorText(e)) }
    finally { setSaving(false) }
  }
  const [open, setOpen] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const imageFile = useRef<HTMLInputElement>(null)
  const files = draft.files ?? {}
  const images = draft.images ?? {}
  const setFiles = (next: Record<string, string>) => setDraft({ ...draft, files: next })
  const add = async (list: FileList | null) => {
    const next = { ...files }
    for (const f of Array.from(list ?? [])) next[f.name] = await f.text()
    setFiles(next)
  }
  return (
    <div className="ca-rename__body">
      <input className="ca-panel__input" value={draft.name} placeholder={t('composer.skillName')} onChange={(e) => setDraft({ ...draft, name: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
      <div className="ca-gen__label">SKILL.md</div>
      <textarea className="ca-panel__prompt ca-panel__prompt--boxed ca-skills__md" value={draft.instructions} placeholder={t('composer.instructionsForTheAgentDeliverables')} onChange={(e) => setDraft({ ...draft, instructions: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
      <div className="ca-gen__label">{t('skillsDialog.attachedFiles')}</div>
      {Object.keys(files).map((path) => (
        <div key={path} className="ca-skills__file">
          <div className="ca-memory__row">
            <span className="ca-icon">{Icons.files}</span>
            <span className="ca-menu__grow" onClick={() => setOpen(open === path ? null : path)}>{path}</span>
            <button type="button" className="ca-history__del" title={t('common.remove')} onClick={() => { const { [path]: _gone, ...rest } = files; setFiles(rest) }}>{Icons.trash}</button>
          </div>
          {open === path && <textarea className="ca-panel__prompt ca-panel__prompt--boxed ca-skills__md" value={files[path]} onChange={(e) => setFiles({ ...files, [path]: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />}
        </div>
      ))}
      <button type="button" className="ca-lib__new" onClick={() => file.current?.click()}><span className="ca-icon">{Icons.upload}</span>{t('skillsDialog.addFile')}</button>
      <div className="ca-gen__label">{t('common.image')}</div>
      <div className="ca-gen__refs ca-lib__images">
        {Object.entries(images).map(([path, src]) => (
          <span key={path} className="ca-gen__ref" title={path}><img src={src} alt="" /><button type="button" title={t('common.remove')} onClick={() => { const { [path]: _gone, ...rest } = images; setDraft({ ...draft, images: rest }) }}>{Icons.close}</button></span>
        ))}
        <button type="button" className="ca-gen__refadd" onClick={() => imageFile.current?.click()}><span className="ca-icon">{Icons.plus}</span><span>{t('skillsDialog.addImage')}</span></button>
        <input ref={imageFile} type="file" accept="image/*" multiple hidden onChange={(e) => {
          const list = Array.from(e.target.files ?? [])
          e.target.value = ''
          void Promise.all(list.map(async (f) => [f.name, await uploadSkillImage(f, draft.id)] as const)).then((added) => setDraft((d) => ({ ...d, images: { ...(d.images ?? {}), ...Object.fromEntries(added) } }))).catch((e) => reportError(errorText(e)))
        }} />
      </div>
      <input ref={file} type="file" multiple hidden accept=".md,.txt,.json,.csv,.yaml,.yml,.html,.css,.js,.ts,.svg" onChange={(e) => { void add(e.target.files); e.target.value = '' }} />
      <div className="ca-panel__foot">
        <button type="button" className="ca-panel__secondary" disabled={saving} onClick={() => onDone(null)}>{t('common.cancel')}</button>
        <button type="button" className="ca-panel__primary" disabled={saving || !draft.name.trim() || !draft.instructions.trim()} aria-busy={saving} onClick={() => void submit()}>{t('common.save')}</button>
      </div>
    </div>
  )
}

export function SkillsDialog({ onError }: { onError: (msg: string) => void }) {
  const open = useValue(skillsOpenAtom)
  const [skills, setSkills] = useState<Skill[]>([])
  const [view, setView] = useState<View>({ kind: 'list' })
  const [note, setNote] = useState('')
  const folder = useRef<HTMLInputElement>(null)
  const refresh = () => loadSkills().then((all) => setSkills(all.filter((s) => s.custom))).catch((e) => onError(String(e)))

  useEffect(() => {
    if (open) { setView({ kind: 'list' }); void refresh() }
  }, [open])

  useEffect(() => {
    if (view.kind === 'history' && !view.versions) void listVersions(view.skill.id).then((versions) => setView({ ...view, versions })).catch((e) => onError(String(e)))
  }, [view])

  useEffect(() => {
    folder.current?.setAttribute('webkitdirectory', '')
  })

  if (!open) return null
  const close = () => skillsOpenAtom.set(false)
  const act = (fn: () => Promise<unknown>) => void fn().then(refresh).catch((e) => onError(errorText(e)))

  return (
    <Modal title={view.kind === 'list' ? t('skillsDialog.mySkills') : view.kind === 'edit' ? t('skillsDialog.editSkill') : t('skillsDialog.versionHistoryOf', view.skill.name)} className="ca-rename ca-memory ca-skills-dialog" onClose={close}>
      {view.kind === 'edit' && (
        <SkillForm
          initial={view.skill}
          onDone={async (s) => {
            if (s) { await saveSkill(s); await refresh() }
            setView({ kind: 'list' })
          }}
        />
      )}
      {view.kind === 'history' && (
        <div className="ca-rename__body">
          {!view.versions && <div className="ca-side__empty">{t('skillsDialog.loading')}</div>}
          {view.versions?.length === 0 && <div className="ca-side__empty">{t('skillsDialog.noVersionsYetVersionsAre')}</div>}
          {view.versions?.map((v) => (
            <div key={v.time} className="ca-memory__row">
              <span className="ca-menu__grow" title={v.skill.instructions}>
                {new Date(v.time).toLocaleString()} · {v.skill.name} · {t('skillsDialog.versionFiles', Object.keys(v.skill.files ?? {}).length)}
              </span>
              <button type="button" className="ca-panel__chip" onClick={() => void saveSkill({ ...v.skill, id: view.skill.id }).then(refresh).then(() => setView({ kind: 'list' })).catch((e) => onError(errorText(e)))}>{t('skillsDialog.rollBack')}</button>
            </div>
          ))}
          <div className="ca-panel__foot"><button type="button" className="ca-panel__secondary" onClick={() => setView({ kind: 'list' })}>{t('skillsDialog.back')}</button></div>
        </div>
      )}
      {view.kind === 'list' && (
        <div className="ca-rename__body">
          <div className="ca-chat__hint">{t('skillsDialog.eachSkillIsAFolder')}</div>
          <div className="ca-style__row">
            <button type="button" className="ca-lib__new" onClick={() => setView({ kind: 'edit', skill: { id: uuid().slice(0, 8), name: '', instructions: '', files: {}, custom: true } })}>
              <span className="ca-icon">{Icons.plus}</span>{t('skillsDialog.newSkill')}
            </button>
            <button type="button" className="ca-lib__new" onClick={() => folder.current?.click()}><span className="ca-icon">{Icons.upload}</span>{t('skillsDialog.importFolder')}</button>
            <input ref={folder} type="file" multiple hidden onChange={(e) => { const list = e.target.files; if (list) act(async () => { const { skipped } = await importFolder(list); setNote(skipped.length ? t('skillsDialog.importedSkipped', skipped.join(t('common.listSep'))) : t('skillsDialog.imported')) }); e.target.value = '' }} />
          </div>
          {note && <div className="ca-chat__hint">{note}</div>}
          {skills.length === 0 && <div className="ca-side__empty">{t('skillsDialog.noPersonalSkillsYet')}</div>}
          {skills.map((s) => (
            <div key={s.id} className="ca-memory__row">
              <span className="ca-icon">{Icons.skill}</span>
              <span className="ca-menu__grow" title={s.learned ? t('proactive.learnedFrom', s.learned.length, s.learned.join(' / ')) : s.instructions}>{s.name}{s.learned && <span className="ca-model__tag">{t('skillsDialog.learned')}</span>}{Object.keys(s.files ?? {}).length + Object.keys(s.images ?? {}).length > 0 && <span className="ca-menu__key"> · {t('skillsDialog.filesImages', Object.keys(s.files ?? {}).length, Object.keys(s.images ?? {}).length)}</span>}</span>
              <button type="button" className="ca-history__del" title={t('skillsDialog.use')} onClick={() => { skillAtom.set(s); close() }}>{Icons.comment}</button>
              <button type="button" className="ca-history__del" title={t('common.edit')} onClick={() => setView({ kind: 'edit', skill: s })}>{Icons.textTool}</button>
              <button type="button" className="ca-history__del" title={t('skillsDialog.versionHistory')} onClick={() => setView({ kind: 'history', skill: s, versions: null })}>{Icons.undo}</button>
              <button type="button" className="ca-history__del" title={t('common.delete')} onClick={() => confirmAtom.set({ danger: true, title: t('skillsDialog.deleteSkill', s.name), desc: t('skillsDialog.theSkillFolderAndAll'), ok: t('common.delete'), run: () => act(() => deleteSkill(s.id)) })}>{Icons.trash}</button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
