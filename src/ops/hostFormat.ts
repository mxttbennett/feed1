import { EmbedBuilder } from 'discord.js';
import type { HostSnapshot } from './host.js';

const UNAVAILABLE = 'unavailable';

export function formatBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1024 ** 2;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

/** The two largest non-zero units, e.g. `12d 4h`. */
export function formatDuration(seconds: number): string {
  const units: [string, number][] = [
    ['d', 86400],
    ['h', 3600],
    ['m', 60],
    ['s', 1],
  ];
  const parts: string[] = [];
  let left = Math.floor(seconds);
  for (const [label, size] of units) {
    const n = Math.floor(left / size);
    left -= n * size;
    if (n > 0 || parts.length > 0) parts.push(`${n}${label}`);
    if (parts.length === 2) break;
  }
  return parts.length > 0 ? parts.join(' ') : '0s';
}

export function formatLoad(load: number[], cores: number): string {
  const triple = load.map((n) => n.toFixed(2)).join('  ');
  return `${triple} · ${cores} core${cores === 1 ? '' : 's'}`;
}

function formatMemory(memory: HostSnapshot['memory']): string {
  const used = formatBytes(memory.total - memory.available);
  const line = `${used} used of ${formatBytes(memory.total)} · ${formatBytes(memory.available)} available`;
  return memory.source === 'os' ? `${line}\nvia os.freemem (excludes cache)` : line;
}

export function buildVmEmbed(snapshot: HostSnapshot): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('VM snapshot')
    .addFields(
      { name: 'uptime', value: formatDuration(snapshot.uptimeSeconds), inline: true },
      { name: 'load', value: formatLoad(snapshot.load, snapshot.cores), inline: true },
      {
        name: 'disk',
        value: snapshot.disk
          ? `${formatBytes(snapshot.disk.total - snapshot.disk.available)} used of ${formatBytes(snapshot.disk.total)} · ${formatBytes(snapshot.disk.available)} free`
          : UNAVAILABLE,
      },
      { name: 'memory', value: formatMemory(snapshot.memory) },
      {
        name: '.data',
        value: snapshot.dataSize === undefined ? UNAVAILABLE : formatBytes(snapshot.dataSize),
        inline: true,
      },
      {
        name: 'feed1',
        value: `${formatBytes(snapshot.process.rss)} RSS · up ${formatDuration(snapshot.process.uptimeSeconds)}`,
        inline: true,
      },
    )
    .setFooter({ text: 'figures cover the whole VM — another stack shares this box' });
}
