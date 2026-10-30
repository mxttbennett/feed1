import { EmbedBuilder } from 'discord.js';
import type { TopArtist } from '../lastfm/types.js';
import { toInt } from '../lastfm/types.js';

export const ARTISTS_COMPARED = 200;

export interface TasteProfile {
  tag: string;
  artists: Map<string, { name: string; weight: number }>;
}

export interface MatchResult {
  tag: string;
  score: number;
  shared: string[];
}

/** sqrt damps a few thousand-play favourites so breadth of taste counts, not just the top artist */
export function buildProfile(tag: string, top: TopArtist[]): TasteProfile {
  const artists = new Map<string, { name: string; weight: number }>();
  for (const artist of top) {
    const plays = toInt(artist.playcount);
    if (plays > 0)
      artists.set(artist.name.toLowerCase(), { name: artist.name, weight: Math.sqrt(plays) });
  }
  return { tag, artists };
}

const norm = (p: TasteProfile) =>
  Math.sqrt([...p.artists.values()].reduce((sum, a) => sum + a.weight ** 2, 0));

/** Cosine similarity of the two weighted artist vectors, as a 0-100 percentage. */
export function compare(me: TasteProfile, other: TasteProfile): MatchResult {
  let dot = 0;
  const shared: { name: string; strength: number }[] = [];
  for (const [key, mine] of me.artists) {
    const theirs = other.artists.get(key);
    if (!theirs) continue;
    dot += mine.weight * theirs.weight;
    shared.push({ name: mine.name, strength: Math.min(mine.weight, theirs.weight) });
  }
  const denominator = norm(me) * norm(other);
  const score = denominator === 0 ? 0 : (dot / denominator) * 100;
  shared.sort((a, b) => b.strength - a.strength);
  return { tag: other.tag, score, shared: shared.map((s) => s.name) };
}

const pct = (score: number) => `${parseFloat(score.toFixed(1))}%`;

export function buildMatchEmbed(
  myTag: string,
  matches: MatchResult[],
  skipped: number,
): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(`${myTag}'s taste matches`);
  if (matches.length === 0) {
    return embed.setDescription(
      'nobody else in this server has enough listening history to compare.',
    );
  }
  const ranked = [...matches].sort((a, b) => b.score - a.score);
  const lines = ranked
    .slice(0, 10)
    .map((m, i) => `${i + 1}. ${m.tag.replace(/#0$/, '')} → **${pct(m.score)}**`);
  embed.setDescription(lines.join('\n'));

  const best = ranked[0]!;
  embed.addFields({
    name: `closest match: ${best.tag.replace(/#0$/, '')}`,
    value: best.shared.length > 0 ? best.shared.slice(0, 8).join(', ') : 'no artists in common',
  });
  if (ranked.length > 1) {
    const worst = ranked[ranked.length - 1]!;
    embed.addFields({
      name: 'furthest apart',
      value: `${worst.tag.replace(/#0$/, '')} → ${pct(worst.score)}`,
    });
  }
  embed.setFooter({
    text:
      `compared on top ${ARTISTS_COMPARED} artists, all time` +
      (skipped > 0 ? ` | ${skipped} skipped (private or empty)` : ''),
  });
  return embed;
}
