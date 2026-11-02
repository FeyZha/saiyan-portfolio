import { useState } from 'react'
import { useValue, type Editor } from 'tldraw'

import { openChat } from '../bot'
import { errorText } from '../jobs'
import { reportError } from './ErrorToasts'
import { clearNotices, currentProject, markRead, noticesAtom, removeNotice, type Notice, type NoticeKind } from '../notices'
import { openProject } from '../projects'
import { chatViewAtom } from './AgentPanel'
import { Icons } from './icons'
import { Popover } from './Popover'
import { reveal } from './TaskDetails'
import { Chips } from './Chips'
import { t, timeAgo } from '../i18n'

const fail = (e: unknown) => reportError(errorText(e))

const FILTERS: [NoticeKind | 'all', string][] = [['all', t('common.all')], ['task', t('noticeCenter.tasks')], ['suggestion', t('noticeCenter.suggestions')], ['comment', t('common.comment')], ['schedule', t('noticeCenter.scheduled')]]
const KIND_ICONS: Record<NoticeKind, keyof typeof Icons> = { task: 'genImage', suggestion: 'agent', comment: 'comment', schedule: 'bell' }

export function NoticeCenter({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<NoticeKind | 'all'>('all')
  const notices = useValue(noticesAtom)
  const unread = notices.filter((n) => !n.read).length
  const shown = notices.filter((n) => filter === 'all' || n.kind === filter)

  const go = (n: Notice) => {
    setOpen(false)
    if (!n.read) void markRead([n.id]).catch(fail)
    if (n.project !== currentProject()) return openProject(n.project)
    if (n.chat) {
      void openChat(n.chat).catch(fail)
      if (chatViewAtom.get() === 'closed') chatViewAtom.set('open')
    }
    if (n.srcs?.[0]) reveal(editor, n.srcs[0])
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      trigger={({ open: o, toggle }) => (
        <button type="button" className="ca-bar__btn ca-bar__btn--icon ca-notice__bell" title={t('noticeCenter.notifications')} data-open={o || undefined} onClick={toggle}>
          <span className="ca-icon">{Icons.bell}</span>
          {unread > 0 && <span className="ca-badge">{unread > 99 ? '99+' : unread}</span>}
        </button>
      )}
    >
      <div className="ca-menu ca-notice">
        <div className="ca-style__row">
          <div className="ca-gen__title ca-menu__grow">{t('noticeCenter.notifications')}</div>
          {unread > 0 && <button type="button" className="ca-panel__chip" onClick={() => void markRead().catch(fail)}>{t('noticeCenter.markAllAsRead')}</button>}
          {notices.length > 0 && <button type="button" className="ca-panel__chip" onClick={() => void clearNotices().catch(fail)}>{t('noticeCenter.clear')}</button>}
        </div>
        <Chips value={filter} options={FILTERS} onPick={setFilter} />
        <div className="ca-notice__list">
          {shown.length === 0 && <div className="ca-menu__empty">{t('noticeCenter.noNotifications')}</div>}
          {shown.map((n) => (
            <div key={n.id} className="ca-menu__item ca-notice__item" data-unread={!n.read || undefined} onClick={() => go(n)}>
              <span className="ca-icon">{Icons[KIND_ICONS[n.kind]]}</span>
              <div className="ca-menu__grow ca-notice__text">
                <div className="ca-notice__title">{n.title}</div>
                {n.body && <div className="ca-notice__body">{n.body}</div>}
                <div className="ca-chat__hint">{timeAgo(n.time)}{n.project !== currentProject() ? t('noticeCenter.otherProject') : ''}</div>
              </div>
              {n.srcs?.[0] && (/\.(mp4|webm|mov)(&|$)/.test(n.srcs[0])
                ? <video className="ca-notice__thumb" src={n.srcs[0]} muted preload="metadata" />
                : <img className="ca-notice__thumb" src={n.srcs[0]} alt="" />)}
              <button type="button" className="ca-history__del" title={t('common.delete')} onClick={(e) => { e.stopPropagation(); void removeNotice(n.id).catch(fail) }}>{Icons.trash}</button>
            </div>
          ))}
        </div>
      </div>
    </Popover>
  )
}
