import { describe, expect, it } from "vitest";
import { buildForms, formatCell, parseCell } from "./forms-input";

describe("parseCell", () => {
  it("splits on commas, trims and drops empty entries", () => {
    expect(parseCell("kumain, kakain")).toEqual(["kumain", "kakain"]);
    expect(parseCell("  kumain ,, ")).toEqual(["kumain"]);
    expect(parseCell("   ")).toEqual([]);
  });
});

describe("formatCell", () => {
  it("joins variants with a comma and a space, and inverts parseCell", () => {
    expect(formatCell(["nakapagluluto", "nakakapagluto"])).toBe("nakapagluluto, nakakapagluto");
    expect(parseCell(formatCell(["a", "b", "c"]))).toEqual(["a", "b", "c"]);
    expect(formatCell(undefined)).toBe("");
  });
});

describe("buildForms", () => {
  const inputs = {
    infinitive: "kumain",
    completed: "kumain",
    incompleted: "kumakain",
    contemplated: "kakain",
    recent: "kakakain",
  };

  it("parses every form's cell", () => {
    expect(buildForms({ ...inputs, completed: "kumain, kumaen" })).toEqual({
      infinitive: ["kumain"],
      completed: ["kumain", "kumaen"],
      incompleted: ["kumakain"],
      contemplated: ["kakain"],
      recent: ["kakakain"],
    });
  });

  it("leaves out an empty recent form but keeps other empty cells so validation can flag them", () => {
    const forms = buildForms({ ...inputs, recent: " ", completed: "" });
    expect(forms).not.toHaveProperty("recent");
    expect(forms.completed).toEqual([]);
  });
});
