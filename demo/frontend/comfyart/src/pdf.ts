import { createShapeId, type Editor, type VecLike } from 'tldraw'

import { viewUrl, type ImageRef } from './comfy'
import { GAP, placeMedia } from './jobs'
import { t } from './i18n'

export interface PdfPage { ref: ImageRef; src: string; text: string; w: number; h: number }

const PAGE_W = 600

export const isPdf = (file: File) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')

export async function uploadPdf(file: File, max = 30): Promise<PdfPage[]> {
  const body = new FormData()
  body.append('file', file, file.name)
  const res = await fetch(`/comfyart/pdf?max=${max}`, { method: 'POST', body })
  if (!res.ok) throw new Error(t('pdf.pdfUploadFailed', (await res.json().catch(() => ({}))).error ?? res.status))
  const { pages } = await res.json() as { pages: { name: string; subfolder: string; type: string; width: number; height: number; text: string }[] }
  return pages.map((p) => {
    const ref = { filename: p.name, subfolder: p.subfolder, type: p.type }
    return { ref, src: viewUrl(ref), text: p.text, w: p.width, h: p.height }
  })
}

export async function placePdf(editor: Editor, file: File, at?: VecLike) {
  const pages = await uploadPdf(file)
  const heights = pages.map((p) => PAGE_W * p.h / p.w)
  const w = PAGE_W + GAP * 2
  const h = heights.reduce((n, x) => n + x + GAP, GAP)
  const center = at ?? editor.getViewportPageBounds().center
  const frameId = createShapeId()
  editor.run(() => {
    editor.createShape({ id: frameId, type: 'frame', x: center.x - w / 2, y: center.y - Math.min(h, 800) / 2, props: { w, h, name: file.name.replace(/\.pdf$/i, '') } })
    let y = GAP
    pages.forEach((p, i) => {
      const id = placeMedia(editor, { ref: p.ref, src: p.src, w: p.w, h: p.h, kind: 'image' }, t('pdf.page', file.name, i + 1), GAP, y, PAGE_W, frameId)
      if (p.text.trim()) editor.updateShape({ id, type: 'image', meta: { pageText: p.text.trim() } })
      y += heights[i] + GAP
    })
  })
  editor.select(frameId)
  editor.zoomToSelection({ animation: { duration: 200 } })
}
