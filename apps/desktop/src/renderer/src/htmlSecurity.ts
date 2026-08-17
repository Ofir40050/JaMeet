/**
 * Safe HTML escaping, avatar color validation, and rich-text songwriting sanitization helpers.
 */

const ALLOWED_TAGS = new Set([
  'B', 'STRONG', 'I', 'EM', 'U', 'STRIKE', 'S', 'DEL',
  'P', 'DIV', 'SPAN',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'UL', 'OL', 'LI',
  'BR', 'FONT', 'HR', 'BLOCKQUOTE'
]);

const DISALLOWED_CONTAINER_TAGS = new Set([
  'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'NOSCRIPT', 'SVG', 'MATH',
  'LINK', 'META', 'TEMPLATE', 'APPLET', 'FRAME', 'FRAMESET', 'BASE', 'FORM',
  'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'OPTION'
]);

const ALLOWED_CLASSES = new Set([
  'song-section-tag',
  'doc-page-break-gap'
]);

const ALLOWED_STYLE_PROPERTIES = new Set([
  'color',
  'background-color',
  'font-family',
  'font-size',
  'text-align',
  'line-height',
  'font-weight',
  'font-style',
  'text-decoration',
  'margin-top',
  'margin-bottom',
  'margin-left',
  'margin-right'
]);

// Strict safe CSS value validator: disallow quotes, brackets, semicolons, escapes, backticks, urls, expressions, scripts
const SAFE_CSS_VALUE_REGEX = /^[a-zA-Z0-9\s#.,%_\-()]+$/;

export function isSafeCssValue(val: string): boolean {
  if (!val || typeof val !== 'string') return false;
  const trimmed = val.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return false;
  if (!SAFE_CSS_VALUE_REGEX.test(trimmed)) return false;
  const lower = trimmed.toLowerCase();
  if (
    lower.includes('url') ||
    lower.includes('expression') ||
    lower.includes('javascript') ||
    lower.includes('behavior') ||
    lower.includes('import') ||
    lower.includes('-moz-binding')
  ) {
    return false;
  }
  return true;
}

const SAFE_AVATAR_COLOR_REGEX =
  /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$|^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$|^hsla?\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$|^var\(--[a-zA-Z0-9_\-]+\)$/;

/**
 * Validates user-controlled avatarColor values.
 * Returns the trimmed valid color or a safe fallback to prevent style/attribute breakout.
 */
export function safeAvatarColor(color: unknown, fallback = '#38bdf8'): string {
  if (typeof color === 'string') {
    const trimmed = color.trim();
    if (SAFE_AVATAR_COLOR_REGEX.test(trimmed)) {
      return trimmed;
    }
  }
  return fallback;
}

/**
 * Escapes special HTML characters (&, <, >, ", ') for safe interpolation into DOM templates.
 */
export function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Lightweight DOM tree implementation for environments without DOMParser (e.g. Node/Vitest).
 */
class MiniStyle {
  private _props = new Map<string, string>();

  getPropertyValue(prop: string): string {
    return this._props.get(prop.toLowerCase()) || '';
  }

  setProperty(prop: string, val: string): void {
    this._props.set(prop.toLowerCase(), val);
  }

  removeProperty(prop: string): void {
    this._props.delete(prop.toLowerCase());
  }

  get length(): number {
    return this._props.size;
  }

  clear(): void {
    this._props.clear();
  }

  toString(): string {
    const rules: string[] = [];
    for (const [k, v] of this._props.entries()) {
      rules.push(`${k}: ${v}`);
    }
    return rules.join('; ');
  }
}

class MiniNode {
  nodeType: number; // 1: element, 3: text, 8: comment
  nodeName: string;
  tagName: string;
  textContent: string;
  childNodes: MiniNode[] = [];
  parentNode: MiniNode | null = null;
  attributes: Array<{ name: string; value: string }> = [];
  style = new MiniStyle();

  constructor(type: number, name = '', value = '') {
    this.nodeType = type;
    this.nodeName = name.toUpperCase();
    this.tagName = name.toUpperCase();
    this.textContent = value;
  }

  get className(): string {
    const attr = this.attributes.find((a) => a.name.toLowerCase() === 'class');
    return attr ? attr.value : '';
  }

  set className(val: string) {
    this.setAttribute('class', val);
  }

  getAttribute(name: string): string | null {
    const attr = this.attributes.find((a) => a.name.toLowerCase() === name.toLowerCase());
    return attr ? attr.value : null;
  }

  setAttribute(name: string, value: string): void {
    const attr = this.attributes.find((a) => a.name.toLowerCase() === name.toLowerCase());
    if (attr) {
      attr.value = value;
    } else {
      this.attributes.push({ name, value });
    }
  }

  removeAttribute(name: string): void {
    this.attributes = this.attributes.filter((a) => a.name.toLowerCase() !== name.toLowerCase());
  }

  insertBefore(newChild: MiniNode, refChild: MiniNode | null): MiniNode {
    if (newChild.parentNode) {
      newChild.parentNode.removeChild(newChild);
    }
    newChild.parentNode = this;
    const idx = refChild ? this.childNodes.indexOf(refChild) : -1;
    if (idx !== -1) {
      this.childNodes.splice(idx, 0, newChild);
    } else {
      this.childNodes.push(newChild);
    }
    return newChild;
  }

  appendChild(child: MiniNode): MiniNode {
    return this.insertBefore(child, null);
  }

  removeChild(child: MiniNode): MiniNode {
    const idx = this.childNodes.indexOf(child);
    if (idx !== -1) {
      this.childNodes.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  remove(): void {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  get firstChild(): MiniNode | null {
    return this.childNodes[0] || null;
  }

  get innerHTML(): string {
    if (this.nodeType === 3) return this.textContent;
    if (this.nodeType === 8) return '';
    return this.childNodes.map((c) => serializeMiniNode(c)).join('');
  }
}

function serializeMiniNode(node: MiniNode): string {
  if (node.nodeType === 3) return node.textContent;
  if (node.nodeType === 8) return '';
  const tag = node.tagName.toLowerCase();
  const attrs: string[] = [];

  for (const a of node.attributes) {
    if (a.name.toLowerCase() === 'style') {
      const styleStr = node.style.toString();
      if (styleStr) {
        attrs.push(`style="${escapeHtml(styleStr)}"`);
      }
    } else {
      attrs.push(`${a.name}="${escapeHtml(a.value)}"`);
    }
  }

  const attrStr = attrs.length > 0 ? ` ${attrs.join(' ')}` : '';
  if (['br', 'hr', 'img', 'input'].includes(tag) && node.childNodes.length === 0) {
    return `<${tag}${attrStr}>`;
  }
  return `<${tag}${attrStr}>${node.childNodes.map((c) => serializeMiniNode(c)).join('')}</${tag}>`;
}

function parseHtmlToMiniDom(html: string): MiniNode {
  const root = new MiniNode(1, 'body');
  const stack: MiniNode[] = [root];
  const tagRegex = /<!--[\s\S]*?-->|<(?:\/([a-zA-Z0-9_\-]+)|([a-zA-Z0-9_\-]+)([^>]*?))(\/)?>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(html)) !== null) {
    const textBefore = html.slice(lastIndex, match.index);
    if (textBefore.length > 0) {
      stack[stack.length - 1].appendChild(new MiniNode(3, '#text', textBefore));
    }
    lastIndex = tagRegex.lastIndex;

    const fullMatch = match[0];
    if (fullMatch.startsWith('<!--')) {
      stack[stack.length - 1].appendChild(new MiniNode(8, '#comment', fullMatch.slice(4, -3)));
      continue;
    }

    const closeTag = match[1];
    const openTag = match[2];
    const rawAttrs = match[3] ?? '';
    const isSelfClosing = Boolean(match[4]) || ['br', 'hr', 'img', 'input', 'meta', 'link'].includes(openTag?.toLowerCase() || '');

    if (closeTag) {
      const closeUpper = closeTag.toUpperCase();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName === closeUpper) {
          stack.length = i;
          break;
        }
      }
    } else if (openTag) {
      const elem = new MiniNode(1, openTag);
      const attrRegex = /([a-zA-Z0-9_\-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let attrMatch: RegExpExecArray | null;

      while ((attrMatch = attrRegex.exec(rawAttrs)) !== null) {
        const attrName = attrMatch[1];
        const attrVal = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? '';
        elem.setAttribute(attrName, attrVal);
        if (attrName.toLowerCase() === 'style') {
          const rules = attrVal.split(';');
          for (const rule of rules) {
            const colon = rule.indexOf(':');
            if (colon !== -1) {
              const p = rule.slice(0, colon).trim().toLowerCase();
              const v = rule.slice(colon + 1).trim();
              elem.style.setProperty(p, v);
            }
          }
        }
      }

      stack[stack.length - 1].appendChild(elem);
      if (!isSelfClosing) {
        stack.push(elem);
      }
    }
  }

  const trailingText = html.slice(lastIndex);
  if (trailingText.length > 0) {
    stack[stack.length - 1].appendChild(new MiniNode(3, '#text', trailingText));
  }

  return root;
}

/**
 * Recursively applies allowlist sanitization on a DOM node tree.
 */
function cleanDomNode(node: Node | MiniNode): void {
  const childNodes = Array.from(node.childNodes) as Array<HTMLElement | MiniNode>;

  for (const child of childNodes) {
    if (child.nodeType === 8 /* COMMENT_NODE */) {
      if ('remove' in child && typeof child.remove === 'function') {
        child.remove();
      } else if (child.parentNode) {
        child.parentNode.removeChild(child as any);
      }
      continue;
    }

    if (child.nodeType === 1 /* ELEMENT_NODE */) {
      const el = child;
      const tagName = (el.tagName || el.nodeName || '').toUpperCase();

      if (DISALLOWED_CONTAINER_TAGS.has(tagName)) {
        if ('remove' in el && typeof el.remove === 'function') {
          el.remove();
        } else if (el.parentNode) {
          el.parentNode.removeChild(el as any);
        }
        continue;
      }

      if (!ALLOWED_TAGS.has(tagName)) {
        // Disallowed tag: unwrap children into parent
        cleanDomNode(el);
        while (el.firstChild) {
          el.parentNode?.insertBefore(el.firstChild as any, el as any);
        }
        if ('remove' in el && typeof el.remove === 'function') {
          el.remove();
        } else if (el.parentNode) {
          el.parentNode.removeChild(el as any);
        }
        continue;
      }

      // Allowed tag: sanitize attributes
      const attrNames = Array.from(el.attributes).map((a) => a.name);
      for (const attrName of attrNames) {
        const lowerAttr = attrName.toLowerCase();
        if (lowerAttr.startsWith('on')) {
          el.removeAttribute(attrName);
        } else if (lowerAttr === 'class') {
          const rawClasses = el.className || el.getAttribute('class') || '';
          const validClasses = rawClasses.split(/\s+/).filter((c) => ALLOWED_CLASSES.has(c));
          if (validClasses.length > 0) {
            el.className = validClasses.join(' ');
          } else {
            el.removeAttribute('class');
          }
        } else if (lowerAttr === 'style') {
          const style = el.style;
          const safeProps: Array<{ prop: string; val: string }> = [];

          for (const prop of ALLOWED_STYLE_PROPERTIES) {
            const rawVal = style.getPropertyValue(prop);
            if (rawVal && isSafeCssValue(rawVal)) {
              safeProps.push({ prop, val: rawVal });
            }
          }

          el.removeAttribute('style');
          if ('clear' in style && typeof (style as any).clear === 'function') {
            (style as any).clear();
          }
          for (const { prop, val } of safeProps) {
            style.setProperty(prop, val);
          }
          if (safeProps.length > 0) {
            if ('toString' in style) {
              el.setAttribute('style', style.toString());
            }
          } else {
            el.removeAttribute('style');
          }
        } else if (tagName === 'FONT' && (lowerAttr === 'color' || lowerAttr === 'face' || lowerAttr === 'size')) {
          const rawVal = el.getAttribute(attrName) || '';
          if (lowerAttr === 'color' && isSafeCssValue(rawVal)) {
            el.setAttribute(attrName, rawVal);
          } else if (lowerAttr === 'size' && /^\d+$/.test(rawVal)) {
            el.setAttribute(attrName, rawVal);
          } else if (lowerAttr === 'face' && isSafeCssValue(rawVal)) {
            el.setAttribute(attrName, rawVal);
          } else {
            el.removeAttribute(attrName);
          }
        } else {
          el.removeAttribute(attrName);
        }
      }

      // Recursively clean children
      cleanDomNode(el);
    }
  }
}

/**
 * Sanitizes rich-text songwriting lyrics HTML using robust DOM-based allowlist filtering.
 * Preserves safe text formatting, song section tags, inline styles, and line breaks,
 * while preventing attribute breakout and executable markup.
 */
export function sanitizeLyricsHtml(html: string): string {
  if (!html) return '';

  if (typeof DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(String(html), 'text/html');
      if (doc && doc.body) {
        cleanDomNode(doc.body);
        return doc.body.innerHTML;
      }
    } catch {
      // Fall through to mini-DOM
    }
  }

  const root = parseHtmlToMiniDom(String(html));
  cleanDomNode(root);
  return root.innerHTML;
}

/**
 * Safely resolves a Song Structure section card element from a section ID without CSS selector interpolation.
 */
export function findSectionCard(sectionId: string, root?: ParentNode): HTMLElement | null {
  if (!sectionId || typeof sectionId !== 'string') return null;
  const targetRoot = root ?? (typeof document !== 'undefined' ? document : null);
  if (!targetRoot || typeof targetRoot.querySelectorAll !== 'function') return null;
  const cards = targetRoot.querySelectorAll<HTMLElement>('.structure-section-card, .drawer-section-card');
  for (const card of cards) {
    if (card.dataset?.sectionId === sectionId || card.getAttribute?.('data-section-id') === sectionId) {
      return card;
    }
  }
  return null;
}

/**
 * Safely resolves all timeline block elements matching a section ID without CSS selector interpolation.
 */
export function findTimelineBlocks(sectionId: string, root?: ParentNode): HTMLElement[] {
  if (!sectionId || typeof sectionId !== 'string') return [];
  const targetRoot = root ?? (typeof document !== 'undefined' ? document : null);
  if (!targetRoot || typeof targetRoot.querySelectorAll !== 'function') return [];
  const matches: HTMLElement[] = [];
  const blocks = targetRoot.querySelectorAll<HTMLElement>('.timeline-block');
  for (const block of blocks) {
    if (block.dataset?.sectionId === sectionId || block.getAttribute?.('data-section-id') === sectionId) {
      matches.push(block);
    }
  }
  return matches;
}

/**
 * Safely resolves the first timeline block element matching a section ID without CSS selector interpolation.
 */
export function findTimelineBlock(sectionId: string, root?: ParentNode): HTMLElement | null {
  if (!sectionId || typeof sectionId !== 'string') return null;
  const targetRoot = root ?? (typeof document !== 'undefined' ? document : null);
  if (!targetRoot || typeof targetRoot.querySelectorAll !== 'function') return null;
  const blocks = targetRoot.querySelectorAll<HTMLElement>('.timeline-block');
  for (const block of blocks) {
    if (block.dataset?.sectionId === sectionId || block.getAttribute?.('data-section-id') === sectionId) {
      return block;
    }
  }
  return null;
}
