/**
 * @module extensions/character-manager/card-converter
 * @description 角色卡多模板导入导出转换器 (支持 Tavern XML, YAML 键值对与 Markdown 格式)
 */

import { CharacterRule } from './types';

export class CardConverter {
    /**
     * 将文本解析为 CharacterRule
     */
    public parseToCharacterRule(text: string): Partial<CharacterRule> {
        if (!text) return {};

        const trimmed = text.trim();

        // 1. 尝试解析 Tavern XML (<人物> 或 <character>)
        if (trimmed.includes('<人物>') || trimmed.includes('<character>')) {
            return this.parseXml(trimmed);
        }

        // 2. 尝试解析 YAML 格式
        if (trimmed.includes(':') && (trimmed.includes('nameCN:') || trimmed.includes('中文名称:'))) {
            return this.parseYaml(trimmed);
        }

        // 3. 尝试解析 Markdown 格式
        if (trimmed.includes('##') || trimmed.includes('**')) {
            return this.parseMarkdown(trimmed);
        }

        // 默认按行键值对解析
        return this.parseYaml(trimmed);
    }

    /**
     * 将 CharacterRule 导出为指定模板格式
     */
    public formatRule(rule: CharacterRule, format: 'xml' | 'yaml' | 'markdown'): string {
        switch (format) {
            case 'xml':
                return [
                    '<人物>',
                    `中文名称: ${rule.nameCN || ''}`,
                    `英文名称: ${rule.nameEN || ''}`,
                    `身体特征: ${rule.bodyTraits || ''}`,
                    `五官外貌: ${rule.facial || ''}`,
                    `发型发色: ${rule.hair || ''}`,
                    `眼睛颜色: ${rule.eyes || ''}`,
                    `SFW上半身: ${rule.upperSFW || ''}`,
                    `SFW下半身: ${rule.lowerSFW || ''}`,
                    `NSFW上半身: ${rule.upperNSFW || ''}`,
                    `NSFW下半身: ${rule.lowerNSFW || ''}`,
                    `LoRA标签: ${rule.loraTag || ''}`,
                    '</人物>'
                ].join('\n');

            case 'yaml':
                return [
                    `nameCN: "${rule.nameCN || ''}"`,
                    `nameEN: "${rule.nameEN || ''}"`,
                    `bodyTraits: "${rule.bodyTraits || ''}"`,
                    `facial: "${rule.facial || ''}"`,
                    `hair: "${rule.hair || ''}"`,
                    `eyes: "${rule.eyes || ''}"`,
                    `upperSFW: "${rule.upperSFW || ''}"`,
                    `lowerSFW: "${rule.lowerSFW || ''}"`,
                    `upperNSFW: "${rule.upperNSFW || ''}"`,
                    `lowerNSFW: "${rule.lowerNSFW || ''}"`,
                    `loraTag: "${rule.loraTag || ''}"`
                ].join('\n');

            case 'markdown':
                return [
                    `# 角色卡: ${rule.nameCN || rule.nameEN || '未命名'}`,
                    `* **英文名称**: ${rule.nameEN || ''}`,
                    `* **身体特征**: ${rule.bodyTraits || ''}`,
                    `* **五官发型**: ${rule.facial || ''}, ${rule.hair || ''}, ${rule.eyes || ''}`,
                    `* **SFW服装**: ${rule.upperSFW || ''}, ${rule.lowerSFW || ''}`,
                    `* **NSFW特征**: ${rule.upperNSFW || ''}, ${rule.lowerNSFW || ''}`,
                    `* **LoRA**: \`${rule.loraTag || ''}\``
                ].join('\n');
        }
    }

    private parseXml(xmlText: string): Partial<CharacterRule> {
        const result: Partial<CharacterRule> = {};
        const lines = xmlText.replace(/<\/?(?:人物|character)>/gi, '').split('\n');

        for (const line of lines) {
            const idx = line.indexOf(':') !== -1 ? line.indexOf(':') : line.indexOf('：');
            if (idx === -1) continue;

            const key = line.substring(0, idx).trim();
            const val = line.substring(idx + 1).trim();

            this.mapKeyValue(key, val, result);
        }

        return result;
    }

    private parseYaml(yamlText: string): Partial<CharacterRule> {
        const result: Partial<CharacterRule> = {};
        const lines = yamlText.split('\n');

        for (const line of lines) {
            const idx = line.indexOf(':') !== -1 ? line.indexOf(':') : line.indexOf('：');
            if (idx === -1) continue;

            const key = line.substring(0, idx).trim();
            let val = line.substring(idx + 1).trim();
            // 去除外层引号
            val = val.replace(/^["']|["']$/g, '');

            this.mapKeyValue(key, val, result);
        }

        return result;
    }

    private parseMarkdown(mdText: string): Partial<CharacterRule> {
        const result: Partial<CharacterRule> = {};
        const lines = mdText.split('\n');

        for (const line of lines) {
            const clean = line.replace(/^[#*-\s]+/, '').replace(/\*\*/g, '');
            const idx = clean.indexOf(':') !== -1 ? clean.indexOf(':') : clean.indexOf('：');
            if (idx === -1) continue;

            const key = clean.substring(0, idx).trim();
            const val = clean.substring(idx + 1).trim();

            this.mapKeyValue(key, val, result);
        }

        return result;
    }

    private mapKeyValue(key: string, val: string, target: Partial<CharacterRule>): void {
        const k = key.toLowerCase();
        if (k.includes('中文') || k === 'namecn') target.nameCN = val;
        else if (k.includes('英文') || k === 'nameen' || k === 'name') target.nameEN = val;
        else if (k.includes('身体') || k === 'bodytraits') target.bodyTraits = val;
        else if (k.includes('五官') || k === 'facial') target.facial = val;
        else if (k.includes('发') || k === 'hair') target.hair = val;
        else if (k.includes('眼') || k === 'eyes') target.eyes = val;
        else if (k.includes('sfw上半身') || k === 'uppersfw') target.upperSFW = val;
        else if (k.includes('sfw下半身') || k === 'lowersfw') target.lowerSFW = val;
        else if (k.includes('nsfw上半身') || k === 'uppernsfw') target.upperNSFW = val;
        else if (k.includes('nsfw下半身') || k === 'lowernsfw') target.lowerNSFW = val;
        else if (k.includes('lora') || k === 'loratag') target.loraTag = val;
    }
}
