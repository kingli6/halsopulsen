(function exposeMassageFeedbackModel(root) {
  const POSITIONS = Object.freeze([
    "GREAT", "GOOD", "NOT MUCH", "4", "5", "6", "7", "8", "9", "10"
  ]);
  const MAX_PARTICIPANTS = 2;

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
    const nextPosition = Math.max(0, Math.min(POSITIONS.length - 1, Math.round(Number(position))));
    if (!Number.isFinite(nextPosition)) {
      return { ok: false, reason: "invalid-position", session };
    }
    return {
      ok: true,
      reason: null,
      session: { ...session, position: nextPosition }
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
    POSITIONS,
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
