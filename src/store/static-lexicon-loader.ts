/**
 * 预置静态词库运行时异步按需加载器 (StaticLexiconLoader)。
 *
 * @remarks
 * 避免将数 MB 的 Danbooru 词库分片打包进 `dist/index.js`：
 * 1. 仅按需读取 `config/lexicon/manifest.json` 轻量目录清单；
 * 2. 单个 `.csv` 分片仅在用户主动触发「载入」时异步读取并交由 LocalLexiconStorage 解析入库，不在静态模块层常驻整份 CSV 原文；
 * 3. 同时兼容浏览器 `fetch`（基于扩展 `import.meta.url` 解析相对路径）与 Node `file:` 协议单元测试环境。
 */

import type { StaticLexiconManifest } from '@types';

/**
 * 预置静态词库加载异常。
 */
export class StaticLexiconLoadError extends Error {
    public constructor(
        public readonly fileName: string,
        message: string,
        public readonly cause?: unknown
    ) {
        super(`[StaticLexiconLoader] 静态词库文件 ${fileName} 加载失败: ${message}`);
        this.name = 'StaticLexiconLoadError';
    }
}

/** 静态词库加载可选参数 */
export interface LoadStaticLexiconOptions {
    /** 自定义基准脚本 URL（缺省使用当前模块 import.meta.url） */
    readonly baseUrl?: string;
    /** 自定义资源请求函数 */
    readonly fetcher?: typeof fetch;
    /** 是否跳过清单内存缓存强制重新读取 */
    readonly forceReload?: boolean;
}

interface NodeFsPromisesLike {
    readFile(path: URL, encoding: 'utf-8'): Promise<string>;
}

const MANIFEST_FILE_NAME = 'manifest.json';

let cachedManifest: StaticLexiconManifest | null = null;
let inflightManifestPromise: Promise<StaticLexiconManifest> | null = null;

/**
 * 清理静态词库清单内存缓存（主要用于测试清理）。
 */
export function clearStaticLexiconManifestCache(): void {
    cachedManifest = null;
    inflightManifestPromise = null;
}

/**
 * 根据模块所在路径推导 `config/lexicon/` 的相对路径前缀。
 *
 * @remarks
 * 打包产物位于 `dist/index.js`（距根目录 1 层），源码测试位于 `src/store/*.ts`（距根目录 2 层）。
 */
export function resolveStaticLexiconUrl(fileName: string, baseUrl?: string): URL {
    const anchorUrl = baseUrl || import.meta.url;
    const normalized = anchorUrl.replace(/\\/g, '/');
    let pathname: string;
    try {
        pathname = new URL(normalized).pathname;
    } catch {
        pathname = normalized.replace(/[?#].*$/, '');
    }
    const relativePrefix = /\/src\/store\/[^/]+$/i.test(pathname)
        ? '../../config/lexicon/'
        : '../config/lexicon/';
    return new URL(`${relativePrefix}${fileName}`, anchorUrl);
}

async function readStaticLexiconText(
    fileName: string,
    options?: LoadStaticLexiconOptions
): Promise<string> {
    const targetUrl = resolveStaticLexiconUrl(fileName, options?.baseUrl);
    const isNode = typeof process !== 'undefined' && Boolean(process.versions?.node);

    if (!options?.fetcher && targetUrl.protocol === 'file:') {
        if (!isNode) {
            throw new StaticLexiconLoadError(
                fileName,
                '浏览器环境中无法通过 file: 协议读取词库文件，请检查扩展加载环境'
            );
        }

        try {
            const nodeFsModuleId = 'node:fs/promises';
            const fsPromises = (await import(
                /* webpackIgnore: true */ nodeFsModuleId
            )) as unknown as NodeFsPromisesLike;
            return await fsPromises.readFile(targetUrl, 'utf-8');
        } catch (err) {
            throw new StaticLexiconLoadError(
                fileName,
                err instanceof Error ? err.message : String(err),
                err
            );
        }
    }

    const fetchFn = options?.fetcher ?? globalThis.fetch;
    if (typeof fetchFn !== 'function') {
        throw new StaticLexiconLoadError(fileName, '当前环境缺少 fetch 实现');
    }

    let response: Response;
    try {
        response = await fetchFn(targetUrl.href, { cache: 'no-cache' });
    } catch (err) {
        throw new StaticLexiconLoadError(
            fileName,
            `网络请求异常: ${err instanceof Error ? err.message : String(err)}`,
            err
        );
    }

    if (!response.ok) {
        throw new StaticLexiconLoadError(
            fileName,
            `HTTP ${response.status} ${response.statusText}`
        );
    }

    try {
        return await response.text();
    } catch (err) {
        throw new StaticLexiconLoadError(
            fileName,
            `响应内容读取失败: ${err instanceof Error ? err.message : String(err)}`,
            err
        );
    }
}

function validateLexiconManifest(raw: unknown): StaticLexiconManifest {
    if (!raw || typeof raw !== 'object') {
        throw new StaticLexiconLoadError(MANIFEST_FILE_NAME, '清单根节点必须为 JSON 对象');
    }
    const obj = raw as Record<string, unknown>;
    if (typeof obj.version !== 'string' || !Array.isArray(obj.packs)) {
        throw new StaticLexiconLoadError(MANIFEST_FILE_NAME, '清单缺少必要字段 (version/packs)');
    }
    return raw as StaticLexiconManifest;
}

/**
 * 异步加载预置静态词库目录清单 (`config/lexicon/manifest.json`)。
 *
 * @remarks
 * 仅读取轻量目录元数据（数 KB），不会触发任何 CSV 分片文件的加载或下载。
 */
export async function loadStaticLexiconManifest(
    options?: LoadStaticLexiconOptions
): Promise<StaticLexiconManifest> {
    const useDefaultCache = !options?.baseUrl && !options?.fetcher;

    if (useDefaultCache && !options?.forceReload && cachedManifest) {
        return structuredClone(cachedManifest);
    }
    if (useDefaultCache && !options?.forceReload && inflightManifestPromise) {
        const result = await inflightManifestPromise;
        return structuredClone(result);
    }

    const loadTask = (async () => {
        const text = await readStaticLexiconText(MANIFEST_FILE_NAME, options);
        let parsed: unknown;
        try {
            parsed = JSON.parse(text);
        } catch (err) {
            throw new StaticLexiconLoadError(
                MANIFEST_FILE_NAME,
                `JSON 解析异常: ${err instanceof Error ? err.message : String(err)}`,
                err
            );
        }
        const validated = validateLexiconManifest(parsed);
        if (useDefaultCache) {
            cachedManifest = validated;
        }
        return validated;
    })();

    if (useDefaultCache) {
        inflightManifestPromise = loadTask;
    }

    try {
        const manifest = await loadTask;
        return structuredClone(manifest);
    } finally {
        if (inflightManifestPromise === loadTask) {
            inflightManifestPromise = null;
        }
    }
}

/**
 * 按需拉取单个预置静态词库分片 CSV 原文（不常驻内存缓存）。
 */
export async function fetchStaticLexiconShardText(
    fileName: string,
    options?: LoadStaticLexiconOptions
): Promise<string> {
    const safeName = (fileName || '').trim();
    if (!safeName || safeName.includes('..') || safeName.includes('/') || safeName.includes('\\')) {
        throw new StaticLexiconLoadError(fileName, '无效的分片文件名');
    }
    return await readStaticLexiconText(safeName, options);
}
