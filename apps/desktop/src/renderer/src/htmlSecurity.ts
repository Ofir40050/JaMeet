/**
 * Safe HTML escaping and rich-text songwriting sanitization helpers.
 */

const ALLOWED_TAGS = new Set([
  'b', 'strong', 'i', 'em', 'u', 'strike', 's', 'del',
  'p', 'div', 'span',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'br', 'font', 'hr', 'blockquote'
]);

const ALLOWED_CLASSES = new Set([
  'song-section-tag',
  'doc-page-break-gap'
]);

const ALLOWED_STYLE_PROPERTIES = new Set([
  'color', 'background-color', 'font-family', 'font-size',
  'text-align', 'line-height', 'font-weight', 'font-style',
  'text-decoration', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right'
]);

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
 * Sanitizes rich-text songwriting lyrics HTML.
 * Preserves safe text formatting, song section tags, inline styles, and line breaks,
 * while removing scripts, iframes, objects, event handlers, and dangerous URL schemes.
 */
export function sanitizeLyricsHtml(html: string): string {
  if (!html) return '';

  let sanitized = String(html);

  // 1. Remove dangerous blocks and their content completely
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  sanitized = sanitized.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  sanitized = sanitized.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
  sanitized = sanitized.replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '');
  sanitized = sanitized.replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, '');
  sanitized = sanitized.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '');
  sanitized = sanitized.replace(/<math\b[^<]*(?:(?!<\/math>)<[^<]*)*<\/math>/gi, '');
  sanitized = sanitized.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '');

  // 2. Filter HTML tags & attributes
  sanitized = sanitized.replace(/<(\/)?([a-zA-Z0-9_\-]+)([^>]*)>/g, (_match, slash, rawTagName, rawAttrs) => {
    const isClosing = Boolean(slash);
    const tagName = String(rawTagName).toLowerCase();

    if (!ALLOWED_TAGS.has(tagName)) {
      return '';
    }

    if (isClosing) {
      return `</${tagName}>`;
    }

    // Parse attributes
    const cleanAttrs: string[] = [];
    const attrRegex = /([a-zA-Z0-9_\-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let attrMatch: RegExpExecArray | null;

    while ((attrMatch = attrRegex.exec(rawAttrs)) !== null) {
      const attrName = attrMatch[1].toLowerCase();
      const attrVal = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? '';

      // Disallow all inline event handlers (on*)
      if (attrName.startsWith('on')) {
        continue;
      }

      if (attrName === 'class') {
        const classes = attrVal.split(/\s+/).filter((c) => ALLOWED_CLASSES.has(c));
        if (classes.length > 0) {
          cleanAttrs.push(`class="${classes.join(' ')}"`);
        }
      } else if (attrName === 'style') {
        const styleRules = attrVal.split(';');
        const safeRules: string[] = [];
        for (const rule of styleRules) {
          const colonIdx = rule.indexOf(':');
          if (colonIdx === -1) continue;
          const prop = rule.slice(0, colonIdx).trim().toLowerCase();
          const val = rule.slice(colonIdx + 1).trim();
          const valLower = val.toLowerCase();
          if (
            ALLOWED_STYLE_PROPERTIES.has(prop) &&
            !valLower.includes('url(') &&
            !valLower.includes('expression(') &&
            !valLower.includes('javascript:')
          ) {
            safeRules.push(`${prop}: ${val}`);
          }
        }
        if (safeRules.length > 0) {
          cleanAttrs.push(`style="${safeRules.join('; ')}"`);
        }
      } else if (attrName === 'color' || attrName === 'face' || attrName === 'size') {
        const valLower = attrVal.toLowerCase();
        if (!valLower.includes('javascript:') && !valLower.includes('url(')) {
          cleanAttrs.push(`${attrName}="${escapeHtml(attrVal)}"`);
        }
      }
    }

    const attrsStr = cleanAttrs.length > 0 ? ` ${cleanAttrs.join(' ')}` : '';
    return `<${tagName}${attrsStr}>`;
  });

  return sanitized;
}
