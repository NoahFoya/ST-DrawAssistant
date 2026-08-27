import { describe, it, expect } from 'vitest';
import { MacroEngine, MacroRuleNode } from '../src/extensions/character-manager/macro-engine';

describe('MacroEngine Rule Tree Recursive Evaluation Tests', () => {
    it('should expand basic variable placeholders', () => {
        const engine = new MacroEngine();
        const nodes: MacroRuleNode[] = [
            {
                id: 'hair-rule',
                name: '发型替换',
                enabled: true,
                pattern: '标准发型',
                replacement: '{hair}, {eyes}'
            }
        ];

        const res = engine.evaluateTree(
            '1girl, 标准发型, solo',
            nodes,
            {
                characterRule: {
                    id: 'keqing',
                    nameCN: '刻晴',
                    hair: 'purple twin twintails',
                    eyes: 'amethyst eyes'
                } as any
            }
        );

        expect(res).toBe('1girl, purple twin twintails, amethyst eyes, solo');
    });

    it('should recursively evaluate nested child rule nodes', () => {
        const engine = new MacroEngine();
        const nodes: MacroRuleNode[] = [
            {
                id: 'root-outfit',
                name: '外层服装',
                enabled: true,
                pattern: '女仆装模式',
                replacement: 'maid outfit, $SUB_DECORATION$',
                children: [
                    {
                        id: 'sub-dec',
                        name: '饰品展开',
                        enabled: true,
                        pattern: '\\$SUB_DECORATION\\$',
                        replacement: 'white frills, lace headdress'
                    }
                ]
            }
        ];

        const res = engine.evaluateTree(
            '1girl, 女仆装模式, smile',
            nodes,
            {}
        );

        expect(res).toBe('1girl, maid outfit, white frills, lace headdress, smile');
    });
});
