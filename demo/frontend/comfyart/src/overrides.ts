import { Box, createShapeId, type Editor, type TLUiOverrides } from 'tldraw'

import { imageUnder } from './actions'
import { openCanvasChat } from './canvasChat'
import { createGenerator } from './generate'
import { flattenSelection } from './flatten'
import { errorText } from './jobs'
import { reportError } from './ui/ErrorToasts'
import { COMMENT, COMMENT_SIZE } from './shapes/CommentShape'
import { DOODLE } from './shapes/DoodleShape'
import { PEN } from './shapes/PenTool'
import { TEXT } from './shapes/TextShape'
import { VECTOR, vectorKindAtom } from './shapes/VectorShape'
import { dockVideoAtom } from './ui/Dock'
import { arrange } from './ui/MultiToolbar'
import { shortcutsAtom } from './ui/Shortcuts'

const KBD: Record<string, string> = {
  'toggle-lock': 'cmd+shift+l,ctrl+shift+l',
  'bring-forward': 'cmd+],ctrl+]',
  'send-backward': 'cmd+[,ctrl+[',
  'flatten-to-image': 'cmd+e,ctrl+e',
  'zoom-to-100': 'cmd+0,ctrl+0',
}

const UNBOUND_TOOLS = ['eraser', 'draw', 'laser', 'highlight', 'text', 'rectangle', 'ellipse']

function comment(editor: Editor) {
  const p = editor.inputs.getCurrentPagePoint()
  if (editor.getCurrentToolId() !== 'select' || !imageUnder(editor, new Box(p.x, p.y, 1, 1))) return editor.setCurrentTool(COMMENT)
  const id = createShapeId()
  editor.createShape({ id, type: COMMENT, x: p.x - COMMENT_SIZE / 2, y: p.y - COMMENT_SIZE / 2 })
  editor.select(id)
}

function keys(editor: Editor): Record<string, [string, () => void]> {
  return {
    'ca-gen-image': ['a', () => { dockVideoAtom.set(false); createGenerator(editor) }],
    'ca-gen-video': ['s', () => { dockVideoAtom.set(true); createGenerator(editor, true) }],
    'ca-comment': ['c', () => comment(editor)],
    'ca-doodle': ['d', () => editor.setCurrentTool(DOODLE)],
    'ca-pen': ['p', () => editor.setCurrentTool(PEN)],
    'ca-text': ['t', () => editor.setCurrentTool(TEXT)],
    'ca-rect': ['r', () => { vectorKindAtom.set('rect'); editor.setCurrentTool(VECTOR) }],
    'ca-ellipse': ['o', () => { vectorKindAtom.set('ellipse'); editor.setCurrentTool(VECTOR) }],
    'ca-shortcuts': ['shift+/', () => shortcutsAtom.set(true)],
  }
}

export const overrides: TLUiOverrides = {
  tools(_, tools) {
    for (const id of UNBOUND_TOOLS) if (tools[id]) tools[id] = { ...tools[id], kbd: undefined }
    if (tools.arrow) tools.arrow = { ...tools.arrow, kbd: 'shift+l' }
    return tools
  },
  actions(editor, actions) {
    for (const [id, kbd] of Object.entries(KBD)) actions[id] = { ...actions[id], kbd }
    actions['flatten-to-image'] = { ...actions['flatten-to-image'], onSelect: () => flattenSelection(editor).catch((e) => { reportError(errorText(e)) }) }
    actions['select-geo-tool'] = { ...actions['select-geo-tool'], kbd: undefined }
    for (const [id, [kbd, onSelect]] of Object.entries(keys(editor))) actions[id] = { id, kbd, onSelect }
    actions['ca-tidy'] = {
      id: 'ca-tidy',
      kbd: 'shift+a',
      onSelect() {
        const shapes = editor.getSelectedShapes()
        if (shapes.length > 1) arrange(editor, shapes)
      },
    }
    actions['ca-chat'] = {
      id: 'ca-chat',
      kbd: 'shift+enter',
      onSelect() {
        openCanvasChat(editor)
      },
    }
    actions['ca-hide'] = {
      id: 'ca-hide',
      kbd: 'cmd+shift+h,ctrl+shift+h',
      onSelect() {
        const shapes = editor.getSelectedShapes()
        const hidden = !shapes.every((s) => s.meta.hidden)
        editor.updateShapes(shapes.map((s) => ({ id: s.id, type: s.type, meta: { ...s.meta, hidden } })))
      },
    }
    return actions
  },
}
