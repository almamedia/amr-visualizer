/**
 * Read-only check that the configured credentials and ids actually work.
 * Creates nothing. Run: npm run xandr:probe
 */
import { request, getToken } from "../lib/xandr/client";
import { advertiserId, insertionOrderId, baseUrl, memberId, isTestMember } from "../lib/xandr/config";

console.log({ baseUrl: baseUrl(), memberId: memberId(), testMember: isTestMember() });

const token = await getToken();
console.log("auth: ok, token length", token.length);

const member = await request<{ member: { id: number; name: string } }>({
  method: "GET",
  service: "member",
});
console.log("member:", member.member?.id, member.member?.name);

try {
  const adv = await request<{ advertiser: { id: number; name: string; state: string } }>({
    method: "GET",
    service: "advertiser",
    params: { id: advertiserId() },
  });
  console.log("advertiser:", adv.advertiser?.id, adv.advertiser?.name, adv.advertiser?.state);
} catch (e) {
  console.log("advertiser lookup failed:", (e as Error).message);
}

try {
  const io = await request<{ "insertion-order": { id: number; name: string; state: string; start_date: string; end_date: string } }>({
    method: "GET",
    service: "insertion-order",
    params: { id: insertionOrderId(), advertiser_id: advertiserId() },
  });
  const o = io["insertion-order"];
  console.log("insertion order:", o?.id, o?.name, o?.state, o?.start_date, "->", o?.end_date);
} catch (e) {
  console.log("insertion order lookup failed:", (e as Error).message);
}

/** --line-item=<id> reads one line item back and prints what actually landed. */
const liArg = process.argv.find((a) => a.startsWith("--line-item="));
if (liArg) {
  const id = Number(liArg.slice("--line-item=".length));
  const r = await request<{ "line-item": Record<string, unknown> }>({
    method: "GET",
    service: "line-item",
    params: { id, advertiser_id: advertiserId() },
  });
  const li = r["line-item"] as Record<string, any>;
  console.log("\nline item as stored:");
  console.log({
    id: li.id,
    code: li.code,
    name: li.name,
    state: li.state,
    line_item_type: li.line_item_type,
    line_item_subtype: li.line_item_subtype,
    revenue_type: li.revenue_type,
    revenue_value: li.revenue_value,
    goal_type: li.goal_type,
    goal_value: li.goal_value,
    valuation: li.valuation,
    profile_id: li.profile_id,
    creatives: (li.creatives ?? []).map((c: any) => c.id),
    insertion_orders: (li.insertion_orders ?? []).map((o: any) => o.id),
    budget_intervals: li.budget_intervals,
    ad_types: li.ad_types,
  });
}

/** --recent lists objects created today under the advertiser. */
if (process.argv.includes("--recent")) {
  const today = new Date().toISOString().slice(0, 10);
  const pr = await request<{ profiles: any[] }>({
    method: "GET",
    service: "profile",
    params: {
      advertiser_id: advertiserId(),
      num_elements: 100,
      min_last_modified: `${today} 00:00:00`,
    },
  });
  console.log(`profiles touched today (count ${pr.count}):`);
  for (const p of pr.profiles ?? []) {
    console.log(` ${p.id}  created ${p.created_on}  last_modified ${p.last_modified}`);
  }

  const cr = await request<{ creatives: any[] }>({
    method: "GET",
    service: "creative",
    params: { advertiser_id: advertiserId(), num_elements: 100, sort: "created_on.desc" },
  });
  console.log("\ncreatives created today:");
  for (const c of (cr.creatives ?? []).filter((c) => String(c.created_on).startsWith(today))) {
    console.log(` ${c.id}  ${c.state}  ${c.created_on}  ${c.name}`);
  }
}
