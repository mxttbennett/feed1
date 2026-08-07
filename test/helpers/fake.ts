import { Collection } from 'discord.js';
import type { Message } from 'discord.js';
import type { AppContext, Command } from '../../src/core/command.js';
import { CommandRegistry } from '../../src/core/command.js';
import { loadConfig } from '../../src/core/config.js';
import { createDb, runMigrations } from '../../src/db/index.js';
import { LastfmClient } from '../../src/lastfm/client.js';
import { makeSnippets } from '../../src/core/snippets.js';
import { ErrorReporter } from '../../src/core/errors.js';
import { KeyedMutex } from '../../src/core/mutex.js';
import { BannerService } from '../../src/banner/service.js';
import type { BannerServiceOptions } from '../../src/banner/service.js';

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

export interface FakeAppOptions {
  /** pass null to exercise the "banner rotation isn't set up" path */
  imgurClientId?: string | null;
  banner?: BannerServiceOptions;
}

export function makeFakeApp(commands: Command[] = [], opts: FakeAppOptions = {}): FakeApp {
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
    bannerService: new BannerService(
      db,
      opts.imgurClientId === null ? undefined : (opts.imgurClientId ?? 'test-imgur-id'),
      opts.banner ?? {},
    ),
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
  /** 0-indexed edit calls that should reject, to exercise non-fatal edit paths */
  failEditsAt?: number[];
  /** stands in for `client.users.fetch`, for the crown-notification DM path */
  fetchUser?: (id: string) => Promise<unknown>;
  /** false makes every permission check fail, for Manage Server denial paths */
  memberPermissions?: boolean;
  /** guild features; defaults to BANNER so banner tests have the capability */
  guildFeatures?: string[];
  guildBannerUrl?: string | null;
  /** rejects `setBanner` with this message instead of recording the call */
  failSetBanner?: string;
}

export interface FakeMessage {
  replies: string[];
  embeds: unknown[];
  edits: unknown[];
  /** every `guild.setBanner` payload, in order */
  bannerSets: string[];
  message: Message;
}

/** Builds the minimal Message surface the router and commands touch. */
export function makeFakeMessage(opts: FakeMessageOptions): FakeMessage {
  const replies: string[] = [];
  const embeds: unknown[] = [];
  const edits: unknown[] = [];
  const bannerSets: string[] = [];

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

  const failEditsAt = new Set(opts.failEditsAt ?? []);

  function makeSentMessage() {
    return {
      edit: (payload: unknown) => {
        const attempt = edits.length;
        edits.push(payload);
        if (failEditsAt.has(attempt)) return Promise.reject(new Error(`edit ${attempt} failed`));
        return Promise.resolve(makeSentMessage());
      },
      react: () => Promise.resolve(),
      delete: () => Promise.resolve(),
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
          permissions: { has: () => opts.memberPermissions ?? true },
        }
      : null,
    guild: guildId
      ? {
          id: guildId,
          name: `guild-${guildId}`,
          memberCount: 0,
          features: opts.guildFeatures ?? ['BANNER'],
          bannerURL: () => opts.guildBannerUrl ?? null,
          setBanner: (data: string) => {
            if (opts.failSetBanner) return Promise.reject(new Error(opts.failSetBanner));
            bannerSets.push(data);
            return Promise.resolve();
          },
          members: {
            cache: new Collection<string, unknown>(),
            fetch: () => Promise.resolve(new Collection<string, unknown>()),
          },
        }
      : null,
    channel: {
      id: opts.channelId ?? 'channel-1',
      send: sent,
      isTextBased: () => true,
      isSendable: () => true,
    },
    channelId: opts.channelId ?? 'channel-1',
    client: {
      guilds: { cache: { size: 1 } },
      users: { fetch: opts.fetchUser ?? (() => Promise.resolve(null)) },
    },
    mentions: {
      users: {
        first: () => mentionedUsers[0],
      },
    },
    reply: sent,
    react: () => Promise.resolve(),
  } as unknown as Message;

  return { replies, embeds, edits, bannerSets, message };
}

/**
 * Give a fake message a guild populated with the given member ids. `fetch()` fills the cache
 * lazily, so `gatherRegisteredMembers` exercises its cache-miss branch. Ids still need matching
 * `users` rows to survive the join in `gatherRegisteredMembers`.
 */
export function withGuildMembers(fake: FakeMessage, ids: string[]): void {
  const all = new Collection<string, unknown>(
    ids.map((id) => [id, { user: { id, bot: false, tag: `${id}#0`, username: id } }]),
  );
  const cache = new Collection<string, unknown>();
  const holder = fake.message as unknown as { guild: Record<string, unknown> };
  holder.guild = {
    ...holder.guild,
    id: 'guild-1',
    name: 'Test Guild',
    memberCount: ids.length,
    members: {
      cache,
      fetch: () => {
        for (const [id, m] of all) cache.set(id, m);
        return Promise.resolve(all);
      },
    },
  };
}
