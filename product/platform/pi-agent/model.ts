import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { createModels, createProvider, type Api, type Model } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAICodexResponsesApi } from "@earendil-works/pi-ai/api/openai-codex-responses.lazy";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { readStoredCredential } from "@earendil-works/pi-coding-agent";
import { proxyFetch } from "./tool-network.js";
import { observedModelFetch, type ModelTransportFailure } from "./model-transport.js";

export type PiModelConfig =
    | { mode: "api"; baseUrl: string; apiKey: string; model: string; apiFormat: "openai" }
    | { mode: "oauth"; provider: "openai-codex"; model?: string };

export interface PiModelDependencies {
    readPiCredential?: typeof readStoredCredential;
    readCodexAuth?: () => { tokens?: { access_token?: unknown } } | undefined;
    fetch?: typeof globalThis.fetch;
}

type TokenSource = "pi" | "codex-cli";
type LocalToken = { access: string; expires: number; source: TokenSource };
const DEFAULT_OAUTH_MODEL = "gpt-6.1-sol";
const runtimeFetch = proxyFetch as unknown as typeof globalThis.fetch;

function tokenInfo(access: unknown, source: TokenSource, expires?: unknown): LocalToken | undefined {
    if (typeof access !== "string") return;
    try {
        const parts = access.split(".");
        if (parts.length !== 3) return;
        const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
        const accountId = claims?.["https://api.openai.com/auth"]?.chatgpt_account_id;
        if (typeof accountId !== "string" || !accountId) return;
        const jwtExpires = typeof claims.exp === "number" ? claims.exp * 1000 : undefined;
        const storedExpires = typeof expires === "number" ? expires : undefined;
        const validUntil = jwtExpires !== undefined && storedExpires !== undefined
            ? Math.min(jwtExpires, storedExpires) : jwtExpires ?? storedExpires;
        if (!Number.isFinite(validUntil)) return;
        return { access, expires: validUntil!, source };
    } catch {
        return;
    }
}

// Reading never resolves key commands, refreshes shared tokens, or writes an auth file.
function readLocalToken(dependencies: PiModelDependencies): LocalToken | undefined {
    const native = (dependencies.readPiCredential ?? readStoredCredential)("openai-codex");
    const piToken = native?.type === "oauth" ? tokenInfo(native.access, "pi", native.expires) : undefined;
    if (piToken && piToken.expires > Date.now()) return piToken;
    let cliToken: LocalToken | undefined;
    try {
        const auth = dependencies.readCodexAuth ? dependencies.readCodexAuth() :
            JSON.parse(readFileSync(join(process.env.CODEX_HOME || join(homedir(), ".codex"), "auth.json"), "utf8"));
        cliToken = tokenInfo(auth?.tokens?.access_token, "codex-cli");
    } catch {
        // Missing, keychain-only, or unreadable CLI credentials are not a usable bridge.
    }
    return cliToken && cliToken.expires > Date.now() ? cliToken : piToken ?? cliToken;
}

export async function modelStatus(dependencies: PiModelDependencies = {}) {
    const token = readLocalToken(dependencies);
    const oauthAvailable = Boolean(token && token.expires > Date.now());
    const message = oauthAvailable
        ? "已连接本机 OAuth，凭据仅在内存中使用。"
        : token
          ? "本机登录已过期，请在 Pi 或 Codex CLI 中重新登录后重试。"
          : "未找到可用本机 OAuth，请在 Pi 的 OpenAI Codex 或 Codex CLI 中登录。";
    return {
        oauth: { available: oauthAvailable, reason: message, source: oauthAvailable ? token!.source : null },
        oauthAvailable,
        source: oauthAvailable ? token!.source : null,
        requiresLogin: !oauthAvailable,
        defaultModel: DEFAULT_OAUTH_MODEL,
        models: openaiCodexProvider().getModels().map(({ provider, id }) => ({ provider, id })),
        message,
    };
}

export async function resolvePiModel(config: PiModelConfig, dependencies: PiModelDependencies = {}): Promise<{
    model: Model<Api>;
    streamFn: StreamFn;
    modelInfo: { provider: string; id: string };
    secrets: string[];
    transportFailures?: ModelTransportFailure[];
}> {
    const models = createModels();
    const secrets: string[] = [];
    const transportFailures: ModelTransportFailure[] = [];
    const remember = (value: string) => {
        if (!secrets.includes(value)) secrets.push(value);
        return value;
    };
    let model: Model<Api>;
    let streamFn: StreamFn;

    if (config.mode === "api") {
        if (config.apiFormat !== "openai" || !config.baseUrl?.trim() || !config.apiKey?.trim() || !config.model?.trim()) {
            throw new Error("请配置 OpenAI 兼容接口的地址、API Key 和模型。");
        }
        const baseUrl = config.baseUrl.trim().replace(/\/+$/, "");
        const url = new URL(baseUrl);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
            throw new Error("模型地址必须是未含登录凭据的 HTTP 或 HTTPS 地址。");
        }
        model = {
            id: config.model.trim(), name: config.model.trim(), api: "openai-completions", provider: "saiyan-api",
            baseUrl, reasoning: false, input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            // Unknown endpoint metadata; request limits remain owned by the caller/provider.
            contextWindow: 0, maxTokens: 0,
        };
        const apiKey = remember(config.apiKey);
        models.setProvider(createProvider({
            id: model.provider, baseUrl, models: [model], api: openAICompletionsApi(),
            auth: { apiKey: { name: "已配置 API Key", resolve: async () => ({ auth: { apiKey } }) } },
        }));
        // streamSimple derives a token cap from model metadata; the custom endpoint has none.
        // The experiment's HTTP requests reuse the environment proxy/CA transport;
        // a caller's explicit fetch remains authoritative. No global dispatcher is changed.
        streamFn = (selected, context, options) => models.stream(selected, context, {
            ...options, fetch: observedModelFetch(options?.fetch ?? dependencies.fetch ?? runtimeFetch, transportFailures),
        });
    } else if (config.mode === "oauth" && config.provider === "openai-codex") {
        const initial = readLocalToken(dependencies);
        if (!initial || initial.expires <= Date.now()) throw new Error((await modelStatus(dependencies)).message);
        remember(initial.access);
        const catalog = openaiCodexProvider().getModels();
        const selected = catalog.find((item) => item.id === (config.model?.trim() || DEFAULT_OAUTH_MODEL));
        if (!selected) throw new Error("指定模型不在当前 Pi 的 OpenAI Codex 目录中，请重新选择模型。");
        model = selected;
        models.setProvider(createProvider({
            id: "openai-codex", models: catalog, api: openAICodexResponsesApi(),
            auth: { apiKey: {
                name: "本机 OAuth（只读）",
                resolve: async () => {
                    const current = readLocalToken(dependencies);
                    if (!current || current.expires <= Date.now()) {
                        throw new Error("本机 OAuth 已过期，请在 Pi 或 Codex CLI 中重新登录后重试。");
                    }
                    return { auth: { apiKey: remember(current.access) } };
                },
            } },
        }));
        // SSE uses the same injected HTTP transport as source reads; WebSocket fetch
        // overrides do not exist in pi-ai, so the experiment uses SSE explicitly.
        streamFn = (selected, context, options) => models.streamSimple(selected, context, {
            ...options, transport: "sse", fetch: observedModelFetch(options?.fetch ?? dependencies.fetch ?? runtimeFetch, transportFailures),
        });
    } else {
        throw new Error("不支持的 Pi 模型配置。");
    }
    return { model, streamFn, modelInfo: { provider: model.provider, id: model.id }, secrets, transportFailures };
}
