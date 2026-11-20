// Serving cover art to the windows over `helm-cover://`, safely. A request names an app id and a
// kind; the file is looked up in what the Steam read returned for that app id. No part of the
// request is ever joined onto a path, so nothing outside that list can be asked for.
// Pure: the file reader arrives as a function. Registering the protocol is in index.ts.

import { COVER_KINDS, COVER_SCHEME } from '../shared/cover';
import type { CoverKind } from '../shared/cover';

/** The files the Steam read returned, per app id. */
export type CoverFiles = ReadonlyMap<string, { portrait?: string; header?: string }>;

export interface CoverTarget {
  appId: string;
  kind: CoverKind;
}

const REQUEST = new RegExp(`^${COVER_SCHEME}://cover/(\\d{1,10})/(${COVER_KINDS.join('|')})$`);

/** The app id and kind a request names, or null for anything that isn't exactly that shape. */
export function parseCoverRequest(url: string): CoverTarget | null {
  const match = REQUEST.exec(url);
  if (!match) return null;
  return { appId: match[1] as string, kind: match[2] as CoverKind };
}

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** The file to serve and its type, or null when the request isn't for a file the list holds. */
export function resolveCover(
  url: string,
  files: CoverFiles,
): { path: string; mime: string } | null {
  const target = parseCoverRequest(url);
  if (!target) return null;
  const path = files.get(target.appId)?.[target.kind];
  if (path === undefined) return null;
  // The list's own paths are checked too: Steam's index names the file, so it is not trusted.
  if (path.split(/[\\/]/).includes('..')) return null;
  const mime = MIME[(/\.([a-z0-9]+)$/i.exec(path)?.[1] ?? '').toLowerCase()];
  return mime === undefined ? null : { path, mime };
}

export type CoverAnswer = { status: 200; mime: string; body: Uint8Array } | { status: 404 };

/** What to answer a request with: the file's bytes, or 404 for everything else. */
export async function answerCover(
  url: string,
  files: CoverFiles,
  readFile: (path: string) => Promise<Uint8Array | undefined>,
): Promise<CoverAnswer> {
  const found = resolveCover(url, files);
  if (!found) return { status: 404 };
  const body = await readFile(found.path).catch(() => undefined);
  return body === undefined ? { status: 404 } : { status: 200, mime: found.mime, body };
}
