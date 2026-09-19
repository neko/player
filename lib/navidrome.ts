import { createHash, randomBytes } from "node:crypto";

const NAVIDROME_URL = process.env.NAVIDROME_URL;
const NAVIDROME_USER = process.env.NAVIDROME_USER;
const NAVIDROME_PASSWORD = process.env.NAVIDROME_PASSWORD;
const CLIENT = "player";

export type NavidromeSong = {
  id: string;
  title: string;
  artist: string;
  duration: number;
  year?: number;
  coverArt?: string;
};

type SubsonicSong = {
  id: string;
  title: string;
  artist: string;
  duration: number;
  year?: number;
  coverArt?: string;
};

type Search3Response = {
  "subsonic-response": {
    status: string;
    searchResult3?: {
      song?: SubsonicSong | SubsonicSong[];
    };
    error?: {
      message: string;
    };
  };
};

function buildApiUrl(endpoint: string, params: Record<string, string> = {}) {
  if (!NAVIDROME_URL || !NAVIDROME_USER || !NAVIDROME_PASSWORD) {
    throw new Error("missing navidrome configuration");
  }

  const salt = randomBytes(8).toString("hex");
  const token = createHash("md5").update(`${NAVIDROME_PASSWORD}${salt}`).digest("hex");
  const url = new URL(`/rest/${endpoint}`, NAVIDROME_URL);
  url.searchParams.set("u", NAVIDROME_USER);
  url.searchParams.set("t", token);
  url.searchParams.set("s", salt);
  url.searchParams.set("v", "1.16.1");
  url.searchParams.set("c", CLIENT);
  url.searchParams.set("f", "json");

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

function normalizeSongs(songs: SubsonicSong | SubsonicSong[] | undefined): NavidromeSong[] {
  if (!songs) return [];
  const list = Array.isArray(songs) ? songs : [songs];

  return list.map((song) => ({
    id: song.id,
    title: song.title,
    artist: song.artist,
    duration: song.duration,
    year: song.year,
    coverArt: song.coverArt,
  }));
}

export async function fetchNavidromeSongs(): Promise<NavidromeSong[]> {
  const response = await fetch(
    buildApiUrl("search3.view", {
      query: "",
      songCount: "5000",
    }),
    { cache: "no-store" },
  );

  if (!response.ok) {
    throw new Error(`navidrome request failed (${response.status})`);
  }

  const data = (await response.json()) as Search3Response;
  const subsonic = data["subsonic-response"];

  if (subsonic.status !== "ok") {
    throw new Error(subsonic.error?.message ?? "navidrome request failed");
  }

  return normalizeSongs(subsonic.searchResult3?.song);
}

export function getCoverArtUrl(coverArtId: string, size = 120) {
  return buildApiUrl("getCoverArt.view", {
    id: coverArtId,
    size: String(size),
  });
}

export function getStreamUrl(songId: string) {
  return buildApiUrl("stream.view", { id: songId });
}
