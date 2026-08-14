import type { Message } from 'discord.js';
import type { Config } from './config.js';
import type { Db } from '../db/index.js';
import type { LastfmClient } from '../lastfm/client.js';
import type { Snippets } from './snippets.js';
import type { ErrorReporter } from './errors.js';
import type { KeyedMutex } from './mutex.js';
import type { BannerService } from '../banner/service.js';

/** Everything a command needs beyond the triggering message; assembled once at boot, faked in tests. */
export interface AppContext {
  config: Config;
  db: Db;
  lastfm: LastfmClient;
  snippets: Snippets;
  errors: ErrorReporter;
  /** serializes guild-wide member fan-outs (who-knows, crown scans) to one at a time per guild */
  guildScanLock: KeyedMutex;
  /** shared with the banner scheduler, so both go through the same per-guild rotation lock */
  bannerService: BannerService;
  registry: CommandRegistry;
}

export interface CommandContext {
  app: AppContext;
  message: Message;
  args: string[];
}

export interface Command {
  /** canonical name — what disables are stored under */
  name: string;
  aliases?: string[];
  description: string;
  usage: string;
  notes?: string;
  /** hide from &help (owner/ops commands) */
  hidden?: boolean;
  ownerOnly?: boolean;
  /** requires a guild context (most commands); DM invocation gets a polite refusal */
  guildOnly?: boolean;
  run(ctx: CommandContext): Promise<unknown>;
}

export class CommandRegistry {
  private byName = new Map<string, Command>();
  private byAlias = new Map<string, Command>();

  register(...commands: Command[]): void {
    for (const cmd of commands) {
      const canonical = cmd.name.toLowerCase();
      if (this.byAlias.has(canonical)) {
        throw new Error(`Duplicate command name/alias: ${canonical}`);
      }
      this.byName.set(canonical, cmd);
      this.byAlias.set(canonical, cmd);
      for (const alias of cmd.aliases ?? []) {
        const a = alias.toLowerCase();
        if (this.byAlias.has(a)) throw new Error(`Duplicate command name/alias: ${a}`);
        this.byAlias.set(a, cmd);
      }
    }
  }

  /** Resolve a typed name or alias to its command, or undefined. */
  resolve(nameOrAlias: string): Command | undefined {
    return this.byAlias.get(nameOrAlias.toLowerCase());
  }

  /** Canonical command name for a typed name/alias (for disable storage). */
  canonicalName(nameOrAlias: string): string | undefined {
    return this.resolve(nameOrAlias)?.name;
  }

  all(): Command[] {
    return [...this.byName.values()];
  }
}
