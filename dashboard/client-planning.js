(() => {
  "use strict";

  const mockRoute = /^\/__dev\/workoutplanner\/client-planning\/?$/;
  const previewHarness = mockRoute.test(window.location.pathname)
    ? window.WorkoutPlannerClientPlanningPreview
    : null;
  const pathMatch = window.location.pathname.match(/^\/planning\/([^/]+)\/?$/);
  const token = previewHarness?.token || (pathMatch ? decodeURIComponent(pathMatch[1]) : "");
  const app = document.getElementById("planner-app");
  const alertBox = document.getElementById("planner-alert");
  const modalBackdrop = document.getElementById("planner-modal-backdrop");
  const modal = document.getElementById("planner-modal");
  const toastBox = document.getElementById("planner-toast");
  const workspaceNav = document.getElementById("client-workspace-nav");
  const clientWorkoutWorkspace = window.ClientWorkoutWorkspace;
  const clientPlanningMockTools = window.ClientPlanningMockTools;
  const colors = [
    ["#e8f2e9", "#b8d2bd", "#28583b"],
    ["#e9edf2", "#c6d1dc", "#425b70"],
    ["#f3ebdf", "#e0ccb1", "#795c38"],
    ["#ece8f0", "#cec2d8", "#665377"],
    ["#e2efed", "#b7d6d0", "#315e56"],
    ["#f2e8e6", "#dfc3bc", "#84584c"]
  ];
  const mondayFirstWeekdays = [
    { weekday: 1, label: "Mon" },
    { weekday: 2, label: "Tue" },
    { weekday: 3, label: "Wed" },
    { weekday: 4, label: "Thu" },
    { weekday: 5, label: "Fri" },
    { weekday: 6, label: "Sat" },
    { weekday: 0, label: "Sun" }
  ];
  const weekdayLabel = weekday => mondayFirstWeekdays.find(day => day.weekday === Number(weekday))?.label || "Day";
  const weekdayPosition = weekday => mondayFirstWeekdays.findIndex(day => day.weekday === Number(weekday));
  const state = {
    client: null, programs: [], screen: "calendar", focus: monthStart(new Date()),
    range: 3, programId: null, program: null, meta: null, placement: null,
    weekIndex: 0, weekday: 0, saving: false,
    clientWorkspace: "planning",
    workouts: clientWorkoutWorkspace?.createState(),
    workoutSessionIndex: 0
  };
  let toastTimer;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[character]));
  }
  function fromISO(value) {
    const parts = String(value || "").slice(0, 10).split("-").map(Number);
    return parts.length === 3 && parts.every(Number.isFinite)
      ? new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]))
      : new Date(NaN);
  }
  function toISO(date) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  }
  function isMondayISODate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
    const date = fromISO(value);
    return !Number.isNaN(date.getTime()) && toISO(date) === value && date.getUTCDay() === 1;
  }
  function monthStart(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  }
  function addDays(value, amount) {
    const date = fromISO(value);
    date.setUTCDate(date.getUTCDate() + amount);
    return toISO(date);
  }
  function dayDiff(left, right) {
    return Math.round((fromISO(right) - fromISO(left)) / 86400000);
  }
  function dateLabel(value, options = { day: "numeric", month: "short" }) {
    const date = fromISO(value);
    return Number.isNaN(date.getTime()) ? "Date not set" : date.toLocaleDateString("en-GB", { ...options, timeZone: "UTC" });
  }
  function weekNumber(value) {
    const d = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  }
  function showToast(message) {
    toastBox.textContent = message;
    toastBox.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastBox.classList.remove("is-visible"), 2700);
  }
  function showError(message) {
    alertBox.textContent = message;
    alertBox.hidden = !message;
  }
  function renderWorkspaceNav(active) {
    if (!previewHarness || !workspaceNav) return;
    state.clientWorkspace = active;
    workspaceNav.innerHTML = `
      <button type="button" data-workspace-tab="planning" ${active === "planning" ? 'aria-current="page"' : ""}>Planning</button>
      <button type="button" data-workspace-tab="workouts" ${active === "workouts" ? 'aria-current="page"' : ""}>Workouts</button>`;
  }
  function renderClientWorkouts() {
    if (!previewHarness || !clientWorkoutWorkspace || !state.workouts) return;
    renderWorkspaceNav("workouts");
    app.innerHTML = clientWorkoutWorkspace.render(state.workouts);
  }
  function selectWorkspaceTab(tab) {
    if (!previewHarness) return;
    document.title = `${state.client?.displayName || "Your"} ${tab === "workouts" ? "Workouts" : "Planning"} — HälsoPulsen`;
    if (tab === "workouts") return renderClientWorkouts();
    state.clientWorkspace = "planning";
    renderCalendar();
  }
  async function request(url, options = {}) {
    let result;
    let status;
    let ok;
    if (previewHarness) {
      const response = await previewHarness.request(url, options);
      result = response.body || {};
      status = response.status;
      ok = status >= 200 && status < 300;
    } else {
      const response = await fetch(url, {
        cache: "no-store",
        ...options,
        headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) }
      });
      result = await response.json().catch(() => ({}));
      status = response.status;
      ok = response.ok;
    }
    if (!ok || !result.ok) {
      const error = new Error(result.error || "The request could not be completed.");
      error.status = status;
      error.code = result.code;
      throw error;
    }
    return result;
  }
  function endpoint(suffix = "") {
    return `/api/client-planner/${encodeURIComponent(token)}${suffix}`;
  }
  function titleRange(months) {
    const last = months[months.length - 1];
    const fmt = date => date.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
    return months.length === 1 ? fmt(months[0]) : `${fmt(months[0])} — ${fmt(last)}`;
  }
  function getMonthWeeks(date) {
    const first = monthStart(date);
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
    const start = new Date(first);
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    const weeks = [];
    for (let cursor = new Date(start); cursor <= last; cursor.setUTCDate(cursor.getUTCDate() + 7)) {
      const monday = new Date(cursor);
      const sunday = new Date(cursor);
      sunday.setUTCDate(sunday.getUTCDate() + 6);
      const clippedStart = monday < first ? first : monday;
      const clippedEnd = sunday > last ? last : sunday;
      weeks.push({ monday, sunday, clippedStart, clippedEnd });
    }
    return weeks;
  }
  function periodFor(program) {
    const startDate = program.placement?.plannedStartDate;
    if (!startDate) return null;
    const durationWeeks = Math.max(1, Number(program.placement.durationWeeks) || 1);
    return { startDate, endDate: addDays(startDate, durationWeeks * 7 - 1), durationWeeks };
  }
  function overlaps(program) {
    const a = periodFor(program);
    if (!a) return false;
    return state.programs.some(other => {
      if (other.id === program.id) return false;
      const b = periodFor(other);
      return b && a.startDate <= b.endDate && b.startDate <= a.endDate;
    });
  }
  function renderMonth(date, monthIndex) {
    const first = toISO(monthStart(date));
    const lastDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
    const last = toISO(lastDate);
    const weeks = getMonthWeeks(date);
    const active = state.programs
      .filter(program => {
        const period = periodFor(program);
        return period && period.startDate <= last && period.endDate >= first;
      })
      .sort((a, b) => periodFor(a).startDate.localeCompare(periodFor(b).startDate));
    const laneEnds = [];
    const placements = new Map();
    active.forEach(program => {
      const period = periodFor(program);
      const clipStart = period.startDate < first ? first : period.startDate;
      const clipEnd = period.endDate > last ? last : period.endDate;
      let lane = laneEnds.findIndex(end => end < clipStart);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = clipEnd;
      const start = fromISO(clipStart);
      const end = fromISO(clipEnd);
      const startWeekIndex = weeks.findIndex(week => start >= week.monday && start <= week.sunday);
      const endWeekIndex = weeks.findIndex(week => end >= week.monday && end <= week.sunday);
      const firstWeek = weeks[Math.max(0, startWeekIndex)];
      const fullSpan = Math.max(7, (endWeekIndex - startWeekIndex + 1) * 7);
      const leftDays = Math.max(0, dayDiff(toISO(firstWeek.monday), clipStart));
      const rightDays = Math.max(0, dayDiff(clipEnd, toISO(weeks[endWeekIndex].sunday)));
      placements.set(program, {
        lane: lane + 1, startWeekIndex, endWeekIndex,
        left: Math.min(95, leftDays / fullSpan * 100),
        width: Math.max(8, 100 - Math.min(95, leftDays / fullSpan * 100) - Math.min(95, rightDays / fullSpan * 100)),
        clipStart, clipEnd
      });
    });
    const headers = weeks.map(week => `
      <div class="planner-week-head">
        <span class="planner-week-number">Week ${weekNumber(week.monday)}</span>
        <span class="planner-week-dates">${week.clippedStart.getUTCDate()}–${week.clippedEnd.getUTCDate()} ${week.clippedStart.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })}</span>
      </div>`).join("");
    const bars = active.map(program => {
      const p = placements.get(program);
      const palette = colors[(state.programs.indexOf(program) + monthIndex) % colors.length];
      const span = p.endWeekIndex - p.startWeekIndex + 1;
      const range = `${dateLabel(p.clipStart)} – ${dateLabel(p.clipEnd)}`;
      return `<button type="button" class="planner-bar${overlaps(program) ? " is-overlap" : ""}"
        style="--start-col:${p.startWeekIndex + 1};--week-span:${span};--lane:${p.lane};--bar-left:${p.left}%;--bar-width:${p.width}%;--bar-bg:${palette[0]};--bar-border:${palette[1]};--bar-ink:${palette[2]}"
        data-open-program="${escapeHtml(program.id)}"
        aria-label="Open ${escapeHtml(program.name)}, ${escapeHtml(range)}, ${periodFor(program).durationWeeks} weeks">
        <span class="planner-bar-inner"><span class="planner-bar-dot"></span><span class="planner-bar-name">${escapeHtml(program.name || "Untitled program")}</span><span class="planner-bar-period">${escapeHtml(range)}</span></span>
      </button>`;
    }).join("");
    const mobile = active.length ? active.map(program => {
      const palette = colors[(state.programs.indexOf(program) + monthIndex) % colors.length];
      const period = periodFor(program);
      return `<button type="button" class="planner-mobile-program" data-open-program="${escapeHtml(program.id)}"
        style="--bar-bg:${palette[0]};--bar-border:${palette[1]};--bar-ink:${palette[2]}">
        <span class="mark"></span><span><strong>${escapeHtml(program.name || "Untitled program")}</strong>
        <small>${escapeHtml(dateLabel(period.startDate, { day: "numeric", month: "short", year: "numeric" }))} – ${escapeHtml(dateLabel(period.endDate, { day: "numeric", month: "short", year: "numeric" }))} · ${period.durationWeeks} weeks</small></span>
        <span aria-hidden="true">›</span></button>`;
    }).join("") : `<div class="planner-mobile-empty">No program is planned for this month.</div>`;
    const year = date.getUTCFullYear();
    const month = date.toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
    return `<article class="planner-month">
      <header class="planner-month-head"><h2>${escapeHtml(month)}<span>${year}</span></h2><span class="planner-month-meta">${weeks.length} Monday-start weeks</span></header>
      <div class="planner-timeline">
        <div class="planner-timeline-headers" style="--week-count:${weeks.length}">${headers}</div>
        ${active.length
          ? `<div class="planner-track" style="--week-count:${weeks.length};grid-template-rows:repeat(${Math.max(1, laneEnds.length)},39px)">${bars}</div>`
          : `<div class="planner-empty-track">Open planning space</div>`}
      </div>
      <div class="planner-mobile-list">${mobile}</div>
    </article>`;
  }
  function renderCalendar() {
    state.screen = "calendar";
    renderWorkspaceNav("planning");
    const months = Array.from({ length: state.range }, (_, index) => new Date(Date.UTC(state.focus.getUTCFullYear(), state.focus.getUTCMonth() + index, 1)));
    const scheduled = state.programs.filter(program => program.placement?.plannedStartDate);
    const unscheduled = state.programs.filter(program => !program.placement?.plannedStartDate);
    app.innerHTML = `
      <section class="planner-page-heading">
        <div><p class="planner-eyebrow">YOUR TRAINING PLAN</p><h1>Planning, at a glance.</h1>
          <p class="planner-lede">See how your programs fit across time. Calendar periods are separate from workouts and completed sessions.</p></div>
        <button class="planner-button planner-button-primary" type="button" data-action="add-program"><span aria-hidden="true">＋</span> Add program</button>
      </section>
      <section class="planner-toolbar" aria-label="Calendar controls">
        <div class="planner-period-nav">
          <span class="planner-stepper">
            <button class="planner-button planner-button-icon" type="button" data-action="previous" aria-label="Previous period">‹</button>
            <button class="planner-button planner-button-icon" type="button" data-action="next" aria-label="Next period">›</button>
          </span>
          <strong class="planner-period-title">${escapeHtml(titleRange(months))}</strong>
          <button class="planner-button planner-button-quiet" type="button" data-action="today">Today</button>
        </div>
        <div class="planner-ranges" role="group" aria-label="Calendar range">
          ${[1, 3, 6, 12].map(size => `<button type="button" class="planner-range" data-range="${size}" aria-pressed="${state.range === size}">${size} mo</button>`).join("")}
        </div>
      </section>
      <div class="planner-legend"><span><i class="legend-mark"></i>Planned program</span><span>Weeks start Monday · overlapping periods are allowed</span></div>
      <section class="planner-month-stack" aria-label="Training plan calendar">${months.map(renderMonth).join("")}</section>
      ${unscheduled.length ? `<section class="planner-unscheduled"><h2>Not on the calendar yet</h2><div class="planner-unscheduled-list">
        ${unscheduled.map(program => `<button class="planner-unscheduled-item" type="button" data-open-program="${escapeHtml(program.id)}">
          <span class="legend-mark"></span><span><strong>${escapeHtml(program.name || "Untitled program")}</strong><small>${escapeHtml(program.versionStatus || "Draft")} · Choose dates to place this program</small></span><span aria-hidden="true">›</span>
        </button>`).join("")}</div></section>` : ""}
      <p class="planner-calendar-footnote"><strong>${state.programs.length}</strong> ${state.programs.length === 1 ? "program" : "programs"} in your plan. Select a block to view or edit its weeks, workouts and exercises.</p>`;
  }

  function currentWeek() {
    return state.program?.weeks?.[state.weekIndex] || null;
  }
  function currentDay() {
    const week = currentWeek();
    const day = week?.days?.find(item => Number(item.weekday) === state.weekday) || null;
    return previewHarness && clientPlanningMockTools
      ? clientPlanningMockTools.getSession(day, state.workoutSessionIndex)
      : day;
  }
  function reindexWeeks() {
    state.program.weeks.forEach((week, index) => { week.weekNumber = index + 1; });
    state.program.durationWeeks = state.program.weeks.length;
    if (state.weekIndex >= state.program.weeks.length) state.weekIndex = state.program.weeks.length - 1;
  }
  function cycleCard(week, index) {
    if (previewHarness && clientPlanningMockTools) return mockCycleCard(week, index);
    const days = mondayFirstWeekdays
      .map(item => (week.days || []).find(day => Number(day.weekday) === item.weekday))
      .filter(Boolean);
    const rows = days.map(day => {
      const active = Boolean(day.enabled || day.exercises?.length);
      const count = day.exercises?.length || 0;
      const dayName = weekdayLabel(day.weekday);
      return `<div class="planner-workout-row${active ? " is-active" : ""}">
        <span class="planner-day-pill">${dayName}</span>
        <span class="planner-workout-summary"><strong>${escapeHtml(active ? day.name || "Workout" : "Rest / open day")}</strong>
          <small>${active ? `${escapeHtml(day.sessionType || "Workout")} · ${count} ${count === 1 ? "exercise" : "exercises"}` : "No workout planned"}</small></span>
        <span class="planner-row-actions">
          ${active ? `<button class="planner-button planner-button-quiet" type="button" data-action="move-workout" data-week="${index}" data-day="${day.weekday}" data-direction="-1" aria-label="Move workout earlier" ${days.filter(item => item.enabled || item.exercises?.length)[0] === day ? "disabled" : ""}>↑</button>
            <button class="planner-button planner-button-quiet" type="button" data-action="move-workout" data-week="${index}" data-day="${day.weekday}" data-direction="1" aria-label="Move workout later" ${days.filter(item => item.enabled || item.exercises?.length).at(-1) === day ? "disabled" : ""}>↓</button>
            <button class="planner-button planner-button-quiet" type="button" data-action="open-workout" data-week="${index}" data-day="${day.weekday}">Open</button>
            <button class="planner-button planner-button-quiet planner-button-danger" type="button" data-action="remove-workout" data-week="${index}" data-day="${day.weekday}" aria-label="Remove ${escapeHtml(day.name || "workout")}">×</button>`
            : `<button class="planner-button planner-button-quiet" type="button" data-action="add-workout" data-week="${index}" data-day="${day.weekday}">＋ Add workout</button>`}
        </span>
      </div>`;
    }).join("");
    return `<article class="planner-week-card">
      <header class="planner-week-head">
        <div class="planner-week-label"><span class="planner-week-index">${index + 1}</span><span><span class="planner-week-name">${escapeHtml(week.name || `Week ${index + 1}`)}</span><span class="planner-week-phase">${escapeHtml(week.phase || "Foundation")}</span></span></div>
        <div class="planner-week-actions">
          <button class="planner-button planner-button-quiet" type="button" data-action="move-week" data-week="${index}" data-direction="-1" aria-label="Move week earlier" ${index === 0 ? "disabled" : ""}>↑</button>
          <button class="planner-button planner-button-quiet" type="button" data-action="move-week" data-week="${index}" data-direction="1" aria-label="Move week later" ${index === state.program.weeks.length - 1 ? "disabled" : ""}>↓</button>
          <button class="planner-button planner-button-quiet" type="button" data-action="duplicate-week" data-week="${index}">Duplicate</button>
          <button class="planner-button planner-button-quiet" type="button" data-action="edit-cycle" data-week="${index}">Edit week</button>
          <button class="planner-button planner-button-quiet planner-button-danger" type="button" data-action="remove-week" data-week="${index}" aria-label="Remove week ${index + 1}" ${state.program.weeks.length <= 1 ? "disabled" : ""}>×</button>
        </div>
      </header>
      ${(week.progressionNotes || week.successMetric) ? `<p class="planner-cycle-note">${escapeHtml([week.progressionNotes, week.successMetric].filter(Boolean).join(" · "))}</p>` : ""}
      <div class="planner-workout-list">${rows}</div>
    </article>`;
  }
  function mockCycleCard(week, index) {
    const rows = mondayFirstWeekdays.map(item => {
      const day = (week.days || []).find(entry => Number(entry.weekday) === item.weekday);
      if (!day) return "";
      const sessions = clientPlanningMockTools.listSessions(day);
      if (!sessions.length) {
        return `<div class="planner-workout-row is-rest-day">
          <span class="planner-day-pill">${item.label}</span>
          <span class="planner-workout-summary"><strong>Rest / open day</strong><small>No workout planned</small></span>
          <span class="planner-row-actions"><button class="planner-button planner-button-quiet" type="button" data-action="add-workout" data-week="${index}" data-day="${item.weekday}">＋ Add workout</button></span>
        </div>`;
      }
      return sessions.map((session, sessionIndex) => {
        const position = weekdayPosition(item.weekday);
        const earlier = position > 0 ? mondayFirstWeekdays[position - 1] : null;
        const later = position < mondayFirstWeekdays.length - 1 ? mondayFirstWeekdays[position + 1] : null;
        const count = session.exercises?.length || 0;
        return `<div class="planner-workout-row is-active${sessionIndex > 0 ? " is-additional-session" : ""}">
          <span class="planner-day-pill">${item.label}${sessions.length > 1 ? `<small>${sessionIndex + 1}/${sessions.length}</small>` : ""}</span>
          <span class="planner-workout-summary"><strong>${escapeHtml(session.name || "Workout")}</strong>
            <small>${escapeHtml(session.sessionType || "Workout")} · ${count} ${count === 1 ? "exercise" : "exercises"}${sessionIndex > 0 ? " · Additional session" : ""}</small></span>
          <span class="planner-row-actions">
            <button class="planner-button planner-button-quiet" type="button" data-action="move-workout" data-week="${index}" data-day="${item.weekday}" data-session-index="${sessionIndex}" data-direction="-1" aria-label="Move ${escapeHtml(session.name || "workout")} to ${earlier?.label || "an earlier day"}" ${earlier ? "" : "disabled"}>←</button>
            <button class="planner-button planner-button-quiet" type="button" data-action="move-workout" data-week="${index}" data-day="${item.weekday}" data-session-index="${sessionIndex}" data-direction="1" aria-label="Move ${escapeHtml(session.name || "workout")} to ${later?.label || "a later day"}" ${later ? "" : "disabled"}>→</button>
            <button class="planner-button planner-button-quiet" type="button" data-action="open-workout" data-week="${index}" data-day="${item.weekday}" data-session-index="${sessionIndex}">Open</button>
            <button class="planner-button planner-button-quiet planner-button-danger" type="button" data-action="remove-workout" data-week="${index}" data-day="${item.weekday}" data-session-index="${sessionIndex}" aria-label="Remove ${escapeHtml(session.name || "workout")}">×</button>
          </span>
        </div>`;
      }).join("") + `<div class="planner-workout-add-row"><button class="planner-button planner-button-quiet" type="button" data-action="add-workout" data-week="${index}" data-day="${item.weekday}">＋ Add another session</button></div>`;
    }).join("");
    return `<article class="planner-week-card">
      <header class="planner-week-head">
        <div class="planner-week-label"><span class="planner-week-index">${index + 1}</span><span><span class="planner-week-name">${escapeHtml(week.name || `Week ${index + 1}`)}</span><span class="planner-week-phase">${escapeHtml(week.phase || "Foundation")}</span></span></div>
        <div class="planner-week-actions">
          <button class="planner-button planner-button-quiet" type="button" data-action="move-week" data-week="${index}" data-direction="-1" aria-label="Move week earlier" ${index === 0 ? "disabled" : ""}>↑</button>
          <button class="planner-button planner-button-quiet" type="button" data-action="move-week" data-week="${index}" data-direction="1" aria-label="Move week later" ${index === state.program.weeks.length - 1 ? "disabled" : ""}>↓</button>
          <button class="planner-button planner-button-quiet" type="button" data-action="duplicate-week" data-week="${index}">Duplicate</button>
          <button class="planner-button planner-button-quiet" type="button" data-action="edit-cycle" data-week="${index}">Edit week</button>
          <button class="planner-button planner-button-quiet planner-button-danger" type="button" data-action="remove-week" data-week="${index}" aria-label="Remove week ${index + 1}" ${state.program.weeks.length <= 1 ? "disabled" : ""}>×</button>
        </div>
      </header>
      ${(week.progressionNotes || week.successMetric) ? `<p class="planner-cycle-note">${escapeHtml([week.progressionNotes, week.successMetric].filter(Boolean).join(" · "))}</p>` : ""}
      <div class="planner-workout-list">${rows}</div>
    </article>`;
  }
  function renderProgram() {
    state.screen = "program";
    renderWorkspaceNav("planning");
    if (!state.program) return renderCalendar();
    const weekCount = state.program.weeks.length;
    state.weekIndex = Math.max(0, Math.min(state.weekIndex, weekCount - 1));
    const selectedWeek = state.program.weeks[state.weekIndex];
    const period = state.placement?.plannedStartDate
      ? `${dateLabel(state.placement.plannedStartDate, { day: "numeric", month: "short", year: "numeric" })} – ${dateLabel(addDays(state.placement.plannedStartDate, Number(state.placement.durationWeeks) * 7 - 1), { day: "numeric", month: "short", year: "numeric" })}`
      : "Not placed on the calendar";
    const workouts = state.program.weeks.reduce((total, week) => total + (week.days || []).reduce((dayTotal, day) => (
      dayTotal + (day.enabled || day.exercises?.length ? 1 : 0)
        + (previewHarness && clientPlanningMockTools ? (day.additionalWorkouts?.length || 0) : 0)
    ), 0), 0);
    const programDuration = weekCount;
    const periodDuration = Number(state.placement?.durationWeeks) || programDuration;
    const periodIsCustom = Number(state.placement?.revision) > 0;
    const periodModeLabel = periodIsCustom
      ? `Custom calendar period · ${periodDuration} weeks`
      : periodDuration === programDuration
        ? `Period follows program · ${periodDuration} weeks`
        : `Calendar period · ${periodDuration} weeks`;
    app.innerHTML = `
      <div class="planner-editor-crumb"><button type="button" data-action="calendar">Planning</button><span>/</span><span>${escapeHtml(state.program.name || "Program")}</span></div>
      <header class="planner-editor-head">
        <div class="planner-title"><p class="planner-eyebrow">YOUR PROGRAM</p><h1>${escapeHtml(state.program.name || "Untitled program")}</h1>
          <p class="planner-summary">${escapeHtml(state.program.description || "Add a short purpose for this training block.")}</p>
          <div class="planner-meta-chips"><span class="planner-chip">${escapeHtml(state.meta?.versionStatus || "Draft")} · v${escapeHtml(state.meta?.version || 1)}</span><span class="planner-chip">Planned ${escapeHtml(period)}</span><span class="planner-chip">${programDuration} program ${programDuration === 1 ? "week" : "weeks"}</span><span class="planner-chip">${escapeHtml(periodModeLabel)}</span><span class="planner-chip">${workouts} workouts</span></div>
        </div>
        <div class="planner-editor-actions">
          <button class="planner-button" type="button" data-action="edit-period">Move / resize period</button>
          <button class="planner-button planner-button-danger" type="button" data-action="remove-program">Remove</button>
          <button class="planner-button planner-button-primary" type="button" data-action="calendar">Back to calendar</button>
        </div>
      </header>
      ${state.placement && periodDuration !== programDuration
        ? `<p class="planner-duration-note" role="status">This program contains ${programDuration} ${programDuration === 1 ? "week" : "weeks"}; its calendar period is ${periodDuration} ${periodDuration === 1 ? "week" : "weeks"}. The period is kept separate. Use <strong>Move / resize period</strong> to change it.</p>`
        : ""}
      <section class="planner-section">
        <header class="planner-section-head"><div><h2>Program details</h2><p>Program content is versioned separately from its calendar period.</p></div></header>
        <form class="planner-inline-fields" data-form="program-details">
          <label class="planner-field">Program name<input name="name" maxlength="120" required value="${escapeHtml(state.program.name || "")}"></label>
          <label class="planner-field">Purpose / goal<textarea name="description" maxlength="1000">${escapeHtml(state.program.description || "")}</textarea></label>
          <div class="planner-form-actions"><button class="planner-button planner-button-primary" type="submit">Save details</button><p class="planner-status" data-form-status role="status"></p></div>
        </form>
      </section>
      <section class="planner-section">
        <header class="planner-section-head planner-weeks-section-head">
          <div><h2>Training weeks</h2><p>Work on one week at a time; each keeps its own progression, workouts and prescriptions.</p></div>
          <div class="planner-week-tools">
            <div class="planner-week-navigation" aria-label="Week navigation">
              <button class="planner-button planner-button-quiet" type="button" data-action="previous-week" aria-label="Previous week" ${state.weekIndex === 0 ? "disabled" : ""}>‹ Previous</button>
              <label class="planner-week-selector"><span class="sr-only">Jump to week</span><select data-week-selector aria-label="Jump to week">${state.program.weeks.map((week, index) => `<option value="${index}" ${index === state.weekIndex ? "selected" : ""}>Week ${index + 1}${week.name ? ` · ${escapeHtml(week.name)}` : ""}</option>`).join("")}</select></label>
              <strong class="planner-week-position" aria-live="polite">Week ${state.weekIndex + 1} of ${weekCount}</strong>
              <button class="planner-button planner-button-quiet" type="button" data-action="next-week" aria-label="Next week" ${state.weekIndex >= weekCount - 1 ? "disabled" : ""}>Next ›</button>
            </div>
            <button class="planner-button planner-button-quiet" type="button" data-action="add-week">＋ Add week</button>
          </div>
        </header>
        ${selectedWeek ? cycleCard(selectedWeek, state.weekIndex) : ""}
      </section>`;
  }
  function optionList(values, selected) {
    const all = values.includes(selected) ? values : [...values, selected].filter(Boolean);
    return all.map(value => `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`).join("");
  }
  function field(label, name, value, type = "text", extra = "") {
    return `<label class="planner-field">${label}<input name="${name}" type="${type}" value="${escapeHtml(value ?? "")}" ${extra}></label>`;
  }
  function workoutForm(day) {
    return `<form class="planner-form-grid" data-form="workout">
      <label class="planner-field">Workout name<input name="name" maxlength="120" required value="${escapeHtml(day.name || "")}"></label>
      <label class="planner-field">Session type<select name="sessionType">${optionList(["Strength", "Cardio", "Mixed", "Mobility / recovery", "Guided session", "Other"], day.sessionType || "Strength")}</select></label>
      <label class="planner-field wide">Workout focus / notes<textarea name="description" maxlength="1000">${escapeHtml(day.description || "")}</textarea></label>
      <label class="planner-field">Warm-up<textarea name="warmup" maxlength="1000">${escapeHtml(day.warmup || "")}</textarea></label>
      <label class="planner-field">Cool-down<textarea name="cooldown" maxlength="1000">${escapeHtml(day.cooldown || "")}</textarea></label>
      <div class="planner-form-actions wide"><button class="planner-button planner-button-primary" type="submit">Save workout</button><p class="planner-status" data-form-status role="status"></p></div>
    </form>`;
  }
  function exerciseForm(exercise, index, total) {
    const hasAdvanced = exercise.format === "intervals" || exercise.heartRateTarget || exercise.tempo || exercise.description || exercise.goal || exercise.resourceUrl || exercise.workDurationSeconds || exercise.recoveryDurationSeconds;
    return `<article class="planner-exercise-card">
      <header class="planner-exercise-head"><span class="planner-exercise-number">${index + 1}</span><strong>${escapeHtml(exercise.name || "Exercise")}<small>${escapeHtml(exercise.activityType || "strength")} · ${escapeHtml(exercise.format || "sets")}</small></strong>
        <span class="planner-row-actions"><button class="planner-button planner-button-quiet" type="button" data-action="move-exercise" data-index="${index}" data-direction="-1" aria-label="Move exercise earlier" ${index === 0 ? "disabled" : ""}>↑</button><button class="planner-button planner-button-quiet" type="button" data-action="move-exercise" data-index="${index}" data-direction="1" aria-label="Move exercise later" ${index === total - 1 ? "disabled" : ""}>↓</button></span>
      </header>
      <form class="planner-exercise-form" data-form="exercise" data-index="${index}">
        <div class="planner-form-grid">
          <label class="planner-field">Exercise / activity<input name="name" maxlength="120" required value="${escapeHtml(exercise.name || "")}"></label>
          <label class="planner-field">Activity type<select name="activityType">${optionList(["strength", "cardio", "guided"], exercise.activityType || "strength")}</select></label>
          <label class="planner-field">Format<select name="format">${optionList(["sets", "continuous", "intervals", "guided"], exercise.format || "sets")}</select></label>
          <label class="planner-field">Sets<input name="sets" type="number" min="1" max="30" step="1" value="${escapeHtml(exercise.sets ?? 1)}"></label>
          <label class="planner-field">${exercise.format === "intervals" ? "Rounds" : "Target"}<input name="targetValue" type="number" min="0" step="any" value="${escapeHtml(exercise.targetValue ?? "")}"></label>
          <label class="planner-field">Target unit<select name="targetUnit">${optionList(["reps", "minutes", "seconds", "km", "metres", "rounds"], exercise.targetUnit || "reps")}</select></label>
          <label class="planner-field">Load<input name="load" type="number" min="0" step="any" value="${escapeHtml(exercise.load ?? "")}"></label>
          <label class="planner-field">Load unit<select name="loadUnit">${optionList(["kg", "lb"], exercise.loadUnit || "kg")}</select></label>
          <label class="planner-field">Effort · RIR<input name="rir" type="number" min="0" max="10" step="1" value="${escapeHtml(exercise.rir ?? "")}"></label>
          <label class="planner-field">Intensity / HR target<input name="intensity" value="${escapeHtml(exercise.intensity || "")}" placeholder="Easy, 75%, Zone 2…"></label>
          <label class="planner-field">Rest · seconds<input name="restSeconds" type="number" min="0" step="1" value="${escapeHtml(exercise.restSeconds ?? 0)}"></label>
          <label class="planner-field wide">Notes<textarea name="notes" maxlength="1000">${escapeHtml(exercise.notes || "")}</textarea></label>
        </div>
        <details class="planner-advanced" ${hasAdvanced ? "open" : ""}><summary>Additional prescription details</summary>
          <div class="planner-form-grid">
            ${field("Duration · minutes", "durationMinutes", exercise.durationMinutes, "number", 'min="0" step="any"')}
            ${field("Work interval · seconds", "workDurationSeconds", exercise.workDurationSeconds, "number", 'min="0" step="1"')}
            ${field("Recovery interval · seconds", "recoveryDurationSeconds", exercise.recoveryDurationSeconds, "number", 'min="0" step="1"')}
            ${field("Heart-rate target", "heartRateTarget", exercise.heartRateTarget)}
            ${field("Tempo", "tempo", exercise.tempo)}
            <label class="planner-field wide">Instructions<textarea name="description" maxlength="1000">${escapeHtml(exercise.description || "")}</textarea></label>
            <label class="planner-field wide">Exercise goal<textarea name="goal" maxlength="1000">${escapeHtml(exercise.goal || "")}</textarea></label>
            ${field("Resource link", "resourceUrl", exercise.resourceUrl, "url", 'placeholder="https://"')}
          </div>
        </details>
        <div class="planner-exercise-actions"><button class="planner-button planner-button-danger planner-button-quiet" type="button" data-action="remove-exercise" data-index="${index}">Remove exercise</button><button class="planner-button planner-button-primary planner-button-quiet" type="submit">Save exercise</button><p class="planner-status" data-form-status role="status"></p></div>
      </form>
    </article>`;
  }
  function renderWorkout() {
    state.screen = "workout";
    renderWorkspaceNav("planning");
    const day = currentDay();
    const week = currentWeek();
    if (!day || !week) return renderProgram();
    const exercises = day.exercises || [];
    app.innerHTML = `
      <div class="planner-editor-crumb"><button type="button" data-action="calendar">Planning</button><span>/</span><button type="button" data-action="program">Program</button><span>/</span><span>Workout</span></div>
      <header class="planner-editor-head"><div class="planner-title"><p class="planner-eyebrow">WEEK ${Number(week.weekNumber) || state.weekIndex + 1} · ${escapeHtml(week.phase || "FOUNDATION")}</p><h1>${escapeHtml(day.name || "Workout")}</h1><p class="planner-summary">Edit this planned workout and its exercise prescriptions. Completed sessions remain separate.</p></div>
        <div class="planner-editor-actions"><button class="planner-button planner-button-primary" type="button" data-action="program">Back to program</button></div></header>
      <section class="planner-section"><header class="planner-section-head"><div><h2>Workout overview</h2><p>Set the focus, session type and preparation notes.</p></div></header><div class="planner-workout-editor">${workoutForm(day)}</div></section>
      <section class="planner-section"><header class="planner-section-head"><div><h2>Exercises & activities</h2><p>Prescriptions stay in the program version; activity links and instructions are optional.</p></div><button class="planner-button planner-button-quiet" type="button" data-action="add-exercise">＋ Add exercise</button></header>
        <div class="planner-workout-editor"><div class="planner-exercise-list">${exercises.map((exercise, index) => exerciseForm(exercise, index, exercises.length)).join("") || `<p class="planner-summary">No exercises yet. Add the first exercise or activity.</p>`}</div></div>
      </section>`;
  }

  async function refreshProgramList() {
    const result = await request(endpoint());
    state.client = result.client;
    state.programs = Array.isArray(result.programs) ? result.programs : [];
  }
  async function openProgram(id) {
    showError("");
    try {
      const result = await request(endpoint(`/programs/${encodeURIComponent(id)}`));
      state.programId = id;
      state.program = result.program;
      state.meta = result.meta || {};
      state.placement = result.placement;
      state.weekIndex = 0;
      state.weekday = 0;
      state.workoutSessionIndex = 0;
      renderProgram();
    } catch (error) {
      showError(error.message);
    }
  }
  async function saveProgramContent() {
    if (!state.programId || state.saving) return false;
    state.saving = true;
    showError("");
    try {
      const result = await request(endpoint(`/programs/${encodeURIComponent(state.programId)}`), {
        method: "PUT",
        body: JSON.stringify({ program: state.program, expectedRevision: state.meta?.revision })
      });
      state.program = result.program || state.program;
      state.meta = { ...state.meta, ...result.meta };
      await refreshProgramList();
      const savedSummary = state.programs.find(program => program.id === state.programId);
      if (savedSummary) state.placement = savedSummary.placement || null;
      showToast(result.meta?.unchanged ? "No changes needed." : "Program content saved.");
      return true;
    } catch (error) {
      if (error.status === 409) showError("This program changed in another tab. Reload it before saving more edits.");
      else showError(error.message);
      return false;
    } finally {
      state.saving = false;
    }
  }
  function blankDay(weekday) {
    return { weekday, enabled: false, name: "", description: "", sessionType: "Rest / open day", warmup: "", cooldown: "", exercises: [] };
  }
  function blankWeek(number) {
    return {
      weekNumber: number, name: `Week ${number}`, phase: "Foundation",
      progressionNotes: "", successMetric: "",
      days: Array.from({ length: 7 }, (_, weekday) => blankDay(weekday))
    };
  }
  function blankExercise() {
    return {
      name: "New exercise", activityType: "strength", format: "sets",
      sets: 3, targetValue: 8, targetUnit: "reps", load: null, loadUnit: "kg",
      rir: null, restSeconds: 90, intensity: "", heartRateTarget: "",
      tempo: "", notes: "", description: "", goal: "", resourceUrl: "",
      durationMinutes: null, workDurationSeconds: null,
      recoveryDurationSeconds: null, rounds: null
    };
  }
  function openModal(title, description, form, submitLabel = "Save") {
    modal.innerHTML = `<header class="planner-modal-head"><div><h2 id="planner-modal-title">${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div><button class="planner-button planner-button-icon planner-button-quiet" type="button" data-action="close-modal" aria-label="Close">×</button></header>
      ${form}<footer class="planner-modal-footer"><button class="planner-button" type="button" data-action="close-modal">Cancel</button><button class="planner-button planner-button-primary" type="submit" form="planner-dialog-form">${escapeHtml(submitLabel)}</button></footer>`;
    modalBackdrop.hidden = false;
    modal.querySelector("input,textarea,select")?.focus();
  }
  function openAddProgram() {
    const today = toISO(new Date());
    openModal("Add a program", "Choose the program length and start date. Its initial calendar period follows these weeks; you can set a custom period later.", `
      <form class="planner-modal-body" id="planner-dialog-form" data-modal-form="add">
        <label class="planner-field">Program name<input name="name" maxlength="120" required value="New training block"></label>
        <label class="planner-field">Purpose / goal<textarea name="description" maxlength="1000" placeholder="What do you want this block to help you work toward?"></textarea></label>
        <div class="planner-form-grid"><label class="planner-field">Planned start<input name="plannedStartDate" type="date" required value="${today}"></label><label class="planner-field">Program length · weeks<input name="durationWeeks" type="number" min="1" max="52" required value="4"></label></div>
        <p class="planner-modal-error" data-modal-error role="alert"></p>
      </form>`, "Add program");
  }
  function openPeriodEditor() {
    const start = state.placement?.plannedStartDate || toISO(new Date());
    const weeks = Number(state.placement?.durationWeeks) || Math.max(1, Number(state.program?.weeks?.length) || 4);
    const customPeriod = Number(state.placement?.revision) > 0
      || (Number(state.placement?.durationWeeks) > 0 && Number(state.placement.durationWeeks) !== state.program?.weeks?.length);
    const description = customPeriod
      ? "This is a separate calendar period. Saving a range here keeps it unchanged when program weeks are edited."
      : "The calendar period currently follows the program length. Saving a different duration here makes the period custom.";
    openModal("Move or resize period", description, `
      <form class="planner-modal-body" id="planner-dialog-form" data-modal-form="period">
        <label class="planner-field">Program<input value="${escapeHtml(state.program.name || "")}" readonly></label>
        <div class="planner-form-grid"><label class="planner-field">Planned start<input name="plannedStartDate" type="date" required value="${escapeHtml(start)}"></label><label class="planner-field">Planned duration · weeks<input name="durationWeeks" type="number" min="1" max="52" required value="${weeks}"></label></div>
        <p class="planner-modal-error" data-modal-error role="alert"></p>
      </form>`, "Save period");
  }
  function openCycleEditor(index) {
    const week = state.program.weeks[index];
    if (!week) return;
    openModal(`Edit week ${index + 1}`, "These details belong to this week’s program content.", `
      <form class="planner-modal-body" id="planner-dialog-form" data-modal-form="cycle" data-week="${index}">
        <label class="planner-field">Week name<input name="name" maxlength="100" required value="${escapeHtml(week.name || `Week ${index + 1}`)}"></label>
        <label class="planner-field">Phase<input name="phase" maxlength="100" value="${escapeHtml(week.phase || "")}" placeholder="Foundation, Build, Recovery…"></label>
        <label class="planner-field">Progression guidance<textarea name="progressionNotes" maxlength="1000">${escapeHtml(week.progressionNotes || "")}</textarea></label>
        <label class="planner-field">Success metric<textarea name="successMetric" maxlength="1000">${escapeHtml(week.successMetric || "")}</textarea></label>
        <p class="planner-modal-error" data-modal-error role="alert"></p>
      </form>`, "Save week");
  }
  function readNumber(form, name) {
    const value = form.elements[name]?.value.trim() || "";
    return value === "" ? null : Number(value);
  }
  function swapDayContents(first, second) {
    const weekdayA = first.weekday;
    const weekdayB = second.weekday;
    const copyA = { ...first };
    const copyB = { ...second };
    Object.keys(first).forEach(key => { if (key !== "weekday") delete first[key]; });
    Object.keys(second).forEach(key => { if (key !== "weekday") delete second[key]; });
    Object.assign(first, copyB, { weekday: weekdayA });
    Object.assign(second, copyA, { weekday: weekdayB });
  }
  async function handleAction(action, element) {
    const weekIndex = Number(element.dataset.week);
    const dayIndex = Number(element.dataset.day);
    if (action === "calendar") return renderCalendar();
    if (action === "program") return renderProgram();
    if (action === "previous" || action === "next") {
      state.focus = new Date(Date.UTC(state.focus.getUTCFullYear(), state.focus.getUTCMonth() + (action === "next" ? state.range : -state.range), 1));
      return renderCalendar();
    }
    if (action === "today") { state.focus = monthStart(new Date()); return renderCalendar(); }
    if (action === "add-program") return openAddProgram();
    if (action === "edit-period") return openPeriodEditor();
    if (action === "remove-program") {
      if (!window.confirm("Remove this program from your planning workspace? It will be archived; completed sessions and their recorded history will be kept.")) return;
      try {
        await request(endpoint(`/programs/${encodeURIComponent(state.programId)}`), { method: "DELETE" });
        await refreshProgramList();
        state.programId = null;
        state.program = null;
        state.meta = null;
        state.placement = null;
        renderCalendar();
        showToast("Program removed from the calendar. Session history was kept.");
      } catch (error) { showError(error.message); }
      return;
    }
    if (action === "open-program") return openProgram(element.dataset.openProgram);
    if (action === "range") { state.range = Number(element.dataset.range); return renderCalendar(); }
    if (action === "add-week") {
      if (state.program.weeks.length >= 52) return showToast("A program can contain up to 52 weeks.");
      state.program.weeks.push(blankWeek(state.program.weeks.length + 1));
      state.weekIndex = state.program.weeks.length - 1;
      reindexWeeks();
      if (!await saveProgramContent()) return renderProgram();
      return renderProgram();
    }
    if (action === "previous-week" || action === "next-week") {
      const nextIndex = state.weekIndex + (action === "next-week" ? 1 : -1);
      if (nextIndex < 0 || nextIndex >= state.program.weeks.length) return;
      state.weekIndex = nextIndex;
      return renderProgram();
    }
    if (action === "duplicate-week") {
      if (state.program.weeks.length >= 52) return showToast("A program can contain up to 52 weeks.");
      const sourceWeek = state.program.weeks[weekIndex];
      if (!sourceWeek) return;
      const duplicate = JSON.parse(JSON.stringify(sourceWeek));
      duplicate.name = `${sourceWeek.name || `Week ${weekIndex + 1}`} · Copy`.slice(0, 100);
      state.program.weeks.splice(weekIndex + 1, 0, duplicate);
      state.weekIndex = weekIndex + 1;
      reindexWeeks();
      if (!await saveProgramContent()) return renderProgram();
      return renderProgram();
    }
    if (action === "move-week") {
      const target = weekIndex + Number(element.dataset.direction);
      if (target < 0 || target >= state.program.weeks.length) return;
      [state.program.weeks[weekIndex], state.program.weeks[target]] = [state.program.weeks[target], state.program.weeks[weekIndex]];
      state.weekIndex = target;
      reindexWeeks();
      if (!await saveProgramContent()) return renderProgram();
      return renderProgram();
    }
    if (action === "remove-week") {
      if (state.program.weeks.length <= 1) return;
      state.program.weeks.splice(weekIndex, 1);
      state.weekIndex = Math.min(weekIndex, state.program.weeks.length - 1);
      reindexWeeks();
      if (!await saveProgramContent()) return renderProgram();
      return renderProgram();
    }
    if (action === "edit-cycle") return openCycleEditor(weekIndex);
    if (action === "add-workout") {
      const week = state.program.weeks[weekIndex];
      const day = week?.days?.find(item => Number(item.weekday) === dayIndex);
      if (!day) return;
      if (previewHarness && clientPlanningMockTools) {
        const session = {
          enabled: true,
          name: "Workout",
          description: "",
          sessionType: "Strength",
          warmup: "",
          cooldown: "",
          exercises: [blankExercise()]
        };
        const sessionIndex = clientPlanningMockTools.addSession(week, dayIndex, session);
        if (sessionIndex < 0) return;
        state.weekIndex = weekIndex;
        state.weekday = dayIndex;
        state.workoutSessionIndex = sessionIndex;
        await saveProgramContent();
        return renderWorkout();
      }
      day.enabled = true;
      day.name = "Workout";
      day.sessionType = "Strength";
      day.exercises = [blankExercise()];
      state.weekIndex = weekIndex;
      state.weekday = dayIndex;
      state.workoutSessionIndex = 0;
      await saveProgramContent();
      return renderWorkout();
    }
    if (action === "open-workout") {
      state.weekIndex = weekIndex;
      state.weekday = dayIndex;
      state.workoutSessionIndex = previewHarness ? Number(element.dataset.sessionIndex || 0) : 0;
      return renderWorkout();
    }
    if (action === "remove-workout") {
      const day = state.program.weeks[weekIndex]?.days?.find(item => Number(item.weekday) === dayIndex);
      const sessionIndex = previewHarness ? Number(element.dataset.sessionIndex || 0) : 0;
      const workout = previewHarness && clientPlanningMockTools
        ? clientPlanningMockTools.getSession(day, sessionIndex)
        : day;
      if (!day || !workout || !window.confirm(`Remove ${workout.name || "this workout"} from ${weekdayLabel(dayIndex)}?`)) return;
      if (previewHarness && clientPlanningMockTools) {
        clientPlanningMockTools.removeSession(state.program.weeks[weekIndex], dayIndex, sessionIndex);
        state.workoutSessionIndex = 0;
        await saveProgramContent();
        return renderProgram();
      }
      Object.assign(day, blankDay(dayIndex));
      await saveProgramContent();
      return renderProgram();
    }
    if (action === "move-workout") {
      const week = state.program.weeks[weekIndex];
      if (previewHarness && clientPlanningMockTools) {
        const result = clientPlanningMockTools.moveSession(
          week,
          dayIndex,
          Number(element.dataset.direction),
          Number(element.dataset.sessionIndex || 0)
        );
        if (!result.moved) return showToast(result.reason === "week-boundary" ? "This workout is already at the edge of the week." : "The workout could not be moved.");
        state.workoutSessionIndex = result.sessionIndex;
        await saveProgramContent();
        return renderProgram();
      }
      const active = week.days.filter(day => day.enabled || day.exercises?.length)
        .sort((a, b) => weekdayPosition(a.weekday) - weekdayPosition(b.weekday));
      const current = active.findIndex(day => Number(day.weekday) === dayIndex);
      const target = active[current + Number(element.dataset.direction)];
      if (current < 0 || !target) return;
      swapDayContents(week.days.find(day => Number(day.weekday) === dayIndex), target);
      await saveProgramContent();
      return renderProgram();
    }
    if (action === "add-exercise") {
      const day = currentDay();
      if (!day) return;
      day.exercises = day.exercises || [];
      if (day.exercises.length >= 30) return showToast("A workout can contain up to 30 activities.");
      day.exercises.push(blankExercise());
      day.enabled = true;
      await saveProgramContent();
      return renderWorkout();
    }
    if (action === "move-exercise" || action === "remove-exercise") {
      const day = currentDay();
      if (!day) return;
      const index = Number(element.dataset.index);
      if (action === "remove-exercise") {
        if (!window.confirm("Remove this planned exercise? Completed session history will not change.")) return;
        day.exercises.splice(index, 1);
      } else {
        const target = index + Number(element.dataset.direction);
        if (target < 0 || target >= day.exercises.length) return;
        [day.exercises[index], day.exercises[target]] = [day.exercises[target], day.exercises[index]];
      }
      await saveProgramContent();
      return renderWorkout();
    }
    if (action === "close-modal") {
      modalBackdrop.hidden = true;
      modal.innerHTML = "";
    }
  }

  async function submitForm(event) {
    const form = event.target;
    if (form.matches("[data-client-workout-create]") && state.clientWorkspace === "workouts") {
      event.preventDefault();
      if (clientWorkoutWorkspace.savePersonalWorkout(state.workouts)) {
        state.workouts.libraryExpanded = true;
        renderClientWorkouts();
      } else renderClientWorkouts();
      return;
    }
    if (form.matches("[data-modal-form]")) {
      event.preventDefault();
      const data = new FormData(form);
      const error = form.querySelector("[data-modal-error]");
      const fail = message => { error.textContent = message; };
      if (form.dataset.modalForm === "add") {
        const name = String(data.get("name") || "").trim();
        const plannedStartDate = String(data.get("plannedStartDate") || "");
        const durationWeeks = Number(data.get("durationWeeks"));
        if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(plannedStartDate) || !Number.isInteger(durationWeeks) || durationWeeks < 1 || durationWeeks > 52) {
          return fail("Enter a name, valid start date and duration between 1 and 52 weeks.");
        }
        const program = {
          name, description: String(data.get("description") || "").trim(),
          startDate: null,
          durationWeeks,
          weeks: Array.from({ length: durationWeeks }, (_, index) => blankWeek(index + 1))
        };
        try {
          const result = await request(endpoint("/programs"), {
            method: "POST",
            body: JSON.stringify({ program, placement: { plannedStartDate, durationWeeks } })
          });
          modalBackdrop.hidden = true;
          await refreshProgramList();
          await openProgram(result.programId);
          showToast("Program added to your plan.");
        } catch (saveError) { fail(saveError.message); }
        return;
      }
      if (form.dataset.modalForm === "period") {
        const plannedStartDate = String(data.get("plannedStartDate") || "");
        const durationWeeks = Number(data.get("durationWeeks"));
        if (!/^\d{4}-\d{2}-\d{2}$/.test(plannedStartDate) || !Number.isInteger(durationWeeks) || durationWeeks < 1 || durationWeeks > 52) {
          return fail("Choose a valid start date and a duration between 1 and 52 weeks.");
        }
        try {
          const result = await request(endpoint(`/programs/${encodeURIComponent(state.programId)}/placement`), {
            method: "PATCH",
            body: JSON.stringify({
              plannedStartDate,
              durationWeeks,
              expectedRevision: state.placement?.revision ?? 0
            })
          });
          state.placement = { plannedStartDate, durationWeeks, revision: result.placement.revision };
          modalBackdrop.hidden = true;
          await refreshProgramList();
          renderProgram();
          showToast("Calendar period updated. Program content and sessions were not changed.");
        } catch (saveError) { fail(saveError.message); }
        return;
      }
      if (form.dataset.modalForm === "cycle") {
        const week = state.program.weeks[Number(form.dataset.week)];
        if (!week) return;
        week.name = String(data.get("name") || "").trim();
        week.phase = String(data.get("phase") || "").trim();
        week.progressionNotes = String(data.get("progressionNotes") || "").trim();
        week.successMetric = String(data.get("successMetric") || "").trim();
        modalBackdrop.hidden = true;
        if (await saveProgramContent()) renderProgram();
        return;
      }
    }
    if (form.matches('[data-form="program-details"]')) {
      event.preventDefault();
      state.program.name = String(form.elements.name.value || "").trim();
      state.program.description = String(form.elements.description.value || "").trim();
      if (await saveProgramContent()) renderProgram();
      return;
    }
    if (form.matches('[data-form="workout"]')) {
      event.preventDefault();
      const day = currentDay();
      if (!day) return;
      day.name = String(form.elements.name.value || "").trim();
      day.sessionType = String(form.elements.sessionType.value || "Other");
      day.description = String(form.elements.description.value || "").trim();
      day.warmup = String(form.elements.warmup.value || "").trim();
      day.cooldown = String(form.elements.cooldown.value || "").trim();
      day.enabled = true;
      if (await saveProgramContent()) renderWorkout();
      return;
    }
    if (form.matches('[data-form="exercise"]')) {
      event.preventDefault();
      const day = currentDay();
      const exercise = day?.exercises?.[Number(form.dataset.index)];
      if (!exercise) return;
      exercise.name = String(form.elements.name.value || "").trim();
      exercise.activityType = String(form.elements.activityType.value || "strength");
      exercise.format = String(form.elements.format.value || "sets");
      exercise.sets = readNumber(form, "sets") || 1;
      exercise.targetValue = readNumber(form, "targetValue");
      exercise.targetUnit = String(form.elements.targetUnit.value || "reps");
      exercise.load = readNumber(form, "load");
      exercise.loadUnit = String(form.elements.loadUnit.value || "kg");
      exercise.rir = readNumber(form, "rir");
      exercise.intensity = String(form.elements.intensity.value || "").trim();
      exercise.restSeconds = readNumber(form, "restSeconds") || 0;
      exercise.notes = String(form.elements.notes.value || "").trim();
      exercise.durationMinutes = readNumber(form, "durationMinutes");
      exercise.workDurationSeconds = readNumber(form, "workDurationSeconds");
      exercise.recoveryDurationSeconds = readNumber(form, "recoveryDurationSeconds");
      exercise.heartRateTarget = String(form.elements.heartRateTarget.value || "").trim();
      exercise.tempo = String(form.elements.tempo.value || "").trim();
      exercise.description = String(form.elements.description.value || "").trim();
      exercise.goal = String(form.elements.goal.value || "").trim();
      exercise.resourceUrl = String(form.elements.resourceUrl.value || "").trim();
      exercise.rounds = exercise.format === "intervals" ? (exercise.targetValue || 1) : null;
      if (await saveProgramContent()) renderWorkout();
    }
  }

  app.addEventListener("click", event => {
    const workoutAction = event.target.closest("[data-workout-action]");
    if (workoutAction && state.clientWorkspace === "workouts" && clientWorkoutWorkspace) {
      if (workoutAction.dataset.workoutAction === "back-to-planning"
        && previewHarness
        && state.workouts.returnToPlanning) {
        window.parent.postMessage({ type: "workoutplanner:return-to-planning" }, window.location.origin);
        return;
      }
      if (workoutAction.closest(".client-independent-library")) state.workouts.libraryExpanded = true;
      clientWorkoutWorkspace.handleAction(
        state.workouts,
        workoutAction.dataset.workoutAction,
        workoutAction.dataset.workoutId,
        workoutAction.dataset.source,
        workoutAction.dataset.entryId || workoutAction.dataset.exerciseIndex
      );
      renderClientWorkouts();
      if (workoutAction.dataset.workoutAction === "browse-independent") {
        document.getElementById("client-independent-library")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }
    const rangeButton = event.target.closest("[data-range]");
    if (rangeButton) {
      state.range = Number(rangeButton.dataset.range);
      renderCalendar();
      return;
    }
    const actionButton = event.target.closest("[data-action]");
    if (actionButton) {
      handleAction(actionButton.dataset.action, actionButton);
      return;
    }
    const programButton = event.target.closest("[data-open-program]");
    if (programButton) openProgram(programButton.dataset.openProgram);
  });
  workspaceNav?.addEventListener("click", event => {
    const tab = event.target.closest("[data-workspace-tab]");
    if (tab) selectWorkspaceTab(tab.dataset.workspaceTab);
  });
  app.addEventListener("input", event => {
    if (state.clientWorkspace !== "workouts" || !clientWorkoutWorkspace) return;
    if (event.target.closest("[data-client-workout-create]")) {
      clientWorkoutWorkspace.updateCreateDraft(state.workouts, event.target.name, event.target.value);
      return;
    }
    const workout = clientWorkoutWorkspace.activeWorkout(state.workouts);
    if (!workout) return;
    const result = event.target.closest("[data-workout-result]");
    if (result) {
      clientWorkoutWorkspace.setResult(
        state.workouts,
        workout,
        result.dataset.exerciseId,
        Number(result.dataset.setIndex),
        result.dataset.workoutResult,
        result.value
      );
      return;
    }
    const notes = event.target.closest("[data-workout-notes]");
    if (notes) clientWorkoutWorkspace.setNotes(state.workouts, workout, notes.value);
  });
  app.addEventListener("change", event => {
    if (state.clientWorkspace !== "workouts" || !clientWorkoutWorkspace) return;
    if (event.target.closest("[data-client-workout-create]")) {
      clientWorkoutWorkspace.updateCreateDraft(state.workouts, event.target.name, event.target.value);
      return;
    }
    const checkbox = event.target.closest("[data-workout-complete-set]");
    const workout = clientWorkoutWorkspace.activeWorkout(state.workouts);
    if (!checkbox || !workout) return;
    clientWorkoutWorkspace.setCompleted(
      state.workouts,
      workout,
      checkbox.dataset.exerciseId,
      Number(checkbox.dataset.setIndex),
      checkbox.checked
    );
  });
  app.addEventListener("change", event => {
    const selector = event.target.closest("[data-week-selector]");
    if (!selector || state.screen !== "program") return;
    const nextIndex = Number(selector.value);
    if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= state.program.weeks.length) return;
    state.weekIndex = nextIndex;
    renderProgram();
  });
  modal.addEventListener("click", event => {
    const button = event.target.closest('[data-action="close-modal"]');
    if (button) {
      modalBackdrop.hidden = true;
      modal.innerHTML = "";
    }
  });
  modalBackdrop.addEventListener("click", event => {
    if (event.target === modalBackdrop) {
      modalBackdrop.hidden = true;
      modal.innerHTML = "";
    }
  });
  document.addEventListener("submit", submitForm);
  document.addEventListener("click", event => {
    const modalAction = event.target.closest('[data-action="close-modal"]');
    if (modalAction && !modal.contains(modalAction)) {
      modalBackdrop.hidden = true;
      modal.innerHTML = "";
    }
  });

  async function start() {
    if (!token) {
      showError("This private client Planning link is invalid.");
      app.innerHTML = "";
      return;
    }
    try {
      if (previewHarness) renderWorkspaceNav("planning");
      await refreshProgramList();
      const params = new URLSearchParams(window.location.search);
      const initialTab = previewHarness && (params.get("workspace") === "workouts" || params.get("tab") === "workouts")
        ? "workouts"
        : "planning";
      document.title = `${state.client?.displayName || "Your"} ${initialTab === "workouts" ? "Workouts" : "Planning"} — HälsoPulsen`;
      if (initialTab === "workouts") {
        const launchFromUnifiedPlanning = previewHarness
          && params.get("embed") === "1"
          && params.get("workspace") === "workouts"
          && params.get("returnTo") === "planning";
        const weekStart = params.get("week");
        const workoutId = params.get("workout");
        if (launchFromUnifiedPlanning
          && state.workouts
          && workoutId
          && isMondayISODate(weekStart)
          && clientWorkoutWorkspace.getWorkouts(weekStart).some(workout => workout.id === workoutId)) {
          state.workouts.weekStart = weekStart;
          state.workouts.returnToPlanning = true;
          clientWorkoutWorkspace.handleAction(state.workouts, "open-workout", workoutId, "planned");
        }
        renderClientWorkouts();
      }
      else renderCalendar();
    } catch (error) {
      showError(error.message || "Your Planning workspace could not be loaded.");
      app.innerHTML = "";
    }
  }
  start();
})();
