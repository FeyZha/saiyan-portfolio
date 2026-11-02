import { useRef, useState } from 'react'
import { atom, useEditor, useValue } from 'tldraw'

import { createGenerator } from '../generate'
import { addComposeShape, createBoard, importLayout } from '../compose'
import { errorText } from '../jobs'
import { GENBLOCK, QR } from '../shapes/ComposeShapes'
import { COMMENT, commentKindAtom, type CommentKind } from '../shapes/CommentShape'
import { DOODLE } from '../shapes/DoodleShape'
import { PEN } from '../shapes/PenTool'
import { TEXT } from '../shapes/TextShape'
import { VECTOR, vectorKindAtom } from '../shapes/VectorShape'
import { audioDialogAtom } from './AudioDialog'
import { DoodleBar } from './DoodleBar'
import { NativeStyleBar } from './NativeStyleBar'
import { Icons } from './icons'
import { Popover } from './Popover'
import { t } from '../i18n'

const INSERTS: [string, string, keyof typeof Icons, string, string?][] = [
  ['text', t('common.text'), 'textTool', 'T'], ['rect', t('common.rectangle'), 'rect', 'R'], ['ellipse', t('dock.circle'), 'ellipse', 'O'], ['polygon', t('dock.polygon'), 'polygon', ''], ['star', t('dock.star'), 'star', ''], ['pen', t('dock.pen'), 'pen', 'P'],
  ['line', t('dock.line'), 'minus', 'L'], ['arrow', t('dock.arrow'), 'link', 'Shift L'], ['note', t('dock.stickyNote'), 'page', 'N'], ['frame', t('common.artboard'), 'frame', 'F'],
]
const COMPOSE_INSERTS: [string, string, keyof typeof Icons][] = [
  ['board', t('compose.board'), 'frame'], [GENBLOCK, t('compose.aiBlock'), 'genImage'], [QR, t('compose.qrCode'), 'qr'],
]

export const dockVideoAtom = atom('dock video', false)

const KINDS: [CommentKind, string, keyof typeof Icons][] = [['point', t('dock.clickSelect'), 'comment'], ['lasso', t('dock.lassoSelect'), 'lasso'], ['box', t('dock.boxSelect'), 'box']]

function CommentBar() {
  const kind = useValue(commentKindAtom)
  return (
    <div className="ca-bar">
      {KINDS.map(([k, label, icon]) => (
        <button key={k} type="button" className="ca-bar__btn ca-bar__btn--icon" title={label} data-on={kind === k || undefined} onClick={() => commentKindAtom.set(k)}>
          <span className="ca-icon">{Icons[icon]}</span>
        </button>
      ))}
    </div>
  )
}

export function Dock({ onError }: { onError: (msg: string) => void }) {
  const editor = useEditor()
  const tool = useValue('tool', () => editor.getCurrentToolId(), [editor])
  const video = useValue(dockVideoAtom)
  const [menu, setMenu] = useState(false)
  const [insert, setInsert] = useState(false)
  const upload = useRef<HTMLInputElement>(null)
  const layout = useRef<HTMLInputElement>(null)

  const gen = (v: boolean) => () => { setMenu(false); dockVideoAtom.set(v); createGenerator(editor, v) }
  const pickTool = (id: string) => {
    setInsert(false)
    if (id === 'text') editor.setCurrentTool(TEXT)
    else if (id === 'rect' || id === 'ellipse' || id === 'polygon' || id === 'star') { vectorKindAtom.set(id); editor.setCurrentTool(VECTOR) }
    else if (id === 'pen') editor.setCurrentTool(PEN)
    else editor.setCurrentTool(id)
  }
  const inserting = tool === TEXT || tool === VECTOR || tool === PEN || ['line', 'arrow', 'note', 'frame'].includes(tool)

  return (
    <div className="ca-dock" onPointerDown={(e) => e.stopPropagation()}>
      {tool === COMMENT ? <CommentBar /> : <><DoodleBar /><NativeStyleBar /></>}
      <div className="ca-bar">
        <button type="button" className="ca-bar__btn" data-on={tool === 'select' || undefined} title={t('dock.selectV')} onClick={() => editor.setCurrentTool('select')}>
          <span className="ca-icon">{Icons.select}</span><span>{t('dock.select')}</span>
        </button>
        <button type="button" className="ca-bar__btn" data-on={tool === COMMENT || undefined} title={t('dock.commentC')} onClick={() => editor.setCurrentTool(COMMENT)}>
          <span className="ca-icon">{Icons.comment}</span><span>{t('common.comment')}</span>
        </button>
        <button type="button" className="ca-bar__btn" data-on={tool === DOODLE || undefined} title={t('dock.drawD')} onClick={() => editor.setCurrentTool(DOODLE)}>
          <span className="ca-icon">{Icons.doodle}</span><span>{t('common.draw')}</span>
        </button>
        <Popover
          open={insert}
          onOpenChange={setInsert}
          side="top"
          trigger={({ open, toggle }) => (
            <button type="button" className="ca-bar__btn" data-on={inserting || undefined} data-open={open || undefined} title={t('dock.insert')} onClick={toggle}>
              <span className="ca-icon">{Icons.plus}</span><span>{t('dock.insert')}</span>
            </button>
          )}
        >
          <div className="ca-menu">
            <button type="button" className="ca-menu__item" onClick={() => { setInsert(false); upload.current?.click() }}>
              <span className="ca-icon">{Icons.upload}</span><span className="ca-menu__grow">{t('common.uploadFile')}</span><span className="ca-menu__key">{t('dock.imageVideoPdf3dLottie')}</span>
            </button>
            <div className="ca-menu__sep" />
            {INSERTS.map(([id, label, icon, key]) => (
              <button key={id} type="button" className="ca-menu__item" onClick={() => pickTool(id)}>
                <span className="ca-icon">{Icons[icon]}</span><span className="ca-menu__grow">{label}</span>{key && <span className="ca-menu__key">{key}</span>}
              </button>
            ))}
            <div className="ca-menu__sep" />
            {COMPOSE_INSERTS.map(([id, label, icon]) => (
              <button key={id} type="button" className="ca-menu__item" onClick={() => { setInsert(false); if (id === 'board') createBoard(editor); else addComposeShape(editor, id as typeof GENBLOCK) }}>
                <span className="ca-icon">{Icons[icon]}</span><span className="ca-menu__grow">{label}</span>
              </button>
            ))}
            <button type="button" className="ca-menu__item" onClick={() => { setInsert(false); layout.current?.click() }}>
              <span className="ca-icon">{Icons.upload}</span><span className="ca-menu__grow">{t('compose.importLayout')}</span>
            </button>
          </div>
        </Popover>
        <input
          ref={upload}
          type="file"
          multiple
          hidden
          accept="image/*,video/*,.pdf,.json,.lottie,.html,.htm,.glb,.gltf,.obj,.fbx,.stl,.ply,.mp3,.wav,.flac,.ogg,.m4a,.opus"
          onChange={(e) => { const files = Array.from(e.target.files ?? []); if (files.length) void editor.putExternalContent({ type: 'files', files, point: editor.getViewportPageBounds().center }); e.target.value = '' }}
        />
        <input ref={layout} type="file" hidden accept=".json" onChange={(e) => { const f = e.target.files?.[0]; if (f) importLayout(editor, f).catch((err) => onError(errorText(err))); e.target.value = '' }} />
        <div className="ca-bar__sep" />
        <div className="ca-split">
          <button type="button" className="ca-bar__btn" onClick={gen(video)}>
            <span className="ca-icon">{video ? Icons.genVideo : Icons.genImage}</span><span>{video ? t('dock.videoGeneration') : t('dock.imageGeneration')}</span>
          </button>
          <Popover
            open={menu}
            onOpenChange={setMenu}
            side="top"
            align="end"
            trigger={({ open, toggle }) => (
              <button type="button" className="ca-bar__btn ca-split__chev" data-open={open || undefined} onClick={toggle}>
                <span className="ca-icon">{Icons.chevron}</span>
              </button>
            )}
          >
            <div className="ca-menu">
              <button type="button" className="ca-menu__item" onClick={gen(false)}>
                <span className="ca-icon">{Icons.genImage}</span><span className="ca-menu__grow">{t('dock.imageGeneration')}</span><span className="ca-menu__key">A</span>
              </button>
              <button type="button" className="ca-menu__item" onClick={gen(true)}>
                <span className="ca-icon">{Icons.genVideo}</span><span className="ca-menu__grow">{t('dock.videoGeneration')}</span><span className="ca-menu__key">S</span>
              </button>
              <button type="button" className="ca-menu__item" onClick={() => { setMenu(false); audioDialogAtom.set(true) }}>
                <span className="ca-icon">{Icons.music}</span><span className="ca-menu__grow">{t('audio.generateAudio')}</span>
              </button>
            </div>
          </Popover>
        </div>
      </div>
    </div>
  )
}
