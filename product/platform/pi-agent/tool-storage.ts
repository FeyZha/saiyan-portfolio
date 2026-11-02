import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const writes = new Map<string, Promise<unknown>>();
export async function serializeArtifact<T>(file: string, operation: () => Promise<T>): Promise<T> {
    const current = (writes.get(file) || Promise.resolve()).catch(() => {}).then(operation);
    writes.set(file, current);
    try { return await current; }
    finally { if (writes.get(file) === current) writes.delete(file); }
}

/** Every tool file lives below this experiment's own directory. */
export class ExperimentFiles {
    readonly base: string;
    constructor(repoRoot: string) { this.base = path.resolve(repoRoot, "workspace/pi-agent"); }

    relative(file: string) { return path.relative(this.base, file).split(path.sep).join("/"); }

    async resolve(file: string, createParents = false): Promise<string> {
        const target = path.resolve(this.base, file);
        const relative = path.relative(this.base, target);
        if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
            throw new Error("只能访问 workspace/pi-agent 内的实验资料");
        }
        // Check before creating each component: mkdir(recursive) would follow existing symlinks.
        const repo = path.resolve(this.base, "../..");
        let current = repo;
        const components = path.relative(repo, target).split(path.sep).filter(Boolean);
        for (const [index, component] of components.entries()) {
            current = path.join(current, component);
            let stat;
            try { stat = await fs.lstat(current); }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
                if (index < components.length - 1 && createParents) {
                    try { await fs.mkdir(current); }
                    catch (creationError) { if ((creationError as NodeJS.ErrnoException).code !== "EEXIST") throw creationError; }
                    stat = await fs.lstat(current);
                }
            }
            if (stat?.isSymbolicLink()) throw new Error("实验资料路径不能包含符号链接");
            if (stat && index < components.length - 1 && !stat.isDirectory()) throw new Error("资料父路径不是目录");
        }
        return target;
    }

    async write(file: string, contents: string | Uint8Array): Promise<string> {
        const target = await this.resolve(file, true);
        const temporary = `${target}.${randomUUID()}.tmp`;
        try {
            const handle = await fs.open(temporary, "wx", 0o600);
            try { await handle.writeFile(contents); await handle.sync(); }
            finally { await handle.close(); }
            await this.resolve(file);
            await fs.rename(temporary, target);
        } finally { await fs.rm(temporary, { force: true }); }
        return target;
    }

    async json(file: string, data: unknown) { return this.write(file, JSON.stringify(data, null, 2)); }

    async read(file: string) { return fs.readFile(await this.resolve(file)); }

    async list(directory = ".", recursive = false): Promise<{ path: string; kind: string; bytes?: number }[]> {
        const target = await this.resolve(directory);
        let entries;
        try { entries = await fs.readdir(target, { withFileTypes: true }); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
        const result: { path: string; kind: string; bytes?: number }[] = [];
        for (const entry of entries) {
            const file = path.join(target, entry.name);
            // Never traverse a symlink, even one that currently points inside the experiment.
            if (entry.isSymbolicLink()) { result.push({ path: this.relative(file), kind: "symlink_unread" }); continue; }
            const stat = await fs.stat(file);
            result.push({ path: this.relative(file), kind: entry.isDirectory() ? "directory" : "file", bytes: stat.size });
            if (recursive && entry.isDirectory()) result.push(...await this.list(this.relative(file), true));
        }
        return result;
    }
}

export function artifactId(value: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error("资料 ID 无效");
    return value;
}
