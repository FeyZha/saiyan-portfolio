import { createShapeId, type Editor, type TLShapeId } from 'tldraw'

import { createGenerator, generate } from './generate'
import type { ErrorSink } from './jobs'
import { GENERATOR, type GeneratorShape } from './shapes/GeneratorShape'
import { TEXT, type TextShape } from './shapes/TextShape'

export interface Slide { title: string; bullets: string[]; image?: string }

const SLIDE_W = 1280
const SLIDE_H = 720
const SLIDE_GAP = 80
const PAD = 64
const IMAGE_W = 520
const TITLE_GAP = 28
const IMAGE_PX: [number, number] = [832, 1024]

function textHeight(text: string, size: number, weight: number, width: number, line = 1.3): number {
  const ctx = document.createElement('canvas').getContext('2d')!
  ctx.font = `${weight} ${size}px Arial`
  let lines = 0
  for (const para of text.split('\n')) {
    let row = ''
    lines++
    for (const ch of para) {
      if (ctx.measureText(row + ch).width > width && row) {
        lines++
        row = ch
      } else row += ch
    }
  }
  return lines * size * line
}

export function buildSlides(editor: Editor, title: string, slides: Slide[], onError: ErrorSink): TLShapeId[] {
  const center = editor.getViewportPageBounds().center
  const x = center.x - SLIDE_W / 2
  const y0 = center.y - SLIDE_H / 2
  const generators: TLShapeId[] = []
  const frames: TLShapeId[] = []
  editor.run(() => {
    slides.forEach((s, i) => {
      const frame = createShapeId()
      frames.push(frame)
      editor.createShape({ id: frame, type: 'frame', x, y: y0 + i * (SLIDE_H + SLIDE_GAP), props: { w: SLIDE_W, h: SLIDE_H, name: `${title} · ${i + 1}` } })
      const textW = SLIDE_W - PAD * 3 - (s.image ? IMAGE_W : 0)
      const heading = createShapeId()
      const titleSize = i === 0 ? 64 : 44
      editor.createShape<TextShape>({ id: heading, type: TEXT, parentId: frame, x: PAD, y: PAD, props: { text: s.title, size: titleSize, weight: 700, autoSize: false, w: textW } })
      if (s.bullets.length) {
        const body = createShapeId()
        editor.createShape<TextShape>({ id: body, type: TEXT, parentId: frame, x: PAD, y: PAD + textHeight(s.title, titleSize, 700, textW) + TITLE_GAP, props: { text: s.bullets.map((b) => `• ${b}`).join('\n'), size: 26, autoSize: false, w: textW, line: 1.6 } })
      }
      if (s.image) {
        const gen = createGenerator(editor, false, { prompt: s.image, resolution: 'custom', cw: IMAGE_PX[0], ch: IMAGE_PX[1] }, false)
        editor.reparentShapes([gen], frame)
        editor.updateShape<GeneratorShape>({ id: gen, type: GENERATOR, x: SLIDE_W - PAD - IMAGE_W, y: PAD, props: { w: IMAGE_W, h: SLIDE_H - PAD * 2 } })
        generators.push(gen)
      }
    })
  })
  for (const id of generators) void generate(editor, editor.getShape<GeneratorShape>(id)!, onError)
  editor.select(...frames)
  editor.zoomToSelection({ animation: { duration: 200 } })
  editor.selectNone()
  return generators
}
