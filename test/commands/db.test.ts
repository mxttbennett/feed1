import { beforeEach, describe, expect, it } from 'vitest';
import type { EmbedBuilder } from 'discord.js';
import { dbCommands } from '../../src/commands/db.js';
import { ROWS_PER_PAGE } from '../../src/commands/dbFormat.js';
import { users } from '../../src/db/schema.js';
import { makeFakeApp, makeFakeMessage, type FakeApp } from '../helpers/fake.js';

const db = dbCommands.find((c) => c.name === 'db')!;

let app: FakeApp;

function seedUsers(count: number): void {
  for (let i = 1; i <= count; i++) {
    app.db
      .insert(users)
      .values({
        discordUserId: `user-${i}`,
        lastfmUsername: `listener${i}`,
        commandCount: i,
      })
      .run();
  }
}

const lastEmbed = (fake: { embeds: unknown[] }) => fake.embeds.at(-1) as EmbedBuilder;

beforeEach(() => {
  app = makeFakeApp();
});

describe('&db', () => {
  it('is owner-only and hidden from help', () => {
    expect(db.ownerOnly).toBe(true);
    expect(db.hidden).toBe(true);
    expect(db.guildOnly).toBe(false);
  });

  it('opens on the first table alphabetically', async () => {
    const fake = makeFakeMessage({ content: '&db' });
    await db.run({ app, message: fake.message, args: [] });
    expect(lastEmbed(fake).data.title).toBe('Database · album_crowns');
  });

  it('opens on a named table', async () => {
    seedUsers(2);
    const fake = makeFakeMessage({ content: '&db users' });
    await db.run({ app, message: fake.message, args: ['users'] });

    const embed = lastEmbed(fake);
    expect(embed.data.title).toBe('Database · users');
    expect(embed.data.description).toBe('2 rows · sorted by `id` ▲');
    expect(embed.data.fields?.[0]?.value).toContain('listener1');
  });

  it('lists the valid tables when the argument is not one', async () => {
    const fake = makeFakeMessage({ content: '&db nope' });
    await db.run({ app, message: fake.message, args: ['nope'] });
    expect(fake.replies[0]).toContain(`\`nope\` isn't a table`);
    expect(fake.replies[0]).toContain('`users`');
  });

  it('renders an empty table without fields', async () => {
    const fake = makeFakeMessage({ content: '&db users' });
    await db.run({ app, message: fake.message, args: ['users'] });

    const embed = lastEmbed(fake);
    expect(embed.data.description).toBe('no rows');
    expect(embed.data.fields).toBeUndefined();
    expect(embed.data.footer?.text).toBe('page 1/1');
  });

  it('pages forward and clamps at the first page', async () => {
    seedUsers(ROWS_PER_PAGE + 2);
    const fake = makeFakeMessage({ content: '&db users' });
    await db.run({ app, message: fake.message, args: ['users'] });

    await fake.click('next');
    expect(lastEmbed(fake).data.footer?.text).toBe('page 2/2');
    expect(lastEmbed(fake).data.fields).toHaveLength(2);

    await fake.click('prev');
    await fake.click('prev');
    expect(lastEmbed(fake).data.footer?.text).toBe('page 1/2');
  });

  it('switches table and resets sort and page', async () => {
    seedUsers(ROWS_PER_PAGE + 1);
    const fake = makeFakeMessage({ content: '&db users' });
    await db.run({ app, message: fake.message, args: ['users'] });

    await fake.select('sort', ['command_count']);
    await fake.click('next');
    expect(lastEmbed(fake).data.footer?.text).toBe('page 2/2');

    await fake.select('table', ['crown_jobs']);
    const embed = lastEmbed(fake);
    expect(embed.data.title).toBe('Database · crown_jobs');
    expect(embed.data.description).toBe('no rows');
    expect(embed.data.footer?.text).toBe('page 1/1');
  });

  it('re-sorts and flips direction', async () => {
    seedUsers(3);
    const fake = makeFakeMessage({ content: '&db users' });
    await db.run({ app, message: fake.message, args: ['users'] });

    await fake.select('sort', ['command_count']);
    expect(lastEmbed(fake).data.description).toBe('3 rows · sorted by `command_count` ▲');
    expect(lastEmbed(fake).data.fields?.[0]?.value).toContain('listener1');

    await fake.click('dir');
    expect(lastEmbed(fake).data.description).toBe('3 rows · sorted by `command_count` ▼');
    expect(lastEmbed(fake).data.fields?.[0]?.value).toContain('listener3');
  });

  it('ignores a column that does not belong to the current table', async () => {
    seedUsers(1);
    const fake = makeFakeMessage({ content: '&db users' });
    await db.run({ app, message: fake.message, args: ['users'] });

    await fake.select('sort', ['artist_name']);
    expect(lastEmbed(fake).data.description).toBe('1 row · sorted by `id` ▲');
  });

  it('ignores interactions from anyone but the invoker', async () => {
    seedUsers(ROWS_PER_PAGE + 1);
    const fake = makeFakeMessage({ content: '&db users', authorId: 'owner-1' });
    await db.run({ app, message: fake.message, args: ['users'] });
    const before = fake.embeds.length;

    await fake.click('next', 'someone-else');
    expect(fake.embeds).toHaveLength(before);
  });

  it('strips its components when the collector expires', async () => {
    const fake = makeFakeMessage({ content: '&db users' });
    await db.run({ app, message: fake.message, args: ['users'] });

    fake.expire();
    expect(fake.edits).toEqual([{ components: [] }]);
  });
});
