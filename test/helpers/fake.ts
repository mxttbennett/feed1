import type { Message } from 'discord.js';
import type { AppContext, Command } from '../../src/core/command.js';
import { CommandRegistry } from '../../src/core/command.js';
import { loadConfig } from '../../src/core/config.js';
import { createDb, runMigrations } from '../../src/db/index.js';
import { LastfmClient } from '../../src/lastfm/client.js';
import { makeSnippets } from '../../src/core/snippets.js';
import { ErrorReporter } from '../../src/core/errors.js';
import { KeyedMutex } from '../../src/core/mutex.js';

export const TEST_ENV = {
  DISCORD_TOKEN: 'test-token',
  PREFIX: '&',
  OWNER_ID: 'owner-1',
  LASTFM_API_KEY: 'test-key',
  DB_PATH: ':memory:',
};

export interface FakeApp extends AppContext {
  reportedErrors: string[];
}

export function makeFakeApp(commands: Command[] = []): FakeApp {
  const config = loadConfig({ ...TEST_ENV });
  const db = createDb(':memory:');
  runMigrations(db);
  const registry = new CommandRegistry();
  registry.register(...commands);
  const reportedErrors: string[] = [];
  const errors = new ErrorReporter(
    // never used because errorChannelId is undefined
    null as never,
    undefined,
    (msg) => reportedErrors.push(msg),
  );
  return {
    config,
    db,
    lastfm: new LastfmClient('test-key', { minIntervalMs: 0, sleep: async () => {} }),
    snippets: makeSnippets(config.prefix),
    errors,
    guildScanLock: new KeyedMutex(),
    registry,
    reportedErrors,
  };
}

export interface FakeMessageOptions {
  content: string;
  authorId?: string;
  authorIsBot?: boolean;
  guildId?: string | null;
  channelId?: string;
  mentionUserIds?: string[];
  memberDisplayColor?: number;
}

export interface FakeMessage {
  replies: string[];
  embeds: unknown[];
  edits: unknown[];
  message: Message;
}

/** Builds the minimal Message surface the router and commands touch. */
export function makeFakeMessage(opts: FakeMessageOptions): FakeMessage {
  const replies: string[] = [];
  const embeds: unknown[] = [];
  const edits: unknown[] = [];

  const guildId = opts.guildId === undefined ? 'guild-1' : opts.guildId;

  const mentionedUsers = (opts.mentionUserIds ?? []).map((id) => ({
    id,
    username: `user-${id}`,
    bot: false,
    displayAvatarURL: () => `https://avatar.example/${id}`,
  }));

  const sent = (payload: unknown) => {
    if (typeof payload === 'string') replies.push(payload);
    else if (payload && typeof payload === 'object') {
      const p = payload as { content?: string; embeds?: unknown[] };
      if (p.content) replies.push(p.content);
      if (p.embeds) embeds.push(...p.embeds);
      else replies.push(JSON.stringify(payload));
    }
    return Promise.resolve(makeSentMessage());
  };

  function makeSentMessage() {
    return {
      edit: (payload: unknown) => {
        edits.push(payload);
        return Promise.resolve(makeSentMessage());
      },
      react: () => Promise.resolve(),
    };
  }

  const message = {
    content: opts.content,
    author: {
      id: opts.authorId ?? 'user-1',
      bot: opts.authorIsBot ?? false,
      username: `user-${opts.authorId ?? 'user-1'}`,
      displayAvatarURL: () => 'https://avatar.example/author',
      send: sent,
    },
    member: guildId
      ? {
          displayColor: opts.memberDisplayColor ?? 0,
          permissions: { has: () => true },
        }
      : null,
    guild: guildId
      ? {
          id: guildId,
          name: `guild-${guildId}`,
          members: { fetch: () => Promise.resolve(new Map()) },
        }
      : null,
    channel: {
      id: opts.channelId ?? 'channel-1',
      send: sent,
      isTextBased: () => true,
      isSendable: () => true,
    },
    channelId: opts.channelId ?? 'channel-1',
    mentions: {
      users: {
        first: () => mentionedUsers[0],
      },
    },
    reply: sent,
    react: () => Promise.resolve(),
  } as unknown as Message;

  return { replies, embeds, edits, message };
}
