import { defaultConfig, resolveModelForCapability, type AiConfig } from "@/stores/use-config-store";
import i18n from "@/i18n";
import { resolveImageUrl, uploadImage } from "@/services/image-storage";
import { resolveMediaUrl } from "@/services/file-storage";
import { imageMetadata, referenceUrl } from "@/lib/canvas/canvas-node-factory";
import type { NodeGenerationInput } from "@/components/canvas/canvas-node-generation";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import type { CanvasImageAngleParams } from "@/components/canvas/canvas-node-angle-dialog";
import type { ReferenceImage } from "@/types/image";
import { CanvasNodeType, type CanvasAssistantSession, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

export function imageExtension(dataUrl: string) {
    return dataUrl.match(/^data:image[/]([^;]+)/)?.[1] || dataUrl.match(/image[/]([^;]+)/)?.[1] || "png";
}

export function audioExtension(mimeType?: string) {
    if (mimeType?.includes("wav")) return "wav";
    if (mimeType?.includes("opus")) return "opus";
    if (mimeType?.includes("aac")) return "aac";
    if (mimeType?.includes("flac")) return "flac";
    if (mimeType?.includes("pcm")) return "pcm";
    return "mp3";
}

export function generationReferenceUrls(context: { referenceImages: ReferenceImage[]; referenceVideos: Array<{ storageKey?: string; url?: string }>; referenceAudios?: Array<{ storageKey?: string; url?: string }> }) {
    return [
        ...context.referenceImages.map(referenceUrl).filter((url): url is string => Boolean(url)),
        ...context.referenceVideos.map((video) => video.storageKey || video.url).filter((url): url is string => Boolean(url)),
        ...(context.referenceAudios || []).map((audio) => audio.storageKey || audio.url).filter((url): url is string => Boolean(url)),
    ];
}

export async function resolveMetadataReferences(metadata: CanvasNodeMetadata) {
    if (metadata.generationType !== "edit") return [];
    if (!metadata.references?.length) return null;
    const references = await Promise.all(
        metadata.references.map(async (url, index) => {
            const dataUrl = url.startsWith("image:") ? await resolveImageUrl(url, "") : url;
            return dataUrl ? { id: `${index}`, name: `reference-${index}.png`, type: "image/png", dataUrl, storageKey: url.startsWith("image:") ? url : undefined } : null;
        }),
    );
    return references.every(Boolean) ? (references as ReferenceImage[]) : null;
}

export async function hydrateCanvasImages(nodes: CanvasNodeData[]) {
    return Promise.all(
        nodes.map(async (node) => {
            const metadata = node.metadata;
            const content = metadata?.content;
            if ((node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio) && metadata?.storageKey) return { ...node, metadata: { ...metadata, content: await resolveMediaUrl(metadata.storageKey, content) } };
            if (node.type !== CanvasNodeType.Image || !metadata || !content) return node;
            const images = await Promise.all((metadata.images || []).map(async (image) => (image.content ? { ...image, content: await resolveImageUrl(image.storageKey, image.content) } : image)));
            if (metadata.storageKey) return { ...node, metadata: { ...metadata, content: await resolveImageUrl(metadata.storageKey, content), images } };
            if (!content.startsWith("data:image/")) return node;
            return { ...node, metadata: { ...metadata, ...imageMetadata(await uploadImage(content)) } };
        }),
    );
}

export async function hydrateAssistantImages(sessions: CanvasAssistantSession[]) {
    const hydrateItem = async <T extends { dataUrl?: string; storageKey?: string }>(item: T) => {
        if (item.storageKey) return { ...item, dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl) };
        if (item.dataUrl?.startsWith("data:image/")) {
            const image = await uploadImage(item.dataUrl);
            return { ...item, dataUrl: image.url, storageKey: image.storageKey };
        }
        return item;
    };
    return Promise.all(
        sessions.map(async (session) => ({
            ...session,
            messages: await Promise.all(
                session.messages.map(async (message) => ({
                    ...message,
                    references: await Promise.all((message.references || []).map(hydrateItem)),
                })),
            ),
        })),
    );
}

export function getGenerationCount(count: string) {
    return Math.max(1, Math.min(15, Math.floor(Math.abs(Number(count)) || 1)));
}

export function isImageEditingTask(node: CanvasNodeData | undefined, mode: CanvasNodeGenerationMode, hasImageInputs: boolean) {
    return (mode === "image" || mode === "text") && (hasImageInputs || node?.metadata?.generationType === "edit" || (node?.type === CanvasNodeType.Image && Boolean(node.metadata?.content)));
}

export function buildCodexImageTask(prompt: string, count: number, size: string, editing = false) {
    const instruction = editing
        ? "本轮是对参考图的编辑任务。首张参考图是编辑目标，其余图片提供参考或标注。必须使用本轮原图执行图像编辑；按创作要求修改指定内容，保留未要求修改的内容与构图。局部编辑中的标注图只用于指示编辑范围，结果不得残留标注。不要重新设计完整展板。"
        : "读取当前画布的创作目标和本轮参考图，按照“创作主题、要完成什么、最终提交物”直接生成完整展板；竞赛未明确最终规格时按 A3 展板输出。";
    return `请使用 Codex 内置 imagegen 生成 ${count} 张图片。\n\n创作要求：\n${prompt.trim()}\n\n画面规格：${size || "自动"}。${instruction}完成后让真实结果自动进入当前画布，不要调用需要 API Key 的画布生成工具或创建占位图。`;
}

export function buildCodexTextTask(prompt: string, count: number, sourceNodeId: string) {
    return `请使用 Codex 完成 ${count} 版画布文案。\n\n创作要求：\n${prompt.trim()}\n\n先读取当前画布中的竞赛 Brief 和本轮引用内容。完成后使用画布工具把最终文案写回源节点 ${sourceNodeId}；如果源节点是生成配置，则在其右侧新建文本节点并连接。不要调用需要 API Key 的生成工具。`;
}

export function buildCodexPlanTask(source: CanvasNodeData, generationId: string, position: { x: number; y: number }, options: { count?: number; preferences?: string; targetNodeId?: string } = {}) {
    const count = options.count ?? 3;
    if (!Number.isSafeInteger(count) || count < 1) throw new Error("方案数量必须是正整数");
    return `请基于创作目标探索 ${count} 个不同方案。
固定任务：你是设计方案探索助手。根据输入资料中的创作目标和本轮参考内容，严格提出指定数量的方案，供比较和继续深化；有补充偏好时一并考虑。
每个方案必须回应创作主题，覆盖“要完成什么”，并按“最终提交物”规划完整展板；竞赛未明确最终规格时按 A3 展板输出。差异体现在概念、叙事或视觉表达，不能只换名字、颜色，不扩大已选类别或编造竞赛规定。
每个方案按以下字段输出：title（简短名称）、concept（一句话核心创意）、visualDirection（具体的视觉方向）、deliverables（各项作品如何落实方案的短句数组）。中文、直观、可执行，不写背景论文或共通参赛要求。
完成后调用 canvas_create_plan_nodes 一次，传入输入资料中的 sourceNodeId、generationId、count、x、y、targetNodeId（如有）和完整 items 数组，items 长度必须等于 count。工具会复用指定空节点作为第一个方案，统一排版并连接全部方案；不要用其他工具修改源节点、创建占位节点或重复创建方案。工具未成功时明确说明原因，不能声称方案已放入画布。不检索竞赛，不调用其他生成工具。
输入资料 JSON：
${JSON.stringify({ sourceNodeId: source.id, generationId, count, ...position, goal: source.metadata?.content?.trim() || "", ...(options.preferences?.trim() ? { preferences: options.preferences.trim() } : {}), ...(options.targetNodeId ? { targetNodeId: options.targetNodeId } : {}) })}`;
}

export function parseCodexGenerationTask(text: string) {
    const plan = /^请基于创作目标探索 (\d+) 个不同方案。\n/.exec(text);
    if (plan) {
        try {
            const input = JSON.parse(text.split("\n输入资料 JSON：\n")[1]);
            const count = Number(plan[1]);
            if (Number.isSafeInteger(count) && count > 0 && (input.count === undefined || input.count === count) && typeof input.goal === "string" && typeof input.generationId === "string") return { mode: "plan" as const, count, prompt: input.goal, generationId: input.generationId };
        } catch { /* Ordinary chat text is not a generated task. */ }
    }
    const image = /^请使用 Codex 内置 imagegen 生成 (\d+) 张图片。\n\n创作要求：\n([\s\S]*?)\n\n画面规格：([^。]+)。/.exec(text);
    if (image) return { mode: "image" as const, count: Number(image[1]), prompt: image[2].trim(), size: image[3] };
    const copy = /^请使用 Codex 完成 (\d+) 版画布文案。\n\n创作要求：\n([\s\S]*?)\n\n先读取当前画布/.exec(text);
    return copy ? { mode: "text" as const, count: Number(copy[1]), prompt: copy[2].trim() } : null;
}

export function getInputSummary(inputs: NodeGenerationInput[]) {
    const resources = [...new Map(inputs.flatMap((input) => (input.type === "group" ? input.children : [input])).map((input) => [input.nodeId, input])).values()];
    return {
        textCount: resources.filter((input) => input.type === "text").length,
        imageCount: resources.filter((input) => input.type === "image").length,
        videoCount: resources.filter((input) => input.type === "video").length,
        audioCount: resources.filter((input) => input.type === "audio").length,
    };
}

export function buildGenerationConfig(config: AiConfig, node: CanvasNodeData | undefined, mode: CanvasNodeGenerationMode): AiConfig {
    return {
        ...config,
        model: mode === "text" ? "gpt-6.1-sol" : resolveModelForCapability(config, node?.metadata?.model, mode),
        reasoningEffort: node?.metadata?.reasoningEffort || config.reasoningEffort || defaultConfig.reasoningEffort,
        quality: node?.metadata?.quality || config.quality || defaultConfig.quality,
        size: node?.metadata?.size || config.size || defaultConfig.size,
        background: node?.metadata?.background ?? config.background ?? defaultConfig.background,
        videoSeconds: node?.metadata?.seconds || config.videoSeconds || defaultConfig.videoSeconds,
        vquality: node?.metadata?.vquality || config.vquality || defaultConfig.vquality,
        videoGenerateAudio: node?.metadata?.generateAudio || config.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node?.metadata?.watermark || config.videoWatermark || defaultConfig.videoWatermark,
        videoMode: node?.metadata?.videoMode || config.videoMode || defaultConfig.videoMode,
        audioVoice: node?.metadata?.audioVoice || config.audioVoice || defaultConfig.audioVoice,
        audioFormat: node?.metadata?.audioFormat || config.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node?.metadata?.audioSpeed || config.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node?.metadata?.audioInstructions || config.audioInstructions || defaultConfig.audioInstructions,
        count: String(node?.metadata?.count || (mode === "image" ? config.canvasImageCount || config.count : config.count) || defaultConfig.count),
    };
}

export function hasResumableVideoTask(node: CanvasNodeData) {
    return node.type === CanvasNodeType.Video && Boolean(node.metadata?.videoTaskId) && !node.metadata?.content;
}

export function resetInterruptedGeneration(nodes: CanvasNodeData[]) {
    return nodes.map((node) =>
        node.metadata?.status === "loading"
            ? hasResumableVideoTask(node)
                ? node
                : {
                      ...node,
                      metadata: {
                          ...node.metadata,
                          status: "error" as const,
                          errorDetails: i18n.t("canvas.generation.interrupted"),
                          images: node.metadata.images?.map((image) => (image.status === "loading" ? { ...image, status: "error" as const, errorDetails: i18n.t("canvas.generation.interrupted") } : image)),
                          texts: node.metadata.texts?.map((text) => (text.status === "loading" ? { ...text, status: "error" as const, errorDetails: i18n.t("canvas.generation.interrupted") } : text)),
                      },
                  }
            : node,
    );
}

export function isGenerationCanceled(error: unknown) {
    return error instanceof Error && (error.message === i18n.t("common.requestCanceled") || error.name === "AbortError");
}

export function findRetrySourceNode(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const queue = connections.filter((connection) => connection.toNodeId === nodeId).map((connection) => connection.fromNodeId);
    const visited = new Set<string>();
    while (queue.length) {
        const id = queue.shift()!;
        if (visited.has(id)) continue;
        visited.add(id);
        const node = nodes.find((item) => item.id === id);
        if (node?.type === CanvasNodeType.Config) return node;
        connections.filter((connection) => connection.toNodeId === id).forEach((connection) => queue.push(connection.fromNodeId));
    }
    return null;
}

export function sourceNodeReferenceImages(node: CanvasNodeData | null) {
    if (!node || node.type !== CanvasNodeType.Image || !node.metadata?.content) return [];
    return [
        {
            id: node.id,
            name: `${node.title || node.id}.png`,
            type: node.metadata.mimeType || "image/png",
            dataUrl: node.metadata.content,
            storageKey: node.metadata.storageKey,
        },
    ];
}

export function isAudioFile(file: File) {
    return file.type.startsWith("audio/") || /\.(mp3|wav)$/i.test(file.name);
}

export function buildAngleLabel(params: CanvasImageAngleParams) {
    const horizontal = params.horizontalAngle === 0 ? i18n.t("canvas.generation.front") : params.horizontalAngle > 0 ? i18n.t("canvas.generation.rotateRight", { angle: params.horizontalAngle }) : i18n.t("canvas.generation.rotateLeft", { angle: Math.abs(params.horizontalAngle) });
    const pitch = params.pitchAngle === 0 ? i18n.t("canvas.generation.level") : params.pitchAngle > 0 ? i18n.t("canvas.generation.topDown", { angle: params.pitchAngle }) : i18n.t("canvas.generation.lowAngle", { angle: Math.abs(params.pitchAngle) });
    return i18n.t("canvas.generation.angleLabel", { horizontal, pitch, distance: params.cameraDistance.toFixed(1), lens: i18n.t(params.wideAngle ? "canvas.editors.wide" : "canvas.editors.standard") });
}

export function buildAnglePrompt(params: CanvasImageAngleParams) {
    return i18n.t("canvas.generation.anglePrompt", { angle: buildAngleLabel(params) });
}
