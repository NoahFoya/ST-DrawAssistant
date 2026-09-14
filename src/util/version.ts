/**
 * 语义版本比较工具 (src/util/version.ts)
 *
 * 核心功能：
 * 1. 提供点分版本号纯函数比较 (compareVersions)；
 * 2. 自动清理前导 v/V 前缀与首尾空格，按三段及以上数字位逐级对比。
 *
 * 注意事项：
 * 1. 纯数学与字符串比较，不产生网络开销与外部依赖。
 */

/**
 * 比较远端版本与本地版本号。
 * 自动剥离前导 v/V 前缀与首尾空格，按点分三段及以上数字逐位比较。
 *
 * @param remote 远端版本号字符串（例如 'v0.2.0', '0.2.0'）
 * @param local 本地版本号字符串（例如 'v0.1.0', '0.1.0'）
 * @returns 1: 远端版本较新（有可用更新）; 0: 两者版本一致; -1: 本地版本较新
 */
export function compareVersions(remote: string, local: string): number {
    const parse = (v: string): number[] =>
        v.trim()
            .replace(/^[vV]/, '')
            .split('.')
            .map((part) => parseInt(part, 10) || 0);

    const rParts = parse(remote);
    const lParts = parse(local);
    const maxLen = Math.max(rParts.length, lParts.length, 3);

    for (let i = 0; i < maxLen; i++) {
        const r = rParts[i] ?? 0;
        const l = lParts[i] ?? 0;
        if (r > l) return 1;
        if (r < l) return -1;
    }
    return 0;
}
