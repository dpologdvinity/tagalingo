import { describe, expect, it } from "vitest";
import { canReview } from "./roles";
import { DEMO_ACCOUNT } from "./demo";

const reviewer = { email: "editor@example.org", isReviewer: true };
const demo = { email: DEMO_ACCOUNT.email, isReviewer: true };

describe("canReview", () => {
  it("allows real reviewers everywhere", () => {
    expect(canReview(reviewer, { NODE_ENV: "production" })).toBe(true);
  });

  it("denies learners without the reviewer flag", () => {
    expect(canReview({ ...reviewer, isReviewer: false }, { NODE_ENV: "development" })).toBe(false);
  });

  it("lets the public demo account review in development", () => {
    expect(canReview(demo, { NODE_ENV: "development" })).toBe(true);
  });

  it("never lets the public demo account review in production by default", () => {
    expect(canReview(demo, { NODE_ENV: "production" })).toBe(false);
  });

  it("allows it in production only with an explicit opt-in", () => {
    expect(canReview(demo, { NODE_ENV: "production", DEMO_CAN_REVIEW: "true" })).toBe(true);
  });
});
