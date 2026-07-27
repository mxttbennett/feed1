import { describe, expect, it } from 'vitest';
import type { EmbedBuilder } from 'discord.js';
import { rymCommands } from '../../src/commands/rym.js';
import { schema } from '../../src/db/index.js';
import { makeFakeApp, makeFakeMessage } from '../helpers/fake.js';

const byName = (name: string) => rymCommands.find((c) => c.name === name)!;

function appWithUser(over: Partial<typeof schema.users.$inferInsert> = {}) {
  const app = makeFakeApp(rymCommands);
  app.db
    .insert(schema.users)
    .values({
      discordUserId: 'user-1',
      lastfmUsername: 'lfm',
      rymUsername: 'testrym',
      rymPerPage: 25,
      ...over,
    })
    .run();
  return app;
}

function userRow(app: ReturnType<typeof makeFakeApp>) {
  return app.db.select().from(schema.users).all()[0]!;
}

/** Replaces channel.send with a stub whose sent message survives the multi-page collector path. */
function patchChannelSend(fake: ReturnType<typeof makeFakeMessage>): EmbedBuilder[] {
  const captured: EmbedBuilder[] = [];
  const channel = fake.message.channel as unknown as { send: (p: unknown) => Promise<unknown> };
  channel.send = (payload: unknown) => {
    const p = payload as { embeds?: EmbedBuilder[] };
    if (p.embeds) captured.push(...p.embeds);
    return Promise.resolve({
      createMessageComponentCollector: () => ({ on: () => undefined }),
      edit: () => Promise.resolve(undefined),
    });
  };
  return captured;
}

describe('not logged into rym', () => {
  const needRym = ['rym', 'rstat', 'rcomp', 'rr', 'ry', 'rg', 'rart', 'rw', 'wg', 'rpp', 'tset', 'chset', 'rand', 'wrand', 'trand'];

  it.each(needRym)('%s refuses when no user row exists', async (name) => {
    const app = makeFakeApp(rymCommands);
    const fake = makeFakeMessage({ content: `&${name}` });
    await byName(name).run({ app, message: fake.message, args: [] });
    expect(fake.replies[0]).toBe('`user-user-1` is not logged into rym.');
  });

  it('refuses when the row exists but rymUsername is null', async () => {
    const app = appWithUser({ rymUsername: null });
    const fake = makeFakeMessage({ content: '&rym' });
    await byName('rym').run({ app, message: fake.message, args: [] });
    expect(fake.replies[0]).toBe('`user-user-1` is not logged into rym.');
  });

  it('names the mentioned user in the refusal', async () => {
    const app = appWithUser();
    const fake = makeFakeMessage({ content: '&rym @other', mentionUserIds: ['user-2'] });
    await byName('rym').run({ app, message: fake.message, args: ['@other'] });
    expect(fake.replies[0]).toBe('`user-user-2` is not logged into rym.');
  });
});

describe('link commands', () => {
  it('&rym posts the profile URL', async () => {
    const app = appWithUser();
    const fake = makeFakeMessage({ content: '&rym' });
    await byName('rym').run({ app, message: fake.message, args: [] });
    expect(fake.replies[0]).toBe(
      "`user-user-1's` RYM account: https://rateyourmusic.com/~testrym",
    );
  });

  it('&rym targets a mentioned user', async () => {
    const app = appWithUser();
    app.db
      .insert(schema.users)
      .values({ discordUserId: 'user-2', lastfmUsername: 'lfm2', rymUsername: 'otherrym' })
      .run();
    const fake = makeFakeMessage({ content: '&rym @other', mentionUserIds: ['user-2'] });
    await byName('rym').run({ app, message: fake.message, args: ['@other'] });
    expect(fake.replies[0]).toBe(
      "`user-user-2's` RYM account: https://rateyourmusic.com/~otherrym",
    );
  });

  it('&rym rejects an arg without a mention', async () => {
    const app = appWithUser();
    const fake = makeFakeMessage({ content: '&rym nonsense' });
    await byName('rym').run({ app, message: fake.message, args: ['nonsense'] });
    expect(fake.replies[0]).toBe('`nonsense` is not a valid user.');
  });

  it('&rstat posts the stats URL and carries the rstats alias', async () => {
    expect(byName('rstat').aliases).toContain('rstats');
    const app = appWithUser();
    const fake = makeFakeMessage({ content: '&rstat' });
    await byName('rstat').run({ app, message: fake.message, args: [] });
    expect(fake.replies[0]).toBe(
      "`user-user-1's` RYM stats: https://rateyourmusic.com/stats/userstats?user=testrym",
    );
  });

  it('&rcomp posts the comparison URL', async () => {
    const app = appWithUser();
    const fake = makeFakeMessage({ content: '&rcomp' });
    await byName('rcomp').run({ app, message: fake.message, args: [] });
    expect(fake.replies[0]).toBe(
      "`user-user-1's` comparison page. Check your compatibility here: " +
        'https://rateyourmusic.com/compare?to=testrym',
    );
  });

  it('&rr posts recent ratings with the stored per-page', async () => {
    const app = appWithUser();
    const fake = makeFakeMessage({ content: '&rr' });
    await byName('rr').run({ app, message: fake.message, args: [] });
    expect(fake.replies[0]).toBe(
      "`user-user-1's` recent ratings: " +
        'https://rateyourmusic.com/collection/testrym/r0.5-5.0,ss.dd,n25',
    );
  });

  it('&ry posts the year URL and defaults an unset rpp to 25', async () => {
    const app = appWithUser({ rymPerPage: 0 });
    const fake = makeFakeMessage({ content: '&ry 1997' });
    await byName('ry').run({ app, message: fake.message, args: ['1997'] });
    expect(fake.replies[0]).toBe(
      "`user-user-1's` ratings from 1997: " +
        'https://rateyourmusic.com/collection/testrym/strm_relyear,ss.rd.r0.5-5.0,n25/1997',
    );
  });

  it('&rg joins multi-word genres with +', async () => {
    const app = appWithUser();
    const fake = makeFakeMessage({ content: '&rg drum and bass' });
    await byName('rg').run({ app, message: fake.message, args: ['drum', 'and', 'bass'] });
    expect(fake.replies[0]).toBe(
      "`user-user-1's` drum and bass ratings: " +
        'https://rateyourmusic.com/collection/testrym/strm_h,ss.rd.r0.5-5.0,n25/drum+and+bass',
    );
  });

  it('&rart joins multi-word artists with +', async () => {
    const app = appWithUser();
    const fake = makeFakeMessage({ content: '&rart aphex twin' });
    await byName('rart').run({ app, message: fake.message, args: ['aphex', 'twin'] });
    expect(fake.replies[0]).toBe(
      "`user-user-1's` ratings by `aphex twin`: " +
        'https://rateyourmusic.com/collection/testrym/strm_a,ss.rd.r0.5-5.0,n25/aphex+twin',
    );
  });

  it('&rw posts the wishlist URL', async () => {
    const app = appWithUser();
    const fake = makeFakeMessage({ content: '&rw' });
    await byName('rw').run({ app, message: fake.message, args: [] });
    expect(fake.replies[0]).toBe(
      "`user-user-1's` wishlist: https://rateyourmusic.com/collection/testrym/wishlist,n25",
    );
  });

  it('&wg posts the genre wishlist URL', async () => {
    const app = appWithUser();
    const fake = makeFakeMessage({ content: '&wg jazz' });
    await byName('wg').run({ app, message: fake.message, args: ['jazz'] });
    expect(fake.replies[0]).toBe(
      "`user-user-1's` jazz wishlist: " +
        'https://rateyourmusic.com/collection/testrym/ow,strm_h,ss.dd,n25/jazz',
    );
  });
});

describe('&rn', () => {
  it('requires a numeric argument', async () => {
    const app = appWithUser();
    for (const args of [[], ['abc']]) {
      const fake = makeFakeMessage({ content: '&rn' });
      await byName('rn').run({ app, message: fake.message, args });
      expect(fake.replies[0]).toBe('you must specify a number.');
    }
  });

  it('posts the visual link for the given position', async () => {
    const app = appWithUser();
    const fake = makeFakeMessage({ content: '&rn 42' });
    await byName('rn').run({ app, message: fake.message, args: ['42'] });
    expect(fake.replies[0]).toBe(
      'your #42 rating: https://rateyourmusic.com/collection/testrym/visual,r0.5-5.0,ss.d,n1/42',
    );
  });
});

describe('pref setters', () => {
  it('&rpp persists rymPerPage and confirms', async () => {
    const app = appWithUser();
    const fake = makeFakeMessage({ content: '&rpp 30' });
    await byName('rpp').run({ app, message: fake.message, args: ['30'] });
    expect(fake.replies[0]).toBe('your ratings per page (for rym) has been updated to `30`');
    expect(userRow(app).rymPerPage).toBe(30);
  });

  it('&max persists rymMax and confirms', async () => {
    const app = appWithUser();
    const fake = makeFakeMessage({ content: '&max 1234' });
    await byName('max').run({ app, message: fake.message, args: ['1234'] });
    expect(fake.replies[0]).toBe('your total number of rym ratings has been updated to `1234`.');
    expect(userRow(app).rymMax).toBe(1234);
  });

  it('&max rejects non-positive and non-numeric input', async () => {
    const app = appWithUser({ rymMax: 7 });
    for (const args of [['0'], ['-3'], ['abc'], []]) {
      const fake = makeFakeMessage({ content: '&max' });
      await byName('max').run({ app, message: fake.message, args });
      expect(fake.replies[0]).toBe('the maximum needs to be an integer.');
    }
    expect(userRow(app).rymMax).toBe(7);
  });

  it('&wmax persists wishMax and confirms', async () => {
    const app = appWithUser();
    const fake = makeFakeMessage({ content: '&wmax 55' });
    await byName('wmax').run({ app, message: fake.message, args: ['55'] });
    expect(fake.replies[0]).toBe(
      'the total number of items on your wishlist has been updated to `55`.',
    );
    expect(userRow(app).wishMax).toBe(55);
  });

  it('&tmax persists tagMax and confirms', async () => {
    const app = appWithUser();
    const fake = makeFakeMessage({ content: '&tmax 12' });
    await byName('tmax').run({ app, message: fake.message, args: ['12'] });
    expect(fake.replies[0]).toBe(
      'the total number of items with the relevant tag has been updated to `12`',
    );
    expect(userRow(app).tagMax).toBe(12);
  });

  it('&tset stores the tag joined with + and confirms with spaces', async () => {
    const app = appWithUser();
    const fake = makeFakeMessage({ content: '&tset post rock' });
    await byName('tset').run({ app, message: fake.message, args: ['post', 'rock'] });
    expect(fake.replies[0]).toBe('your tag has been set to `post rock`');
    expect(userRow(app).tag).toBe('post+rock');
  });
});

describe('&chset / &ch', () => {
  it('chset stores the url and ch echoes it', async () => {
    const app = appWithUser();
    const setter = makeFakeMessage({ content: '&chset https://i.example/chart.png' });
    await byName('chset').run({
      app,
      message: setter.message,
      args: ['https://i.example/chart.png'],
    });
    expect(setter.replies[0]).toBe('your chart url has been saved.');
    expect(userRow(app).chartUrl).toBe('https://i.example/chart.png');

    const getter = makeFakeMessage({ content: '&ch' });
    await byName('ch').run({ app, message: getter.message, args: [] });
    expect(getter.replies[0]).toBe('https://i.example/chart.png');
  });

  it('ch reports when no chart is set', async () => {
    const app = appWithUser();
    const fake = makeFakeMessage({ content: '&ch' });
    await byName('ch').run({ app, message: fake.message, args: [] });
    expect(fake.replies[0]).toBe('chart not set');
  });
});

describe('&rand', () => {
  it('requires rymMax to be set', async () => {
    const app = appWithUser({ rymMax: 0 });
    const fake = makeFakeMessage({ content: '&rand' });
    await byName('rand').run({ app, message: fake.message, args: [] });
    expect(fake.replies[0]).toBe(
      'you need to set your number of rym ratings. you can do so with `&max` `#_of_rym_ratings`',
    );
  });

  it('sends a single page of unique links within [1..max]', async () => {
    const app = appWithUser({ rymMax: 10 });
    const fake = makeFakeMessage({ content: '&rand' });
    await byName('rand').run({ app, message: fake.message, args: [] });

    const embed = fake.embeds[0] as EmbedBuilder;
    expect(embed.data.title).toBe('🎲  Rating Randomizer (MAX: 10)  🎲');
    expect(embed.data.footer?.text).toBe('page no. 1/1 | set max with &max #_of_rym_ratings');

    const lines = (embed.data.description ?? '').split('\n');
    expect(lines).toHaveLength(10);
    const picks = lines.map((line) => {
      const m = /^\[Rating No\. (\d+)\]\(https:\/\/rateyourmusic\.com\/collection\/testrym\/r0\.5-5\.0,ss\.d,n1\/(\d+)\)$/.exec(
        line,
      );
      expect(m).not.toBeNull();
      expect(m![1]).toBe(m![2]);
      return parseInt(m![1]!, 10);
    });
    expect(new Set(picks).size).toBe(10);
    for (const p of picks) {
      expect(p).toBeGreaterThanOrEqual(1);
      expect(p).toBeLessThanOrEqual(10);
    }
  });

  it('caps at 100 picks (10 pages) for a large max', async () => {
    const app = appWithUser({ rymMax: 500 });
    const fake = makeFakeMessage({ content: '&rand' });
    const captured = patchChannelSend(fake);
    await byName('rand').run({ app, message: fake.message, args: [] });

    const first = captured[0]!;
    expect(first.data.footer?.text).toBe('page no. 1/10 | set max with &max #_of_rym_ratings');
    expect((first.data.description ?? '').split('\n')).toHaveLength(10);
  });
});

describe('&wrand', () => {
  it('requires wishMax to be set', async () => {
    const app = appWithUser({ wishMax: 0 });
    const fake = makeFakeMessage({ content: '&wrand' });
    await byName('wrand').run({ app, message: fake.message, args: [] });
    expect(fake.replies[0]).toBe(
      'you need to set a wishlist maximum. you can do so with `&wmax` `#_of_items_on_wishlist`',
    );
  });

  it('sends wishlist links within [1..wishMax]', async () => {
    const app = appWithUser({ wishMax: 5 });
    const fake = makeFakeMessage({ content: '&wrand' });
    await byName('wrand').run({ app, message: fake.message, args: [] });

    const embed = fake.embeds[0] as EmbedBuilder;
    expect(embed.data.title).toBe('🎲  Wishlist Randomizer (WMAX: 5)  🎲');
    const lines = (embed.data.description ?? '').split('\n');
    expect(lines).toHaveLength(5);
    for (const line of lines) {
      const m = /^\[Wishlist Item No\. (\d+)\]\(https:\/\/rateyourmusic\.com\/collection\/testrym\/wishlist,n1\/(\d+)\)$/.exec(
        line,
      );
      expect(m).not.toBeNull();
      const p = parseInt(m![1]!, 10);
      expect(p).toBeGreaterThanOrEqual(1);
      expect(p).toBeLessThanOrEqual(5);
    }
  });
});

describe('&trand', () => {
  it('uses the stored tag and picks within [1..tagMax]', async () => {
    const app = appWithUser({ tag: 'post+rock', tagMax: 8 });
    const fake = makeFakeMessage({ content: '&trand' });
    await byName('trand').run({ app, message: fake.message, args: [] });

    const m = /^you got `post rock` item #(\d+): https:\/\/rateyourmusic\.com\/collection\/testrym\/visual,stag_g,n1\/post\+rock\/(\d+)$/.exec(
      fake.replies[0]!,
    );
    expect(m).not.toBeNull();
    expect(m![1]).toBe(m![2]);
    const p = parseInt(m![1]!, 10);
    expect(p).toBeGreaterThanOrEqual(1);
    expect(p).toBeLessThanOrEqual(8);
  });

  it('joins an inline tag argument with +', async () => {
    const app = appWithUser({ tagMax: 1 });
    const fake = makeFakeMessage({ content: '&trand dream pop' });
    await byName('trand').run({ app, message: fake.message, args: ['dream', 'pop'] });
    expect(fake.replies[0]).toBe(
      'you got `dream pop` item #1: ' +
        'https://rateyourmusic.com/collection/testrym/visual,stag_g,n1/dream+pop/1',
    );
  });
});

describe('&srand', () => {
  it('replies with the static random link', async () => {
    const app = makeFakeApp(rymCommands);
    const fake = makeFakeMessage({ content: '&srand' });
    await byName('srand').run({ app, message: fake.message, args: [] });
    expect(fake.replies[0]).toBe('you rolled the dice! http://rateyourmusic.com/misc/random');
  });
});
