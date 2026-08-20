import { join, dirname } from 'node:path';
import type { TextChannel } from 'discord.js';
import { loadConfig } from './core/config.js';
import { createDb, runMigrations } from './db/index.js';
import { CommandRegistry } from './core/command.js';
import { createBot } from './core/bot.js';
import { CrownService } from './crowns/service.js';
import { CrownJobWorker } from './crowns/worker.js';
import { notifyCrownChange } from './crowns/notify.js';
import { BACKUP_INTERVAL_MS, createBackup, formatBackupReport } from './ops/backup.js';
import { fm } from './commands/fm.js';
import { profileCommands } from './commands/profile.js';
import { crownCommands } from './commands/crowns.js';
import { chartCommands } from './commands/charts.js';
import { whoKnowsCommands } from './commands/whoknows.js';
import { rymCommands } from './commands/rym.js';
import { bannerCommands } from './commands/banner.js';
import { adminCommands } from './commands/admin.js';
import { changelogCommands } from './commands/changelog.js';
import { BannerScheduler } from './banner/worker.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = createDb(config.dbPath);
  runMigrations(db);

  const registry = new CommandRegistry();
  registry.register(
    fm,
    ...profileCommands,
    ...crownCommands,
    ...chartCommands,
    ...whoKnowsCommands,
    ...rymCommands,
    ...bannerCommands,
    ...adminCommands,
    ...changelogCommands,
  );

  const bot = createBot(config, db, registry);
  await bot.start();

  const crownService = new CrownService(db, bot.app.lastfm, bot.app.guildScanLock, (change) =>
    notifyCrownChange(bot.client, db, change),
  );
  const worker = new CrownJobWorker(db, bot.client, crownService, {
    reportError: (error, context) => bot.app.errors.report(error, context),
  });
  const recovered = worker.recoverStuckJobs();
  if (recovered > 0) console.log(`recovered ${recovered} crown jobs from a previous run`);
  worker.start();

  const bannerScheduler = new BannerScheduler(bot.client, bot.app.bannerService, {
    reportError: (error, context) => bot.app.errors.report(error, context),
  });
  bannerScheduler.start();

  const backupDir = join(dirname(config.dbPath), 'backups');
  const runBackup = async () => {
    try {
      const result = createBackup(config.dbPath, backupDir);
      console.log(formatBackupReport(result));
      if (config.statusChannelId) {
        const channel = await bot.client.channels.fetch(config.statusChannelId).catch(() => null);
        if (channel?.isTextBased()) {
          await (channel as TextChannel).send(formatBackupReport(result));
        }
      }
    } catch (error) {
      await bot.app.errors.report(error, 'backup');
    }
  };
  await runBackup();
  setInterval(() => void runBackup(), BACKUP_INTERVAL_MS);

  const shutdown = async () => {
    worker.stop();
    bannerScheduler.stop();
    await bot.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error: unknown) => {
  console.error('fatal startup error:', error);
  process.exit(1);
});
