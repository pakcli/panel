import { MarkdownRenderer, Plugin } from 'obsidian';
import { TierListSettings } from '../settings';

function extractStringVal(val: any): string | null {
    if (!val) return null;
    if (typeof val === 'string' && val.trim()) return val.trim();
    if (Array.isArray(val) && val.length > 0) {
        return extractStringVal(val[0]);
    }
    if (typeof val === 'object') {
        if (val.path && typeof val.path === 'string') return val.path.trim();
        if (val.link && typeof val.link === 'string') return val.link.trim();
    }
    return null;
}

export function resolveFrontmatterThumbnail(fm?: Record<string, any>): string | null {
    if (!fm || typeof fm !== 'object') return null;

    // 1. image / Image (exact / case-insensitive)
    for (const key of Object.keys(fm)) {
        if (key.toLowerCase() === 'image') {
            const v = extractStringVal(fm[key]);
            if (v) return v;
        }
    }

    // 2. img / Img
    for (const key of Object.keys(fm)) {
        if (key.toLowerCase() === 'img') {
            const v = extractStringVal(fm[key]);
            if (v) return v;
        }
    }

    // 3. thumbnail / Thumbnail / thumb / Thumb
    for (const key of Object.keys(fm)) {
        const lk = key.toLowerCase();
        if (lk === 'thumbnail' || lk === 'thumb') {
            const v = extractStringVal(fm[key]);
            if (v) return v;
        }
    }

    // 4. banner / Banner / cover / Cover / poster / photo
    for (const key of Object.keys(fm)) {
        const lk = key.toLowerCase();
        if (lk === 'banner' || lk === 'cover' || lk === 'poster' || lk === 'photo') {
            const v = extractStringVal(fm[key]);
            if (v) return v;
        }
    }

    // 5. Fallback: Any key containing 'image', 'img', or 'thumb'
    for (const [k, v] of Object.entries(fm)) {
        const lk = k.toLowerCase();
        if (lk.includes('image') || lk.includes('img') || lk.includes('thumb')) {
            const str = extractStringVal(v);
            if (str) return str;
        }
    }

    return null;
}

function formatImageMarkdown(raw: string): string {
    raw = raw.trim();
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
        return `![](${raw})`;
    }
    if (raw.startsWith('![[') && raw.endsWith(']]')) {
        return raw;
    }
    if (raw.startsWith('[[') && raw.endsWith(']]')) {
        return `!${raw}`;
    }
    return `![[${raw}]]`;
}

export function applyAutoFitFontSize(slot: HTMLElement, element: HTMLElement, text: string) {
    const len = text.trim().length;
    let size = '11px';
    let lineHeight = '1.15';
    let maxLines = '4';

    if (len > 32) {
        size = '8px';
        lineHeight = '1.02';
        maxLines = '4';
    } else if (len > 22) {
        size = '8.5px';
        lineHeight = '1.08';
        maxLines = '4';
    } else if (len > 15) {
        size = '9.5px';
        lineHeight = '1.12';
        maxLines = '3';
    } else if (len > 8) {
        size = '10.5px';
        lineHeight = '1.15';
        maxLines = '3';
    } else {
        size = '12px';
        lineHeight = '1.18';
        maxLines = '2';
    }

    slot.style.setProperty('--tier-slot-font-size', size);
    slot.style.setProperty('--tier-slot-line-height', lineHeight);

    element.style.setProperty('font-size', size, 'important');
    element.style.setProperty('line-height', lineHeight, 'important');
    element.style.setProperty('-webkit-line-clamp', maxLines, 'important');
    element.style.setProperty('-webkit-box-orient', 'vertical', 'important');
    element.style.setProperty('display', '-webkit-box', 'important');
    element.style.setProperty('max-height', '100%', 'important');
    element.style.setProperty('max-width', '100%', 'important');
    element.style.setProperty('overflow', 'hidden', 'important');
    element.style.setProperty('text-overflow', 'ellipsis', 'important');
    element.style.setProperty('word-break', 'break-word', 'important');
    element.style.setProperty('text-align', 'center', 'important');
}

export async function renderSlot(plugin: any, settings: TierListSettings, slot: HTMLElement): Promise<HTMLElement> {
    const app = plugin.app;
    slot.addClass("tier-list-slot");

    // Check for internal-embed span and replace with img
    const link = slot.find('a.internal-link');
    if (link && !link.getAttribute('href')?.match(/\.(jpeg|jpg|gif|png|webp)$/i)) {
        const filePath = link.getAttribute('href');
        if (filePath) {
            slot.setAttr('href', filePath);
            slot.setAttr('data-href', filePath);
            const file = app.metadataCache.getFirstLinkpathDest(filePath, '');
            if (file) {
                const fileCache = app.metadataCache.getFileCache(file);
                const parent = link.parentElement;
                
                // Requirement 4: Detect frontmatter properties as thumbnail with fallback priority
                // 1. image -> 2. img -> 3. thumbnail / thumb -> 4. banner -> 5. custom setting
                let imageSrc = resolveFrontmatterThumbnail(fileCache?.frontmatter);
                if (!imageSrc && settings.image && fileCache?.frontmatter && fileCache.frontmatter[settings.image]) {
                    imageSrc = String(fileCache.frontmatter[settings.image]).trim();
                }

                if (imageSrc && parent) {
                    const md = formatImageMarkdown(imageSrc);
                    parent.textContent = '';
                    await MarkdownRenderer.render(app, md, parent, '', plugin);
                    addTitle(slot, link.textContent || '', filePath);
                    slot.setAttr('title', link.textContent);
                } else {
                    // Requirement 1: Text-only card auto-size to fit box
                    slot.addClass("tier-list-slot-text-card");
                    const text = (link.textContent || '').trim();
                    applyAutoFitFontSize(slot, link, text);
                }
            } else {
                // Link not found as TFile, auto-fit text anyway
                slot.addClass("tier-list-slot-text-card");
                const text = (link.textContent || '').trim();
                applyAutoFitFontSize(slot, link, text);
            }
        }
    } else if (!slot.find('img')) {
        // Plain text card without link tag
        slot.addClass("tier-list-slot-text-card");
        const rawText = (slot.textContent || '').trim();
        if (rawText) {
            slot.setAttr('data-href', rawText);
            const span = slot.find('span') || slot;
            applyAutoFitFontSize(slot, span, rawText);
        }
    }

    // Prevent browser native drag on images and links so SortableJS can drag smoothly
    slot.findAll('img, a').forEach((el) => {
        el.setAttribute('draggable', 'false');
    });

    // Wait for the Exacalidraw render
    setTimeout(() => {
        slot.findAll('img, a').forEach((el) => {
            el.setAttribute('draggable', 'false');
        });
        slot.findAll(".excalidraw-embedded-img").forEach(excalidrawEl => {
            const newElement = excalidrawEl.cloneNode(true);
            excalidrawEl.parentElement?.replaceChild(newElement, excalidrawEl);
        })
    }, 50);

    const child = slot.find('[style*="background"]')
    if (child) {
        slot.style.backgroundColor = child.style.backgroundColor;
    }

    const fileEmbed = slot.find('.internal-embed.file-embed.mod-generic.is-loaded')
    if (fileEmbed) {
        const textNode = findTextNodeRecursive(fileEmbed);
        if (textNode) {
            textNode.nodeValue = fileEmbed.getAttr('alt');
        }
    }

    const altEl = slot.find('[alt]')
    if (altEl && !fileEmbed) {
        addTitle(slot, altEl.getAttr('alt') || '');
        slot.setAttr('title', altEl.getAttr('alt'));
    }

    const embedTitle = slot.find('.markdown-embed-title');
    if (embedTitle) {
        embedTitle.remove();
    }

    return slot;
}

function addTitle(parentElement: HTMLElement, text: string, href?: string) {
    if (parentElement.find('.tier-list-title')) return;

    const textOverlay = parentElement.createEl('div', {
        cls: 'tier-list-title',
    });

    const backgroundElement = textOverlay.createEl('div', {
        cls: 'tier-list-title-background',
    });

    const textElement = textOverlay.createEl('span', {
        text: text,
        cls: 'tier-list-title-text',
    });

    if (href) {
        textOverlay.setAttribute('data-href', href);
        textElement.setAttribute('data-href', href);
    }
}

function findTextNodeRecursive(element: HTMLElement): Text | null {
    const childNodesArray: ChildNode[] = Array.from(element.childNodes);

    for (const node of childNodesArray) {
        if (node.nodeType === Node.TEXT_NODE) {
            return node as Text;
        }
        if (node.nodeType === Node.ELEMENT_NODE) {
            const found = findTextNodeRecursive(node as HTMLElement);
            if (found) return found;
        }
    }
    return null;
}

