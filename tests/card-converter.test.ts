import { describe, it, expect } from 'vitest';
import { CardConverter } from '../src/extensions/character-manager/card-converter';

describe('CardConverter Multi-template Parsing & Formatting Tests', () => {
    it('should parse Tavern XML card format', () => {
        const converter = new CardConverter();
        const xml = `<人物>
中文名称: 爱莉希雅
英文名称: elysia
身体特征: pink hair, elf ears
发型发色: long pink hair
眼睛颜色: blue eyes
</人物>`;

        const rule = converter.parseToCharacterRule(xml);
        expect(rule.nameCN).toBe('爱莉希雅');
        expect(rule.nameEN).toBe('elysia');
        expect(rule.bodyTraits).toBe('pink hair, elf ears');
        expect(rule.hair).toBe('long pink hair');
        expect(rule.eyes).toBe('blue eyes');
    });

    it('should format CharacterRule to YAML format', () => {
        const converter = new CardConverter();
        const yaml = converter.formatRule(
            {
                id: 'char_1',
                nameCN: '刻晴',
                nameEN: 'keqing',
                bodyTraits: 'purple hair, twintails',
                facial: 'beautiful eyes',
                hair: 'purple twintails',
                eyes: 'purple eyes',
                upperSFW: 'lile skirt',
                lowerSFW: 'black tights',
                upperNSFW: '',
                lowerNSFW: '',
                loraTag: '<lora:keqing:0.8>'
            },
            'yaml'
        );

        expect(yaml).toContain('nameCN: "刻晴"');
        expect(yaml).toContain('nameEN: "keqing"');
        expect(yaml).toContain('loraTag: "<lora:keqing:0.8>"');
    });
});
