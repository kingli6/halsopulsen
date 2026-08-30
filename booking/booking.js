(() => {
  const MAX_NOTES_LENGTH = 1000;
  const state = {
    services: [],
    selectedService: null,
    selectedDate: "",
    availableTimes: [],
    unavailableTimes: [],
    selectedSlot: null,
    availabilityRequest: 0,
    submitting: false,
    step: "service"
  };

  const $ = id => document.getElementById(id);
  const escapeText = value => String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[character]));
  const dateFormatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    dateStyle: "long"
  });
  const today = () => new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
  const dateOptionFormatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    weekday: "long",
    day: "numeric",
    month: "short"
  });
  const BOOKING_HORIZON_DAYS = 60;

  function addDays(date, amount) {
    const value = new Date(`${date}T12:00:00Z`);
    value.setUTCDate(value.getUTCDate() + amount);
    return value.toISOString().slice(0, 10);
  }

  function dateOptionLabel(date) {
    const parts = dateOptionFormatter.formatToParts(new Date(`${date}T12:00:00Z`));
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const weekday = values.weekday ? `${values.weekday[0].toUpperCase()}${values.weekday.slice(1)}` : "";
    return `${weekday} ${values.day} ${(values.month || "").replace(/\./g, "")}`;
  }

  function populateDateOptions() {
    const dateSelect = $("booking-date");
    const current = today();
    dateSelect.innerHTML = Array.from({ length: BOOKING_HORIZON_DAYS + 1 }, (_, offset) => {
      const date = addDays(current, offset);
      return `<option value="${date}">${dateOptionLabel(date)}</option>`;
    }).join("");
    dateSelect.value = current;
  }

  function formatDate(date) {
    return date ? dateFormatter.format(new Date(`${date}T12:00:00+01:00`)) : "—";
  }

  function showMessage(text, { error = false } = {}) {
    const element = $("booking-message");
    element.textContent = text || "";
    element.hidden = !text;
    element.classList.toggle("error", error);
  }

  function clearMessage() {
    showMessage("");
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: "same-origin",
      headers: options.body ? { "Content-Type": "application/json" } : {},
      ...options
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      const error = new Error(data.error || "Något gick fel. Försök igen.");
      error.code = data.code;
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function renderServices() {
    const container = $("service-list");
    if (!state.services.length) {
      container.innerHTML = '<div class="empty-state">Det finns inga bokningsbara tjänster just nu.</div>';
      return;
    }
    container.innerHTML = state.services.map(service => `
      <button class="service-option${state.selectedService?.id === service.id ? " is-selected" : ""}"
        type="button" data-service-id="${escapeText(service.id)}" aria-pressed="${state.selectedService?.id === service.id}">
        <h3>${escapeText(service.name)}</h3>
        <p>${escapeText(service.description || "En personlig session anpassad efter dina behov.")}</p>
        <span class="service-meta">${escapeText(service.durationMinutes)} minuter</span>
      </button>
    `).join("");
  }

  function renderSelectedService() {
    const service = state.selectedService;
    $("selected-service").innerHTML = service
      ? `<span>${escapeText(service.name)}</span><small>${escapeText(service.durationMinutes)} minuter</small>`
      : "";
  }

  function renderTimes() {
    const container = $("time-list");
    const caption = $("availability-caption");
    caption.textContent = state.selectedDate ? formatDate(state.selectedDate) : "";

    if (!state.selectedDate) {
      container.innerHTML = '<div class="empty-state">Välj ett datum för att se lediga tider.</div>';
      return;
    }
    const timeOptions = [
      ...state.availableTimes.map(slot => ({ ...slot, available: true })),
      ...state.unavailableTimes.map(slot => ({ ...slot, available: false }))
    ].sort((left, right) => left.startAt.localeCompare(right.startAt));
    if (!timeOptions.length) {
      container.innerHTML = '<div class="empty-state">Det finns inga lediga tider. Prova ett annat datum.</div>';
      return;
    }
    container.innerHTML = timeOptions.map(slot => slot.available
      ? `<button class="time-option${state.selectedSlot?.startAt === slot.startAt ? " is-selected" : ""}"
          type="button" role="option" aria-selected="${state.selectedSlot?.startAt === slot.startAt}"
          data-slot="${escapeText(slot.startAt)}">${escapeText(slot.localTime)}</button>`
      : `<button class="time-option is-unavailable" type="button" role="option" aria-disabled="true" disabled
          aria-label="${escapeText(`${slot.localTime} · ${slot.reason === "booked" ? "Bokad" : "Inte tillgänglig"}`)}">
          <span>${escapeText(slot.localTime)}</span>
          <small>${slot.reason === "booked" ? "Bokad" : "Ej tillgänglig"}</small>
        </button>`
    ).join("");
  }

  function renderSelectedSlot() {
    const service = state.selectedService;
    const slot = state.selectedSlot;
    $("selected-slot").innerHTML = service && slot
      ? `<span>${escapeText(service.name)} · ${formatDate(state.selectedDate)} · ${escapeText(slot.localTime)}</span><small>${escapeText(service.durationMinutes)} minuter</small>`
      : "";
  }

  function setStep(step) {
    state.step = step;
    const steps = ["service", "schedule", "details", "review"];
    const index = steps.indexOf(step);
    const headings = {
      service: "Välj en tjänst",
      schedule: "Välj datum och tid",
      details: "Fyll i dina uppgifter",
      review: "Granska din bokning"
    };
    $("step-heading").textContent = headings[step] || headings.service;
    $("step-count").textContent = `${index + 1} av 4`;
    $("progress-bar").style.width = `${((index + 1) / steps.length) * 100}%`;
    ["service", "schedule", "details", "review", "confirmation"].forEach(name => {
      $(`step-${name}`).hidden = name !== step;
    });
    if (step === "schedule") renderSelectedService();
    if (step === "details") renderSelectedSlot();
    window.scrollTo({ top: $("booking-app").offsetTop - 24, behavior: "smooth" });
  }

  async function loadServices() {
    try {
      const data = await api("/api/booking/services");
      state.services = Array.isArray(data.services) ? data.services : [];
      renderServices();
      if (!state.services.length) {
        showMessage("Det finns inga bokningsbara tjänster just nu.", { error: true });
      }
    } catch (error) {
      $("service-list").innerHTML = '<div class="empty-state">Tjänsterna kunde inte laddas just nu. Försök igen om en stund.</div>';
      showMessage(error.message, { error: true });
    }
  }

  async function loadAvailability() {
    const requestId = ++state.availabilityRequest;
    state.availableTimes = [];
    state.unavailableTimes = [];
    state.selectedSlot = null;
    renderTimes();
    if (!state.selectedService || !state.selectedDate) return;

    $("time-list").innerHTML = '<div class="loading-state"><span class="loader" aria-hidden="true"></span>Letar efter lediga tider…</div>';
    try {
      const params = new URLSearchParams({
        service: String(state.selectedService.id),
        from: state.selectedDate,
        to: state.selectedDate
      });
      const data = await api(`/api/booking/availability?${params.toString()}`);
      if (requestId !== state.availabilityRequest) return;
      const day = Array.isArray(data.dates)
        ? data.dates.find(item => item.date === state.selectedDate)
        : null;
      state.availableTimes = Array.isArray(day?.times) ? day.times : [];
      state.unavailableTimes = Array.isArray(day?.unavailableTimes) ? day.unavailableTimes : [];
      renderTimes();
    } catch (error) {
      if (requestId !== state.availabilityRequest) return;
      $("time-list").innerHTML = '<div class="empty-state">Tiderna kunde inte laddas just nu. Försök igen.</div>';
      showMessage(error.message, { error: true });
    }
  }

  function selectService(id) {
    const service = state.services.find(item => String(item.id) === String(id));
    if (!service) return;
    clearMessage();
    state.selectedService = service;
    state.availableTimes = [];
    state.unavailableTimes = [];
    state.selectedSlot = null;
    renderServices();
    renderTimes();
    setStep("schedule");
    loadAvailability();
  }

  function selectSlot(startAt) {
    const slot = state.availableTimes.find(item => item.startAt === startAt);
    if (!slot) return;
    clearMessage();
    state.selectedSlot = slot;
    renderTimes();
    setStep("details");
  }

  function detailsPayload() {
    return {
      clientName: $("client-name").value.trim(),
      email: $("client-email").value.trim(),
      phone: $("client-phone").value.trim(),
      notes: $("client-notes").value.trim()
    };
  }

  function updateNotesCount() {
    const notes = $("client-notes").value;
    const counter = $("client-notes-count");
    counter.textContent = `${notes.length} / ${MAX_NOTES_LENGTH}`;
    counter.classList.toggle("is-over-limit", notes.length > MAX_NOTES_LENGTH);
  }

  function renderReview() {
    const details = detailsPayload();
    const service = state.selectedService;
    const slot = state.selectedSlot;
    const rows = [
      ["Tjänst", service?.name],
      ["Datum", formatDate(state.selectedDate)],
      ["Tid", slot?.localTime],
      ["Längd", service ? `${service.durationMinutes} minuter` : ""],
      ["Namn", details.clientName],
      ["E-post", details.email],
      ["Telefon", details.phone || "—"]
    ];
    if (details.notes) rows.push(["Meddelande", details.notes]);
    $("review-summary").innerHTML = rows.map(([label, value]) => `
      <div class="review-row"><span>${escapeText(label)}</span><span>${escapeText(value)}</span></div>
    `).join("");
  }

  function showConfirmation() {
    const service = state.selectedService;
    $("confirmation-details").textContent = `${service.name} · ${formatDate(state.selectedDate)} · ${state.selectedSlot.localTime} · ${service.durationMinutes} minuter`;
    $("step-heading").textContent = "Förfrågan skickad";
    $("step-count").textContent = "Klart";
    $("progress-bar").style.width = "100%";
    ["service", "schedule", "details", "review"].forEach(name => {
      $(`step-${name}`).hidden = true;
    });
    $("step-confirmation").hidden = false;
    window.scrollTo({ top: $("booking-app").offsetTop - 24, behavior: "smooth" });
  }

  function resetBookingFlow() {
    state.selectedService = null;
    state.selectedDate = today();
    state.availableTimes = [];
    state.unavailableTimes = [];
    state.selectedSlot = null;
    state.submitting = false;
    $("details-form").reset();
    updateNotesCount();
    $("booking-date").value = state.selectedDate;
    renderServices();
    renderTimes();
    clearMessage();
    setStep("service");
  }

  async function submitBooking() {
    if (state.submitting || !state.selectedService || !state.selectedSlot) return;
    state.submitting = true;
    const button = $("submit-booking");
    button.disabled = true;
    button.classList.add("is-loading");
    clearMessage();
    try {
      const details = detailsPayload();
      const result = await api("/api/booking/requests", {
        method: "POST",
        body: JSON.stringify({
          service: state.selectedService.id,
          startAt: state.selectedSlot.startAt,
          ...details
        })
      });
      if (result.status !== "pending") {
        throw new Error("Bokningsförfrågan kunde inte skickas med väntande status.");
      }
      showConfirmation();
    } catch (error) {
      if (error.code === "slot_unavailable" || error.status === 409) {
        showMessage("Den tiden hann bli bokad av någon annan. Välj en annan ledig tid.", { error: true });
        state.selectedSlot = null;
        setStep("schedule");
        await loadAvailability();
      } else if (error.code === "inactive_service") {
        showMessage("Tjänsten är inte längre tillgänglig. Välj en annan tjänst.", { error: true });
        state.selectedService = null;
        setStep("service");
        await loadServices();
      } else {
        showMessage(error.message, { error: true });
      }
    } finally {
      state.submitting = false;
      button.disabled = false;
      button.classList.remove("is-loading");
    }
  }

  function setupEvents() {
    $("service-list").addEventListener("click", event => {
      const button = event.target.closest("[data-service-id]");
      if (button) selectService(button.dataset.serviceId);
    });
    $("time-list").addEventListener("click", event => {
      const button = event.target.closest("[data-slot]");
      if (button) selectSlot(button.dataset.slot);
    });
    $("booking-date").addEventListener("change", event => {
      state.selectedDate = event.target.value;
      clearMessage();
      loadAvailability();
    });
    $("back-to-service").addEventListener("click", () => {
      clearMessage();
      setStep("service");
    });
    $("back-to-schedule").addEventListener("click", () => {
      clearMessage();
      setStep("schedule");
    });
    $("back-to-details").addEventListener("click", () => {
      clearMessage();
      setStep("details");
    });
    $("book-another").addEventListener("click", resetBookingFlow);
    $("client-notes").addEventListener("input", updateNotesCount);
    $("details-form").addEventListener("submit", event => {
      event.preventDefault();
      clearMessage();
      const form = event.currentTarget;
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      if (detailsPayload().notes.length > MAX_NOTES_LENGTH) {
        showMessage("Meddelandet får vara högst 1 000 tecken.", { error: true });
        updateNotesCount();
        return;
      }
      renderReview();
      setStep("review");
    });
    $("submit-booking").addEventListener("click", submitBooking);
  }

  function initialize() {
    state.selectedDate = today();
    populateDateOptions();
    updateNotesCount();
    setupEvents();
    loadServices();
  }

  initialize();
})();