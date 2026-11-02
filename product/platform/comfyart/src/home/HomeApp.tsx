import type { ReactNode } from 'react'

import { t } from '../i18n'
import { newProject, openView } from '../projects'
import { Confirm } from '../ui/Confirm'
import { Icons } from '../ui/icons'
import { SettingsMenu } from '../ui/SettingsMenu'
import '../styles/home.css'
import { Home } from './Home'
import { NotFound } from './NotFound'
import { Projects } from './Projects'
import { ProductNavigation } from '../ui/ProductNavigation'
import { HomeErrors } from '../ui/ErrorToasts'

type View = 'home' | 'projects' | { missing: string }

function RailBtn({ icon, label, on, onClick }: { icon: ReactNode; label: string; on?: boolean; onClick: () => void }) {
  return <button type="button" className="ca-rail__btn" title={label} data-on={on || undefined} onClick={onClick}><span className="ca-icon">{icon}</span></button>
}

export function HomeApp({ view }: { view: View }) {
  return (
    <><ProductNavigation />
    <div className="ca-home">
      <nav className="ca-rail">
        <span className="ca-rail__logo">{Icons.agent}</span>
        <RailBtn icon={Icons.plus} label={t('projectHeader.newProject')} onClick={() => newProject()} />
        <RailBtn icon={Icons.home} label={t('home.home')} on={view === 'home'} onClick={() => openView('home')} />
        <RailBtn icon={Icons.folder} label={t('home.projectLibrary')} on={view === 'projects'} onClick={() => openView('projects')} />
        <div className="ca-rail__spacer" />
        <RailBtn icon={Icons.folder} label="旧版作品" onClick={() => location.assign('/workspaces')} />
        <SettingsMenu trigger={({ open, toggle }) => <RailBtn icon={Icons.settings} label={t('settings.settings')} on={open} onClick={toggle} />} />
      </nav>
      <main className="ca-home__main">{view === 'home' ? <Home /> : view === 'projects' ? <Projects /> : <NotFound id={view.missing} />}</main>
      <Confirm />
      <HomeErrors />
    </div></>
  )
}
