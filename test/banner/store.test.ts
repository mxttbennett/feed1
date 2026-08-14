import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BannerImageStore } from '../../src/banner/store.js';
import { inspectImage } from '../../src/banner/image.js';
import { createDb, runMigrations, schema } from '../../src/db/index.js';

function png(marker: number): Uint8Array {
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    0,
    0,
    0,
    13,
    73,
    72,
    68,
    82,
    0,
    0,
    0x07,
    0x80,
    0,
    0,
    0x04,
    0x38,
    marker,
  ]);
}

function makeStore() {
  const db = createDb(':memory:');
  runMigrations(db);
  const dir = mkdtempSync(join(tmpdir(), 'feed1-store-'));
  return { db, dir, store: new BannerImageStore(db, dir) };
}

const meta = { addedBy: 'u1', sourceUrl: 'https://example.com/a.png' };

describe('BannerImageStore', () => {
  it('writes the file and the row, and reads the bytes back', () => {
    const { store, dir } = makeStore();
    const bytes = png(1);

    const { image, added } = store.add('g1', inspectImage(bytes), meta);

    expect(added).toBe(true);
    expect(image).toMatchObject({
      guildId: 'g1',
      contentType: 'image/png',
      width: 1920,
      height: 1080,
    });
    expect(readdirSync(join(dir, 'g1'))).toHaveLength(1);
    // readFileSync hands back a Buffer, so compare contents rather than the exact class
    expect(Uint8Array.from(store.read(image)!)).toEqual(bytes);
  });

  it('dedupes identical bytes instead of storing them twice', () => {
    const { store, dir } = makeStore();
    const bytes = png(1);

    const first = store.add('g1', inspectImage(bytes), meta);
    const second = store.add('g1', inspectImage(bytes), meta);

    expect(second.added).toBe(false);
    expect(second.image.id).toBe(first.image.id);
    expect(store.count('g1')).toBe(1);
    expect(readdirSync(join(dir, 'g1'))).toHaveLength(1);
  });

  it('keeps guilds separate', () => {
    const { store } = makeStore();
    store.add('g1', inspectImage(png(1)), meta);
    store.add('g2', inspectImage(png(1)), meta);

    expect(store.count('g1')).toBe(1);
    expect(store.count('g2')).toBe(1);
    expect(store.list('g1')[0]!.id).not.toBe(store.list('g2')[0]!.id);
  });

  it('removes the row and its file', () => {
    const { store, dir } = makeStore();
    const { image } = store.add('g1', inspectImage(png(1)), meta);

    expect(store.remove('g1', image.id)).toMatchObject({ id: image.id });

    expect(store.count('g1')).toBe(0);
    expect(readdirSync(join(dir, 'g1'))).toHaveLength(0);
    expect(store.remove('g1', image.id)).toBeUndefined();
  });

  it('will not remove another guild’s image', () => {
    const { store } = makeStore();
    const { image } = store.add('g1', inspectImage(png(1)), meta);

    expect(store.remove('g2', image.id)).toBeUndefined();
    expect(store.count('g1')).toBe(1);
  });

  it('clears everything for one guild', () => {
    const { store } = makeStore();
    store.add('g1', inspectImage(png(1)), meta);
    store.add('g1', inspectImage(png(2)), meta);
    store.add('g2', inspectImage(png(3)), meta);

    expect(store.removeAll('g1')).toBe(2);
    expect(store.count('g1')).toBe(0);
    expect(store.count('g2')).toBe(1);
  });

  it('keeps accepting images past the old 100-image ceiling', () => {
    const { store } = makeStore();
    for (let i = 0; i < 120; i++) {
      store.add('g1', inspectImage(png(i)), meta);
    }
    expect(store.count('g1')).toBe(120);
  });

  // the file can vanish under us (disk wipe, manual cleanup); the row must not crash a rotation
  it('returns undefined when the row outlives its file', () => {
    const { store, dir } = makeStore();
    const { image } = store.add('g1', inspectImage(png(1)), meta);
    rmSync(join(dir, 'g1'), { recursive: true, force: true });

    expect(store.read(image)).toBeUndefined();
    expect(store.get('g1', image.id)).toBeDefined();
  });

  it('records animated gifs as animated', () => {
    const { store } = makeStore();
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x80, 0x07, 0x38, 0x04]);

    const { image } = store.add('g1', inspectImage(gif), meta);

    expect(image).toMatchObject({ animated: true, contentType: 'image/gif', width: 1920 });
  });

  it('enforces one row per guild+hash at the schema level', () => {
    const { db, dir } = makeStore();
    const row = {
      guildId: 'g1',
      sha256: 'abc',
      contentType: 'image/png',
      bytes: 1,
      addedBy: 'u1',
    };
    db.insert(schema.bannerImages).values(row).run();
    expect(() => db.insert(schema.bannerImages).values(row).run()).toThrow(/UNIQUE/);
    expect(existsSync(dir)).toBe(true);
  });
});
