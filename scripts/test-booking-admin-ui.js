const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

class FakeElement {
  constructor(id) {
    this.id = id;
    this.hidden = false;
    this.open = false;
    this.value = "";
    this.textContent = "";
    this.innerHTML = "";
    this.disabled = false;
    this.style = {};
    this.listeners = {};
    this.attributes = {};
    this.classList = {
      values: new Set(),
      add: (...values) => values.forEach(value => this.classList.values.add(value)),
      remove: (...values) => values.forEach(value => this.classList.values.delete(value)),
      toggle: (value, enabled) => enabled
        ? this.classList.values.add(value)
        : this.classList.values.delete(value)
    };
    this.showModal = () => {
      this.open = true;
    };
    this.close = () => {
      this.open = false;
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

  setAttribute(name, value) {
    this.attributes[name] = value;
  }
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
    },
    {
      id: "3",
      date: "2026-09-02",
      start: "12:00",
      end: "13:00",
      status: "cancelled",
      clientName: "Cancelled customer",
      email: "cancelled@example.test",
      serviceName: "Test session",
      effectiveBreakMinutes: 15,
      notes: ""
    }
  ];
  const calls = [];
  const historyCalls = [];
  const response = data => ({ ok: true, json: async () => data });
  const fetch = async (path, options = {}) => {
    calls.push({ path, options });
    if (path.includes("/appointments/history?")) {
      const requestUrl = new URL(path, "http://test.invalid");
      historyCalls.push(requestUrl);
      const page = Number(requestUrl.searchParams.get("page"));
      return response({
        appointments: [{
          id: `history-${page}`,
          date: "2022-03-15",
          start: "10:00",
          end: "11:00",
          status: "completed",
          clientName: `Ada Lovelace ${page}`,
          email: `ada-${page}@example.test`,
          phone: "+46000000000",
          serviceName: "Massage",
          effectiveBreakMinutes: 10,
          notes: "Historical note"
        }],
        pagination: { page, pageSize: 50, hasNextPage: page === 1 }
      });
    }
    if (path.includes("/appointments?")) return response({ appointments });
    if (path.endsWith("/appointments/3") && options.method === "DELETE") {
      return response({ ok: true, appointment: { id: "3" } });
    }
    if (path.includes("/calendar?")) return response({ from: "2026-08-30", to: "2026-09-13", appointments: [], blockedTimes: [] });
    if (path.endsWith("/services")) return response({
      services: [{
        id: "7",
        name: "Massage",
        active: true,
        durationMinutes: 60,
        defaultBreakMinutes: 10,
        displayOrder: 1,
        description: ""
      }]
    });
    if (path.endsWith("/hours")) return response({ rules: [] });
    if (path.endsWith("/overrides")) return response({ overrides: [] });
    if (path.endsWith("/blocks")) return response({ blockedTimes: [] });
    if (path.endsWith("/settings")) return response({ settings: { minimumNoticeHours: 0 } });
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
  const initialUpcomingCalls = calls.filter(call => call.path.includes("/appointments?"));
  assert.strictEqual(initialUpcomingCalls.length, 1, "The existing upcoming view must remain the initial booking request.");
  const upcomingParams = new URL(initialUpcomingCalls[0].path, "http://test.invalid").searchParams;
  assert(upcomingParams.get("from"), "The upcoming view must keep its existing date-range default.");
  assert(upcomingParams.get("to"), "The upcoming view must keep its existing date-range default.");
  assert.strictEqual(historyCalls.length, 0, "History must load only when its view is opened.");
  const clickAppointment = id => document.dispatch("click", {
    target: { closest: () => ({ dataset: { editAppointment: id } }) }
  });

  await clickAppointment("1");
  assert.strictEqual(get("edit-appointment-date").value, "2026-08-30");
  assert.strictEqual(get("edit-appointment-time").value, "13:00");
  assert.strictEqual(String(get("settings-minimum-notice").value), "0");
  assert(get("appointments-list").innerHTML.includes('class="is-selected"'));
  assert(!get("appointment-detail").innerHTML.includes("Markera klar"));

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
  assert(get("appointment-detail").innerHTML.includes("Markera klar"));
  await clickAppointment("3");
  assert(get("appointment-detail").innerHTML.includes('data-delete-appointment="3"'));
  await document.dispatch("click", {
    target: { closest: () => ({ dataset: { deleteAppointment: "3" } }) }
  });
  assert.strictEqual(get("booking-confirmation-dialog").open, true);
  assert.strictEqual(get("booking-confirmation-title").textContent, "Ta bort bokning?");
  assert.strictEqual(
    get("booking-confirmation-message").textContent,
    "Bokningen tas bort permanent och kan inte återställas."
  );
  await get("booking-confirmation-cancel").dispatch("click");
  assert.strictEqual(
    calls.filter(call => call.path.endsWith("/appointments/3") && call.options.method === "DELETE").length,
    0,
    "Cancelling deletion must not send a DELETE request."
  );
  await document.dispatch("click", {
    target: { closest: () => ({ dataset: { deleteAppointment: "3" } }) }
  });
  await get("booking-confirmation-confirm").dispatch("click");
  await flush();
  assert.strictEqual(
    calls.filter(call => call.path.endsWith("/appointments/3") && call.options.method === "DELETE").length,
    1,
    "Confirmed deletion must send exactly one DELETE request."
  );
  await get("close-appointment-editor").dispatch("click");
  assert.strictEqual(get("appointment-editor").hidden, true);
  assert(!get("appointments-list").innerHTML.includes('class="is-selected"'));

  await document.dispatch("click", {
    target: { closest: () => ({ dataset: { appointmentView: "history" } }) }
  });
  await flush();
  assert.strictEqual(get("appointment-view-history").hidden, false);
  assert.strictEqual(get("appointment-view-upcoming").hidden, true);
  assert.strictEqual(get("appointment-view-history-button").attributes["aria-selected"], "true");
  assert.strictEqual(historyCalls.length, 1, "Opening history must request its own paginated endpoint.");
  assert(get("history-appointments-list").innerHTML.includes("ada-1@example.test"));
  assert.strictEqual(get("history-next").disabled, false);

  await get("history-next").dispatch("click");
  await flush();
  assert.strictEqual(historyCalls.at(-1).searchParams.get("page"), "2");
  assert(get("history-appointments-list").innerHTML.includes('data-edit-appointment="history-2"'));
  assert.strictEqual(get("history-page-label").textContent, "Sida 2");
  assert.strictEqual(get("history-next").disabled, true);
  assert.strictEqual(get("history-previous").disabled, false);

  get("history-search").value = "Ada";
  get("history-service").value = "7";
  get("history-status").value = "completed";
  get("history-from").value = "2022-03-01";
  get("history-to").value = "2022-03-31";
  await get("history-filters").dispatch("submit");
  await flush();
  const filteredHistoryUrl = historyCalls.at(-1);
  assert.strictEqual(filteredHistoryUrl.searchParams.get("search"), "Ada");
  assert.strictEqual(filteredHistoryUrl.searchParams.get("serviceId"), "7");
  assert.strictEqual(filteredHistoryUrl.searchParams.get("status"), "completed");
  assert.strictEqual(filteredHistoryUrl.searchParams.get("from"), "2022-03-01");
  assert.strictEqual(filteredHistoryUrl.searchParams.get("to"), "2022-03-31");
  assert.strictEqual(filteredHistoryUrl.searchParams.get("page"), "1");
  assert(get("history-appointments-list").innerHTML.includes('data-edit-appointment="history-1"'));

  await get("history-next").dispatch("click");
  await flush();
  assert.strictEqual(historyCalls.at(-1).searchParams.get("page"), "2");
  assert(get("history-appointments-list").innerHTML.includes('data-edit-appointment="history-2"'));
  assert.strictEqual(get("history-page-label").textContent, "Sida 2");
  assert.strictEqual(get("history-next").disabled, true);
  assert.strictEqual(get("history-previous").disabled, false);
  await get("history-previous").dispatch("click");
  await flush();
  assert.strictEqual(historyCalls.at(-1).searchParams.get("page"), "1");

  await clickAppointment("history-1");
  assert.strictEqual(get("appointment-editor").hidden, false);
  assert(get("appointment-detail").innerHTML.includes("ada-1@example.test"));
  assert(get("appointment-detail").innerHTML.includes("+46000000000"));

  const adminHtml = fs.readFileSync("dashboard/admin/booking.html", "utf8");
  assert(adminHtml.includes('data-appointment-view="history"'));
  [
    "appointment-view-upcoming",
    "appointment-view-history",
    "history-search",
    "history-service",
    "history-status",
    "history-from",
    "history-to",
    "history-appointments-list",
    "history-previous",
    "history-next"
  ].forEach(id => assert(adminHtml.includes(`id="${id}"`), `History UI is missing ${id}.`));

  console.log("Booking admin UI checks passed: upcoming defaults, history search/filters/pagination, and shared appointment details.");
}

main().catch(error => {
  console.error(`Booking admin UI test failed: ${error.message}`);
  process.exitCode = 1;
});