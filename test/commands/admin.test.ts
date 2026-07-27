import { describe, expect, it } from 'vitest';
import type { EmbedBuilder } from 'discord.js';
import { adminCommands } from '../../src/commands/admin.js';
import { fm } from '../../src/commands/fm.js';
import { Router } from '../../src/core/router.js';
import { makeFakeApp, makeFakeMessage } from '../helpers/fake.js';

const byName = (name: string) => adminCommands.find((c) => c.name === name)!;

function appWithAll() {
  return makeFakeApp([fm, ...adminCommands]);
}

describe('&disable / &enable', () => {
  it('disables by alias, canonicalizes, and the router honors it', async () => {
    const app = appWithAll();
    const router = new Router(app);

    const disable = makeFakeMessage({ content: '&disable f' });
    await byName('disable').run({ app, message: disable.message, args: ['f'] });
    expect(disable.replies[0]).toBe('`fm` is now disabled in this channel.');

    const blocked = makeFakeMessage({ content: '&fm', authorId: 'someone-else' });
    await router.handle(blocked.message);
    expect(blocked.replies[0]).toMatch(/disabled in this channel/);

    const enable = makeFakeMessage({ content: '&enable fm' });
    await byName('enable').run({ app, message: enable.message, args: ['fm'] });
    expect(enable.replies[0]).toBe('`fm` is enabled again in this channel.');
  });

  it('supports guild-wide disables with --guild', async () => {
    const app = appWithAll();
    const fake = makeFakeMessage({ content: '&disable fm --guild' });
    await byName('disable').run({ app, message: fake.message, args: ['fm', '--guild'] });
    expect(fake.replies[0]).toBe('`fm` is now disabled in this server.');
  });

  it('rejects unknown commands and protects itself', async () => {
    const app = appWithAll();
    const unknown = makeFakeMessage({ content: '&disable nope' });
    await byName('disable').run({ app, message: unknown.message, args: ['nope'] });
    expect(unknown.replies[0]).toBe('`nope` is not a command I know.');

    const protectedCmd = makeFakeMessage({ content: '&disable help' });
    await byName('disable').run({ app, message: protectedCmd.message, args: ['help'] });
    expect(protectedCmd.replies[0]).toBe('`help` cannot be disabled.');
  });
});

describe('&help', () => {
  it('lists visible commands', async () => {
    const app = appWithAll();
    const fake = makeFakeMessage({ content: '&help' });
    await byName('help').run({ app, message: fake.message, args: [] });
    const embed = fake.embeds[0] as EmbedBuilder;
    expect(embed.data.description).toContain('`fm`');
    expect(embed.data.description).toContain('`help`');
    expect(embed.data.description).not.toContain('`r`');
  });

  it('shows detail with usage and aliases for one command', async () => {
    const app = appWithAll();
    const fake = makeFakeMessage({ content: '&help f' });
    await byName('help').run({ app, message: fake.message, args: ['f'] });
    const embed = fake.embeds[0] as EmbedBuilder;
    expect(embed.data.title).toBe('&fm');
    expect(JSON.stringify(embed.data.fields)).toContain('`f`');
  });
});
