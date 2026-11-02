import type { PiTask } from "@/services/api/pi-competitions";
import { directionBlockReason } from "../competition-results";

export function isLibraryTaskCard(task: PiTask) {
    return Boolean(task.agentData && typeof task.agentData === "object" && "recommendationPresentation" in task.agentData);
}

export function taskBlockReason(task: PiTask) {
    if (isLibraryTaskCard(task)) {
        if (task.directionPending) return "投稿任务范围存在冲突，请重新核对";
        if (!task.creativeContent?.trim()) return "具体创作要求尚待整理";
        if (task.deadline && task.deadline < new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" })) return "已截止";
        if (task.creationSupport?.status === "unsupported") return task.creationSupport.reason || "当前工作台暂不支持此创作任务";
        return "";
    }
    return directionBlockReason(task);
}
