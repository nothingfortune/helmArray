// The recent games in the Editor's bar: another game's Editor in one click (J3). Not drawn on the
// canvas; drawn in its bar's style, a muted label and ghost buttons, like *Devices ▾* beside it.
import { useLibrary } from './useLibrary';
import { recentGames } from './recent-games';

export function RecentGames({
  openGameId,
  onOpen,
}: {
  /** The game open in the Editor: never one of its own recent games. */
  openGameId: string;
  /** Opens that game's scheme, the one its Library tile opens. */
  onOpen(schemeId: string): void;
}) {
  const { entries } = useLibrary();
  const games = recentGames(entries ?? [], openGameId);
  if (games.length === 0) return null;
  return (
    <nav className="ed-recent" aria-label="Recent games">
      <span className="ed-recent-label" aria-hidden="true">
        Recent
      </span>
      {games.map((g) => (
        <button
          key={g.gameId}
          type="button"
          className="btn ghost ed-recent-game"
          title={g.name}
          onClick={() => onOpen(g.schemeId)}
        >
          {g.name}
        </button>
      ))}
    </nav>
  );
}
