/** Daily XP goal presets offered in settings. A lesson is worth 10–20 XP. */
export const DAILY_GOALS = [
  { xp: 10, label: "Casual", hint: "About one lesson a day" },
  { xp: 20, label: "Regular", hint: "One or two lessons a day" },
  { xp: 30, label: "Serious", hint: "Two or three lessons a day" },
  { xp: 50, label: "Intense", hint: "Three to five lessons a day" },
] as const;
