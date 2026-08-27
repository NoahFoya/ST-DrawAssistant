/**
 * @module domain/pipeline/variable-evaluator
 * @description 动态变量与 LoRA 标签求值引擎 (<lora:...>, <wlr:...>)
 */

export interface ParsedLoraTag {
    raw: string;
    name: string;
    modelWeight: number;
    clipWeight?: number;
    triggerWeight?: number;
}

export class VariableEvaluator {
    /**
     * 提取并解析提示词中的所有 <lora:name:weight> 或 <wlr:name:weight:clip:trigger> 标签，并返回纯净提示词
     *
     * @param text 包含 LoRA 标签的原始提示词
     * @returns 清洗后的提示词文本与解析出的 LoRA 标签数组
     */
    public parseLoraTags(text: string): { cleanText: string; loras: ParsedLoraTag[] } {
        if (!text) return { cleanText: '', loras: [] };

        const loras: ParsedLoraTag[] = [];
        // 匹配 <lora:name:weight> 与 <wlr:name:model:clip:trigger>
        const loraRegex = /<(?:lora|wlr):([^:>]+)(?::([^:>]+))?(?::([^:>]+))?(?::([^:>]+))?>/gi;

        const cleanText = text.replace(loraRegex, (raw, name, w1, w2, w3) => {
            const modelWeight = w1 ? parseFloat(w1) || 1.0 : 1.0;
            const clipWeight = w2 ? parseFloat(w2) : undefined;
            const triggerWeight = w3 ? parseFloat(w3) : undefined;

            loras.push({
                raw,
                name: name.trim(),
                modelWeight,
                clipWeight,
                triggerWeight
            });

            return '';
        });

        return {
            cleanText: cleanText
                .replace(/,\s*,+/g, ',')
                .replace(/^\s*,|,\s*$/g, '')
                .replace(/\s+/g, ' ')
                .replace(/,\s*,/g, ',')
                .trim(),
            loras
        };
    }

    /**
     * 展开全局变量占位符
     */
    public evaluateVariables(text: string, variables: Record<string, string>): string {
        if (!text || !variables) return text || '';
        let result = text;
        for (const [k, v] of Object.entries(variables)) {
            const pattern = new RegExp(`\\{${k}\\}`, 'g');
            result = result.replace(pattern, v || '');
        }
        return result;
    }

    /**
     * 清洗提示词中的多余空行、连续空格及孤立逗号 (cleanExtraSpacesAndLines)
     */
    public cleanPrompt(text: string): string {
        if (!text) return '';
        return text
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .join(', ')
            .replace(/\s+/g, ' ')
            .replace(/,\s*,+/g, ',')
            .replace(/^\s*,|,\s*$/g, '')
            .trim();
    }
}
