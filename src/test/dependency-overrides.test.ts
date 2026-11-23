/**
 * Guards for the npm `overrides` in package.json, so a temporary security pin can't outlive its
 * reason. Each override names the advisory it patches and the first fixed version; once the
 * package that pulls the dependency in asks for a fixed version on its own (read from
 * package-lock.json, which CI installs from), the test fails and says which override to delete.
 * Dependabot's PR for that release is where this turns red.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type Version = [number, number, number];

/** The lowest version a simple npm range allows: "3.20.0", "^3.20.0", "~3.20.0" or ">=3.20.0". */
function lowestVersion(range: string): Version | null {
  const match = /^(?:\^|~|>=)?\s*(\d+)\.(\d+)\.(\d+)$/.exec(range.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

const atLeast = (v: Version, min: Version) => {
  for (let i = 0; i < 3; i++) if (v[i] !== min[i]) return v[i] > min[i];
  return true;
};

/** True when `range` can no longer resolve to a version below `fixedIn`. */
function rangeIsFixed(range: string, fixedIn: Version): boolean {
  const lowest = lowestVersion(range);
  return lowest !== null && atLeast(lowest, fixedIn);
}

/** Overrides that exist only to patch an advisory in a transitive dependency. */
const SECURITY_OVERRIDES = [
  {
    parent: "@prisma/config",
    dependency: "effect",
    advisory: "ReDoS in Schema.TemplateLiteral (high)",
    fixedIn: [3, 22, 1] as Version,
  },
];

describe("lowestVersion / rangeIsFixed", () => {
  it("reads exact, caret, tilde and >= ranges", () => {
    expect(lowestVersion("3.20.0")).toEqual([3, 20, 0]);
    expect(lowestVersion("^3.22.5")).toEqual([3, 22, 5]);
    expect(lowestVersion("~3.22.1")).toEqual([3, 22, 1]);
    expect(lowestVersion(">=4.0.0")).toEqual([4, 0, 0]);
    expect(lowestVersion("3.x || 4.x")).toBeNull();
  });

  it("knows when a range already excludes the vulnerable versions", () => {
    expect(rangeIsFixed("3.20.0", [3, 22, 1])).toBe(false);
    expect(rangeIsFixed("^3.22.0", [3, 22, 1])).toBe(false);
    expect(rangeIsFixed("^3.22.1", [3, 22, 1])).toBe(true);
    expect(rangeIsFixed("4.0.0", [3, 22, 1])).toBe(true);
    expect(rangeIsFixed("latest", [3, 22, 1])).toBe(false);
  });
});

describe("security overrides in package.json", () => {
  const root = process.cwd();
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
    overrides?: Record<string, Record<string, string>>;
  };
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8")) as {
    packages: Record<string, { version?: string; dependencies?: Record<string, string> }>;
  };

  for (const o of SECURITY_OVERRIDES) {
    it(`${o.parent} → ${o.dependency} is still needed (${o.advisory})`, () => {
      expect(pkg.overrides?.[o.parent]?.[o.dependency], "override missing from package.json").toBeDefined();
      const parent = lock.packages[`node_modules/${o.parent}`];
      expect(parent, `${o.parent} is not in package-lock.json`).toBeDefined();
      const requested = parent.dependencies?.[o.dependency] ?? "";
      expect(
        rangeIsFixed(requested, o.fixedIn),
        `${o.parent}@${parent.version} now asks for ${o.dependency}@${requested}, which includes the fix ` +
          `(>= ${o.fixedIn.join(".")}). Delete overrides["${o.parent}"] in package.json, run npm install, ` +
          `and remove this entry from SECURITY_OVERRIDES.`,
      ).toBe(false);
    });
  }
});
