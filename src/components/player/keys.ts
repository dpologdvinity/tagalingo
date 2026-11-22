/**
 * Keyboard guards shared by the lesson player's window-level key handlers (Enter to check or
 * continue, 1-4 to pick an option). Kept apart from the components so they can be unit-tested.
 */

/**
 * True when a key event's target is a control that owns Enter: a button or a link, including the
 * "?" grammar chip. Enter on one of those must do what the control does, not check the answer
 * (which could cost a heart). Takes `unknown` because event targets are not always elements.
 */
export function ownsEnter(target: unknown): boolean {
  const closest = (target as { closest?: unknown } | null)?.closest;
  return typeof closest === "function" && (target as Element).closest("button, a[href]") !== null;
}

/** True while a modal dialog (quit, grammar help) is open; the page behind it must ignore keys. */
export function dialogOpen(doc: Pick<Document, "querySelector"> = document): boolean {
  return doc.querySelector("dialog[open]") !== null;
}
