(function exposeMassageFeedbackModel(root) {
  const CHOICES = Object.freeze([
    Object.freeze({ label: "GREAT", value: 0 }),
    Object.freeze({ label: "GOOD", value: 1 }),
    Object.freeze({ label: "NOT MUCH", value: 2 }),
    Object.freeze({ label: "5", value: 4 }),
    Object.freeze({ label: "6", value: 5 }),
    Object.freeze({ label: "7", value: 6 }),
    Object.freeze({ label: "8", value: 7 }),
    Object.freeze({ label: "9+", value: 8 })
  ]);
  const MAX_PARTICIPANTS = 2;

  function choiceForPosition(position) {
    return CHOICES.find(choice => choice.value === position) || null;
  }

  function sliderIndexForPosition(position) {
    return CHOICES.findIndex(choice => choice.value === position);
  }

  function positionForSliderIndex(index) {
    if (!Number.isInteger(index) || index < 0 || index >= CHOICES.length) return null;
    return CHOICES[index].value;
  }

  function isValidPosition(position) {
    return Number.isInteger(position) && choiceForPosition(position) !== null;
  }

  function normalizeCode(code) {
    return String(code || "").trim().replace(/\s+/g, "").toUpperCase();
  }

  function createSession(code) {
    return {
      code: normalizeCode(code),
      status: "waiting",
      participants: ["A"],
      position: 0,
      activeDevice: null
    };
  }

  function joinSession(session, enteredCode, deviceId) {
    if (!session) {
      return { ok: false, reason: "invalid", session };
    }
    if (session.status === "ended") {
      return { ok: false, reason: "ended", session };
    }
    if (!normalizeCode(enteredCode) || normalizeCode(enteredCode) !== session.code) {
      return { ok: false, reason: "invalid", session };
    }
    if (session.participants.includes(deviceId)) {
      return { ok: false, reason: "already-joined", session };
    }
    if (session.participants.length >= MAX_PARTICIPANTS) {
      return { ok: false, reason: "full", session };
    }

    const participants = [...session.participants, deviceId];
    return {
      ok: true,
      reason: null,
      session: {
        ...session,
        participants,
        status: participants.length === MAX_PARTICIPANTS ? "connected" : "waiting"
      }
    };
  }

  function claimControl(session, deviceId) {
    if (!session || session.status === "ended" || !session.participants.includes(deviceId)) {
      return { ok: false, reason: "not-connected", session };
    }
    if (session.activeDevice && session.activeDevice !== deviceId) {
      return { ok: false, reason: "locked", session };
    }
    return {
      ok: true,
      reason: null,
      session: { ...session, activeDevice: deviceId }
    };
  }

  function setPosition(session, deviceId, position) {
    if (!session || session.status === "ended" || !session.participants.includes(deviceId)) {
      return { ok: false, reason: "not-connected", session };
    }
    if (session.activeDevice && session.activeDevice !== deviceId) {
      return { ok: false, reason: "locked", session };
    }
    if (!isValidPosition(position)) {
      return { ok: false, reason: "invalid-position", session };
    }
    return {
      ok: true,
      reason: null,
      session: { ...session, position }
    };
  }

  function releaseControl(session, deviceId) {
    if (!session || session.activeDevice !== deviceId) {
      return { ok: true, session };
    }
    return { ok: true, session: { ...session, activeDevice: null } };
  }

  function leaveSession(session, deviceId) {
    if (!session || session.status === "ended" || !session.participants.includes(deviceId)) {
      return { ok: false, reason: "not-connected", session };
    }
    const participants = session.participants.filter(id => id !== deviceId);
    return {
      ok: true,
      reason: null,
      session: {
        ...session,
        participants,
        activeDevice: session.activeDevice === deviceId ? null : session.activeDevice,
        status: participants.length ? "waiting" : "ended"
      }
    };
  }

  function endSession(session) {
    if (!session || session.status === "ended") {
      return { ok: false, reason: "ended", session };
    }
    return {
      ok: true,
      reason: null,
      session: { ...session, status: "ended", participants: [], activeDevice: null }
    };
  }

  function nextDeviceId(session) {
    if (!session || !session.participants.includes("A")) return "A";
    if (!session.participants.includes("B")) return "B";
    return "C";
  }

  function createMockCode(random = Math.random) {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let index = 0; index < 4; index += 1) {
      code += alphabet[Math.floor(random() * alphabet.length) % alphabet.length];
    }
    return code;
  }

  function toggleOrientation(orientation) {
    return orientation === "vertical" ? "horizontal" : "vertical";
  }

  const api = Object.freeze({
    CHOICES,
    choiceForPosition,
    sliderIndexForPosition,
    positionForSliderIndex,
    isValidPosition,
    MAX_PARTICIPANTS,
    normalizeCode,
    createSession,
    joinSession,
    claimControl,
    setPosition,
    releaseControl,
    leaveSession,
    endSession,
    nextDeviceId,
    createMockCode,
    toggleOrientation
  });

  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MassageFeedbackModel = api;
})(typeof window !== "undefined" ? window : globalThis);
