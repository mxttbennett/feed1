/**
 * Live smoke test: drives the running dev bot with real Discord messages.
 *
 * Setup:
 *   1. Run feed1 with the DEV token and SMOKE_ALLOW_BOT_ID=<tester bot user id>.
 *   2. Set SMOKE_TESTER_TOKEN / SMOKE_GUILD_ID / SMOKE_CHANNEL_ID in .env.
 *   3. npm run smoke
 *
 * The tester bot posts commands and asserts that the bot under test replies.
 */
import 'dotenv/config';
import { Client, GatewayIntentBits, type Message, type TextChannel } from 'discord.js';

const TESTER_TOKEN = process.env.SMOKE_TESTER_TOKEN;
const GUILD_ID = process.env.SMOKE_GUILD_ID;
const CHANNEL_ID = process.env.SMOKE_CHANNEL_ID;
const PREFIX = process.env.PREFIX ?? '-';
const REPLY_TIMEOUT_MS = 20_000;

if (!TESTER_TOKEN || !GUILD_ID || !CHANNEL_ID) {
  console.error('smoke: set SMOKE_TESTER_TOKEN, SMOKE_GUILD_ID, SMOKE_CHANNEL_ID in .env');
  process.exit(1);
}

interface SmokeCase {
  name: string;
  send: string;
  expect: (reply: Message) => boolean;
  describe: string;
}

const CASES: SmokeCase[] = [
  {
    name: 'ping',
    send: `${PREFIX}ping`,
    expect: (m) => /pong!/.test(m.content),
    describe: 'replies pong',
  },
  {
    name: 'help',
    send: `${PREFIX}help`,
    expect: (m) => m.embeds.length > 0 && Boolean(m.embeds[0]?.description?.includes('`fm`')),
    describe: 'help embed lists fm',
  },
  {
    name: 'help fm',
    send: `${PREFIX}help fm`,
    expect: (m) => m.embeds[0]?.title === `${PREFIX}fm`,
    describe: 'per-command help',
  },
  {
    name: 'mylogin (unregistered or registered both valid)',
    send: `${PREFIX}mylogin`,
    expect: (m) => /logged in as|haven't logged into/.test(m.content),
    describe: 'mylogin answers',
  },
  {
    name: 'unknown command silence is not asserted',
    send: `${PREFIX}botinfo`,
    expect: (m) => m.embeds[0]?.title === 'feed1',
    describe: 'botinfo embed',
  },
];

async function main(): Promise<void> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  await client.login(TESTER_TOKEN);
  await new Promise<void>((resolve) => client.once('clientReady', () => resolve()));
  const channel = (await client.channels.fetch(CHANNEL_ID!)) as TextChannel;

  let failed = 0;
  for (const testCase of CASES) {
    const replyPromise = new Promise<Message | null>((resolve) => {
      const timer = setTimeout(() => {
        client.off('messageCreate', onMessage);
        resolve(null);
      }, REPLY_TIMEOUT_MS);
      function onMessage(m: Message) {
        if (m.channelId !== CHANNEL_ID) return;
        if (m.author.id === client.user!.id) return;
        if (!m.author.bot) return;
        clearTimeout(timer);
        client.off('messageCreate', onMessage);
        resolve(m);
      }
      client.on('messageCreate', onMessage);
    });

    await channel.send(testCase.send);
    const reply = await replyPromise;

    if (reply && testCase.expect(reply)) {
      console.log(`✓ ${testCase.name} — ${testCase.describe}`);
    } else {
      failed++;
      console.error(
        `✗ ${testCase.name} — ${reply ? `unexpected reply: ${reply.content || '[embed]'}` : 'no reply within timeout'}`,
      );
    }
    // stay under the bot's per-user cooldown
    await new Promise((r) => setTimeout(r, 2500));
  }

  await client.destroy();
  console.log(failed === 0 ? 'smoke: all passed' : `smoke: ${failed} case(s) failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error('smoke: fatal', error);
  process.exit(1);
});
