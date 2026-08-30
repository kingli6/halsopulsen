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
    this.style = {};
    this.listeners = {};
    this.classList = {
      values: new Set(),
      add: (...values) => values.forEach(value => this.classList.values.add(value)),
      remove: (...values) => values.forEach(value => this.classList.values.delete(value)),
      toggle: (value, enabled) => enabled
        ? this.classList.values.add(value)
        : this.classList.values.delete(value)
    };
  }

  addEventListener(type, listener) {
    (this.listeners[type] ||= []).push(listener);
  }

  async dispatch(type, event = {}) {
    const dispatched = {
      preventDefault() {},
      currentTarget: this,
      ...event
    };
    return Promise.all((this.listeners[type] || []).map(listener => listener(dispatched)));
  }

  setAttribute() {}
  scrollIntoView() {}
}

function createFakeDocument() {
  const elements = new Map();
  const listeners = {};
  return {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new FakeElement(id));
      return elements.get(id);
    },
    querySelectorAll() {
      return [];
    },
    addEventListener(type, listener) {
      (listeners[type] ||= []).push(listener);
    },
    async dispatch(type, event) {
      return Promise.all((listeners[type] || []).map(listener => listener(event)));
    },
    elements
  };
}

async function flush() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 0));
    await Promise.resolve();
  }
}

async function main() {
  const document = createFakeDocument();
  const appointments = [
    {
      id: "1",
      date: null,
      start: null,
      originalDate: "2026-08-30",
      originalStart: "13:00",
      originalEnd: "14:00",
      status: "pending",
      clientName: "Pending customer",
      email: "pending@example.test",
      serviceName: "Test session",
      effectiveBreakMinutes: 15,
      notes: ""
    },
    {
      id: "2",
      date: "2026-09-01",
      start: "10:00",
      end: "11:00",
      status: "confirmed",
      clientName: "Confirmed customer",
      email: "confirmed@example.test",
      serviceName: "Test session",
      effectiveBreakMinutes: 15,
      notes: ""
    }
  ];
  const response = data => ({ ok: true, json: async () => data });
  const fetch = async path => {
    if (path.includes("/appointments?")) return response({ appointments });
    if (path.includes("/calendar?")) return response({ from: "2026-08-30", to: "2026-09-13", appointments: [], blockedTimes: [] });
    if (path.endsWith("/services")) return response({ services: [] });
    if (path.endsWith("/hours")) return response({ rules: [] });
    if (path.endsWith("/overrides")) return response({ overrides: [] });
    if (path.endsWith("/blocks")) return response({ blockedTimes: [] });
    throw new Error(`Unexpected request: ${path}`);
  };
  const context = {
    console,
    document,
    fetch,
    URLSearchParams,
    Intl,
    Date,
    window: {
      clearTimeout,
      setTimeout,
      confirm: () => true,
      location: { href: "" }
    },
    setTimeout,
    clearTimeout
  };

  vm.runInNewContext(fs.readFileSync("dashboard/admin/booking.js", "utf8"), context);
  await flush();
  const get = id => document.getElementById(id);
  const clickAppointment = id => document.dispatch("click", {
    target: { closest: () => ({ dataset: { editAppointment: id } }) }
  });

  await clickAppointment("1");
  assert.strictEqual(get("edit-appointment-date").value, "2026-08-30");
  assert.strictEqual(get("edit-appointment-time").value, "13:00");
  assert(get("appointments-list").innerHTML.includes('class="is-selected"'));

  get("edit-appointment-date").value = "2026-09-02";
  await clickAppointment("1");
  assert.strictEqual(
    get("edit-appointment-date").value,
    "2026-09-02",
    "Reopening the same appointment must preserve an intentional edit."
  );

  await clickAppointment("2");
  assert.strictEqual(get("edit-appointment-date").value, "2026-09-01");
  assert(
    get("appointments-list").innerHTML.includes('data-edit-appointment="2"')
      && get("appointments-list").innerHTML.includes('class="is-selected"')
  );
  await get("close-appointment-editor").dispatch("click");
  assert.strictEqual(get("appointment-editor").hidden, true);
  assert(!get("appointments-list").innerHTML.includes('class="is-selected"'));

  console.log("Booking admin UI checks passed: selection highlight, pending time prefill, and edit preservation.");
}

main().catch(error => {
  console.error(`Booking admin UI test failed: ${error.message}`);
  process.exitCode = 1;
});