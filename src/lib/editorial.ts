import type { EditorialPiece, SplatEntry } from '../types/manifest';

const DEFAULT_SEASON = 'Autumn / Winter 2026';
const STYLE_TITLES = { suit: 'The Suit', dress: 'The Dress', casual: 'Off Duty' } as const;

/** Everything the cover view (EditorialView) prints for one model in one
 *  of its looks. */
export interface EditorialPage {
  /** Word set behind the figure. */
  masthead: string;
  season: string;
  /** Look number, and how many looks the model has. */
  look: number;
  of: number;
  title: string;
  standfirst: string;
  /** What is worn, most important first (may be empty). */
  pieces: EditorialPiece[];
}

/**
 * The cover copy for a model. Every model opens on the cover; what it says
 * comes from, in order: the look on show (a lookbook capture names itself),
 * the model's own `meta.editorial`, and defaults drawn from its card.
 */
export function editorialPage(entry: SplatEntry, lookIndex = 0): EditorialPage | null {
  const meta = entry.meta;
  if (!meta) return null;
  const ed = meta.editorial ?? {};
  const looks = entry.looks && entry.looks.length > 1 ? entry.looks : undefined;
  const look = looks?.[Math.min(lookIndex, looks.length - 1)];
  return {
    masthead: ed.masthead ?? meta.name.split(/[\s—-]+/)[0],
    season: ed.season ?? DEFAULT_SEASON,
    look: look ? looks!.indexOf(look) + 1 : (ed.look ?? 1),
    of: looks?.length ?? 1,
    title:
      look?.name ??
      ed.title ??
      (meta.source === 'capture' ? 'As Captured' : STYLE_TITLES[meta.look.style]),
    standfirst: look?.standfirst ?? look?.note ?? ed.standfirst ?? meta.bio,
    pieces: look?.pieces ?? ed.pieces ?? [],
  };
}
