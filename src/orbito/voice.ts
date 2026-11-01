import type { Mood } from './brain';

/** The subset of SpeechSynthesisVoice that voice choice depends on. */
export interface VoiceInfo {
  name: string;
  lang: string;
  localService?: boolean;
}

export interface VoicePick<V extends VoiceInfo> {
  voice: V | null;
  /** Base pitch for this voice: lighter adult voices need more lift than a child voice. */
  pitch: number;
  rate: number;
}

/**
 * Orbito should sound small, light and youthful. Browsers expose different
 * voices per OS, so this is a ranked preference list, best first. Each entry
 * carries the pitch lift that voice needs to land in the same register.
 */
const PREFERENCES: { test: RegExp; pitch: number }[] = [
  { test: /\bAna\b.*(Natural|Online)/i, pitch: 1.12 }, // Edge: Microsoft Ana, a child voice
  { test: /(Ava|Emma|Jenny|Aria|Michelle|Sonia|Libby|Maisie).*(Natural|Online)/i, pitch: 1.3 }, // Edge natural, light female
  { test: /Google US English/i, pitch: 1.32 }, // Chrome
  { test: /Google UK English Female/i, pitch: 1.3 },
  { test: /\b(Samantha|Karen|Tessa|Moira|Fiona|Victoria)\b/i, pitch: 1.3 }, // macOS / iOS
  // Windows desktop. Measured through the speakers in Chrome: 185 Hz at 1.0,
  // 225 Hz at 1.7, 243 Hz at 2.0 (local voices respond weakly to pitch).
  { test: /\bZira\b/i, pitch: 1.75 },
  { test: /female/i, pitch: 1.3 },
];

/** Names of voices that read as mature male narrators — avoided unless nothing else exists. */
const MATURE =
  /\b(David|Mark|Guy|Daniel|Alex|Fred|George|James|Ryan|Christopher|Eric|Roger|Steffan|Andrew|Brian|Thomas|Rishi|Aaron|Arthur|Oliver|Male)\b/i;

export function pickVoice<V extends VoiceInfo>(voices: readonly V[]): VoicePick<V> {
  const english = voices.filter((v) => /^en([-_]|$)/i.test(v.lang));
  for (const pref of PREFERENCES) {
    // Prefer en-US/en-GB matches, then any English, of the first matching rank.
    const hit = english.find((v) => pref.test.test(v.name) && !MATURE.test(v.name));
    if (hit) return { voice: hit, pitch: pref.pitch, rate: 1.04 };
  }
  const neutral = english.find((v) => !MATURE.test(v.name));
  if (neutral) return { voice: neutral, pitch: 1.35, rate: 1.04 };
  // Only mature voices available: lift as far as it goes (David measured
  // 96 Hz at 1.0 and 111 Hz at 1.5: still an adult, but the best available).
  return { voice: english[0] ?? null, pitch: 1.9, rate: 1.06 };
}

/** Small per-mood shifts in delivery — a nudge, not a different character. */
export function delivery(mood: Mood): { pitch: number; rate: number } {
  switch (mood) {
    case 'excited':
    case 'celebrating':
      return { pitch: 0.08, rate: 0.07 };
    case 'surprised':
      return { pitch: 0.1, rate: 0.03 };
    case 'sleepy':
      return { pitch: -0.08, rate: -0.15 };
    case 'concerned':
    case 'thinking':
      return { pitch: -0.03, rate: -0.05 };
    default:
      return { pitch: 0, rate: 0 };
  }
}

const MAX_SPOKEN = 230;

/**
 * Turns on-screen text into something that sounds natural aloud: symbols and
 * units become words, and long explanations are cut to their first sentences
 * (the full text stays on screen).
 */
export function spokenForm(text: string): string {
  const said = text
    .replace(/√\(\s*G\s*·?\s*M\s*\/\s*r\s*\)/gi, 'the square root of G M over r')
    .replace(/√\(\s*2\s*G\s*M\s*\/\s*r\s*\)/gi, 'the square root of two G M over r')
    .replace(/√/g, 'root ')
    .replace(/u\/s²/g, ' units per second squared')
    .replace(/u\/s\b/g, ' units per second')
    .replace(/(\d)u\b/g, '$1 units')
    .replace(/(\d)×/g, '$1 times')
    .replace(/×/g, ' times ')
    .replace(/~/g, 'about ')
    .replace(/T\+/g, 'T plus ')
    .replace(/\s[—·]\s/g, ', ')
    .replace(/["“”]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const sentences = said.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [said];
  let out = '';
  for (const s of sentences) {
    if (out && out.length + s.length > MAX_SPOKEN) break;
    out += s;
  }
  return out.trim();
}
