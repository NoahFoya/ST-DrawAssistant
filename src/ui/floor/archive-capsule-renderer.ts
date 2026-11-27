/**
 * 楼层角色与服装档案块折叠及胶囊徽标渲染器 (`archive-capsule-renderer.ts`)。
 */

import type { CharacterExtractionConfig } from '@types';
import { splitKeywordTokens } from '../../domain';
import type { ExtractedArchiveItem } from '../../pipeline/archive-extractor';

/**
 * 折叠消息正文中的档案块原文（按需）并挂载轻量可点击 `.da-floor-archive-badges` 胶囊栏。
 */
export function renderArchiveCapsules(params: {
    container: HTMLElement;
    archives: ExtractedArchiveItem[];
    extractionCfg: CharacterExtractionConfig;
    onBadgeClick: (items: ExtractedArchiveItem[]) => void;
}): void {
    const { container, archives, extractionCfg, onBadgeClick } = params;

    const oldBadgeBar = container.querySelector('.da-floor-archive-badges');
    if (oldBadgeBar) {
        oldBadgeBar.remove();
    }

    if (archives.length === 0) {
        return;
    }

    const shouldCollapse = extractionCfg?.collapseInFloor !== false;
    if (shouldCollapse) {
        for (const arch of archives) {
            let replacedInSingleNode = false;
            const singleWalker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
            while (true) {
                const node = singleWalker.nextNode() as Text | null;
                if (!node) break;
                const val = node.nodeValue || '';
                if (val.includes(arch.rawBlock)) {
                    node.nodeValue = val.replace(arch.rawBlock, '').trim();
                    replacedInSingleNode = true;
                    break;
                }
            }

            if (!replacedInSingleNode) {
                const sTag =
                    (arch.kind === 'character'
                        ? extractionCfg?.charStartTag
                        : extractionCfg?.outfitStartTag) ||
                    (arch.kind === 'character' ? '<character>' : '<outfit>');
                const eTag =
                    (arch.kind === 'character'
                        ? extractionCfg?.charEndTag
                        : extractionCfg?.outfitEndTag) ||
                    (arch.kind === 'character' ? '</character>' : '</outfit>');

                const allTextNodes: Text[] = [];
                const multiWalker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
                while (true) {
                    const node = multiWalker.nextNode() as Text | null;
                    if (!node) break;
                    allTextNodes.push(node);
                }

                let startNodeIdx = -1;
                let endNodeIdx = -1;
                for (let i = 0; i < allTextNodes.length; i++) {
                    if (startNodeIdx === -1 && allTextNodes[i].nodeValue?.includes(sTag)) {
                        startNodeIdx = i;
                    }
                    if (startNodeIdx !== -1 && allTextNodes[i].nodeValue?.includes(eTag)) {
                        endNodeIdx = i;
                        break;
                    }
                }

                if (startNodeIdx !== -1 && endNodeIdx !== -1) {
                    const startNode = allTextNodes[startNodeIdx];
                    const endNode = allTextNodes[endNodeIdx];

                    if (startNodeIdx === endNodeIdx) {
                        const val = startNode.nodeValue || '';
                        const sPos = val.indexOf(sTag);
                        const ePos = val.indexOf(eTag, sPos);
                        if (sPos !== -1 && ePos !== -1) {
                            startNode.nodeValue =
                                val.slice(0, sPos) + val.slice(ePos + eTag.length);
                        }
                    } else {
                        const startVal = startNode.nodeValue || '';
                        const sPos = startVal.indexOf(sTag);
                        if (sPos !== -1) {
                            startNode.nodeValue = startVal.slice(0, sPos);
                        }

                        for (let i = startNodeIdx + 1; i < endNodeIdx; i++) {
                            allTextNodes[i].nodeValue = '';
                        }

                        const endVal = endNode.nodeValue || '';
                        const ePos = endVal.indexOf(eTag);
                        if (ePos !== -1) {
                            endNode.nodeValue = endVal.slice(ePos + eTag.length);
                        }
                    }
                }
            }
        }
    }

    const badgeBar = document.createElement('div');
    badgeBar.className = 'da-floor-archive-badges';

    for (const arch of archives) {
        const firstAlias = splitKeywordTokens(arch.aliases)[0] || '';
        const labelSuffix =
            firstAlias && firstAlias.toLowerCase() !== arch.name.toLowerCase()
                ? ` (${firstAlias})`
                : '';
        const badge = document.createElement('button');
        badge.type = 'button';
        badge.className = 'da-btn da-btn--secondary da-btn--sm da-floor-archive-badge';
        badge.textContent =
            arch.kind === 'character'
                ? `角色档案: ${arch.name}${labelSuffix}`
                : `服装档案: ${arch.name}${labelSuffix}`;
        badge.title = '点击查看或导入该楼层提取的角色/服装档案';
        badge.addEventListener('click', (e) => {
            e.stopPropagation();
            onBadgeClick(archives);
        });
        badgeBar.appendChild(badge);
    }

    container.appendChild(badgeBar);
}
