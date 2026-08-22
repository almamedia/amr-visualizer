import raw from "./display.json";
import type {
  DisplayFormat,
  Goal,
  GoalId,
  Html5Format,
  SpecLibrary,
} from "../types";

/**
  * The only place specs are read from. No dimension, weight limit or character
  * limit may be hard-coded anywhere else in the code.
  */
export const specs = raw as unknown as SpecLibrary;

export function getFormat(id: string): DisplayFormat {
  const f = specs.formats.find((x) => x.id === id);
  if (!f) throw new Error(`Unknown format: ${id}`);
  return f;
}

export function getHtml5Format(id: string): Html5Format {
  const f = specs.html5Formats.find((x) => x.id === id);
  if (!f) throw new Error(`Unknown HTML5 format: ${id}`);
  return f;
}

/** The default selection: the three primary static sizes. */
export function primaryFormats(): DisplayFormat[] {
  return specs.formats.filter((f) => f.primary);
}

export function getGoal(id: GoalId): Goal {
  const g = specs.goals.find((x) => x.id === id);
  if (!g) throw new Error(`Unknown campaign goal: ${id}`);
  return g;
}

export const goals = specs.goals;
export const aiActLabel = specs.global.aiActLabel;
/** When false the label is neither drawn into assets nor required by
 *  validation. Controlled from one place: lib/specs/display.json. */
export const requireAiActLabel = specs.global.requireAiActLabel;
