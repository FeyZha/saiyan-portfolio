import { atom } from 'tldraw'

export const COMMON_FONTS = ['Arial', 'Helvetica', 'Inter', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Impact', 'Microsoft YaHei', 'PingFang SC', 'SimHei', 'SimSun', 'KaiTi', 'FangSong']

type QueryLocalFonts = () => Promise<{ family: string }[]>
const query = (window as unknown as { queryLocalFonts?: QueryLocalFonts }).queryLocalFonts

export const canLoadLocalFonts = !!query
export const localFontsAtom = atom<string[] | null>('local fonts', null)

export async function loadLocalFonts() {
  const families = [...new Set((await query!()).map((f) => f.family))].sort((a, b) => a.localeCompare(b))
  localFontsAtom.set(families)
}
