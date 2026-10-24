const assert = require("assert");
const fs = require("fs");
const path = require("path");
const model = require("../traningsverktyg/massagefeedback/session-model");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function testScaleHasTenOrderedPositions() {
  assert.deepStrictEqual(model.POSITIONS, [
    "GREAT", "GOOD", "NOT MUCH", "4", "5", "6", "7", "8", "9", "10"
  ]);
}

function testStartJoinInvalidAndFullSession() {
  const started = model.createSession("A7K2");
  assert.strictEqual(started.status, "waiting");
  assert.deepStrictEqual(started.participants, ["A"]);
  assert.strictEqual(model.joinSession(started, "wrong", "B").reason, "invalid");

  const joined = model.joinSession(started, " a7k2 ", "B");
  assert.strictEqual(joined.ok, true);
  assert.strictEqual(joined.session.status, "connected");
  assert.deepStrictEqual(joined.session.participants, ["A", "B"]);
  assert.strictEqual(model.joinSession(joined.session, "A7K2", "C").reason, "full");
}

function testSharedValueAndExclusiveDragControl() {
  let session = model.joinSession(model.createSession("B82Q"), "B82Q", "B").session;
  session = model.claimControl(session, "A").session;
  assert.strictEqual(model.claimControl(session, "B").reason, "locked");
  assert.strictEqual(model.setPosition(session, "B", 9).reason, "locked");
  session = model.setPosition(session, "A", 7).session;
  assert.strictEqual(session.position, 7);
  session = model.releaseControl(session, "A").session;
  session = model.claimControl(session, "B").session;
  session = model.setPosition(session, "B", 9).session;
  assert.strictEqual(session.position, 9);
}

function testOrientationDoesNotChangeSelectedPosition() {
  const session = { ...model.createSession("C53M"), position: 5 };
  const orientation = model.toggleOrientation("horizontal");
  assert.strictEqual(orientation, "vertical");
  assert.strictEqual(session.position, 5);
  assert.strictEqual(model.toggleOrientation(orientation), "horizontal");
}

function testLeavingAndEndingSession() {
  let session = model.joinSession(model.createSession("D8Q4"), "D8Q4", "B").session;
  session = model.leaveSession(session, "A").session;
  assert.deepStrictEqual(session.participants, ["B"]);
  assert.strictEqual(session.status, "waiting");
  session = model.endSession(session).session;
  assert.strictEqual(session.status, "ended");
  assert.strictEqual(model.joinSession(session, "D8Q4", "A").reason, "ended");
}

function testPublicIntegrationAndLocalOnlyBehavior() {
  const toolsPage = read("workout.html");
  const page = read("traningsverktyg/massagefeedback/index.html");
  const ui = read("traningsverktyg/massagefeedback/massagefeedback.js");
  assert.match(toolsPage, /href="\/traningsverktyg\/massagefeedback\/"/);
  assert.match(page, /href="\/workout\.html">← Tillbaka till Träningsverktyg/);
  assert.match(page, /Ingen riktig telefonanslutning eller synkronisering sker/);
  assert.doesNotMatch(ui, /\bfetch\s*\(/);
  assert.doesNotMatch(ui, /localStorage/);
  assert.ok(fs.existsSync(path.join(root, "traningsverktyg/massagefeedback/index.html")));
}

testScaleHasTenOrderedPositions();
testStartJoinInvalidAndFullSession();
testSharedValueAndExclusiveDragControl();
testOrientationDoesNotChangeSelectedPosition();
testLeavingAndEndingSession();
testPublicIntegrationAndLocalOnlyBehavior();

console.log("Massagefeedback UI tests passed.");
