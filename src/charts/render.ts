import { createCanvas, loadImage, registerFont, type Image } from 'canvas';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const FONT_PATH = join(process.cwd(), 'NotoSansCJKjp-Regular.otf');
const NO_ALBUM_PATH = join(process.cwd(), 'images', 'no_album.png');

let fontRegistered = false;
function ensureFont(): void {
  if (!fontRegistered && existsSync(FONT_PATH)) {
    registerFont(FONT_PATH, { family: 'noto-sans' });
    fontRegistered = true;
  }
}

export interface ChartEntry {
  /** `Artist - Album` */
  name: string;
  imageUrl: string;
  periodPlays: number;
  /** share of the period's total scrobbles, already rounded (e.g. 3.42) */
  pct: number;
  /** all-time plays of this album; null when the lookup failed */
  totalPlays: number | null;
  /** first plays this period (period count == all-time count) */
  isNew: boolean;
  /** chart owner holds this album's crown */
  crowned: boolean;
}

export interface ChartStats {
  newAlbums: number;
  crowns: number;
  missingCovers: number;
}

async function loadTile(url: string): Promise<{ img: Image; missing: boolean }> {
  if (url) {
    try {
      return { img: await loadImage(url), missing: false };
    } catch {
      // fall through to placeholder
    }
  }
  return { img: await loadImage(NO_ALBUM_PATH), missing: true };
}

/**
 * Renders the legacy chart layout: x*y grid of 100px covers on black, with the
 * 12px color-coded text column on the right (white base name drawn 4x for faux
 * bold, cyan stats, magenta totals, green !! NEW !!, yellow ♛ crown marks).
 */
export async function renderChart(
  entries: ChartEntry[],
  x: number,
  y: number,
): Promise<{ buffer: Buffer; stats: ChartStats }> {
  ensureFont();

  const tiles = await Promise.all(entries.map((e) => loadTile(e.imageUrl)));
  const missingCovers = tiles.filter((t) => t.missing).length;

  const grid = createCanvas(x * 100, y * 100);
  const gctx = grid.getContext('2d');
  let iter = 0;
  for (let yAxis = 0; yAxis < y * 100 && iter < tiles.length; yAxis += 100) {
    for (let xAxis = 0; xAxis < x * 100 && iter < tiles.length; xAxis += 100) {
      gctx.drawImage(tiles[iter]!.img, xAxis, yAxis, 100, 100);
      iter++;
    }
  }

  const measure = createCanvas(10, 10).getContext('2d');
  measure.font = '12px noto-sans';
  const longestNum = entries.reduce((max, e) => Math.max(max, e.name.length), 0);
  const longestName =
    'X'.repeat(15 + longestNum) + ' [88888 scrobbles - 100.00%] [8888 total scrobbles]';
  const { width } = measure.measureText(longestName);

  const canvasWidth = x * 100 + 120 + width;
  const finalCanvas = createCanvas(canvasWidth, y * 100);
  const ctx = finalCanvas.getContext('2d');
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
  ctx.drawImage(grid, 0, 0);
  ctx.font = '12px noto-sans';

  const textX = x * 100 + 15;
  const boldText = (text: string, yPos: number, style: string, times = 4) => {
    ctx.fillStyle = style;
    for (let i = 0; i < times; i++) ctx.fillText(text, textX, yPos);
  };

  let newAlbums = 0;
  let crowns = 0;
  let i = 0;
  for (let byChart = 0; byChart < 100 * y; byChart += 100) {
    for (let inChart = 15; inChart <= 15 * x; inChart += 15) {
      const yPos = byChart + inChart;
      const entry = entries[i];
      if (entry) {
        const scrobs = `[${entry.periodPlays} scrobbles - `;
        const base = `${entry.name} ${scrobs}${entry.pct}%]`;
        if (entry.isNew) {
          newAlbums++;
          if (entry.crowned) {
            crowns++;
            boldText(`${base} !! NEW !! ♛`, yPos, '#ffff00', 1);
          }
          boldText(`${base} !! NEW !!`, yPos, '#32cd32');
          boldText(base, yPos, '#16E6FF');
        } else {
          const withTotal = `${base} [${entry.totalPlays ?? 0} total scrobbles]`;
          if (entry.crowned) {
            crowns++;
            boldText(`${withTotal} ♛`, yPos, '#ffff00', 1);
          }
          boldText(withTotal, yPos, '#ff00c0');
          boldText(base, yPos, '#16E6FF');
        }
        boldText(entry.name, yPos, 'white');
      }
      i++;
    }
  }

  return { buffer: finalCanvas.toBuffer(), stats: { newAlbums, crowns, missingCovers } };
}

/** The legacy ★ stats block that becomes the embed description. */
export function chartStatsText(
  sum: number,
  total: number,
  chartPerDay: number,
  periodPerDay: number,
  newAlbums: number,
  crowns: number,
): string {
  const coverage = parseFloat(((sum / total) * 100).toFixed(2));
  return (
    `★ ${sum} / ${total} scrobbles ★\n` +
    `★ ${chartPerDay} / ${periodPerDay} scrobbles per day ★\n` +
    `★ ${coverage}% chart coverage ★\n` +
    `★ ${newAlbums} ${newAlbums === 1 ? 'new album' : 'new albums'} ★\n` +
    `★ ${crowns} ${crowns === 1 ? 'crown' : 'crowns'} ★`
  );
}
