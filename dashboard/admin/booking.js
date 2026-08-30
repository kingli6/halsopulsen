(() => {
  const state = {
    services: [],
    rules: [],
    overrides: [],
    blocks: [],
    appointments: [],
    calendar: null,
    editingAppointment: null
  };
  const weekdays = ["", "Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag", "Lördag", "Söndag"];
  const statusLabels = {
    pending: "Väntar",
    alternative_suggested: "Förslag skickat",
    confirmed: "Bekräftad",
    cancelled: "Avbokad",
    completed: "Genomförd"
  };

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[character]));
  const today = () => new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
  const plusDays = (date, amount) => {
    const value = new Date(`${date}T12:00:00Z`);
    value.setUTCDate(value.getUTCDate() + amount);
    return value.toISOString().slice(0, 10);
  };
  const formatDate = value => value
    ? new Intl.DateTimeFormat("sv-SE", { dateStyle: "medium", timeZone: "Europe/Stockholm" }).format(new Date(`${value}T12:00:00+01:00`))
    : "—";
  const formatInstant = value => new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Stockholm"
  }).format(new Date(value));
  const toast = message => {
    const element = $("toast");
    element.textContent = message;
    element.classList.add("visible");
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => element.classList.remove("visible"), 3500);
  };
  const message = (text, error = false) => {
    const element = $("page-message");
    element.textContent = text;
    element.hidden = !text;
    element.style.borderColor = error ? "#e1aaa3" : "";
    element.style.background = error ? "#fff4f2" : "";
    element.style.color = error ? "#8f3e35" : "";
  };

  async function api(path, options = {}) {
    const response = await fetch(`/api/booking/admin${path}`, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options
    });
    if (response.status === 401) {
      window.location.href = `/admin?next=${encodeURIComponent("/admin/booking/")}`;
      throw new Error("Admin sign-in required.");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || "Något gick fel.");
    return data;
  }

  function alternativeFeedback(text, error = false) {
    const element = $("alternative-feedback");
    element.textContent = text || "";
    element.hidden = !text;
    element.classList.toggle("error", error);
  }

  function appointmentFeedback(text) {
    const element = $("appointment-feedback");
    element.textContent = text || "";
    element.hidden = !text;
  }

  function alternativeErrorMessage(error) {
    return error?.code === "slot_unavailable"
      ? "Den föreslagna tiden är inte längre tillgänglig."
      : error.message;
  }

  async function checkAlternativeAvailability(appointment, date, start) {
    const params = new URLSearchParams({
      service: String(appointment.serviceId),
      from: date,
      to: date
    });
    const response = await fetch(`/api/booking/availability?${params.toString()}`, {
      credentials: "same-origin"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      const error = new Error(data.error || "Tiden kunde inte kontrolleras.");
      error.code = data.code;
      throw error;
    }
    const day = Array.isArray(data.dates)
      ? data.dates.find(item => item.date === date)
      : null;
    if (!day?.times?.some(slot => slot.localTime === start)) {
      const error = new Error("Den föreslagna tiden är inte längre tillgänglig.");
      error.code = "slot_unavailable";
      throw error;
    }
  }

  function formPayload(form, fields) {
    const data = {};
    fields.forEach(([key, id, type]) => {
      const element = $(id);
      data[key] = type === "number"
        ? Number(element.value)
        : type === "boolean"
          ? element.checked
          : element.value;
    });
    return data;
  }

  async function loadResources() {
    const [services, hours, overrides, blocks] = await Promise.all([
      api("/services"), api("/hours"), api("/overrides"), api("/blocks")
    ]);
    state.services = services.services;
    state.rules = hours.rules;
    state.overrides = overrides.overrides;
    state.blocks = blocks.blockedTimes;
    renderServices();
    renderRules();
    renderOverrides();
    renderBlocks();
  }

  async function loadAppointments() {
    const params = new URLSearchParams();
    if ($("appointment-status").value) params.set("status", $("appointment-status").value);
    if ($("appointment-from").value) params.set("from", $("appointment-from").value);
    if ($("appointment-to").value) params.set("to", $("appointment-to").value);
    const data = await api(`/appointments?${params}`);
    state.appointments = data.appointments;
    $("appointment-count").textContent = `${state.appointments.length} bokningar`;
    renderAppointments();
  }

  async function loadCalendar() {
    const from = $("calendar-from").value;
    const to = $("calendar-to").value;
    const data = await api(`/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    state.calendar = data;
    renderCalendar();
  }

  async function refreshAll() {
    message("");
    try {
      await Promise.all([loadResources(), loadAppointments(), loadCalendar()]);
      toast("Allt är uppdaterat.");
    } catch (error) {
      message(error.message, true);
    }
  }

  function renderServices() {
    $("services-list").innerHTML = state.services.length ? state.services.map(service => `
      <div class="resource-item">
        <div class="resource-main">
          <strong>${esc(service.name)} ${service.active ? "" : '<span class="status-pill status-cancelled">Inaktiv</span>'}</strong>
          <span>${service.durationMinutes} min · ${service.defaultBreakMinutes} min paus · ${esc(service.description || "Ingen beskrivning")}</span>
        </div>
        <div class="resource-actions"><button class="text-button" data-edit-service="${service.id}" type="button">Redigera</button></div>
      </div>
    `).join("") : '<div class="empty-resource">Inga tjänster ännu.</div>';
  }

  function renderRules() {
    $("hours-list").innerHTML = state.rules.length ? state.rules.map(rule => `
      <div class="resource-item">
        <div class="resource-main">
          <strong>${weekdays[rule.weekday]} · ${esc(rule.start)}–${esc(rule.end)} ${rule.active ? "" : '<span class="status-pill status-cancelled">Inaktiv</span>'}</strong>
          <span>Gäller ${formatDate(rule.effectiveFrom)}${rule.effectiveUntil ? `–${formatDate(rule.effectiveUntil)}` : " och framåt"}</span>
        </div>
        <div class="resource-actions">
          <button class="text-button" data-edit-rule="${rule.id}" type="button">Redigera</button>
          <button class="text-button danger-button" data-delete-rule="${rule.id}" type="button">Ta bort</button>
        </div>
      </div>
    `).join("") : '<div class="empty-resource">Inga arbetstider ännu.</div>';
  }

  function renderOverrides() {
    $("overrides-list").innerHTML = state.overrides.length ? state.overrides.map(item => `
      <div class="resource-item">
        <div class="resource-main">
          <strong>${formatDate(item.date)} · ${item.unavailable ? "Helt stängt" : `${esc(item.start)}–${esc(item.end)}`} ${item.active ? "" : '<span class="status-pill status-cancelled">Inaktivt</span>'}</strong>
          <span>${esc(item.reason || "Ingen anteckning")}</span>
        </div>
        <div class="resource-actions">
          <button class="text-button" data-edit-override="${item.id}" type="button">Redigera</button>
          <button class="text-button danger-button" data-delete-override="${item.id}" type="button">Ta bort</button>
        </div>
      </div>
    `).join("") : '<div class="empty-resource">Inga undantag ännu.</div>';
  }

  function renderBlocks() {
    $("blocks-list").innerHTML = state.blocks.length ? state.blocks.map(item => `
      <div class="resource-item">
        <div class="resource-main">
          <strong>${formatDate(item.date)} · ${esc(item.start)}–${esc(item.end)}</strong>
          <span>${esc(item.reason || "Ingen anledning")}</span>
        </div>
        <div class="resource-actions">
          <button class="text-button" data-edit-block="${item.id}" type="button">Redigera</button>
          <button class="text-button danger-button" data-delete-block="${item.id}" type="button">Ta bort</button>
        </div>
      </div>
    `).join("") : '<div class="empty-resource">Inga blockerade tider ännu.</div>';
  }

  function statusPill(status) {
    return `<span class="status-pill status-${esc(status)}">${esc(statusLabels[status] || status)}</span>`;
  }

  function renderAppointments() {
    $("appointments-list").innerHTML = state.appointments.length ? state.appointments.map(item => `
      <tr>
        <td>${esc(item.date)}<small>${esc(item.start)}–${esc(item.end)}</small></td>
        <td>${esc(item.clientName)}<small>${esc(item.email)}</small></td>
        <td>${esc(item.serviceName)}<small>${item.effectiveBreakMinutes} min paus</small></td>
        <td>${statusPill(item.status)}</td>
        <td><div class="row-actions"><button class="text-button" data-edit-appointment="${item.id}" type="button">Öppna</button></div></td>
      </tr>
    `).join("") : '<tr><td colspan="5" class="empty-resource">Inga bokningar matchar filtret.</td></tr>';
  }

  function renderCalendar() {
    const calendar = state.calendar;
    if (!calendar) return;
    const events = [
      ...calendar.appointments.map(item => ({ ...item, kind: "appointment", day: item.date, start: item.start, end: item.end })),
      ...calendar.blockedTimes.map(item => ({ ...item, kind: "blocked", day: item.date, start: item.start, end: item.end }))
    ].sort((a, b) => `${a.day}${a.start}`.localeCompare(`${b.day}${b.start}`));
    const days = [];
    for (let date = calendar.from; date <= calendar.to; date = plusDays(date, 1)) {
      days.push(date);
    }
    $("calendar-list").innerHTML = days.map(date => {
      const dayEvents = events.filter(item => item.day === date);
      return `
        <div class="calendar-day">
          <h3><span>${formatDate(date)}</span><small>${dayEvents.length} händelser</small></h3>
          ${dayEvents.length ? dayEvents.map(item => item.kind === "blocked"
            ? `<div class="calendar-event blocked"><time>${esc(item.start)}–${esc(item.end)}</time><strong>Blockerad tid</strong><span>${esc(item.reason || "")}</span></div>`
            : `<div class="calendar-event"><time>${esc(item.start)}–${esc(item.end)}</time><strong>${esc(item.clientName)}</strong><span>${esc(item.serviceName)} · ${statusLabels[item.status]}</span></div>`
          ).join("") : '<div class="empty-resource">Inget planerat.</div>'}
        </div>
      `;
    }).join("");
  }

  function resetService() {
    $("service-id").value = "";
    $("service-form-title").textContent = "Lägg till tjänst";
    $("service-name").value = "";
    $("service-description").value = "";
    $("service-duration").value = 60;
    $("service-break").value = 15;
    $("service-order").value = 0;
    $("service-active").checked = true;
  }

  function resetHours() {
    $("hours-id").value = "";
    $("hours-form-title").textContent = "Lägg till period";
    $("hours-weekday").value = "1";
    $("hours-start").value = "09:00";
    $("hours-end").value = "17:00";
    $("hours-effective-from").value = today();
    $("hours-effective-until").value = "";
    $("hours-active").checked = true;
  }

  function resetOverride() {
    $("override-id").value = "";
    $("override-form-title").textContent = "Lägg till undantag";
    $("override-date").value = today();
    $("override-type").value = "period";
    $("override-start").value = "09:00";
    $("override-end").value = "17:00";
    $("override-reason").value = "";
    $("override-active").checked = true;
    toggleOverrideTimes();
  }

  function resetBlock() {
    $("block-id").value = "";
    $("block-form-title").textContent = "Blockera tid";
    $("block-date").value = today();
    $("block-start").value = "12:00";
    $("block-end").value = "13:00";
    $("block-reason").value = "";
  }

  function toggleOverrideTimes() {
    $("override-times").hidden = $("override-type").value === "unavailable";
  }

  function openAppointment(item) {
    state.editingAppointment = item;
    $("appointment-editor").hidden = false;
    $("appointment-id").value = item.id;
    $("edit-appointment-date").value = item.date;
    $("edit-appointment-time").value = item.start;
    $("edit-appointment-break").value = item.breakMinutesOverride ?? "";
    $("edit-appointment-status").value = item.status;
    $("alternative-date").value = item.date;
    $("alternative-time").value = item.start;
    alternativeFeedback("");
    appointmentFeedback("");
    $("alternative-time-box").hidden = item.status !== "pending";
    $("appointment-detail").innerHTML = `
      <div class="appointment-summary">
        <strong>${esc(item.clientName)} · ${esc(item.serviceName)}</strong>
        <span>${esc(item.email)}${item.phone ? ` · ${esc(item.phone)}` : ""}</span>
        <span>${esc(item.notes || "Ingen kundanteckning")}</span>
      </div>
      <div class="quick-actions">
        ${["pending", "cancelled"].includes(item.status)
          ? `<button class="button button-secondary button-small" data-quick-status="confirmed" type="button">${item.status === "cancelled" ? "Återaktivera och bekräfta" : "Bekräfta"}</button>`
          : ""}
        ${item.status !== "cancelled" ? '<button class="button button-secondary button-small" data-quick-status="cancelled" type="button">Avboka</button>' : ""}
        ${["pending", "confirmed"].includes(item.status) ? '<button class="button button-secondary button-small" data-quick-status="completed" type="button">Markera klar</button>' : ""}
      </div>
    `;
    $("appointment-editor").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async function saveResource(path, method, payload, successMessage) {
    await api(path, { method, body: JSON.stringify(payload) });
    await loadResources();
    toast(successMessage);
  }

  async function handleFormSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      if (form.id === "service-form") {
        const id = $("service-id").value;
        const payload = formPayload(form, [
          ["name", "service-name"], ["description", "service-description"],
          ["durationMinutes", "service-duration", "number"], ["defaultBreakMinutes", "service-break", "number"],
          ["displayOrder", "service-order", "number"], ["active", "service-active", "boolean"]
        ]);
        await saveResource(`/services${id ? `/${id}` : ""}`, id ? "PUT" : "POST", payload, "Tjänsten sparades.");
        resetService();
      } else if (form.id === "hours-form") {
        const id = $("hours-id").value;
        const payload = formPayload(form, [
          ["weekday", "hours-weekday", "number"], ["start", "hours-start"], ["end", "hours-end"],
          ["effectiveFrom", "hours-effective-from"], ["effectiveUntil", "hours-effective-until"],
          ["active", "hours-active", "boolean"]
        ]);
        await saveResource(`/hours${id ? `/${id}` : ""}`, id ? "PUT" : "POST", payload, "Arbetstiden sparades.");
        resetHours();
      } else if (form.id === "override-form") {
        const id = $("override-id").value;
        const payload = formPayload(form, [
          ["date", "override-date"], ["start", "override-start"], ["end", "override-end"],
          ["reason", "override-reason"], ["active", "override-active", "boolean"]
        ]);
        payload.unavailable = $("override-type").value === "unavailable";
        await saveResource(`/overrides${id ? `/${id}` : ""}`, id ? "PUT" : "POST", payload, "Undantaget sparades.");
        resetOverride();
      } else if (form.id === "block-form") {
        const id = $("block-id").value;
        const payload = formPayload(form, [
          ["date", "block-date"], ["start", "block-start"], ["end", "block-end"], ["reason", "block-reason"]
        ]);
        await saveResource(`/blocks${id ? `/${id}` : ""}`, id ? "PUT" : "POST", payload, "Blockeringen sparades.");
        resetBlock();
      } else if (form.id === "appointment-form") {
        appointmentFeedback("");
        const id = $("appointment-id").value;
        const breakValue = $("edit-appointment-break").value;
        await api(`/appointments/${id}`, {
          method: "PATCH",
          body: JSON.stringify({
            date: $("edit-appointment-date").value,
            start: $("edit-appointment-time").value,
            breakMinutesOverride: breakValue === "" ? null : Number(breakValue),
            status: $("edit-appointment-status").value
          })
        });
        await loadAppointments();
        await loadCalendar();
        toast("Bokningen sparades.");
        appointmentFeedback("");
        $("appointment-editor").hidden = true;
      }
    } catch (error) {
      if (form.id === "appointment-form") {
        appointmentFeedback(error.message);
      } else {
        message(error.message, true);
      }
    }
  }

  function editService(id) {
    const item = state.services.find(value => value.id === String(id));
    if (!item) return;
    $("service-id").value = item.id;
    $("service-form-title").textContent = "Redigera tjänst";
    $("service-name").value = item.name;
    $("service-description").value = item.description || "";
    $("service-duration").value = item.durationMinutes;
    $("service-break").value = item.defaultBreakMinutes;
    $("service-order").value = item.displayOrder;
    $("service-active").checked = item.active;
    document.querySelector('[data-panel="services"]').click();
  }

  function editRule(id) {
    const item = state.rules.find(value => value.id === String(id));
    if (!item) return;
    $("hours-id").value = item.id;
    $("hours-form-title").textContent = "Redigera period";
    $("hours-weekday").value = item.weekday;
    $("hours-start").value = item.start;
    $("hours-end").value = item.end;
    $("hours-effective-from").value = item.effectiveFrom;
    $("hours-effective-until").value = item.effectiveUntil || "";
    $("hours-active").checked = item.active;
    document.querySelector('[data-panel="hours"]').click();
  }

  function editOverride(id) {
    const item = state.overrides.find(value => value.id === String(id));
    if (!item) return;
    $("override-id").value = item.id;
    $("override-form-title").textContent = "Redigera undantag";
    $("override-date").value = item.date;
    $("override-type").value = item.unavailable ? "unavailable" : "period";
    $("override-start").value = item.start || "";
    $("override-end").value = item.end || "";
    $("override-reason").value = item.reason || "";
    $("override-active").checked = item.active;
    toggleOverrideTimes();
    document.querySelector('[data-panel="overrides"]').click();
  }

  function editBlock(id) {
    const item = state.blocks.find(value => value.id === String(id));
    if (!item) return;
    $("block-id").value = item.id;
    $("block-form-title").textContent = "Redigera blockering";
    $("block-date").value = item.date;
    $("block-start").value = item.start;
    $("block-end").value = item.end;
    $("block-reason").value = item.reason || "";
    document.querySelector('[data-panel="blocks"]').click();
  }

  async function deleteResource(path, reload, label) {
    if (!window.confirm(`Ta bort ${label}?`)) return;
    try {
      await api(path, { method: "DELETE" });
      await reload();
      toast(`${label[0].toUpperCase()}${label.slice(1)} togs bort.`);
    } catch (error) {
      message(error.message, true);
    }
  }

  function setupTabs() {
    document.querySelectorAll(".booking-tab").forEach(button => button.addEventListener("click", () => {
      document.querySelectorAll(".booking-tab").forEach(item => {
        const active = item === button;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-selected", active ? "true" : "false");
      });
      document.querySelectorAll(".booking-panel").forEach(panel => {
        panel.hidden = panel.id !== `panel-${button.dataset.panel}`;
      });
    }));
  }

  function setupEvents() {
    ["service-form", "hours-form", "override-form", "block-form", "appointment-form"].forEach(id => {
      $(id).addEventListener("submit", handleFormSubmit);
    });
    $("appointment-filters").addEventListener("submit", event => {
      event.preventDefault();
      loadAppointments().catch(error => message(error.message, true));
    });
    $("calendar-filters").addEventListener("submit", event => {
      event.preventDefault();
      loadCalendar().catch(error => message(error.message, true));
    });
    $("refresh-all").addEventListener("click", refreshAll);
    $("reset-service").addEventListener("click", resetService);
    $("reset-hours").addEventListener("click", resetHours);
    $("reset-override").addEventListener("click", resetOverride);
    $("reset-block").addEventListener("click", resetBlock);
    $("override-type").addEventListener("change", toggleOverrideTimes);
    ["alternative-date", "alternative-time"].forEach(id => {
      $(id).addEventListener("input", () => alternativeFeedback(""));
    });
    $("close-appointment-editor").addEventListener("click", () => { $("appointment-editor").hidden = true; });
    $("logout-button").addEventListener("click", async () => {
      await fetch("/api/admin/logout", { method: "POST", credentials: "same-origin" });
      window.location.href = "/admin";
    });

    document.addEventListener("click", event => {
      const target = event.target.closest("button");
      if (!target) return;
      if (target.dataset.editService) editService(target.dataset.editService);
      if (target.dataset.editRule) editRule(target.dataset.editRule);
      if (target.dataset.editOverride) editOverride(target.dataset.editOverride);
      if (target.dataset.editBlock) editBlock(target.dataset.editBlock);
      if (target.dataset.editAppointment) {
        const item = state.appointments.find(value => value.id === target.dataset.editAppointment);
        if (item) openAppointment(item);
      }
      if (target.dataset.quickStatus && state.editingAppointment) {
        api(`/appointments/${state.editingAppointment.id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: target.dataset.quickStatus })
        }).then(async () => {
          await loadAppointments();
          await loadCalendar();
          state.editingAppointment.status = target.dataset.quickStatus;
          openAppointment(state.appointments.find(item => item.id === state.editingAppointment.id) || state.editingAppointment);
          toast("Bokningens status uppdaterades.");
        }).catch(error => message(error.message, true));
      }
      if (target.dataset.suggestAlternative && state.editingAppointment) {
        const date = $("alternative-date").value;
        const start = $("alternative-time").value;
        if (!date || !start) {
          alternativeFeedback("Välj datum och starttid för förslaget.", true);
          return;
        }
        target.disabled = true;
        alternativeFeedback("Kontrollerar tillgängligheten…");
        (async () => {
          try {
            await checkAlternativeAvailability(state.editingAppointment, date, start);
            await api(`/appointments/${state.editingAppointment.id}`, {
              method: "PATCH",
              body: JSON.stringify({
                action: "suggest_alternative",
                alternativeDate: date,
                alternativeStart: start
              })
            });
            await loadAppointments();
            await loadCalendar();
            const updated = state.appointments.find(item => item.id === state.editingAppointment.id);
            if (updated) openAppointment(updated);
            message("Ny tid föreslagen. Kunden behöver acceptera tiden.");
            toast("Ny tid föreslagen. Kunden behöver acceptera tiden.");
          } catch (error) {
            message("");
            alternativeFeedback(alternativeErrorMessage(error), true);
          } finally {
            target.disabled = false;
          }
        })();
      }
      if (target.dataset.deleteRule) deleteResource(`/hours/${target.dataset.deleteRule}`, loadResources, "arbetstiden");
      if (target.dataset.deleteOverride) deleteResource(`/overrides/${target.dataset.deleteOverride}`, loadResources, "undantaget");
      if (target.dataset.deleteBlock) deleteResource(`/blocks/${target.dataset.deleteBlock}`, loadResources, "blockeringen");
    });
  }

  function initialize() {
    const current = today();
    $("appointment-from").value = current;
    $("appointment-to").value = plusDays(current, 60);
    $("calendar-from").value = current;
    $("calendar-to").value = plusDays(current, 14);
    resetService();
    resetHours();
    resetOverride();
    resetBlock();
    setupTabs();
    setupEvents();
    refreshAll();
  }

  initialize();
})();