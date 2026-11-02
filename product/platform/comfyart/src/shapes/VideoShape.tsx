import { useEffect, useRef } from 'react'
import { HTMLContainer, useEditor, useImageOrVideoAsset, useIsEditing, useValue, VideoShapeUtil, type TLVideoShape } from 'tldraw'

import { isViewUrl, thumbSize, thumbUrl } from '../comfy'

export class HoverVideoShapeUtil extends VideoShapeUtil {
  override component(shape: TLVideoShape) {
    return <HoverVideo shape={shape} />
  }
}

function HoverVideo({ shape }: { shape: TLVideoShape }) {
  const editor = useEditor()
  const video = useRef<HTMLVideoElement>(null)
  const editing = useIsEditing(shape.id)
  const hovered = useValue('video hovered', () => editor.getHoveredShapeId() === shape.id, [editor, shape.id])
  const size = useValue('video poster size', () => thumbSize(shape.props.w * editor.getEfficientZoomLevel() * editor.getInstanceState().devicePixelRatio) ?? 1024, [editor, shape.props.w])
  const { url } = useImageOrVideoAsset({ shapeId: shape.id, assetId: shape.props.assetId, width: shape.props.w })
  const playing = hovered || editing

  useEffect(() => {
    const v = video.current
    if (!v) return
    if (playing) v.play().catch(() => {})
    else v.pause()
  }, [playing, url])

  return (
    <HTMLContainer id={shape.id}>
      <div className="tl-counter-scaled">
        <div className="tl-video-container">
          {url && (
            <video
              ref={video}
              key={url}
              className="tl-video"
              src={url}
              poster={isViewUrl(url) ? thumbUrl(url, size) : undefined}
              width="100%"
              height="100%"
              draggable={false}
              playsInline
              muted
              loop
              preload="none"
              disableRemotePlayback
              disablePictureInPicture
              controls={editing}
              style={editing ? { pointerEvents: 'all' } : undefined}
              aria-label={shape.props.altText}
            />
          )}
        </div>
      </div>
    </HTMLContainer>
  )
}
