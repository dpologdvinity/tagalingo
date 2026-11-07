"use client";
/**
 * Speaker button that reads Tagalog aloud (server TTS → browser voice). When the device can't
 * speak Tagalog it says so once instead of failing silently.
 */
import { useState } from "react";
import { speakTagalog } from "@/lib/speech/client";

export function SpeakButton({
  text,
  size = "md",
  slow = false,
  label,
}: {
  text: string;
  size?: "sm" | "md" | "lg";
  slow?: boolean;
  label?: string;
}) {
  const [unavailable, setUnavailable] = useState(false);
  const dims = size === "lg" ? "h-20 w-20" : size === "sm" ? "h-8 w-8" : "h-11 w-11";
  const icon = size === "lg" ? 40 : size === "sm" ? 16 : 22;
  return (
    <span className="inline-flex items-center gap-2 align-middle">
      <button
        type="button"
        onClick={async () => setUnavailable((await speakTagalog(text, { slow })) === "unavailable")}
        aria-label={label ?? (slow ? `Play slowly: ${text}` : `Play: ${text}`)}
        className={`inline-flex ${dims} shrink-0 items-center justify-center rounded-2xl bg-lagoon-bright text-white shadow-press-lagoon active:translate-y-[2px] active:shadow-none`}
      >
        <svg width={icon} height={icon} viewBox="0 0 24 24" aria-hidden>
          {slow ? (
            <path fill="currentColor" d="M4 9h3l4-4v14l-4-4H4V9zm11 3a3 3 0 0 0-2-2.8v5.6a3 3 0 0 0 2-2.8z" />
          ) : (
            <path
              fill="currentColor"
              d="M3 9h4l5-5v16l-5-5H3V9zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"
            />
          )}
        </svg>
      </button>
      {unavailable && (
        <span role="status" className="text-sm text-ink-soft">
          No Tagalog voice on this device.
        </span>
      )}
    </span>
  );
}
