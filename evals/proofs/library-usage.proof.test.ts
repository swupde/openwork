import { expect } from "vitest";
import { spec } from "@openwork/testkit";
import { libraryUsage } from "../worlds/library-usage.ts";
import { isRecord, records, isEmulatedClientWidth } from "../worlds/library.ts";

const test = spec.world(libraryUsage, {
  needs: { placement: "local" }, timeout: 600_000, resources: { surfaces: ["web"], services: ["den", "mock"] },
});
const row = (name: string) => `[data-testid="library-usage-row"][data-item="${name}"]`;

test("owners see actual skill loads and connector failures while teammates cannot read usage", async ({ world, user, probe, step, evidence }) => {
  const owner = user.on(world.web);
  const page = probe.on(world.web);
  const teammate = user.on(world.memberWeb);
  const report = async (kind: "plugins" | "skills" | "connectors") => {
    const result = await probe.api(world.den.admin, `/v1/library-usage/${kind}`);
    expect(result.response.status).toBe(200);
    return records(isRecord(result.body) ? result.body.items : undefined);
  };
  const view = async (kind: string) => {
    await owner.navigate(`${world.baseUrl}/dashboard/analytics/library?view=${kind}`);
    await owner.see({ testId: "library-usage-row" }, { timeoutMs: 60_000 });
  };

  await step("a fresh library displays unused items without fabricated activity", async () => {
    await view("plugins");
    await owner.see({ testId: "library-usage-no-usage" });
    await owner.see({ text: "No usage yet" });
    const fresh = await report("plugins");
    expect(fresh).toHaveLength(2);
    expect(fresh.every((item) => item.uses === 0 && item.people === 0 && item.lastUsedAt === null)).toBe(true);
    expect((await page.dom("[data-item-unused]")).elements).toHaveLength(2);
    await owner.screenshot();
  });

  await step("each actual skill load and connector call is recorded once", async () => {
    const loads = [
      await world.loadSkill("alice", "draftReply", "get_skill"),
      await world.loadSkill("alice", "draftReply", "get_skill"),
      await world.loadSkill("blair", "draftReply", "execute_capability"),
      await world.loadSkill("blair", "summarizeTicket", "get_skill"),
    ];
    expect(loads.every((load) => load.status === 200 && !load.isError && load.servedSkill)).toBe(true);
    const calls = [await world.callConnector("alice", "tracker", "search_issues"), await world.callConnector("blair", "tracker", "search_issues")];
    expect(calls.every((call) => call.status === 200 && !call.isError)).toBe(true);
    // Current usage accounting counts every load, including a repeated load by the same member.
    const plugins = await page.eventually(() => report("plugins"), {
      within: 60_000, intervalMs: 500, label: "all four skill loads recorded",
      until: (items) => items.find((item) => item.name === "Support kit")?.uses === 4,
    });
    expect(plugins.find((item) => item.name === "Support kit")).toMatchObject({ uses: 4, people: 2 });
    expect(plugins.find((item) => item.name === "GitHub")).toMatchObject({ uses: 0, people: 0, lastUsedAt: null });
    const skills = await report("skills");
    expect(skills.find((item) => item.name === world.skills.draftReply.title)).toMatchObject({ uses: 3, people: 2 });
    expect(skills.find((item) => item.name === world.skills.summarizeTicket.title)).toMatchObject({ uses: 1, people: 1 });
    expect(skills.find((item) => item.name === world.skills.quoteBuilder.title)).toMatchObject({ uses: 0, people: 0 });
    await view("plugins");
    expect((await page.dom(`${row("Support kit")} [data-item-uses]`)).elements[0]?.text).toBe("4");
    await owner.screenshot();
  });

  await step("successful calls show zero failures and a refused call becomes one real failure", async () => {
    const success = await page.eventually(() => report("connectors"), {
      within: 60_000, label: "successful connector calls recorded",
      until: (items) => items.find((item) => item.name === world.connectors.tracker)?.uses === 2,
    });
    expect(success.find((item) => item.name === world.connectors.tracker)).toMatchObject({ uses: 2, people: 2, failures: 0 });
    await view("connectors");
    expect((await page.dom('[data-testid="library-usage-failed"][data-state="neutral"]')).elements).toHaveLength(1);
    const failed = await world.callConnector("blair", "tracker", "create_issue");
    expect(failed.status).toBe(200);
    expect(failed.isError).toBe(true);
    expect(failed.text).toContain('"error":"provider_error"');
    const final = await page.eventually(() => report("connectors"), {
      within: 60_000, label: "refused provider call counted",
      until: (items) => items.find((item) => item.name === world.connectors.tracker)?.failures === 1,
    });
    expect(final.find((item) => item.name === world.connectors.tracker)).toMatchObject({ uses: 3, people: 2, failures: 1 });
    expect(final.find((item) => item.name === world.connectors.wiki)).toMatchObject({ uses: 0, people: 0, failures: 0 });
    await owner.reload();
    await owner.see({ testId: "library-usage-row" });
    expect((await page.dom(`${row(world.connectors.tracker)} [data-item-failures]`)).elements[0]?.text).toContain("1");
    evidence.recordAssertionEvidence("Usage agrees with provider outcomes", "Four real skill loads, two successful connector calls and one failed connector call were observed through the gateway.", loadsVerified(final));
    await owner.screenshot();
  });

  await step("filtering and narrow layouts keep the measured report usable", async () => {
    await owner.type({ placeholder: "Filter by name" }, world.connectors.tracker, { replace: true });
    expect((await page.dom('[data-testid="library-usage-row"]')).elements).toHaveLength(1);
    expect((await page.dom(row(world.connectors.tracker))).elements).toHaveLength(1);
    await owner.type({ placeholder: "Filter by name" }, "", { replace: true });
    await owner.press("Backspace");
    await owner.resizeViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    const layout = await world.usageLayout();
    expect(isEmulatedClientWidth(layout.viewportWidth, 390)).toBe(true);
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.bodyScrollWidth).toBeLessThanOrEqual(layout.bodyWidth);
    expect(layout.table?.overflowX).toBe("auto");
    await owner.screenshot();
  });

  await step("a teammate cannot obtain the owner report in the UI or API", async () => {
    const alice = world.den.members.alice;
    if (!alice) throw new Error("Missing teammate session.");
    const statuses = await Promise.all(["plugins", "skills", "connectors"].map(async (kind) => (await probe.api(alice, `/v1/library-usage/${kind}`)).response.status));
    expect(statuses).toEqual([403, 403, 403]);
    await teammate.navigate(`${world.baseUrl}/dashboard/analytics/library`);
    // The outer organization dashboard guard redirects members to Home.
    await teammate.see({ text: "Support team is set up for you" });
    await teammate.notSee({ role: "heading", label: "Plugins & connectors" });
    expect((await probe.on(world.memberWeb).dom('[data-testid="library-usage-row"]')).elements).toHaveLength(0);
    evidence.recordAssertionEvidence("Usage access is enforced per member", `Teammate API responses: ${statuses.join(", ")}.`, statuses.every((status) => status === 403));
    await teammate.screenshot();
  });
});

function loadsVerified(items: Record<string, unknown>[]): boolean {
  return items.some((item) => item.name === "Team tracker" && item.uses === 3 && item.failures === 1 && item.people === 2);
}
