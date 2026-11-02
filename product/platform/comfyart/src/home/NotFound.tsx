import { t } from '../i18n'
import { newProject, openView } from '../projects'
import { Icons } from '../ui/icons'

export function NotFound({ id }: { id: string }) {
  return (
    <div className="ca-missing">
      <h1>{t('home.projectNotFound')}</h1>
      <p>{t('home.projectNotFoundHint', id)}</p>
      <div className="ca-missing__acts">
        <button type="button" className="ca-landing__chip" onClick={() => openView('projects')}><span className="ca-icon">{Icons.folder}</span>{t('home.projectLibrary')}</button>
        <button type="button" className="ca-landing__chip" onClick={() => newProject()}><span className="ca-icon">{Icons.plus}</span>{t('projectHeader.newProject')}</button>
      </div>
    </div>
  )
}
