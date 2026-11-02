import { nameKey } from "./competition-identities.js";
import { currentCreativeContent } from "./current-contract.js";
import type { PreparedMaterialsRead } from "./prepared-materials.js";

type Entry = { libraryId: string; title?: unknown };
export type DirectoryReference = { parentId: string; scopePointer: string; competitionId: string };
/** A source-backed directory reference is navigation, not permission to copy another task's facts. */
export async function resolveDirectoryReferences(entries: Entry[], materials: Map<string, PreparedMaterialsRead>, sourceText: (id: string) => Promise<string>): Promise<DirectoryReference[]> {
    const result: DirectoryReference[] = [];
    for (const parent of entries) {
        const material = materials.get(parent.libraryId);
        if (material?.status !== "ready" || !material.bundle) continue;
        const parentName = nameKey(String(parent.title));
        for (const task of material.bundle.tasks) {
            if (currentCreativeContent(task)) continue;
            const taskName = nameKey(task.title);
            if (!material.bundle.evidence.some(e => task.evidenceRefs.includes(e.id) && nameKey(e.quote).includes(taskName))) continue;
            // Both the full parent identity (including edition) and the complete topic must occur
            // in the child title, and its verified source body must name that same parent.
            const matches = entries.filter(child => child.libraryId !== parent.libraryId
                && nameKey(String(child.title)).includes(parentName) && nameKey(String(child.title)).includes(taskName)
                && materials.get(child.libraryId)?.status === "ready");
            if (matches.length === 1 && nameKey(await sourceText(matches[0].libraryId)).includes(nameKey(String(matches[0].title)))) result.push({ parentId: parent.libraryId, scopePointer: task.scopePointer, competitionId: matches[0].libraryId });
        }
    }
    return result;
}
