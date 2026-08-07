import { Client, GatewayIntentBits, Partials } from 'discord.js';
import type { TextChannel } from 'discord.js';
import type { Config } from './config.js';
import type { AppContext, CommandRegistry } from './command.js';
import type { Db } from '../db/index.js';
import { LastfmClient } from '../lastfm/client.js';
import { makeSnippets } from './snippets.js';
import { ErrorReporter } from './errors.js';
import { KeyedMutex } from './mutex.js';
import { Router } from './router.js';
import { BannerService } from '../banner/service.js';
import { BannerImageStore } from '../banner/store.js';
import { join, dirname } from 'node:path';

export interface Bot {
  client: Client;
  app: AppContext;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createBot(config: Config, db: Db, registry: CommandRegistry): Bot {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
  });

  const app: AppContext = {
    config,
    db,
    lastfm: new LastfmClient(config.lastfmApiKey),
    snippets: makeSnippets(config.prefix),
    errors: new ErrorReporter(client, config.errorChannelId),
    guildScanLock: new KeyedMutex(),
    bannerService: new BannerService(
      db,
      new BannerImageStore(db, join(dirname(config.dbPath), 'banners')),
    ),
    registry,
  };

  const router = new Router(app);

  client.on('messageCreate', (message) => {
    void router.handle(message);
  });

  client.on('error', (error) => {
    void app.errors.report(error, 'client error');
  });

  process.on('unhandledRejection', (reason) => {
    void app.errors.report(reason, 'unhandledRejection');
  });

  async function preflight(): Promise<void> {
    const guild = client.guilds.cache.first();
    if (!guild) {
      console.warn('preflight: bot is in no guilds — skipping member-fetch check');
      return;
    }
    try {
      await guild.members.fetch();
    } catch (error) {
      throw new Error(
        `preflight failed: cannot fetch members of "${guild.name}". ` +
          `Enable the "Server Members Intent" (and "Message Content Intent") for this bot ` +
          `in the Discord developer portal. Underlying error: ${String(error)}`,
      );
    }
  }

  async function reportStatus(text: string): Promise<void> {
    if (!config.statusChannelId) return;
    try {
      const channel = await client.channels.fetch(config.statusChannelId);
      if (channel?.isTextBased()) await (channel as TextChannel).send(text);
    } catch {
      // status reporting is best-effort
    }
  }

  return {
    client,
    app,
    async start() {
      await client.login(config.discordToken);
      await new Promise<void>((resolve) => client.once('clientReady', () => resolve()));
      await preflight();
      await reportStatus(`feed1 online (${client.guilds.cache.size} guilds)`);
      console.log(`feed1 logged in as ${client.user?.tag}`);
    },
    async stop() {
      await reportStatus('feed1 shutting down');
      await client.destroy();
    },
  };
}
