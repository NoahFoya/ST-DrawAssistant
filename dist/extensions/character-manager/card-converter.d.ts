/**
 * @module extensions/character-manager/card-converter
 * @description 角色卡多模板导入导出转换器 (支持 Tavern XML, YAML 键值对与 Markdown 格式)
 */
import { CharacterRule } from './types';
/**
 * 角色卡数据多模板导入导出转换器
 */
export declare class CardConverter {
    /**
     * 将外部文本 (Tavern XML / YAML / Markdown) 智能识别并解析为角色特征规则对象
     *
     * @param text 待解析的卡片文本内容
     * @returns 解析提取出的 CharacterRule 属性字典
     */
    parseToCharacterRule(text: string): Partial<CharacterRule>;
    /**
     * 将角色特征规则对象格式化序列化为指定模板文本格式
     *
     * @param rule 角色特征规则数据对象
     * @param format 目标格式类型 ('xml' | 'yaml' | 'markdown')
     * @returns 序列化后的格式化文本字符串
     */
    formatRule(rule: CharacterRule, format: 'xml' | 'yaml' | 'markdown'): string;
    private parseXml;
    private parseYaml;
    private parseMarkdown;
    private mapKeyValue;
}
//# sourceMappingURL=card-converter.d.ts.map