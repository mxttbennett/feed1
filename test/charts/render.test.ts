import { describe, expect, it } from 'vitest';
import { renderChart, type ChartEntry } from '../../src/charts/render.js';

function pngHeight(buffer: Buffer): number {
  return buffer.readUInt32BE(20);
}

function entries(count: number): ChartEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `Artist ${i} - Album ${i}`,
    imageUrl: '',
    periodPlays: 10,
    pct: 1,
    totalPlays: 20,
    isNew: false,
    crowned: false,
  }));
}

describe('renderChart canvas height', () => {
  it('fills the requested grid height when every slot has an entry', async () => {
    const { buffer } = await renderChart(entries(25), 5, 5);
    expect(pngHeight(buffer)).toBe(500);
  });

  it('crops the trailing black rows when last.fm returns a short chart', async () => {
    const { buffer } = await renderChart(entries(19), 5, 6);
    expect(pngHeight(buffer)).toBe(400);
  });

  it('keeps a partly filled final row at full tile height', async () => {
    const { buffer } = await renderChart(entries(11), 5, 5);
    expect(pngHeight(buffer)).toBe(300);
  });

  it('never crops below the text column when it overruns its tile row', async () => {
    const { buffer } = await renderChart(entries(8), 8, 4);
    expect(pngHeight(buffer)).toBe(124);
  });
});
