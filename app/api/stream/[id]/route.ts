import { getStreamUrl } from "@/lib/navidrome";

const PASSTHROUGH_HEADERS = [
  "accept-ranges",
  "content-length",
  "content-range",
  "content-type",
  "etag",
  "last-modified",
];

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);
  const range = request.headers.get("range");

  const response = await fetch(getStreamUrl(id), {
    cache: "no-store",
    headers: range ? { range } : undefined,
  });

  if (!response.ok || !response.body) {
    return new Response("stream not found", { status: response.status });
  }

  const headers = new Headers({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });

  for (const header of PASSTHROUGH_HEADERS) {
    const value = response.headers.get(header);
    if (value) headers.set(header, value);
  }

  return new Response(response.body, {
    status: response.status,
    headers,
  });
}
