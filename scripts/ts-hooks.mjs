/**
 * Resolve extensionless relative imports to .ts files.
 *
 * lib/ is written for Vite's bundler resolution ("./types", not "./types.ts"),
 * which plain Node ESM will not follow. This hook closes that gap so scripts/
 * can import lib/ directly, without adding a runtime dependency.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  // Vite imports JSON without an import attribute; Node insists on one.
  if (specifier.endsWith(".json")) {
    const resolved = await nextResolve(specifier, context);
    return { ...resolved, importAttributes: { type: "json" } };
  }
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (!specifier.startsWith(".") || /\.[cm]?[jt]sx?$/.test(specifier)) throw err;
    for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
      const url = new URL(candidate, context.parentURL);
      if (existsSync(fileURLToPath(url))) {
        return nextResolve(candidate, context);
      }
    }
    throw err;
  }
}
