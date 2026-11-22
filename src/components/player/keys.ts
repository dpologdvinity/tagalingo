/**
 * Keyboard guards shared by the lesson player's window-level key handlers (Enter to check or
 * continue, 1-4 to pick an option). Kept apart from the components so they can be unit-tested.
 */

/** True when `target` is, or sits inside, an element matching `selector`. Takes `unknown`: targets are not always elements. */
function within(target: unknown, selector: string): boolean {
  const closest = (target as { closest?: unknown } | null)?.closest;
  return typeof closest === "function" && (target as Element).closest(selector) !== null;
}

/**
 * True when a key event's target is the "?" grammar chip (marked `data-chip`). Enter there must open
 * the help, not check the answer, which could cost a heart. Every other focused control, an option or
 * tile just clicked included, leaves Enter to the player: it checks or continues.
 */
export const chipOwnsEnter = (target: unknown): boolean => within(target, "[data-chip]");

/** True for a button or a link, which activate on Enter themselves (used inside the help dialog). */
export const isControl = (target: unknown): boolean => within(target, "button, a[href]");

/** True while a modal dialog (quit, grammar help) is open; the page behind it must ignore keys. */
export function dialogOpen(doc: Pick<Document, "querySelector"> = document): boolean {
  return doc.querySelector("dialog[open]") !== null;
}
