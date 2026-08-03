const fs = require("fs");
const crypto = require("crypto");

const storagePath = "storage/published-plans.json";
const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:5000";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function request(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function run() {
  const original = fs.readFileSync(storagePath, "utf8");
  let plan;

  try {
    const plans = JSON.parse(original);
    plan = plans.find(item => !item.deletedAt && item.shareToken);
    assert(plan, "No active shared plan is available for the test.");

    const initialAssignments = clone(Array.isArray(plan.assignments) ? plan.assignments : []);
    const initialLogs = clone(Array.isArray(plan.logs) ? plan.logs : []);
    delete plan.stateRevision;
    delete plan.stateRequestIds;
    fs.writeFileSync(storagePath, JSON.stringify(plans, null, 2));

    const shareUrl = `${baseUrl}/api/plans/share/${encodeURIComponent(plan.shareToken)}`;
    const loaded = await request(shareUrl);
    assert(loaded.response.ok && loaded.body.ok, "Shared plan could not be loaded.");
    assert(loaded.body.plan.stateRevision === 0, "Legacy plans should load at revision 0.");

    const state = {
      assignments: initialAssignments,
      logs: initialLogs
    };
    const firstRequestId = `test-${crypto.randomUUID()}`;
    const firstPayload = JSON.stringify({
      ...state,
      stateRevision: 0,
      requestId: firstRequestId
    });

    const first = await request(`${shareUrl}/state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: firstPayload
    });
    assert(first.response.status === 200 && first.body.ok, "The first shared save should succeed.");
    assert(first.body.duplicate === false && first.body.stateRevision === 1, "The first save should advance to revision 1.");

    const duplicate = await request(`${shareUrl}/state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: firstPayload
    });
    assert(duplicate.response.status === 200 && duplicate.body.ok, "A repeated request should remain successful.");
    assert(duplicate.body.duplicate === true && duplicate.body.stateRevision === 1, "A repeated request should not advance the revision.");

    const stale = await request(`${shareUrl}/state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...state,
        stateRevision: 0,
        requestId: `test-stale-${crypto.randomUUID()}`
      })
    });
    assert(stale.response.status === 409 && stale.body.conflict, "A stale save should be rejected with a conflict.");
    assert(stale.body.stateRevision === 1, "A stale response should report the latest revision.");

    const second = await request(`${shareUrl}/state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...state,
        stateRevision: 1,
        requestId: `test-second-${crypto.randomUUID()}`
      })
    });
    assert(second.response.status === 200 && second.body.ok, "A sequential save should succeed.");
    assert(second.body.stateRevision === 2, "The sequential save should advance to revision 2.");

    const after = await request(shareUrl);
    assert(after.response.ok && after.body.ok, "The shared plan should still load after the test.");
    assert(after.body.plan.stateRevision === 2, "The stored revision should be 2 before restoration.");
    assert(JSON.stringify(after.body.plan.assignments) === JSON.stringify(initialAssignments), "Assignments changed unexpectedly.");
    assert(JSON.stringify(after.body.plan.logs) === JSON.stringify(initialLogs), "Logs changed unexpectedly.");

    console.log("Shared-log regression checks passed: legacy load, first save, duplicate replay, stale conflict, and sequential save.");
  } finally {
    fs.writeFileSync(storagePath, original);
  }
}

run().catch(error => {
  console.error(`Shared-log regression checks failed: ${error.message}`);
  process.exitCode = 1;
});