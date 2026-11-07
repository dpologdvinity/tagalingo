/**
 * Tala, the Tagalingo mascot: a Philippine tarsier, drawn as an inline SVG so it scales and
 * themes cleanly. `mood` swaps the mouth and eyelids for feedback moments.
 */
type Mood = "happy" | "cheer" | "sad" | "sleepy";

export function Tala({ size = 64, mood = "happy", className }: { size?: number; mood?: Mood; className?: string }) {
  const eyeOpen = mood !== "sleepy";
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role="img" aria-label="Tala the tarsier">
      {/* ears */}
      <ellipse cx="10" cy="18" rx="9" ry="11" fill="#8b6b4a" />
      <ellipse cx="54" cy="18" rx="9" ry="11" fill="#8b6b4a" />
      <ellipse cx="10.5" cy="18.5" rx="5.5" ry="7.5" fill="#e8b9a0" />
      <ellipse cx="53.5" cy="18.5" rx="5.5" ry="7.5" fill="#e8b9a0" />
      {/* head */}
      <circle cx="32" cy="35" r="25" fill="#a8835c" />
      <ellipse cx="32" cy="41" rx="19" ry="17" fill="#d9b98f" />
      {/* eyes: the whole personality of a tarsier */}
      <circle cx="22" cy="31" r="11" fill="#fff8ea" />
      <circle cx="42" cy="31" r="11" fill="#fff8ea" />
      {eyeOpen ? (
        <>
          <circle cx="22" cy="31" r="8.5" fill="#ffb627" />
          <circle cx="42" cy="31" r="8.5" fill="#ffb627" />
          <circle cx="22" cy="31" r="5.5" fill="#17233b" />
          <circle cx="42" cy="31" r="5.5" fill="#17233b" />
          <circle cx="24.5" cy="28.5" r="2" fill="#fff" />
          <circle cx="44.5" cy="28.5" r="2" fill="#fff" />
        </>
      ) : (
        <>
          <path d="M14 32 q8 5 16 0" stroke="#17233b" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <path d="M34 32 q8 5 16 0" stroke="#17233b" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        </>
      )}
      {mood === "sad" && (
        <>
          <path d="M12 21 l9 3" stroke="#6e5238" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M52 21 l-9 3" stroke="#6e5238" strokeWidth="2.5" strokeLinecap="round" />
        </>
      )}
      {/* nose */}
      <ellipse cx="32" cy="44" rx="2.4" ry="1.6" fill="#6e5238" />
      {/* mouth */}
      {mood === "sad" ? (
        <path d="M27 51 q5 -4 10 0" stroke="#6e5238" strokeWidth="2" fill="none" strokeLinecap="round" />
      ) : mood === "cheer" ? (
        <path d="M26 48 q6 7 12 0 z" fill="#6e5238" />
      ) : (
        <path d="M27 48 q5 4 10 0" stroke="#6e5238" strokeWidth="2" fill="none" strokeLinecap="round" />
      )}
    </svg>
  );
}

/** Wordmark: Tala + "Tagalingo" set in the display face. */
export function Logo({ size = 36 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Tala size={size} />
      <span className="font-display text-2xl tracking-wide text-lagoon">Tagalingo</span>
    </span>
  );
}
