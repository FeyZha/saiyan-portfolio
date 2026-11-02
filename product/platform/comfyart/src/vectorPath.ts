export interface PenNode { x: number; y: number; hx: number; hy: number }

const round = (v: number) => Math.round(v * 1e5) / 1e5
const MIN_SIZE = 1e-6
const PAIRED = 'MLCSQTmlcsqt'

export function scalePath(d: string, w: number, h: number): string {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? []
  let cmd = ''
  let index = 0
  return tokens.map((tok) => {
    if (/[a-zA-Z]/.test(tok)) {
      cmd = tok
      index = 0
      return tok
    }
    const v = Number(tok)
    const axis = PAIRED.includes(cmd) ? index++ % 2 : cmd === 'H' || cmd === 'h' ? 0 : 1
    return String(round(v * (axis ? h : w)))
  }).join(' ')
}

export function nodesToPath(nodes: PenNode[], closed: boolean) {
  const xs = nodes.flatMap((n) => [n.x, n.x + n.hx, n.x - n.hx])
  const ys = nodes.flatMap((n) => [n.y, n.y + n.hy, n.y - n.hy])
  const [x, y] = [Math.min(...xs), Math.min(...ys)]
  const [w, h] = [Math.max(1, Math.max(...xs) - x), Math.max(1, Math.max(...ys) - y)]
  const nx = (v: number) => round((v - x) / w)
  const ny = (v: number) => round((v - y) / h)
  const seg = (a: PenNode, b: PenNode) => `C ${nx(a.x + a.hx)} ${ny(a.y + a.hy)} ${nx(b.x - b.hx)} ${ny(b.y - b.hy)} ${nx(b.x)} ${ny(b.y)}`
  const parts = [`M ${nx(nodes[0].x)} ${ny(nodes[0].y)}`, ...nodes.slice(1).map((n, i) => seg(nodes[i], n))]
  if (closed) parts.push(seg(nodes[nodes.length - 1], nodes[0]), 'Z')
  return { x, y, w, h, d: parts.join(' ') }
}

type Paper = typeof import('paper/dist/paper-core')
let loaded: Promise<Paper> | null = null

export function loadPaper(): Promise<Paper> {
  loaded ??= import('paper/dist/paper-core').then(({ default: paper }) => {
    paper.setup(new paper.Size(1, 1))
    return paper
  })
  return loaded
}

export function normalized(paper: Paper, item: paper.PathItem) {
  const b = item.bounds
  const [w, h] = [Math.max(MIN_SIZE, b.width), Math.max(MIN_SIZE, b.height)]
  const copy = item.clone({ insert: false }) as paper.PathItem
  copy.translate(new paper.Point(-b.x, -b.y))
  copy.scale(1 / w, 1 / h, new paper.Point(0, 0))
  return { x: b.x, y: b.y, w, h, d: copy.pathData }
}
