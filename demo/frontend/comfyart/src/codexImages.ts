import type { Built } from './workflows'
import { mediaMeta, viewUrl } from './comfy'
export const CODEX_IMAGE = 'saiyan-codex-image'

export function codexGraph(prompt: string, refs: string[] = [], width = 1024, height = 1024, count = 1, transparent = false): Built {
  return { graph: { codex: { class_type: CODEX_IMAGE, inputs: { prompt, refs, width, height, count, transparent } } }, result: 'codex', partial: ['codex'] }
}

export async function codexEditGraph(image: string, prompt: string, extra: string[] = [], transparent = false, dimensions?: [number, number], pads?: { l: number; t: number; r: number; b: number }): Promise<Built> {
  const match = /^(.*) \[(input|output|temp)\]$/.exec(image)
  const file = match?.[1] ?? image
  const slash = file.lastIndexOf('/')
  const url = image.startsWith('/api/view?') ? image : viewUrl({ filename: file.slice(slash + 1), subfolder: file.slice(0, Math.max(0, slash)), type: match?.[2] ?? 'input' })
  const meta = await mediaMeta(url, 'image')
  return codexGraph(prompt, [image, ...extra], dimensions?.[0] ?? meta.w + (pads ? pads.l + pads.r : 0), dimensions?.[1] ?? meta.h + (pads ? pads.t + pads.b : 0), 1, transparent)
}
