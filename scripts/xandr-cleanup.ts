/**
 * Find and remove the Xandr objects a booking created.
 *
 * Every booking that passes a `tag` stamps it on each object's `code`, so a
 * whole demo run can be found again and taken out:
 *
 *   npm run xandr:cleanup -- --tag=amr-demo-2026-08-20            list only
 *   npm run xandr:cleanup -- --tag=amr-demo-2026-08-20 --delete   remove them
 *   npm run xandr:cleanup -- --profiles=1,2,3 --delete            explicit ids
 *
 * Nothing is removed without --delete. Line items go first: a profile or
 * creative still referenced by one cannot be deleted.
 */

import { request } from "../lib/xandr/client";
import { advertiserId } from "../lib/xandr/config";

const args = process.argv.slice(2);
const doDelete = args.includes("--delete");
const value = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? "";
const ids = (name: string) => {
  const raw = value(name);
  if (!raw) return [];
  return raw
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
};

const tag = value("tag");

interface Found {
  service: "line-item" | "profile" | "creative";
  id: number;
  label: string;
}

/** Objects whose code starts with the tag. Xandr has no prefix search, so the
 *  known per-type suffixes are queried directly. */
async function findByTag(t: string): Promise<Found[]> {
  const found: Found[] = [];

  const lookup = async (
    service: Found["service"],
    key: string,
    code: string
  ): Promise<void> => {
    try {
      const res = await request<Record<string, any>>({
        method: "GET",
        service,
        params: { code, advertiser_id: advertiserId() },
      });
      const obj = res[key];
      if (obj?.id) found.push({ service, id: obj.id, label: obj.name ?? obj.code ?? "" });
    } catch {
      // No object with that code: nothing to clean up for this type.
    }
  };

  await lookup("line-item", "line-item", `${t}-li`);
  await lookup("profile", "profile", `${t}-pr`);
  for (let i = 1; i <= 24; i++) {
    await lookup("creative", "creative", `${t}-cr-${i}`);
  }
  return found;
}

const targets: Found[] = [];

if (tag) targets.push(...(await findByTag(tag)));
for (const id of ids("line-items")) targets.push({ service: "line-item", id, label: "" });
for (const id of ids("profiles")) targets.push({ service: "profile", id, label: "" });
for (const id of ids("creatives")) targets.push({ service: "creative", id, label: "" });

if (targets.length === 0) {
  console.log("Nothing matched.");
} else {
  console.log(`${targets.length} object(s)${doDelete ? " to delete" : " found"}:`);
  for (const t of targets) console.log(` ${t.service.padEnd(10)} ${t.id}  ${t.label}`);
}

if (!doDelete) {
  console.log("\nDry run. Re-run with --delete to remove them.");
} else {
  // Line items first: Xandr refuses to delete anything still referenced.
  const order = { "line-item": 0, profile: 1, creative: 2 } as const;
  for (const t of [...targets].sort((a, b) => order[a.service] - order[b.service])) {
    try {
      await request({
        method: "DELETE",
        service: t.service,
        params: { id: t.id, advertiser_id: advertiserId() },
      });
      console.log(`deleted ${t.service} ${t.id}`);
    } catch (e) {
      console.log(`FAILED  ${t.service} ${t.id}: ${(e as Error).message}`);
    }
  }
}
