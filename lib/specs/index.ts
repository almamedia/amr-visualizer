import raw from "./display.json";
import type {
  DisplayFormat,
  Goal,
  GoalId,
  Html5Format,
  SpecLibrary,
} from "../types";

/**
 * Ainoa paikka, josta speksit luetaan. Kovakoodattuja mittoja, painorajoja
 * tai tekstirajoja ei saa olla muualla koodissa.
 */
export const specs = raw as unknown as SpecLibrary;

export function getFormat(id: string): DisplayFormat {
  const f = specs.formats.find((x) => x.id === id);
  if (!f) throw new Error(`Tuntematon formaatti: ${id}`);
  return f;
}

export function getHtml5Format(id: string): Html5Format {
  const f = specs.html5Formats.find((x) => x.id === id);
  if (!f) throw new Error(`Tuntematon HTML5-formaatti: ${id}`);
  return f;
}

/** Demon oletusvalinta: kolme ensisijaista staattista kokoa. */
export function primaryFormats(): DisplayFormat[] {
  return specs.formats.filter((f) => f.primary);
}

export function getGoal(id: GoalId): Goal {
  const g = specs.goals.find((x) => x.id === id);
  if (!g) throw new Error(`Tuntematon kampanjatavoite: ${id}`);
  return g;
}

export const goals = specs.goals;
export const aiActLabel = specs.global.aiActLabel;
/** Kun tämä on false, merkintää ei piirretä aineistoihin eikä sitä vaadita
 *  validoinnissa. Ohjataan yhdestä paikasta: lib/specs/display.json. */
export const requireAiActLabel = specs.global.requireAiActLabel;
