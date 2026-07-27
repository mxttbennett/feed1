import type { Client, TextChannel } from 'discord.js';
import { LastfmError } from '../lastfm/errors.js';

const CHUNK = 1900;

export class ErrorReporter {
  constructor(
    private readonly client: Client,
    private readonly errorChannelId: string | undefined,
    private readonly log: (msg: string) => void = (m) => console.error(m),
  ) {}

  /** Log an error and post it to the error channel (best effort, never throws). */
  async report(error: unknown, context: string): Promise<void> {
    const text = this.format(error, context);
    this.log(text);
    if (!this.errorChannelId) return;
    try {
      const channel = await this.client.channels.fetch(this.errorChannelId);
      if (!channel?.isTextBased()) return;
      for (let i = 0; i < text.length; i += CHUNK) {
        await (channel as TextChannel).send({
          content: '```\n' + text.slice(i, i + CHUNK) + '\n```',
          allowedMentions: { parse: [] },
        });
      }
    } catch {
      // reporting must never take the bot down
    }
  }

  private format(error: unknown, context: string): string {
    if (error instanceof LastfmError) {
      return `[${context}] Last.fm error ${error.code} on ${error.method}: ${error.message}`;
    }
    if (error instanceof Error) {
      return `[${context}] ${error.stack ?? error.message}`;
    }
    return `[${context}] ${String(error)}`;
  }
}
