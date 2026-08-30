(() => {
  const token = decodeURIComponent(window.location.pathname.split("/").filter(Boolean).pop() || "");
  const status = document.querySelector("#manage-status");
  const details = document.querySelector("#manage-details");
  const actions = document.querySelector("#manage-actions");
  const accept = document.querySelector("#accept-action");
  const decline = document.querySelector("#decline-action");
  const cancel = document.querySelector("#cancel-action");

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[character]));
  }

  function displayTime(value) {
    return `${esc(value?.date || "")} kl. ${esc(value?.time || "")}`;
  }

  function render(booking) {
    details.hidden = false;
    details.innerHTML = `
      <strong>${esc(booking.service.name)}</strong>
      <span>Efterfrågad tid: ${displayTime(booking.requested)}</span>
      <span>${esc(booking.service.durationMinutes)} minuter</span>
      ${booking.alternative ? `<span>Föreslagen ny tid: ${displayTime(booking.alternative)}</span>` : ""}
      ${booking.confirmed ? `<span>Bekräftad tid: ${displayTime(booking.confirmed)}</span>` : ""}
    `;
    actions.hidden = false;
    accept.hidden = booking.status !== "alternative_suggested";
    decline.hidden = booking.status !== "alternative_suggested";
    cancel.hidden = !["pending", "confirmed"].includes(booking.status);
    if (booking.status === "pending") {
      status.textContent = "Din förfrågan väntar fortfarande på granskning.";
    } else if (booking.status === "alternative_suggested") {
      status.textContent = "Du har fått ett förslag på en annan tid.";
    } else if (booking.status === "confirmed") {
      status.textContent = "Din bokning är bekräftad.";
    }
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Det gick inte att uppdatera bokningen.");
    return data;
  }

  async function load() {
    if (!token) throw new Error("Bokningslänken är ogiltig.");
    const data = await api(`/api/booking/actions/${encodeURIComponent(token)}`);
    render(data.booking);
  }

  async function runAction(button, path, successMessage) {
    button.disabled = true;
    status.textContent = "Uppdaterar bokningen …";
    try {
      const data = await api(`/api/booking/actions/${encodeURIComponent(token)}${path}`, { method: "POST", body: "{}" });
      status.textContent = successMessage;
      details.hidden = true;
      actions.hidden = true;
      if (data.manageToken) {
        window.history.replaceState({}, "", `/booking/manage/${encodeURIComponent(data.manageToken)}`);
      }
    } catch (error) {
      status.textContent = error.message;
      button.disabled = false;
    }
  }

  accept.addEventListener("click", () => runAction(accept, "/accept", "Tiden är bekräftad."));
  decline.addEventListener("click", () => runAction(decline, "/decline", "Förslaget har tackats nej till och bokningen har avslutats."));
  cancel.addEventListener("click", () => {
    if (window.confirm("Vill du avboka bokningen?")) {
      runAction(cancel, "/cancel", "Bokningen har avbokats.");
    }
  });

  load().catch(error => {
    status.textContent = error.message;
    actions.hidden = true;
  });
})();