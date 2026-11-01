import { describe, expect, it } from 'vitest';
import { delivery, pickVoice, spokenForm } from './voice';

const v = (name: string, lang = 'en-US') => ({ name, lang });

// Realistic voice lists, in the order browsers return them.
const WINDOWS_CHROME = [
  v('Microsoft David - English (United States)'),
  v('Microsoft Mark - English (United States)'),
  v('Microsoft Zira - English (United States)'),
  v('Google Deutsch', 'de-DE'),
  v('Google US English'),
  v('Google UK English Male', 'en-GB'),
  v('Google UK English Female', 'en-GB'),
];
const WINDOWS_EDGE = [
  v('Microsoft David - English (United States)'),
  v('Microsoft Guy Online (Natural) - English (United States)'),
  v('Microsoft Aria Online (Natural) - English (United States)'),
  v('Microsoft Ana Online (Natural) - English (United States)'),
];

describe('Orbito voice selection', () => {
  it('never takes the first (mature male) voice when better ones exist', () => {
    expect(pickVoice(WINDOWS_CHROME).voice?.name).toBe('Google US English');
  });

  it("prefers Edge's child voice Ana over adult natural voices", () => {
    const pick = pickVoice(WINDOWS_EDGE);
    expect(pick.voice?.name).toMatch(/Ana Online/);
    expect(pick.pitch).toBeLessThan(1.2); // already young: little lift needed
  });

  it('falls back to Zira on a bare Windows install', () => {
    const pick = pickVoice([v('Microsoft David - English (United States)'), v('Microsoft Zira - English (United States)')]);
    expect(pick.voice?.name).toMatch(/Zira/);
  });

  it('uses macOS voices and ignores non-English ones', () => {
    expect(pickVoice([v('Thomas', 'fr-FR'), v('Daniel', 'en-GB'), v('Samantha')]).voice?.name).toBe('Samantha');
  });

  it('lifts pitch when only a mature voice exists, and copes with none', () => {
    const only = pickVoice([v('Microsoft David - English (United States)')]);
    expect(only.voice?.name).toMatch(/David/);
    expect(only.pitch).toBeGreaterThan(1.5);
    expect(pickVoice([]).voice).toBeNull();
  });

  it('keeps every pitch inside the Web Speech range', () => {
    for (const list of [WINDOWS_CHROME, WINDOWS_EDGE, []]) {
      const p = pickVoice(list).pitch;
      for (const mood of ['excited', 'sleepy', 'surprised', 'idle'] as const) {
        expect(p + delivery(mood).pitch).toBeGreaterThan(0);
        expect(p + delivery(mood).pitch).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('spokenForm', () => {
  it('reads symbols and units as words', () => {
    expect(spokenForm('A circular orbit needs v = √(G·M/r).')).toContain('the square root of G M over r');
    expect(spokenForm('That is ~87 u/s at 400u.')).toBe('That is about 87 units per second at 400 units.');
    expect(spokenForm('Force is strength × 1,100.')).toBe('Force is strength times 1,100.');
  });

  it('cuts long explanations to their opening sentences', () => {
    const long = 'First point here. '.repeat(30);
    const said = spokenForm(long);
    expect(said.length).toBeLessThanOrEqual(230);
    expect(said.endsWith('.')).toBe(true);
  });

  it('always says at least the first sentence, even if it is long', () => {
    const one = `${'very '.repeat(60)}long.`;
    expect(spokenForm(one)).toBe(one);
  });
});
