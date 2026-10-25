(function () {
  "use strict";

  const app = document.getElementById("app-main");
  const dialogBackdrop = document.getElementById("dialog-backdrop");
  const dialog = document.getElementById("dialog");
  const toastRegion = document.getElementById("toast-region");
  const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const planningState = window.WorkoutPlannerPlanningState;
  const COLORS = [
    { bg: "#e5f0e6", border: "#b9d2bd", ink: "#28583b" },
    { bg: "#e9edf2", border: "#c6d1dc", ink: "#425b70" },
    { bg: "#f3ebdf", border: "#e0ccb1", ink: "#795c38" },
    { bg: "#ece8f0", border: "#cec2d8", ink: "#665377" },
    { bg: "#e2efed", border: "#b7d6d0", ink: "#315e56" },
    { bg: "#f2e8e6", border: "#dfc3bc", ink: "#84584c" }
  ];
  const clone = value => JSON.parse(JSON.stringify(value));
  const escapeHtml = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  const iso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const fromISO = value => {
    const parts = String(value || "").split("-").map(Number);
    return parts.length === 3 && parts.every(Number.isFinite) ? new Date(parts[0], parts[1] - 1, parts[2]) : new Date(NaN);
  };
  const addDays = (value, amount) => {
    const date = typeof value === "string" ? fromISO(value) : new Date(value);
    date.setDate(date.getDate() + amount);
    return iso(date);
  };
  const dayDiff = (start, end) => Math.round((fromISO(end) - fromISO(start)) / 86400000);
  const mondayStart = value => {
    const date = typeof value === "string" ? fromISO(value) : new Date(value);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    return date;
  };
  const monthStart = (year, month) => new Date(year, month, 1);
  const monthKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const monthLabel = date => date.toLocaleDateString("en-GB", { month: "long" });
  const shortDate = value => {
    const date = fromISO(value);
    return Number.isNaN(date.getTime()) ? "Date not set" : date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  };
  const longDate = value => {
    const date = fromISO(value);
    return Number.isNaN(date.getTime()) ? "Date not set" : date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  };
  const dateRange = (start, end) => `${shortDate(start)} – ${shortDate(end)}`;
  const dateInput = value => escapeHtml(value || "");
  const escAttr = escapeHtml;
  const weekNumber = date => {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  };
  const emptyDay = weekday => planningState.emptyDay(weekday);
  const emptyWeek = number => ({
    weekNumber: number,
    name: `Week ${number}`,
    phase: "Foundation",
    progressionNotes: "",
    successMetric: "",
    days: Array.from({ length: 7 }, (_, weekday) => emptyDay(weekday))
  });
  const emptyExercise = () => ({
    name: "New exercise",
    activityType: "strength",
    format: "sets",
    sets: 3,
    targetValue: 8,
    targetUnit: "reps",
    load: null,
    loadUnit: "kg",
    rir: 2,
    restSeconds: 90,
    intensity: "",
    notes: ""
  });

  const harness = window.WorkoutPlannerMockHarness;
  const fixture = harness && typeof harness.createMockPreviewHarness === "function"
    ? harness.createMockPreviewHarness("coach")
    : null;
  const fixtureRecords = fixture && fixture.state && Array.isArray(fixture.state.programs)
    ? clone(fixture.state.programs)
    : null;

  const state = {
    records: [],
    view: "calendar",
    focusDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    range: 3,
    activeId: null,
    activeWeek: 0,
    activeWeekday: 1,
    activeSessionIndex: 0,
    expandedExercise: null,
    returnView: "calendar",
    previewReturnId: null,
    nextId: 1,
    afterConfirm: null,
    dirty: false
  };

  function buildLocalRecords(records) {
    return records.map((source, index) => {
      const record = clone(source);
      const program = record.program || {};
      (Array.isArray(program.weeks) ? program.weeks : []).forEach(week => planningState.normalizeWeek(week));
      const startDate = program.startDate || record.row?.startDate || iso(new Date());
      const weeksCount = Math.max(1, Number(program.durationWeeks) || (program.weeks && program.weeks.length) || 1);
      return {
        ...record,
        program,
        schedule: {
          startDate,
          endDate: addDays(startDate, weeksCount * 7 - 1)
        },
        localColor: index % COLORS.length
      };
    });
  }

  if (fixtureRecords) {
    state.records = buildLocalRecords(fixtureRecords);
    if (state.records.length) {
      const first = fromISO(state.records[0].schedule.startDate);
      if (!Number.isNaN(first.getTime())) state.focusDate = new Date(first.getFullYear(), first.getMonth(), 1);
    }
  }

  function getRecord(id) {
    return state.records.find(record => String(record.row?.id) === String(id)) || null;
  }

  function getProgram() {
    return getRecord(state.activeId);
  }

  function ensureWeeks(record) {
    if (!Array.isArray(record.program.weeks)) record.program.weeks = [];
    return record.program.weeks;
  }

  function getWeek(record, index) {
    const weeks = ensureWeeks(record);
    return weeks[index] || null;
  }

  function getDay(week, weekday) {
    return planningState.ensureDay(week, Number(weekday));
  }

  function getActiveWorkout() {
    const record = getProgram();
    const week = record && getWeek(record, state.activeWeek);
    return week ? planningState.getSession(getDay(week, state.activeWeekday), state.activeSessionIndex) : null;
  }

  function toast(message) {
    toastRegion.replaceChildren();
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = message;
    toastRegion.appendChild(el);
    window.setTimeout(() => el.remove(), 2600);
  }

  function closeDialog() {
    dialogBackdrop.hidden = true;
    dialog.innerHTML = "";
    state.afterConfirm = null;
  }

  function openDialog(title, subtitle, body, footer) {
    dialog.innerHTML = `
      <div class="dialog-header">
        <div><h2 id="dialog-title">${escapeHtml(title)}</h2><p>${escapeHtml(subtitle || "")}</p></div>
        <button class="dialog-close" type="button" data-action="close-dialog" aria-label="Close dialog">×</button>
      </div>
      ${body}
      ${footer ? `<div class="dialog-footer">${footer}</div>` : ""}
    `;
    dialogBackdrop.hidden = false;
    const focusable = dialog.querySelector("input, select, textarea, button");
    if (focusable) focusable.focus();
  }

  function confirm(message, onConfirm, destructive) {
    state.afterConfirm = onConfirm;
    openDialog(
      destructive ? "Remove this item?" : "Confirm action",
      "This change stays in this temporary mock preview.",
      `<form data-form="confirm" id="confirm-form"><div class="dialog-body"><p style="margin:0;color:var(--muted);font-size:12px">${escapeHtml(message)}</p></div></form>`,
      `<button class="button" type="button" data-action="close-dialog">Cancel</button><button class="button ${destructive ? "button-danger" : "button-primary"}" type="submit" form="confirm-form">Confirm</button>`
    );
  }

  function pageShell(content) {
    return `<div class="mock-notice"><span class="notice-mark" aria-hidden="true">i</span><span><strong>Mock preview · changes reset on refresh.</strong> Planning and prescription edits exist only in this page; no client records or completed sessions are changed.</span></div><div class="view-transition">${content}</div>`;
  }

  function renderCalendar() {
    if (!fixtureRecords) {
      app.innerHTML = `<section class="error-state"><h2>Mock preview data is unavailable</h2><p>This planning prototype needs <strong>WorkoutPlannerMockHarness.createMockPreviewHarness('coach').state.programs</strong> to load its example programs. No API or production data fallback is used. Load the mock-preview harness before planning.js and refresh this page.</p></section>`;
      return;
    }
    const months = Array.from({ length: state.range }, (_, index) => new Date(state.focusDate.getFullYear(), state.focusDate.getMonth() + index, 1));
    const last = months[months.length - 1];
    const title = state.range === 1
      ? `${monthLabel(months[0])} ${months[0].getFullYear()}`
      : `${monthLabel(months[0])} ${months[0].getFullYear()} — ${monthLabel(last)} ${last.getFullYear()}`;
    const controls = `
      <div class="page-heading">
        <div><p class="eyebrow">Coach planning board</p><h1>Training plans, in view.</h1><p class="heading-subtitle">Place programs across time. Workout prescriptions stay inside their program; this calendar describes intent, not completed sessions.</p></div>
        <div class="heading-actions"><button class="button button-primary" type="button" data-action="add-program"><span aria-hidden="true">＋</span> Add program</button></div>
      </div>
      <div class="control-bar">
        <div class="period-navigation">
          <div class="stepper">
            <button class="button button-icon" type="button" data-action="previous-range" aria-label="Previous period">‹</button>
            <button class="button button-icon" type="button" data-action="next-range" aria-label="Next period">›</button>
          </div>
          <strong class="period-title">${escapeHtml(title)}</strong>
          <button class="button button-small button-quiet" type="button" data-action="today">Today</button>
        </div>
        <div class="range-buttons" role="group" aria-label="Calendar range">
          ${[1, 3, 6, 12].map(size => `<button class="range-button" type="button" data-action="set-range" data-range="${size}" aria-pressed="${state.range === size}">${size === 1 ? "1 mo" : `${size} mo`}</button>`).join("")}
        </div>
      </div>
      <div class="calendar-legend" aria-label="Calendar legend">
        <span class="legend-item"><span class="legend-swatch"></span> Planned program</span>
        <span class="legend-item"><span class="legend-outline"></span> Dashed edge marks an overlap</span>
        <span class="legend-item">Weeks start Monday · dates use actual calendar days</span>
      </div>`;
    const monthCards = months.map(renderMonth).join("");
    const overlapCount = countOverlaps();
    const footnote = `<p class="calendar-footnote"><strong>${state.records.length}</strong> program${state.records.length === 1 ? "" : "s"} in this local plan · <span class="overlap-note">${overlapCount ? `${overlapCount} visible overlap${overlapCount === 1 ? "" : "s"} allowed` : "No overlapping periods in the visible plan"}</span>. Select a program block to inspect its details or adjust dates.</p>`;
    app.innerHTML = pageShell(`${controls}<section class="calendar-stack" aria-label="Program planning calendar">${monthCards || `<div class="month-card"><div class="empty-track">No periods are visible yet.</div></div>`}</section>${footnote}`);
  }

  function countOverlaps() {
    let count = 0;
    for (let i = 0; i < state.records.length; i += 1) {
      for (let j = i + 1; j < state.records.length; j += 1) {
        const a = state.records[i].schedule;
        const b = state.records[j].schedule;
        if (a.startDate <= b.endDate && b.startDate <= a.endDate) count += 1;
      }
    }
    return count;
  }

  function overlapsWith(record) {
    return state.records.some(other => other !== record &&
      record.schedule.startDate <= other.schedule.endDate &&
      other.schedule.startDate <= record.schedule.endDate);
  }

  function getMonthWeeks(date) {
    const first = monthStart(date.getFullYear(), date.getMonth());
    const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const start = mondayStart(first);
    const weeks = [];
    for (let cursor = new Date(start); cursor <= last; cursor.setDate(cursor.getDate() + 7)) {
      const monday = new Date(cursor);
      const sunday = new Date(cursor);
      sunday.setDate(sunday.getDate() + 6);
      const clippedStart = monday < first ? first : monday;
      const clippedEnd = sunday > last ? last : sunday;
      weeks.push({
        monday,
        sunday,
        clippedStart,
        clippedEnd,
        startISO: iso(clippedStart),
        endISO: iso(clippedEnd)
      });
    }
    return weeks;
  }

  function renderMonth(date) {
    const monthStartDate = iso(monthStart(date.getFullYear(), date.getMonth()));
    const monthEndDate = iso(new Date(date.getFullYear(), date.getMonth() + 1, 0));
    const weeks = getMonthWeeks(date);
    const active = state.records.filter(record =>
      record.schedule.startDate <= monthEndDate && record.schedule.endDate >= monthStartDate
    );
    const sorted = active.slice().sort((a, b) => a.schedule.startDate.localeCompare(b.schedule.startDate) || a.schedule.endDate.localeCompare(b.schedule.endDate));
    const laneEnds = [];
    const placements = new Map();
    sorted.forEach(record => {
      const clipStart = record.schedule.startDate < monthStartDate ? monthStartDate : record.schedule.startDate;
      const clipEnd = record.schedule.endDate > monthEndDate ? monthEndDate : record.schedule.endDate;
      const lane = laneEnds.findIndex(end => end < clipStart);
      const index = lane < 0 ? laneEnds.length : lane;
      laneEnds[index] = clipEnd;
      const startDate = fromISO(clipStart);
      const endDate = fromISO(clipEnd);
      const startWeekIndex = weeks.findIndex(week => startDate >= week.monday && startDate <= week.sunday);
      const endWeekIndex = weeks.findIndex(week => endDate >= week.monday && endDate <= week.sunday);
      const firstWeek = weeks[Math.max(0, startWeekIndex)];
      const totalSpan = Math.max(7, (endWeekIndex - startWeekIndex + 1) * 7);
      const leftDays = Math.max(0, dayDiff(iso(firstWeek.monday), clipStart));
      const rightDays = Math.max(0, dayDiff(clipEnd, iso(weeks[endWeekIndex].sunday)));
      const left = Math.min(95, (leftDays / totalSpan) * 100);
      const right = Math.min(95, (rightDays / totalSpan) * 100);
      placements.set(record, { lane: index, startWeekIndex, endWeekIndex, left, width: Math.max(8, 100 - left - right), clipStart, clipEnd });
    });
    const weekHeaders = weeks.map(week => `
      <div class="week-head">
        <span class="week-num">Week ${weekNumber(week.monday)}</span>
        <span class="week-dates">${week.clippedStart.getDate()}–${week.clippedEnd.getDate()} ${week.clippedStart.toLocaleDateString("en-GB", { month: "short" })}</span>
      </div>`).join("");
    let track = "";
    if (!active.length) {
      track = `<div class="empty-track">Open planning space</div>`;
    } else {
      const bars = sorted.map(record => {
        const p = placements.get(record);
        const color = COLORS[record.localColor % COLORS.length];
        const lane = p.lane + 1;
        const span = p.endWeekIndex - p.startWeekIndex + 1;
        const rowStyle = `grid-column:${p.startWeekIndex + 1} / span ${span};grid-row:${lane};--bar-left:${p.left}%;--bar-width:${p.width}%;--program-bg:${color.bg};--program-border:${color.border};--program-ink:${color.ink}`;
        const overlapClass = overlapsWith(record) ? " is-overlap" : "";
        const name = record.program.name || record.row?.name || "Untitled program";
        const dates = dateRange(record.schedule.startDate, record.schedule.endDate);
        const durationDays = Math.max(1, dayDiff(record.schedule.startDate, record.schedule.endDate) + 1);
        return `<button class="program-bar${overlapClass}" style="${rowStyle}" type="button" data-action="open-program" data-id="${escAttr(record.row.id)}" aria-label="Open ${escAttr(name)}, planned ${escAttr(dates)}, ${durationDays} days${overlapsWith(record) ? ", overlaps another program" : ""}"><span class="program-bar-inner"><span class="bar-status"></span><span class="bar-name">${escapeHtml(name)}</span><span class="bar-dates">${escapeHtml(dates)} · ${durationDays}d</span></span></button>`;
      }).join("");
      track = `<div class="program-track" style="--week-count:${weeks.length};--lane-count:${Math.max(1, laneEnds.length)}">${bars}</div>`;
    }
    const mobilePrograms = active.length
      ? active.map(record => {
        const color = COLORS[record.localColor % COLORS.length];
        const name = record.program.name || record.row?.name || "Untitled program";
        const durationDays = Math.max(1, dayDiff(record.schedule.startDate, record.schedule.endDate) + 1);
        return `<button class="mobile-program" type="button" data-action="open-program" data-id="${escAttr(record.row.id)}" style="--program-bg:${color.bg};--program-border:${color.border}" aria-label="Open ${escAttr(name)}"><span class="mobile-program-mark"></span><span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(dateRange(record.schedule.startDate, record.schedule.endDate))} · ${durationDays} planned days</small></span><span class="mobile-status">${overlapsWith(record) ? "Overlap" : ""}</span></button>`;
      }).join("")
      : `<div class="mobile-empty">No program is planned for this month.</div>`;
    return `<article class="month-card" data-month="${monthKey(date)}">
      <header class="month-header"><h2 class="month-title">${escapeHtml(monthLabel(date))}<span class="month-year">${date.getFullYear()}</span></h2><span class="month-meta">${weeks.length} Monday-start weeks</span></header>
      <div class="month-grid" style="--week-count:${weeks.length}" aria-label="${escapeHtml(monthLabel(date))} ${date.getFullYear()} program timeline">${weekHeaders}${track}</div>
      <div class="month-list">${mobilePrograms}</div>
    </article>`;
  }

  function crumbs(current) {
    return `<div class="breadcrumbs"><button class="crumb-button" type="button" data-action="calendar-home">Planning</button><span class="crumb-separator">/</span><span>${escapeHtml(current)}</span></div>`;
  }

  function recordStatus(record) {
    const status = record.row?.versionStatus || "mock";
    return status === "published" ? "Published example" : status === "draft" ? "Draft example" : "Prototype";
  }

  function renderProgram() {
    const record = getProgram();
    if (!record) { state.view = "calendar"; render(); return; }
    const program = record.program;
    const weeks = ensureWeeks(record);
    const sessions = weeks.flatMap(week => (week.days || []).flatMap(day => planningState.listSessions(day)));
    const scheduledWorkouts = sessions.filter(planningState.isScheduled).length;
    const independentWorkouts = sessions.filter(planningState.isIndependent).length;
    const header = `
      ${crumbs("Program")}
      <div class="editor-summary">
        <div class="editor-title-area">
          <p class="eyebrow">Program details</p>
          <h1 class="editor-title">${escapeHtml(program.name || "Untitled program")}</h1>
          <p class="editor-description">${escapeHtml(program.description || program.goal || "Add a purpose for this training block.")}</p>
          <div class="editor-meta">
            <span class="meta-chip status-chip">${escapeHtml(recordStatus(record))}</span>
            <span class="meta-chip">Planned ${escapeHtml(dateRange(record.schedule.startDate, record.schedule.endDate))}</span>
            <span class="meta-chip">${Math.max(1, Number(program.durationWeeks) || 1)} intended weeks</span>
            <span class="meta-chip">${weeks.length} cycle ${weeks.length === 1 ? "week" : "weeks"}</span>
            <span class="meta-chip">${scheduledWorkouts} scheduled workouts</span>
            <span class="meta-chip">${independentWorkouts} independent workouts</span>
          </div>
        </div>
        <div class="editor-actions">
          ${record.row?.hasCurrentVersion ? `<button class="button button-small" type="button" data-action="preview-program">Client view</button>` : ""}
          <button class="button button-small" type="button" data-action="edit-schedule" data-id="${escAttr(record.row.id)}">Edit dates</button>
          <button class="button button-primary button-small" type="button" data-action="calendar-home">Back to calendar</button>
        </div>
      </div>`;
    const weekCards = weeks.map((week, index) => renderWeekCard(week, index, weeks.length)).join("");
    const weeksSection = `
      <section class="section-card">
        <header class="section-card-header"><div><h2>Training cycle</h2><p>Program weeks and their prescribed workouts.</p></div><button class="button button-small" type="button" data-action="add-week">＋ Add week</button></header>
        <div class="weeks-list">${weekCards || `<div class="empty-week">No cycle weeks yet. Add a week to start organizing workouts.</div>`}</div>
      </section>`;
    const sidebar = `
      <aside class="editor-sidebar">
        <section class="section-card side-card">
          <h3>Program details</h3>
          <p>Name, purpose and intended length are editable here. The planned calendar period is separate.</p>
          <button class="button button-small" type="button" data-action="edit-program-details">Edit program details</button>
        </section>
        <section class="section-card side-card">
          <h3>Calendar period</h3>
          <p>${escapeHtml(longDate(record.schedule.startDate))}<br>through ${escapeHtml(longDate(record.schedule.endDate))}</p>
          <p class="muted-small">Moving or resizing this period never edits workouts or prescriptions.</p>
          <button class="button button-small" type="button" data-action="edit-schedule" data-id="${escAttr(record.row.id)}">Move / resize</button>
        </section>
        <section class="section-card side-card">
          <h3>Cycle success metric</h3>
          <p class="goal-metric">${escapeHtml(weeks[0]?.successMetric || "No success metric added yet.")}</p>
          <p class="muted-small">Cycle notes describe the prescription. Completed sessions are not part of this planning board.</p>
        </section>
      </aside>`;
    app.innerHTML = pageShell(`${header}<div class="editor-layout">${weeksSection}${sidebar}</div>`);
  }

  function renderWeekCard(week, index, total) {
    planningState.normalizeWeek(week);
    const workouts = Array.from({ length: 7 }, (_, weekday) => {
      const day = getDay(week, weekday);
      const dayLabel = DAY_NAMES[(weekday + 6) % 7] || "Day";
      const sessions = planningState.listSessions(day);
      const rows = sessions.map((workout, sessionIndex) => {
        const exerciseCount = Array.isArray(workout.exercises) ? workout.exercises.length : 0;
        const availability = planningState.normalizeAvailability(workout.availability);
        const availabilityLabel = availability === "both" ? "Program + independent" : availability === "independent" ? "Independent" : "Program";
        return `<div class="workout-row">
          <span class="workout-info"><span class="workout-name">${escapeHtml(workout.name || "Untitled workout")}</span><span class="workout-subline">${escapeHtml(workout.sessionType || "Workout")}${workout.description ? ` · ${escapeHtml(workout.description)}` : ""}</span></span>
          <span class="workout-availability availability-${availability}">${availabilityLabel}</span>
          <span class="workout-count">${exerciseCount} ${exerciseCount === 1 ? "exercise" : "exercises"}</span>
          <span class="workout-row-actions">
            <button class="compact-action" type="button" data-action="move-workout" data-week="${index}" data-weekday="${weekday}" data-session-index="${sessionIndex}" data-direction="-1" aria-label="Move ${escAttr(workout.name || "workout")} to the previous day" ${weekday === 0 ? "disabled" : ""}>↑</button>
            <button class="compact-action" type="button" data-action="move-workout" data-week="${index}" data-weekday="${weekday}" data-session-index="${sessionIndex}" data-direction="1" aria-label="Move ${escAttr(workout.name || "workout")} to the next day" ${weekday === 6 ? "disabled" : ""}>↓</button>
            <button class="workout-open" type="button" data-action="open-workout" data-week="${index}" data-weekday="${weekday}" data-session-index="${sessionIndex}">Open</button>
          </span>
        </div>`;
      }).join("");
      return `<section class="workout-day-group">
        <header class="workout-day-heading"><strong>${dayLabel}</strong><button class="button button-small day-add-button" type="button" data-action="add-workout" data-week="${index}" data-weekday="${weekday}">＋ Add workout</button></header>
        <div class="workout-day-sessions">${rows || `<p class="empty-day-note">No workout scheduled</p>`}</div>
      </section>`;
    }).join("");
    return `<article class="week-card">
      <header class="week-card-head">
        <div class="week-heading"><span class="week-index">${Number(week.weekNumber) || index + 1}</span><div><p class="week-name">${escapeHtml(week.name || `Week ${index + 1}`)}</p><p class="week-phase">${escapeHtml(week.phase || "Unassigned phase")}</p></div></div>
        <div class="week-head-actions">
          <button class="compact-action" type="button" data-action="edit-cycle" data-week="${index}" aria-label="Edit cycle week ${index + 1}">Edit cycle</button>
          <button class="compact-action" type="button" data-action="remove-week" data-week="${index}" aria-label="Remove week ${index + 1}" ${total <= 1 ? "disabled" : ""}>×</button>
        </div>
      </header>
      <div class="week-cycle-fields">
        <div class="cycle-note"><strong>Progression</strong><p>${escapeHtml(week.progressionNotes || "No coach progression notes.")}</p></div>
        <div class="cycle-note"><strong>Success metric</strong><p>${escapeHtml(week.successMetric || "No success metric.")}</p></div>
      </div>
      <div class="workout-list">${workouts}</div>
    </article>`;
  }

  function renderWorkout() {
    const record = getProgram();
    const week = record && getWeek(record, state.activeWeek);
    const workout = getActiveWorkout();
    if (!record || !week || !workout) { state.view = "program"; render(); return; }
    const exercises = Array.isArray(workout.exercises) ? workout.exercises : [];
    const prescription = exercise => {
      const units = exercise.targetUnit || exercise.unit || "reps";
      const target = exercise.targetValue ?? exercise.reps ?? "";
      const type = exercise.activityType || "strength";
      return type === "strength"
        ? `${Number(exercise.sets) || 1} × ${target} ${units}${exercise.load ? ` · ${exercise.load} ${exercise.loadUnit || "kg"}` : ""}`
        : `${target} ${units}${exercise.intensity ? ` · ${exercise.intensity}` : ""}`;
    };
    const exerciseMarkup = exercises.length ? exercises.map((exercise, index) => renderExercise(exercise, index, exercises.length, prescription(exercise))).join("") : `<div class="empty-exercises">No exercises yet. Add the first prescription when you are ready.</div>`;
    const content = `
      ${crumbs(`${record.program.name || "Program"} / Workout`)}
      <div class="inspector-top"><button class="back-button" type="button" data-action="back-to-program">← Back to program</button><span class="muted-small">Week ${Number(week.weekNumber) || state.activeWeek + 1} · ${escapeHtml(week.phase || "")}</span></div>
      <div class="editor-summary">
         <div class="editor-title-area"><p class="eyebrow">Workout details</p><h1 class="editor-title">${escapeHtml(workout.name || "Untitled workout")}</h1><p class="editor-description">Set where this workout is available. Availability changes do not record or complete a client session.</p></div>
        <div class="editor-actions"><span class="meta-chip">${escapeHtml(workout.sessionType || "Workout")}</span><span class="meta-chip">${exercises.length} exercises</span><button class="button button-small button-danger" type="button" data-action="remove-workout">Remove workout</button></div>
      </div>
      <div class="workout-editor-grid">
        <section class="section-card">
          <form data-form="workout" id="workout-form">
            <div class="form-section"><div class="form-grid">
              <div class="field"><label for="workout-name">Workout name</label><input id="workout-name" name="name" required value="${escAttr(workout.name || "")}"></div>
              <div class="field"><label for="workout-type">Session type</label><select id="workout-type" name="sessionType">${optionList(["Strength", "Cardio", "Mixed", "Mobility / recovery", "Guided session", "Other"], workout.sessionType || "Strength")}</select></div>
              <div class="field"><label for="workout-availability">Available as</label><select id="workout-availability" name="availability">${availabilityOptions(workout.availability)}</select></div>
              <div class="field full"><label for="workout-description">Description</label><textarea id="workout-description" name="description">${escapeHtml(workout.description || "")}</textarea></div>
              <div class="field"><label for="workout-warmup">Warm-up</label><textarea id="workout-warmup" name="warmup">${escapeHtml(workout.warmup || "")}</textarea></div>
              <div class="field"><label for="workout-cooldown">Cool-down</label><textarea id="workout-cooldown" name="cooldown">${escapeHtml(workout.cooldown || "")}</textarea></div>
            </div></div>
            <div class="form-footer"><span class="unsaved-indicator" hidden>Unsaved changes</span><button class="button button-primary button-small" type="submit">Save workout</button></div>
          </form>
          <div class="section-card-header"><div><h2>Exercises</h2><p>Prescription details and coach notes.</p></div><button class="button button-small" type="button" data-action="add-exercise">＋ Add exercise</button></div>
          <div class="exercise-header"><span></span><span>Exercise</span><span>Prescription</span><span>Effort / rest</span><span></span></div>
          <div class="exercise-list">${exerciseMarkup}</div>
        </section>
        <aside class="editor-sidebar">
          <section class="section-card side-card"><h3>Program cycle</h3><p><strong>${escapeHtml(week.name || `Week ${state.activeWeek + 1}`)}</strong></p><p>${escapeHtml(week.progressionNotes || "No coach progression notes.")}</p></section>
          <section class="section-card side-card"><h3>Coach context</h3><p>${escapeHtml(workout.description || "Add a short note about the focus of this workout.")}</p><p class="muted-small">Moving the overall program period never changes this prescription.</p></section>
        </aside>
      </div>`;
    app.innerHTML = pageShell(content);
  }

  function optionList(values, current) {
    const all = values.includes(current) ? values : [...values, current].filter(Boolean);
    return all.map(value => `<option value="${escAttr(value)}" ${value === current ? "selected" : ""}>${escapeHtml(value)}</option>`).join("");
  }

  function availabilityOptions(current) {
    const value = planningState.normalizeAvailability(current);
    return [["program", "Program"], ["independent", "Independent"], ["both", "Both"]]
      .map(([key, label]) => `<option value="${key}" ${value === key ? "selected" : ""}>${label}</option>`)
      .join("");
  }

  function renderExercise(exercise, index, total, summary) {
    const expanded = state.expandedExercise === index;
    const format = exercise.format || (exercise.activityType === "guided" ? "guided" : exercise.activityType === "cardio" ? "continuous" : "sets");
    const targetValue = format === "intervals" ? (exercise.rounds ?? exercise.targetValue ?? exercise.reps ?? "") : (exercise.targetValue ?? exercise.reps ?? "");
    const targetUnit = format === "intervals" ? "rounds" : (exercise.targetUnit || exercise.unit || "reps");
    const hasAdvancedDetails = format === "intervals"
      || exercise.durationMinutes != null
      || exercise.workDurationSeconds != null
      || exercise.workSeconds != null
      || exercise.recoveryDurationSeconds != null
      || exercise.recoverySeconds != null
      || exercise.heartRateTarget
      || exercise.tempo
      || exercise.description
      || exercise.goal
      || exercise.resourceUrl;
    const effort = exercise.rir != null && exercise.rir !== "" ? `${escapeHtml(exercise.rir)} RIR` : (exercise.intensity ? escapeHtml(exercise.intensity) : "—");
    const rest = Number(exercise.restSeconds) > 0 ? `${Math.floor(Number(exercise.restSeconds) / 60)}m${Number(exercise.restSeconds) % 60 ? ` ${Number(exercise.restSeconds) % 60}s` : ""} rest` : "No rest";
    return `<article class="exercise-item">
      <div class="exercise-row">
        <span class="exercise-order">${index + 1}</span>
        <span class="exercise-main"><strong>${escapeHtml(exercise.name || "Untitled exercise")}</strong><small>${escapeHtml(exercise.activityType || "strength")} · ${escapeHtml(exercise.format || "")}</small></span>
        <span class="exercise-prescription">${escapeHtml(summary)}</span>
        <span class="exercise-prescription">${effort} · ${rest}</span>
        <span class="exercise-actions">
          <button class="compact-action" type="button" data-action="move-exercise" data-index="${index}" data-direction="-1" aria-label="Move exercise earlier" ${index === 0 ? "disabled" : ""}>↑</button>
          <button class="compact-action" type="button" data-action="move-exercise" data-index="${index}" data-direction="1" aria-label="Move exercise later" ${index === total - 1 ? "disabled" : ""}>↓</button>
          <button class="workout-open" type="button" data-action="toggle-exercise" data-index="${index}" aria-expanded="${expanded}">${expanded ? "Close" : "Edit"}</button>
        </span>
      </div>
      <div class="exercise-edit-panel${expanded ? " is-open" : ""}">
        <form data-form="exercise" data-index="${index}">
          <div class="form-grid">
            <div class="field"><label for="exercise-name-${index}">Name</label><input id="exercise-name-${index}" name="name" required value="${escAttr(exercise.name || "")}"></div>
            <div class="field"><label for="exercise-type-${index}">Exercise type</label><select id="exercise-type-${index}" name="activityType">${optionList(["strength", "cardio", "guided"], exercise.activityType || "strength")}</select></div>
            <div class="field"><label for="exercise-sets-${index}">Sets</label><input id="exercise-sets-${index}" name="sets" type="number" min="1" step="1" value="${escAttr(exercise.sets ?? 1)}"></div>
            <div class="field"><label for="exercise-target-${index}">${format === "intervals" ? "Rounds" : "Target"}</label><div style="display:grid;grid-template-columns:1fr 1fr;gap:6px"><input id="exercise-target-${index}" name="targetValue" type="number" min="0" step="any" value="${escAttr(targetValue)}" aria-label="Target value"><select name="targetUnit" aria-label="Target unit">${optionList(["reps", "minutes", "seconds", "km", "metres", "rounds"], targetUnit)}</select></div></div>
            <div class="field"><label for="exercise-load-${index}">Load</label><div style="display:grid;grid-template-columns:1fr 70px;gap:6px"><input id="exercise-load-${index}" name="load" type="number" min="0" step="any" value="${escAttr(exercise.load ?? "")}" aria-label="Load value"><select name="loadUnit" aria-label="Load unit">${optionList(["kg", "lb"], exercise.loadUnit || "kg")}</select></div></div>
            <div class="field"><label for="exercise-effort-${index}">Effort / intensity</label><div style="display:grid;grid-template-columns:1fr 1fr;gap:6px"><input id="exercise-effort-${index}" name="rir" type="number" min="0" max="5" step="1" value="${escAttr(exercise.rir ?? "")}" placeholder="RIR"><input name="intensity" value="${escAttr(exercise.intensity || "")}" placeholder="Intensity" aria-label="Intensity"></div></div>
            <div class="field"><label for="exercise-rest-${index}">Rest (seconds)</label><input id="exercise-rest-${index}" name="restSeconds" type="number" min="0" step="1" value="${escAttr(exercise.restSeconds ?? 0)}"></div>
            <div class="field full"><label for="exercise-notes-${index}">Coach notes</label><textarea id="exercise-notes-${index}" name="notes">${escapeHtml(exercise.notes || exercise.goal || "")}</textarea></div>
          </div>
          <details class="advanced-prescription" ${hasAdvancedDetails ? "open" : ""}>
            <summary>Additional prescription details</summary>
            <div class="form-grid advanced-prescription-grid">
              <div class="field"><label for="exercise-format-${index}">Prescription format</label><select id="exercise-format-${index}" name="format">${optionList(["sets", "continuous", "intervals", "guided"], format)}</select></div>
              <div class="field"><label for="exercise-duration-${index}">Duration (minutes)</label><input id="exercise-duration-${index}" name="durationMinutes" type="number" min="0" step="any" value="${escAttr(exercise.durationMinutes ?? "")}"></div>
              <div class="field"><label for="exercise-work-${index}">Work interval (seconds)</label><input id="exercise-work-${index}" name="workDurationSeconds" type="number" min="0" step="1" value="${escAttr(exercise.workDurationSeconds ?? exercise.workSeconds ?? "")}"></div>
              <div class="field"><label for="exercise-recovery-${index}">Recovery interval (seconds)</label><input id="exercise-recovery-${index}" name="recoveryDurationSeconds" type="number" min="0" step="1" value="${escAttr(exercise.recoveryDurationSeconds ?? exercise.recoverySeconds ?? "")}"></div>
              <div class="field"><label for="exercise-heart-rate-${index}">Heart-rate target</label><input id="exercise-heart-rate-${index}" name="heartRateTarget" value="${escAttr(exercise.heartRateTarget || "")}"></div>
              <div class="field"><label for="exercise-tempo-${index}">Tempo</label><input id="exercise-tempo-${index}" name="tempo" value="${escAttr(exercise.tempo || "")}"></div>
              <div class="field full"><label for="exercise-description-${index}">Exercise instructions</label><textarea id="exercise-description-${index}" name="description">${escapeHtml(exercise.description || "")}</textarea></div>
              <div class="field full"><label for="exercise-goal-${index}">Exercise goal</label><textarea id="exercise-goal-${index}" name="goal">${escapeHtml(exercise.goal || "")}</textarea></div>
              <div class="field full"><label for="exercise-resource-${index}">Demonstration or resource URL</label><input id="exercise-resource-${index}" name="resourceUrl" value="${escAttr(exercise.resourceUrl || "")}" placeholder="https://…"></div>
            </div>
          </details>
          <div class="form-footer" style="padding:10px 0 0"><span class="unsaved-indicator" hidden>Unsaved changes</span><button class="button button-danger button-small" type="button" data-action="remove-exercise" data-index="${index}">Remove</button><button class="button button-primary button-small" type="submit">Save exercise</button></div>
        </form>
      </div>
    </article>`;
  }

  function renderPreview() {
    const publishedRecords = state.records.filter(record => record.row?.hasCurrentVersion);
    const records = state.activeId
      ? publishedRecords.filter(record => String(record.row.id) === String(state.activeId))
      : publishedRecords;
    const cards = records.map(record => renderClientProgram(record)).join("");
    app.innerHTML = pageShell(`
      ${crumbs("Client view")}
      <div class="client-preview-wrap">
         <div class="client-preview-top"><div><p class="eyebrow">Read-only client view</p><h1>What the client sees</h1><p class="heading-subtitle">Program workouts and optional independent sessions. No editor controls, attendance or session logging.</p></div><button class="back-button" type="button" data-action="back-from-preview">← Return to planning</button></div>
         <p class="client-label">Preview for Taylor · example client · mock sessions only</p>
        ${cards || `<section class="client-program-card"><div class="client-week"><p class="client-empty">No published programs are available in this preview.</p></div></section>`}
      </div>`);
  }

  function renderClientProgram(record) {
    const program = record.program;
    const weeks = Array.isArray(program.weeks) ? program.weeks : [];
    const weekMarkup = weeks.map(week => {
      const sessions = (week.days || []).flatMap(day => planningState.listSessions(day)
        .map(workout => ({ day, workout })));
      const scheduledWorkouts = sessions.filter(({ workout }) => planningState.isScheduled(workout));
      const independentWorkouts = sessions.filter(({ workout }) => planningState.isIndependent(workout));
      const instruction = week.progressionNotes || week.successMetric;
      const workoutCard = ({ day, workout }) => {
        const weekday = Number(day.weekday);
        const dayLabel = DAY_NAMES[(weekday + 6) % 7] || "Day";
        const availability = planningState.normalizeAvailability(workout.availability);
        const availabilityLabel = availability === "both" ? "Program + independent" : availability === "independent" ? "Independent" : "Program";
        return `<article class="client-workout">
          <div class="client-workout-meta"><span>${dayLabel}</span><span class="workout-availability availability-${availability}">${availabilityLabel}</span></div>
          <strong>${escapeHtml(workout.name || "Workout")}</strong><p>${escapeHtml(workout.description || workout.sessionType || "Workout")}</p>
          ${workout.warmup ? `<p><strong>Warm-up</strong> · ${escapeHtml(workout.warmup)}</p>` : ""}
          ${(workout.exercises || []).map(exercise => `<div class="client-exercise"><span>${escapeHtml(exercise.name || "Exercise")}${exercise.notes ? ` · ${escapeHtml(exercise.notes)}` : ""}</span><span>${escapeHtml(clientPrescription(exercise))}</span></div>`).join("") || `<span class="muted-small">No exercises prescribed.</span>`}
          ${workout.cooldown ? `<p style="margin:7px 0 0"><strong>Cool-down</strong> · ${escapeHtml(workout.cooldown)}</p>` : ""}
        </article>`;
      };
      return `<section class="client-week">
        <h3>${escapeHtml(week.name || `Week ${week.weekNumber || ""}`)}${week.phase ? ` · ${escapeHtml(week.phase)}` : ""}</h3>
        ${instruction ? `<div class="client-instructions"><p><strong>Coach instruction</strong><br>${escapeHtml(week.progressionNotes || "No progression note.")}</p><p><strong>Focus</strong><br>${escapeHtml(week.successMetric || "No success metric added.")}</p></div>` : ""}
        <h4 class="client-workout-section-title">Program schedule</h4>
        <div class="client-workouts">${scheduledWorkouts.map(workoutCard).join("") || `<div class="client-empty">No workouts scheduled in this week.</div>`}</div>
        ${independentWorkouts.length ? `<details class="client-independent-library">
          <summary><strong>Independent workouts</strong><span>${independentWorkouts.length} available</span></summary>
          <div class="client-workouts">${independentWorkouts.map(workoutCard).join("")}</div>
        </details>` : ""}
      </section>`;
    }).join("");
    return `<article class="client-program-card">
      <header class="client-program-head"><p class="eyebrow">${escapeHtml(recordStatus(record))}</p><h2>${escapeHtml(program.name || "Untitled program")}</h2><p>${escapeHtml(program.goal || program.description || "No purpose description provided.")}</p><div class="client-program-period"><span>Intended period · ${escapeHtml(dateRange(record.schedule.startDate, record.schedule.endDate))}</span><span>${Number(program.durationWeeks) || 1} intended weeks</span></div></header>
      ${weekMarkup || `<div class="client-week"><p class="client-empty">No workouts are prescribed in this program yet.</p></div>`}
    </article>`;
  }

  function clientPrescription(exercise) {
    const target = exercise.targetValue ?? exercise.reps ?? "";
    const unit = exercise.targetUnit || exercise.unit || "reps";
    const prefix = exercise.activityType === "strength" ? `${Number(exercise.sets) || 1} × ` : "";
    const load = exercise.load ? ` · ${exercise.load} ${exercise.loadUnit || "kg"}` : "";
    const effort = exercise.rir != null ? ` · ${exercise.rir} RIR` : "";
    return `${prefix}${target} ${unit}${load}${effort}`;
  }

  function render() {
    if (!fixtureRecords) {
      renderCalendar();
      return;
    }
    if (state.view === "calendar") renderCalendar();
    else if (state.view === "program") renderProgram();
    else if (state.view === "workout") renderWorkout();
    else if (state.view === "preview") renderPreview();
    document.querySelectorAll(".nav-item").forEach(item => {
      const isClient = item.dataset.action === "preview-nav";
      item.setAttribute("aria-current", (state.view === "preview") === isClient ? "page" : "false");
    });
  }

  function defaultStartDate() {
    const monthDate = new Date(state.focusDate.getFullYear(), state.focusDate.getMonth(), 1);
    const today = new Date();
    const focusIsCurrent = monthDate.getFullYear() === today.getFullYear() && monthDate.getMonth() === today.getMonth();
    const selected = focusIsCurrent ? today : monthDate;
    return iso(selected);
  }

  function addProgramDialog() {
    const start = defaultStartDate();
    const end = addDays(start, 13);
    const options = state.records.map(record => `<option value="${escAttr(record.row.id)}">${escapeHtml(record.program.name || record.row.name || "Untitled program")} · ${escapeHtml(recordStatus(record))}</option>`).join("");
    const body = `<form data-form="add-program" id="add-program-form">
      <div class="dialog-body">
        <div class="field"><label for="add-mode">Start with</label><select id="add-mode" name="mode"><option value="existing">An existing example program</option><option value="new">A new blank prototype</option></select></div>
        <div class="field" id="existing-program-field"><label for="existing-program-id">Program</label><select id="existing-program-id" name="existingId">${options}</select></div>
        <div id="new-program-fields" hidden>
          <div class="form-grid">
            <div class="field full"><label for="new-program-name">Program name</label><input id="new-program-name" name="name" value="New training block"></div>
            <div class="field full"><label for="new-program-description">Purpose</label><textarea id="new-program-description" name="description" placeholder="What is this block intended to develop?"></textarea></div>
          </div>
        </div>
        <div class="form-grid">
          <div class="field"><label for="schedule-start">Planned start</label><input id="schedule-start" name="startDate" type="date" required value="${dateInput(start)}"></div>
          <div class="field"><label for="schedule-end">Planned end</label><input id="schedule-end" name="endDate" type="date" required value="${dateInput(end)}"></div>
        </div>
        <div class="dialog-error" id="dialog-error" role="alert"></div>
      </div>
    </form>`;
    openDialog("Add to the planning board", "Choose a program or create a blank prototype, then set its local calendar period.", body, `<button class="button" type="button" data-action="close-dialog">Cancel</button><button class="button button-primary" type="submit" form="add-program-form">Add to calendar</button>`);
    if (!state.records.length) {
      const mode = dialog.querySelector("#add-mode");
      mode.value = "new";
      mode.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function editScheduleDialog(id) {
    const record = getRecord(id || state.activeId);
    if (!record) return;
    const body = `<form data-form="schedule" id="schedule-form" data-id="${escAttr(record.row.id)}"><div class="dialog-body">
      <div class="field"><label>Program</label><input value="${escAttr(record.program.name || record.row.name || "")}" readonly></div>
      <div class="form-grid">
        <div class="field"><label for="schedule-start">Planned start</label><input id="schedule-start" name="startDate" type="date" required value="${dateInput(record.schedule.startDate)}"></div>
        <div class="field"><label for="schedule-end">Planned end</label><input id="schedule-end" name="endDate" type="date" required value="${dateInput(record.schedule.endDate)}"></div>
      </div>
      <p class="field-hint">Only the local calendar dates change. Program weeks, workouts, exercises and prescriptions stay untouched. Period overlaps are allowed.</p>
      <div class="dialog-error" id="dialog-error" role="alert"></div>
    </div></form>`;
    openDialog("Move or resize period", "Change when this program is intended to run.", body, `<button class="button" type="button" data-action="close-dialog">Cancel</button><button class="button button-primary" type="submit" form="schedule-form">Save dates</button>`);
  }

  function editProgramDialog() {
    const record = getProgram();
    if (!record) return;
    const program = record.program;
    const body = `<form data-form="program" id="program-form"><div class="dialog-body">
      <div class="field"><label for="program-name">Program name</label><input id="program-name" name="name" required value="${escAttr(program.name || "")}"></div>
      <div class="field"><label for="program-description">Description / purpose</label><textarea id="program-description" name="description">${escapeHtml(program.description || "")}</textarea></div>
      <div class="field"><label for="program-goal">Client-facing goal</label><textarea id="program-goal" name="goal">${escapeHtml(program.goal || "")}</textarea><span class="field-hint">Use this for a concise purpose. It remains separate from the calendar period.</span></div>
      <div class="field"><label for="program-duration">Intended duration (weeks)</label><input id="program-duration" name="durationWeeks" type="number" min="1" max="52" step="1" value="${escAttr(program.durationWeeks || 1)}"><span class="field-hint">Editing intended length does not delete or create cycle weeks.</span></div>
    </div></form>`;
    openDialog("Edit program details", "These changes affect this in-memory program copy only.", body, `<button class="button" type="button" data-action="close-dialog">Cancel</button><button class="button button-primary" type="submit" form="program-form">Save details</button>`);
  }

  function editCycleDialog(index) {
    const record = getProgram();
    const week = record && getWeek(record, index);
    if (!week) return;
    const body = `<form data-form="cycle" id="cycle-form" data-week="${index}"><div class="dialog-body">
      <div class="field"><label for="cycle-name">Cycle week name</label><input id="cycle-name" name="name" value="${escAttr(week.name || "")}" required></div>
      <div class="field"><label for="cycle-phase">Phase</label><input id="cycle-phase" name="phase" value="${escAttr(week.phase || "")}" placeholder="Foundation, Build, Deload…"></div>
      <div class="field"><label for="cycle-progression">Progression notes</label><textarea id="cycle-progression" name="progressionNotes">${escapeHtml(week.progressionNotes || "")}</textarea></div>
      <div class="field"><label for="cycle-success">Success metric</label><textarea id="cycle-success" name="successMetric">${escapeHtml(week.successMetric || "")}</textarea></div>
    </div></form>`;
    openDialog(`Edit cycle week ${Number(week.weekNumber) || index + 1}`, "Preserve the existing week and day structure.", body, `<button class="button" type="button" data-action="close-dialog">Cancel</button><button class="button button-primary" type="submit" form="cycle-form">Save cycle week</button>`);
  }

  function showDialogError(message) {
    const error = dialog.querySelector("#dialog-error");
    if (error) {
      error.textContent = message;
      error.classList.add("is-visible");
    }
  }

  function makeNewRecord(name, description, startDate, endDate) {
    const id = `mock-local-${state.nextId++}`;
    const program = {
      name: name || "New training block",
      description: description || "",
      goal: "",
      version: 1,
      durationWeeks: 1,
      startDate,
      weeks: [emptyWeek(1)]
    };
    const row = {
      id,
      kind: "library",
      name: program.name,
      description: program.description,
      version: 1,
      versionStatus: "draft",
      hasCurrentVersion: false,
      durationWeeks: 1,
      startDate
    };
    return { row, program, schedule: { startDate, endDate }, localColor: state.records.length % COLORS.length };
  }

  function setDateError(formData) {
    const startDate = formData.get("startDate");
    const endDate = formData.get("endDate");
    if (!startDate || !endDate || Number.isNaN(fromISO(startDate).getTime()) || Number.isNaN(fromISO(endDate).getTime())) return "Choose both a valid start and end date.";
    if (endDate < startDate) return "The planned end date must be on or after the start date.";
    return "";
  }

  function handleSubmit(event) {
    const form = event.target.closest("form[data-form]");
    if (!form) return;
    event.preventDefault();
    const kind = form.dataset.form;
    if (kind === "confirm") {
      const action = state.afterConfirm;
      closeDialog();
      if (typeof action === "function") action();
      return;
    }
    const data = new FormData(form);
    if (kind === "add-program") {
      const invalid = setDateError(data);
      if (invalid) { showDialogError(invalid); return; }
      const startDate = data.get("startDate");
      const endDate = data.get("endDate");
      const mode = data.get("mode");
      if (mode === "new") {
        const record = makeNewRecord(String(data.get("name") || "").trim(), String(data.get("description") || "").trim(), startDate, endDate);
        state.records.push(record);
        state.activeId = record.row.id;
        state.view = "program";
        closeDialog();
        toast("Blank prototype program added to the planning board.");
      } else {
        const source = getRecord(data.get("existingId"));
        if (!source) { showDialogError("Select an existing program or create a new prototype."); return; }
        const copy = clone(source);
        const id = `mock-placement-${state.nextId++}`;
        copy.row = { ...copy.row, id, name: copy.program.name, description: copy.program.description };
        if (copy.meta) copy.meta = { ...copy.meta, id };
        copy.schedule = { startDate, endDate };
        copy.localColor = state.records.length % COLORS.length;
        state.records.push(copy);
        closeDialog();
        toast("A separate calendar entry was added. The original program was left unchanged.");
      }
      render();
      return;
    }
    if (kind === "schedule") {
      const invalid = setDateError(data);
      if (invalid) { showDialogError(invalid); return; }
      const record = getRecord(form.dataset.id);
      if (!record) { closeDialog(); return; }
      record.schedule = { startDate: data.get("startDate"), endDate: data.get("endDate") };
      closeDialog();
      toast("Planned period updated. Workout content was not changed.");
      render();
      return;
    }
    if (kind === "program") {
      const record = getProgram();
      if (!record) { closeDialog(); return; }
      const name = String(data.get("name") || "").trim();
      const durationWeeks = Number(data.get("durationWeeks"));
      if (!name || !Number.isFinite(durationWeeks) || durationWeeks < 1 || durationWeeks > 52) {
        showDialogError("Enter a program name and an intended duration between 1 and 52 weeks.");
        return;
      }
      record.program.name = name;
      record.program.description = String(data.get("description") || "").trim();
      record.program.goal = String(data.get("goal") || "").trim();
      record.program.durationWeeks = durationWeeks;
      record.row.name = name;
      record.row.description = record.program.description;
      record.row.durationWeeks = durationWeeks;
      closeDialog();
      toast("Program details saved in this preview.");
      render();
      return;
    }
    if (kind === "cycle") {
      const record = getProgram();
      const week = record && getWeek(record, Number(form.dataset.week));
      if (!week) { closeDialog(); return; }
      week.name = String(data.get("name") || "").trim() || `Week ${Number(week.weekNumber) || Number(form.dataset.week) + 1}`;
      week.phase = String(data.get("phase") || "").trim();
      week.progressionNotes = String(data.get("progressionNotes") || "").trim();
      week.successMetric = String(data.get("successMetric") || "").trim();
      closeDialog();
      toast("Cycle details saved.");
      render();
      return;
    }
    if (kind === "workout") {
      const workout = getActiveWorkout();
      if (!workout) return;
      workout.name = String(data.get("name") || "").trim();
      workout.sessionType = String(data.get("sessionType") || "Other");
      workout.availability = planningState.normalizeAvailability(String(data.get("availability") || "program"));
      workout.description = String(data.get("description") || "").trim();
      workout.warmup = String(data.get("warmup") || "").trim();
      workout.cooldown = String(data.get("cooldown") || "").trim();
      workout.enabled = true;
      state.dirty = false;
      render();
      toast("Workout prescription saved.");
      return;
    }
    if (kind === "exercise") {
      const workout = getActiveWorkout();
      const index = Number(form.dataset.index);
      const exercise = workout && workout.exercises[index];
      if (!exercise) return;
      exercise.name = String(data.get("name") || "").trim();
      exercise.activityType = String(data.get("activityType") || "strength");
      const selectedFormat = String(data.get("format") || "");
      exercise.format = exercise.activityType === "strength"
        ? "sets"
        : exercise.activityType === "guided"
          ? "guided"
          : selectedFormat === "intervals" ? "intervals" : "continuous";
      exercise.sets = exercise.activityType === "strength" ? Math.max(1, Number(data.get("sets")) || 1) : 1;
      exercise.targetValue = Math.max(0, Number(data.get("targetValue")) || 0);
      exercise.targetUnit = exercise.format === "intervals" ? "rounds" : String(data.get("targetUnit") || "reps");
      exercise.unit = exercise.targetUnit;
      const optionalNumber = field => {
        const value = data.get(field);
        return value == null || value === "" ? null : Math.max(0, Number(value) || 0);
      };
      exercise.durationMinutes = optionalNumber("durationMinutes");
      exercise.rounds = exercise.format === "intervals" ? Math.max(1, exercise.targetValue || 1) : null;
      exercise.workDurationSeconds = optionalNumber("workDurationSeconds");
      exercise.recoveryDurationSeconds = optionalNumber("recoveryDurationSeconds");
      exercise.heartRateTarget = String(data.get("heartRateTarget") || "").trim();
      exercise.tempo = String(data.get("tempo") || "").trim();
      exercise.description = String(data.get("description") || "").trim();
      exercise.goal = String(data.get("goal") || "").trim();
      exercise.resourceUrl = String(data.get("resourceUrl") || "").trim();
      exercise.reps = exercise.targetUnit === "reps" ? Math.max(1, exercise.targetValue || 1) : Math.max(1, Number(exercise.reps) || 1);
      exercise.load = data.get("load") === "" ? null : Math.max(0, Number(data.get("load")) || 0);
      exercise.loadUnit = String(data.get("loadUnit") || "kg");
      exercise.rir = data.get("rir") === "" ? null : Math.max(0, Math.min(5, Number(data.get("rir")) || 0));
      exercise.intensity = String(data.get("intensity") || "").trim();
      exercise.restSeconds = Math.max(0, Number(data.get("restSeconds")) || 0);
      exercise.notes = String(data.get("notes") || "").trim();
      if (exercise.activityType !== "strength") exercise.sets = 1;
      state.expandedExercise = null;
      state.dirty = false;
      render();
      toast("Exercise prescription saved.");
    }
  }

  function moveWorkout(weekIndex, weekday, direction, sessionIndex) {
    const record = getProgram();
    const week = record && getWeek(record, weekIndex);
    if (!week) return;
    const moved = planningState.moveSession(week, weekday, direction, sessionIndex);
    if (!moved) return;
    const targetName = DAY_NAMES[(moved.targetWeekday + 6) % 7] || "the next day";
    toast(`Workout moved to ${targetName}. Other workouts were kept in place.`);
    render();
  }

  function reorderExercises(index, direction) {
    const workout = getActiveWorkout();
    if (!workout) return;
    const target = index + direction;
    if (target < 0 || target >= workout.exercises.length) return;
    [workout.exercises[index], workout.exercises[target]] = [workout.exercises[target], workout.exercises[index]];
    state.expandedExercise = null;
    render();
    toast("Exercise order updated.");
  }

  function addWorkout(weekIndex, weekday) {
    const record = getProgram();
    const week = record && getWeek(record, weekIndex);
    if (!week) return;
    const targetWeekday = Number(weekday);
    if (!Number.isInteger(targetWeekday) || targetWeekday < 0 || targetWeekday > 6) return;
    const day = getDay(week, targetWeekday);
    const sessionIndex = planningState.addSession(day, {
      enabled: true,
      name: "New workout",
      description: "",
      sessionType: "Strength",
      availability: "program",
      warmup: "",
      cooldown: "",
      exercises: []
    });
    state.activeWeek = weekIndex;
    state.activeWeekday = targetWeekday;
    state.activeSessionIndex = sessionIndex;
    state.view = "workout";
    render();
    toast("New workout added to this day. Add its details and exercise prescriptions.");
  }

  function dispatch(action, element) {
    if (state.dirty && action !== "close-dialog") {
      confirm("Your workout or exercise has unsaved changes. Leave this editor and discard them?", () => {
        state.dirty = false;
        dispatch(action, element);
      }, false);
      return;
    }
    switch (action) {
      case "calendar-home":
        state.view = "calendar";
        state.activeId = null;
        render();
        break;
      case "preview-nav":
        if (state.view === "preview") {
          state.view = state.returnView || "calendar";
          state.activeId = state.previewReturnId;
        } else {
          state.returnView = state.view;
          state.previewReturnId = state.activeId;
          state.activeId = null;
          state.view = "preview";
        }
        render();
        break;
      case "back-from-preview":
        state.view = state.returnView || (state.activeId ? "program" : "calendar");
        state.activeId = state.previewReturnId;
        render();
        break;
      case "previous-range":
        state.focusDate = new Date(state.focusDate.getFullYear(), state.focusDate.getMonth() - state.range, 1);
        render();
        break;
      case "next-range":
        state.focusDate = new Date(state.focusDate.getFullYear(), state.focusDate.getMonth() + state.range, 1);
        render();
        break;
      case "today":
        state.focusDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        render();
        break;
      case "set-range":
        state.range = Math.max(1, Math.min(12, Number(element.dataset.range) || 3));
        render();
        break;
      case "add-program":
        addProgramDialog();
        break;
      case "open-program":
        state.activeId = element.dataset.id;
        state.view = "program";
        render();
        break;
      case "edit-schedule":
        editScheduleDialog(element.dataset.id);
        break;
      case "edit-program-details":
        editProgramDialog();
        break;
      case "preview-program":
        state.returnView = "program";
        state.previewReturnId = state.activeId;
        state.view = "preview";
        render();
        break;
      case "edit-cycle":
        editCycleDialog(Number(element.dataset.week));
        break;
      case "add-week": {
        const record = getProgram();
        if (!record) break;
        const weeks = ensureWeeks(record);
        const newWeek = emptyWeek(weeks.length + 1);
        newWeek.name = `Week ${weeks.length + 1} · Foundation`;
        if (weeks.length) {
          newWeek.phase = weeks[weeks.length - 1].phase || "Foundation";
          newWeek.successMetric = weeks[weeks.length - 1].successMetric || "";
        }
        weeks.push(newWeek);
        toast("Cycle week added.");
        render();
        break;
      }
      case "remove-week": {
        const index = Number(element.dataset.week);
        const record = getProgram();
        const week = record && getWeek(record, index);
        if (!record || !week || record.program.weeks.length <= 1) break;
        confirm(`“${week.name || `Week ${index + 1}`}” and its workouts will be removed from this local copy.`, () => {
          record.program.weeks.splice(index, 1);
          record.program.weeks.forEach((item, i) => { item.weekNumber = i + 1; });
          toast("Cycle week removed.");
          render();
        }, true);
        break;
      }
      case "add-workout":
        addWorkout(Number(element.dataset.week), Number(element.dataset.weekday));
        break;
      case "move-workout":
        moveWorkout(
          Number(element.dataset.week),
          Number(element.dataset.weekday),
          Number(element.dataset.direction),
          Number(element.dataset.sessionIndex)
        );
        break;
      case "open-workout":
        state.activeWeek = Number(element.dataset.week);
        state.activeWeekday = Number(element.dataset.weekday);
        state.activeSessionIndex = Number(element.dataset.sessionIndex) || 0;
        state.expandedExercise = null;
        state.view = "workout";
        render();
        break;
      case "back-to-program":
        state.view = "program";
        render();
        break;
      case "remove-workout": {
        const workout = getActiveWorkout();
        if (!workout) break;
        confirm(`Remove “${workout.name || "this workout"}” from this cycle week? Its prescribed exercises will be removed from the local copy.`, () => {
          const week = getWeek(getProgram(), state.activeWeek);
          const day = week && getDay(week, state.activeWeekday);
          planningState.removeSession(day, state.activeSessionIndex);
          state.activeSessionIndex = 0;
          state.view = "program";
          toast("Workout removed from this cycle week.");
          render();
        }, true);
        break;
      }
      case "add-exercise": {
        const workout = getActiveWorkout();
        if (!workout) break;
        if (!Array.isArray(workout.exercises)) workout.exercises = [];
        workout.exercises.push(emptyExercise());
        state.expandedExercise = workout.exercises.length - 1;
        render();
        toast("Exercise added to this workout.");
        break;
      }
      case "toggle-exercise": {
        const index = Number(element.dataset.index);
        state.expandedExercise = state.expandedExercise === index ? null : index;
        render();
        break;
      }
      case "move-exercise":
        reorderExercises(Number(element.dataset.index), Number(element.dataset.direction));
        break;
      case "remove-exercise": {
        const index = Number(element.dataset.index);
        const exercise = getActiveWorkout()?.exercises[index];
        if (!exercise) break;
        confirm(`Remove “${exercise.name || "this exercise"}” from the prescribed workout?`, () => {
          getActiveWorkout().exercises.splice(index, 1);
          state.expandedExercise = null;
          toast("Exercise removed from the local prescription.");
          render();
        }, true);
        break;
      }
      case "close-dialog":
        closeDialog();
        break;
      default:
        break;
    }
  }

  document.querySelector(".topbar")?.addEventListener("click", event => {
    const target = event.target.closest("[data-action]");
    if (!target || target.disabled) return;
    dispatch(target.dataset.action, target);
  });
  app.addEventListener("click", event => {
    const target = event.target.closest("[data-action]");
    if (!target || target.disabled) return;
    dispatch(target.dataset.action, target);
  });
  app.addEventListener("input", event => {
    if (event.target.closest('form[data-form="workout"], form[data-form="exercise"]')) {
      state.dirty = true;
      const indicator = event.target.closest("form").querySelector(".unsaved-indicator");
      if (indicator) indicator.hidden = false;
    }
  });
  app.addEventListener("change", event => {
    const exerciseForm = event.target.closest('form[data-form="exercise"]');
    if (exerciseForm && ["activityType", "format"].includes(event.target.name)) {
      const activityType = exerciseForm.querySelector('[name="activityType"]')?.value || "strength";
      const formatSelect = exerciseForm.querySelector('[name="format"]');
      const unitSelect = exerciseForm.querySelector('[name="targetUnit"]');
      if (event.target.name === "activityType" && formatSelect) {
        formatSelect.value = activityType === "strength" ? "sets" : activityType === "guided" ? "guided" : "continuous";
      }
      if (unitSelect) {
        if (formatSelect?.value === "intervals") unitSelect.value = "rounds";
        else if (event.target.name === "activityType") unitSelect.value = activityType === "guided" ? "minutes" : activityType === "cardio" ? "km" : "reps";
        else if (unitSelect.value === "rounds") unitSelect.value = activityType === "guided" ? "minutes" : activityType === "cardio" ? "km" : "reps";
      }
      const targetLabel = exerciseForm.querySelector(`label[for="exercise-target-${exerciseForm.dataset.index}"]`);
      if (targetLabel) targetLabel.textContent = formatSelect?.value === "intervals" ? "Rounds" : "Target";
    }
    if (event.target.closest('form[data-form="workout"], form[data-form="exercise"]')) {
      state.dirty = true;
      const indicator = event.target.closest("form").querySelector(".unsaved-indicator");
      if (indicator) indicator.hidden = false;
    }
  });
  app.addEventListener("submit", handleSubmit);
  dialog.addEventListener("submit", handleSubmit);
  dialog.addEventListener("click", event => {
    const target = event.target.closest("[data-action]");
    if (!target || target.disabled) return;
    dispatch(target.dataset.action, target);
  });
  dialog.addEventListener("change", event => {
    if (event.target.id === "add-mode") {
      const isNew = event.target.value === "new";
      const newFields = dialog.querySelector("#new-program-fields");
      const existingField = dialog.querySelector("#existing-program-field");
      if (newFields) newFields.hidden = !isNew;
      if (existingField) existingField.hidden = isNew;
    }
  });
  dialogBackdrop.addEventListener("click", event => {
    if (event.target === dialogBackdrop) closeDialog();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !dialogBackdrop.hidden) closeDialog();
  });

  render();
})();
