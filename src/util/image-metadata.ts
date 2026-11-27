/**
 * 图像二进制元数据（PNG `tEXt`/`iTXt`、WebP RIFF `EXIF`、JPEG `APP1 EXIF`）纯前端无损读写工具。
 *
 * @remarks
 * 严格遵循 `ComfyUI_frontend` (`pnginfo.ts`) 与 Automatic1111 / Civitai 社区规范：
 * 1. **保留有参原图**：若传入 PNG 已携带 `prompt` / `workflow` / `parameters` / `Comment` / `Description` 等元数据，原样放行不重编码、不覆盖；
 * 2. **仅记录实际参数**：仅为缺失元数据的 ComfyUI 图补写真实执行节点图 `prompt`，对非 ComfyUI 图（OpenAI / Gemini / Grok 等）仅按社区标准写入 A1111 `parameters` 文本（供 ComfyUI 内置 `importA1111` 与外部看图器解析），不构造虚假节点图；
 * 3. **压缩格式保留元数据**：WebP 按 RIFF `VP8X` + `EXIF`（IFD0 `0x0110 Model="prompt:..."` / `0x010e ImageDescription="workflow:..."` 及 ExifIFD `0x9286 UserComment`）无损写入；JPEG 写入 `APP1 EXIF UserComment`。
 */

import type { ImageGenerationMetadata } from '@types';

export interface ExtractedImageMetadata {
    readonly prompt?: string;
    readonly workflow?: string;
    readonly parameters?: string;
    readonly hasGenerationMetadata: boolean;
}

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GENERATION_PNG_KEYWORDS = new Set([
    'prompt',
    'workflow',
    'parameters',
    'comment',
    'description',
]);

// 标准 IEEE 802.3 / PNG CRC32 查找表
const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[i] = c >>> 0;
    }
    return table;
})();

function computeCrc32(bytes: Uint8Array, initial = 0xffffffff): number {
    let crc = initial;
    for (let i = 0; i < bytes.length; i++) {
        crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return crc;
}

function finalizeCrc32(typeBytes: Uint8Array, dataBytes: Uint8Array): number {
    const step1 = computeCrc32(typeBytes, 0xffffffff);
    const step2 = computeCrc32(dataBytes, step1);
    return (step2 ^ 0xffffffff) >>> 0;
}

function isPureAscii(text: string): boolean {
    for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) > 0x7f) {
            return false;
        }
    }
    return true;
}

/** 将含非 ASCII 字符的 JSON 文本安全转义为 `\uXXXX` 纯 ASCII（严格符合 PNG `tEXt` Latin-1 规范且可被 `JSON.parse` 无损还原） */
function escapeJsonToAscii(jsonText: string): string {
    return jsonText.replace(/[\u007f-\uffff]/g, (ch) => {
        const hex = ch.charCodeAt(0).toString(16).padStart(4, '0');
        return `\\u${hex}`;
    });
}

function encodeAscii(str: string): Uint8Array {
    const out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
        out[i] = str.charCodeAt(i) & 0xff;
    }
    return out;
}

function encodeUtf8(str: string): Uint8Array {
    return new TextEncoder().encode(str);
}

function decodeLatin1(bytes: Uint8Array): string {
    let result = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
        const slice = bytes.subarray(i, Math.min(i + chunk, bytes.length));
        result += String.fromCharCode(...slice);
    }
    return result;
}

function decodeUtf8(bytes: Uint8Array): string {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
    return (
        ((bytes[offset] << 24) |
            (bytes[offset + 1] << 16) |
            (bytes[offset + 2] << 8) |
            bytes[offset + 3]) >>>
        0
    );
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
    return (
        (bytes[offset] |
            (bytes[offset + 1] << 8) |
            (bytes[offset + 2] << 16) |
            (bytes[offset + 3] << 24)) >>>
        0
    );
}

function writeUint32BE(out: Uint8Array, offset: number, val: number): void {
    out[offset] = (val >>> 24) & 0xff;
    out[offset + 1] = (val >>> 16) & 0xff;
    out[offset + 2] = (val >>> 8) & 0xff;
    out[offset + 3] = val & 0xff;
}

function writeUint32LE(out: Uint8Array, offset: number, val: number): void {
    out[offset] = val & 0xff;
    out[offset + 1] = (val >>> 8) & 0xff;
    out[offset + 2] = (val >>> 16) & 0xff;
    out[offset + 3] = (val >>> 24) & 0xff;
}

function writeUint16LE(out: Uint8Array, offset: number, val: number): void {
    out[offset] = val & 0xff;
    out[offset + 1] = (val >>> 8) & 0xff;
}

function concatUint8Arrays(parts: readonly Uint8Array[]): Uint8Array {
    let total = 0;
    for (const part of parts) {
        total += part.length;
    }
    const merged = new Uint8Array(total);
    let cursor = 0;
    for (const part of parts) {
        merged.set(part, cursor);
        cursor += part.length;
    }
    return merged;
}

/** 按魔数识别图像实际 MIME 类型 */
export function detectImageMimeFromHeader(bytes: Uint8Array): 'image/png' | 'image/webp' | 'image/jpeg' | 'image/gif' | undefined {
    if (bytes.length >= 8) {
        let isPng = true;
        for (let i = 0; i < 8; i++) {
            if (bytes[i] !== PNG_SIGNATURE[i]) {
                isPng = false;
                break;
            }
        }
        if (isPng) return 'image/png';
    }
    if (
        bytes.length >= 12 &&
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
    ) {
        return 'image/webp';
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return 'image/jpeg';
    }
    if (
        bytes.length >= 6 &&
        bytes[0] === 0x47 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x38
    ) {
        return 'image/gif';
    }
    return undefined;
}

/** 从 PNG 字节中安全解析已存在的文本块（支持 `tEXt` 与未压缩 `iTXt`） */
export function extractPngTextMetadata(bytes: Uint8Array): ExtractedImageMetadata {
    if (detectImageMimeFromHeader(bytes) !== 'image/png') {
        return { hasGenerationMetadata: false };
    }

    let prompt: string | undefined;
    let workflow: string | undefined;
    let parameters: string | undefined;
    let hasGenerationMetadata = false;

    let offset = 8;
    while (offset + 12 <= bytes.length) {
        const length = readUint32BE(bytes, offset);
        const typeOffset = offset + 4;
        const dataOffset = offset + 8;
        const nextOffset = dataOffset + length + 4;
        if (nextOffset > bytes.length) {
            break;
        }
        const chunkType = encodeToAsciiTag(bytes, typeOffset);
        const chunkData = bytes.subarray(dataOffset, dataOffset + length);

        if (chunkType === 'tEXt') {
            const nullIdx = chunkData.indexOf(0);
            if (nullIdx > 0) {
                const keyword = decodeLatin1(chunkData.subarray(0, nullIdx));
                const text = decodeLatin1(chunkData.subarray(nullIdx + 1));
                const lower = keyword.toLowerCase();
                if (GENERATION_PNG_KEYWORDS.has(lower) && text.trim()) {
                    hasGenerationMetadata = true;
                }
                if (lower === 'prompt' && text.trim()) prompt = text;
                else if (lower === 'workflow' && text.trim()) workflow = text;
                else if (lower === 'parameters' && text.trim()) parameters = text;
            }
        } else if (chunkType === 'iTXt') {
            const kwEnd = chunkData.indexOf(0);
            if (kwEnd > 0 && kwEnd + 3 <= chunkData.length) {
                const keyword = decodeLatin1(chunkData.subarray(0, kwEnd));
                const compressionFlag = chunkData[kwEnd + 1];
                let cursor = kwEnd + 3;
                const langEnd = chunkData.indexOf(0, cursor);
                if (langEnd !== -1) {
                    cursor = langEnd + 1;
                    const transEnd = chunkData.indexOf(0, cursor);
                    if (transEnd !== -1) {
                        cursor = transEnd + 1;
                        if (compressionFlag === 0) {
                            const text = decodeUtf8(chunkData.subarray(cursor));
                            const lower = keyword.toLowerCase();
                            if (GENERATION_PNG_KEYWORDS.has(lower) && text.trim()) {
                                hasGenerationMetadata = true;
                            }
                            if (lower === 'prompt' && text.trim() && !prompt) prompt = text;
                            else if (lower === 'workflow' && text.trim() && !workflow) workflow = text;
                            else if (lower === 'parameters' && text.trim() && !parameters) parameters = text;
                        } else if (GENERATION_PNG_KEYWORDS.has(keyword.toLowerCase())) {
                            hasGenerationMetadata = true;
                        }
                    }
                }
            }
        } else if (chunkType === 'zTXt') {
            const kwEnd = chunkData.indexOf(0);
            if (kwEnd > 0) {
                const keyword = decodeLatin1(chunkData.subarray(0, kwEnd));
                if (GENERATION_PNG_KEYWORDS.has(keyword.toLowerCase())) {
                    hasGenerationMetadata = true;
                }
            }
        } else if (chunkType === 'IEND') {
            break;
        }

        offset = nextOffset;
    }

    return { prompt, workflow, parameters, hasGenerationMetadata };
}

function encodeToAsciiTag(bytes: Uint8Array, start: number): string {
    return String.fromCharCode(
        bytes[start],
        bytes[start + 1],
        bytes[start + 2],
        bytes[start + 3]
    );
}

/** 构造单个 PNG Chunk（含 4 字节长度 + 类型 + 数据 + 4 字节 CRC32） */
function buildPngChunk(type: string, data: Uint8Array): Uint8Array {
    const typeBytes = encodeAscii(type);
    const out = new Uint8Array(12 + data.length);
    writeUint32BE(out, 0, data.length);
    out.set(typeBytes, 4);
    out.set(data, 8);
    writeUint32BE(out, 8 + data.length, finalizeCrc32(typeBytes, data));
    return out;
}

function buildPngTextChunk(keyword: string, text: string): Uint8Array {
    const kwBytes = encodeAscii(keyword);
    if (isPureAscii(text)) {
        const textBytes = encodeAscii(text);
        const data = new Uint8Array(kwBytes.length + 1 + textBytes.length);
        data.set(kwBytes, 0);
        data[kwBytes.length] = 0;
        data.set(textBytes, kwBytes.length + 1);
        return buildPngChunk('tEXt', data);
    }
    // 含 Unicode 时按 PNG iTXt 标准写入 UTF-8（compression=0, method=0, language='', translated=''）
    const utf8Bytes = encodeUtf8(text);
    const data = new Uint8Array(kwBytes.length + 5 + utf8Bytes.length);
    data.set(kwBytes, 0);
    data[kwBytes.length] = 0; // null after keyword
    data[kwBytes.length + 1] = 0; // compression flag
    data[kwBytes.length + 2] = 0; // compression method
    data[kwBytes.length + 3] = 0; // empty language tag
    data[kwBytes.length + 4] = 0; // empty translated keyword
    data.set(utf8Bytes, kwBytes.length + 5);
    return buildPngChunk('iTXt', data);
}

/** 在 `IEND` 之前无损插入缺失的 PNG 元数据文本块（不重编码像素数据） */
export function injectPngMetadataChunks(
    pngBytes: Uint8Array,
    entries: Array<{ keyword: string; text: string }>
): Uint8Array {
    if (detectImageMimeFromHeader(pngBytes) !== 'image/png' || entries.length === 0) {
        return pngBytes;
    }

    let iendOffset = -1;
    let offset = 8;
    while (offset + 12 <= pngBytes.length) {
        const length = readUint32BE(pngBytes, offset);
        const chunkType = encodeToAsciiTag(pngBytes, offset + 4);
        const nextOffset = offset + 12 + length;
        if (nextOffset > pngBytes.length) {
            break;
        }
        if (chunkType === 'IEND') {
            iendOffset = offset;
            break;
        }
        offset = nextOffset;
    }

    if (iendOffset === -1) {
        return pngBytes;
    }

    const extraChunks = entries.map((entry) => buildPngTextChunk(entry.keyword, entry.text));
    return concatUint8Arrays([
        pngBytes.subarray(0, iendOffset),
        ...extraChunks,
        pngBytes.subarray(iendOffset),
    ]);
}

/** 按 A1111 / SD-WebUI PNG Info 标准格式化通用绘图参数文本（不伪造缺失数值） */
export function formatA1111ParametersText(metadata: ImageGenerationMetadata): string {
    const lines: string[] = [];
    const prompt = (metadata.prompt || '').trim();
    if (prompt) {
        lines.push(prompt);
    }
    const neg = (metadata.negativePrompt || '').trim();
    if (neg) {
        lines.push(`Negative prompt: ${neg}`);
    }

    const tailPairs: string[] = [];
    if (typeof metadata.steps === 'number' && Number.isFinite(metadata.steps)) {
        tailPairs.push(`Steps: ${metadata.steps}`);
    }
    if (typeof metadata.sampler === 'string' && metadata.sampler.trim()) {
        tailPairs.push(`Sampler: ${metadata.sampler.trim()}`);
    }
    if (typeof metadata.scheduler === 'string' && metadata.scheduler.trim()) {
        tailPairs.push(`Schedule type: ${metadata.scheduler.trim()}`);
    }
    if (typeof metadata.cfgScale === 'number' && Number.isFinite(metadata.cfgScale)) {
        tailPairs.push(`CFG scale: ${metadata.cfgScale}`);
    }
    if (typeof metadata.seed === 'number' && Number.isFinite(metadata.seed) && metadata.seed >= 0) {
        tailPairs.push(`Seed: ${Math.floor(metadata.seed)}`);
    }
    const hasDimensions =
        typeof metadata.width === 'number' &&
        typeof metadata.height === 'number' &&
        metadata.width > 0 &&
        metadata.height > 0;
    if (hasDimensions) {
        tailPairs.push(`Size: ${Math.round(metadata.width!)}x${Math.round(metadata.height!)}`);
    }
    if (typeof metadata.baseModel === 'string' && metadata.baseModel.trim()) {
        tailPairs.push(`Model: ${metadata.baseModel.trim()}`);
    }
    if (typeof metadata.clipSkip === 'number' && Number.isFinite(metadata.clipSkip)) {
        tailPairs.push(`Clip skip: ${metadata.clipSkip}`);
    }
    if (metadata.enableHires) {
        if (typeof metadata.hiresUpscaler === 'string' && metadata.hiresUpscaler.trim()) {
            tailPairs.push(`Hires upscaler: ${metadata.hiresUpscaler.trim()}`);
        }
        if (typeof metadata.hiresScale === 'number' && Number.isFinite(metadata.hiresScale)) {
            tailPairs.push(`Hires upscale: ${metadata.hiresScale}`);
        }
        if (typeof metadata.hiresDenoise === 'number' && Number.isFinite(metadata.hiresDenoise)) {
            tailPairs.push(`Denoising strength: ${metadata.hiresDenoise}`);
        }
    }
    if (!hasDimensions && typeof metadata.aspectRatio === 'string' && metadata.aspectRatio.trim()) {
        tailPairs.push(`Aspect ratio: ${metadata.aspectRatio.trim()}`);
    }
    if (typeof metadata.engine === 'string' && metadata.engine.trim() && tailPairs.length > 0) {
        tailPairs.push(`Engine: ${metadata.engine.trim()}`);
    }

    if (tailPairs.length > 0) {
        lines.push(tailPairs.join(', '));
    }

    return lines.join('\n').trim();
}

function encodeExifUserCommentPayload(text: string): Uint8Array {
    if (isPureAscii(text)) {
        const header = encodeAscii('ASCII\0\0\0');
        const body = encodeAscii(text);
        return concatUint8Arrays([header, body]);
    }
    // 遵循 EXIF 2.3 与 piexif.helper 规范：'UNICODE\0' + UTF-16BE（确保含中文提示词无乱码）
    const header = encodeAscii('UNICODE\0');
    const utf16 = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        utf16[i * 2] = (code >>> 8) & 0xff;
        utf16[i * 2 + 1] = code & 0xff;
    }
    return concatUint8Arrays([header, utf16]);
}

interface TiffIfdEntryInput {
    readonly tag: number;
    readonly type: number; // 2 = ASCII, 4 = LONG, 7 = UNDEFINED
    readonly count: number;
    readonly valueBytes: Uint8Array;
}

/** 构造小端 TIFF EXIF 二进制块（含 IFD0 与可选 ExifIFD，兼容 WebP EXIF 与 JPEG APP1） */
export function buildTiffExifBlock(options: {
    imageDescription?: string;
    model?: string;
    userComment?: string;
}): Uint8Array | null {
    const ifd0Entries: TiffIfdEntryInput[] = [];
    if (options.imageDescription) {
        const bytes = concatUint8Arrays([encodeAscii(escapeJsonToAscii(options.imageDescription)), new Uint8Array([0])]);
        ifd0Entries.push({ tag: 0x010e, type: 2, count: bytes.length, valueBytes: bytes });
    }
    if (options.model) {
        const bytes = concatUint8Arrays([encodeAscii(escapeJsonToAscii(options.model)), new Uint8Array([0])]);
        ifd0Entries.push({ tag: 0x0110, type: 2, count: bytes.length, valueBytes: bytes });
    }

    const exifSubEntries: TiffIfdEntryInput[] = [];
    if (options.userComment) {
        const bytes = encodeExifUserCommentPayload(options.userComment);
        exifSubEntries.push({ tag: 0x9286, type: 7, count: bytes.length, valueBytes: bytes });
    }

    if (ifd0Entries.length === 0 && exifSubEntries.length === 0) {
        return null;
    }

    const hasExifSubIfd = exifSubEntries.length > 0;
    const ifd0EntryCount = ifd0Entries.length + (hasExifSubIfd ? 1 : 0);
    const ifd0Offset = 8;
    const ifd0TableSize = 2 + ifd0EntryCount * 12 + 4;
    let cursor = ifd0Offset + ifd0TableSize;

    // 预计算 IFD0 外部值区偏移，并在之后放置 ExifSubIFD
    const heapChunks: Uint8Array[] = [];
    const finalizedIfd0: Array<{ tag: number; type: number; count: number; inlineOrOffset: number; isInline: boolean; inlineBytes?: Uint8Array }> = [];

    ifd0Entries.sort((a, b) => a.tag - b.tag);
    for (const entry of ifd0Entries) {
        if (entry.valueBytes.length <= 4) {
            finalizedIfd0.push({
                tag: entry.tag,
                type: entry.type,
                count: entry.count,
                inlineOrOffset: 0,
                isInline: true,
                inlineBytes: entry.valueBytes,
            });
        } else {
            finalizedIfd0.push({
                tag: entry.tag,
                type: entry.type,
                count: entry.count,
                inlineOrOffset: cursor,
                isInline: false,
            });
            heapChunks.push(entry.valueBytes);
            cursor += entry.valueBytes.length;
        }
    }

    let exifSubIfdOffset = 0;
    const finalizedSub: typeof finalizedIfd0 = [];
    if (hasExifSubIfd) {
        exifSubIfdOffset = cursor;
        finalizedIfd0.push({
            tag: 0x8769,
            type: 4,
            count: 1,
            inlineOrOffset: exifSubIfdOffset,
            isInline: false,
        });
        const subTableSize = 2 + exifSubEntries.length * 12 + 4;
        cursor += subTableSize;

        exifSubEntries.sort((a, b) => a.tag - b.tag);
        for (const entry of exifSubEntries) {
            if (entry.valueBytes.length <= 4) {
                finalizedSub.push({
                    tag: entry.tag,
                    type: entry.type,
                    count: entry.count,
                    inlineOrOffset: 0,
                    isInline: true,
                    inlineBytes: entry.valueBytes,
                });
            } else {
                finalizedSub.push({
                    tag: entry.tag,
                    type: entry.type,
                    count: entry.count,
                    inlineOrOffset: cursor,
                    isInline: false,
                });
                heapChunks.push(entry.valueBytes);
                cursor += entry.valueBytes.length;
            }
        }
    }

    const totalSize = cursor;
    const out = new Uint8Array(totalSize);

    // TIFF Little-Endian Header ("II*\0", IFD0 offset = 8)
    out[0] = 0x49;
    out[1] = 0x49;
    writeUint16LE(out, 2, 42);
    writeUint32LE(out, 4, ifd0Offset);

    // 写入 IFD0 表
    const writeIfdTable = (startOffset: number, rows: typeof finalizedIfd0) => {
        writeUint16LE(out, startOffset, rows.length);
        let p = startOffset + 2;
        for (const row of rows) {
            writeUint16LE(out, p, row.tag);
            writeUint16LE(out, p + 2, row.type);
            writeUint32LE(out, p + 4, row.count);
            if (row.isInline && row.inlineBytes) {
                out.set(row.inlineBytes, p + 8);
            } else {
                writeUint32LE(out, p + 8, row.inlineOrOffset);
            }
            p += 12;
        }
        writeUint32LE(out, p, 0);
    };

    writeIfdTable(ifd0Offset, finalizedIfd0);

    let dataPos = ifd0Offset + ifd0TableSize;
    for (let i = 0; i < finalizedIfd0.length; i++) {
        if (!finalizedIfd0[i].isInline && finalizedIfd0[i].tag !== 0x8769) {
            const chunk = heapChunks.shift()!;
            out.set(chunk, dataPos);
            dataPos += chunk.length;
        }
    }

    if (hasExifSubIfd) {
        writeIfdTable(exifSubIfdOffset, finalizedSub);
        let subPos = exifSubIfdOffset + 2 + finalizedSub.length * 12 + 4;
        for (const row of finalizedSub) {
            if (!row.isInline) {
                const chunk = heapChunks.shift()!;
                out.set(chunk, subPos);
                subPos += chunk.length;
            }
        }
    }

    return out;
}

/** 检查 WebP 是否已包含非空 EXIF 块 */
export function hasWebpExifChunk(bytes: Uint8Array): boolean {
    if (detectImageMimeFromHeader(bytes) !== 'image/webp') {
        return false;
    }
    let offset = 12;
    while (offset + 8 <= bytes.length) {
        const fourcc = encodeToAsciiTag(bytes, offset);
        const size = readUint32LE(bytes, offset + 4);
        const paddedSize = size + (size & 1);
        if (offset + 8 + size > bytes.length) break;
        if (fourcc === 'EXIF' && size > 8) {
            return true;
        }
        offset += 8 + paddedSize;
    }
    return false;
}

function parseWebpCanvasInfo(bytes: Uint8Array): { width: number; height: number; hasAlpha: boolean } | null {
    let offset = 12;
    let width = 0;
    let height = 0;
    let hasAlpha = false;

    while (offset + 8 <= bytes.length) {
        const fourcc = encodeToAsciiTag(bytes, offset);
        const size = readUint32LE(bytes, offset + 4);
        const dataOffset = offset + 8;
        if (dataOffset + size > bytes.length) break;

        if (fourcc === 'VP8X' && size >= 10) {
            hasAlpha = Boolean(bytes[dataOffset] & 0x10);
            width = (bytes[dataOffset + 4] | (bytes[dataOffset + 5] << 8) | (bytes[dataOffset + 6] << 16)) + 1;
            height = (bytes[dataOffset + 7] | (bytes[dataOffset + 8] << 8) | (bytes[dataOffset + 9] << 16)) + 1;
            return { width, height, hasAlpha };
        }
        if (fourcc === 'ALPH') {
            hasAlpha = true;
        }
        if (fourcc === 'VP8 ' && size >= 10) {
            if (bytes[dataOffset + 3] === 0x9d && bytes[dataOffset + 4] === 0x01 && bytes[dataOffset + 5] === 0x2a) {
                width = (bytes[dataOffset + 6] | (bytes[dataOffset + 7] << 8)) & 0x3fff;
                height = (bytes[dataOffset + 8] | (bytes[dataOffset + 9] << 8)) & 0x3fff;
            }
        } else if (fourcc === 'VP8L' && size >= 5 && bytes[dataOffset] === 0x2f) {
            const b0 = bytes[dataOffset + 1];
            const b1 = bytes[dataOffset + 2];
            const b2 = bytes[dataOffset + 3];
            const b3 = bytes[dataOffset + 4];
            const bits = (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0;
            width = (bits & 0x3fff) + 1;
            height = ((bits >>> 14) & 0x3fff) + 1;
            hasAlpha = Boolean((bits >>> 28) & 1);
        }

        offset += 8 + size + (size & 1);
    }

    return width > 0 && height > 0 ? { width, height, hasAlpha } : null;
}

function buildRiffChunk(fourcc: string, payload: Uint8Array): Uint8Array {
    const pad = payload.length & 1;
    const out = new Uint8Array(8 + payload.length + pad);
    out.set(encodeAscii(fourcc), 0);
    writeUint32LE(out, 4, payload.length);
    out.set(payload, 8);
    return out;
}

/** 按 WebP RIFF 规范写入 VP8X 标志位并附加 EXIF 元数据块 */
function injectExifIntoWebp(webpBytes: Uint8Array, tiffExifBytes: Uint8Array): Uint8Array {
    if (detectImageMimeFromHeader(webpBytes) !== 'image/webp' || tiffExifBytes.length === 0) {
        return webpBytes;
    }
    const info = parseWebpCanvasInfo(webpBytes);
    if (!info) {
        return webpBytes;
    }

    const bodyChunks: Uint8Array[] = [];
    let existingVp8xPayload: Uint8Array | null = null;
    let offset = 12;

    while (offset + 8 <= webpBytes.length) {
        const fourcc = encodeToAsciiTag(webpBytes, offset);
        const size = readUint32LE(webpBytes, offset + 4);
        const paddedSize = size + (size & 1);
        if (offset + 8 + size > webpBytes.length) break;

        const payload = webpBytes.subarray(offset + 8, offset + 8 + size);
        if (fourcc === 'VP8X' && size >= 10) {
            existingVp8xPayload = new Uint8Array(payload);
        } else if (fourcc !== 'EXIF') {
            bodyChunks.push(buildRiffChunk(fourcc, payload));
        }

        offset += 8 + paddedSize;
    }

    const vp8xPayload = existingVp8xPayload ?? new Uint8Array(10);
    vp8xPayload[0] = vp8xPayload[0] | 0x08 | (info.hasAlpha ? 0x10 : 0);
    if (!existingVp8xPayload) {
        const w = info.width - 1;
        const h = info.height - 1;
        vp8xPayload[4] = w & 0xff;
        vp8xPayload[5] = (w >>> 8) & 0xff;
        vp8xPayload[6] = (w >>> 16) & 0xff;
        vp8xPayload[7] = h & 0xff;
        vp8xPayload[8] = (h >>> 8) & 0xff;
        vp8xPayload[9] = (h >>> 16) & 0xff;
    }

    const vp8xChunk = buildRiffChunk('VP8X', vp8xPayload);
    const exifChunk = buildRiffChunk('EXIF', tiffExifBytes);

    const payloadBytes = concatUint8Arrays([vp8xChunk, ...bodyChunks, exifChunk]);
    const riffHeader = new Uint8Array(12);
    riffHeader.set(encodeAscii('RIFF'), 0);
    writeUint32LE(riffHeader, 4, 4 + payloadBytes.length);
    riffHeader.set(encodeAscii('WEBP'), 8);
    return concatUint8Arrays([riffHeader, payloadBytes]);
}

function hasJpegExifApp1(jpegBytes: Uint8Array): boolean {
    let pos = 2;
    while (pos + 4 <= jpegBytes.length) {
        if (jpegBytes[pos] !== 0xff) break;
        const marker = jpegBytes[pos + 1];
        if (marker === 0xda || marker === 0xd9) break; // SOS / EOI
        if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
            pos += 2;
            continue;
        }
        const segLen = (jpegBytes[pos + 2] << 8) | jpegBytes[pos + 3];
        if (segLen < 2 || pos + 2 + segLen > jpegBytes.length) break;
        if (
            marker === 0xe1 &&
            pos + 10 <= jpegBytes.length &&
            jpegBytes[pos + 4] === 0x45 &&
            jpegBytes[pos + 5] === 0x78 &&
            jpegBytes[pos + 6] === 0x69 &&
            jpegBytes[pos + 7] === 0x66 &&
            jpegBytes[pos + 8] === 0x00 &&
            jpegBytes[pos + 9] === 0x00
        ) {
            return true;
        }
        pos += 2 + segLen;
    }
    return false;
}

/** 按 JPEG APP1 EXIF 规范插入 TIFF 元数据块（超过 64KB 段限制或已有 Exif 时安全跳过不损坏文件） */
export function injectExifIntoJpeg(jpegBytes: Uint8Array, tiffExifBytes: Uint8Array): Uint8Array {
    if (detectImageMimeFromHeader(jpegBytes) !== 'image/jpeg' || tiffExifBytes.length === 0) {
        return jpegBytes;
    }
    const exifPrefix = encodeAscii('Exif\0\0');
    const app1BodyLen = exifPrefix.length + tiffExifBytes.length;
    const segmentFieldLen = 2 + app1BodyLen;
    if (segmentFieldLen > 0xffff) {
        return jpegBytes;
    }

    if (hasJpegExifApp1(jpegBytes)) {
        return jpegBytes;
    }

    const app1 = new Uint8Array(2 + 2 + app1BodyLen);
    app1[0] = 0xff;
    app1[1] = 0xe1;
    app1[2] = (segmentFieldLen >>> 8) & 0xff;
    app1[3] = segmentFieldLen & 0xff;
    app1.set(exifPrefix, 4);
    app1.set(tiffExifBytes, 4 + exifPrefix.length);

    return concatUint8Arrays([jpegBytes.subarray(0, 2), app1, jpegBytes.subarray(2)]);
}

/** 从任意输入图像二进制流提取基础可保留的生成元数据 */
export function extractGenerationMetadataFromBytes(bytes: Uint8Array): ExtractedImageMetadata {
    const mime = detectImageMimeFromHeader(bytes);
    if (mime === 'image/png') {
        return extractPngTextMetadata(bytes);
    }
    if (mime === 'image/webp') {
        return { hasGenerationMetadata: hasWebpExifChunk(bytes) };
    }
    return { hasGenerationMetadata: false };
}

/**
 * 为已处理完成的图像 Blob 写入缺失的社区标准绘图参数元数据。
 * 原图本身已包含参数块时保持原样直接返回。
 */
export async function ensureImageBlobMetadata(options: {
    processedBlob: Blob;
    metadata: ImageGenerationMetadata;
    comfyPromptGraph?: Record<string, unknown>;
    extractedSource?: ExtractedImageMetadata;
}): Promise<Blob> {
    const { processedBlob, metadata, comfyPromptGraph, extractedSource } = options;
    if (!processedBlob || processedBlob.size === 0 || typeof processedBlob.arrayBuffer !== 'function') {
        return processedBlob;
    }

    try {
        const rawArrayBuffer = await processedBlob.arrayBuffer();
        const bytes = new Uint8Array(rawArrayBuffer);
        const actualMime = detectImageMimeFromHeader(bytes) ?? processedBlob.type;

        if (actualMime === 'image/png') {
            const currentMeta = extractPngTextMetadata(bytes);
            // 原图已包含有效生图参数块时原样返回
            if (currentMeta.hasGenerationMetadata) {
                return processedBlob;
            }

            const entries: Array<{ keyword: string; text: string }> = [];
            if (metadata.engine === 'comfyui') {
                const realComfyPrompt =
                    extractedSource?.prompt ??
                    (comfyPromptGraph ? JSON.stringify(comfyPromptGraph) : undefined);
                if (realComfyPrompt) {
                    entries.push({
                        keyword: 'prompt',
                        text: escapeJsonToAscii(realComfyPrompt),
                    });
                }
                if (extractedSource?.workflow) {
                    entries.push({
                        keyword: 'workflow',
                        text: escapeJsonToAscii(extractedSource.workflow),
                    });
                }
            }

            const a1111Text =
                extractedSource?.parameters?.trim() || formatA1111ParametersText(metadata);
            if (a1111Text) {
                entries.push({ keyword: 'parameters', text: a1111Text });
            }

            if (entries.length === 0) {
                return processedBlob;
            }
            const nextBytes = injectPngMetadataChunks(bytes, entries);
            const safeBytes = new Uint8Array(nextBytes);
            return new Blob([safeBytes], { type: 'image/png' });
        }

        if (actualMime === 'image/webp') {
            if (hasWebpExifChunk(bytes)) {
                return processedBlob;
            }
            const realComfyPrompt =
                extractedSource?.prompt ??
                (metadata.engine === 'comfyui' && comfyPromptGraph
                    ? JSON.stringify(comfyPromptGraph)
                    : undefined);
            const comfyWorkflow = extractedSource?.workflow;
            const userComment =
                extractedSource?.parameters?.trim() || formatA1111ParametersText(metadata);

            const tiffBytes = buildTiffExifBlock({
                imageDescription: comfyWorkflow ? `workflow:${comfyWorkflow}` : undefined,
                model: realComfyPrompt ? `prompt:${realComfyPrompt}` : undefined,
                userComment: userComment || undefined,
            });
            if (!tiffBytes) {
                return processedBlob;
            }
            const nextBytes = injectExifIntoWebp(bytes, tiffBytes);
            const safeBytes = new Uint8Array(nextBytes);
            return new Blob([safeBytes], { type: 'image/webp' });
        }

        if (actualMime === 'image/jpeg') {
            const userComment =
                extractedSource?.parameters?.trim() || formatA1111ParametersText(metadata);
            if (!userComment) {
                return processedBlob;
            }
            const tiffBytes = buildTiffExifBlock({ userComment });
            if (!tiffBytes) {
                return processedBlob;
            }
            const nextBytes = injectExifIntoJpeg(bytes, tiffBytes);
            if (nextBytes === bytes) {
                return processedBlob;
            }
            const safeBytes = new Uint8Array(nextBytes);
            return new Blob([safeBytes], { type: 'image/jpeg' });
        }
    } catch {
        // 二进制解析异常时安全回退原始处理后 Blob，不阻断出图主流程
    }

    return processedBlob;
}
