/**
 * 关键词与 `/pattern/flags` 正则词元解析及匹配纯工具模块。
 *
 * @remarks
 * 无任何 DOM、宿主或状态存储依赖，供素材提取、提示词注入与 LoRA 触发判断共用。
 */

const VALID_REGEX_FLAGS_RE = /^[dgimsuvy]*$/;
const PURE_ASCII_TOKEN_RE = /^[A-Za-z0-9_.\s'-]+$/;

/** 转义普通文本中的正则元字符，以便安全拼入正则表达式 */
export function escapeRegExpLiteral(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 检查正则标志串是否仅含合法字符且无重复（u 与 v 互斥） */
export function hasValidUniqueRegexFlags(flags: string): boolean {
    if (!VALID_REGEX_FLAGS_RE.test(flags)) {
        return false;
    }
    const seen = new Set<string>();
    for (const ch of flags) {
        if (seen.has(ch)) {
            return false;
        }
        seen.add(ch);
    }
    return !(seen.has('u') && seen.has('v'));
}

/** 扫描位于 startIdx 处的 `/pattern/` 正则结束斜杠位置（跳过转义斜杠与 `[...]` 字符类内斜杠） */
function findRegexLiteralClosingSlash(src: string, startIdx: number): number {
    let j = startIdx + 1;
    let escaped = false;
    let inCharClass = false;
    while (j < src.length) {
        const inner = src[j];
        if (escaped) {
            escaped = false;
        } else if (inner === '\\') {
            escaped = true;
        } else if (inner === '[' && !inCharClass) {
            inCharClass = true;
        } else if (inner === ']' && inCharClass) {
            inCharClass = false;
        } else if (inner === '/' && !inCharClass) {
            return j;
        }
        j++;
    }
    return -1;
}

/**
 * 若 token 为 `/pattern/flags` 格式则拆出主体与标志串（未校验 flags 合法性）。
 */
export function parseKeywordRegexLiteral(
    rawToken: string
): { pattern: string; flags: string } | null {
    const token = rawToken.trim();
    if (!token.startsWith('/')) {
        return null;
    }
    const closedAt = findRegexLiteralClosingSlash(token, 0);
    if (closedAt <= 1) {
        return null;
    }
    const pattern = token.slice(1, closedAt);
    const flags = token.slice(closedAt + 1);
    return { pattern, flags };
}

/**
 * 校验关键词是否为合法 `/pattern/flags` 正则字面量；非法时返回错误信息。
 */
export function validateKeywordRegexToken(rawToken: string): string | null {
    const token = rawToken.trim();
    if (!token.startsWith('/')) {
        return null;
    }
    const parsed = parseKeywordRegexLiteral(token);
    if (!parsed || !/^[a-zA-Z]*$/.test(parsed.flags)) {
        return `正则字面量格式无效: ${token}`;
    }
    if (!hasValidUniqueRegexFlags(parsed.flags)) {
        return `正则标志无效或重复: ${token}`;
    }
    try {
        new RegExp(parsed.pattern, parsed.flags.replace(/[gy]/g, ''));
        return null;
    } catch (err: unknown) {
        return err instanceof Error ? err.message : `无效正则: ${token}`;
    }
}

export interface KeywordTokenSplitOptions {
    /** 是否将管道符 `|` 视为分隔符（默认 `true` 以兼容角色/服装别名；LoRA 与提示词条目应传 `false` 仅按逗号与换行分隔） */
    readonly allowPipe?: boolean;
}

/**
 * 扫描关键词字符串，收集所有非法 `/pattern/flags` 正则词元的错误信息。
 */
export function collectKeywordRegexErrors(
    rawKeywords?: string,
    options?: KeywordTokenSplitOptions
): string[] {
    if (!rawKeywords) {
        return [];
    }
    const errors: string[] = [];
    for (const token of splitKeywordTokens(rawKeywords, options)) {
        if (!token.startsWith('/')) continue;
        const err = validateKeywordRegexToken(token);
        if (err) {
            errors.push(`${token}: ${err}`);
        }
    }
    return errors;
}

function isKeywordSeparatorChar(ch: string | undefined, allowPipe: boolean): boolean {
    return (
        ch === undefined ||
        (allowPipe && ch === '|') ||
        ch === ',' ||
        ch === '，' ||
        ch === '\n' ||
        ch === '\r' ||
        /\s/.test(ch)
    );
}

/**
 * 解析关键词或别名列表（支持 `,` / `，` / 换行，及按需支持 `|`），完整保留合法 `/pattern/flags` 正则字面量（含 `[...]` 字符类内 `/` 与 `,`）。
 */
export function splitKeywordTokens(
    rawKeywords?: string,
    options?: KeywordTokenSplitOptions
): string[] {
    const src = (rawKeywords || '').trim();
    if (!src) {
        return [];
    }
    const allowPipe = options?.allowPipe !== false;

    const tokens: string[] = [];
    let current = '';
    let i = 0;

    while (i < src.length) {
        const ch = src[i];
        // 仅当闭合 `/` 后到分隔符之间全为合法且不重复的标志时，才按 /pattern/flags 整体提取
        if (ch === '/' && !current.trim()) {
            const closedAt = findRegexLiteralClosingSlash(src, i);
            if (closedAt > i + 1) {
                let flagEnd = closedAt + 1;
                while (
                    flagEnd < src.length &&
                    !(allowPipe && src[flagEnd] === '|') &&
                    src[flagEnd] !== ',' &&
                    src[flagEnd] !== '，' &&
                    src[flagEnd] !== '\n' &&
                    src[flagEnd] !== '\r' &&
                    !/\s/.test(src[flagEnd])
                ) {
                    flagEnd++;
                }
                const flagsPart = src.slice(closedAt + 1, flagEnd);
                if (
                    hasValidUniqueRegexFlags(flagsPart) &&
                    isKeywordSeparatorChar(src[flagEnd], allowPipe)
                ) {
                    tokens.push(src.slice(i, flagEnd).trim());
                    current = '';
                    i = flagEnd;
                    while (
                        i < src.length &&
                        ((allowPipe && src[i] === '|') ||
                            src[i] === ',' ||
                            src[i] === '，' ||
                            /\s/.test(src[i]))
                    ) {
                        i++;
                    }
                    continue;
                }
            }
        }

        if (
            (allowPipe && ch === '|') ||
            ch === ',' ||
            ch === '，' ||
            ch === '\n' ||
            ch === '\r'
        ) {
            const trimmed = current.trim();
            if (trimmed) {
                tokens.push(trimmed);
            }
            current = '';
            i++;
            continue;
        }

        current += ch;
        i++;
    }

    const tail = current.trim();
    if (tail) {
        tokens.push(tail);
    }
    return tokens;
}

/**
 * 仅按中英文逗号与换行分隔的关键词解析（不以 `|` 拆词），保留 `/pattern/flags` 正则字面量。
 */
export function splitCommaKeywordTokens(rawKeywords?: string): string[] {
    return splitKeywordTokens(rawKeywords, { allowPipe: false });
}

/**
 * 使用单个词元（纯文本或 `/pattern/flags` 正则字面量）对目标文本执行幂等匹配。
 */
export function matchKeywordToken(
    rawToken: string,
    rawText: string,
    lowerText: string,
    caseSensitive: boolean,
    matchWholeWords = false
): boolean {
    const token = rawToken.trim();
    if (!token) {
        return false;
    }

    const regexMatch = parseKeywordRegexLiteral(token);
    if (regexMatch && hasValidUniqueRegexFlags(regexMatch.flags)) {
        // 剥离 g/y 有状态标志，确保多次 .test() 结果幂等
        let flags = regexMatch.flags.replace(/[gy]/g, '');
        if (!caseSensitive && !flags.includes('i')) {
            flags += 'i';
        }
        try {
            const re = new RegExp(regexMatch.pattern, flags);
            return re.test(rawText);
        } catch {
            // 非法正则字面量直接返回不匹配，禁止隐性退化为字面文本匹配
            return false;
        }
    }

    if (matchWholeWords && PURE_ASCII_TOKEN_RE.test(token)) {
        const boundaryFlags = caseSensitive ? '' : 'i';
        const boundaryRe = new RegExp(
            `(?:^|[^A-Za-z0-9_])${escapeRegExpLiteral(token)}(?=$|[^A-Za-z0-9_])`,
            boundaryFlags
        );
        return boundaryRe.test(rawText);
    }

    return caseSensitive
        ? rawText.includes(token)
        : lowerText.includes(token.toLowerCase());
}
