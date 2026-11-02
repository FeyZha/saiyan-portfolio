import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";
import { ExperimentFiles, serializeArtifact } from "./tool-storage.js";
import type { PreparedMaterialsBundle, PreparedTask, PreparedRule } from "./prepared-materials.js";
import type { CompetitionPageLink } from "./competition-page-link.js";
import type { SubmissionDeliverable } from "./submission-overview.js";
import { CURRENT_COMPETITION_CONTRACT } from "./current-contract.js";

export type StoredTaskCard = { scopePointer: string; title: string; description?: string; submission?: string;
    deliverables: SubmissionDeliverable[]; group?: string; options?: StoredSubmissionOption[] };
export type StoredSubmissionOption = Omit<StoredTaskCard, "options"> & { choiceId: string; label: string; content: PreparedTask; rules: PreparedRule[] };
export const COMPETITION_CARD_VERSION = 4 as const;
export type StoredCompetitionCards = { version: typeof COMPETITION_CARD_VERSION; identity: PreparedMaterialsBundle["identity"]; materialHash: string;
    competitionLink?: CompetitionPageLink; tasks: StoredTaskCard[] };
export const cardCanonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export const cardHash = (value: unknown) => createHash("sha256").update(cardCanonical(value)).digest("hex");
class CardFiles extends ExperimentFiles {
    override readonly base: string;
    constructor(root: string) { super(root); this.base = path.resolve(root, "workspace/competition-sources"); }
}
export const competitionCardPath = (bundle: PreparedMaterialsBundle) => `cards/v${COMPETITION_CARD_VERSION}/${cardHash(bundle.identity.libraryId)}/${cardHash(bundle)}.json`;
function validate(cards: StoredCompetitionCards, bundle: PreparedMaterialsBundle) {
    if (bundle.contract !== CURRENT_COMPETITION_CONTRACT || cards.version !== COMPETITION_CARD_VERSION || cards.materialHash !== cardHash(bundle) || cardCanonical(cards.identity) !== cardCanonical(bundle.identity)
        || !Array.isArray(cards.tasks) || cards.tasks.length !== bundle.tasks.length) throw new Error("卡片资料版本或范围不一致");
    const scopes = new Set<string>();
    for (const task of cards.tasks) {
        const original = bundle.tasks.find(item => item.scopePointer === task.scopePointer);
        if (!original || scopes.has(task.scopePointer) || task.title !== original.title || !Array.isArray(task.deliverables)
            || task.deliverables.some(item => !item || typeof item.name !== "string" || !item.name.trim()
                || [item.details, item.description, item.condition].some(value => value !== undefined && typeof value !== "string"))) throw new Error("卡片任务内容或范围无效");
        if (task.deliverables.some(item => /\br\d+\b|https?:|[\w.+-]+@[\w.-]+/i.test(cardCanonical(item))))
            throw new Error("卡片不能包含内部规则编号或投稿网址邮箱");
        if (task.options) {
            const choices = new Set<string>();
            if (!Array.isArray(task.options) || task.options.length < 2) throw new Error("可选提交条目必须明确列出不同结果");
            for (const option of task.options) {
                if (!/^[a-f0-9]{64}$/.test(option.choiceId) || choices.has(option.choiceId) || option.scopePointer !== task.scopePointer
                    || option.title !== option.content.title || option.content.scopePointer !== task.scopePointer || option.content.id !== original.id || !option.title
                    || option.rules.some(rule => !original.ruleRefs.includes(rule.id) || !rule.appliesTo.includes(original.id))
                    || option.deliverables.some(item => !item.name || /\br\d+\b|https?:|[\w.+-]+@[\w.-]+/i.test(cardCanonical(item))))
                    throw new Error("可选提交条目的内容或范围无效");
                choices.add(option.choiceId);
            }
        }
        scopes.add(task.scopePointer);
    }
}
/** Query path: only read and validate the stored card. No synthesis, cache fill or write fallback. */
export async function readCompetitionCards(root: string, bundle: PreparedMaterialsBundle): Promise<StoredCompetitionCards> {
    let value;
    try { value = JSON.parse((await new CardFiles(root).read(competitionCardPath(bundle))).toString("utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("卡片资料尚未整理，请更新入库资料。"); throw error; }
    const { integrityHash, ...cards } = value;
    if (integrityHash !== cardHash(cards)) throw new Error("卡片资料校验失败");
    validate(cards, bundle);
    return cards;
}
/** Intake/maintenance only. New versions are append-only; existing originals never change. */
export async function saveCompetitionCards(root: string, bundle: PreparedMaterialsBundle, cards: StoredCompetitionCards) {
    validate(cards, bundle);
    const files = new CardFiles(root), relative = competitionCardPath(bundle), file = await files.resolve(relative, true);
    return serializeArtifact(file, async () => {
        try {
            const stored = await readCompetitionCards(root, bundle);
            if (cardCanonical(stored) !== cardCanonical(cards)) throw new Error("同一资料版本的卡片已保存，禁止查询或整理时覆盖原件");
            return { relative, created: false };
        } catch (error) { if (!(error instanceof Error) || error.message !== "卡片资料尚未整理，请更新入库资料。") throw error; }
        // Link a fully written file atomically; unlike rename this cannot replace another publisher's card.
        const temporary = `${relative}.${randomUUID()}.pending`;
        await files.json(temporary, { ...cards, integrityHash: cardHash(cards) });
        try { await fs.link(await files.resolve(temporary), file); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
            if (cardCanonical(await readCompetitionCards(root, bundle)) !== cardCanonical(cards)) throw new Error("卡片被并发更新，原件已保留");
            return { relative, created: false };
        } finally { await fs.unlink(await files.resolve(temporary)); }
        return { relative, created: true };
    });
}
