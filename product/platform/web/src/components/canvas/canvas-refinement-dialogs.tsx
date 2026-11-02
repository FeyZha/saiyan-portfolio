import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button, Input, InputNumber, Modal, Select, Slider, Switch } from "antd";
import { Check, Download, RefreshCw, Trash2, Upload, X } from "lucide-react";

import { useImageEditorViewport } from "./use-image-editor-viewport";
import { readImageMeta } from "@/lib/image-utils";
import { buildRefinementMapping, createRefinementInputs, defaultPatchTransform, renderBoardVersion } from "@/lib/canvas/canvas-refinement";
import type { CanvasBoardLayer, CanvasBoardVersion, CanvasPatchTransform, CanvasPixelRect, CanvasRefinementCandidate, CanvasStoredImage } from "@/types/canvas";

const defaultRegion: CanvasPixelRect = { x: 0.28, y: 0.28, width: 0.44, height: 0.34 };

export function CanvasRefinementSelectDialog({ dataUrl, open, onClose, onConfirm }: { dataUrl: string; open: boolean; onClose: () => void; onConfirm: (value: { region: CanvasPixelRect; instruction: string; preserve: string }) => void }) {
    const [image, setImage] = useState<{ width: number; height: number } | null>(null);
    const [region, setRegion] = useState(defaultRegion);
    const [instruction, setInstruction] = useState("");
    const [preserve, setPreserve] = useState("");
    const [error, setError] = useState("");
    const dragRef = useRef<AbortController | null>(null);
    const viewport = useImageEditorViewport(image, open);
    const generationWindow = useMemo(() => image ? buildRefinementMapping(image.width, image.height, region).generationWindow : null, [image, region]);

    useEffect(() => {
        if (!open) return;
        setRegion(defaultRegion);
        setInstruction("");
        setPreserve("");
        setError("");
        void readImageMeta(dataUrl).then(setImage);
    }, [dataUrl, open]);

    const startDrag = (resize: boolean, event: ReactPointerEvent) => {
        const bounds = viewport.stageRef.current?.getBoundingClientRect();
        if (!bounds) return;
        event.preventDefault();
        event.stopPropagation();
        dragRef.current?.abort();
        const controller = new AbortController();
        dragRef.current = controller;
        const start = { x: event.clientX, y: event.clientY, region };
        const move = (next: PointerEvent) => {
            const dx = (next.clientX - start.x) / bounds.width;
            const dy = (next.clientY - start.y) / bounds.height;
            setRegion(resize
                ? { ...start.region, width: clamp(start.region.width + dx, 0.04, 1 - start.region.x), height: clamp(start.region.height + dy, 0.04, 1 - start.region.y) }
                : { ...start.region, x: clamp(start.region.x + dx, 0, 1 - start.region.width), y: clamp(start.region.y + dy, 0, 1 - start.region.height) });
        };
        document.addEventListener("pointermove", move, { signal: controller.signal });
        document.addEventListener("pointerup", () => controller.abort(), { signal: controller.signal });
    };

    return (
        <Modal title="单图精修 · 选择授权区域" open={open} onCancel={onClose} footer={null} width={860} centered destroyOnHidden>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                <div ref={viewport.viewportRef} {...viewport.panHandlers} className={`relative h-[min(62vh,620px)] min-h-[380px] rounded-xl bg-black/5 ${viewport.scrollClassName}`}>
                    <div className="relative" style={viewport.contentStyle}>
                        <div ref={viewport.stageRef} className="absolute isolate overflow-hidden rounded-lg bg-black" style={viewport.stageStyle}>
                            <div className="absolute left-0 top-0" style={viewport.mediaStyle}><img src={dataUrl} alt="待精修展板" className="block h-full w-full object-contain" draggable={false} /></div>
                            {image && generationWindow ? <div className="pointer-events-none absolute z-20 border border-dashed border-amber-400" style={{ left: `${generationWindow.x / image.width * 100}%`, top: `${generationWindow.y / image.height * 100}%`, width: `${generationWindow.width / image.width * 100}%`, height: `${generationWindow.height / image.height * 100}%` }}><span className="absolute right-1 top-1 rounded bg-amber-400 px-1.5 py-0.5 text-[10px] font-medium text-black">生成窗口</span></div> : null}
                            <div className="absolute z-10 cursor-move border-2 border-[#2f80ff] bg-[#2f80ff]/15 shadow-[0_0_0_9999px_rgba(0,0,0,.32)]" style={rectStyle(region)} onPointerDown={(event) => startDrag(false, event)}>
                                <span className="absolute left-1 top-1 rounded bg-[#2f80ff] px-1.5 py-0.5 text-[10px] font-medium text-white">目标 / 写回范围</span>
                                <button type="button" aria-label="调整范围" className="absolute -bottom-2 -right-2 size-4 cursor-se-resize rounded-full border-2 border-[#2f80ff] bg-white" onPointerDown={(event) => startDrag(true, event)} />
                            </div>
                        </div>
                    </div>
                </div>
                <div className="flex flex-col gap-4">
                    <div><div className="mb-1 text-sm font-medium">修改要求</div><Input.TextArea rows={5} value={instruction} placeholder="例如：修复这张模糊产品图，保持光影、颜色与构图" onChange={(event) => (setInstruction(event.target.value), setError(""))} /></div>
                    <div><div className="mb-1 text-sm font-medium">必须保留</div><Input.TextArea rows={4} value={preserve} placeholder="例如：产品轮廓、品牌色、右下角反光" onChange={(event) => setPreserve(event.target.value)} /></div>
                    <div className="rounded-lg border px-3 py-2 text-xs leading-5 opacity-70">程序会自动扩大生成窗口并补成方形，但最终仅写回蓝框内像素。候选需人工确认，不会自动覆盖母版。</div>
                    {error ? <div className="text-sm text-red-500">{error}</div> : null}
                    <div className="mt-auto flex justify-end gap-2"><Button icon={<X className="size-4" />} onClick={onClose}>取消</Button><Button type="primary" icon={<Check className="size-4" />} onClick={() => instruction.trim() ? onConfirm({ region, instruction: instruction.trim(), preserve: preserve.trim() }) : setError("请输入修改要求")}>生成候选</Button></div>
                </div>
            </div>
        </Modal>
    );
}

export function CanvasRefinementCandidateDialog({ open, base, candidate, candidateImage, onClose, onDiscard, onAdopt }: { open: boolean; base: CanvasBoardVersion | null; candidate: CanvasRefinementCandidate | null; candidateImage: CanvasStoredImage | null; onClose: () => void; onDiscard: () => void; onAdopt: (transform: CanvasPatchTransform) => void }) {
    const [transform, setTransform] = useState(defaultPatchTransform);
    const [preview, setPreview] = useState("");
    const [before, setBefore] = useState("");
    useEffect(() => setTransform(defaultPatchTransform), [candidate?.id, open]);
    useEffect(() => {
        if (!open || !base || !candidate || !candidateImage) return;
        const layer: CanvasBoardLayer = { id: "preview", kind: "patch", title: "候选预览", image: candidateImage, mapping: candidate.mapping, transform };
        void renderBoardVersion(base).then((full) => createRefinementInputs(full, candidate.mapping)).then((inputs) => setBefore(inputs.contextDataUrl));
        void renderBoardVersion({ ...base, layers: [...base.layers.filter((item) => item.id !== candidate.replaceLayerId), layer] }, Math.min(base.base.width, 1600), Math.round(Math.min(base.base.width, 1600) * base.base.height / base.base.width)).then(setPreview);
    }, [base, candidate, candidateImage, open, transform]);
    return (
        <Modal title="候选待确认" open={open && Boolean(base && candidate && candidateImage)} onCancel={onClose} footer={null} width={1040} centered destroyOnHidden>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
                <div className="grid min-h-[480px] place-items-center overflow-hidden rounded-xl bg-black/5 p-3">{preview ? <img src={preview} alt="原位整图预览" className="max-h-[68vh] max-w-full object-contain" /> : <span className="opacity-50">正在合成原位预览…</span>}</div>
                <div className="flex flex-col gap-4">
                    <div className="grid grid-cols-2 gap-2"><figure className="m-0"><figcaption className="mb-1 text-xs opacity-60">局部修改前</figcaption><div className="aspect-square overflow-hidden rounded-lg bg-black/5">{before ? <img src={before} alt="局部修改前" className="h-full w-full object-contain" /> : null}</div></figure><figure className="m-0"><figcaption className="mb-1 text-xs opacity-60">局部候选</figcaption><div className="aspect-square overflow-hidden rounded-lg bg-black/5"><img src={candidateImage?.content || ""} alt="局部候选" className="h-full w-full object-contain" /></div></figure></div>
                    <div><div className="mb-2 text-sm font-medium">等比缩放</div><Slider min={50} max={180} value={Math.round(transform.scale * 100)} onChange={(value) => setTransform((current) => ({ ...current, scale: value / 100 }))} /></div>
                    <div><div className="mb-2 text-sm font-medium">水平平移</div><Slider min={-50} max={50} value={Math.round(transform.offsetX / Math.max(1, candidate?.mapping.generationWindow.width || 1) * 100)} onChange={(value) => setTransform((current) => ({ ...current, offsetX: value / 100 * (candidate?.mapping.generationWindow.width || 1) }))} /></div>
                    <div><div className="mb-2 text-sm font-medium">垂直平移</div><Slider min={-50} max={50} value={Math.round(transform.offsetY / Math.max(1, candidate?.mapping.generationWindow.height || 1) * 100)} onChange={(value) => setTransform((current) => ({ ...current, offsetY: value / 100 * (candidate?.mapping.generationWindow.height || 1) }))} /></div>
                    <div className="rounded-lg border px-3 py-2 text-xs leading-5 opacity-70">预览只合成授权写回范围。明显变形或接缝无法接受时请直接放弃。</div>
                    <div className="mt-auto flex flex-wrap justify-end gap-2"><Button danger icon={<Trash2 className="size-4" />} onClick={onDiscard}>放弃</Button><Button onClick={() => setTransform(defaultPatchTransform)}>复位</Button><Button type="primary" icon={<Check className="size-4" />} onClick={() => onAdopt(transform)}>采用为新版本</Button></div>
                </div>
            </div>
        </Modal>
    );
}

export type CanvasTextLayerDraft = Extract<CanvasBoardLayer, { kind: "text" }>;
export function CanvasBoardLayersDialog({ open, version, previewUrl, onClose, onAddText, onAddAsset, onToggle, onDelete, onReplace, onExport }: { open: boolean; version: CanvasBoardVersion | null; previewUrl: string; onClose: () => void; onAddText: (layer: CanvasTextLayerDraft) => void; onAddAsset: (file: File, rect: CanvasPixelRect) => void; onToggle: (id: string, hidden: boolean) => void; onDelete: (id: string) => void; onReplace: (id: string) => void; onExport: (width: number, height: number) => void }) {
    const [text, setText] = useState("");
    const [fontFamily, setFontFamily] = useState("sans-serif");
    const [fontSize, setFontSize] = useState(48);
    const [color, setColor] = useState("#111111");
    const [backgroundColor, setBackgroundColor] = useState("#ffffff");
    const [rect, setRect] = useState({ x: 10, y: 10, width: 50, height: 15 });
    const [output, setOutput] = useState({ width: version?.base.width || 2048, height: version?.base.height || 2048 });
    useEffect(() => {
        if (version) setOutput({ width: version.base.width, height: version.base.height });
    }, [version?.revision, version?.base.width, version?.base.height]);
    const pixelRect = useMemo(() => version ? { x: rect.x / 100 * version.base.width, y: rect.y / 100 * version.base.height, width: rect.width / 100 * version.base.width, height: rect.height / 100 * version.base.height } : null, [rect, version]);
    return (
        <Modal title="展板图层与交付" open={open && Boolean(version)} onCancel={onClose} footer={null} width={1000} centered destroyOnHidden>
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
                <div className="grid min-h-[520px] place-items-center rounded-xl bg-black/5 p-3">{previewUrl ? <img src={previewUrl} alt="完整展板" className="max-h-[70vh] max-w-full object-contain" /> : null}</div>
                <div className="max-h-[70vh] space-y-5 overflow-auto pr-1">
                    <section><div className="mb-2 text-sm font-semibold">已采用图层</div><div className="space-y-2">{version?.layers.length ? version.layers.map((layer) => <div key={layer.id} className="flex items-center gap-2 rounded-lg border px-2 py-2"><Switch size="small" checked={!layer.hidden} onChange={(checked) => onToggle(layer.id, !checked)} /><span className="min-w-0 flex-1 truncate text-sm">{layer.title}</span>{layer.kind === "patch" ? <Button type="text" size="small" icon={<RefreshCw className="size-4" />} onClick={() => onReplace(layer.id)} /> : null}<Button type="text" danger size="small" icon={<Trash2 className="size-4" />} onClick={() => onDelete(layer.id)} /></div>) : <div className="text-sm opacity-50">尚无图层</div>}</div></section>
                    <section className="space-y-3 border-t pt-4"><div className="text-sm font-semibold">真实文字层（请逐字确认）</div><Input.TextArea rows={3} value={text} placeholder="不做 OCR，不猜测文字" onChange={(event) => setText(event.target.value)} /><Select className="w-full" value={fontFamily} options={[{value:"sans-serif",label:"无衬线"},{value:"serif",label:"衬线"},{value:"monospace",label:"等宽"}]} onChange={setFontFamily} /><div className="grid grid-cols-3 gap-2"><InputNumber min={8} className="w-full" value={fontSize} onChange={(value) => setFontSize(Number(value || 48))} /><Input type="color" value={color} onChange={(event) => setColor(event.target.value)} /><Input type="color" value={backgroundColor} onChange={(event) => setBackgroundColor(event.target.value)} /></div>{["x","y","width","height"].map((key) => <div key={key}><div className="mb-1 text-xs opacity-60">{{x:"左",y:"上",width:"宽",height:"高"}[key]} {rect[key as keyof typeof rect]}%</div><Slider min={0} max={key === "width" || key === "height" ? 100 : 95} value={rect[key as keyof typeof rect]} onChange={(value) => setRect((current) => ({ ...current, [key]: value }))} /></div>)}<Button block disabled={!text.trim() || !pixelRect} onClick={() => pixelRect && onAddText({ id: crypto.randomUUID(), kind: "text", title: `文字 · ${text.trim().slice(0, 12)}`, text: text.trim(), fontFamily, fontSize, color, backgroundColor, ...pixelRect })}>添加文字版本</Button></section>
                    <section className="space-y-3 border-t pt-4"><div className="text-sm font-semibold">高清素材层</div><label className="flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border text-sm transition hover:bg-black/5 dark:hover:bg-white/10"><Upload className="size-4" />导入确认过的 Logo / 图标原图<input type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file && pixelRect) onAddAsset(file, pixelRect); event.currentTarget.value = ""; }} /></label><div className="text-xs opacity-60">复用上方位置范围；原始素材单独保存，最终导出时才按目标尺寸等比合成。</div></section>
                    <section className="space-y-3 border-t pt-4"><div className="text-sm font-semibold">导出完整作品</div><div className="grid grid-cols-2 gap-2"><InputNumber min={1} className="w-full" value={output.width} onChange={(value) => setOutput((current) => ({ ...current, width: Number(value || 1) }))} /><InputNumber min={1} className="w-full" value={output.height} onChange={(value) => setOutput((current) => ({ ...current, height: Number(value || 1) }))} /></div><Button type="primary" block icon={<Download className="size-4" />} onClick={() => onExport(output.width, output.height)}>按目标像素导出 PNG</Button></section>
                </div>
            </div>
        </Modal>
    );
}

function rectStyle(rect: CanvasPixelRect) { return { left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }; }
function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
