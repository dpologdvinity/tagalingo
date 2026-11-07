import { describe, expect, it } from "vitest";
import { GoogleTtsProvider, selectSpeechProvider } from "./provider";

describe("selectSpeechProvider", () => {
  it("returns null (browser speech only) without a key", () => {
    expect(selectSpeechProvider({})).toBeNull();
  });

  it("uses Google Cloud TTS when a key is set", () => {
    expect(selectSpeechProvider({ GOOGLE_TTS_API_KEY: "k" })?.name).toBe("google");
  });
});

describe("GoogleTtsProvider", () => {
  it("requests Filipino MP3 audio and decodes the response", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fakeFetch = async (url: string, init?: { body?: string }) => {
      calls.push({ url, body: JSON.parse(init?.body ?? "{}") });
      return new Response(JSON.stringify({ audioContent: Buffer.from("mp3-bytes").toString("base64") }), {
        status: 200,
      });
    };
    const provider = new GoogleTtsProvider("secret-key", fakeFetch as typeof fetch);
    const audio = await provider.synthesize("Magandang umaga po.");

    expect(Buffer.from(audio).toString()).toBe("mp3-bytes");
    expect(calls[0].url).toContain("key=secret-key");
    expect(calls[0].body).toMatchObject({
      input: { text: "Magandang umaga po." },
      voice: { languageCode: "fil-PH" },
      audioConfig: { audioEncoding: "MP3" },
    });
  });

  it("throws a readable error when the API fails", async () => {
    const fakeFetch = async () => new Response("quota exceeded", { status: 429 });
    await expect(new GoogleTtsProvider("k", fakeFetch as typeof fetch).synthesize("x")).rejects.toThrow(/429/);
  });
});
