(function exposeMassageFeedbackApi(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MassageFeedbackApi = api;
})(typeof window !== "undefined" ? window : globalThis, function createMassageFeedbackApi(root) {
  "use strict";

  const DEFAULT_BASE_PATH = "/api/massagefeedback";

  class ApiError extends Error {
    constructor(message, status = 0, retryAfter = null) {
      super(message);
      this.name = "MassageFeedbackApiError";
      this.status = status;
      this.retryAfter = retryAfter;
    }
  }

  function createSessionApi(options = {}) {
    const fetcher = options.fetchImpl || root.fetch?.bind(root);
    if (typeof fetcher !== "function") throw new TypeError("A fetch implementation is required.");
    const basePath = String(options.basePath || DEFAULT_BASE_PATH).replace(/\/+$/, "");

    async function request(path, requestOptions = {}) {
      const {
        method = "GET",
        body,
        capability,
        joinTicket,
        signal
      } = requestOptions;
      const headers = {};
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (capability) headers.Authorization = `Bearer ${capability}`;
      if (joinTicket) headers["X-Massage-Join-Ticket"] = joinTicket;

      let response;
      try {
        response = await fetcher(`${basePath}${path}`, {
          method,
          headers,
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          ...(signal ? { signal } : {}),
          cache: "no-store"
        });
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        throw new ApiError("Nätverksfel. Kontrollera anslutningen och försök igen.");
      }

      let payload = null;
      const contentType = response.headers?.get?.("content-type") || "";
      if (contentType.includes("application/json")) {
        try {
          payload = await response.json();
        } catch {
          payload = null;
        }
      }
      if (!response.ok || payload?.ok === false) {
        const retryAfterHeader = response.headers?.get?.("retry-after");
        const retryAfter = retryAfterHeader && Number.isFinite(Number(retryAfterHeader))
          ? Number(retryAfterHeader)
          : null;
        throw new ApiError(
          payload?.error || "Begäran kunde inte genomföras. Försök igen.",
          response.status,
          retryAfter
        );
      }
      return payload || {};
    }

    async function openEvents(code, capability, signal) {
      let response;
      try {
        response = await fetcher(`${basePath}/sessions/${encodeURIComponent(code)}/events`, {
          method: "GET",
          headers: { Authorization: `Bearer ${capability}` },
          signal,
          cache: "no-store"
        });
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        throw new ApiError("Nätverksfel. Försöker återansluta till sessionen.");
      }
      if (!response.ok) {
        let payload = null;
        try {
          payload = await response.json();
        } catch {}
        const retryAfterHeader = response.headers?.get?.("retry-after");
        const retryAfter = retryAfterHeader && Number.isFinite(Number(retryAfterHeader))
          ? Number(retryAfterHeader)
          : null;
        throw new ApiError(
          payload?.error || "Sessionen kunde inte öppnas. Kontrollera koden och försök igen.",
          response.status,
          retryAfter
        );
      }
      if (!response.headers?.get?.("content-type")?.includes("text/event-stream") || !response.body) {
        throw new ApiError("Servern skickade ingen giltig sessionsström.", response.status);
      }
      return response.body;
    }

    const sessionPath = code => `/sessions/${encodeURIComponent(code)}`;
    const post = (path, body, capability, extra = {}) =>
      request(path, { method: "POST", body, capability, ...extra });

    return Object.freeze({
      createSession: () => post("/sessions", {}),
      requestJoin: code => post("/join-requests", { code }),
      getJoinStatus: (code, requestId, joinTicket, signal) =>
        post("/join-requests/status", { code, requestId }, null, { joinTicket, signal }),
      decideJoin: (code, requestId, decision, capability) =>
        post(`${sessionPath(code)}/join-requests/${encodeURIComponent(requestId)}/decision`, { decision }, capability),
      getSession: (code, capability, signal) =>
        request(sessionPath(code), { capability, signal }),
      openEvents,
      heartbeat: (code, capability, signal) =>
        post(`${sessionPath(code)}/heartbeat`, {}, capability, { signal }),
      claimControl: (code, capability, signal) =>
        post(`${sessionPath(code)}/control/claim`, {}, capability, { signal }),
      setPosition: (code, position, capability, signal) =>
        post(`${sessionPath(code)}/position`, { position }, capability, { signal }),
      releaseControl: (code, capability, signal) =>
        post(`${sessionPath(code)}/control/release`, {}, capability, { signal }),
      leave: (code, capability, signal) =>
        post(`${sessionPath(code)}/leave`, {}, capability, { signal }),
      end: (code, capability, signal) =>
        post(`${sessionPath(code)}/end`, {}, capability, { signal })
    });
  }

  async function* readEvents(stream) {
    if (!stream || typeof stream.getReader !== "function") {
      throw new TypeError("An SSE ReadableStream is required.");
    }
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let eventName = "message";
    let dataLines = [];

    function consumeLine(line) {
      if (line === "") {
        if (dataLines.length === 0) {
          eventName = "message";
          return null;
        }
        const rawData = dataLines.join("\n");
        const event = { event: eventName, data: JSON.parse(rawData) };
        eventName = "message";
        dataLines = [];
        return event;
      }
      if (line.startsWith(":")) return null;
      const separator = line.indexOf(":");
      const field = separator === -1 ? line : line.slice(0, separator);
      const value = separator === -1
        ? ""
        : line.slice(separator + 1).replace(/^ /, "");
      if (field === "event") eventName = value;
      if (field === "data") dataLines.push(value);
      return null;
    }

    try {
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        let newline = buffer.indexOf("\n");
        while (newline !== -1) {
          const line = buffer.slice(0, newline).replace(/\r$/, "");
          buffer = buffer.slice(newline + 1);
          const event = consumeLine(line);
          if (event) yield event;
          newline = buffer.indexOf("\n");
        }
        if (done) {
          if (buffer) {
            const event = consumeLine(buffer.replace(/\r$/, ""));
            if (event) yield event;
          }
          const finalEvent = consumeLine("");
          if (finalEvent) yield finalEvent;
          break;
        }
      }
    } finally {
      try { await reader.cancel(); } catch {}
    }
  }

  return Object.freeze({ ApiError, createSessionApi, readEvents });
});
