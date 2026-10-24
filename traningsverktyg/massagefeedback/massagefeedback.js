(function initializeMassageFeedback() {
  "use strict";

  const model = window.MassageFeedbackModel;
  const api = window.MassageFeedbackApi.createSessionApi();
  const DEVICE_FOR_ROLE = Object.freeze({ host: "A", guest: "B" });
  const ROLE_FOR_DEVICE = Object.freeze({ A: "host", B: "guest" });
  const state = {
    session: null,
    role: null,
    capability: null,
    joinRequest: null,
    pendingJoinId: null,
    participantConnections: { A: false, B: false },
    streamConnected: false,
    streamEverConnected: false,
    streamController: null,
    heartbeatTimer: null,
    joinPollTimer: null,
    generation: 0,
    setupBusy: false,
    gesture: null,
    pendingPosition: null,
    positionLoop: null,
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
  const joinApprovalPanel = document.getElementById("joinApprovalPanel");
  const approveJoinButton = document.getElementById("approveJoinButton");
  const rejectJoinButton = document.getElementById("rejectJoinButton");
  const copyCodeButton = document.getElementById("copySessionCodeButton");

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[character]));
  }

  function deviceMarkup() {
    const labels = model.POSITIONS.map((position, index) => `
      <button class="choice-button" type="button" data-position="${index}" aria-label="${escapeHtml(position)}" aria-pressed="${index === 0 ? "true" : "false"}">${position === "NOT MUCH" ? "NOT<br />MUCH" : escapeHtml(position)}</button>
    `).join("");
    return `
      <article class="device-card" data-device-card="shared">
        <header class="device-heading">
          <div>
            <p data-device-role-caption>GEMENSAM SKALA</p>
            <h3>Gemensam feedback</h3>
          </div>
        </header>
        <div class="device-controls" data-device-controls>
          <div class="selected-feedback">
            <span>Gemensamt val</span>
            <output data-selected-position aria-live="polite">GREAT</output>
          </div>
          <div class="feedback-layout" data-feedback-layout>
            <div class="feedback-labels" role="group" aria-label="Välj gemensam massagefeedback">${labels}</div>
            <p class="range-caption">Dra indikatorn eller välj ett värde</p>
            <div class="range-wrap">
              <input class="massage-range" type="range" min="0" max="9" step="1" value="0"
                data-feedback-slider aria-label="Gemensam massagefeedback från GREAT till 10" />
            </div>
          </div>
          <p class="device-interaction-status" data-device-interaction-status role="status" aria-live="polite"></p>
          <p class="device-message" data-device-message role="status" aria-live="polite"></p>
          <div class="device-actions">
            <button class="massage-button massage-button-secondary" type="button" data-orientation aria-pressed="false">Visa stående läge ↻</button>
            <button class="massage-button massage-button-secondary" type="button" data-leave>Lämna på den här telefonen</button>
            <button class="massage-button massage-button-danger" type="button" data-end>Avsluta för båda</button>
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
    const element = deviceGrid.querySelector("[data-device-message]");
    if (element) element.textContent = message;
  }

  function activeDeviceId() {
    return state.role ? DEVICE_FOR_ROLE[state.role] : "A";
  }

  function participantPresent(deviceId) {
    return Boolean(state.session?.participants.includes(deviceId));
  }

  function canControl(deviceId) {
    return Boolean(
      state.session
      && state.role
      && DEVICE_FOR_ROLE[state.role] === deviceId
      && state.capability
      && state.streamConnected
      && state.participantConnections[deviceId]
      && !(state.role === "guest" && !state.participantConnections.A)
      && state.session.status !== "ended"
      && (!state.session.activeDevice || state.session.activeDevice === deviceId)
    );
  }

  function refreshConnectionStatus() {
    ["A", "B"].forEach(deviceId => {
      const status = document.querySelector(`[data-session-connection-status="${deviceId}"]`);
      if (!status) return;

      const session = state.session;
      const present = participantPresent(deviceId);
      const ownDevice = state.role && DEVICE_FOR_ROLE[state.role] === deviceId;
      const connected = present
        && state.participantConnections[deviceId]
        && (!ownDevice || state.streamConnected);

      let label = "Väntar";
      let statusState = "waiting";
      if (session?.status === "ended") {
        label = "Avslutad";
        statusState = "ended";
      } else if (connected) {
        label = "Ansluten";
        statusState = "connected";
      } else if (present) {
        const initialConnect = ownDevice && !state.streamEverConnected;
        label = initialConnect ? "Ansluter" : "Återansluter";
        statusState = initialConnect ? "connecting" : "reconnecting";
      }

      status.textContent = label;
      status.dataset.state = statusState;
    });
  }

  function refreshDevices() {
    const session = state.session;
    const deviceId = activeDeviceId();
    const present = participantPresent(deviceId);
    const ownDevice = Boolean(state.role);
    const connectionActive = present
      && state.participantConnections[deviceId]
      && state.streamConnected;
    const card = deviceGrid.querySelector("[data-device-card]");
    const controls = deviceGrid.querySelector("[data-device-controls]");
    const slider = deviceGrid.querySelector("[data-feedback-slider]");
    const orientationButton = deviceGrid.querySelector("[data-orientation]");
    const leaveButton = deviceGrid.querySelector("[data-leave]");
    const endButton = deviceGrid.querySelector("[data-end]");
    const layout = deviceGrid.querySelector("[data-feedback-layout]");
    const caption = deviceGrid.querySelector("[data-device-role-caption]");
    const output = deviceGrid.querySelector("[data-selected-position]");
    const interactionStatus = deviceGrid.querySelector("[data-device-interaction-status]");
    const value = session?.position ?? 0;
    const label = model.POSITIONS[value];
    const interactive = canControl(deviceId);

    card.classList.toggle("is-connected", connectionActive);
    caption.textContent = state.role
      ? `TELEFON ${deviceId === "A" ? "1" : "2"} · DITT REGLAGE`
      : "GEMENSAM SKALA";
    controls.hidden = !session || session.status === "ended";
    slider.value = String(value);
    slider.disabled = !interactive;
    slider.setAttribute("aria-valuetext", label);
    output.textContent = label;
    deviceGrid.querySelectorAll("[data-position]").forEach(button => {
      const selected = Number(button.dataset.position) === value;
      button.setAttribute("aria-pressed", String(selected));
      button.disabled = !interactive;
    });

    const orientation = state.views[deviceId].orientation;
    layout.classList.toggle("is-vertical", orientation === "vertical");
    orientationButton.setAttribute("aria-pressed", String(orientation === "vertical"));
    orientationButton.textContent = orientation === "vertical" ? "Visa liggande läge ↻" : "Visa stående läge ↻";
    orientationButton.disabled = !ownDevice || !present;
    leaveButton.hidden = state.role !== "guest";
    leaveButton.disabled = !ownDevice || !present;
    endButton.disabled = !ownDevice || !present;
    interactionStatus.textContent = session?.status !== "ended"
      && session?.activeDevice
      && session.activeDevice !== deviceId
      ? `Telefon ${session.activeDevice === "A" ? "1" : "2"} ändrar feedback.`
      : "";
    interactionStatus.hidden = !interactionStatus.textContent;
  }

  function renderSessionStatus() {
    const session = state.session;
    const status = session?.status || (state.joinRequest ? "waiting" : "idle");
    const bothParticipantsConnected = Boolean(
      session?.participants.includes("A")
      && session?.participants.includes("B")
      && state.participantConnections.A
      && state.participantConnections.B
    );
    statusBadge.dataset.state = status;
    statusBadge.textContent = state.joinRequest
      ? "Väntar på godkännande"
      : status === "waiting"
        ? "Väntar"
        : status === "connected"
          ? bothParticipantsConnected ? "Anslutna" : "Ansluter"
          : status === "ended"
            ? "Avslutad"
            : "Ingen session";

    sessionStatus.textContent = state.joinRequest
      ? "Förfrågan skickad. Vänta på att telefon 1 godkänner den."
      : !session
        ? "Starta en session som telefon 1 eller gå med med en kod som telefon 2."
        : status === "ended"
          ? "Sessionen har avslutats eller gått ut. Starta eller gå med i en ny session."
          : !state.streamConnected
            ? "Anslutningen återställs. Feedbacken synkroniseras när anslutningen är tillbaka."
            : status === "waiting"
              ? state.role === "host"
                ? "Dela koden eller vänta på att telefon 2 begär att få gå med."
                : "Telefon 1 har startat sessionen. Vänta på anslutning."
              : status === "connected" && !bothParticipantsConnected
                ? `Väntar på att telefon ${state.participantConnections.A ? "2" : "1"} ska ansluta.`
                : "Två telefoner delar samma feedback. Servern sparar det aktuella valet.";

    const showHostCode = Boolean(session && state.role === "host" && status !== "ended");
    sessionCodePanel.hidden = !showHostCode;
    sessionCodeOutput.textContent = showHostCode ? session.code : "";

    joinApprovalPanel.hidden = !(
      state.role === "host"
      && state.pendingJoinId
      && status !== "ended"
    );
    startButton.disabled = state.setupBusy || Boolean(state.role || state.joinRequest);
    startButton.textContent = status === "ended" ? "Starta ny session" : "Starta som telefon 1";
    joinForm.hidden = Boolean(state.role || state.joinRequest);
    joinCodeInput.disabled = state.setupBusy || Boolean(state.role || state.joinRequest);
    joinForm.querySelector("button[type=submit]").disabled = state.setupBusy || Boolean(state.role || state.joinRequest);
    approveJoinButton.disabled = state.setupBusy || !state.pendingJoinId;
    rejectJoinButton.disabled = state.setupBusy || !state.pendingJoinId;
    document.getElementById("sessionActions").hidden = Boolean(state.role || state.joinRequest);
    document.getElementById("devicesSection").hidden = !session || status === "ended";
    refreshConnectionStatus();
    refreshDevices();
  }

  function applyServerState(serverState) {
    if (!serverState || !Array.isArray(serverState.participants)) return;
    const participants = [];
    const connections = { A: false, B: false };
    for (const participant of serverState.participants) {
      const deviceId = DEVICE_FOR_ROLE[participant.role];
      if (!deviceId) continue;
      participants.push(deviceId);
      connections[deviceId] = Boolean(participant.connected);
    }
    const activeDevice = serverState.activeControl
      ? DEVICE_FOR_ROLE[serverState.activeControl] || null
      : null;
    state.participantConnections = connections;
    state.pendingJoinId = serverState.pendingJoin?.requestId || null;
    state.session = {
      code: serverState.code || state.session?.code || "",
      status: serverState.status,
      participants,
      position: Number.isInteger(serverState.position)
        ? Math.max(0, Math.min(model.POSITIONS.length - 1, serverState.position))
        : 0,
      activeDevice
    };
    if (state.gesture?.claimed && activeDevice !== DEVICE_FOR_ROLE[state.role]) {
      state.gesture = null;
      state.pendingPosition = null;
      state.views.A.pointerId = null;
      state.views.B.pointerId = null;
      state.views.A.keyboardActive = false;
      state.views.B.keyboardActive = false;
    }
    renderSessionStatus();
  }

  function clearTransport() {
    window.clearInterval(state.heartbeatTimer);
    window.clearTimeout(state.joinPollTimer);
    state.heartbeatTimer = null;
    state.joinPollTimer = null;
    state.streamController?.abort();
    state.streamController = null;
    state.streamConnected = false;
    state.gesture = null;
    state.pendingPosition = null;
    state.views.A.pointerId = null;
    state.views.B.pointerId = null;
    state.views.A.keyboardActive = false;
    state.views.B.keyboardActive = false;
  }

  function isActiveGeneration(generation) {
    return generation === state.generation && Boolean(state.role && state.capability);
  }

  function finishLocally(message, ended = true) {
    const previousSession = state.session;
    clearTransport();
    state.generation += 1;
    state.role = null;
    state.capability = null;
    state.joinRequest = null;
    state.pendingJoinId = null;
    state.streamEverConnected = false;
    state.participantConnections = { A: false, B: false };
    state.session = ended && previousSession
      ? { ...previousSession, status: "ended", participants: [], activeDevice: null }
      : null;
    setFeedbackMessage(message, ended ? "warning" : "");
    renderSessionStatus();
  }

  function handleAuthenticatedError(error) {
    if (error?.status === 401 || error?.status === 404) {
      finishLocally("Sessionen har avslutats eller gått ut. Starta eller gå med igen.");
      return true;
    }
    return false;
  }

  function activateSession(role, code, capability, initialState = null) {
    clearTransport();
    state.generation += 1;
    state.role = role;
    state.capability = capability;
    state.joinRequest = null;
    state.pendingJoinId = null;
    state.streamEverConnected = false;
    state.participantConnections = { A: false, B: false };
    state.session = {
      code,
      status: "waiting",
      participants: [DEVICE_FOR_ROLE[role]],
      position: 0,
      activeDevice: null
    };
    if (initialState) applyServerState(initialState);
    const generation = state.generation;
    renderSessionStatus();
    void runEventStream(generation);
  }

  function wait(milliseconds) {
    return new Promise(resolve => window.setTimeout(resolve, milliseconds));
  }

  function startHeartbeat(generation) {
    window.clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = window.setInterval(async () => {
      if (!isActiveGeneration(generation) || !state.streamConnected) return;
      try {
        await api.heartbeat(state.session.code, state.capability);
      } catch (error) {
        if (!isActiveGeneration(generation)) return;
        if (handleAuthenticatedError(error)) return;
        setFeedbackMessage(error.message || "Anslutningen är instabil. Försök igen.", "warning");
      }
    }, 15_000);
  }

  function handleServerEvent(event) {
    if (event.event === "session-ended") {
      finishLocally("Sessionen avslutades av en deltagare eller gick ut.");
      return false;
    }
    if (event.event === "state" || event.event === "join-request") {
      applyServerState(event.data);
      if (event.event === "join-request" && state.role === "host") {
        setFeedbackMessage("Telefon 2 vill gå med. Godkänn eller avvisa förfrågan.");
      }
    }
    return true;
  }

  async function runEventStream(generation) {
    let retryDelay = 1_000;
    while (isActiveGeneration(generation)) {
      const controller = new AbortController();
      state.streamController = controller;
      let waitBeforeRetry = retryDelay;
      try {
        const stream = await api.openEvents(
          state.session.code,
          state.capability,
          controller.signal
        );
        if (!isActiveGeneration(generation)) return;
        state.streamConnected = true;
        state.streamEverConnected = true;
        retryDelay = 1_000;
        startHeartbeat(generation);
        renderSessionStatus();
        for await (const event of window.MassageFeedbackApi.readEvents(stream)) {
          if (!isActiveGeneration(generation)) return;
          if (!handleServerEvent(event)) return;
        }
        if (isActiveGeneration(generation)) throw new Error("Session stream ended.");
      } catch (error) {
        if (!isActiveGeneration(generation) || controller.signal.aborted) return;
        window.clearInterval(state.heartbeatTimer);
        state.heartbeatTimer = null;
        state.streamConnected = false;
        state.gesture = null;
        state.pendingPosition = null;
        state.views.A.pointerId = null;
        state.views.B.pointerId = null;
        state.views.A.keyboardActive = false;
        state.views.B.keyboardActive = false;
        renderSessionStatus();
        if (handleAuthenticatedError(error)) return;
        if (error.status === 429 && error.retryAfter) {
          waitBeforeRetry = Math.max(waitBeforeRetry, error.retryAfter * 1_000);
        }
        setFeedbackMessage("Anslutningen bröts. Försöker återansluta automatiskt.", "warning");
      } finally {
        if (state.streamController === controller) state.streamController = null;
        if (isActiveGeneration(generation)) {
          window.clearInterval(state.heartbeatTimer);
          state.heartbeatTimer = null;
          state.streamConnected = false;
          state.gesture = null;
          state.pendingPosition = null;
          state.views.A.pointerId = null;
          state.views.B.pointerId = null;
          state.views.A.keyboardActive = false;
          state.views.B.keyboardActive = false;
          renderSessionStatus();
        }
      }
      await wait(waitBeforeRetry);
      retryDelay = Math.min(retryDelay * 2, 8_000);
    }
  }

  function scheduleJoinPoll(generation, delay = 2_500) {
    window.clearTimeout(state.joinPollTimer);
    state.joinPollTimer = window.setTimeout(() => {
      void pollJoinStatus(generation);
    }, delay);
  }

  async function pollJoinStatus(generation) {
    const request = state.joinRequest;
    if (!request || generation !== state.generation) return;
    try {
      const result = await api.getJoinStatus(
        request.code,
        request.requestId,
        request.joinTicket
      );
      if (generation !== state.generation || state.joinRequest !== request) return;
      if (result.status === "approved" && result.capability) {
        activateSession("guest", request.code, result.capability);
        setFeedbackMessage("Telefon 1 godkände din förfrågan. Ansluter …");
        return;
      }
      if (result.status === "rejected") {
        finishLocally("Telefon 1 avvisade förfrågan. Du kan försöka med en annan kod.", false);
        return;
      }
      if (result.status === "expired") {
        finishLocally("Förfrågan gick ut. Be telefon 1 om en ny inbjudan.", false);
        return;
      }
      scheduleJoinPoll(generation);
    } catch (error) {
      if (generation !== state.generation || state.joinRequest !== request) return;
      if (error.status === 404) {
        finishLocally("Sessionen eller förfrågan finns inte längre. Kontrollera koden.", false);
        return;
      }
      if (error.status === 429 && error.retryAfter) {
        setFeedbackMessage("För många statuskontroller. Väntar innan nästa försök.", "warning");
        scheduleJoinPoll(generation, Math.max(2_500, error.retryAfter * 1_000));
        return;
      }
      setFeedbackMessage(error.message || "Kunde inte kontrollera förfrågan. Försöker igen.", "warning");
      scheduleJoinPoll(generation, 4_000);
    }
  }

  async function createSession() {
    if (state.setupBusy || state.role || state.joinRequest) return;
    state.setupBusy = true;
    renderSessionStatus();
    try {
      const result = await api.createSession();
      activateSession("host", result.code, result.capability, result.state);
      setFeedbackMessage("Sessionen startade. Dela koden med telefon 2.");
    } catch (error) {
      setFeedbackMessage(error.message || "Sessionen kunde inte startas. Försök igen.", "error");
    } finally {
      state.setupBusy = false;
      renderSessionStatus();
    }
  }

  async function requestToJoin(code) {
    if (state.setupBusy || state.role || state.joinRequest) return;
    const normalizedCode = model.normalizeCode(code);
    if (!normalizedCode) {
      setFeedbackMessage("Skriv in sessionskoden.", "error");
      return;
    }
    state.setupBusy = true;
    renderSessionStatus();
    try {
      const result = await api.requestJoin(normalizedCode);
      state.generation += 1;
      state.role = "guest";
      state.capability = null;
      state.joinRequest = {
        code: normalizedCode,
        requestId: result.requestId,
        joinTicket: result.joinTicket
      };
      state.session = {
        code: normalizedCode,
        status: "waiting",
        participants: ["A"],
        position: 0,
        activeDevice: null
      };
      joinCodeInput.value = "";
      setFeedbackMessage("Förfrågan skickad. Vänta på telefon 1.");
      renderSessionStatus();
      scheduleJoinPoll(state.generation);
    } catch (error) {
      const message = error.status === 404
        ? "Koden hittades inte eller sessionen kan inte ta emot fler deltagare."
        : error.message || "Förfrågan kunde inte skickas. Försök igen.";
      setFeedbackMessage(message, "error");
    } finally {
      state.setupBusy = false;
      renderSessionStatus();
    }
  }

  async function decideJoin(decision) {
    if (state.role !== "host" || !state.pendingJoinId || state.setupBusy) return;
    const requestId = state.pendingJoinId;
    state.setupBusy = true;
    renderSessionStatus();
    try {
      await api.decideJoin(state.session.code, requestId, decision, state.capability);
      if (decision === "approve") {
        setFeedbackMessage("Förfrågan godkänd. Telefon 2 ansluter nu.");
      } else {
        setFeedbackMessage("Förfrågan avvisad.");
      }
      const current = await api.getSession(state.session.code, state.capability);
      applyServerState(current.state);
    } catch (error) {
      if (!handleAuthenticatedError(error)) {
        setFeedbackMessage(error.message || "Förfrågan kunde inte hanteras.", "error");
      }
    } finally {
      state.setupBusy = false;
      renderSessionStatus();
    }
  }

  function beginGesture(deviceId) {
    if (!canControl(deviceId)) return null;
    if (state.gesture) {
      return state.gesture.deviceId === deviceId ? state.gesture : null;
    }
    const gesture = {
      deviceId,
      generation: state.generation,
      claimed: false,
      released: false,
      releaseStarted: false,
      latestPosition: null,
      claimPromise: null
    };
    state.gesture = gesture;
    gesture.claimPromise = (async () => {
      try {
        const result = await api.claimControl(state.session.code, state.capability);
        if (!isActiveGeneration(gesture.generation) || state.gesture !== gesture) return;
        applyServerState(result.state);
        gesture.claimed = true;
        if (gesture.latestPosition !== null) queuePosition(gesture.latestPosition, gesture);
        if (gesture.released) void finishGesture(gesture);
      } catch (error) {
        if (state.gesture === gesture) {
          state.gesture = null;
          if (handleAuthenticatedError(error)) return;
          setFeedbackMessage(error.message || "Reglaget kunde inte låsas.", "warning");
          refreshDevices();
        }
      }
    })();
    return gesture;
  }

  function queuePosition(position, gesture) {
    if (state.gesture !== gesture || !gesture.claimed) return;
    state.pendingPosition = { position, gesture };
    if (state.positionLoop) return;
    const loop = drainPositionQueue();
    state.positionLoop = loop;
    loop.finally(() => {
      if (state.positionLoop === loop) state.positionLoop = null;
      if (state.pendingPosition) {
        queuePosition(state.pendingPosition.position, state.pendingPosition.gesture);
      }
    });
  }

  async function drainPositionQueue() {
    while (state.pendingPosition) {
      await wait(45);
      const pending = state.pendingPosition;
      state.pendingPosition = null;
      const gesture = pending.gesture;
      if (
        state.gesture !== gesture
        || !gesture.claimed
        || !isActiveGeneration(gesture.generation)
      ) continue;
      try {
        const result = await api.setPosition(
          state.session.code,
          pending.position,
          state.capability
        );
        if (!isActiveGeneration(gesture.generation)) return;
        applyServerState(result.state);
      } catch (error) {
        if (handleAuthenticatedError(error)) return;
        setFeedbackMessage(error.message || "Feedbacken kunde inte uppdateras.", "warning");
        try {
          const latest = await api.getSession(state.session.code, state.capability);
          if (isActiveGeneration(gesture.generation)) applyServerState(latest.state);
        } catch (refreshError) {
          handleAuthenticatedError(refreshError);
        }
        return;
      }
    }
  }

  async function finishGesture(gesture) {
    if (!gesture.claimed || gesture.releaseStarted) return;
    gesture.released = true;
    gesture.releaseStarted = true;
    if (state.positionLoop) await state.positionLoop;
    if (!isActiveGeneration(gesture.generation) || state.gesture !== gesture) return;
    try {
      const result = await api.releaseControl(state.session.code, state.capability);
      if (!isActiveGeneration(gesture.generation)) return;
      applyServerState(result.state);
    } catch (error) {
      if (!handleAuthenticatedError(error)) {
        setFeedbackMessage(error.message || "Reglagelåset kunde inte släppas.", "warning");
      }
    } finally {
      if (state.gesture === gesture) state.gesture = null;
      refreshDevices();
    }
  }

  function releaseGesture(deviceId) {
    const gesture = state.gesture;
    if (!gesture || gesture.deviceId !== deviceId) return;
    gesture.released = true;
    if (gesture.claimed) void finishGesture(gesture);
  }

  async function endSession() {
    if (!state.session || !state.capability || state.setupBusy) return;
    if (!window.confirm("Avsluta sessionen för båda telefonerna?")) return;
    state.setupBusy = true;
    renderSessionStatus();
    try {
      await api.end(state.session.code, state.capability);
      finishLocally("Sessionen avslutades för båda telefonerna.");
    } catch (error) {
      if (!handleAuthenticatedError(error)) {
        setFeedbackMessage(error.message || "Sessionen kunde inte avslutas.", "error");
      }
    } finally {
      state.setupBusy = false;
      renderSessionStatus();
    }
  }

  async function leaveSession() {
    if (state.role !== "guest" || !state.session || !state.capability || state.setupBusy) return;
    state.setupBusy = true;
    renderSessionStatus();
    try {
      await api.leave(state.session.code, state.capability);
      finishLocally("Du lämnade sessionen. Telefon 1 kan bjuda in någon annan.", false);
    } catch (error) {
      if (!handleAuthenticatedError(error)) {
        setFeedbackMessage(error.message || "Du kunde inte lämna sessionen.", "error");
      }
    } finally {
      state.setupBusy = false;
      renderSessionStatus();
    }
  }

  deviceGrid.innerHTML = deviceMarkup();

  const range = deviceGrid.querySelector("[data-feedback-slider]");
  range.addEventListener("pointerdown", event => {
    const deviceId = activeDeviceId();
    const gesture = beginGesture(deviceId);
    if (!gesture) return;
    state.views[deviceId].pointerId = event.pointerId;
    try { range.setPointerCapture(event.pointerId); } catch {}
  });
  range.addEventListener("input", () => {
    const deviceId = activeDeviceId();
    const gesture = state.gesture || beginGesture(deviceId);
    if (!gesture || gesture.deviceId !== deviceId || gesture.released) {
      range.value = String(state.session?.position ?? 0);
      return;
    }
    gesture.latestPosition = Number(range.value);
    if (gesture.claimed) queuePosition(gesture.latestPosition, gesture);
  });
  range.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) return;
    const deviceId = activeDeviceId();
    const gesture = beginGesture(deviceId);
    if (!gesture) {
      event.preventDefault();
      return;
    }
    state.views[deviceId].keyboardActive = true;
  });

  document.addEventListener("pointerup", event => {
    ["A", "B"].forEach(deviceId => {
      if (state.views[deviceId].pointerId === event.pointerId) {
        state.views[deviceId].pointerId = null;
        releaseGesture(deviceId);
      }
    });
  });
  document.addEventListener("pointercancel", event => {
    ["A", "B"].forEach(deviceId => {
      if (state.views[deviceId].pointerId === event.pointerId) {
        state.views[deviceId].pointerId = null;
        releaseGesture(deviceId);
      }
    });
  });
  document.addEventListener("keyup", () => {
    ["A", "B"].forEach(deviceId => {
      if (!state.views[deviceId].keyboardActive) return;
      state.views[deviceId].keyboardActive = false;
      releaseGesture(deviceId);
    });
  });
  window.addEventListener("blur", () => {
    ["A", "B"].forEach(deviceId => {
      state.views[deviceId].pointerId = null;
      state.views[deviceId].keyboardActive = false;
      releaseGesture(deviceId);
    });
  });

  startButton.addEventListener("click", () => void createSession());
  joinForm.addEventListener("submit", event => {
    event.preventDefault();
    void requestToJoin(joinCodeInput.value);
  });
  approveJoinButton.addEventListener("click", () => void decideJoin("approve"));
  rejectJoinButton.addEventListener("click", () => void decideJoin("reject"));

  copyCodeButton.addEventListener("click", async () => {
    if (!state.session?.code || state.role !== "host") return;
    try {
      await navigator.clipboard.writeText(state.session.code);
      setFeedbackMessage("Sessionskoden har kopierats.");
    } catch {
      window.prompt("Kopiera sessionskoden:", state.session.code);
    }
  });

  deviceGrid.addEventListener("click", event => {
    const choice = event.target.closest("[data-position]");
    if (choice) {
      const deviceId = activeDeviceId();
      if (!state.role) return;
      const gesture = beginGesture(deviceId);
      if (!gesture) return;
      gesture.latestPosition = Number(choice.dataset.position);
      gesture.released = true;
      if (gesture.claimed) {
        queuePosition(gesture.latestPosition, gesture);
        void finishGesture(gesture);
      }
      return;
    }

    const orientationButton = event.target.closest("[data-orientation]");
    if (orientationButton) {
      const deviceId = activeDeviceId();
      if (state.role !== ROLE_FOR_DEVICE[deviceId]) return;
      state.views[deviceId].orientation = model.toggleOrientation(state.views[deviceId].orientation);
      refreshDevices();
      return;
    }

    if (event.target.closest("[data-leave]")) {
      if (state.role === "guest") void leaveSession();
      return;
    }
    if (event.target.closest("[data-end]")) void endSession();
  });

  renderSessionStatus();
})();
