import { describe, expect, it } from 'vitest';
import { coverUrl } from '../shared/cover';
import { answerCover, parseCoverRequest, resolveCover } from './cover-protocol';
import type { CoverFiles } from './cover-protocol';

const DIR = 'c:/program files (x86)/steam/appcache/librarycache';
const FILES: CoverFiles = new Map([
  ['553850', { portrait: `${DIR}/553850/library_600x900.jpg`, header: `${DIR}/553850/header.JPG` }],
  ['620', { portrait: `${DIR}/620/abc/library_capsule.png` }],
  ['7', { portrait: `${DIR}/7/../../../secret.jpg` }],
  ['8', { portrait: `${DIR}/8/notes.txt` }],
]);

describe('the cover request', () => {
  it('reads what coverUrl writes', () => {
    expect(parseCoverRequest(coverUrl('553850', 'portrait'))).toEqual({
      appId: '553850',
      kind: 'portrait',
    });
    expect(parseCoverRequest(coverUrl('620', 'header'))).toEqual({ appId: '620', kind: 'header' });
  });

  it.each([
    'helm-cover://cover/553850/icon',
    'helm-cover://cover/553850/',
    'helm-cover://cover/553850',
    'helm-cover://cover/../portrait',
    'helm-cover://cover/553850/../portrait',
    'helm-cover://cover/553850/..%2f..%2fsecret/portrait',
    'helm-cover://cover/553850/portrait/extra',
    'helm-cover://cover/553850/portrait?x=1',
    'helm-cover://cover/553850/portrait#top',
    'helm-cover://cover/55 3850/portrait',
    'helm-cover://cover/-1/portrait',
    'helm-cover://cover/12345678901/portrait',
    'helm-cover://cover/C:/Windows/win.ini',
    'helm-cover://cover/C:\\Windows\\win.ini',
    'helm-cover://cover//etc/passwd',
    'helm-cover://other/553850/portrait',
    'helm-cover://553850/portrait',
    'file:///c:/Windows/win.ini',
    'https://example.com/553850/portrait',
    'helm-cover://cover/553850/Portrait',
    '',
  ])('refuses %s', (url) => {
    expect(parseCoverRequest(url)).toBeNull();
    expect(resolveCover(url, FILES)).toBeNull();
  });
});

describe('which file a request gets', () => {
  it("gives a game's portrait and header from the list, with their types", () => {
    expect(resolveCover(coverUrl('553850', 'portrait'), FILES)).toEqual({
      path: `${DIR}/553850/library_600x900.jpg`,
      mime: 'image/jpeg',
    });
    expect(resolveCover(coverUrl('553850', 'header'), FILES)).toEqual({
      path: `${DIR}/553850/header.JPG`,
      mime: 'image/jpeg',
    });
    expect(resolveCover(coverUrl('620', 'portrait'), FILES)?.mime).toBe('image/png');
  });

  it('never gives one game the files of another', () => {
    expect(resolveCover(coverUrl('620', 'header'), FILES)).toBeNull();
    expect(resolveCover(coverUrl('999', 'portrait'), FILES)).toBeNull();
  });

  it('refuses a listed path that climbs out of its folder, or is not a picture', () => {
    expect(resolveCover(coverUrl('7', 'portrait'), FILES)).toBeNull();
    expect(resolveCover(coverUrl('8', 'portrait'), FILES)).toBeNull();
  });

  it('refuses everything when the list is empty', () => {
    expect(resolveCover(coverUrl('553850', 'portrait'), new Map())).toBeNull();
  });
});

describe('the answer', () => {
  it('reads only the listed file and sends its bytes', async () => {
    const read: string[] = [];
    const answer = await answerCover(coverUrl('553850', 'portrait'), FILES, (path) => {
      read.push(path);
      return Promise.resolve(Uint8Array.of(1, 2, 3));
    });
    expect(answer).toEqual({ status: 200, mime: 'image/jpeg', body: Uint8Array.of(1, 2, 3) });
    expect(read).toEqual([`${DIR}/553850/library_600x900.jpg`]);
  });

  it('answers 404 without reading anything for a request that is refused', async () => {
    const read: string[] = [];
    const reader = (path: string) => {
      read.push(path);
      return Promise.resolve(Uint8Array.of(1));
    };
    for (const url of ['helm-cover://cover/553850/../x', coverUrl('999', 'portrait')])
      expect(await answerCover(url, FILES, reader)).toEqual({ status: 404 });
    expect(read).toEqual([]);
  });

  it('answers 404 when the file has gone or cannot be read', async () => {
    const url = coverUrl('553850', 'portrait');
    expect(await answerCover(url, FILES, () => Promise.resolve(undefined))).toEqual({
      status: 404,
    });
    expect(await answerCover(url, FILES, () => Promise.reject(new Error('EACCES')))).toEqual({
      status: 404,
    });
  });
});
