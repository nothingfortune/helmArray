// How a window asks for a game's cover art: `helm-cover://cover/<appId>/portrait` or `.../header`.
// The app id is in the path, never the host: under a standard scheme a number as the host is
// read as an IPv4 address and rewritten. Main answers only for what its Steam read returned.

export const COVER_SCHEME = 'helm-cover';
export const COVER_KINDS = ['portrait', 'header'] as const;
export type CoverKind = (typeof COVER_KINDS)[number];

export function coverUrl(appId: string, kind: CoverKind): string {
  return `${COVER_SCHEME}://cover/${appId}/${kind}`;
}
