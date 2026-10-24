const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const pagePath = "traningsverktyg/massagefeedback/index.html";
const page = fs.readFileSync(path.join(root, pagePath), "utf8");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

class TestElement {
  constructor() {
    this.listeners = new Map();
    this.attributes = new Map();
    this.dataset = {};
    this.style = { setProperty() {} };
    this.classList = { toggle() {} };
    this.textContent = "";
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.buttons = [];
    this.selectors = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  querySelector(selector) {
    return this.selectors.get(selector) || null;
  }

  querySelectorAll(selector) {
    return selector === "[data-position]" ? this.buttons : [];
  }

  set innerHTML(markup) {
    const choiceMarkup = /<button class="choice-button" type="button" data-position="(\d+)" aria-label="([^"]+)" aria-pressed="([^"]+)">/g;
    this.buttons = [...markup.matchAll(choiceMarkup)].map(([, value, label, selected]) => {
      const button = new TestElement();
      button.dataset.position = value;
      button.setAttribute("aria-label", label);
      button.setAttribute("aria-pressed", selected);
      return button;
    });
    const range = new TestElement();
    range.value = "0";
    this.selectors.set("[data-feedback-slider]", range);
    for (const selector of [
      "[data-device-card]",
      "[data-device-controls]",
      "[data-orientation]",
      "[data-leave]",
      "[data-end]",
      "[data-feedback-layout]",
      "[data-device-role-caption]",
      "[data-selected-position]",
      "[data-device-interaction-status]"
    ]) {
      this.selectors.set(selector, new TestElement());
    }
  }
}

function createDocument() {
  const ids = [
    "deviceGrid",
    "sessionStateBadge",
    "sessionStatus",
    "sessionFeedback",
    "startSessionButton",
    "sessionCodePanel",
    "sessionCodeOutput",
    "joinSessionForm",
    "sessionCodeInput",
    "joinApprovalPanel",
    "approveJoinButton",
    "rejectJoinButton",
    "copySessionCodeButton",
    "sessionActions",
    "devicesSection"
  ];
  const elements = new Map(ids.map(id => [id, new TestElement()]));
  elements.get("joinSessionForm").selectors.set("button[type=submit]", new TestElement());
  const connectionStatuses = new Map(["A", "B"].map(deviceId => [deviceId, new TestElement()]));
  return {
    elements,
    document: {
      getElementById(id) {
        assert.ok(elements.has(id), `Unexpected page element requested: ${id}`);
        return elements.get(id);
      },
      querySelector(selector) {
        const deviceId = selector.match(
          /^\[data-session-connection-status="([AB])"\]$/
        )?.[1];
        return deviceId ? connectionStatuses.get(deviceId) : null;
      },
      addEventListener() {}
    }
  };
}

function jsonResponse(payload, status = 201) {
  return {
    ok: true,
    status,
    headers: { get: name => name === "content-type" ? "application/json" : null },
    json: async () => payload
  };
}

async function testPageLoadsAndStartsSession() {
  const scriptTags = [...page.matchAll(/<script\b([^>]*)\bsrc="([^"]+)"([^>]*)><\/script>/g)];
  const scripts = scriptTags.map(([, before, src, after]) => ({
    src,
    attributes: `${before} ${after}`
  }));
  const expectedScripts = [
    "/traningsverktyg/massagefeedback/session-model.js",
    "/traningsverktyg/massagefeedback/session-api.js",
    "/traningsverktyg/massagefeedback/massagefeedback.js"
  ];
  const loadedScripts = scripts.filter(script =>
    expectedScripts.some(expected => script.src.startsWith(`${expected}?`) || script.src === expected)
  );

  assert.deepStrictEqual(
    loadedScripts.map(script => script.src.split("?")[0]),
    expectedScripts,
    "The page must load the model, API, and UI scripts in dependency order."
  );
  loadedScripts.forEach(script => {
    assert.match(script.attributes, /\bdefer\b/, `${script.src} must be deferred with the other page scripts.`);
    assert.doesNotMatch(script.attributes, /\basync\b/, `${script.src} must not execute out of order.`);
  });

  const scriptSources = loadedScripts.map(({ src }) => {
    const scriptUrl = new URL(src, "https://halsopulsen.se");
    const filePath = path.join(root, scriptUrl.pathname.replace(/^\/+/, ""));
    const source = fs.readFileSync(filePath, "utf8");
    if (scriptUrl.pathname.endsWith("/session-model.js")
      || scriptUrl.pathname.endsWith("/massagefeedback.js")) {
      const expectedHash = crypto.createHash("sha256").update(source).digest("hex");
      assert.strictEqual(
        scriptUrl.searchParams.get("v"),
        `sha256-${expectedHash}`,
        `${scriptUrl.pathname} must use a content fingerprint so cached scripts cannot be mixed.`
      );
    }
    return source;
  });

  const { document, elements } = createDocument();
  const calls = [];
  let resolveCreateSession;
  const window = {
    location: { hostname: "halsopulsen.se" },
    setTimeout() { return 1; },
    clearTimeout() {},
    setInterval() { return 2; },
    clearInterval() {},
    addEventListener() {},
    fetch(url, options) {
      calls.push({ url, options });
      if (options.method === "POST" && url.endsWith("/sessions")) {
        return new Promise(resolve => { resolveCreateSession = resolve; });
      }
      if (url.endsWith("/events")) {
        return Promise.resolve({
          ok: false,
          status: 503,
          headers: { get: name => name === "content-type" ? "application/json" : null },
          json: async () => ({ error: "Test event stream unavailable." })
        });
      }
      throw new Error(`Unexpected Massagefeedback request: ${options.method} ${url}`);
    }
  };
  const context = vm.createContext({
    window,
    document,
    AbortController,
    TextDecoder,
    console
  });

  for (const source of scriptSources) vm.runInContext(source, context);

  const model = window.MassageFeedbackModel;
  assert.ok(model, "The real page model script must publish its browser API.");
  assert.deepStrictEqual(
    Array.from(model.CHOICES, ({ label, value }) => [label, value]),
    [
      ["GREAT", 0],
      ["GOOD", 1],
      ["NOT MUCH", 2],
      ["5", 4],
      ["6", 5],
      ["7", 6],
      ["8", 7],
      ["9+", 8]
    ]
  );
  assert.strictEqual(model.isValidPosition(3), false);
  assert.strictEqual(model.isValidPosition(9), false);
  assert.strictEqual(model.isValidPosition(10), false);

  const grid = elements.get("deviceGrid");
  assert.strictEqual(grid.buttons.length, 8, "Initialization must render all eight available choices.");
  assert.deepStrictEqual(
    grid.buttons.map(button => [button.attributes.get("aria-label"), Number(button.dataset.position)]),
    Array.from(model.CHOICES, ({ label, value }) => [label, value])
  );
  const slider = grid.querySelector("[data-feedback-slider]");
  assert.strictEqual(slider.value, "0");

  const startButton = elements.get("startSessionButton");
  const click = startButton.listeners.get("click")?.[0];
  assert.strictEqual(typeof click, "function", "The start button must receive its session handler.");
  click();
  assert.strictEqual(calls.length, 1, "Clicking start must request a new session.");
  assert.strictEqual(
    calls[0].url,
    "https://booking.halsopulsen.se/api/massagefeedback/sessions"
  );
  assert.strictEqual(calls[0].options.method, "POST");
  assert.strictEqual(startButton.disabled, true, "The start button must lock while the session is created.");

  assert.strictEqual(typeof resolveCreateSession, "function", "The mocked API must receive the start request.");
  resolveCreateSession(jsonResponse({
    ok: true,
    code: "A7K2",
    capability: "test-host-capability",
    state: {
      code: "A7K2",
      status: "waiting",
      position: 0,
      activeControl: null,
      participants: [{ role: "host", connected: false }],
      pendingJoin: null
    }
  }));
  await new Promise(resolve => setImmediate(resolve));

  assert.strictEqual(elements.get("sessionCodeOutput").textContent, "A7K2");
  assert.strictEqual(elements.get("sessionStateBadge").dataset.state, "waiting");
  assert.strictEqual(elements.get("sessionActions").hidden, true);
  assert.strictEqual(elements.get("devicesSection").hidden, false);
  assert.strictEqual(startButton.disabled, true, "The active host cannot start a duplicate session.");
  assert.strictEqual(
    grid.querySelector("[data-selected-position]").textContent,
    "GREAT"
  );
  assert.ok(calls.some(call => call.url.endsWith("/sessions/A7K2/events")));
}

testPageLoadsAndStartsSession().then(() => {
  console.log("Massagefeedback page initialization tests passed.");
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
