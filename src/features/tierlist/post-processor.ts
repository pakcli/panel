import { extractRadarItems, TierListSidePanel, setupTierboardCardsIntegration } from './views/sidebar-radar-view';
import { renderViewSwitcher, renderCompareView, renderTableView, extractTierListItems, TierListItem } from './views/comparison-view';
import { QuickCompareModal } from './modals/quick-compare-modal';
import { MarkdownPostProcessorContext, Menu, App } from 'obsidian';
import Sortable from 'sortablejs';
import {
    moveLinesInActiveFile,
    replaceLineInActiveFile,
    readLineFromActiveFile,
    deleteLineInActiveFile,
    insertLineInActiveFile,
    replaceLinesInActiveFile
} from './utils/file-utils';
import { moveSlotBetweenTiers, reorderTiersByDOM, TierTarget, cleanTierName } from './utils/tierlist-markdown';
import { SlotModal } from './modals/slot-modal';
import { DataviewSearchModal } from './modals/request-modal';
import { TierListSettings, setSetting } from './settings';
import { LocalSettingsModal } from './modals/local-settings-modal';
import type { TierListManager } from './TierListManager';
import { renderSlot } from './utils/render-utils';

function getAPI(app?: any): any {
    return (app as any)?.plugins?.plugins?.dataview?.api || (window as any).DataviewAPI;
}

export function redraw(el: HTMLElement, settings: TierListSettings) {
    el.style.setProperty('--tier-list-width-ratio', `${settings.width / 100}`);
    el.style.setProperty('--screen-width', `${screen.width}px`);
    el.style.setProperty('--tier-list-slot-count', `${settings.slots}`);
    el.style.setProperty('--tier-list-aspect-ratio', `${settings.ratio}`);
    if (settings.fontSize && settings.fontSize.trim() !== '') {
        el.style.setProperty('--tier-list-font-size', settings.fontSize);
    } else {
        el.style.removeProperty('--tier-list-font-size');
    }
}

function findDataLine(el: HTMLElement): number {
    let closestLineElement: HTMLElement | null = null;
    let farthestLineElement: HTMLElement | null = null;
    let current: HTMLElement | null = el;

    while (current) {
        if (current.hasAttribute("data-line")) {
            if (!closestLineElement) {
                closestLineElement = current;
            }
            farthestLineElement = current;
        }
        current = current.parentElement;
    }

    if (closestLineElement && farthestLineElement) {
        const closestValue = parseInt(closestLineElement.getAttribute("data-line") || "0", 10);
        const farthestValue = parseInt(farthestLineElement.getAttribute("data-line") || "0", 10);
        return closestLineElement === farthestLineElement ? closestValue : closestValue + farthestValue;
    }

    return 0;
}

export async function searchFiles(from: string, where: string): Promise<string[]> {
    const dv = getAPI();
    if (!dv) return [];

    try {
        let query = `LIST FROM ${from}`;
        if (where) query += ` WHERE ${where}`;
        const result = await dv.query(query);
        return result.value.values.map((p: { path: any; }) => dv.page(p.path).file.name);

    } catch (error: any) {
        console.log(error?.message || error);
        return [];
    }
}

export function generateTierListPostProcessor(plugin: TierListManager): (tierList: HTMLElement, ctx: MarkdownPostProcessorContext) => void {
    const app = plugin.app;
    let scroll = 0;

    return async (tierList: HTMLElement, ctx: MarkdownPostProcessorContext) => {

        // Tier List Check
        const tagEl: HTMLElement = tierList.find(`a[href="${plugin.settings.tag}"]`);
        if (!tagEl)
            return;
        tagEl.remove();

        const sectionInfo = ctx.getSectionInfo(tierList);
        if (!sectionInfo)
            return;

        const localSettings: TierListSettings = { ...plugin.settings };
        const scrollableEl = document.documentElement.find('.markdown-preview-view');
        scrollableEl.scrollTo(0, scroll);

        function toPascalCase(str: string): string {
            return str.charAt(0).toUpperCase() + str.slice(1);
        }

        async function writeSetting(key: string, value: string) {
            const settingsList = tierList.find(".settings");
            const pascalKey = toPascalCase(key);
            const valueText = `\t- ${pascalKey}: ${value}`;
            if (settingsList) {
                for (const setting of settingsList.findAll('li')) {
                    const text = setting.textContent || '';
                    const [fileKey, fileValue] = text.split(':').map(item => item.trim());
                    if (fileKey.toLowerCase() == key.toLowerCase()) {
                        const settingLine = findDataLine(setting);
                        scroll = scrollableEl.scrollTop;
                        await replaceLineInActiveFile(app, settingLine, valueText);
                        return;
                    }
                }
                const settingLine = findDataLine(settingsList) + 1;
                scroll = scrollableEl.scrollTop;
                await insertLineInActiveFile(app, settingLine, valueText);
            }
            else {
                // if (sectionInfo) {
                //     const line = sectionInfo.lineEnd || 0;
                //     await insertLineInActiveFile(app, line + 1, `- ${localSettings.settings}`);
                //     await insertLineInActiveFile(app, line + 2, valueText);
                // }
            }
        }

        async function writeSettings(settings: Partial<TierListSettings>) {
            const settingsList = tierList.find(".settings");
            settings = Object.fromEntries(
                Object.entries(settings).filter(([key, value]) =>
                    plugin.settings[key as keyof TierListSettings] !== value
                ));
            const values = Object.entries(settings)
                .map(([key, value]) => `\t- ${toPascalCase(key)}: ${value}`);
            if (settingsList) {
                const settingLine = findDataLine(settingsList) + 1;
                scroll = scrollableEl.scrollTop;
                await replaceLinesInActiveFile(app, settingLine, settingsList.find("ul").children.length, values);
            }
            else {
                values.unshift(`- ${localSettings.settings}`);
                const settingsLine = ctx.getSectionInfo(tierList)?.lineEnd || 0;
                scroll = scrollableEl.scrollTop;
                await insertLineInActiveFile(app, settingsLine + 1, values.join('\n'));
            }
        }

        function getItemForSlot(slot: HTMLElement): TierListItem | null {
            const allItems = extractTierListItems(tierList, app, ctx.sourcePath);
            const linkEl = slot.querySelector<HTMLAnchorElement>('a.internal-link, a');
            const titleEl = slot.querySelector<HTMLElement>('.tier-list-title, .tier-list-title-text, span');
            const imgEl = slot.querySelector<HTMLImageElement>('img');
            let rawText = '';
            if (linkEl) {
                rawText = linkEl.textContent?.trim() || linkEl.getAttribute('data-href') || linkEl.getAttribute('href') || '';
            } else if (titleEl) {
                rawText = titleEl.textContent?.trim() || '';
            } else if (imgEl) {
                rawText = imgEl.getAttribute('alt') || 'Item';
            } else {
                rawText = slot.textContent?.trim() || '';
            }
            rawText = rawText.replace(/^[!\[\]]+/g, '').replace(/[\]]+$/g, '').split('|')[0].trim().toLowerCase();
            if (!rawText) return null;

            return allItems.find((it) => it.name.toLowerCase() === rawText || (it.linkPath && it.linkPath.toLowerCase().includes(rawText))) || null;
        }

        function openQuickCompareForSlot(slot: HTMLElement) {
            const allItems = extractTierListItems(tierList, app, ctx.sourcePath);
            const sourceItem = getItemForSlot(slot);
            if (!sourceItem || allItems.length < 2) return;

            new QuickCompareModal(app, sourceItem, allItems, (targetItem) => {
                switchView( '2', [sourceItem, targetItem]);
            }).open();
        }

        async function prepareSlot(slot: HTMLElement) {
            renderSlot(plugin, localSettings, slot)
            slot.addEventListener("contextmenu", async (evt) => {
                evt.preventDefault();
                evt.stopPropagation();
                const menu = new Menu();
                const line = findDataLine(slot);
                await addSlotContextMenuOptions(menu, line, slot);
                menu.showAtPosition({ x: evt.clientX, y: evt.clientY });
            })

            addClickHandler(slot);
            addCursorChangeHandler(slot);
        }

        function addCursorChangeHandler(slot: HTMLElement) {
            slot.addEventListener('mouseover', (event: MouseEvent) => {
                if (event.ctrlKey || event.metaKey) {
                    slot.classList.add('help-cursor');
                }
            });

            slot.addEventListener('mouseout', (event: MouseEvent) => {
                slot.classList.remove('help-cursor');
            });

            slot.addEventListener('mousemove', (event: MouseEvent) => {
                if (event.ctrlKey || event.metaKey) {
                    slot.classList.add('help-cursor');
                } else {
                    slot.classList.remove('help-cursor');
                }
            });
        }

        function addClickHandler(slot: HTMLElement) {
            slot.addEventListener('click', (event: MouseEvent) => {
                // If Alt key is held -> trigger Quick Compare shortcut directly!
                if (event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
                    event.preventDefault();
                    event.stopPropagation();
                    openQuickCompareForSlot(slot);
                    return;
                }

                // If modifier keys are held, let Obsidian handle standard shortcuts
                if (event.shiftKey || event.altKey) return;

                // Handle Excalidraw embeds
                if (slot.find('.excalidraw-embedded-img')) {
                    event.stopPropagation();
                    return;
                }

                const target = event.target as HTMLElement;

                // Check if user clicked on text (anchor link or title text overlay)
                const isTextClick = Boolean(
                    target && (
                        target.tagName === 'A' ||
                        target.closest('a') ||
                        target.classList.contains('tier-list-title-text') ||
                        target.closest('.tier-list-title-text') ||
                        target.closest('.tier-list-title')
                    )
                );

                if (isTextClick) {
                    // Requirement 3: If click the text -> open the file!
                    const anchor = (target.tagName === 'A' ? target : target.closest('a')) as HTMLAnchorElement | null;
                    const href = anchor?.getAttribute('data-href') || 
                                 anchor?.getAttribute('href') || 
                                 target.getAttribute('data-href') ||
                                 slot.getAttribute('href') || 
                                 slot.getAttribute('data-href');

                    if (href) {
                        event.preventDefault();
                        event.stopPropagation();

                        const isExternal = href.startsWith('http://') || href.startsWith('https://');
                        if (isExternal) {
                            window.open(href, '_blank');
                        } else {
                            const cleanHref = href.replace(/^[!\[\]]+/g, '').replace(/[\]]+$/g, '').split('|')[0].trim();
                            const file = app.metadataCache.getFirstLinkpathDest(cleanHref, ctx.sourcePath);
                            if (file) {
                                app.workspace.openLinkText(file.path, ctx.sourcePath, event.ctrlKey || event.metaKey);
                            } else {
                                app.workspace.openLinkText(cleanHref, ctx.sourcePath, event.ctrlKey || event.metaKey);
                            }
                        }
                    }
                    return;
                }

                // If user clicks on the box (not the text):
                // Do NOT preventDefault or stopPropagation here so setupTierboardCardsIntegration opens the sidebardock!
            });

            slot.addEventListener("dblclick", async (evt) => {
                evt.preventDefault();
                evt.stopPropagation();
                const line = findDataLine(slot);
                const str = await readLineFromActiveFile(app, line);
                new SlotModal(plugin, localSettings, "Change slot", str || "0", async (result) => {
                    scroll = scrollableEl.scrollTop;
                    if (result != "")
                        await replaceLineInActiveFile(app, line, result);
                    else
                        await deleteLineInActiveFile(app, line);
                }).open();
            });
        }

        async function addMissingSlots(names: string[], line: number) {
            names = await filterTierListNames(names);
            const text = names.map(name => `\t- [[${name}]]`).join("\n");

            if (text) {
                scroll = scrollableEl.scrollTop;
                await insertLineInActiveFile(app, line, text);
            }
        }

        function addListContextMenuOptions(menu: Menu, line: number) {
            menu.addItem((item) => item.setTitle("Add slot").setIcon("square-plus").onClick(() => {
                new SlotModal(plugin, localSettings, "Add slot", "\t", async (result) => {
                    if (result != "") {
                        scroll = scrollableEl.scrollTop;
                        await insertLineInActiveFile(app, line, result);
                    }
                }).open();
            }));

            menu.addItem((item) => item.setTitle("Settings").setIcon("settings").onClick(() => {
                new LocalSettingsModal(app, localSettings, (updatedSettings: Partial<TierListSettings>) => {
                    scroll = scrollableEl.scrollTop;
                    writeSettings(updatedSettings);
                }).open();
            }))

            // Dataview options
            const dv = getAPI();
            if (!dv) return;

            menu.addItem((item) => item.setTitle("Request").setIcon("search").onClick(() => {
                new DataviewSearchModal(app, localSettings.from, localSettings.where, async (names, from, where) => {
                    await writeSetting("Where", where);
                    await writeSetting("From", from);
                    addMissingSlots(names, line);
                }).open();
            }));

            if (localSettings.from) {
                menu.addItem((item) => item.setTitle("Add missing").setIcon("database").onClick(async () => {
                    const names = await searchFiles(localSettings.from, localSettings.where);
                    addMissingSlots(names, line);
                }))
            }
        }

        async function addSlotContextMenuOptions(menu: Menu, line: number, slot?: HTMLElement) {
            if (slot) {
                const sourceItem = getItemForSlot(slot);
                const allItems = extractTierListItems(tierList, app, ctx.sourcePath);
                if (sourceItem && allItems.length >= 2) {
                    menu.addItem((item) => {
                        item.setTitle("Quick Compare with...").setIcon("scale").onClick(() => {
                            openQuickCompareForSlot(slot);
                        });
                    });
                }
            }

            const str = await readLineFromActiveFile(app, line);
            menu.addItem((item) => item.setTitle("Edit slot").setIcon("pencil").onClick(() => {
                new SlotModal(plugin, localSettings, "Change slot", str || "0", async (result) => {
                    if (result != "") {
                        scroll = scrollableEl.scrollTop;
                        await replaceLineInActiveFile(app, line, result);
                    }
                    else {
                        scroll = scrollableEl.scrollTop;
                        await deleteLineInActiveFile(app, line);
                    }
                }).open();
            }));
            menu.addItem((item) => {
                (item as any).dom.addClass("is-warning");
                item.setTitle("Delete slot").setIcon("trash-2").onClick(async () => {
                    scroll = scrollableEl.scrollTop;
                    await deleteLineInActiveFile(app, line);
                })
            });
            menu.addItem((item) => {
                item.setTitle("Duplicate slot").setIcon("copy").onClick(async () => {
                    scroll = scrollableEl.scrollTop;
                    await insertLineInActiveFile(app, line, await readLineFromActiveFile(app, line) || '');
                })
            });
            addListContextMenuOptions(menu, line);
        }

        async function initializeSlots() {
            // Initialize Sortable for all Slots elements
            const slotGroupId = `slot-${sectionInfo?.lineStart || 'tier'}`;

            for (const list of tierList.findAll('ul > li > ul')) {
                if (list.closest('.settings') || list.parentElement?.classList.contains('settings')) continue;

                Sortable.create(list as HTMLElement, {
                    draggable: '.tier-list-slot',
                    group: {
                        name: slotGroupId,
                        pull: true,
                        put: [slotGroupId]
                    },
                    animation: localSettings.animation || 180,
                    fallbackOnBody: true,
                    forceFallback: true,
                    fallbackClass: 'sortable-fallback',
                    fallbackTolerance: 3,
                    ghostClass: 'tier-slot-ghost',
                    chosenClass: 'tier-slot-chosen',
                    dragClass: 'tier-slot-dragging',
                    emptyInsertThreshold: 25,
                    swapThreshold: 0.65,
                    invertSwap: true,
                    direction: 'horizontal',
                    filter: '.inline-card-checkbox',
                    preventOnFilter: false,
                    onMove: (evt) => {
                        // CRITICAL LOCK: Never accept tier rows into a slot list
                        if (evt.dragged.querySelector('.tier-list-tier') || evt.dragged.classList.contains('tier-list-tier')) {
                            return false;
                        }
                        if (!evt.dragged.classList.contains('tier-list-slot')) {
                            return false;
                        }
                        return true;
                    },
                    onStart: () => {
                        tierList.addClass('is-dragging-slot');
                    },
                    onEnd: async (evt) => {
                        tierList.removeClass('is-dragging-slot');
                        if (evt.oldIndex === evt.newIndex && evt.from === evt.to) return;

                        const fromLi = (evt.from.closest(':scope > ul > li') || evt.from.parentElement) as HTMLElement | null;
                        const toLi = (evt.to.closest(':scope > ul > li') || evt.to.parentElement) as HTMLElement | null;
                        if (!fromLi || !toLi) return;

                        const isFromUnordered = fromLi.querySelector('ul.unordered') !== null || evt.from.classList.contains('unordered');
                        const isToUnordered = toLi.querySelector('ul.unordered') !== null || evt.to.classList.contains('unordered');

                        const fromTierName = fromLi.querySelector('.tier-list-tier')?.textContent?.trim() || '';
                        const toTierName = toLi.querySelector('.tier-list-tier')?.textContent?.trim() || '';

                        const fromTarget = {
                            isUnordered: isFromUnordered,
                            tierName: fromTierName
                        };
                        const toTarget = {
                            isUnordered: isToUnordered,
                            tierName: toTierName
                        };

                        const oldSlotIndex = evt.oldIndex ?? 0;
                        const newSlotIndex = evt.newIndex ?? 0;

                        scroll = scrollableEl.scrollTop;
                        await moveSlotBetweenTiers(
                            app,
                            fromTarget,
                            oldSlotIndex,
                            toTarget,
                            newSlotIndex,
                            localSettings.unordered || 'To Rank',
                            localSettings.settings || 'Settings'
                        );
                    }
                });
                // Add Context Menu for lists
                list.addEventListener("contextmenu", async (evt) => {
                    evt.preventDefault();
                    const menu = new Menu();
                    const line = findDataLine(list) + list.children.length + 1;
                    addListContextMenuOptions(menu, line);
                    menu.showAtPosition({ x: evt.clientX, y: evt.clientY });
                })
                list.addEventListener("dblclick", (evt) => {
                    evt.preventDefault();
                    const line = findDataLine(list) + list.children.length + 1;
                    new SlotModal(plugin, localSettings, "Add slot", "\t", async (result) => {
                        if (result != "") {
                            scroll = scrollableEl.scrollTop;
                            await insertLineInActiveFile(app, line, result);
                        }
                    }).open();
                })
                for (const li of list.findAll("li")) {
                    prepareSlot(li);
                }
            };
        }

        function initializeRows() {
            const outerUl = tierList.find(":scope > ul");
            if (!outerUl) return;

            const rowGroupId = `tier-${sectionInfo?.lineStart || 'rows'}`;

            Sortable.create(outerUl, {
                handle: '.tier-list-tier',
                draggable: '>li:not(.settings)',
                group: {
                    name: rowGroupId,
                    pull: true,
                    put: [rowGroupId]
                },
                filter: '.settings',
                preventOnFilter: false,
                animation: localSettings.animation || 200,
                direction: 'vertical',
                swapThreshold: 0.65,
                invertSwap: true,
                fallbackOnBody: true,
                forceFallback: true,
                fallbackClass: 'sortable-row-fallback',
                fallbackTolerance: 3,
                ghostClass: 'tier-row-ghost',
                chosenClass: 'tier-row-chosen',
                dragClass: 'tier-row-dragging',
                onMove: (evt) => {
                    // Only allow sorting directly inside outerUl, never allow drop inside any child slot list!
                    if (evt.to !== outerUl) {
                        return false;
                    }
                    if (evt.dragged.classList.contains('tier-list-slot')) {
                        return false;
                    }
                    return true;
                },
                onStart: () => {
                    tierList.addClass('is-dragging-row');
                },
                onEnd: async (evt) => {
                    tierList.removeClass('is-dragging-row');
                    if (evt.oldIndex === evt.newIndex) return;

                    const orderedTargets: TierTarget[] = [];
                    outerUl.querySelectorAll(':scope > li').forEach(li => {
                        if (li.classList.contains('settings')) return;
                        const isUnordered = li.querySelector('ul.unordered') !== null || li.querySelector('.tier-unranked-tier') !== null;
                        const tierName = li.querySelector('.tier-list-tier')?.textContent?.trim() || '';
                        orderedTargets.push({
                            isUnordered,
                            tierName: cleanTierName(tierName)
                        });
                    });

                    scroll = scrollableEl.scrollTop;
                    await reorderTiersByDOM(
                        app,
                        orderedTargets,
                        localSettings.unordered || 'To Rank',
                        localSettings.settings || 'Settings'
                    );
                }
            });
        }

        async function initializeTierSlots() {
            const listItems = tierList.findAll(":scope > ul > li");
            for (const li of listItems.reverse()) {
                let text: string = "";
                let unordered: boolean = false;
                let isSettings = false;

                li.childNodes.forEach(node => {
                    if (node.nodeType === Node.TEXT_NODE) {
                        const trimmed = (node.nodeValue || "").trim();
                        const lower = trimmed.toLowerCase();

                        const isSettingsNode = (
                            (localSettings.settings && lower.startsWith(localSettings.settings.trim().toLowerCase())) ||
                            lower.startsWith('settings')
                        );

                        const isUnorderedNode = !isSettingsNode && (
                            (localSettings.unordered && lower.includes(localSettings.unordered.trim().toLowerCase())) ||
                            lower.includes('to rank') ||
                            lower.includes('unranked') ||
                            trimmed === '_'
                        );

                        if (isSettingsNode) {
                            isSettings = true;
                            settingsProcessing(li, localSettings);
                        }
                        else if (isUnorderedNode) {
                            unordered = true;
                        }
                        else {
                            text = text + node.nodeValue;
                        }
                        node.remove();
                    }
                });

                if (isSettings || li.classList.contains("settings")) {
                    li.style.setProperty("display", "none", "important");
                    continue;
                }

                if (!unordered) {
                    const innerList = li.find("ul");

                    const tierDiv = document.createElement("div");
                    tierDiv.addClass("tier-list-tier");

                    const nodesToMove = Array.from(li.childNodes).filter(node => node !== innerList);
                    if (nodesToMove.length > 0) {
                        nodesToMove.forEach(node => tierDiv.appendChild(node));
                    } else if (text) {
                        const span = document.createElement("span");
                        span.textContent = text;
                        tierDiv.appendChild(span);
                    }

                    // Ensure all spans fill the tier box edge-to-edge
                    tierDiv.querySelectorAll('span').forEach(sp => {
                        sp.style.setProperty('width', '100%', 'important');
                        sp.style.setProperty('height', '100%', 'important');
                        sp.style.setProperty('min-height', '100%', 'important');
                        sp.style.setProperty('display', 'flex', 'important');
                        sp.style.setProperty('align-items', 'center', 'important');
                        sp.style.setProperty('justify-content', 'center', 'important');
                        sp.style.setProperty('box-sizing', 'border-box', 'important');
                    });

                    li.prepend(tierDiv);
                }
                else {
                    const innerList = li.find("ul");
                    if (innerList) innerList.addClass("unordered");

                    const tierDiv = document.createElement("div");
                    tierDiv.addClass("tier-list-tier");
                    tierDiv.addClass("tier-unranked-tier");
                    const span = document.createElement("span");
                    span.textContent = localSettings.unordered || "To Rank";
                    span.style.setProperty('background', 'var(--background-secondary-alt, #374151)', 'important');
                    span.style.setProperty('color', 'var(--text-muted, #e5e7eb)', 'important');
                    span.style.setProperty('width', '100%', 'important');
                    span.style.setProperty('height', '100%', 'important');
                    span.style.setProperty('min-height', '100%', 'important');
                    span.style.setProperty('display', 'flex', 'important');
                    span.style.setProperty('align-items', 'center', 'important');
                    span.style.setProperty('justify-content', 'center', 'important');
                    span.style.setProperty('box-sizing', 'border-box', 'important');
                    tierDiv.appendChild(span);

                    li.prepend(tierDiv);
                }
            }
        }

        function toCamelCase(str: string): string {
            return str.charAt(0).toLowerCase() + str.slice(1);
        }

        function settingsProcessing(list: HTMLElement, settings: TierListSettings) {
            list.addClass("settings");
            list.style.setProperty("display", "none", "important");
            const pairs: { [key: string]: string } = {};

            list.findAll('li').forEach(setting => {
                const text = setting.textContent || '';
                const [key, value] = text.split(':').map(item => item.trim());
                if (key && value) {
                    pairs[toCamelCase(key)] = value;
                }
            });

            for (const [key, value] of Object.entries(pairs)) {
                setSetting(key, value, settings);
            }
        }

        async function filterTierListNames(names: string[]): Promise<string[]> {
            if (!sectionInfo) return names;

            const activeFile = app.workspace.getActiveFile();
            if (!activeFile) return names;
            const fileContent = await app.vault.read(activeFile);

            const tierListLines = fileContent.split("\n").slice(sectionInfo.lineStart, sectionInfo.lineEnd + 1);

            function extractName(line: string): string | null {
                line = line.trim();
                if (!line.startsWith("- ")) return null;
                line = line.substring(2);

                line = line.replace(/<span[^>]*>(.*?)<\/span>/g, "$1");

                line = line.replace(/^!+/, "");

                const matchBracket = line.match(/^\[\[(.*?)(?:\s*\|\s*.*?)?\]\]/);
                if (matchBracket) return matchBracket[1];

                const matchParens = line.match(/^\[[^\]]*\]\((.*?)\)/);
                if (matchParens) return matchParens[1];

                return line;
            }

            const existingNames = new Set<string>();
            for (const line of tierListLines) {
                const name = extractName(line);
                if (name) existingNames.add(name);
            }

            return names.filter(name => !existingNames.has(name));
        }

        // HTML cleanup
        tierList.setAttr("data-line", sectionInfo.lineStart || 0);
        tierList.addClass("tier-list");
        tierList.addClass("tier-list-embed-layout");
        const currentDock = (localStorage.getItem('tierlist_sidebar_dock') as string) || 'EMBED';
        if (currentDock === 'EMBED') {
            tierList.addClass("dock-is-embed");
        } else {
            tierList.removeClass("dock-is-embed");
        }
        tierList.addClass("has-sidepanel-open");
        tierList.findAll(":scope > ul > li:not(:has(ul))").forEach(list => {
            const newul = document.createElement("ul");
            list.appendChild(newul);
        })

        await initializeTierSlots();
        await initializeSlots();
        await initializeRows();

        // Initialize Side Panel & Radar View for Mode 0
        const initialRaw = extractTierListItems(tierList, app, ctx.sourcePath);
        const { items: radarItems, boardConfig } = extractRadarItems(initialRaw, app, ctx.sourcePath);
        const sidePanel = new TierListSidePanel(app, tierList, tierList, boardConfig, radarItems);
        sidePanel.init();

        // Attach card checkboxes and click-to-inspect
        setupTierboardCardsIntegration(tierList, sidePanel, radarItems);

        // Create containers for Versus and Matrix views
        const versusContainer = document.createElement("div");
        versusContainer.addClass("tier-versus-view");
        versusContainer.style.display = "none";
        versusContainer.style.width = "100%";
        versusContainer.style.maxWidth = "calc(var(--screen-width, 100%) * var(--tier-list-width-ratio, 0.7))";
        tierList.appendChild(versusContainer);

        const matrixContainer = document.createElement("div");
        matrixContainer.addClass("tier-matrix-view");
        matrixContainer.style.display = "none";
        matrixContainer.style.width = "100%";
        matrixContainer.style.maxWidth = "calc(var(--screen-width, 100%) * var(--tier-list-width-ratio, 0.7))";
        tierList.appendChild(matrixContainer);

        let activeMode = String(localSettings.mode || "0").trim().toLowerCase();
        let switcherEl: HTMLElement | null = null;
        let activeQuickCompareItems: TierListItem[] | undefined = undefined;

        function switchView(mode: string, quickCompareItems?: TierListItem[]) {
            activeMode = mode;
            localSettings.mode = mode;
            if (quickCompareItems) {
                activeQuickCompareItems = quickCompareItems;
            } else if (mode === '0' || mode === '3') {
                activeQuickCompareItems = undefined;
            }

            const isVenn = (mode === "4" || mode === "venn");
            const isCompare = (mode === "2" || mode === "compare" || mode === "different" || mode === "versus" || mode === "couple" || mode === "vs");
            const isTable = (mode === "3" || mode === "tableview" || mode === "table" || mode === "matrix");
            const isTier = !isCompare && !isTable && !isVenn;

            tierList.classList.toggle('mode-compare', isCompare);
            tierList.classList.toggle('mode-venn', isVenn);
            tierList.classList.toggle('mode-tableview', isTable);
            tierList.classList.toggle('mode-tier', isTier);

            // Sync active tab in switcher header
            if (switcherEl) {
                switcherEl.querySelectorAll<HTMLButtonElement>('.tier-tab-btn').forEach((btn) => {
                    const btnMode = btn.getAttribute('data-mode');
                    if (btnMode) {
                        const isNowActive = (
                            (btnMode === '0' && isTier) ||
                            (btnMode === '2' && isCompare) ||
                            (btnMode === '3' && isTable) ||
                            (btnMode === '4' && isVenn)
                        );
                        if (isNowActive) btn.classList.add('active');
                        else btn.classList.remove('active');
                    }
                });
            }

            const mainUlList = tierList.findAll(":scope > ul, .unordered");

            if (isCompare || isVenn) {
                tierList.removeClass("has-sidepanel-open");
                mainUlList.forEach(ul => ul.style.setProperty("display", "none", "important"));
                matrixContainer.style.setProperty("display", "none", "important");
                versusContainer.style.setProperty("display", "block", "important");
                sidePanel.close();
                const items = extractTierListItems(tierList, app, ctx.sourcePath);
                renderCompareView(
                    versusContainer,
                    items,
                    app,
                    ctx.sourcePath,
                    localSettings,
                    activeQuickCompareItems,
                    () => switchView('0'),
                    isVenn ? 'venn' : 'card'
                );
            } else if (isTable) {
                tierList.removeClass("has-sidepanel-open");
                mainUlList.forEach(ul => ul.style.setProperty("display", "none", "important"));
                versusContainer.style.setProperty("display", "none", "important");
                matrixContainer.style.setProperty("display", "block", "important");
                sidePanel.close();
                const items = extractTierListItems(tierList, app, ctx.sourcePath);
                renderTableView(matrixContainer, items, app, ctx.sourcePath, localSettings);
            } else {
                // Default Mode 0 (Tier Board)
                versusContainer.style.setProperty("display", "none", "important");
                matrixContainer.style.setProperty("display", "none", "important");
                mainUlList.forEach(ul => ul.style.removeProperty("display"));
                if (sidePanel.panelEl) {
                    sidePanel.panelEl.style.removeProperty("display");
                    sidePanel.panelEl.classList.add("show");
                    tierList.classList.add("has-sidepanel-open");
                }

                const currentRaw = extractTierListItems(tierList, app, ctx.sourcePath);
                const { items: updatedRadar } = extractRadarItems(currentRaw, app, ctx.sourcePath);
                sidePanel.updateItems(updatedRadar);
                setupTierboardCardsIntegration(tierList, sidePanel, updatedRadar);
            }
        }

        // Initial title state
        const initialShowTitles = Boolean(localSettings.title);
        tierList.classList.toggle('show-titles', initialShowTitles);

        // Prepend View Switcher Tabs at top of tierList
        switcherEl = renderViewSwitcher(
            activeMode,
            (mode) => {
                switchView(mode);
            },
            () => {
                sidePanel.toggle();
            },
            {
                showText: Boolean(localSettings.title),
                onToggleText: async () => {
                    localSettings.title = !localSettings.title;
                    tierList.classList.toggle('show-titles', localSettings.title);
                    const btn = switcherEl?.querySelector('.tier-tab-text-btn');
                    if (btn) {
                        btn.classList.toggle('active', localSettings.title);
                    }
                    scroll = scrollableEl.scrollTop;
                    await writeSetting('title', String(localSettings.title));
                },
                onOpenSettings: () => {
                    new LocalSettingsModal(app, localSettings, async (updatedSettings: Partial<TierListSettings>) => {
                        scroll = scrollableEl.scrollTop;
                        await writeSettings(updatedSettings);
                    }).open();
                }
            }
        );
        tierList.prepend(switcherEl);

        // Apply initial mode
        switchView(activeMode);

        redraw(tierList, localSettings);
        scrollableEl.scrollTo(0, scroll);
    }
}
