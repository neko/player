"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import {
  memo,
  useCallback,
  useLayoutEffect,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { Separator } from "@/components/ui/separator";
import { formatDuration } from "@/lib/format-duration";
import type { NavidromeSong } from "@/lib/navidrome";
import { shuffleArray } from "@/lib/shuffle";

const ROW_HEIGHT = 44;
const COVER_FETCH_SIZE = 256;
const COVER_FULL_SIZE = 1200;

const GRID_COLS = "44px minmax(0, 1fr) auto";

const rowGridStyle = {
  display: "grid",
  gridTemplateColumns: GRID_COLS,
  height: ROW_HEIGHT,
  paddingRight: "0.75rem",
} satisfies CSSProperties;

type TrackTableProps = {
  tracks: NavidromeSong[];
  initialOrderedTracks?: NavidromeSong[];
  selectedTrackId?: string;
  onPlayTrack: (track: NavidromeSong) => void;
  onVisibleTracksChange?: (tracks: NavidromeSong[]) => void;
  onOrderedTracksChange?: (tracks: NavidromeSong[]) => void;
};

function filterTracks(tracks: NavidromeSong[], query: string): NavidromeSong[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return tracks;

  return tracks.filter((track) => {
    const haystack = `${track.title} ${track.artist}`.toLowerCase();
    return haystack.includes(normalized);
  });
}

function getCoverUrl(coverArtId: string, size: number) {
  return `/api/cover/${encodeURIComponent(coverArtId)}?size=${size}`;
}

const TrackRow = memo(function TrackRow({
  index,
  isSelected,
  onPlayTrack,
  track,
}: {
  index: number;
  isSelected: boolean;
  onPlayTrack: (track: NavidromeSong) => void;
  track: NavidromeSong;
}) {
  const coverSrc = track.coverArt
    ? getCoverUrl(track.coverArt, COVER_FETCH_SIZE)
    : null;
  const coverFullSrc = track.coverArt
    ? getCoverUrl(track.coverArt, COVER_FULL_SIZE)
    : null;

  return (
    <div
      aria-current={isSelected ? "true" : undefined}
      className="track-row box-border w-full cursor-pointer border-b border-white/[0.04]"
      data-row-parity={index % 2 === 0 ? "even" : "odd"}
      data-selected={isSelected ? "true" : undefined}
      onClick={() => onPlayTrack(track)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onPlayTrack(track);
      }}
      role="button"
      style={rowGridStyle}
      tabIndex={0}
    >
      <div className="h-full overflow-hidden bg-muted">
        {coverSrc && coverFullSrc ? (
          <button
            type="button"
            aria-label={`open cover for ${track.title}`}
            data-haptic="expand"
            className="block size-full cursor-pointer border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            onClick={(event) => {
              event.stopPropagation();
              window.open(coverFullSrc, "_blank", "noopener,noreferrer");
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={coverSrc}
              alt=""
              width={ROW_HEIGHT}
              height={ROW_HEIGHT}
              loading="lazy"
              decoding="async"
              draggable={false}
              className="pointer-events-none block size-full object-cover"
            />
          </button>
        ) : null}
      </div>

      <div className="flex h-full min-w-0 flex-col justify-center gap-0.5 py-1 pl-2 select-none">
        <p className="truncate text-sm font-medium leading-snug text-foreground">
          {track.title}
        </p>
        <p className="truncate text-xs leading-snug text-muted-foreground">
          {track.artist}
        </p>
      </div>

      <div className="flex h-full items-center justify-end gap-4 text-xs tabular-nums text-muted-foreground select-none">
        <span className="min-w-[2.25rem] text-right">
          {formatDuration(track.duration)}
        </span>
        <span className="min-w-[2.25rem] text-right">{track.year ?? "????"}</span>
      </div>
    </div>
  );
});

export function TrackTable({
  onPlayTrack,
  selectedTrackId,
  tracks,
  initialOrderedTracks,
  onVisibleTracksChange,
  onOrderedTracksChange,
}: TrackTableProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const hasAppliedInitialOrderRef = useRef(false);
  const [orderedTracks, setOrderedTracks] = useState<NavidromeSong[]>(() => {
    if (initialOrderedTracks?.length) {
      const byId = new Map(tracks.map((track) => [track.id, track] as const));
      const used = new Set<string>();
      const ordered = initialOrderedTracks
        .map((track) => byId.get(track.id))
        .filter((track): track is NavidromeSong => {
          if (!track) return false;
          if (used.has(track.id)) return false;
          used.add(track.id);
          return true;
        });
      const rest = tracks.filter((track) => !used.has(track.id));
      hasAppliedInitialOrderRef.current = true;
      return [...ordered, ...rest];
    }
    return shuffleArray(tracks);
  });
  const [searchQuery, setSearchQuery] = useState("");
  const setScrollRoot = useCallback((node: HTMLDivElement | null) => {
    scrollerRef.current = node;
  }, []);
  const handlePlayTrack = useCallback(
    (track: NavidromeSong) => onPlayTrack(track),
    [onPlayTrack],
  );

  const visibleTracks = useMemo(
    () => filterTracks(orderedTracks, searchQuery),
    [orderedTracks, searchQuery],
  );

  useEffect(() => {
    if (!onVisibleTracksChange) return;
    onVisibleTracksChange(visibleTracks);
  }, [onVisibleTracksChange, visibleTracks]);

  useEffect(() => {
    if (!onOrderedTracksChange) return;
    onOrderedTracksChange(orderedTracks);
  }, [onOrderedTracksChange, orderedTracks]);

  // eslint-disable-next-line react-hooks/incompatible-library -- tanstack virtual returns non-memoizable functions by design
  const virtualizer = useVirtualizer({
    count: visibleTracks.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 6,
  });

  const virtualItems = virtualizer.getVirtualItems();

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const maxScroll = scroller.scrollHeight - scroller.clientHeight;
    if (scroller.scrollTop > maxScroll) {
      scroller.scrollTo({ top: Math.max(0, maxScroll) });
    }
  }, [visibleTracks.length, searchQuery]);

  function handleShuffle() {
    setOrderedTracks((current) => shuffleArray(current));
  }

  useEffect(() => {
    if (hasAppliedInitialOrderRef.current) return;
    if (!initialOrderedTracks?.length) return;

    hasAppliedInitialOrderRef.current = true;
    setOrderedTracks((current) => {
      const byId = new Map(initialOrderedTracks.map((track) => [track.id, track] as const));
      const used = new Set<string>();
      const merged = tracks
        .map((track) => byId.get(track.id))
        .filter((track): track is NavidromeSong => {
          if (!track) return false;
          if (used.has(track.id)) return false;
          used.add(track.id);
          return true;
        });

      const fallback = shuffleArray(current);
      const missing = fallback.filter((track) => !used.has(track.id));
      return [...merged, ...missing];
    });
  }, [initialOrderedTracks, tracks]);

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <div
        className="z-10 box-border flex w-full shrink-0 items-stretch border-b border-white/10 bg-neutral-950 shadow-[0_1px_0_rgba(255,255,255,0.04)]"
        style={{ height: ROW_HEIGHT }}
      >
        <button
          type="button"
          data-haptic="select"
          onClick={handleShuffle}
          className="flex shrink-0 items-center px-2 text-sm text-foreground outline-none select-none hover:bg-white/[0.06] hover:text-foreground/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          shuffle
        </button>

        <Separator orientation="vertical" />

        <input
          type="search"
          spellCheck={false}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="search"
          aria-label="search tracks"
          className="h-full min-w-0 flex-1 overflow-hidden bg-transparent px-2 text-sm text-muted-foreground/80 caret-muted-foreground outline-none placeholder:text-muted-foreground/70 focus:text-foreground [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none [&::-webkit-search-results-button]:appearance-none [&::-webkit-search-results-decoration]:appearance-none"
        />
      </div>

      <div
        ref={setScrollRoot}
        className="hide-scrollbar min-h-0 w-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-neutral-950"
      >
        {visibleTracks.length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted-foreground select-none">
            no matches.
          </p>
        ) : (
          <div
            className="relative w-full overflow-hidden"
            style={{ height: visibleTracks.length * ROW_HEIGHT }}
          >
            {virtualItems.map((virtualItem) => (
              <div
                key={visibleTracks[virtualItem.index].id}
                className="absolute top-0 left-0 w-full"
                style={{
                  height: ROW_HEIGHT,
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                <TrackRow
                  index={virtualItem.index}
                  isSelected={
                    visibleTracks[virtualItem.index].id === selectedTrackId
                  }
                  onPlayTrack={handlePlayTrack}
                  track={visibleTracks[virtualItem.index]}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
