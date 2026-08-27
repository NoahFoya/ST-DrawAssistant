import { describe, it, expect } from 'vitest';
import {
    processCharacterPrompt,
    cleanUnfilledTemplatePlaceholders,
    injectCharacterPlaceholders,
    filterEnabledCharacters,
    filterEnabledOutfits
} from '../src/extensions/character-manager/injection';
import type { EnableSchemeProfile } from '../src/extensions/character-manager/types';

describe('CharacterManager Extension', () => {
    describe('cleanUnfilledTemplatePlaceholders', () => {
        it('should strip unfulfilled template placeholders like {nameCN}', () => {
            const raw = 'Header\n{nameCN}\n{unfulfilled_var}\nValid Content';
            const result = cleanUnfilledTemplatePlaceholders(raw);
            expect(result).toBe('Header\nValid Content');
        });

        it('should return empty string for empty input', () => {
            expect(cleanUnfilledTemplatePlaceholders('')).toBe('');
        });
    });

    describe('processCharacterPrompt', () => {
        it('should return original text if no $...$ macros present', () => {
            const text = 'masterpiece, 1girl, solo, swimsuit';
            expect(processCharacterPrompt(text)).toBe(text);
        });

        it('should clean unknown $...$ macros to empty string without adding double quotes', () => {
            const text = '1girl, $UnknownCharacter$, solo';
            const result = processCharacterPrompt(text);
            expect(result).not.toContain('$UnknownCharacter$');
            expect(result).not.toContain('"');
        });
    });

    describe('filterEnabledCharacters & filterEnabledOutfits', () => {
        const dummyScheme: EnableSchemeProfile = {
            id: 'test-scheme',
            name: 'Test Scheme',
            boundCharacterCards: 'TestCard',
            characterRules: {
                'char-1': { enabled: true, rule: 'ALL' },
                'char-2': { enabled: false, rule: 'ALL' }
            },
            outfitRules: {
                'outfit-1': { enabled: true, rule: 'match' }
            }
        };

        it('should return empty array if scheme is null', () => {
            expect(filterEnabledCharacters(null, 'test')).toEqual([]);
            expect(filterEnabledOutfits(null, 'test')).toEqual([]);
        });
    });

    describe('injectCharacterPlaceholders', () => {
        it('should replace {{角色启用列表}} and {{服装启用列表}} in template text', () => {
            const template = 'Prompt Prefix\n{{角色启用列表}}\n{{服装启用列表}}\nPrompt Suffix';
            const result = injectCharacterPlaceholders(template);
            expect(result).not.toContain('{{角色启用列表}}');
            expect(result).not.toContain('{{服装启用列表}}');
            expect(result).toContain('Prompt Prefix');
            expect(result).toContain('Prompt Suffix');
        });
    });
});
