(() => {
  "use strict";

  if (!window.WorkoutPlannerMockHarness) {
    throw new Error("Client Planning mock data is unavailable.");
  }

  const preview = window.WorkoutPlannerMockHarness.createClientPlannerPreviewHarness();
  window.WorkoutPlannerClientPlanningPreview = preview;
  window.__WORKOUTPLANNER_CLIENT_PLANNING_PREVIEW__ = preview;

  const style = document.createElement("style");
  style.textContent = `
    .client-planner-mock-banner {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      align-items: center;
      gap: 5px 9px;
      padding: 9px 16px;
      border-bottom: 1px solid #e7c86f;
      background: #fff4d6;
      color: #5c4510;
      font: 600 12px/1.4 "DM Sans", sans-serif;
      text-align: center;
    }
    .client-planner-mock-banner strong {
      letter-spacing: .04em;
    }
  `;
  document.head.append(style);

  const banner = document.createElement("aside");
  banner.className = "client-planner-mock-banner";
  banner.setAttribute("role", "status");
  const label = document.createElement("strong");
  label.textContent = "MOCK DATA PREVIEW";
  const message = document.createElement("span");
  message.textContent = "Edits stay in this tab and reset on refresh. No database is read or written.";
  banner.append(label, message);
  document.body.prepend(banner);
})();
