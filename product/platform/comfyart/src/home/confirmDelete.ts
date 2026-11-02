import { t } from '../i18n'
import { deleteProjects } from '../projects'
import { confirmAtom } from '../ui/Confirm'

export function confirmDelete(ids: string[], after: () => void) {
  confirmAtom.set({
    danger: true,
    title: ids.length > 1 ? t('home.deleteProjects', ids.length) : t('home.deleteProject'),
    desc: t('home.deleteProjectDesc'),
    ok: t('common.delete'),
    run: () => deleteProjects(ids).then(after),
  })
}
