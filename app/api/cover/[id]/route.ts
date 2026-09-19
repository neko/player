import { getCoverArtUrl } from "@/lib/navidrome";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);
  const size = Math.min(
    1200,
    Math.max(64, Number(new URL(request.url).searchParams.get("size")) || 300),
  );
  const response = await fetch(getCoverArtUrl(id, size));

  if (!response.ok) {
    return new Response("cover not found", { status: response.status });
  }

  const bytes = await response.arrayBuffer();

  return new Response(bytes, {
    headers: {
      "Content-Type": response.headers.get("Content-Type") ?? "image/jpeg",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
