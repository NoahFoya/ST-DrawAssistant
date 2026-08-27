/**
 * @module extensions/character-manager/card-converter
 * @description 角色卡多模板导入导出转换器 (支持 Tavern XML, YAML 键值对与 Markdown 格式)
 */
import { CharacterRule } from './types';
export declare class CardConverter {
    /**
     * 将文本解析为 CharacterRule
     */
    parseToCharacterRule(text: string): Partial<CharacterRule>;
    /**
     * 将 CharacterRule 导出为指定模板格式
     */
    formatRule(rule: CharacterRule, format: 'xml' | 'yaml' | 'markdown'): string;
    private parseXml;
    private parseYaml;
    private parseMarkdown;
    private mapKeyValue;
}
//# sourceMappingURL=card-converter.d.ts.map