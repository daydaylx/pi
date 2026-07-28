/**
 * Planvertrag: Metadaten, Pflichtabschnitte, stabile Step-IDs und Hashing.
 */
import { assert, equal, test } from "./assertions.mjs";
import { quickPlan } from "../shared/plan-fixtures.mjs";
import { load } from "./harness.mjs";

const snapshotMod = await load("extensions/plan-mode/plan-snapshot.ts");
const planning = await load("extensions/plan-mode/planning.ts");

await test("PlanSnapshot metadata and stable ids", () => {
  const first = snapshotMod.finalizePlanDocument(
    quickPlan(),
    "simple_plan",
  );
  equal(first.snapshot.planRevision, 1, "first revision is one");
  equal(first.snapshot.steps.length, 2, "numbered steps are parsed");
  assert(
    first.content.includes("PI-PLAN-METADATA:") &&
      first.content.match(/PI-STEP-ID:/g)?.length === 2,
    "metadata and invisible step ids are stamped",
  );
  const unchanged = snapshotMod.finalizePlanDocument(
    first.content,
    "simple_plan",
    first.content,
  );
  equal(unchanged.snapshot.planRevision, 1, "unchanged plan keeps revision");
  equal(
    unchanged.snapshot.steps.map((step) => step.id),
    first.snapshot.steps.map((step) => step.id),
    "unchanged plan keeps step ids",
  );
  const changed = snapshotMod.finalizePlanDocument(
    quickPlan("Implementiere den neuen Adapter"),
    "simple_plan",
    first.content,
  );
  equal(changed.snapshot.planRevision, 2, "semantic edit increments revision");
  equal(
    changed.snapshot.steps[1].id,
    first.snapshot.steps[1].id,
    "unchanged step identity survives a revision",
  );
});

await test("architecture plans require two to four options", () => {
  assert(
    planning.planningPrompt("detailed_plan").includes("ask_user"),
    "architecture planning requires an explicit user decision when still open",
  );
  let rejected = false;
  try {
    snapshotMod.finalizePlanDocument(quickPlan(), "detailed_plan");
  } catch {
    rejected = true;
  }
  assert(rejected, "architecture plan without options is rejected");
  const detailed = quickPlan().replace(
    "## Umsetzungsschritte",
    "## Bewertete Optionen\n- Adapter: geringe Kopplung\n- Monolith: geringere Dateizahl\n\n## Umsetzungsschritte",
  );
  assert(
    snapshotMod.finalizePlanDocument(detailed, "detailed_plan").snapshot,
    "architecture plan with two options is accepted",
  );
  let extraSectionRejected = false;
  try {
    snapshotMod.finalizePlanDocument(
      quickPlan().replace(
        "## Risiken",
        "## Nicht vereinbarter Zusatz\n- darf nicht still akzeptiert werden\n\n## Risiken",
      ),
      "simple_plan",
    );
  } catch {
    extraSectionRejected = true;
  }
  assert(
    extraSectionRejected,
    "plan format rejects additional or out-of-order H2 sections",
  );
});
