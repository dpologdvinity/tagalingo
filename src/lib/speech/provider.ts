/**
 * Text-to-speech behind a small interface.
 *
 * With GOOGLE_TTS_API_KEY set, audio comes from Google Cloud Text-to-Speech (fil-PH voices).
 * Without it there is no server provider: the browser falls back to its own speechSynthesis
 * voices, and if the device has no Filipino voice the text is simply shown. So the app works
 * with no accounts; the paid service only improves audio quality and coverage.
 */

export interface SpeechProvider {
  readonly name: string;
  /** MP3 audio for a Tagalog phrase. */
  synthesize(text: string): Promise<Uint8Array>;
}

const GOOGLE_TTS_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";

export class GoogleTtsProvider implements SpeechProvider {
  readonly name = "google";

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async synthesize(text: string): Promise<Uint8Array> {
    const res = await this.fetchImpl(`${GOOGLE_TTS_URL}?key=${encodeURIComponent(this.apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: "fil-PH" },
        // Slightly slower than normal speech suits beginners.
        audioConfig: { audioEncoding: "MP3", speakingRate: 0.9 },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Google TTS failed with ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { audioContent?: string };
    if (!body.audioContent) throw new Error("Google TTS returned no audio");
    return Uint8Array.from(Buffer.from(body.audioContent, "base64"));
  }
}

export function selectSpeechProvider(env: Record<string, string | undefined> = process.env): SpeechProvider | null {
  const key = env.GOOGLE_TTS_API_KEY?.trim();
  return key ? new GoogleTtsProvider(key) : null;
}
