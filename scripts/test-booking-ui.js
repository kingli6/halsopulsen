const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

class FakeElement {
  constructor(id) {
    this.id = id;
    this.hidden = false;
    this.value = "";
    this.textContent = "";
    this.innerHTML = "";
    this.disabled = false;
    this.offsetTop = 0;
    this.style = {};
    this.listeners = {};
    this.classList = {
      values: new Set(),
      add: (...values) => values.forEach(value => this.classList.values.add(value)),
      remove: (...values) => values.forEach(value => this.classList.values.delete(value)),
      toggle: (value, enabled) => enabled ? this.classList.values.add(value) : this.classList.values.delete(value)
    };
  }

  addEventListener(type, listener) {
    (this.listeners[type] ||= []).push(listener);
  }

  dispatch(type, event = {}) {
    const dispatched = {
      preventDefault() {},
      currentTarget: this,
      ...event
    };
    if (this.id === "service-list") {
    }
    return Promise.all((this.listeners[type] || []).map(listener => listener(dispatched)));
  }

  reset() {
    this.value = "";
  }

  checkValidity() {
    return true;
  }

  reportValidity() {}
}

function createFakeDocument() {
  const elements = new Map();
  return {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new FakeElement(id));
      return elements.get(id);
    },
    querySelectorAll() {
      return [];
    },
    elements
  };
}

async function flush() {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 0));
    await Promise.resolve();
  }
}

async function main() {
  const document = createFakeDocument();
  const calls = [];
  let lastSlot = null;
  let requestHandler = async () => ({
    ok: true,
    json: async () => ({ status: "pending" })
  });
  const timeoutJobs = new Map();
  let nextTimeoutId = 1;
  const fakeSetTimeout = (callback, delay) => {
    const id = nextTimeoutId++;
    timeoutJobs.set(id, { callback, delay });
    return id;
  };
  const fakeClearTimeout = id => timeoutJobs.delete(id);
  document.getElementById("details-form").reset = () => {
    for (const id of ["client-name", "client-email", "client-phone", "client-notes"]) {
      document.getElementById(id).value = "";
    }
  };
  const fetch = async (path, options = {}) => {
    calls.push({ path, options });
    if (path === "/api/booking/services") {
      return {
        ok: true,
        json: async () => ({
          services: [{
            id: 1,
            name: "Test session",
            description: "Test",
            durationMinutes: 60
          }]
        })
      };
    }
    if (path.startsWith("/api/booking/availability?")) {
      const date = new URLSearchParams(path.split("?")[1]).get("from");
      lastSlot = {
        startAt: `${date}T08:00:00.000Z`,
        localTime: "09:00"
      };
      return {
        ok: true,
        json: async () => ({ dates: [{ date, times: [lastSlot], unavailableTimes: [] }] })
      };
    }
    if (path === "/api/booking/requests") {
      return requestHandler(options);
    }
    throw new Error(`Unexpected request: ${path}`);
  };

  const context = {
    console,
    document,
    fetch,
    URLSearchParams,
    window: {
      scrollTo() {}
    },
    AbortController,
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout
  };
  const bookingScript = fs.readFileSync("booking/booking.js", "utf8");
  vm.runInNewContext(bookingScript, context);
  await flush();

  const get = id => document.getElementById(id);
  async function prepareReview(name, email) {
    await get("service-list").dispatch("click", {
      target: {
        closest: () => ({ dataset: { serviceId: "1" } })
      }
    });
    await flush();
    assert(lastSlot, "Preparing a retry should load an available time.");
    await get("time-list").dispatch("click", {
      target: { closest: () => ({ dataset: { slot: lastSlot.startAt } }) }
    });
    get("client-name").value = name;
    get("client-email").value = email;
    get("client-notes").value = "Please call if needed.";
    await get("details-form").dispatch("submit");
    assert.strictEqual(get("step-review").hidden, false);
  }

  assert(
    get("service-list").innerHTML.includes("Test session"),
    `Service list did not render. HTML: ${get("service-list").innerHTML}`
  );
  await get("service-list").dispatch("click", {
    target: {
      closest: selector => {
        console.log("UI test closest", selector);
        return { dataset: { serviceId: "1" } };
      }
    }
  });
  await flush();
  assert(lastSlot, `Service selection did not load availability. Calls: ${calls.map(call => call.path).join(", ")}`);
  await get("time-list").dispatch("click", {
    target: { closest: () => ({ dataset: { slot: lastSlot.startAt } }) }
  });
  get("client-name").value = "Test customer";
  get("client-email").value = "test@example.test";
  get("client-notes").value = "x".repeat(1001);
  await get("client-notes").dispatch("input");
  assert.strictEqual(get("client-notes-count").textContent, "1001 / 1000");
  assert(get("client-notes-count").classList.values.has("is-over-limit"));
  await get("details-form").dispatch("submit");
  assert.strictEqual(get("step-details").hidden, false, "An over-limit message should not advance to review.");
  assert(
    get("booking-message").textContent.includes("1 000 tecken"),
    "The over-limit message should be clear and localized."
  );
  get("client-notes").value = "x".repeat(1000);
  await get("client-notes").dispatch("input");
  assert.strictEqual(get("client-notes-count").textContent, "1000 / 1000");
  assert(!get("client-notes-count").classList.values.has("is-over-limit"));
  await get("details-form").dispatch("submit");
  await get("submit-booking").dispatch("click");
  await flush();

  assert.strictEqual(get("step-confirmation").hidden, false, "Successful booking should show confirmation.");
  const bookingRequests = calls.filter(call => call.path === "/api/booking/requests");
  assert.strictEqual(bookingRequests.length, 1, "Initial booking should make exactly one request.");

  await get("book-another").dispatch("click");
  assert.strictEqual(get("step-service").hidden, false, "Boka en ny tid should return to service selection.");
  assert.strictEqual(get("step-confirmation").hidden, true, "Confirmation should be hidden after reset.");
  assert.strictEqual(get("client-name").value, "", "Customer name should reset for a new booking.");
  assert.strictEqual(get("client-notes-count").textContent, "0 / 1000", "The message counter should reset.");
  assert.strictEqual(
    calls.filter(call => call.path === "/api/booking/requests").length,
    1,
    "Returning to the booking flow must not create a duplicate booking."
  );

  // A slow successful response stays in the loading state, while repeated
  // clicks during the request are ignored.
  await prepareReview("Slow Customer", "slow@example.test");
  let resolveSlowRequest;
  requestHandler = () => new Promise(resolve => {
    resolveSlowRequest = resolve;
  });
  const slowRequestCount = calls.filter(call => call.path === "/api/booking/requests").length;
  const slowSubmission = get("submit-booking").listeners.click[0]();
  assert.strictEqual(get("submit-booking").disabled, true);
  assert(get("submit-booking").classList.values.has("is-loading"));
  assert.strictEqual(
    get("booking-message").textContent,
    "Skickar din bokningsförfrågan. Det kan ta en liten stund."
  );
  const slowTimeout = [...timeoutJobs.values()][0];
  assert(slowTimeout, "A submission timeout should be scheduled.");
  assert.strictEqual(slowTimeout.delay, 120_000);
  await get("submit-booking").listeners.click[0]();
  assert.strictEqual(
    calls.filter(call => call.path === "/api/booking/requests").length,
    slowRequestCount + 1,
    "Repeated clicks while submitting must not send another request."
  );
  assert.strictEqual(get("client-name").value, "Slow Customer");
  resolveSlowRequest({ ok: true, json: async () => ({ status: "pending" }) });
  await slowSubmission;
  assert.strictEqual(get("step-confirmation").hidden, false);
  assert.strictEqual(timeoutJobs.size, 0, "A completed request should clear its timeout.");

  const uncertainMessage =
    "Vi kunde inte bekräfta att din bokningsförfrågan skickades. Kontrollera gärna din e-post innan du försöker igen, så att du inte råkar skicka samma förfrågan två gånger. Kontakta oss gärna på halsopulsen@gmail.com om du är osäker.";

  // A timeout is uncertain because the backend may have saved the request
  // before the response was lost. It must not automatically retry.
  await get("book-another").dispatch("click");
  await prepareReview("Timeout Customer", "timeout@example.test");
  requestHandler = options => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => {
      const error = new Error("Request aborted by the test timeout.");
      error.name = "AbortError";
      reject(error);
    });
  });
  const requestsBeforeTimeout = calls.filter(call => call.path === "/api/booking/requests").length;
  const timedOutSubmission = get("submit-booking").listeners.click[0]();
  const timeoutJob = [...timeoutJobs.entries()][0];
  assert(timeoutJob, "The timed-out request should have an active timer.");
  timeoutJobs.delete(timeoutJob[0]);
  timeoutJob[1].callback();
  await timedOutSubmission;
  assert.strictEqual(get("booking-message").textContent, uncertainMessage);
  assert.strictEqual(get("client-name").value, "Timeout Customer");
  assert.strictEqual(get("client-email").value, "timeout@example.test");
  assert.strictEqual(get("client-notes").value, "Please call if needed.");
  assert.strictEqual(get("submit-booking").disabled, false);
  assert.strictEqual(
    calls.filter(call => call.path === "/api/booking/requests").length,
    requestsBeforeTimeout + 1,
    "A timeout must not automatically retry the booking request."
  );

  // Network errors have the same uncertain outcome, without showing raw
  // browser error text or discarding the form.
  await get("book-another").dispatch("click");
  await prepareReview("Network Customer", "network@example.test");
  requestHandler = async () => {
    throw new TypeError("Failed to fetch");
  };
  await get("submit-booking").dispatch("click");
  assert.strictEqual(get("booking-message").textContent, uncertainMessage);
  assert.strictEqual(get("client-name").value, "Network Customer");

  // Explicit server rejection is friendly and preserves the entered details.
  await get("book-another").dispatch("click");
  await prepareReview("Rejected Customer", "rejected@example.test");
  requestHandler = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ ok: false, error: "An internal validation detail." })
  });
  await get("submit-booking").dispatch("click");
  assert.strictEqual(
    get("booking-message").textContent,
    "Vi kunde inte skicka din bokningsförfrågan. Kontrollera uppgifterna och försök igen."
  );
  assert.strictEqual(get("client-name").value, "Rejected Customer");

  // A server error can be returned after the request reached the backend, so
  // it must be treated as an uncertain outcome rather than a definite reject.
  await get("book-another").dispatch("click");
  await prepareReview("Unavailable Customer", "unavailable@example.test");
  requestHandler = async () => ({
    ok: false,
    status: 503,
    json: async () => ({ ok: false, error: "The database is temporarily unavailable." })
  });
  const requestsBeforeServerError = calls.filter(call => call.path === "/api/booking/requests").length;
  await get("submit-booking").dispatch("click");
  assert.strictEqual(get("booking-message").textContent, uncertainMessage);
  assert.strictEqual(get("client-name").value, "Unavailable Customer");
  assert.strictEqual(
    calls.filter(call => call.path === "/api/booking/requests").length,
    requestsBeforeServerError + 1,
    "A server error must not automatically retry the booking request."
  );

  const adminHtml = fs.readFileSync("dashboard/admin/booking.html", "utf8");
  const adminJs = fs.readFileSync("dashboard/admin/booking.js", "utf8");
  assert(adminHtml.includes('id="alternative-feedback"'));
  assert(adminHtml.includes("kunden accepterar"));
   assert(adminHtml.includes('id="booking-confirmation-dialog"'));
   assert(adminHtml.includes('id="confirmation-personal-message"'));
   assert(adminHtml.includes('id="alternative-message"'));
  assert(adminJs.includes("Kontrollerar tillgängligheten"));
  assert(adminJs.includes("Ny tid föreslagen. Kunden behöver acceptera tiden."));
  assert(adminJs.includes("Den föreslagna tiden är inte längre tillgänglig."));
   assert(adminJs.includes('data-quick-status="${item.status === "cancelled" ? "pending" : "confirmed"}"'));
   assert(adminJs.includes('title: "Bekräfta bokning?"'));
   assert(adminJs.includes('confirmLabel: "Bekräfta och skicka"'));
   assert(adminJs.includes('title: "Skicka förslag på ny tid?"'));
   assert(adminJs.includes('confirmLabel: "Skicka förslag"'));
   assert(adminJs.includes("allowPersonalMessage: true"));
   assert(adminJs.includes("personalMessage"));
   assert(!adminJs.includes("Återaktivera och bekräfta"));
  console.log("Booking UI checks passed: rebooking reset, duplicate protection, and alternative-time feedback.");
}

main().catch(error => {
  console.error(`Booking UI test failed: ${error.message}`);
  process.exitCode = 1;
});