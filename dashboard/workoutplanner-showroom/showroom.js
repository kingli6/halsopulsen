(function () {
  "use strict";

  const entries = [
    {
      id: "coach-unified-overview", group: "coach", title: "Unified Coach overview",
      status: "Mock-only", kind: "mock",
      differentiator: "A newer unified workspace overview: active program rhythm, recent activity and quick paths in one calm landing view.",
      source: "dashboard/workoutplanner-unified-mock/unified.html",
      route: "/__dev/workoutplanner/?screen=coach-overview",
      preview: "/__dev/workoutplanner/?screen=coach-overview",
      perspective: "Coach / Overview"
    },
    {
      id: "coach-planning-prototype", group: "coach", title: "Planning prototype",
      status: "Mock-only", kind: "mock",
      differentiator: "A focused calendar-first prototype for laying out and comparing a repeatable weekly schedule.",
      source: "dashboard/workoutplanner-planning-prototype/planning.html",
      route: "/__dev/workoutplanner/planning/",
      preview: "/__dev/workoutplanner/planning/",
      perspective: "Coach / Planning"
    },
    {
      id: "coach-library", group: "coach", title: "Program library & editor",
      status: "Production page · safe mock", kind: "production",
      differentiator: "The existing owner editor: reusable weeks and workouts, draft details, publishing, and a program library. API behavior is mocked in this preview.",
      source: "dashboard/plan/index.html",
      route: "/admin/plans/",
      preview: "/__dev/workoutplanner/coach/",
      perspective: "Coach / Program library"
    },
    {
      id: "coach-overview-production", group: "coach", title: "Program overview & private-link management",
      status: "Production page · safe mock", kind: "production",
      differentiator: "The existing owner overview for published programs, client progress, and private-link management; data and API responses are mocked.",
      source: "dashboard/coach-overview.html",
      route: "/admin/programs/",
      preview: "/__dev/workoutplanner/overview/",
      perspective: "Coach / Program overview"
    },
    {
      id: "coach-unified-library", group: "coach", title: "Unified Workout Library",
      status: "Mock-only", kind: "mock",
      differentiator: "A newer reusable-session catalog with type filters, search, and locally held example workout definitions.",
      source: "dashboard/workoutplanner-unified-mock/unified.html",
      route: "/__dev/workoutplanner/?screen=library",
      preview: "/__dev/workoutplanner/?screen=library",
      perspective: "Coach / Workout library"
    },
    {
      id: "client-unified-overview", group: "client", title: "Unified Client overview",
      status: "Mock-only", kind: "mock",
      differentiator: "A newer client landing page balancing the next planned session, recent activity, and a compact program summary.",
      source: "dashboard/workoutplanner-unified-mock/unified.html",
      route: "/__dev/workoutplanner/?screen=client-overview",
      preview: "/__dev/workoutplanner/?screen=client-overview",
      perspective: "Client / Overview"
    },
    {
      id: "client-unified-planning", group: "client", title: "Unified Client Planning",
      status: "Mock-only", kind: "mock",
      differentiator: "The unified planning view wraps the standalone calendar in the newer client shell, with date-led navigation.",
      source: "dashboard/workoutplanner-unified-mock/unified.html",
      route: "/__dev/workoutplanner/?screen=client-planning",
      preview: "/__dev/workoutplanner/?screen=client-planning",
      perspective: "Client / Planning"
    },
    {
      id: "client-unified-workouts", group: "client", title: "Unified Workouts & recording",
      status: "Mock-only", kind: "mock",
      differentiator: "A unified entry to workout detail and recording flows, using the existing standalone planning/logging mock screen.",
      source: "dashboard/workoutplanner-unified-mock/unified.html",
      route: "/__dev/workoutplanner/?screen=workouts",
      preview: "/__dev/workoutplanner/?screen=workouts",
      perspective: "Client / Workouts"
    },
    {
      id: "client-planning-production", group: "client", title: "Standalone Client Planning",
      status: "Production page · safe mock", kind: "production",
      differentiator: "The existing dedicated calendar experience with session detail and mock planning tools, shown with sample schedule data.",
      source: "dashboard/client-planning.html",
      route: "/planning/:token",
      preview: "/__dev/workoutplanner/client-planning/",
      perspective: "Client / Standalone planning"
    },
    {
      id: "client-recipient-production", group: "client", title: "Read-only recipient preview",
      status: "Production preview page · safe mock", kind: "production",
      differentiator: "The existing read-only recipient schedule and progress preview. Logging is disabled in preview mode; the route uses a local mock harness.",
      source: "dashboard/client.html",
      route: "/client/:token?preview=1",
      preview: "/__dev/workoutplanner/recipient/",
      perspective: "Client / Recipient dashboard"
    },
    {
      id: "client-shared-workspace", group: "client", title: "Shared program workspace",
      status: "Production/private-token · unavailable", kind: "unavailable",
      differentiator: "The active client workspace uses the shared program editor and recorder with live versioned program data.",
      source: "dashboard/plan/index.html · dashboard/plan.js",
      route: "/client/:token",
      preview: null,
      unavailableTitle: "Active recipient link required",
      unavailableMessage: "The shared client workspace requires a real private recipient token and database-backed program. No tokenless sample route exists, so it is intentionally not embedded.",
      perspective: "Client / Shared program"
    },
    {
      id: "client-legacy-json", group: "client", title: "Legacy JSON-backed client page",
      status: "Legacy/private-token · unavailable", kind: "unavailable",
      differentiator: "The legacy /p/:token page has no safe mock preview in this repository. It requires a real private link and associated data, so it is intentionally not embedded.",
      source: "dashboard/index.html",
      route: "/p/:token",
      preview: null,
      unavailableTitle: "Legacy private-link data required",
      unavailableMessage: "The legacy /p/:token JSON-backed page has no safe mock preview in this repository. It needs a real private link and associated data, so it is intentionally not embedded.",
      perspective: "Client / Legacy page"
    }
  ];

  const frame = document.getElementById("mock-frame");
  const frameShell = document.getElementById("frame-shell");
  const unavailablePanel = document.getElementById("unavailable-panel");
  const unavailableTitle = document.getElementById("unavailable-title");
  const unavailableCopy = document.getElementById("unavailable-copy");
  const unavailableCaption = document.getElementById("unavailable-caption");
  const openPreview = document.getElementById("open-preview");
  const title = document.getElementById("preview-title");
  const status = document.getElementById("preview-status");
  const perspective = document.getElementById("preview-perspective");
  const differentiator = document.getElementById("preview-differentiator");
  const source = document.getElementById("preview-source");
  const route = document.getElementById("preview-route");
  let selectedId = entries[0].id;
  let activeFilter = "all";

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
    });
  }

  function cardMarkup(item) {
    const unavailable = item.kind === "unavailable";
    const labelClass = item.kind === "production" ? " production" : unavailable ? " unavailable" : "";
    return `<article class="catalog-item${unavailable ? " item-unavailable" : ""}" data-entry="${escapeHtml(item.id)}">
      <div class="item-main">
        <div class="item-title-row">
          <h3>${escapeHtml(item.title)}</h3>
          <span class="status-label${labelClass}">${escapeHtml(item.status)}</span>
        </div>
        <p class="item-differentiator">${escapeHtml(item.differentiator)}</p>
        <div class="item-provenance">
          <span><b>File</b>${escapeHtml(item.source)}</span>
          <span><b>Route</b>${escapeHtml(item.route)}</span>
        </div>
      </div>
      <div class="item-actions">
        <button class="button" type="button" data-inspect="${escapeHtml(item.id)}" ${unavailable ? 'aria-label="Show unavailable route details"' : ""}>${unavailable ? "View note" : "Inspect"}</button>
        ${unavailable ? "" : `<a class="button button-quiet" href="${escapeHtml(item.preview)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${escapeHtml(item.title)} mock in a new tab">Open ↗</a>`}
      </div>
    </article>`;
  }

  function renderCatalog() {
    document.getElementById("coach-list").innerHTML = entries.filter(item => item.group === "coach").map(cardMarkup).join("");
    document.getElementById("client-list").innerHTML = entries.filter(item => item.group === "client").map(cardMarkup).join("");
    updateFilter();
    updateSelectedCard();
  }

  function updateSelectedCard() {
    document.querySelectorAll("[data-entry]").forEach(function (card) {
      const isSelected = card.dataset.entry === selectedId;
      card.classList.toggle("is-selected", isSelected);
      if (isSelected) card.setAttribute("aria-current", "true");
      else card.removeAttribute("aria-current");
    });
  }

  function selectEntry(id) {
    const item = entries.find(entry => entry.id === id);
    if (!item) return;
    selectedId = item.id;
    title.textContent = item.title;
    status.textContent = item.status;
    status.className = `status-pill${item.kind === "production" ? " production" : item.kind === "unavailable" ? " unavailable" : ""}`;
    perspective.textContent = item.perspective;
    differentiator.textContent = item.differentiator;
    source.textContent = item.source;
    route.textContent = item.route;
    const isUnavailable = !item.preview;
    frame.hidden = isUnavailable;
    unavailablePanel.hidden = !isUnavailable;
    if (isUnavailable) {
      unavailableTitle.textContent = item.unavailableTitle || "Private-link data required";
      unavailableCopy.textContent = item.unavailableMessage || "This page requires private recipient data and is intentionally not embedded.";
      unavailableCaption.textContent = "No token or production data requested";
    }
    frame.setAttribute("title", `${item.title} mock preview`);
    if (isUnavailable) {
      openPreview.hidden = true;
      openPreview.removeAttribute("href");
    } else {
      openPreview.hidden = false;
      openPreview.href = item.preview;
      frame.src = item.preview;
    }
    frameShell.classList.remove("view-in");
    void frameShell.offsetWidth;
    frameShell.classList.add("view-in");
    updateSelectedCard();
  }

  function updateFilter() {
    document.querySelectorAll("[data-filter]").forEach(function (button) {
      button.setAttribute("aria-pressed", String(button.dataset.filter === activeFilter));
    });
    document.querySelectorAll(".catalog-group").forEach(function (group) {
      const groupId = group.id;
      const visible = activeFilter === "all" || activeFilter === groupId;
      group.hidden = !visible;
    });
  }

  document.addEventListener("click", function (event) {
    const inspect = event.target.closest("[data-inspect]");
    if (inspect) {
      selectEntry(inspect.dataset.inspect);
      if (window.matchMedia("(max-width: 760px)").matches) {
        document.querySelector(".preview-desk").scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }
    const filter = event.target.closest("[data-filter]");
    if (filter) {
      activeFilter = filter.dataset.filter;
      updateFilter();
      return;
    }
    if (event.target.closest("#reload-preview")) {
      const item = entries.find(entry => entry.id === selectedId);
      if (item && item.preview) frame.src = item.preview;
    }
  });

  renderCatalog();
  selectEntry(selectedId);
})();
