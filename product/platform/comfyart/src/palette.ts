import { canvasBlob } from './canvasBlob'

const NAMES: [string, number, number, number][] = [
  ['black', 0, 0, 0], ['charcoal', 54, 69, 79], ['dark gray', 80, 80, 80], ['gray', 128, 128, 128], ['silver', 192, 192, 192],
  ['light gray', 224, 224, 224], ['off-white', 245, 245, 240], ['white', 255, 255, 255], ['cream', 255, 253, 208], ['beige', 232, 220, 190],
  ['tan', 210, 180, 140], ['brown', 120, 72, 40], ['chocolate', 80, 45, 25], ['maroon', 128, 0, 0], ['burgundy', 128, 0, 32],
  ['crimson', 220, 20, 60], ['red', 229, 57, 53], ['coral', 255, 127, 80], ['salmon', 250, 128, 114], ['burnt orange', 204, 85, 0],
  ['orange', 251, 140, 0], ['amber', 255, 191, 0], ['gold', 212, 175, 55], ['mustard', 225, 173, 1], ['yellow', 253, 216, 53],
  ['lemon', 255, 247, 0], ['olive', 128, 128, 0], ['lime green', 50, 205, 50], ['green', 67, 160, 71], ['forest green', 34, 89, 34],
  ['mint', 152, 255, 152], ['sage', 156, 175, 136], ['teal', 0, 128, 128], ['turquoise', 64, 224, 208], ['cyan', 0, 200, 230],
  ['sky blue', 30, 136, 229], ['light blue', 173, 216, 230], ['blue', 30, 60, 220], ['navy', 20, 30, 90], ['indigo', 75, 0, 130],
  ['purple', 142, 36, 170], ['violet', 143, 0, 255], ['lavender', 200, 180, 230], ['magenta', 220, 0, 160], ['hot pink', 236, 64, 122],
  ['pink', 255, 182, 193], ['blush', 222, 160, 160], ['peach', 255, 203, 164],
]

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function colorName(hex: string): string {
  const [r, g, b] = rgb(hex)
  let best = NAMES[0][0]
  let min = Infinity
  for (const [name, r2, g2, b2] of NAMES) {
    const rm = (r + r2) / 2
    const d = (2 + rm / 256) * (r - r2) ** 2 + 4 * (g - g2) ** 2 + (2 + (255 - rm) / 256) * (b - b2) ** 2
    if (d < min) [min, best] = [d, name]
  }
  return best
}

export function palettePrompt(colors: string[]): string {
  return `Use this color palette: ${colors.map((c) => `${colorName(c)} (${c})`).join(', ')}.`
}

export async function paletteImage(colors: string[]): Promise<Blob> {
  const tiles = 24
  const tile = 16
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = tiles * tile
  const ctx = canvas.getContext('2d')!
  let seed = 7
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  for (let y = 0; y < tiles; y++) {
    for (let x = 0; x < tiles; x++) {
      ctx.fillStyle = colors[Math.floor(next() * colors.length)]
      ctx.fillRect(x * tile, y * tile, tile, tile)
    }
  }
  return canvasBlob(canvas)
}

export const alphaOf = (color: string) => (color.length === 9 ? parseInt(color.slice(7), 16) / 255 : 1)
