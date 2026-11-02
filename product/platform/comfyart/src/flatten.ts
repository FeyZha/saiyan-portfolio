import { Box, createShapeId, type Editor, type TLImageAsset } from 'tldraw'

// The upstream action skips HTML-based custom shapes. Render through the same
// export path as PNG download so text and ComfyArt vectors are included too.
export async function flattenSelection(editor: Editor) {
  const shapes = editor.getSelectedShapes()
  if (!shapes.length || (shapes.length === 1 && shapes[0].type === 'image')) return
  const bounds = Box.Common(shapes.map((s) => editor.getShapeMaskedPageBounds(s)!))
  const { blob } = await editor.toImage(shapes.map((s) => s.id), { format: 'png', background: false, padding: 0, bounds })
  const asset = await editor.getAssetForExternalContent({ type: 'file', file: new File([blob], 'merged.png', { type: 'image/png' }) }) as TLImageAsset | undefined
  if (!asset) throw new Error('合并图片未能保存，请重试。')
  if (shapes.some((s) => editor.getShape(s.id) !== s)) throw new Error('选中内容已经改变，请重新选择后合并。')
  const parentId = editor.findCommonAncestor(shapes) ?? editor.getCurrentPageId()
  const parent = editor.getShape(parentId)
  const point = parent ? editor.getPointInShapeSpace(parent, bounds) : bounds
  const rotation = parent ? -editor.getShapePageTransform(parent.id).rotation() : 0
  const index = shapes.filter((s) => s.parentId === parentId).sort((a, b) => a.index.localeCompare(b.index)).at(-1)?.index
  const id = createShapeId()
  editor.markHistoryStoppingPoint('merge images')
  editor.run(() => {
    editor.createAssets([asset])
    editor.createShape({ id, type: 'image', parentId, index, x: point.x, y: point.y, rotation, props: { assetId: asset.id, w: bounds.w, h: bounds.h } })
    editor.deleteShapes(shapes.map((s) => s.id))
    editor.select(id)
  })
}
