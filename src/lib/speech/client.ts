"use client";
/**
 * Browser-side speech helpers.
 *
 * speakTagalog(): server audio (/api/tts) when a provider is configured, otherwise the
 * browser's own Filipino/Tagalog voice, otherwise "unavailable" (callers then show the text).
 * useSpeechRecognition(): Web Speech API recognition in fil-PH, where the browser supports it.
 */
import { useCallback, useRef, useSyncExternalStore } from "react";

export type SpeakResult = "played" | "unavailable";

/** null = not checked yet; false = the server answered 501/401, so don't ask again this session. */
let serverAudio: boolean | null = null;
const audioUrls = new Map<string, string>();

function tagalogVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  return voices.find((v) => /^(fil|tl)([-_]|$)/i.test(v.lang)) ?? null;
}

/** Voices load asynchronously in some browsers; wait briefly for them. */
function waitForVoices(ms = 1200): Promise<void> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return Promise.resolve();
  if (window.speechSynthesis.getVoices().length > 0) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => resolve();
    window.speechSynthesis.addEventListener("voiceschanged", done, { once: true });
    setTimeout(done, ms);
  });
}

async function playServerAudio(text: string, slow: boolean): Promise<boolean> {
  if (serverAudio === false) return false;
  try {
    let url = audioUrls.get(text);
    if (!url) {
      const res = await fetch(`/api/tts?text=${encodeURIComponent(text)}`);
      if (res.status === 501 || res.status === 401) {
        serverAudio = false;
        return false;
      }
      if (!res.ok) return false;
      url = URL.createObjectURL(await res.blob());
      audioUrls.set(text, url);
    }
    serverAudio = true;
    const audio = new Audio(url);
    audio.playbackRate = slow ? 0.7 : 1;
    await audio.play();
    return true;
  } catch {
    return false;
  }
}

export async function speakTagalog(text: string, { slow = false } = {}): Promise<SpeakResult> {
  if (await playServerAudio(text, slow)) return "played";
  await waitForVoices();
  const voice = tagalogVoice();
  if (!voice) return "unavailable";
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voice;
  utterance.lang = voice.lang;
  utterance.rate = slow ? 0.65 : 0.9;
  window.speechSynthesis.speak(utterance);
  return "played";
}

/* ---------- speech recognition ---------- */

type RecognitionResultList = ArrayLike<ArrayLike<{ transcript: string }>>;
type Recognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: RecognitionResultList }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const noop = () => () => {};

/** Whether this browser can recognise speech (false during server rendering). */
export function useRecognitionSupported(): boolean {
  return useSyncExternalStore(
    noop,
    () => recognitionCtor() !== null,
    () => false,
  );
}

export function useSpeechRecognition() {
  const active = useRef<Recognition | null>(null);

  /** Listen once in Filipino; resolves with the best transcript ("" if nothing was heard). */
  const listen = useCallback(
    () =>
      new Promise<string>((resolve, reject) => {
        const Ctor = recognitionCtor();
        if (!Ctor) return reject(new Error("unsupported"));
        const rec = new Ctor();
        active.current = rec;
        rec.lang = "fil-PH";
        rec.interimResults = false;
        rec.maxAlternatives = 1;
        let heard = "";
        rec.onresult = (e) => {
          heard = Array.from(e.results)
            .map((r) => r[0]?.transcript ?? "")
            .join(" ")
            .trim();
        };
        rec.onerror = (e) => (e.error === "no-speech" ? resolve("") : reject(new Error(e.error)));
        rec.onend = () => resolve(heard);
        rec.start();
      }),
    [],
  );

  const stop = useCallback(() => active.current?.stop(), []);
  return { listen, stop };
}
