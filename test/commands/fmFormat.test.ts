import { describe, expect, it } from 'vitest';
import {
  escapeAsterisks,
  fmDescription,
  rankLine,
  rymAlbumSearchUrl,
  rymArtistSearchUrl,
  scrobblesFooter,
} from '../../src/commands/fmFormat.js';

describe('escapeAsterisks', () => {
  it('replaces every * with the literal &ast', () => {
    expect(escapeAsterisks('W*E*I*R*D')).toBe('W&astE&astI&astR&astD');
    expect(escapeAsterisks('plain')).toBe('plain');
  });
});

describe('rym search urls', () => {
  it('builds the legacy artist search url', () => {
    expect(rymArtistSearchUrl('Autechre')).toBe(
      'https://www.google.com/search?q=Autechre%20artist%20songs%20discography%20biography%20site%3Arateyourmusic.com/artist/',
    );
  });

  it('builds the legacy album search url with encoding', () => {
    expect(rymAlbumSearchUrl("The B-52's", 'Wild Planet')).toBe(
      "https://www.google.com/search?q=The%20B-52's%20Wild%20Planet%20release%20reviews%20ratings%20site%3Arateyourmusic.com%2Frelease%2F",
    );
  });
});

describe('fmDescription', () => {
  it('links artist and album with rym search tooltips', () => {
    const desc = fmDescription('Autechre', 'Confield');
    expect(desc).toContain("[**Autechre**]( https://www.google.com/search?q=Autechre");
    expect(desc).toContain("'search rym for Autechre '");
    expect(desc).toContain('[***Confield***](');
    expect(desc).toContain("'search rym for Autechre - Confield'");
  });

  it('uses the literal [no album] when the track has no album', () => {
    expect(fmDescription('Autechre', '')).toContain('[no album]');
  });

  it('escapes asterisks in display names but not in tooltips', () => {
    const desc = fmDescription('A*Teens', 'The ABBA Generation');
    expect(desc).toContain('[**A&astTeens**]');
    expect(desc).toContain("'search rym for A*Teens '");
  });
});

describe('scrobblesFooter', () => {
  it('shows all segments when artist and album have plays', () => {
    expect(scrobblesFooter(1000, 50, 10)).toBe('scrobbles → all: 1000 | artist: 50 | album: 10');
  });

  it('drops the album segment when album plays are zero', () => {
    expect(scrobblesFooter(1000, 50, 0)).toBe('scrobbles → all: 1000 | artist: 50');
    expect(scrobblesFooter(1000, 50, null)).toBe('scrobbles → all: 1000 | artist: 50');
  });

  it('drops artist and album segments when artist plays are zero', () => {
    expect(scrobblesFooter(1000, 0, 10)).toBe('scrobbles → all: 1000');
    expect(scrobblesFooter(1000, null, null)).toBe('scrobbles → all: 1000');
  });
});

describe('rankLine', () => {
  it('joins found ranks with pipes in w/m/y/o order', () => {
    expect(rankLine({ week: 1, month: 2, year: 3, overall: 4 })).toBe(
      '\nalbum ranks → w: #1 | m: #2 | y: #3 | o: #4',
    );
  });

  it('omits missing ranks', () => {
    expect(rankLine({ week: null, month: 5, year: null, overall: 9 })).toBe(
      '\nalbum ranks → m: #5 | o: #9',
    );
  });

  it('uses the legacy singular label when only the overall rank exists', () => {
    expect(rankLine({ week: null, month: null, year: null, overall: 7 })).toBe(
      '\nalbum rank → o: #7',
    );
  });

  it('returns empty when nothing was found', () => {
    expect(rankLine({ week: null, month: null, year: null, overall: null })).toBe('');
  });
});
