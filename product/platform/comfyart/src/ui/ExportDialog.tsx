import { useState } from 'react'
import { atom, useValue, type Editor, type TLShapeId } from 'tldraw'

import { errorText } from '../jobs'
import { exportPptx } from '../pptx'
import { download } from '../psd'
import { exportImage } from '../shapes/ArtboardShape'
import { Modal } from './Modal'
import { Chips } from './Chips'
import { t } from '../i18n'

export const exportAtom = atom<TLShapeId[] | null>('export', null)

type Format = 'png' | 'jpeg' | 'svg' | 'pdf' | 'pptx' | 'pptx-text'
const FORMATS: [Format, string][] = [['png', 'PNG'], ['jpeg', 'JPG'], ['svg', 'SVG'], ['pdf', 'PDF'], ['pptx', t('exportDialog.pptImages')], ['pptx-text', t('exportDialog.pptEditableText')]]
const SCALES = [1, 2, 3]

function pdfFromJpeg(jpeg: Uint8Array, w: number, h: number): Blob {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const offsets: number[] = []
  let length = 0
  const push = (p: Uint8Array | string) => {
    const b = typeof p === 'string' ? enc.encode(p) : p
    parts.push(b)
    length += b.length
  }
  const obj = (n: number, body: string) => { offsets[n] = length; push(`${n} 0 obj\n${body}\nendobj\n`) }
  push('%PDF-1.4\n')
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>')
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`)
  offsets[4] = length
  push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`)
  push(jpeg)
  push('\nendstream\nendobj\n')
  const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
  const xref = length
  push(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((n) => `${String(offsets[n]).padStart(10, '0')} 00000 n \n`).join('')}`)
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`)
  return new Blob(parts as BlobPart[], { type: 'application/pdf' })
}

export function ExportDialog({ editor, onError }: { editor: Editor; onError: (msg: string) => void }) {
  const ids = useValue(exportAtom)
  const [format, setFormat] = useState<Format>('png')
  const [scale, setScale] = useState(2)
  const [background, setBackground] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!ids) return null
  const close = () => exportAtom.set(null)
  const name = (editor.getDocumentSettings().name || 'comfyart').replace(/[\\/:*?"<>|]/g, '_')
  const selected = editor.getSelectedShapeIds()
  const fromSelection = ids.every((id) => selected.includes(id))

  const run = async () => {
    setBusy(true)
    try {
      if (format === 'pptx' || format === 'pptx-text') {
        await exportPptx(editor, ids, format === 'pptx-text', scale, name)
      } else if (format === 'pdf') {
        const { blob, width, height } = await exportImage(editor, ids, { format: 'jpeg', scale, background: true })
        download(pdfFromJpeg(new Uint8Array(await blob.arrayBuffer()), Math.round(width), Math.round(height)), `${name}.pdf`)
      } else {
        const { blob } = await exportImage(editor, ids, { format, scale, background: background || format === 'jpeg' })
        download(blob, `${name}.${format === 'jpeg' ? 'jpg' : format}`)
      }
      close()
    } catch (e) {
      onError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={t('exportDialog.exportOptions')} onClose={close}>
      <div className="ca-rename__body">
        <div className="ca-chat__hint">{fromSelection ? t('exportDialog.selectedElements', ids.length) : t('exportDialog.wholePage')}</div>
        <div className="ca-rename__field"><span>{t('exportDialog.format')}</span>
          <Chips value={format} options={FORMATS} onPick={setFormat} />
        </div>
        {format !== 'svg' && (
          <div className="ca-rename__field"><span>{t('exportDialog.scale')}</span>
            <Chips value={scale} options={SCALES.map((s) => [s, `${s}x`] as const)} onPick={setScale} />
          </div>
        )}
        {(format === 'png' || format === 'svg') && (
          <label className="ca-panel__row"><span>{t('exportDialog.includeCanvasBackground')}</span><input type="checkbox" checked={background} onChange={(e) => setBackground(e.target.checked)} /></label>
        )}
        <div className="ca-chat__hint">{t('exportDialog.largerSizesTakeLongerTo')}</div>
        <div className="ca-panel__foot">
          <button type="button" className="ca-panel__secondary" onClick={close}>{t('common.cancel')}</button>
          <button type="button" className="ca-panel__primary" disabled={busy} onClick={() => void run()}>{busy ? t('exportDialog.exporting') : t('common.export')}</button>
        </div>
      </div>
    </Modal>
  )
}
