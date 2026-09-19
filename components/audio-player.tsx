"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import Image from "next/image";

import { Separator } from "@/components/ui/separator";
import { formatDuration } from "@/lib/format-duration";
import { cn } from "@/lib/utils";
import type { NavidromeSong } from "@/lib/navidrome";

type AudioPlayerProps = {
  className?: string;
  currentTrack: NavidromeSong | null;
  initialPosition?: number;
  initialVolume?: number;
  isPlayingByDefault?: boolean;
  preloadTrack?: NavidromeSong | null;
  onNext: (playing?: boolean) => void;
  onPrevious: (playing?: boolean) => void;
  onPlaybackStateChange?: (isPlaying: boolean) => void;
  onPositionChange?: (position: number) => void;
  onVolumeChange?: (volume: number) => void;
};

function streamUrl(trackId: string) {
  return `/api/stream/${encodeURIComponent(trackId)}`;
}

const COVER_FETCH_SIZE = 44;
const DEFAULT_VOLUME = 0.03;
const PREVIOUS_TRACK_SECONDS = 5;
const POSITION_NOTIFY_MS = 350;

function getCoverUrl(coverArtId: string) {
  return `/api/cover/${encodeURIComponent(coverArtId)}?size=${COVER_FETCH_SIZE}`;
}

export function AudioPlayer({
  className,
  currentTrack,
  initialPosition = 0,
  initialVolume = DEFAULT_VOLUME,
  isPlayingByDefault = false,
  preloadTrack,
  onNext,
  onPrevious,
  onPlaybackStateChange,
  onPositionChange,
  onVolumeChange,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const preloadAudioRef = useRef<HTMLAudioElement>(null);
  const visualizerRef = useRef<HTMLCanvasElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const volumeRef = useRef<HTMLInputElement>(null);
  const elapsedRef = useRef<HTMLSpanElement>(null);
  const volumeLabelRef = useRef<HTMLSpanElement>(null);
  const timelineFrameRef = useRef<number | null>(null);
  const visualizerFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const frequencyDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const visualizerValuesRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const timelinePositionRef = useRef(0);
  const durationRef = useRef(0);
  const lastPositionNotifyRef = useRef(0);
  const preloadTimerRef = useRef<number | null>(null);
  const stateTimerRef = useRef<number | null>(null);
  const isSeekingRef = useRef(false);
  const activeSeekPointerRef = useRef<number | null>(null);
  const seekWasPlayingRef = useRef(false);
  const isPlayingRef = useRef(isPlayingByDefault);
  const [isPlaying, setIsPlaying] = useState(isPlayingByDefault);
  const [volume, setVolume] = useState(() => {
    const normalized = Number.isFinite(initialVolume) ? initialVolume : DEFAULT_VOLUME;
    return Math.min(1, Math.max(0, normalized));
  });
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const hasRestoredPositionRef = useRef(false);

  const trackTitle = useMemo(
    () => currentTrack?.title ?? "no track selected",
    [currentTrack],
  );
  const trackArtist = useMemo(
    () => currentTrack?.artist ?? "click a track",
    [currentTrack],
  );
  const coverSrc = currentTrack?.coverArt ? getCoverUrl(currentTrack.coverArt) : null;

  const hasSyncedVolumeRef = useRef(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    if (!hasSyncedVolumeRef.current) {
      hasSyncedVolumeRef.current = true;
      return;
    }
    onVolumeChange?.(volume);
  }, [onVolumeChange, volume]);

  const totalSeconds = useMemo(
    () => Math.max(0, Math.floor(duration || (currentTrack?.duration ?? 0))),
    [currentTrack, duration],
  );
  const elapsedSeconds = useMemo(() => Math.floor(position), [position]);
  const progressPercent = useMemo(() => {
    if (!totalSeconds) return 0;
    return Math.min(100, Math.max(0, (position / totalSeconds) * 100));
  }, [position, totalSeconds]);
  const volumePercent = useMemo(() => Math.round(volume * 100), [volume]);

  const paintTimeline = useCallback((next: number, nextTotal = totalSeconds) => {
    const max = Math.max(0, nextTotal);
    const safe = Number.isFinite(next) ? Math.max(0, Math.min(next, max || next)) : 0;
    const percent = max > 0 ? Math.min(100, Math.max(0, (safe / max) * 100)) : 0;
    const timeline = timelineRef.current;

    durationRef.current = max;
    timelinePositionRef.current = safe;

    if (timeline) {
      timeline.style.setProperty("--player-progress", `${percent}%`);
      timeline.style.setProperty("--player-progress-scale", String(percent / 100));
    }

    if (elapsedRef.current) {
      elapsedRef.current.textContent = formatDuration(Math.floor(safe));
    }
  }, [totalSeconds]);

  const paintVolume = useCallback((next: number) => {
    const safe = Number.isFinite(next) ? Math.max(0, Math.min(1, next)) : DEFAULT_VOLUME;
    const percent = Math.round(safe * 100);

    volumeRef.current?.style.setProperty("--player-slider-value", `${percent}%`);
    if (volumeRef.current) {
      volumeRef.current.value = String(percent);
    }
    if (volumeLabelRef.current) {
      volumeLabelRef.current.textContent = String(percent);
    }
  }, []);

  const notifyPosition = useCallback((next: number, force = false) => {
    const now = performance.now();
    if (!force && now - lastPositionNotifyRef.current < POSITION_NOTIFY_MS) return;

    lastPositionNotifyRef.current = now;
    setPosition(next);
    onPositionChange?.(next);
  }, [onPositionChange]);

  const deferState = useCallback((update: () => void) => {
    if (stateTimerRef.current !== null) {
      window.clearTimeout(stateTimerRef.current);
    }

    stateTimerRef.current = window.setTimeout(() => {
      stateTimerRef.current = null;
      update();
    }, 0);
  }, []);

  const stopTimelineFrame = useCallback(() => {
    if (timelineFrameRef.current === null) return;
    cancelAnimationFrame(timelineFrameRef.current);
    timelineFrameRef.current = null;
  }, []);

  const paintIdleVisualizer = useCallback(() => {
    const canvas = visualizerRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const ratio = window.devicePixelRatio || 1;
    if (!context || width <= 0 || height <= 0) return;

    const pixelWidth = Math.max(1, Math.floor(width * ratio));
    const pixelHeight = Math.max(1, Math.floor(height * ratio));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.beginPath();
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 1.25;
    context.strokeStyle = "rgba(255,255,255,0.14)";

    const points = Math.max(48, Math.floor(width / 5));
    for (let index = 0; index < points; index += 1) {
      const ratioX = points <= 1 ? 0 : index / (points - 1);
      const x = ratioX * width;
      const envelope = Math.sin(ratioX * Math.PI);
      const ripple = (Math.sin(ratioX * Math.PI * 14) + 1) * 0.5;
      const y = height - (0.08 + envelope * (0.5 + ripple * 0.36)) * height;
      if (index === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    }
    context.stroke();
  }, []);

  const stopVisualizerFrame = useCallback(() => {
    if (visualizerFrameRef.current === null) return;
    cancelAnimationFrame(visualizerFrameRef.current);
    visualizerFrameRef.current = null;
  }, []);

  const ensureAnalyser = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return null;

    const AudioContextConstructor =
      window.AudioContext ||
      (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextConstructor) return null;

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextConstructor();
    }

    const context = audioContextRef.current;
    if (!analyserRef.current) {
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.72;
      analyserRef.current = analyser;
      frequencyDataRef.current = new Uint8Array(analyser.frequencyBinCount);
    }

    if (!sourceRef.current) {
      sourceRef.current = context.createMediaElementSource(audio);
      sourceRef.current.connect(analyserRef.current);
      analyserRef.current.connect(context.destination);
    }

    return analyserRef.current;
  }, []);

  const startVisualizerFrame = useCallback(() => {
    stopVisualizerFrame();

    const analyser = ensureAnalyser();
    const data = frequencyDataRef.current;
    const canvas = visualizerRef.current;
    const audio = audioRef.current;
    if (!analyser || !data || !canvas || !audio) return;

    void audioContextRef.current?.resume();

    const draw = () => {
      const context = canvas.getContext("2d");
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const ratio = window.devicePixelRatio || 1;

      if (!context || width <= 0 || height <= 0) {
        visualizerFrameRef.current = requestAnimationFrame(draw);
        return;
      }

      const pixelWidth = Math.max(1, Math.floor(width * ratio));
      const pixelHeight = Math.max(1, Math.floor(height * ratio));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }

      analyser.getByteFrequencyData(data);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      const points = Math.min(180, Math.max(72, Math.floor(width / 4)));
      if (!visualizerValuesRef.current || visualizerValuesRef.current.length !== points) {
        visualizerValuesRef.current = new Float32Array(points);
      }

      const raw = new Float32Array(points);
      const curve = 1.34;
      const maxBin = data.length - 1;

      for (let index = 0; index < points; index += 1) {
        const startRatio = (index / points) ** curve;
        const endRatio = ((index + 1) / points) ** curve;
        const start = Math.min(maxBin, Math.floor(startRatio * maxBin));
        const end = Math.max(start + 1, Math.min(data.length, Math.ceil(endRatio * maxBin)));
        let total = 0;
        let peak = 0;

        for (let sample = start; sample < end; sample += 1) {
          const value = data[sample] ?? 0;
          total += value;
          if (value > peak) peak = value;
        }

        const avg = total / Math.max(1, end - start);
        const position = index / Math.max(1, points - 1);
        const bassTame = 0.58 + position * 0.42;
        const presenceLift = 0.9 + Math.sin(position * Math.PI) * 0.32 + position * 0.12;
        raw[index] = (((avg * 0.72 + peak * 0.28) / 255) ** 0.78) * bassTame * presenceLift;
      }

      const values = visualizerValuesRef.current;
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;

      for (let index = 0; index < points; index += 1) {
        const left = raw[Math.max(0, index - 1)] ?? 0;
        const center = raw[index] ?? 0;
        const right = raw[Math.min(points - 1, index + 1)] ?? 0;
        const spatial = left * 0.18 + center * 0.64 + right * 0.18;
        const previous = values[index] ?? spatial;
        const smoothed = previous * 0.58 + spatial * 0.42;
        values[index] = smoothed;
        if (smoothed < min) min = smoothed;
        if (smoothed > max) max = smoothed;
      }

      const range = max - min;

      context.beginPath();
      context.lineCap = "round";
      context.lineJoin = "round";
      context.lineWidth = 1.5;
      context.strokeStyle = "rgba(255,255,255,0.82)";

      const fallbackPhase = performance.now() / 180;
      for (let index = 0; index < points; index += 1) {
        const ratioX = points <= 1 ? 0 : index / (points - 1);
        const normalized =
          range > 0.01
            ? ((values[index] ?? min) - min) / range
            : (Math.sin(ratioX * Math.PI * 10 + fallbackPhase) + 1) * 0.5;
        const x = ratioX * width;
        const y = height - Math.min(1, Math.max(0, normalized)) * height;
        if (index === 0) {
          context.moveTo(x, y);
        } else if (index < points - 1) {
          const controlX = x;
          const controlY = y;
          const nextIndex = index + 1;
          const nextX = (nextIndex / (points - 1)) * width;
          const nextNormalized =
            range > 0.01
              ? ((values[nextIndex] ?? min) - min) / range
              : (Math.sin((nextIndex / (points - 1)) * Math.PI * 10 + fallbackPhase) + 1) * 0.5;
          const nextY = height - Math.min(1, Math.max(0, nextNormalized)) * height;
          context.quadraticCurveTo(controlX, controlY, (controlX + nextX) * 0.5, (controlY + nextY) * 0.5);
        } else {
          context.lineTo(x, y);
        }
      }
      context.stroke();

      if (audio.paused || audio.ended) {
        visualizerFrameRef.current = null;
        return;
      }

      visualizerFrameRef.current = requestAnimationFrame(draw);
    };

    visualizerFrameRef.current = requestAnimationFrame(draw);
  }, [ensureAnalyser, stopVisualizerFrame]);

  const startTimelineFrame = useCallback(() => {
    stopTimelineFrame();

    const tick = () => {
      const audio = audioRef.current;
      if (!audio || audio.paused || audio.ended) {
        timelineFrameRef.current = null;
        return;
      }

      if (!isSeekingRef.current) {
        const safe = Math.max(0, audio.currentTime || 0);
        paintTimeline(safe);
        notifyPosition(safe);
      }

      timelineFrameRef.current = requestAnimationFrame(tick);
    };

    timelineFrameRef.current = requestAnimationFrame(tick);
  }, [notifyPosition, paintTimeline, stopTimelineFrame]);

  const togglePlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;

    if (audio.paused) {
      setError(null);
      try {
        await audio.play();
      } catch {
        setIsPlaying(false);
        setError("playback blocked.");
      }
      return;
    }

    audio.pause();
  }, [currentTrack]);

  const loadedTrackIdRef = useRef<string | null>(null);
  const resumeAtRef = useRef(0);

  const restorePlaybackPosition = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    const startAt = resumeAtRef.current;
    if (!Number.isFinite(startAt) || startAt <= 0) return;
    if (hasRestoredPositionRef.current) return;

    const max = Number.isFinite(audio.duration) ? audio.duration : startAt;
    const next = Math.min(Math.max(0, startAt), max);
    audio.currentTime = next;
    paintTimeline(next);
    notifyPosition(next, true);
    hasRestoredPositionRef.current = true;
  }, [currentTrack, notifyPosition, paintTimeline]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!currentTrack) {
      loadedTrackIdRef.current = null;
      resumeAtRef.current = 0;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      stopTimelineFrame();
      stopVisualizerFrame();
      paintTimeline(0, 0);
      paintIdleVisualizer();
      deferState(() => {
        setIsPlaying(false);
        setError(null);
        setPosition(0);
      });
      hasRestoredPositionRef.current = false;
      return;
    }

    if (loadedTrackIdRef.current === currentTrack.id) {
      return;
    }
    loadedTrackIdRef.current = currentTrack.id;

    audio.src = streamUrl(currentTrack.id);
    audio.load();
    setError(null);
    const startAt =
      Number.isFinite(initialPosition) && initialPosition > 0 ? initialPosition : 0;
    resumeAtRef.current = startAt;
    paintTimeline(startAt, currentTrack.duration);
    deferState(() => {
      setError(null);
      setPosition(startAt);
      if (!isPlayingByDefault) {
        setIsPlaying(false);
      }
    });
    hasRestoredPositionRef.current = false;

    if (isPlayingByDefault) {
      void audio
        .play()
        .then(() => {
          setIsPlaying(true);
          onPlaybackStateChange?.(true);
        })
        .catch(() => {
          setIsPlaying(false);
          onPlaybackStateChange?.(false);
          setError("press play to start.");
        });
    } else {
      stopTimelineFrame();
      stopVisualizerFrame();
      paintIdleVisualizer();
    }
  }, [
    currentTrack,
    deferState,
    initialPosition,
    isPlayingByDefault,
    onPlaybackStateChange,
    paintIdleVisualizer,
    paintTimeline,
    stopVisualizerFrame,
    stopTimelineFrame,
  ]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    restorePlaybackPosition();
  }, [currentTrack?.id, restorePlaybackPosition]);

  useEffect(() => {
    document.title = currentTrack
      ? `${currentTrack.title} - ${currentTrack.artist}`
      : "player";
  }, [currentTrack]);

  useEffect(() => {
    const audio = preloadAudioRef.current;
    if (!audio) return;

    if (preloadTimerRef.current !== null) {
      window.clearTimeout(preloadTimerRef.current);
      preloadTimerRef.current = null;
    }

    if (!preloadTrack || preloadTrack.id === currentTrack?.id) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      return;
    }

    preloadTimerRef.current = window.setTimeout(() => {
      audio.src = streamUrl(preloadTrack.id);
      audio.load();
      preloadTimerRef.current = null;
    }, 120);

    return () => {
      if (preloadTimerRef.current !== null) {
        window.clearTimeout(preloadTimerRef.current);
        preloadTimerRef.current = null;
      }
    };
  }, [currentTrack?.id, preloadTrack]);

  const handleKeydown = useCallback(
    (event: KeyboardEvent) => {
      if (!currentTrack) return;

      const target = event.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase();
      const isTypingTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable ||
        tag === "input" ||
        tag === "textarea";
      if (isTypingTarget) return;

      if (event.code === "Space") {
        event.preventDefault();
        void togglePlay();
        return;
      }

      if (event.code === "ArrowLeft") {
        event.preventDefault();
        const audio = audioRef.current;
        if (audio && audio.currentTime > PREVIOUS_TRACK_SECONDS) {
          audio.currentTime = 0;
          paintTimeline(0);
          notifyPosition(0, true);
          return;
        }
        onPrevious(audio ? !audio.paused : isPlayingRef.current);
        return;
      }

      if (event.code === "ArrowRight") {
        event.preventDefault();
        const audio = audioRef.current;
        onNext(audio ? !audio.paused : isPlayingRef.current);
      }
    },
    [currentTrack, notifyPosition, onNext, onPrevious, paintTimeline, togglePlay],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [handleKeydown]);

  const setSeekPosition = useCallback(
    (next: number, forcePlay = false) => {
      const audio = audioRef.current;
      const safe = Number.isFinite(next) ? Math.max(0, Math.min(next, totalSeconds)) : 0;
      paintTimeline(safe);
      setPosition(safe);
      if (audio) {
        audio.currentTime = safe;
        if (forcePlay && audio.paused && currentTrack) {
          void audio.play().catch(() => {
            setIsPlaying(false);
            setError("playback blocked.");
          });
        }
      }
      onPositionChange?.(safe);
    },
    [currentTrack, onPositionChange, paintTimeline, totalSeconds],
  );

  const getPointerPosition = useCallback(
    (clientX: number) => {
      const timeline = timelineRef.current;
      const total = durationRef.current || totalSeconds;
      if (!timeline || total <= 0) return timelinePositionRef.current;

      const rect = timeline.getBoundingClientRect();
      if (rect.width <= 0) return timelinePositionRef.current;

      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return ratio * total;
    },
    [totalSeconds],
  );

  const startSeek = useCallback(
    (clientX: number, pointerId: number) => {
      const audio = audioRef.current;
      seekWasPlayingRef.current = audio ? !audio.paused : isPlayingRef.current;
      activeSeekPointerRef.current = pointerId;
      isSeekingRef.current = true;
      stopTimelineFrame();
      paintTimeline(getPointerPosition(clientX));
    },
    [getPointerPosition, paintTimeline, stopTimelineFrame],
  );

  const moveSeek = useCallback(
    (clientX: number, pointerId: number) => {
      if (!isSeekingRef.current) return;
      if (activeSeekPointerRef.current !== pointerId) return;
      paintTimeline(getPointerPosition(clientX));
    },
    [getPointerPosition, paintTimeline],
  );

  const cancelSeek = useCallback(() => {
    if (!isSeekingRef.current) return;
    isSeekingRef.current = false;
    activeSeekPointerRef.current = null;

    const audio = audioRef.current;
    const safe = Math.max(0, audio?.currentTime || 0);
    paintTimeline(safe);
    if (audio && !audio.paused) {
      startTimelineFrame();
    }
  }, [paintTimeline, startTimelineFrame]);

  const commitPointerSeek = useCallback(() => {
    if (!isSeekingRef.current) return;
    isSeekingRef.current = false;
    activeSeekPointerRef.current = null;
    setSeekPosition(timelinePositionRef.current, seekWasPlayingRef.current);
    if (seekWasPlayingRef.current) {
      startTimelineFrame();
    }
  }, [setSeekPosition, startTimelineFrame]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!isSeekingRef.current) return;
      if (activeSeekPointerRef.current !== event.pointerId) return;
      event.preventDefault();
      moveSeek(event.clientX, event.pointerId);
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (!isSeekingRef.current) return;
      if (activeSeekPointerRef.current !== event.pointerId) return;
      event.preventDefault();
      commitPointerSeek();
    };

    const handlePointerCancel = (event: PointerEvent) => {
      if (!isSeekingRef.current) return;
      if (activeSeekPointerRef.current !== event.pointerId) return;
      cancelSeek();
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp, { passive: false });
    window.addEventListener("pointercancel", handlePointerCancel);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [cancelSeek, commitPointerSeek, moveSeek]);

  const handlePrevious = useCallback(() => {
    const audio = audioRef.current;
    if (!currentTrack) return;

    if (audio && audio.currentTime > PREVIOUS_TRACK_SECONDS) {
      audio.currentTime = 0;
      paintTimeline(0);
      notifyPosition(0, true);
      return;
    }

    onPrevious(audio ? !audio.paused : isPlayingRef.current);
  }, [currentTrack, notifyPosition, onPrevious, paintTimeline]);

  const handleNext = useCallback(() => {
    const audio = audioRef.current;
    onNext(audio ? !audio.paused : isPlayingRef.current);
  }, [onNext]);

  const handleEnded = useCallback(() => {
    stopTimelineFrame();
    stopVisualizerFrame();
    paintIdleVisualizer();
    onNext(true);
  }, [onNext, paintIdleVisualizer, stopTimelineFrame, stopVisualizerFrame]);

  useEffect(() => {
    paintTimeline(position);
  }, [paintTimeline, position, totalSeconds]);

  useEffect(() => {
    paintVolume(volume);
  }, [paintVolume, volume]);

  useEffect(() => stopTimelineFrame, [stopTimelineFrame]);
  useEffect(() => {
    paintIdleVisualizer();
  }, [paintIdleVisualizer]);
  useEffect(() => {
    return () => {
      if (stateTimerRef.current !== null) {
        window.clearTimeout(stateTimerRef.current);
      }
      stopVisualizerFrame();
      void audioContextRef.current?.close();
    };
  }, [stopVisualizerFrame]);

  return (
    <div
      className={cn(
        "sticky left-0 right-0 bottom-0 box-border flex w-full min-w-0 flex-col overflow-hidden bg-neutral-950 shadow-[0_-1px_0_rgba(255,255,255,0.04)]",
        className,
      )}
    >
      <audio
        ref={audioRef}
        preload="auto"
        onEnded={handleEnded}
        onLoadedMetadata={() => {
          const audio = audioRef.current;
          if (!audio) return;
          const nextDuration = Number.isFinite(audio.duration) ? audio.duration : 0;
          setDuration(nextDuration);
          restorePlaybackPosition();
          if (!hasRestoredPositionRef.current) {
            const safe = audio.currentTime || 0;
            paintTimeline(safe, nextDuration);
            notifyPosition(safe, true);
          }
        }}
        onDurationChange={() => {
          const audio = audioRef.current;
          if (!audio) return;
          const nextDuration = Number.isFinite(audio.duration) ? audio.duration : 0;
          setDuration(nextDuration);
          paintTimeline(audio.currentTime || 0, nextDuration);
        }}
        onTimeUpdate={() => {
          const audio = audioRef.current;
          if (!audio || isSeekingRef.current) return;
          const safe = Math.max(0, audio.currentTime || 0);
          paintTimeline(safe);
          notifyPosition(safe);
        }}
        onError={() => {
          stopTimelineFrame();
          stopVisualizerFrame();
          paintIdleVisualizer();
          setIsPlaying(false);
          onPlaybackStateChange?.(false);
          setError("could not play track.");
        }}
        onPause={() => {
          stopTimelineFrame();
          stopVisualizerFrame();
          paintIdleVisualizer();
          setIsPlaying(false);
          onPlaybackStateChange?.(false);
        }}
        onPlay={() => {
          setIsPlaying(true);
          onPlaybackStateChange?.(true);
          startTimelineFrame();
          startVisualizerFrame();
        }}
      />
      <audio ref={preloadAudioRef} preload="auto" aria-hidden="true" className="hidden" />

      <div className="player-visualizer" aria-hidden="true">
        <canvas ref={visualizerRef} className="block size-full" />
      </div>

      <footer className="box-border flex h-12 w-full min-w-0 items-stretch overflow-hidden border-t border-white/10 bg-neutral-950">
      <div className="flex size-12 shrink-0 items-center overflow-hidden bg-neutral-900">
        {coverSrc ? (
          <Image
            src={coverSrc}
            alt=""
            width={COVER_FETCH_SIZE}
            height={COVER_FETCH_SIZE}
            unoptimized
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <div className="grid size-full place-items-center text-xs text-muted-foreground">
            no art
          </div>
        )}
      </div>

      <Separator orientation="vertical" />

      <div
        className="flex min-w-0 shrink basis-auto items-center px-2"
        style={{ maxWidth: "min(38%, 18rem)" }}
      >
        <div className="min-w-0">
          <p className="truncate text-sm leading-tight text-foreground">{trackTitle}</p>
          {error ? (
            <p className="truncate text-xs leading-tight text-destructive">{error}</p>
          ) : (
            <p className="truncate text-xs leading-tight text-muted-foreground">
              {trackArtist}
            </p>
          )}
        </div>
      </div>

      <Separator orientation="vertical" />

      <div className="flex shrink-0 items-stretch text-foreground select-none">
        <button
          type="button"
          aria-label="previous track"
          title="previous track"
          disabled={!currentTrack}
          onClick={handlePrevious}
          className="flex items-center px-2 text-sm text-muted-foreground outline-none hover:bg-white/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-35"
        >
          prev
        </button>
        <Separator orientation="vertical" />
        <button
          type="button"
          aria-label={isPlaying ? "pause" : "play"}
          title={isPlaying ? "pause" : "play"}
          disabled={!currentTrack}
          onClick={() => void togglePlay()}
          className="flex items-center px-2 text-sm text-foreground outline-none hover:bg-white/[0.06] hover:text-foreground/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-35"
        >
          {isPlaying ? "pause" : "play"}
        </button>
        <Separator orientation="vertical" />
        <button
          type="button"
          aria-label="next track"
          title="next track"
          disabled={!currentTrack}
          onClick={handleNext}
          className="flex items-center px-2 text-sm text-muted-foreground outline-none hover:bg-white/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-35"
        >
          next
        </button>
      </div>

      <Separator orientation="vertical" />

      <div className="player-controls flex min-w-0 flex-1 items-center gap-2 overflow-hidden px-2 text-xs tabular-nums text-muted-foreground select-none">
        <div
          className="grid min-w-0 flex-1 items-center gap-2"
          style={{ gridTemplateColumns: "minmax(2.25rem, auto) minmax(0, 1fr) minmax(2.25rem, auto)" }}
        >
          <span ref={elapsedRef} className="shrink-0 text-right">
            {formatDuration(elapsedSeconds)}
          </span>
          <div
            ref={timelineRef}
            role="slider"
            tabIndex={currentTrack ? 0 : -1}
            aria-label="progress"
            aria-valuemin={0}
            aria-valuemax={totalSeconds}
            aria-valuenow={Math.min(totalSeconds, Math.max(0, position))}
            aria-valuetext={`${formatDuration(elapsedSeconds)} of ${formatDuration(totalSeconds)}`}
            aria-disabled={!currentTrack || totalSeconds <= 0}
            className="player-progress min-w-0 w-full"
            style={
              {
                "--player-progress": `${progressPercent}%`,
                "--player-progress-scale": progressPercent / 100,
              } as CSSProperties
            }
            onPointerDown={(event) => {
              if (!currentTrack || totalSeconds <= 0) return;
              event.preventDefault();
              try {
                event.currentTarget.setPointerCapture(event.pointerId);
              } catch {
                // pointer fallback uses window listeners
              }
              startSeek(event.clientX, event.pointerId);
            }}
            onPointerMove={(event) => {
              moveSeek(event.clientX, event.pointerId);
            }}
            onPointerUp={(event) => {
              if (!isSeekingRef.current) return;
              try {
                event.currentTarget.releasePointerCapture(event.pointerId);
              } catch {
                // pointer fallback uses window listeners
              }
              commitPointerSeek();
            }}
            onPointerCancel={(event) => {
              if (!isSeekingRef.current) return;
              try {
                event.currentTarget.releasePointerCapture(event.pointerId);
              } catch {
                // pointer fallback uses window listeners
              }
              cancelSeek();
            }}
            onKeyDown={(event) => {
              if (!currentTrack || totalSeconds <= 0) return;
              const current = timelinePositionRef.current;
              let next: number | null = null;

              if (event.key === "ArrowLeft") next = current - 5;
              if (event.key === "ArrowRight") next = current + 5;
              if (event.key === "Home") next = 0;
              if (event.key === "End") next = totalSeconds;
              if (next === null) return;

              event.preventDefault();
              setSeekPosition(next, isPlayingRef.current);
            }}
          >
            <div className="player-progress__track">
              <div className="player-progress__fill" />
            </div>
            <div className="player-progress__thumb" />
          </div>
          <span className="shrink-0 text-right">{formatDuration(totalSeconds)}</span>
        </div>
      </div>

      <Separator orientation="vertical" />

      <div className="flex shrink-0 items-center gap-1.5 pl-1 pr-2 text-xs tabular-nums text-muted-foreground select-none">
        <span ref={volumeLabelRef} className="min-w-[1.5rem] shrink-0 text-right">
          {volumePercent}
        </span>
        <input
          ref={volumeRef}
          type="range"
          min={0}
          max={100}
          defaultValue={Math.round(volume * 100)}
          onInput={(event) => {
            const next = Number(event.currentTarget.value) / 100;
            paintVolume(next);
            const audio = audioRef.current;
            if (audio) {
              audio.volume = next;
            }
          }}
          onChange={(event) => {
            const next = Number(event.currentTarget.value) / 100;
            setVolume(next);
          }}
          aria-label="volume"
          aria-valuetext={`${volumePercent} percent`}
          className="player-slider player-slider--volume h-5 w-[min(5.75rem,14vw)] min-w-12 max-w-24"
          style={{ "--player-slider-value": `${volumePercent}%` } as CSSProperties}
        />
      </div>
      </footer>
    </div>
  );
}
