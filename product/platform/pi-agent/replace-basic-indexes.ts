import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { readCompetitionLibrary, readSixFieldEntry, type LibraryCompetition } from "./competition-library.js";
import { BASIC_FIELD_KEYS } from "./six-field-index.js";

type Hashes = Record<string, string>;
export type ReplaceBasicIndexesOptions = {
    repoRoot: string; stagedRoot: string; backupRoot: string; expectedHashes: Hashes;
    journalPath?: string; signal?: AbortSignal;
};
type Replacement = { path: string; before: string; after: string };
type Dependencies = { afterReplace?: (replacement: Replacement, count: number) => void | Promise<void> };
const libraryRelative = "workspace/competition-sources";
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const indexPath = (file: string) => /^six-fields\/[a-zA-Z0-9_-]+\.json$/.test(file);
const keys = (value: object) => Object.keys(value).sort();
const equalKeys = (a: object, b: object) => JSON.stringify(keys(a)) === JSON.stringify(keys(b));
const inside = (parent: string, child: string) => {
    const relative = path.relative(parent, child);
    return !relative || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
};

/** Reject symlinks/junctions in every existing component, including ancestors of the supplied root. */
async function checkedPath(value: string, allowMissingLeaf = false) {
    if (!path.isAbsolute(value)) throw new Error("替换路径必须是绝对路径");
    const target = path.resolve(value), root = path.parse(target).root;
    let current = root;
    const components = path.relative(root, target).split(path.sep).filter(Boolean);
    for (const [index, component] of components.entries()) {
        current = path.join(current, component);
        let stat;
        try { stat = await fs.lstat(current); }
        catch (error) {
            if (allowMissingLeaf && index === components.length - 1 && (error as NodeJS.ErrnoException).code === "ENOENT") return target;
            throw error;
        }
        if (stat.isSymbolicLink()) throw new Error("替换路径不能包含符号链接或目录联接");
        if (index < components.length - 1 && !stat.isDirectory()) throw new Error("替换父路径不是目录");
    }
    return target;
}

/** Inventory all bytes; directory links and nonregular files are never followed. Keys are library-relative. */
export async function basicIndexLibraryHashes(repoRoot: string): Promise<Hashes> {
    const base = await checkedPath(path.join(repoRoot, libraryRelative));
    if (!(await fs.lstat(base)).isDirectory()) throw new Error("竞赛资料目录不存在");
    const result: Hashes = {};
    const visit = async (folder: string, prefix: string) => {
        for (const entry of (await fs.readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
            const target = await checkedPath(path.join(folder, entry.name)), relative = `${prefix}${entry.name}`;
            const stat = await fs.lstat(target);
            if (stat.isDirectory()) await visit(target, `${relative}/`);
            else if (stat.isFile()) result[relative] = hash(await fs.readFile(target));
            else throw new Error(`竞赛资料包含非普通文件：${relative}`);
        }
    };
    await visit(base, "");
    return result;
}

function assertInventory(actual: Hashes, expected: Hashes, label: string) {
    if (!equalKeys(actual, expected)) throw new Error(`${label}文件集合已变化，未覆盖`);
    for (const file of keys(expected)) if (actual[file] !== expected[file]) throw new Error(`${label}文件已变化：${file}，未覆盖`);
}
function competitions(library: Awaited<ReturnType<typeof readCompetitionLibrary>>) {
    if (library.status !== "ready") throw new Error("替换前竞赛资料库未就绪");
    return [...library.items, ...library.pending, ...library.ignored];
}
async function validateStage(stagedRoot: string, expected: Hashes, original: Map<string, LibraryCompetition>) {
    const staged = await basicIndexLibraryHashes(stagedRoot);
    if (!equalKeys(staged, expected)) throw new Error("暂存库文件集合与原库不同");
    for (const file of keys(expected)) if (!indexPath(file) && staged[file] !== expected[file]) throw new Error(`暂存库改动了索引之外的原件：${file}`);
    const library = competitions(await readCompetitionLibrary(stagedRoot));
    const indices = keys(expected).filter(indexPath);
    const expectedPaths = Object.fromEntries(library.map(competition => [`six-fields/${competition.libraryId}.json`, true]));
    if (!equalKeys(expectedPaths, Object.fromEntries(indices.map(file => [file, true]))) || library.length !== original.size) throw new Error("暂存三项索引没有完整对应原竞赛集合");
    for (const competition of library) {
        if (competition.revision !== original.get(competition.libraryId)?.revision) throw new Error(`暂存库改动了竞赛版本：${competition.libraryId}`);
        const result = await readSixFieldEntry(stagedRoot, competition);
        if (result.status !== "ready" || result.entry?.version !== 2
            || !equalKeys(result.entry.fields, Object.fromEntries(BASIC_FIELD_KEYS.map(key => [key, true]))))
            throw new Error(`暂存三项索引校验失败：${competition.libraryId} (${result.status})`);
    }
    return staged;
}

/** Only explicitly authorized whole-index maintenance uses this replacement path. Routine ingestion still refuses overwrite. */
export async function replaceBasicIndexes(options: ReplaceBasicIndexesOptions, dependencies: Dependencies = {}) {
    const { expectedHashes, signal } = options;
    for (const [file, digest] of Object.entries(expectedHashes)) {
        if (!file || file.includes("\\") || file.split("/").some(part => !part || part === "." || part === "..") || !/^[a-f0-9]{64}$/.test(digest)) throw new Error("原库哈希清单无效");
        if (file.startsWith("six-fields/") && !indexPath(file)) throw new Error("原库索引目录包含未预期文件");
    }
    if (!keys(expectedHashes).some(indexPath)) throw new Error("原库哈希清单没有可替换索引");
    for (const root of [options.repoRoot, options.stagedRoot, options.backupRoot]) if (!path.isAbsolute(root)) throw new Error("替换路径必须是绝对路径");
    const roots = await Promise.all([options.repoRoot, options.stagedRoot, options.backupRoot].map(root => checkedPath(path.resolve(root))));
    const [repoRoot, stagedRoot, backupRoot] = roots;
    const bases = roots.map(root => path.join(root, libraryRelative));
    for (let i = 0; i < bases.length; i++) for (let j = i + 1; j < bases.length; j++) if (inside(bases[i], bases[j]) || inside(bases[j], bases[i])) throw new Error("原库、暂存库和备份库必须相互独立");
    const journalPath = options.journalPath ? await checkedPath(options.journalPath, true) : undefined;
    if (journalPath && bases.some(base => inside(base, journalPath))) throw new Error("替换日志必须在竞赛资料目录之外");
    if (journalPath) {
        try { await fs.lstat(journalPath); throw new Error("替换日志已存在，保留原文件"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    const replacements: Replacement[] = [], restored: string[] = [];
    let journalState = "validating", journalCreated = false;
    const writeJournal = async () => {
        if (!journalPath) return;
        await checkedPath(journalPath, true);
        const handle = await fs.open(journalPath, journalCreated ? "w" : "wx", 0o600);
        journalCreated = true;
        try { await handle.writeFile(JSON.stringify({ version: 1, state: journalState, replacements, restored }, null, 2)); await handle.sync(); }
        finally { await handle.close(); }
    };
    const assertNotCancelled = () => { if (signal?.aborted) throw new Error("三项索引替换已取消"); };
    assertNotCancelled();
    assertInventory(await basicIndexLibraryHashes(repoRoot), expectedHashes, "原库");
    assertInventory(await basicIndexLibraryHashes(backupRoot), expectedHashes, "备份库");
    const original = new Map(competitions(await readCompetitionLibrary(repoRoot)).map(competition => [competition.libraryId, competition]));
    const stagedHashes = await validateStage(stagedRoot, expectedHashes, original);
    assertNotCancelled();
    assertInventory(await basicIndexLibraryHashes(repoRoot), expectedHashes, "原库");
    // Prepare one file in the same directory, fsync its bytes, then atomically rename over its checked predecessor.
    const atomicWrite = async (file: string, bytes: Buffer, expectedCurrent: string) => {
        const target = await checkedPath(path.join(bases[0], file));
        const temporary = await checkedPath(path.join(path.dirname(target), `.basic-index-${randomUUID()}.tmp`), true);
        try {
            const handle = await fs.open(temporary, "wx", 0o600);
            try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
            await checkedPath(target);
            if (hash(await fs.readFile(target)) !== expectedCurrent) throw new Error(`索引在替换期间发生变化：${file}`);
            await fs.rename(temporary, target);
        } finally { await fs.rm(temporary, { force: true }); }
    };
    try {
        journalState = "replacing"; await writeJournal();
        for (const file of keys(expectedHashes).filter(indexPath)) {
            assertNotCancelled();
            const staged = await checkedPath(path.join(bases[1], file)), bytes = await fs.readFile(staged);
            if (hash(bytes) !== stagedHashes[file]) throw new Error(`暂存索引在替换期间发生变化：${file}`);
            const replacement = { path: file, before: expectedHashes[file], after: stagedHashes[file] };
            await atomicWrite(file, bytes, replacement.before);
            replacements.push(replacement);
            await writeJournal();
            await dependencies.afterReplace?.(replacement, replacements.length);
        }
        assertNotCancelled();
        assertInventory(await basicIndexLibraryHashes(repoRoot), stagedHashes, "替换后原库");
        await validateStage(repoRoot, stagedHashes, original);
        journalState = "complete"; await writeJournal();
        return { status: "complete" as const, replaced: replacements.length, replacements, hashes: stagedHashes };
    } catch (error) {
        journalState = "rolling_back";
        const rollbackErrors: string[] = [];
        for (const replacement of [...replacements].reverse()) {
            try {
                const backup = await checkedPath(path.join(bases[2], replacement.path)), bytes = await fs.readFile(backup);
                if (hash(bytes) !== replacement.before) throw new Error("备份字节已变化");
                await atomicWrite(replacement.path, bytes, replacement.after);
                restored.push(replacement.path);
            } catch { rollbackErrors.push(replacement.path); }
        }
        journalState = rollbackErrors.length ? "rollback_conflict" : "rolled_back";
        try { if (journalCreated || !journalPath) await writeJournal(); }
        catch { throw new Error(`三项索引替换失败；日志保存失败${rollbackErrors.length ? "且部分回滚冲突" : "，已回滚索引"}`, { cause: error }); }
        if (rollbackErrors.length) throw new Error(`三项索引替换失败；并发改动或备份异常阻止回滚：${rollbackErrors.join(", ")}`, { cause: error });
        throw new Error("三项索引替换失败，已从完整备份恢复本次替换的索引", { cause: error });
    }
}
