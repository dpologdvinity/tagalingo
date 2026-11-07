"use client";
/** Settings form: name, daily goal (radio cards) and timezone. */
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { updateSettingsAction } from "@/app/actions/settings";
import { DAILY_GOALS } from "@/lib/game/goals";
import { Button } from "@/components/ui";

function Save() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save settings"}
    </Button>
  );
}

export function SettingsForm(props: { name: string; dailyGoalXp: number; timezone: string; timezones: string[] }) {
  const [state, action] = useActionState(updateSettingsAction, undefined);
  const field = "w-full rounded-2xl border-2 border-line bg-surface px-4 py-3 outline-none focus:border-lagoon-bright";
  return (
    <form action={action} className="space-y-5">
      <label className="block">
        <span className="mb-1 block font-bold">Name</span>
        <input name="name" defaultValue={props.name} maxLength={40} required className={field} />
      </label>

      <fieldset>
        <legend className="mb-2 font-bold">Daily goal</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {DAILY_GOALS.map((g) => (
            <label
              key={g.xp}
              className="flex cursor-pointer items-center gap-3 rounded-2xl border-2 border-line px-4 py-3 has-[:checked]:border-lagoon-bright has-[:checked]:bg-lagoon-soft"
            >
              <input
                type="radio"
                name="dailyGoalXp"
                value={g.xp}
                defaultChecked={g.xp === props.dailyGoalXp}
                className="accent-lagoon"
              />
              <span>
                <span className="block font-bold">
                  {g.label}: {g.xp} XP
                </span>
                <span className="text-sm text-ink-soft">{g.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="block">
        <span className="mb-1 block font-bold">Timezone</span>
        <span className="mb-2 block text-sm text-ink-soft">Your streak day ends at midnight here.</span>
        <select name="timezone" defaultValue={props.timezone} className={field}>
          {props.timezones.map((tz) => (
            <option key={tz} value={tz}>
              {tz.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-center gap-4">
        <Save />
        <p role="status" className={state?.error ? "font-bold text-gumamela" : "font-bold text-lagoon"}>
          {state?.error ?? (state?.ok ? "Saved." : "")}
        </p>
      </div>
    </form>
  );
}
