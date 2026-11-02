import { cjk } from "@streamdown/cjk";
import type { PluginConfig } from "streamdown";
import type { Plugin } from "unified";
import type {} from "remark-parse";

const remarkEmphasisBeforeAutolinks: Plugin = function () {
    const data = this.data();
    // Let emphasis parse before bare URLs. GFM's existing mdast transform still
    // links the resulting text, without swallowing closing ** into the URL.
    (data.micromarkExtensions ??= []).push({
        disable: { null: ["wwwAutolink", "protocolAutolink", "emailAutolink"] },
    });
};

// Shared by live answers, restored history, comparisons and candidate prose.
// Only parsing changes: saved Markdown and Streamdown's safety defaults stay intact.
export const competitionMarkdownPlugins: PluginConfig = {
    cjk: { ...cjk, remarkPluginsBefore: [...cjk.remarkPluginsBefore, remarkEmphasisBeforeAutolinks] },
};
