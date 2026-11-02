import { loadBuffer, type CheerioAPI } from "cheerio";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

export type FormCondition = {
    fieldId: string; fieldLabel: string; requiredWhenVisible: boolean; relation: string; resolved: boolean;
    dependsOn?: { fieldId: string; fieldLabel: string; optionLabel: string };
};

export type ParsedMaterial = {
    status: "read" | "unsupported_image" | "no_text" | "unsupported";
    policy?: "text_only";
    kind: string;
    title?: string;
    text?: string;
    links?: { title: string; url: string }[];
    images?: { title: string; url: string }[];
    pages?: { num: number; text: string }[];
    totalPages?: number;
    warnings?: unknown[];
    formConditions?: FormCondition[];
};

function absoluteLink(value: string | undefined, base: string): string | undefined {
    if (!value) return;
    try { const url = new URL(value, base); if (["https:", "http:"].includes(url.protocol)) return url.href; }
    catch { /* A malformed link remains unavailable rather than becoming an invented URL. */ }
}

function formConditions($: CheerioAPI): FormCondition[] {
    const fields = $(".field[topic]").toArray();
    const label = (element: typeof fields[number]) => {
        const specific = $(element).find(".field-label .topichtml").first();
        const text = specific.length ? specific.text() : $(element).find(".field-label").first().clone().find(".req,.topicnumber").remove().end().text();
        return text.replace(/\s+/g, " ").trim();
    };
    return fields.map(element => {
        const field = $(element), relation = field.attr("relation") || "";
        const condition: FormCondition = { fieldId: field.attr("topic") || "", fieldLabel: label(element),
            requiredWhenVisible: field.attr("req") === "1", relation,
            resolved: !relation && !field.is("[hidden]") && !/display\s*:\s*none\b/i.test(field.attr("style") || "") };
        // shortcut: only one explicit question/option relation is decoded; compound or scripted visibility stays unresolved.
        const match = /^(\d+),(\d+)$/.exec(relation);
        const parents = match ? fields.filter(candidate => $(candidate).attr("topic") === match[1]) : [];
        if (parents.length === 1) {
            const parent = $(parents[0]), options = parent.find('input[type="radio"],input[type="checkbox"]').filter((_, option) => $(option).attr("value") === match![2]);
            const optionId = options.length === 1 ? options.attr("id") : undefined;
            const labels = optionId ? parent.find("[for]").filter((_, candidate) => $(candidate).attr("for") === optionId) : undefined;
            const optionLabel = labels?.length === 1 ? labels.text().replace(/\s+/g, " ").trim() : "";
            const fieldLabel = label(parents[0]);
            if (fieldLabel && optionLabel) {
                condition.dependsOn = { fieldId: match![1], fieldLabel, optionLabel };
                condition.resolved = true;
            }
        }
        return condition;
    });
}

export function parseHtml(bytes: Buffer, url: string): ParsedMaterial {
    const $ = loadBuffer(bytes);
    const conditions = formConditions($);
    const title = $("title").text().trim();
    const documentBase = absoluteLink($("base[href]").attr("href"), url) || url;
    const links = new Map<string, { title: string; url: string }>();
    $("a[href]").each((_, element) => {
        const link = absoluteLink($(element).attr("href"), documentBase);
        if (link && !links.has(link)) links.set(link, { title: $(element).text().trim(), url: link });
    });
    const images = new Map<string, { title: string; url: string }>();
    $("img").each((_, element) => {
        const link = absoluteLink($(element).attr("src") || $(element).attr("data-src"), documentBase);
        if (link && !images.has(link)) images.set(link, { title: $(element).attr("alt") || "", url: link });
    });
    $("script,style,noscript,template,svg,canvas").remove();
    $("br").replaceWith("\n");
    $("p,div,li,section,article,h1,h2,h3,h4,h5,h6,tr,header,footer").append("\n");
    const text = ($("body").length ? $("body").text() : $.root().text()).replace(/[\t ]+/g, " ").replace(/\n\s*\n\s*\n/g, "\n\n").trim();
    return { status: text ? "read" : "no_text", kind: "html", title, text, links: [...links.values()], images: [...images.values()],
        ...(conditions.length ? { formConditions: conditions } : {}) };
}

export function materialMime(name: string, reported = ""): string {
    if (reported && reported !== "application/octet-stream") return reported.split(";")[0].toLowerCase();
    const extension = name.split(/[?#]/)[0].split(".").pop()?.toLowerCase();
    return ({ pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", png: "image/png", apng: "image/apng", jpg: "image/jpeg", jpeg: "image/jpeg", jfif: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff", avif: "image/avif", heic: "image/heic", heif: "image/heif", ico: "image/x-icon", html: "text/html", htm: "text/html", txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json", svg: "image/svg+xml", svgz: "image/svg+xml" } as Record<string, string>)[extension || ""] || reported || "application/octet-stream";
}

export function isImageMaterial(value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return record.ocr !== undefined || record.kind === "machine_transcription" || record.kind === "image"
        || record.materialKind === "image" || record.status === "image_available"
        || (typeof record.mimeType === "string" && record.mimeType.startsWith("image/"))
        || (typeof record.kind === "string" && record.kind.startsWith("image/"))
        || [record.url, record.sourceUrl, record.originalPath].some(name => typeof name === "string" && materialMime(name).startsWith("image/"));
}

export async function parseMaterial(bytes: Buffer, name: string, reportedMime = "", contentType = ""): Promise<ParsedMaterial> {
    const mime = materialMime(name, reportedMime);
    if (mime.startsWith("image/") || materialMime(name).startsWith("image/")) return { status: "unsupported_image", kind: "image", policy: "text_only" };
    if (mime === "application/json" || materialMime(name) === "application/json") {
        let saved: unknown;
        try { saved = JSON.parse(bytes.toString("utf8")); } catch { /* Ordinary malformed text remains available for inspection. */ }
        if (isImageMaterial(saved)) return { status: "unsupported_image", kind: "image", policy: "text_only" };
    }
    if (mime === "application/pdf") {
        const parser = new PDFParse({ data: bytes });
        try {
            const result = await parser.getText();
            return { status: result.pages.some(page => page.text.trim()) ? "read" : "no_text", kind: "pdf", text: result.text, pages: result.pages, totalPages: result.total };
        } finally { await parser.destroy(); }
    }
    if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
        const result = await mammoth.extractRawText({ buffer: bytes });
        return { status: result.value.trim() ? "read" : "no_text", kind: "docx", text: result.value, warnings: result.messages };
    }
    if (mime === "text/html" || mime === "application/xhtml+xml") return parseHtml(bytes, name);
    if (mime.startsWith("text/") || ["application/json", "application/xml"].includes(mime)) {
        const charset = /charset\s*=\s*["']?([^\s;"']+)/i.exec(contentType)?.[1] || "utf-8";
        const text = new TextDecoder(charset).decode(bytes);
        return { status: text.trim() ? "read" : "no_text", kind: "text", text };
    }
    return { status: "unsupported", kind: "binary" };
}
