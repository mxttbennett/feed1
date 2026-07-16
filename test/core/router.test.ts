import { describe, expect, it, vi } from 'vitest';
import type { Command } from '../../src/core/command.js';
import { Router } from '../../src/core/router.js';
import { disableCommand } from '../../src/core/disables.js';
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
  return cmd as Command & { calls: number };
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
