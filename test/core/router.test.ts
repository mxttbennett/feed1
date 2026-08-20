import { describe, expect, it, vi } from 'vitest';
import type { Command } from '../../src/core/command.js';
import { Router } from '../../src/core/router.js';
import { disableCommand } from '../../src/core/disables.js';
import { schema } from '../../src/db/index.js';
import { makeFakeApp, makeFakeMessage } from '../helpers/fake.js';

function testCommand(overrides: Partial<Command> = {}): Command & { calls: number } {
  const cmd = {
    name: 'fm',
    aliases: ['f'],
    description: 'test',
    usage: 'fm',
    calls: 0,
    async run() {
      cmd.calls++;
    },
    ...overrides,
  };
  return cmd;
}

describe('Router', () => {
  it('runs a command by canonical name and by alias', async () => {
    const cmd = testCommand();
    const app = makeFakeApp([cmd]);
    const router = new Router(app);

    await router.handle(makeFakeMessage({ content: '&fm' }).message);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 5000);
    await router.handle(makeFakeMessage({ content: '&f' }).message);
    vi.useRealTimers();
    expect(cmd.calls).toBe(2);
  });

  it('ignores bots, wrong prefixes, and unknown commands', async () => {
    const cmd = testCommand();
    const app = makeFakeApp([cmd]);
    const router = new Router(app);

    await router.handle(makeFakeMessage({ content: '&fm', authorIsBot: true }).message);
    await router.handle(makeFakeMessage({ content: '!fm' }).message);
    await router.handle(makeFakeMessage({ content: '&nope' }).message);
    expect(cmd.calls).toBe(0);
  });

  it('disabling the canonical name blocks aliases too', async () => {
    const cmd = testCommand();
    const app = makeFakeApp([cmd]);
    const router = new Router(app);
    disableCommand(app.db, 'guild-1', 'fm', null);

    const viaAlias = makeFakeMessage({ content: '&f' });
    await router.handle(viaAlias.message);
    expect(cmd.calls).toBe(0);
    expect(viaAlias.replies[0]).toMatch(/disabled in this server/);
  });

  it('channel disables block only that channel', async () => {
    const cmd = testCommand();
    const app = makeFakeApp([cmd]);
    const router = new Router(app);
    disableCommand(app.db, 'guild-1', 'fm', 'channel-1');

    const blocked = makeFakeMessage({ content: '&fm', channelId: 'channel-1' });
    await router.handle(blocked.message);
    expect(blocked.replies[0]).toMatch(/disabled in this channel/);
    expect(cmd.calls).toBe(0);

    const other = makeFakeMessage({
      content: '&fm',
      channelId: 'channel-2',
      authorId: 'user-2',
    });
    await router.handle(other.message);
    expect(cmd.calls).toBe(1);
  });

  it('enforces the per-user cooldown', async () => {
    const cmd = testCommand();
    const app = makeFakeApp([cmd]);
    const router = new Router(app);

    await router.handle(makeFakeMessage({ content: '&fm' }).message);
    await router.handle(makeFakeMessage({ content: '&fm' }).message);
    expect(cmd.calls).toBe(1);

    await router.handle(makeFakeMessage({ content: '&fm', authorId: 'other' }).message);
    expect(cmd.calls).toBe(2);
  });

  it('records last use when a registered user runs a valid command', async () => {
    const cmd = testCommand();
    const app = makeFakeApp([cmd]);
    app.db.insert(schema.users).values({ discordUserId: 'user-1', lastfmUsername: 'lfm1' }).run();
    const router = new Router(app);
    const usedAt = new Date('2026-08-14T12:00:00.000Z');

    vi.useFakeTimers();
    try {
      vi.setSystemTime(usedAt);
      await router.handle(makeFakeMessage({ content: '&fm' }).message);
    } finally {
      vi.useRealTimers();
    }

    const row = app.db.select().from(schema.users).get();
    expect(row?.lastUsed).toEqual(usedAt);
    expect(row?.commandCount).toBe(1);
    expect(app.db.select().from(schema.commandUsage).all()).toMatchObject([
      { userId: 'user-1', commandName: 'fm', count: 1, lastUsed: usedAt },
    ]);
  });

  it('does not insert a user row when an unregistered user runs a command', async () => {
    const cmd = testCommand();
    const app = makeFakeApp([cmd]);
    const router = new Router(app);

    await router.handle(makeFakeMessage({ content: '&fm' }).message);

    expect(cmd.calls).toBe(1);
    expect(app.db.select().from(schema.users).all()).toEqual([]);
    expect(app.db.select().from(schema.commandUsage).all()).toEqual([]);
  });

  it('does not update last use for cooldown-suppressed messages', async () => {
    const cmd = testCommand();
    const app = makeFakeApp([cmd]);
    app.db.insert(schema.users).values({ discordUserId: 'user-1', lastfmUsername: 'lfm1' }).run();
    const router = new Router(app);
    const firstUse = new Date('2026-08-14T12:00:00.000Z');

    vi.useFakeTimers();
    try {
      vi.setSystemTime(firstUse);
      await router.handle(makeFakeMessage({ content: '&fm' }).message);

      vi.setSystemTime(new Date(firstUse.getTime() + 1000));
      await router.handle(makeFakeMessage({ content: '&fm' }).message);
    } finally {
      vi.useRealTimers();
    }

    const row = app.db.select().from(schema.users).get();
    expect(cmd.calls).toBe(1);
    expect(row?.lastUsed).toEqual(firstUse);
    expect(row?.commandCount).toBe(1);
    expect(app.db.select().from(schema.commandUsage).all()).toMatchObject([
      { commandName: 'fm', count: 1 },
    ]);
  });

  it('tallies each command under its canonical name and keeps the total in step', async () => {
    const fm = testCommand();
    const wk = testCommand({ name: 'wk', aliases: [] });
    const app = makeFakeApp([fm, wk]);
    app.db.insert(schema.users).values({ discordUserId: 'user-1', lastfmUsername: 'lfm1' }).run();
    const router = new Router(app);
    const start = new Date('2026-08-20T12:00:00.000Z');

    vi.useFakeTimers();
    try {
      vi.setSystemTime(start);
      await router.handle(makeFakeMessage({ content: '&fm' }).message);
      vi.setSystemTime(new Date(start.getTime() + 5000));
      await router.handle(makeFakeMessage({ content: '&f' }).message);
      vi.setSystemTime(new Date(start.getTime() + 10000));
      await router.handle(makeFakeMessage({ content: '&wk' }).message);
    } finally {
      vi.useRealTimers();
    }

    const user = app.db.select().from(schema.users).get();
    expect(user?.commandCount).toBe(3);

    const usage = app.db
      .select()
      .from(schema.commandUsage)
      .orderBy(schema.commandUsage.commandName)
      .all();
    expect(usage.map((r) => [r.commandName, r.count])).toEqual([
      ['fm', 2],
      ['wk', 1],
    ]);
    expect(usage.reduce((sum, r) => sum + r.count, 0)).toBe(user?.commandCount);
  });

  it('blocks owner-only commands for non-owners', async () => {
    const cmd = testCommand({ ownerOnly: true });
    const app = makeFakeApp([cmd]);
    const router = new Router(app);

    const denied = makeFakeMessage({ content: '&fm' });
    await router.handle(denied.message);
    expect(cmd.calls).toBe(0);
    expect(denied.replies[0]).toMatch(/do not have access/);

    await router.handle(makeFakeMessage({ content: '&fm', authorId: 'owner-1' }).message);
    expect(cmd.calls).toBe(1);
  });

  it('refuses guild-only commands in DMs but allows others', async () => {
    const guildOnly = testCommand({ guildOnly: true });
    const app = makeFakeApp([guildOnly]);
    const router = new Router(app);

    const dm = makeFakeMessage({ content: '&fm', guildId: null });
    await router.handle(dm.message);
    expect(guildOnly.calls).toBe(0);
    expect(dm.replies[0]).toMatch(/only works in a server/);
  });

  it('reports command errors and sends the error snippet', async () => {
    const cmd = testCommand({
      run: async () => {
        throw new Error('boom');
      },
    });
    const app = makeFakeApp([cmd]);
    const router = new Router(app);

    const failed = makeFakeMessage({ content: '&fm' });
    await router.handle(failed.message);
    expect(app.reportedErrors[0]).toMatch(/boom/);
    expect(failed.replies[0]).toBe(app.snippets.error);
  });
});
