import type { Client } from 'discord.js';
import type { BannerConfig, BannerService } from './service.js';
import { MAX_CONSECUTIVE_FAILURES } from './service.js';

const TICK_MS = 60_000;
const GUILD_GAP_MS = 5_000;

export interface BannerSchedulerHooks {
  sleep?: (ms: number) => Promise<void>;
  reportError?: (error: unknown, context: string) => Promise<void>;
}

/**
 * Polls `banner_configs` for guilds whose `next_run_at` has passed and rotates them.
 *
 * Deadline-driven rather than queue-driven: the truth is "guild G is due at time T", so a
 * missed tick means rotating late, not losing work — no claim flag, no stuck-job recovery.
 */
export class BannerScheduler {
  private running = false;
  private stopped = false;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly reportError: (error: unknown, context: string) => Promise<void>;

  constructor(
    private readonly client: Client,
    private readonly service: BannerService,
    hooks: BannerSchedulerHooks = {},
  ) {
    this.sleep = hooks.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.reportError = hooks.reportError ?? ((e, c) => Promise.resolve(console.error(`[${c}]`, e)));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.stopped = false;
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
    this.running = false;
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      try {
        const due = this.service.dueConfigs();
        for (const config of due) {
          if (this.stopped) return;
          await this.rotateOne(config);
          await this.sleep(GUILD_GAP_MS);
        }
      } catch (error) {
        await this.reportError(error, 'banner scheduler tick');
      }
      await this.sleep(TICK_MS);
    }
  }

  private async rotateOne(config: BannerConfig): Promise<void> {
    const guild = await this.client.guilds.fetch(config.guildId).catch(() => null);
    if (!guild) {
      this.service.deleteConfig(config.guildId);
      return;
    }

    const result = await this.service.rotate(guild, config.lastImageId);
    if (result.ok) {
      this.service.recordResult(config, result);
      return;
    }

    const exhausted = this.service.isExhausted(config);
    this.service.recordResult(config, result);
    if (exhausted) {
      this.service.deleteConfig(config.guildId);
      await this.reportError(
        new Error(`${result.reason}: ${result.detail}`),
        `banner rotation disabled for guild ${config.guildId} after ${MAX_CONSECUTIVE_FAILURES} failures`,
      );
    }
  }
}
