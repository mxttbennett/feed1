import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  PREFIX: z.string().min(1).default('-'),
  OWNER_ID: z.string().min(1),
  ERROR_CHANNEL_ID: z.string().optional(),
  STATUS_CHANNEL_ID: z.string().optional(),
  LASTFM_API_KEY: z.string().min(1),
  DB_PATH: z.string().default('.data/feed1.sqlite'),
  CHART_QUEUE_PAGE_OVERRIDES: z.string().default(''),
  SMOKE_ALLOW_BOT_ID: z.string().optional(),
});

export interface Config {
  discordToken: string;
  prefix: string;
  ownerId: string;
  errorChannelId: string | undefined;
  statusChannelId: string | undefined;
  lastfmApiKey: string;
  dbPath: string;
  /** guildId -> max chart-queue pages (0 = unlimited); absent guilds use DEFAULT_CHART_QUEUE_PAGES */
  chartQueuePageOverrides: Map<string, number>;
  /** bot user id allowed to invoke commands (live smoke tester); never set in production */
  smokeAllowBotId: string | undefined;
}

export const DEFAULT_CHART_QUEUE_PAGES = 5;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  const e = parsed.data;

  const overrides = new Map<string, number>();
  for (const pair of e.CHART_QUEUE_PAGE_OVERRIDES.split(',').filter(Boolean)) {
    const [guildId, cap] = pair.split(':');
    const capNum = Number(cap);
    if (!guildId || !Number.isInteger(capNum) || capNum < 0) {
      throw new Error(`Invalid CHART_QUEUE_PAGE_OVERRIDES entry: "${pair}" (want guildId:pages)`);
    }
    overrides.set(guildId, capNum);
  }

  return {
    discordToken: e.DISCORD_TOKEN,
    prefix: e.PREFIX,
    ownerId: e.OWNER_ID,
    errorChannelId: e.ERROR_CHANNEL_ID,
    statusChannelId: e.STATUS_CHANNEL_ID,
    lastfmApiKey: e.LASTFM_API_KEY,
    dbPath: e.DB_PATH,
    chartQueuePageOverrides: overrides,
    smokeAllowBotId: e.SMOKE_ALLOW_BOT_ID,
  };
}
