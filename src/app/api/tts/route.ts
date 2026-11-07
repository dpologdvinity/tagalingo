/**
 * GET /api/tts?text=… → MP3 audio for a Tagalog phrase, or 501 when no server speech provider
 * is configured (the client then uses the browser's own voices).
 *
 * Signed-in learners only, short texts only, and results are cached in memory, so a paid
 * provider can't be used as a free TTS service.
 */
import { auth } from "@/auth";
import { selectSpeechProvider } from "@/lib/speech/provider";
import { ttsLimiter } from "@/server/rate-limit";

const MAX_TEXT = 200;
const CACHE_LIMIT = 500;
const cache = new Map<string, Uint8Array>();

export async function GET(request: Request) {
  const provider = selectSpeechProvider();
  if (!provider) return new Response("No server speech provider configured", { status: 501 });

  const session = await auth();
  if (!session?.user?.id) return new Response("Sign in to use audio", { status: 401 });

  const text = new URL(request.url).searchParams.get("text")?.trim() ?? "";
  if (!text || text.length > MAX_TEXT) return new Response("text must be 1–200 characters", { status: 400 });

  let audio = cache.get(text);
  if (!audio) {
    // Only fresh synthesis costs money, so only cache misses count against the learner's limit.
    if (!ttsLimiter.take(session.user.id)) return new Response("Too many audio requests", { status: 429 });
    try {
      audio = await provider.synthesize(text);
    } catch (e) {
      console.error(e);
      return new Response("Speech service unavailable", { status: 502 });
    }
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    cache.set(text, audio);
  }
  return new Response(Buffer.from(audio), {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=86400" },
  });
}
