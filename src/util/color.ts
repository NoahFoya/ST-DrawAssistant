/**
 * @module src/util/color
 * @description 颜色格式转换与计算工具
 */

export interface RgbColor {
    r: number;
    g: number;
    b: number;
    a?: number;
}

/**
 * 将十六进制颜色字符串转换为 RGB/RGBA 分量对象
 * 支持 #RGB, #RRGGBB, #RRGGBBAA 格式
 */
export function hexToRgb(hex: string): RgbColor {
    if (!hex || typeof hex !== 'string') {
        throw new Error(`Invalid hex color: ${hex}`);
    }

    let clean = hex.trim().replace(/^#/, '');

    if (clean.length === 3) {
        clean = clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2];
    } else if (clean.length === 4) {
        clean = clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2] + clean[3] + clean[3];
    }

    if (clean.length !== 6 && clean.length !== 8) {
        throw new Error(`Invalid hex color: ${hex}`);
    }

    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);

    if (isNaN(r) || isNaN(g) || isNaN(b)) {
        throw new Error(`Invalid hex color: ${hex}`);
    }

    let a: number | undefined;
    if (clean.length === 8) {
        const alphaInt = parseInt(clean.substring(6, 8), 16);
        if (!isNaN(alphaInt)) {
            a = Math.round((alphaInt / 255) * 100) / 100;
        }
    }

    return { r, g, b, ...(a !== undefined ? { a } : {}) };
}

/**
 * 将 RGB 分量转换为十六进制颜色字符串 (#rrggbb)
 */
export function rgbToHex(r: number, g: number, b: number): string {
    const clampByte = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
    const toHex = (n: number) => clampByte(n).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
