import { resolvePiModel, type PiModelConfig, type PiModelDependencies } from "./model.js";

// Product policy: legacy saved API choices remain readable but cannot route new work.
export const CODEX_MODEL = { mode: "oauth", provider: "openai-codex", model: "gpt-6.1-sol" } as const;
export function assertCodexConfig(config: PiModelConfig): asserts config is Extract<PiModelConfig, { mode: "oauth" }> {
    if (config.mode !== "oauth" || config.provider !== "openai-codex" || config.model && config.model !== CODEX_MODEL.model)
        throw new Error("当前所有文字模型任务只使用 Codex 登录额度，不切换 API 渠道。");
}
export const resolveProductModel = (_config: PiModelConfig = CODEX_MODEL, dependencies: PiModelDependencies = {}) =>
    resolvePiModel(CODEX_MODEL, { ...dependencies, readPiCredential: () => undefined });
