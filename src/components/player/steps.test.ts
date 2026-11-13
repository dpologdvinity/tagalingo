import { describe, expect, it } from "vitest";
import type { ClientExercise } from "@/lib/content/client-view";
import type { LessonCard } from "@/server/grammar";
import { buildSteps, chipCards } from "./steps";

const ex = (id: string): ClientExercise => ({ id, type: "type_translation", prompt: id, promptLang: "en" });
const card = (slug: string, isNew: boolean): LessonCard => ({
  slug,
  title: slug.toUpperCase(),
  isNew,
  card: {
    title: slug.toUpperCase(),
    rule: `rule of ${slug}`,
    examples: [
      ["a", "b"],
      ["c", "d"],
    ],
    notes: [],
    mistakes: [],
  },
});

describe("buildSteps", () => {
  it("keeps the exercise order when there are no cards", () => {
    const steps = buildSteps([ex("a"), ex("b")], [], {});
    expect(steps.map((s) => s.kind)).toEqual(["exercise", "exercise"]);
  });

  it("puts a new card right before the first exercise tagged with it, once", () => {
    const steps = buildSteps([ex("a"), ex("b"), ex("c")], [card("um", true)], { b: ["um"], c: ["um"] });
    expect(steps.map((s) => (s.kind === "card" ? `card:${s.card.slug}` : s.exercise.id))).toEqual([
      "a",
      "card:um",
      "b",
      "c",
    ]);
  });

  it("introduces several new cards of one exercise in the exercise's tag order", () => {
    const steps = buildSteps([ex("a")], [card("mag", true), card("um", true)], { a: ["um", "mag"] });
    expect(steps.map((s) => (s.kind === "card" ? s.card.slug : s.exercise.id))).toEqual(["um", "mag", "a"]);
  });

  it("skips cards that are not new and cards no exercise is tagged with", () => {
    const steps = buildSteps([ex("a")], [card("old", false), card("orphan", true)], { a: ["old"] });
    expect(steps.map((s) => s.kind)).toEqual(["exercise"]);
  });

  it("ignores tags that have no card", () => {
    const steps = buildSteps([ex("a")], [], { a: ["ghost"] });
    expect(steps).toHaveLength(1);
  });
});

describe("chipCards", () => {
  const cards = [card("um", true), card("mag", false)];
  const tags = { a: ["um", "mag"], b: ["mag"] };

  it("is empty for an untagged exercise", () => {
    expect(chipCards("z", cards, tags, new Set())).toEqual([]);
  });

  it("shows every tagged card that is not new", () => {
    expect(chipCards("b", cards, tags, new Set()).map((c) => c.slug)).toEqual(["mag"]);
  });

  it("hides a new card until its card step has been shown", () => {
    expect(chipCards("a", cards, tags, new Set()).map((c) => c.slug)).toEqual(["mag"]);
    expect(chipCards("a", cards, tags, new Set(["um"])).map((c) => c.slug)).toEqual(["um", "mag"]);
  });
});
