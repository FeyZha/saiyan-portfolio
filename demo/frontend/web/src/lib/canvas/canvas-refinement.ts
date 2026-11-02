import { resolveImageUrl } from "@/services/image-storage";
import type { CanvasBoardLayer, CanvasBoardVersion, CanvasPatchTransform, CanvasPixelRect, CanvasRefinementMapping, CanvasStoredImage } from "@/types/canvas";

export const defaultPatchTransform: CanvasPatchTransform = { offsetX: 0, offsetY: 0, scale: 1 };

export function buildRefinementMapping(imageWidth: number, imageHeight: number, normalized: CanvasPixelRect): CanvasRefinementMapping {
    const target = {
        x: Math.round(normalized.x * imageWidth),
        y: Math.round(normalized.y * imageHeight),
        width: Math.max(1, Math.round(normalized.width * imageWidth)),
        height: Math.max(1, Math.round(normalized.height * imageHeight)),
    };
    const context = Math.round(Math.max(target.width, target.height) * 0.5);
    const generationSize = Math.max(target.width, target.height) + context * 2;
    const centeredX = Math.round(target.x + target.width / 2 - generationSize / 2);
    const centeredY = Math.round(target.y + target.height / 2 - generationSize / 2);
    const generationWindow = {
        x: imageWidth >= generationSize ? clamp(centeredX, 0, imageWidth - generationSize) : centeredX,
        y: imageHeight >= generationSize ? clamp(centeredY, 0, imageHeight - generationSize) : centeredY,
        width: generationSize,
        height: generationSize,
    };
    const source = intersectRect(generationWindow, { x: 0, y: 0, width: imageWidth, height: imageHeight });
    return {
        imageWidth,
        imageHeight,
        target,
        generationWindow,
        writeback: { ...target },
        source,
        padding: {
            left: source.x - generationWindow.x,
            top: source.y - generationWindow.y,
            right: generationWindow.x + generationWindow.width - source.x - source.width,
            bottom: generationWindow.y + generationWindow.height - source.y - source.height,
        },
        generationSize,
    };
}

export async function createRefinementInputs(dataUrl: string, mapping: CanvasRefinementMapping) {
    const image = await loadImage(dataUrl);
    const context = document.createElement("canvas");
    context.width = mapping.generationSize;
    context.height = mapping.generationSize;
    const ctx = requiredContext(context);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, context.width, context.height);
    ctx.drawImage(image, mapping.source.x, mapping.source.y, mapping.source.width, mapping.source.height, mapping.padding.left, mapping.padding.top, mapping.source.width, mapping.source.height);
    const marked = document.createElement("canvas");
    marked.width = context.width;
    marked.height = context.height;
    const markedContext = requiredContext(marked);
    markedContext.drawImage(context, 0, 0);
    markedContext.fillStyle = "rgba(37,99,235,.45)";
    markedContext.fillRect(mapping.writeback.x - mapping.generationWindow.x, mapping.writeback.y - mapping.generationWindow.y, mapping.writeback.width, mapping.writeback.height);
    return { contextDataUrl: context.toDataURL("image/png"), markedDataUrl: marked.toDataURL("image/png") };
}

export async function renderBoardVersion(version: CanvasBoardVersion, width = version.base.width, height = version.base.height) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    const context = requiredContext(canvas);
    const base = await loadStoredImage(version.base);
    const scale = Math.min(canvas.width / version.base.width, canvas.height / version.base.height);
    const offsetX = (canvas.width - version.base.width * scale) / 2;
    const offsetY = (canvas.height - version.base.height * scale) / 2;
    context.drawImage(base, offsetX, offsetY, version.base.width * scale, version.base.height * scale);
    for (const layer of version.layers) {
        if (layer.hidden) continue;
        if (layer.kind === "patch") await drawPatch(context, layer, scale, offsetX, offsetY);
        else if (layer.kind === "text") drawText(context, layer, scale, offsetX, offsetY);
        else await drawAsset(context, layer, scale, offsetX, offsetY);
    }
    return canvas.toDataURL("image/png");
}

async function drawPatch(context: CanvasRenderingContext2D, layer: Extract<CanvasBoardLayer, { kind: "patch" }>, scale: number, offsetX: number, offsetY: number) {
    const image = await loadStoredImage(layer.image);
    const { generationWindow: window, writeback } = layer.mapping;
    const baseScale = Math.max(window.width / image.width, window.height / image.height) * layer.transform.scale;
    const drawWidth = image.width * baseScale;
    const drawHeight = image.height * baseScale;
    const drawX = window.x + (window.width - drawWidth) / 2 + layer.transform.offsetX;
    const drawY = window.y + (window.height - drawHeight) / 2 + layer.transform.offsetY;
    context.save();
    context.beginPath();
    context.rect(offsetX + writeback.x * scale, offsetY + writeback.y * scale, writeback.width * scale, writeback.height * scale);
    context.clip();
    context.drawImage(image, offsetX + drawX * scale, offsetY + drawY * scale, drawWidth * scale, drawHeight * scale);
    context.restore();
}

function drawText(context: CanvasRenderingContext2D, layer: Extract<CanvasBoardLayer, { kind: "text" }>, scale: number, offsetX: number, offsetY: number) {
    context.save();
    context.fillStyle = layer.backgroundColor;
    context.fillRect(offsetX + layer.x * scale, offsetY + layer.y * scale, layer.width * scale, layer.height * scale);
    context.beginPath();
    context.rect(offsetX + layer.x * scale, offsetY + layer.y * scale, layer.width * scale, layer.height * scale);
    context.clip();
    context.fillStyle = layer.color;
    context.textBaseline = "top";
    context.font = `${layer.fontSize * scale}px ${layer.fontFamily}`;
    const lineHeight = layer.fontSize * 1.25 * scale;
    layer.text.split("\n").forEach((line, index) => context.fillText(line, offsetX + (layer.x + layer.fontSize * 0.25) * scale, offsetY + layer.y * scale + layer.fontSize * 0.2 * scale + index * lineHeight));
    context.restore();
}

async function drawAsset(context: CanvasRenderingContext2D, layer: Extract<CanvasBoardLayer, { kind: "asset" }>, scale: number, offsetX: number, offsetY: number) {
    const image = await loadStoredImage(layer.image);
    const fit = Math.min(layer.width / image.width, layer.height / image.height);
    const width = image.width * fit;
    const height = image.height * fit;
    context.drawImage(image, offsetX + (layer.x + (layer.width - width) / 2) * scale, offsetY + (layer.y + (layer.height - height) / 2) * scale, width * scale, height * scale);
}

export function rectsOverlap(a: CanvasPixelRect, b: CanvasPixelRect) {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function layerRect(layer: CanvasBoardLayer): CanvasPixelRect {
    return layer.kind === "patch" ? layer.mapping.writeback : { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
}

export function imageRef(content: string, storageKey: string | undefined, width: number, height: number): CanvasStoredImage {
    return { content, storageKey, width, height };
}

async function loadStoredImage(image: CanvasStoredImage) {
    return loadImage(await resolveImageUrl(image.storageKey, image.content));
}

function intersectRect(a: CanvasPixelRect, b: CanvasPixelRect): CanvasPixelRect {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) };
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function requiredContext(canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法创建图片画布");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    return context;
}

function loadImage(src: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("图片读取失败，请重新选择图片"));
        image.src = src;
    });
}
