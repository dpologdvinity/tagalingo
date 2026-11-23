/** Badge colours for a Studio review status, shared by the exercise and verb-table review pages. */
import type { ExerciseStatus } from "@/generated/prisma/enums";

export const STATUS_STYLE: Record<ExerciseStatus, string> = {
  DRAFT: "bg-mango-soft text-mango-deep",
  APPROVED: "bg-lagoon-soft text-lagoon",
  REJECTED: "bg-gumamela-soft text-gumamela",
};

/** The status filter pills the review pages share; `ALL` shows every status. */
export const FILTERS = ["DRAFT", "APPROVED", "REJECTED", "ALL"] as const;
export type Filter = (typeof FILTERS)[number];
export const FILTER_LABEL: Record<Filter, string> = {
  DRAFT: "Drafts",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  ALL: "All",
};

/** The `?status=` value as a filter, or null when absent or unknown. */
export function parseFilter(value: string | string[] | undefined): Filter | null {
  const upper = typeof value === "string" ? value.toUpperCase() : null;
  return FILTERS.find((f) => f === upper) ?? null;
}
