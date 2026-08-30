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
      return {
        ok: true,
        json: async () => ({ status: "pending" })
      };
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
    setTimeout,
    clearTimeout
  };
  const bookingScript = fs.readFileSync("booking/booking.js", "utf8");
  vm.runInNewContext(bookingScript, context);
  await flush();

  const get = id => document.getElementById(id);
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

  const adminHtml = fs.readFileSync("dashboard/admin/booking.html", "utf8");
  const adminJs = fs.readFileSync("dashboard/admin/booking.js", "utf8");
  assert(adminHtml.includes('id="alternative-feedback"'));
  assert(adminHtml.includes("kunden accepterar"));
  assert(adminJs.includes("Kontrollerar tillgängligheten"));
  assert(adminJs.includes("Ny tid föreslagen. Kunden behöver acceptera tiden."));
  assert(adminJs.includes("Den föreslagna tiden är inte längre tillgänglig."));
  console.log("Booking UI checks passed: rebooking reset, duplicate protection, and alternative-time feedback.");
}

main().catch(error => {
  console.error(`Booking UI test failed: ${error.message}`);
  process.exitCode = 1;
});