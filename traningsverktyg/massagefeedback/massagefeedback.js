(function initializeMassageFeedback() {
  "use strict";

  const model = window.MassageFeedbackModel;
  const state = {
    session: null,
    views: {
      A: { orientation: "horizontal", pointerId: null, keyboardActive: false },
      B: { orientation: "horizontal", pointerId: null, keyboardActive: false }
    }
  };

  const deviceGrid = document.getElementById("deviceGrid");
  const statusBadge = document.getElementById("sessionStateBadge");
  const sessionStatus = document.getElementById("sessionStatus");
  const sessionFeedback = document.getElementById("sessionFeedback");
  const startButton = document.getElementById("startSessionButton");
  const sessionCodePanel = document.getElementById("sessionCodePanel");
  const sessionCodeOutput = document.getElementById("sessionCodeOutput");
  const joinForm = document.getElementById("joinSessionForm");
  const joinCodeInput = document.getElementById("sessionCodeInput");
  const thirdDeviceTest = document.getElementById("thirdDeviceTest");

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[character]));
  }

  function deviceMarkup(deviceId) {
    const phoneNumber = deviceId === "A" ? "1" : "2";
    const labels = model.POSITIONS.map((position, index) => `
      <button class="choice-button" type="button" data-position="${index}" aria-label="${escapeHtml(position)}" aria-pressed="${index === 0 ? "true" : "false"}">${position === "NOT MUCH" ? "NOT<br />MUCH" : escapeHtml(position)}</button>
    `).join("");
    return `
      <article class="device-card" data-device-card="${deviceId}">
        <header class="device-heading">
          <div>
            <p>SIMULERAD TELEFON ${phoneNumber}</p>
            <h3>Telefon ${phoneNumber}</h3>
          </div>
          <span class="device-connection" data-device-connection="${deviceId}" data-connected="false">Väntar</span>
        </header>
        <p class="device-waiting" data-device-waiting="${deviceId}"></p>
        <div class="device-controls" data-device-controls="${deviceId}">
          <div class="selected-feedback">
            <span>Vald feedback</span>
            <output data-selected-position="${deviceId}" aria-live="polite">GREAT</output>
          </div>
          <div class="feedback-layout" data-feedback-layout="${deviceId}">
            <div class="feedback-labels" role="group" aria-label="Välj massagefeedback för telefon ${phoneNumber}">${labels}</div>
            <p class="range-caption">Dra indikatorn eller välj ett värde</p>
            <div class="range-wrap">
              <input class="massage-range" type="range" min="0" max="9" step="1" value="0"
                data-feedback-slider="${deviceId}" aria-label="Massagefeedback från GREAT till 10, telefon ${phoneNumber}" />
            </div>
          </div>
          <p class="device-message" data-device-message="${deviceId}" role="status" aria-live="polite"></p>
          <div class="device-actions">
            <button class="massage-button massage-button-secondary" type="button" data-orientation="${deviceId}" aria-pressed="false">Visa stående läge ↻</button>
            <button class="massage-button massage-button-secondary" type="button" data-leave="${deviceId}">Lämna session</button>
            <button class="massage-button massage-button-danger" type="button" data-end="${deviceId}">Avsluta session</button>
          </div>
        </div>
      </article>`;
  }

  function setFeedbackMessage(message, kind = "") {
    sessionFeedback.textContent = message;
    sessionFeedback.classList.toggle("is-error", kind === "error");
    sessionFeedback.classList.toggle("is-warning", kind === "warning");
  }

  function deviceMessage(deviceId, message) {
    const messageEl = deviceGrid.querySelector(`[data-device-message="${deviceId}"]`);
    if (messageEl) messageEl.textContent = message;
  }

  function refreshDevices() {
    const session = state.session;
    ["A", "B"].forEach(deviceId => {
      const member = Boolean(session && session.participants.includes(deviceId) && session.status !== "ended");
      const ended = Boolean(session && session.status === "ended");
      const card = deviceGrid.querySelector(`[data-device-card="${deviceId}"]`);
      const status = deviceGrid.querySelector(`[data-device-connection="${deviceId}"]`);
      const waiting = deviceGrid.querySelector(`[data-device-waiting="${deviceId}"]`);
      const controls = deviceGrid.querySelector(`[data-device-controls="${deviceId}"]`);
      const slider = deviceGrid.querySelector(`[data-feedback-slider="${deviceId}"]`);
      const orientationButton = deviceGrid.querySelector(`[data-orientation="${deviceId}"]`);
      const leaveButton = deviceGrid.querySelector(`[data-leave="${deviceId}"]`);
      const endButton = deviceGrid.querySelector(`[data-end="${deviceId}"]`);
      const value = session ? session.position : 0;
      const label = model.POSITIONS[value];
      const layout = deviceGrid.querySelector(`[data-feedback-layout="${deviceId}"]`);

      card.classList.toggle("is-connected", member);
      status.dataset.connected = String(member);
      status.textContent = ended ? "Avslutad" : member ? "Ansluten" : "Väntar";
      waiting.hidden = member;
      waiting.textContent = ended
        ? "Sessionen har avslutats."
        : !session
          ? "Starta sessionen eller gå med med en kod."
          : session.status === "waiting" && session.participants.includes(deviceId)
            ? `Väntar på att telefon ${deviceId === "A" ? "2" : "1"} ska gå med.`
            : "Använd sessionskoden ovan för att gå med.";
      controls.hidden = false;
      slider.value = String(value);
      slider.disabled = !member;
      slider.setAttribute("aria-valuetext", label);
      deviceGrid.querySelector(`[data-selected-position="${deviceId}"]`).textContent = label;
      deviceGrid.querySelectorAll(`[data-device-card="${deviceId}"] [data-position]`).forEach(button => {
        const selected = Number(button.dataset.position) === value;
        button.setAttribute("aria-pressed", String(selected));
      });

      const orientation = state.views[deviceId].orientation;
      layout.classList.toggle("is-vertical", orientation === "vertical");
      orientationButton.setAttribute("aria-pressed", String(orientation === "vertical"));
      orientationButton.textContent = orientation === "vertical" ? "Visa liggande läge ↻" : "Visa stående läge ↻";
      orientationButton.disabled = !member;
      leaveButton.disabled = !member;
      endButton.disabled = !member;
    });
  }

  function renderSessionStatus() {
    const session = state.session;
    const status = session?.status || "idle";
    statusBadge.dataset.state = status;
    statusBadge.textContent = status === "waiting"
      ? "Väntar"
      : status === "connected"
        ? "Anslutna"
        : status === "ended"
          ? "Avslutad"
          : "Ingen session";

    sessionStatus.textContent = status === "waiting"
      ? "Telefon 1 har startat. Telefon 2 kan gå med med koden."
      : status === "connected"
        ? "Två telefoner anslutna. Båda ser samma feedback."
        : status === "ended"
          ? "Sessionen har avslutats. Starta en ny om du vill testa igen."
          : "Starta en simulerad session eller försök gå med med en kod.";

    const showCode = Boolean(session);
    sessionCodePanel.hidden = !showCode;
    sessionCodeOutput.textContent = session?.code || "";
    startButton.disabled = Boolean(session && session.status !== "ended");
    startButton.textContent = session?.status === "ended" ? "Starta ny session" : "Starta session";
    thirdDeviceTest.hidden = status !== "connected";
    refreshDevices();
  }

  function startSession() {
    state.session = model.createSession(model.createMockCode());
    ["A", "B"].forEach(deviceId => deviceMessage(deviceId, ""));
    setFeedbackMessage("Telefon 1 startade sessionen. Skriv in koden här för att ansluta telefon 2.");
    renderSessionStatus();
  }

  function joinSession(enteredCode, requestedDevice = null) {
    const deviceId = requestedDevice || model.nextDeviceId(state.session);
    const result = model.joinSession(state.session, enteredCode, deviceId);
    if (!result.ok) {
      if (result.reason === "full") {
        setFeedbackMessage("Session full — only two phones are allowed.", "error");
      } else if (result.reason === "ended") {
        setFeedbackMessage("Sessionen har avslutats. Starta en ny session för att fortsätta.", "error");
      } else {
        setFeedbackMessage("Ogiltig kod. Kontrollera koden och försök igen.", "error");
      }
      return false;
    }

    state.session = result.session;
    joinCodeInput.value = "";
    deviceMessage(deviceId, "Du är ansluten. Välj feedback när du är redo.");
    setFeedbackMessage(`Telefon ${deviceId === "A" ? "1" : deviceId === "B" ? "2" : "3"} gick med i den simulerade sessionen.`);
    renderSessionStatus();
    return true;
  }

  function releasePointerControl(deviceId) {
    const view = state.views[deviceId];
    if (!view || view.pointerId == null) return;
    if (state.session) {
      const result = model.releaseControl(state.session, deviceId);
      state.session = result.session;
    }
    view.pointerId = null;
  }

  function releaseKeyboardControl(deviceId) {
    const view = state.views[deviceId];
    if (!view?.keyboardActive) return;
    if (state.session) {
      const result = model.releaseControl(state.session, deviceId);
      state.session = result.session;
    }
    view.keyboardActive = false;
  }

  function rejectLockedAdjustment(deviceId, range) {
    range.value = String(state.session?.position ?? 0);
    deviceMessage(deviceId, "The other phone is adjusting.");
  }

  function bindSlider(deviceId) {
    const range = deviceGrid.querySelector(`[data-feedback-slider="${deviceId}"]`);

    range.addEventListener("pointerdown", event => {
      const result = model.claimControl(state.session, deviceId);
      if (!result.ok) {
        event.preventDefault();
        if (result.reason === "locked") rejectLockedAdjustment(deviceId, range);
        return;
      }
      state.session = result.session;
      state.views[deviceId].pointerId = event.pointerId;
      try { range.setPointerCapture(event.pointerId); } catch {}
    });

    range.addEventListener("input", () => {
      const result = model.setPosition(state.session, deviceId, Number(range.value));
      if (!result.ok) {
        if (result.reason === "locked") rejectLockedAdjustment(deviceId, range);
        return;
      }
      state.session = result.session;
      refreshDevices();
    });

    range.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) return;
      const result = model.claimControl(state.session, deviceId);
      if (!result.ok) {
        event.preventDefault();
        if (result.reason === "locked") rejectLockedAdjustment(deviceId, range);
        return;
      }
      state.session = result.session;
      state.views[deviceId].keyboardActive = true;
    });
  }

  deviceGrid.innerHTML = deviceMarkup("A") + deviceMarkup("B");
  bindSlider("A");
  bindSlider("B");

  document.addEventListener("pointerup", event => {
    ["A", "B"].forEach(deviceId => {
      if (state.views[deviceId].pointerId === event.pointerId) releasePointerControl(deviceId);
    });
  });
  document.addEventListener("pointercancel", event => {
    ["A", "B"].forEach(deviceId => {
      if (state.views[deviceId].pointerId === event.pointerId) releasePointerControl(deviceId);
    });
  });
  document.addEventListener("keyup", () => {
    ["A", "B"].forEach(releaseKeyboardControl);
  });
  window.addEventListener("blur", () => {
    ["A", "B"].forEach(deviceId => {
      releasePointerControl(deviceId);
      releaseKeyboardControl(deviceId);
    });
  });

  startButton.addEventListener("click", startSession);

  joinForm.addEventListener("submit", event => {
    event.preventDefault();
    joinSession(joinCodeInput.value);
  });

  document.getElementById("copySessionCodeButton").addEventListener("click", async () => {
    if (!state.session) return;
    try {
      await navigator.clipboard.writeText(state.session.code);
      setFeedbackMessage("Sessionskoden har kopierats.");
    } catch {
      window.prompt("Kopiera sessionskoden:", state.session.code);
    }
  });

  document.getElementById("thirdDeviceButton").addEventListener("click", () => {
    joinSession(state.session?.code || "", "C");
  });

  deviceGrid.addEventListener("click", event => {
    const choice = event.target.closest("[data-position]");
    if (choice) {
      const card = choice.closest("[data-device-card]");
      const deviceId = card.dataset.deviceCard;
      const claimed = model.claimControl(state.session, deviceId);
      if (!claimed.ok) {
        if (claimed.reason === "locked") deviceMessage(deviceId, "The other phone is adjusting.");
        return;
      }
      const updated = model.setPosition(claimed.session, deviceId, Number(choice.dataset.position));
      state.session = model.releaseControl(updated.session, deviceId).session;
      deviceMessage(deviceId, "Feedback uppdaterad för båda vyerna.");
      refreshDevices();
      return;
    }

    const orientationButton = event.target.closest("[data-orientation]");
    if (orientationButton) {
      const deviceId = orientationButton.dataset.orientation;
      state.views[deviceId].orientation = model.toggleOrientation(state.views[deviceId].orientation);
      refreshDevices();
      return;
    }

    const leaveButton = event.target.closest("[data-leave]");
    if (leaveButton) {
      const deviceId = leaveButton.dataset.leave;
      const result = model.leaveSession(state.session, deviceId);
      if (result.ok) {
        state.session = result.session;
        deviceMessage(deviceId, "Du har lämnat sessionen.");
        setFeedbackMessage(`Telefon ${deviceId === "A" ? "1" : "2"} lämnade sessionen.`);
        renderSessionStatus();
      }
      return;
    }

    const endButton = event.target.closest("[data-end]");
    if (endButton) {
      if (!window.confirm("Avsluta sessionen för båda telefonerna?")) return;
      const result = model.endSession(state.session);
      if (result.ok) {
        state.session = result.session;
        setFeedbackMessage("Sessionen har avslutats.");
        renderSessionStatus();
      }
    }
  });

  renderSessionStatus();
})();
