/**
 * Read-only: what targeting vocabularies does our Xandr member actually expose?
 * Answers whether Alma cohort ids and IAB content ids are usable as-is.
 */
import { request } from "../lib/xandr/client";
import { memberId } from "../lib/xandr/config";

console.log("=== segments visible to member", memberId(), "===");
try {
  const seg = await request<{ segments: any[] }>({
    method: "GET",
    service: "segment",
    params: { member_id: memberId(), num_elements: 15 },
  });
  console.log("total:", seg.count);
  for (const s of (seg.segments ?? []).slice(0, 15)) {
    console.log(` id=${s.id}  code=${s.code ?? "-"}  short_name=${s.short_name ?? "-"}  name=${s.name ?? "-"}`);
  }
} catch (e) {
  console.log("segment lookup failed:", (e as Error).message);
}

console.log("\n=== content categories ===");
try {
  const cc = await request<{ "content-categories": any[] }>({
    method: "GET",
    service: "content-category",
    params: { num_elements: 15 },
  });
  console.log("total:", cc.count);
  for (const c of (cc["content-categories"] ?? []).slice(0, 15)) {
    console.log(` id=${c.id}  name=${c.name}  type=${c.type ?? "-"}  parent=${c.parent_category_id ?? "-"}`);
  }
} catch (e) {
  console.log("content-category lookup failed:", (e as Error).message);
}

console.log("\n=== resolve one Alma cohort id via segment code ===");
for (const cohortId of ["107119", "107120"]) {
  try {
    const r = await request<{ segments: any[] }>({
      method: "GET",
      service: "segment",
      params: { member_id: memberId(), code: `permutive_${cohortId}` },
    });
    const s = (r.segments ?? [])[0] ?? (r as any).segment;
    console.log(` cohort ${cohortId} -> xandr segment ${s?.id}  (${s?.short_name})`);
  } catch (e) {
    console.log(` cohort ${cohortId} -> lookup failed: ${(e as Error).message}`);
  }
}

console.log("\n=== Finnish regions known to Xandr ===");
try {
  const r = await request<{ regions: any[] }>({
    method: "GET",
    service: "region",
    params: { country_code: "FI", num_elements: 25 },
  });
  console.log("total:", r.count);
  for (const x of (r.regions ?? []).slice(0, 25)) {
    console.log(` id=${x.id}  code=${x.code}  name=${x.name}`);
  }
} catch (e) {
  console.log("region lookup failed:", (e as Error).message);
}
