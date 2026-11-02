import { atom, useValue } from 'tldraw'

import { Modal } from './Modal'
import { t } from '../i18n'

export const shortcutsAtom = atom('shortcuts open', false)

const SECTIONS: [string, [string, string][]][] = [
  [t('shortcuts.tools'), [[t('dock.select'), 'V'], [t('shortcuts.hand'), t('shortcuts.hDragWithSpace')], [t('common.artboard'), 'F'], [t('common.rectangle'), 'R'], [t('dock.circle'), 'O'], [t('shortcuts.line'), 'L'], [t('dock.arrow'), 'Shift L'], [t('common.text'), 'T'], [t('dock.stickyNote'), 'N'], [t('common.draw'), 'D'], [t('dock.pen'), 'P'], [t('shortcuts.commentHoverAnImageLocal'), 'C'], [t('dock.imageGeneration'), 'A'], [t('dock.videoGeneration'), 'S']]],
  [t('common.edit'), [[t('common.undo'), 'Ctrl Z'], [t('shortcuts.redo'), 'Ctrl Shift Z'], [t('common.copy'), 'Ctrl C'], [t('common.cut'), 'Ctrl X'], [t('canvasMenu.paste'), 'Ctrl V'], [t('common.duplicate'), 'Ctrl D'], [t('common.delete'), 'Delete'], [t('canvasMenu.selectAll'), 'Ctrl A'], [t('shortcuts.group'), 'Ctrl G'], [t('shortcuts.ungroup'), 'Ctrl Shift G'], [t('multiToolbar.tidyUp'), 'Shift A']]],
  [t('shortcuts.view'), [[t('common.zoomIn'), 'Ctrl +'], [t('common.zoomOut'), 'Ctrl -'], [t('shortcuts.zoomTo100'), 'Ctrl 0'], [t('shortcuts.fitCanvas'), 'Shift 1'], [t('shortcuts.fitSelection'), 'Shift 2']]],
  [t('common.layers'), [[t('shortcuts.bringToFront'), ']'], [t('shortcuts.sendToBack'), '['], [t('canvasMenu.bringForward'), 'Ctrl ]'], [t('canvasMenu.sendBackward'), 'Ctrl ['], [t('canvasMenu.mergeLayers'), 'Ctrl E'], [`${t('sidePanel.show')} / ${t('sidePanel.hide')}`, 'Ctrl Shift H'], [t('canvasMenu.lockUnlock'), 'Ctrl Shift L'], [t('common.flipHorizontal'), 'Shift H'], [t('common.flipVertical'), 'Shift V'], [t('shortcuts.nudge'), t('shortcuts.arrowKeys')], [t('shortcuts.nudge10px'), t('shortcuts.shiftArrowKeys')]]],
  [t('common.image'), [[t('canvasChat.chatSelection'), 'Shift Enter'], [t('common.quickEdit'), 'Tab']]],
]

export function Shortcuts() {
  const open = useValue(shortcutsAtom)
  if (!open) return null
  return (
    <Modal title={t('shortcuts.keyboardShortcuts')} className="" onClose={() => shortcutsAtom.set(false)}>
      <div className="ca-keys">
        {SECTIONS.map(([title, rows]) => (
          <section key={title}>
            <div className="ca-gen__label">{title}</div>
            {rows.map(([label, key]) => (
              <div key={label} className="ca-keys__row"><span>{label}</span><kbd>{key}</kbd></div>
            ))}
          </section>
        ))}
      </div>
    </Modal>
  )
}
