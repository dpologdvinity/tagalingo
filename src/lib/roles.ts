/**
 * Who may use the content Studio.
 *
 * The demo account's password is public (there's a one-click "Try the demo" button), so in
 * production it never gets reviewer rights, even if the seed flagged it as a reviewer, unless
 * the operator explicitly opts in with DEMO_CAN_REVIEW=true. Otherwise any visitor could edit
 * live lessons or spend the Anthropic budget on generation.
 */
import { DEMO_ACCOUNT } from "./demo";

type Env = Record<string, string | undefined>;

export function canReview(user: { email: string; isReviewer: boolean }, env: Env = process.env): boolean {
  if (!user.isReviewer) return false;
  const isPublicDemo = user.email.toLowerCase() === DEMO_ACCOUNT.email;
  if (isPublicDemo && env.NODE_ENV === "production") return env.DEMO_CAN_REVIEW === "true";
  return true;
}
