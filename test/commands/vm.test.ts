import { describe, expect, it } from 'vitest';
import type { EmbedBuilder } from 'discord.js';
import { makeVmCommand, vmCommands } from '../../src/commands/vm.js';
import type { HostSnapshot } from '../../src/ops/host.js';
import { makeFakeApp, makeFakeMessage } from '../helpers/fake.js';

const SNAPSHOT: HostSnapshot = {
  uptimeSeconds: 90_061,
  load: [0.42, 0.38, 0.31],
  cores: 1,
  memory: { total: 6 * 1024 ** 3, available: 4 * 1024 ** 3, source: 'meminfo' },
  disk: { total: 45 * 1024 ** 3, available: 22 * 1024 ** 3 },
  dataSize: 512 * 1024 ** 2,
  process: { uptimeSeconds: 3600, rss: 180 * 1024 ** 2 },
};

describe('&vm', () => {
  it('is owner-only, hidden, and aliased to host', () => {
    const vm = vmCommands[0]!;
    expect(vm.name).toBe('vm');
    expect(vm.aliases).toEqual(['host']);
    expect(vm.ownerOnly).toBe(true);
    expect(vm.hidden).toBe(true);
    expect(vm.guildOnly).toBe(false);
  });

  it('sends the snapshot as an embed', async () => {
    const vm = makeVmCommand(() => SNAPSHOT);
    const fake = makeFakeMessage({ content: '&vm' });
    await vm.run({ app: makeFakeApp(), message: fake.message, args: [] });

    const embed = fake.embeds[0] as EmbedBuilder;
    expect(embed.data.title).toBe('VM snapshot');
    expect(embed.data.fields?.map((f) => f.name)).toEqual([
      'uptime',
      'load',
      'disk',
      'memory',
      '.data',
      'feed1',
    ]);
  });

  it('reads the directory holding the database', async () => {
    let seen = '';
    const vm = makeVmCommand((dir) => {
      seen = dir;
      return SNAPSHOT;
    });
    const app = makeFakeApp();
    app.config.dbPath = '/opt/feed1/.data/feed1.sqlite';
    const fake = makeFakeMessage({ content: '&vm' });
    await vm.run({ app, message: fake.message, args: [] });

    expect(seen).toBe('/opt/feed1/.data');
  });

  it('still sends when the host could not report disk or data size', async () => {
    const vm = makeVmCommand(() => ({ ...SNAPSHOT, disk: undefined, dataSize: undefined }));
    const fake = makeFakeMessage({ content: '&vm' });
    await vm.run({ app: makeFakeApp(), message: fake.message, args: [] });

    const embed = fake.embeds[0] as EmbedBuilder;
    expect(embed.data.fields?.find((f) => f.name === 'disk')?.value).toBe('unavailable');
  });
});
