// What main has taken of a document the renderer saves as it is edited (a game on the Game screen,
// a scheme in the Editor). The renderer never keeps what main refused: when the latest save is
// refused, the screen goes back to what main took last (or what it opened on, if main took
// nothing). A refusal while a later save is still on its way waits for that one: main takes saves
// in the order they are sent, and each carries the whole document. Pure.

export class Saves<T> {
  private sent = 0;
  private takenAt = 0;

  constructor(private latest: T) {}

  /** What main has now, as far as this screen knows: the newest document it took. */
  get taken(): T {
    return this.latest;
  }

  /** A save is on its way: its number, for `took` and `refused`. */
  send(): number {
    return ++this.sent;
  }

  /** Main took save `n`, of `doc`. */
  took(n: number, doc: T): void {
    if (n <= this.takenAt) return;
    this.takenAt = n;
    this.latest = doc;
  }

  /** Main refused save `n`: what to go back to, or null while a later save may still be taken. */
  refused(n: number): T | null {
    return n === this.sent ? this.latest : null;
  }
}
