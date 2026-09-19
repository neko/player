"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AudioPlayer } from "@/components/audio-player";
import { TrackTable } from "@/components/track-table";
import type { NavidromeSong } from "@/lib/navidrome";

const VOLUME_KEY = "player:volume";
const DEFAULT_VOLUME = 0.03;
const PLAYBACK_STATE_KEY = "player:state";
const TRACK_POSITIONS_KEY = "player:trackPositions";
const ORDER_KEY = "player:orderedTrackIds";

type PlayerSurfaceProps = {
  tracks: NavidromeSong[];
};

type PlaybackState = {
  isPlaying?: boolean;
  currentTrackId?: string | null;
};

function readNumber(key: string, fallback: number) {
  if (typeof window === "undefined") return fallback;
  const raw = localStorage.getItem(key);
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readPlaybackState() {
  if (typeof window === "undefined") return {} as PlaybackState;

  try {
    const raw = localStorage.getItem(PLAYBACK_STATE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as PlaybackState;
  } catch {
    return {};
  }
}

function savePlaybackState(state: PlaybackState) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PLAYBACK_STATE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage write failures
  }
}

export function PlayerSurface({ tracks }: PlayerSurfaceProps) {
  const initialOrderedIds = (() => {
    if (typeof window === "undefined") return [] as string[];
    const raw = localStorage.getItem(ORDER_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : [];
    } catch {
      return [];
    }
  })();

  const currentTrackRef = useRef<NavidromeSong | null>(null);
  const hasHydratedRef = useRef(false);

  const [currentTrack, setCurrentTrack] = useState<NavidromeSong | null>(null);
  const [volume, setVolume] = useState(() => {
    const persisted = readNumber(VOLUME_KEY, DEFAULT_VOLUME);
    return Math.min(1, Math.max(0, persisted));
  });
  const [orderedTrackIds, setOrderedTrackIds] = useState<string[]>(() => {
    const byId = new Set(tracks.map((track) => track.id));
    const merged = initialOrderedIds.filter((id) => byId.has(id));
    const remaining = tracks.filter((track) => !merged.includes(track.id)).map((track) => track.id);
    return merged.length > 0 ? [...merged, ...remaining] : tracks.map((track) => track.id);
  });
  const [isPlayingByDefault, setIsPlayingByDefault] = useState(
    () => readPlaybackState().isPlaying ?? false,
  );
  const [activeTracks, setActiveTracks] = useState<NavidromeSong[]>(tracks);

  useEffect(() => {
    try {
      localStorage.removeItem(TRACK_POSITIONS_KEY);
    } catch {
      // ignore storage write failures
    }
  }, []);

  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack]);

  useEffect(() => {
    if (hasHydratedRef.current) return;
    hasHydratedRef.current = true;

    const { currentTrackId, isPlaying } = readPlaybackState();
    if (!currentTrackId) return;

    const track = tracks.find((item) => item.id === currentTrackId);
    if (!track) return;

    const timer = window.setTimeout(() => {
      setCurrentTrack(track);
      setIsPlayingByDefault(isPlaying ?? false);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [tracks]);

  const persistedOrderedTracks = useMemo(() => {
    const byId = new Map(tracks.map((track) => [track.id, track] as const));
    const used = new Set<string>();
    const ordered = orderedTrackIds
      .map((id) => byId.get(id))
      .filter((track): track is NavidromeSong => {
        if (!track) return false;
        used.add(track.id);
        return true;
      });
    const missing = tracks.filter((track) => !used.has(track.id));
    return [...ordered, ...missing];
  }, [orderedTrackIds, tracks]);

  const currentIndex = useMemo(() => {
    if (!currentTrack) return -1;
    return activeTracks.findIndex((track) => track.id === currentTrack.id);
  }, [currentTrack, activeTracks]);

  const selectTrack = useCallback((track: NavidromeSong, playing: boolean) => {
    setCurrentTrack(track);
    setIsPlayingByDefault(playing);
    savePlaybackState({ currentTrackId: track.id, isPlaying: playing });
  }, []);

  const playTrack = useCallback(
    (track: NavidromeSong) => {
      selectTrack(track, true);
    },
    [selectTrack],
  );

  const getTrackByOffset = useCallback(
    (offset: number) => {
      if (activeTracks.length === 0) return;
      const baseIndex = currentIndex >= 0 ? currentIndex : 0;
      const nextIndex =
        (baseIndex + offset + activeTracks.length) % activeTracks.length;
      return activeTracks[nextIndex];
    },
    [activeTracks, currentIndex],
  );

  const playByOffset = useCallback(
    (offset: number, playing = isPlayingByDefault) => {
      const track = getTrackByOffset(offset);
      if (!track) return;
      selectTrack(track, playing);
    },
    [getTrackByOffset, isPlayingByDefault, selectTrack],
  );

  const handleOrderedTracksChange = useCallback((tracks: NavidromeSong[]) => {
    const nextIds = tracks.map((track) => track.id);
    setOrderedTrackIds(nextIds);
    try {
      localStorage.setItem(ORDER_KEY, JSON.stringify(nextIds));
    } catch {
      // ignore storage write failures
    }
  }, []);

  const handlePlaybackStateChange = useCallback(
    (playing: boolean) => {
      setIsPlayingByDefault(playing);
      savePlaybackState({
        currentTrackId: currentTrackRef.current?.id ?? null,
        isPlaying: playing,
      });
    },
    [],
  );

  const handleVolumeChange = useCallback((next: number) => {
    setVolume(next);
    try {
      localStorage.setItem(VOLUME_KEY, String(next));
    } catch {
      // ignore storage write failures
    }
  }, []);

  return (
    <div className="flex h-screen min-h-0 w-full flex-col overflow-hidden">
      <div className="min-h-0 w-full flex-1">
        <TrackTable
          tracks={tracks}
          initialOrderedTracks={persistedOrderedTracks}
          selectedTrackId={currentTrack?.id}
          onPlayTrack={playTrack}
          onOrderedTracksChange={handleOrderedTracksChange}
          onVisibleTracksChange={setActiveTracks}
        />
      </div>

      <AudioPlayer
        className="sticky bottom-0 left-0 right-0"
        currentTrack={currentTrack}
        isPlayingByDefault={isPlayingByDefault}
        initialVolume={volume}
        initialPosition={0}
        preloadTrack={getTrackByOffset(1)}
        onNext={(playing) => playByOffset(1, playing)}
        onPrevious={(playing) => playByOffset(-1, playing)}
        onVolumeChange={handleVolumeChange}
        onPlaybackStateChange={handlePlaybackStateChange}
      />
    </div>
  );
}
