import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { competitionCreativeBrief } from "./src/lib/competition-brief";

export function comfyArtHandoff(artifact: { kind: string; title: string; data?: unknown }) {
    if (artifact.kind !== "canvas_task" || !artifact.data || typeof artifact.data !== "object") throw new Error("未取得完整的创作任务。");
    const data = artifact.data as Record<string, unknown>;
    if (data.directionPending) throw new Error("投稿任务范围存在冲突，请重新核对。");
    const support = data.creationSupport as { status?: string; reason?: string } | undefined;
    if (support?.status === "unsupported") throw new Error(support.reason || "当前工作台暂不支持此创作任务。");
    if (data.submissionOptions) throw new Error("请先选择准确的提交形式。");
    const text = (key: string) => typeof data[key] === "string" ? data[key] as string : "";
    if (!text("creativeContent").trim() && !text("themeTask").trim()) throw new Error("缺少具体创作内容，暂不能进入创作。");
    const source = JSON.stringify(artifact.data);
    const version = createHash("sha256").update(source).digest("hex");
    const projectId = `pi-${version}`;
    return { projectId, version, title: text("title") || artifact.title,
        goal: competitionCreativeBrief(text("themeTask"), text("submissionFormat"), text("finalSubmissionFormat"), text("creativeContent") || undefined),
        fullTask: artifact.data };
}

export async function saveComfyArtHandoff(root: string, artifact: Parameters<typeof comfyArtHandoff>[0]) {
    const handoff = comfyArtHandoff(artifact);
    const folder = path.join(root, "workspace/comfyart-runtime/handoffs");
    await mkdir(folder, { recursive: true });
    const file = path.join(folder, `${handoff.projectId}.json`);
    const body = JSON.stringify(handoff);
    try { await writeFile(file, body, { flag: "wx" }); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST" || await readFile(file, "utf8") !== body) throw error;
    }
    return { projectId: handoff.projectId, url: `/comfyart/?project=${handoff.projectId}&new=1&competition=${handoff.projectId}` };
}

export async function readComfyArtHandoff(root: string, id: string) {
    if (!/^pi-[a-f0-9]{64}$/.test(id)) throw new Error("无效的创作任务编号。");
    return JSON.parse(await readFile(path.join(root, "workspace/comfyart-runtime/handoffs", `${id}.json`), "utf8"));
}
