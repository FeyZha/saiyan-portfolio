// Historical evidence remains readable; image recognition and new OCR citations are disabled.
export type OcrProvenance = {
    kind: "machine_transcription"; sourceUrl: string; originalSha256: string;
    manifestPath: string; manifestSha256: string; warnings: unknown[];
};
export type OcrEvidenceProof = {
    evidenceKind: "machine_transcription"; originalSha256: string; sourceUrl: string; manifestPath: string; manifestSha256: string;
    tiles: { id: string; box: number[]; cropSha256: string; rawTextSha256: string; rawReceiptSha256: string }[];
};
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

export function isOcrProvenance(value: unknown): value is OcrProvenance {
    return object(value) && value.kind === "machine_transcription" && typeof value.sourceUrl === "string"
        && hash(value.originalSha256) && typeof value.manifestPath === "string" && hash(value.manifestSha256) && Array.isArray(value.warnings);
}
export function isOcrEvidenceProof(value: unknown, provenance: OcrProvenance): value is OcrEvidenceProof {
    return object(value) && value.evidenceKind === "machine_transcription" && value.sourceUrl === provenance.sourceUrl
        && value.originalSha256 === provenance.originalSha256 && value.manifestPath === provenance.manifestPath && value.manifestSha256 === provenance.manifestSha256
        && Array.isArray(value.tiles) && value.tiles.length > 0 && value.tiles.every(tile => object(tile) && typeof tile.id === "string" && Boolean(tile.id)
            && Array.isArray(tile.box) && tile.box.length === 4 && tile.box.every(value => Number.isSafeInteger(value) && Number(value) >= 0)
            && Number(tile.box[0]) < Number(tile.box[2]) && Number(tile.box[1]) < Number(tile.box[3])
            && hash(tile.cropSha256) && hash(tile.rawTextSha256) && hash(tile.rawReceiptSha256));
}
