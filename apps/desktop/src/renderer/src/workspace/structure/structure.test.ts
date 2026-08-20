import { describe, it, expect } from 'vitest';
import type { SongSectionItem, SongSectionType } from '@jameet/shared';

const SECTION_TYPE_LABELS: Record<string, string> = {
  'intro': 'Intro',
  'verse': 'Verse',
  'pre-chorus': 'Pre-Chorus',
  'chorus': 'Chorus',
  'post-chorus': 'Post-Chorus',
  'hook': 'Hook',
  'bridge': 'Bridge',
  'breakdown': 'Breakdown',
  'solo': 'Solo',
  'outro': 'Outro',
  'custom': 'Custom'
};

const SECTION_TYPE_DEFAULT_BARS: Record<string, number> = {
  'intro': 8,
  'verse': 16,
  'pre-chorus': 8,
  'chorus': 16,
  'post-chorus': 8,
  'hook': 8,
  'bridge': 8,
  'breakdown': 8,
  'solo': 8,
  'outro': 8,
  'custom': 8
};

function createSection(sections: SongSectionItem[], type: SongSectionType): SongSectionItem {
  const sameTypeCount = sections.filter((s) => s.type === type).length;
  const baseLabel = SECTION_TYPE_LABELS[type] || 'Section';
  const name = sameTypeCount === 0 && (type === 'intro' || type === 'bridge' || type === 'outro' || type === 'hook')
    ? baseLabel
    : `${baseLabel} ${sameTypeCount + 1}`;
  const bars = SECTION_TYPE_DEFAULT_BARS[type] || 8;
  const newId = `sec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  return {
    id: newId,
    type,
    name,
    bars,
    note: '',
    updatedAt: Date.now()
  };
}

function calculateStructureMetrics(sections: SongSectionItem[]): { totalSections: number; totalBars: number } {
  return {
    totalSections: sections.length,
    totalBars: sections.reduce((sum, s) => sum + (Number(s.bars) || 0), 0)
  };
}

function reorderSection(sections: SongSectionItem[], id: string, direction: 'up' | 'down'): SongSectionItem[] {
  const next = [...sections];
  const idx = next.findIndex((s) => s.id === id);
  if (idx === -1) return next;
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= next.length) return next;
  const [moved] = next.splice(idx, 1);
  if (moved) next.splice(targetIdx, 0, moved);
  return next;
}

function reorderSectionToPosition(
  sections: SongSectionItem[],
  sourceId: string,
  targetId: string,
  position: 'before' | 'after'
): SongSectionItem[] {
  const next = [...sections];
  const sourceIdx = next.findIndex((s) => s.id === sourceId);
  const targetIdx = next.findIndex((s) => s.id === targetId);
  if (sourceIdx === -1 || targetIdx === -1 || sourceIdx === targetIdx) return next;

  const [moved] = next.splice(sourceIdx, 1);
  if (!moved) return next;
  const newTargetIdx = next.findIndex((s) => s.id === targetId);
  const insertIndex = position === 'before' ? newTargetIdx : newTargetIdx + 1;
  next.splice(insertIndex, 0, moved);
  return next;
}

function duplicateSection(sections: SongSectionItem[], id: string): SongSectionItem[] {
  const next = [...sections];
  const idx = next.findIndex((s) => s.id === id);
  if (idx === -1) return next;
  const source = next[idx];
  if (!source) return next;
  const copy: SongSectionItem = {
    id: `sec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type: source.type,
    name: `${source.name} (Copy)`,
    bars: source.bars,
    note: source.note || '',
    updatedAt: Date.now()
  };
  next.splice(idx + 1, 0, copy);
  return next;
}

describe('Song Structure Workspace Logic', () => {
  it('creates sections with appropriate default names and default bars', () => {
    let sections: SongSectionItem[] = [];

    const intro = createSection(sections, 'intro');
    sections.push(intro);
    expect(intro.name).toBe('Intro');
    expect(intro.bars).toBe(8);

    const verse1 = createSection(sections, 'verse');
    sections.push(verse1);
    expect(verse1.name).toBe('Verse 1');
    expect(verse1.bars).toBe(16);

    const verse2 = createSection(sections, 'verse');
    sections.push(verse2);
    expect(verse2.name).toBe('Verse 2');
    expect(verse2.bars).toBe(16);

    const chorus = createSection(sections, 'chorus');
    sections.push(chorus);
    expect(chorus.name).toBe('Chorus 1');
    expect(chorus.bars).toBe(16);

    const bridge = createSection(sections, 'bridge');
    sections.push(bridge);
    expect(bridge.name).toBe('Bridge');
    expect(bridge.bars).toBe(8);

    const outro = createSection(sections, 'outro');
    sections.push(outro);
    expect(outro.name).toBe('Outro');
    expect(outro.bars).toBe(8);

    const metrics = calculateStructureMetrics(sections);
    expect(metrics.totalSections).toBe(6);
    expect(metrics.totalBars).toBe(8 + 16 + 16 + 16 + 8 + 8); // 72 bars
  });

  it('accurately reorders arrangement sections with up and down actions', () => {
    let sections: SongSectionItem[] = [
      { id: 's1', type: 'intro', name: 'Intro', bars: 8, updatedAt: 0 },
      { id: 's2', type: 'verse', name: 'Verse 1', bars: 16, updatedAt: 0 },
      { id: 's3', type: 'chorus', name: 'Chorus 1', bars: 16, updatedAt: 0 }
    ];

    // Move chorus up
    sections = reorderSection(sections, 's3', 'up');
    expect(sections.map((s) => s.id)).toEqual(['s1', 's3', 's2']);

    // Move intro down
    sections = reorderSection(sections, 's1', 'down');
    expect(sections.map((s) => s.id)).toEqual(['s3', 's1', 's2']);

    // Boundary conditions
    sections = reorderSection(sections, 's3', 'up'); // cannot move above 0
    expect(sections.map((s) => s.id)).toEqual(['s3', 's1', 's2']);
  });

  it('supports natural drag and drop position reordering (insert before or after target)', () => {
    const original: SongSectionItem[] = [
      { id: 's1', type: 'intro', name: 'Intro', bars: 8, updatedAt: 0 },
      { id: 's2', type: 'verse', name: 'Verse 1', bars: 16, updatedAt: 0 },
      { id: 's3', type: 'chorus', name: 'Chorus 1', bars: 16, updatedAt: 0 },
      { id: 's4', type: 'bridge', name: 'Bridge', bars: 8, updatedAt: 0 },
      { id: 's5', type: 'outro', name: 'Outro', bars: 8, updatedAt: 0 }
    ];

    // 1. Drag Outro ('s5') and drop BEFORE Verse 1 ('s2')
    const reordered1 = reorderSectionToPosition(original, 's5', 's2', 'before');
    expect(reordered1.map((s) => s.id)).toEqual(['s1', 's5', 's2', 's3', 's4']);

    // 2. Drag Intro ('s1') and drop AFTER Chorus 1 ('s3')
    const reordered2 = reorderSectionToPosition(original, 's1', 's3', 'after');
    expect(reordered2.map((s) => s.id)).toEqual(['s2', 's3', 's1', 's4', 's5']);

    // 3. Drag Verse 1 ('s2') and drop AFTER Outro ('s5')
    const reordered3 = reorderSectionToPosition(original, 's2', 's5', 'after');
    expect(reordered3.map((s) => s.id)).toEqual(['s1', 's3', 's4', 's5', 's2']);
  });

  it('supports common bar presets (1, 2, 4, 8, 12, 16, 24, 32) and custom bar counts', () => {
    const COMMON_BAR_PRESETS = [1, 2, 4, 8, 12, 16, 24, 32];
    let sections: SongSectionItem[] = [
      { id: 's1', type: 'intro', name: 'Intro', bars: 4, updatedAt: 0 },
      { id: 's2', type: 'verse', name: 'Verse 1', bars: 16, updatedAt: 0 },
      { id: 's3', type: 'chorus', name: 'Chorus 1', bars: 24, updatedAt: 0 },
      { id: 's4', type: 'solo', name: 'Guitar Solo', bars: 32, updatedAt: 0 },
      { id: 's5', type: 'outro', name: 'Outro', bars: 12, updatedAt: 0 }
    ];

    expect(COMMON_BAR_PRESETS.includes(sections[0]!.bars!)).toBe(true);
    expect(COMMON_BAR_PRESETS.includes(sections[1]!.bars!)).toBe(true);
    expect(COMMON_BAR_PRESETS.includes(sections[2]!.bars!)).toBe(true);
    expect(COMMON_BAR_PRESETS.includes(sections[3]!.bars!)).toBe(true);
    expect(COMMON_BAR_PRESETS.includes(sections[4]!.bars!)).toBe(true);

    let metrics = calculateStructureMetrics(sections);
    expect(metrics.totalBars).toBe(4 + 16 + 24 + 32 + 12); // 88 bars

    // Custom bar length test (e.g. 6 or 10 bars)
    sections[1]!.bars = 10;
    expect(COMMON_BAR_PRESETS.includes(sections[1]!.bars!)).toBe(false);

    metrics = calculateStructureMetrics(sections);
    expect(metrics.totalBars).toBe(4 + 10 + 24 + 32 + 12); // 82 bars
  });
});

