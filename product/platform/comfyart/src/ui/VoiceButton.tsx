import { useRef, useState } from 'react'

import { errorText } from '../jobs'
import { transcribe } from '../llm'
import { Icons } from './icons'
import { t } from '../i18n'

type State = 'idle' | 'recording' | 'processing'

export function VoiceButton({ onText, onError }: { onText: (text: string) => void; onError: (msg: string) => void }) {
  const [state, setState] = useState<State>('idle')
  const recorder = useRef<MediaRecorder | null>(null)

  const start = async () => {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      onError(e instanceof DOMException && e.name === 'NotFoundError' ? t('voiceButton.noMicrophoneFound') : t('voiceButton.cantUseTheMicrophone'))
      return
    }
    const chunks: Blob[] = []
    const rec = new MediaRecorder(stream)
    rec.ondataavailable = (e) => chunks.push(e.data)
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop())
      setState('processing')
      try {
        const text = await transcribe(new Blob(chunks, { type: rec.mimeType }))
        if (text) onText(text)
      } catch (e) {
        onError(errorText(e))
      } finally {
        setState('idle')
      }
    }
    recorder.current = rec
    rec.start()
    setState('recording')
  }

  const title = state === 'recording' ? t('voiceButton.clickToStopRecording') : state === 'processing' ? t('commentPanel.detecting') : t('voiceButton.voiceInput')
  return (
    <button
      type="button"
      className="ca-bar__btn ca-bar__btn--icon ca-voice"
      data-state={state}
      title={title}
      disabled={state === 'processing'}
      onClick={() => (state === 'recording' ? recorder.current?.stop() : void start())}
    >
      <span className="ca-icon">{Icons.mic}</span>
    </button>
  )
}
