(function installWorkoutPlannerMockPreview() {
  const page = window.WORKOUTPLANNER_MOCK_PREVIEW_PAGE;
  const validPages = new Set(["coach", "overview", "recipient"]);
  if (!validPages.has(page) || !window.WorkoutPlannerMockHarness) return;

  const preview = window.WorkoutPlannerMockHarness.createMockPreviewHarness(page);
  const nativeFetch = window.fetch.bind(window);
  window.__WORKOUTPLANNER_MOCK_PREVIEW__ = {
    page,
    state: preview.state,
    requests: preview.requests
  };
  window.fetch = preview.createFetch(
    nativeFetch,
    (body, status) => new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" }
    }),
    window.location.origin
  );

  const style = document.createElement("style");
  style.textContent = `
    .workoutplanner-mock-banner {
      align-items: center;
      background: #fff4d6;
      border-bottom: 1px solid #e7c86f;
      color: #5c4510;
      display: flex;
      flex-wrap: wrap;
      font: 600 13px/1.4 "DM Sans", sans-serif;
      gap: 5px 9px;
      justify-content: center;
      padding: 9px 16px;
      text-align: center;
    }
    .workoutplanner-mock-banner strong {
      letter-spacing: .04em;
    }
    .workoutplanner-mock-banner a {
      border: 1px solid #c6a947;
      border-radius: 999px;
      color: #5c4510;
      font-size: 12px;
      font-weight: 700;
      padding: 4px 10px;
      text-decoration: none;
    }
    .workoutplanner-mock-banner a:hover {
      background: #fffaf0;
    }
  `;
  document.head.append(style);

  function addPreviewBanner() {
    if (!document.body || document.querySelector(".workoutplanner-mock-banner")) return;
    const banner = document.createElement("aside");
    banner.className = "workoutplanner-mock-banner";
    banner.setAttribute("role", "status");
    banner.innerHTML = `<strong>MOCK DATA PREVIEW</strong><span>Changes stay in this tab. No real data is read or saved.</span>${
      page === "coach"
        ? '<a href="/__dev/workoutplanner/planning/">Open calendar prototype</a>'
        : ""
    }`;
    document.body.prepend(banner);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", addPreviewBanner, { once: true });
  } else {
    addPreviewBanner();
  }

  function navigateToPreview(event) {
    const link = event.target.closest("a[href]");
    if (!link) return;
    const url = new URL(link.href, window.location.href);
    let destination = "";
    let newTab = link.target === "_blank";

    if (url.pathname.startsWith("/api/workoutplanner/") && url.pathname.endsWith("/link")) {
      destination = "/__dev/workoutplanner/recipient/";
    } else if (url.pathname === "/admin/plans" || url.pathname === "/admin/plans/") {
      if (link.id === "createPlanBtn") return;
      destination = "/__dev/workoutplanner/coach/";
      newTab = false;
    } else if (url.pathname === "/admin/programs" || url.pathname === "/admin/programs/") {
      destination = "/__dev/workoutplanner/overview/";
      newTab = false;
    }
    if (!destination) return;
    event.preventDefault();
    event.stopPropagation();
    if (newTab) {
      window.open(destination, "_blank", "noopener");
    } else {
      window.location.assign(destination);
    }
  }

  document.addEventListener("click", navigateToPreview, true);
})();
