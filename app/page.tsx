import { PlayerSurface } from "@/components/player-surface";
import { fetchNavidromeSongs, type NavidromeSong } from "@/lib/navidrome";

export default async function Home() {
  let tracks: NavidromeSong[] = [];
  let error: string | null = null;

  try {
    tracks = await fetchNavidromeSongs();
  } catch (err) {
    error = err instanceof Error ? err.message : "failed to load tracks";
  }

  return (
    <main className="h-screen w-full overflow-hidden">
      {error ? (
        <p className="px-4 py-4 text-sm text-destructive">{error}</p>
      ) : null}

      {!error && tracks.length > 0 ? <PlayerSurface tracks={tracks} /> : null}

      {!error && tracks.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">no tracks found.</p>
      ) : null}
    </main>
  );
}
