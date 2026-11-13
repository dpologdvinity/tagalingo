/**
 * Tests for `loadApprovedVerbs`: the file-only reader of content/<lang>/grammar/verbs.json.
 * Each test writes into a fresh temp directory so nothing depends on the shipped content.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadApprovedVerbs, readVerbFile } from "./verbs-file";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "verbs-file-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Writes `<dir>/grammar/verbs.json` with the given raw text. */
function writeVerbs(raw: string) {
  fs.mkdirSync(path.join(dir, "grammar"), { recursive: true });
  fs.writeFileSync(path.join(dir, "grammar", "verbs.json"), raw);
}

const kain = {
  root: "kain",
  affix: "um",
  en: "eat",
  forms: {
    infinitive: ["kumain"],
    completed: ["kumain"],
    incompleted: ["kumakain"],
    contemplated: ["kakain"],
    recent: ["kakakain"],
  },
  irregular: [],
  reviewNote: "",
};

describe("loadApprovedVerbs", () => {
  it("returns [] when the file does not exist", () => {
    expect(loadApprovedVerbs(dir)).toEqual([]);
  });

  it("parses a valid file into verb tables, dropping the review metadata", () => {
    writeVerbs(JSON.stringify({ verbs: [kain] }));
    expect(loadApprovedVerbs(dir)).toEqual([{ root: "kain", affix: "um", en: "eat", forms: kain.forms }]);
  });

  it("accepts a table without a recent form", () => {
    const forms = { ...kain.forms, recent: undefined };
    delete forms.recent;
    writeVerbs(JSON.stringify({ verbs: [{ ...kain, forms }] }));
    expect(loadApprovedVerbs(dir)[0].forms).toEqual(forms);
  });

  it("throws a clear error for malformed JSON", () => {
    writeVerbs("{ not json");
    expect(() => loadApprovedVerbs(dir)).toThrow(/verbs\.json.*not valid JSON/);
  });

  it("throws a clear error for a file that fails validation", () => {
    writeVerbs(JSON.stringify({ verbs: [{ ...kain, affix: "zz" }] }));
    expect(() => loadApprovedVerbs(dir)).toThrow(/Invalid verbs\.json[\s\S]*verbs\.0\.affix/);
  });

  it("rejects an irregular marker that is not a form name", () => {
    writeVerbs(JSON.stringify({ verbs: [{ ...kain, irregular: ["past"] }] }));
    expect(() => loadApprovedVerbs(dir)).toThrow(/Invalid verbs\.json[\s\S]*verbs\.0\.irregular/);
  });
});

describe("readVerbFile", () => {
  it("returns whole entries including the review metadata", () => {
    const entry = { ...kain, irregular: ["completed"], reviewNote: "checked" };
    writeVerbs(JSON.stringify({ verbs: [entry] }));
    expect(readVerbFile(dir)).toEqual([entry]);
  });
});
