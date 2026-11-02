export type Position = {
    x: number;
    y: number;
};

export type ViewportTransform = {
    x: number;
    y: number;
    k: number;
};

export enum CanvasNodeType {
    Image = "image",
    Text = "text",
    Config = "config",
    Video = "video",
    Audio = "audio",
    Group = "group",
}

// Node types are open strings: built-ins use CanvasNodeType and plugins use "<pluginId>:<name>".
export type CanvasNodeTypeId = CanvasNodeType | (string & {});

export type CanvasNodeStatus = "idle" | "success" | "loading" | "error";
export type CanvasGenerationMode = "text" | "image" | "video" | "audio";
export type CanvasImageGenerationType = "generation" | "edit";

export type CanvasPixelRect = { x: number; y: number; width: number; height: number };
export type CanvasStoredImage = { content: string; storageKey?: string; width: number; height: number };
export type CanvasRefinementMapping = {
    imageWidth: number;
    imageHeight: number;
    target: CanvasPixelRect;
    generationWindow: CanvasPixelRect;
    writeback: CanvasPixelRect;
    source: CanvasPixelRect;
    padding: { left: number; top: number; right: number; bottom: number };
    generationSize: number;
};
export type CanvasPatchTransform = { offsetX: number; offsetY: number; scale: number };
export type CanvasBoardLayer =
    | { id: string; kind: "patch"; title: string; image: CanvasStoredImage; mapping: CanvasRefinementMapping; transform: CanvasPatchTransform; hidden?: boolean; sourceCandidateId?: string }
    | { id: string; kind: "text"; title: string; text: string; fontFamily: string; fontSize: number; color: string; backgroundColor: string; x: number; y: number; width: number; height: number; hidden?: boolean }
    | { id: string; kind: "asset"; title: string; image: CanvasStoredImage; x: number; y: number; width: number; height: number; hidden?: boolean };
export type CanvasBoardVersion = { rootNodeId: string; revision: number; base: CanvasStoredImage; layers: CanvasBoardLayer[] };
export type CanvasRefinementTask = {
    id: string;
    status: "running" | "candidate" | "failed";
    mapping: CanvasRefinementMapping;
    instruction: string;
    preserve: string;
    replaceLayerId?: string;
    error?: string;
};
export type CanvasRefinementCandidate = Omit<CanvasRefinementTask, "status" | "error"> & { status: "candidate" | "applied"; baseNodeId: string; baseRevision: number };

export type CanvasNodeImage = {
    id: string;
    status: CanvasNodeStatus;
    errorDetails?: string;
    content: string;
    storageKey?: string;
    naturalWidth: number;
    naturalHeight: number;
    bytes: number;
    mimeType: string;
};

export type CanvasNodeText = {
    id: string;
    status: CanvasNodeStatus;
    errorDetails?: string;
    content: string;
};

export type CanvasNodeMetadata = {
    content?: string;
    composerContent?: string;
    prompt?: string;
    planGenerationId?: string;
    planSourceNodeId?: string;
    status?: CanvasNodeStatus;
    errorDetails?: string;
    fontSize?: number;
    generationMode?: CanvasGenerationMode;
    generationEngine?: "codex" | "api";
    generationType?: CanvasImageGenerationType;
    model?: string;
    reasoningEffort?: "auto" | "low" | "medium" | "high" | "xhigh";
    size?: string;
    sizeManuallySelected?: boolean;
    quality?: string;
    background?: string;
    count?: number;
    textCount?: number;
    texts?: CanvasNodeText[];
    primaryTextId?: string;
    seconds?: string;
    vquality?: string;
    generateAudio?: string;
    watermark?: string;
    videoMode?: string;
    audioVoice?: string;
    audioFormat?: string;
    audioSpeed?: string;
    audioInstructions?: string;
    references?: string[];
    naturalWidth?: number;
    naturalHeight?: number;
    freeResize?: boolean;
    images?: CanvasNodeImage[];
    primaryImageId?: string;
    storageKey?: string;
    mimeType?: string;
    bytes?: number;
    durationMs?: number;
    videoTaskId?: string;
    videoTaskProvider?: "openai" | "gemini";
    groupId?: string;
    interactive?: boolean; // Plugin node interaction/move state; see CanvasNodeDefinition.interactionToggle.
    boardVersion?: CanvasBoardVersion;
    refinementTask?: CanvasRefinementTask;
    refinementCandidate?: CanvasRefinementCandidate;
};

export type CanvasNodeData = {
    id: string;
    type: CanvasNodeTypeId;
    title: string;
    position: Position;
    width: number;
    height: number;
    metadata?: CanvasNodeMetadata;
};

export type CanvasConnection = {
    id: string;
    fromNodeId: string;
    toNodeId: string;
};

export type CanvasAssistantReference = {
    id: string;
    type: CanvasNodeTypeId;
    title: string;
    dataUrl?: string;
    storageKey?: string;
    text?: string;
};

export type CanvasAssistantImage = {
    id: string;
    dataUrl: string;
    storageKey?: string;
    prompt: string;
};

export type CanvasAssistantMessage = {
    id: string;
    role: "user" | "assistant" | "system" | "tool" | "error";
    title?: string;
    text: string;
    meta?: string;
    detail?: unknown;
    references?: CanvasAssistantReference[];
};

export type CanvasAssistantSession = {
    id: string;
    title: string;
    messages: CanvasAssistantMessage[];
    createdAt: string;
    updatedAt: string;
};

export type ConnectionHandle = {
    nodeId: string;
    handleType: "source" | "target";
};

export type SelectionBox = {
    startWorldX: number;
    startWorldY: number;
    currentWorldX: number;
    currentWorldY: number;
    additive: boolean;
    initialSelectedNodeIds: string[];
};

export type ContextMenuState =
    | {
          type: "node";
          x: number;
          y: number;
          nodeId: string;
      }
    | {
          type: "connection";
          x: number;
          y: number;
          connectionId: string;
      };
