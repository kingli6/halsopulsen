(function () {
  "use strict";

  const ROUTES = {
    hub: "/__dev/workoutplanner/?screen=coach-overview",
    "coach-overview": "/__dev/workoutplanner/?screen=coach-overview",
    planning: "/__dev/workoutplanner/?screen=coach-planning",
    "coach-planning": "/__dev/workoutplanner/?screen=coach-planning",
    library: "/__dev/workoutplanner/?screen=library",
    "client-overview": "/__dev/workoutplanner/?screen=client-overview",
    "client-planning": "/__dev/workoutplanner/?screen=client-planning",
    workouts: "/__dev/workoutplanner/?screen=workouts"
  };
  const TODAY = new Date();
  TODAY.setHours(0, 0, 0, 0);
  const DAY_MS = 86400000;
  const sharedMockData = window.WorkoutPlannerUnifiedMockData;
  if (!sharedMockData) throw new Error("Unified WorkoutPlanner mock data is unavailable.");
  const displayWorkout = workout => ({
    ...workout,
    availability: workout.availability === "both"
      ? "Both"
      : workout.availability === "independent" ? "Independent" : "Program",
    exercises: workout.exercises.length,
    prescription: workout.exercises.map(exercise => [exercise.name, exercise.displayPrescription])
  });
  const data = {
    workouts: sharedMockData.workouts.map(displayWorkout),
    program: sharedMockData.program,
    libraryWorkouts: [
      { id: "walk-run", name: "Walk-run intervals", type: "Cardio", availability: "Program", duration: 28, exercises: 1, description: "Short, relaxed jog intervals separated by unhurried walking. Repeat a week when needed.", updated: "Saved draft", prescription: [["Walk-run intervals", "6 rounds · 1 min jog / 3 min walk"]] },
      { id: "core", name: "Core control", type: "Strength", availability: "Both", duration: 20, exercises: 4, description: "A simple trunk session with no equipment and plenty of time to find a smooth rhythm.", updated: "Available to client", prescription: [["Bird dog", "2 sets · 8 each side"], ["Dead bug", "2 sets · 8 each side"], ["Side plank", "2 × 20 sec each side"], ["Glute bridge", "2 sets · 12 reps"]] }
    ],
    newWorkouts: [],
    libraryFilter: "All",
    librarySearch: ""
  };

  const icons = {
    coach: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 18.5h16M6.5 15V9.8m5 5.2V5.5m5 9.5v-3.8M4.5 19h15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    library: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5.5 4.5h9.8a2 2 0 0 1 2 2v13h-10a2 2 0 0 1-2-2v-13Z" stroke="currentColor" stroke-width="1.6"/><path d="M7.5 7.5h7m-7 3.5h7m-7 3.5h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M17.3 7.4h1.3a1.8 1.8 0 0 1 1.8 1.8v8.5a1.8 1.8 0 0 1-1.8 1.8h-1.3" stroke="currentColor" stroke-width="1.6"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4" y="5.5" width="16" height="15" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M8 3.5v4m8-4v4M4 10h16m-11 4h3m-3 3h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    client: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="8" r="3.2" stroke="currentColor" stroke-width="1.6"/><path d="M5.5 20c.5-3.3 2.8-5.2 6.5-5.2s6 1.9 6.5 5.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="m17 5.3 1.2 1.2 2.3-2.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };
  const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
  const iso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const fromISO = value => { const [year, month, day] = value.split("-").map(Number); return new Date(year, month - 1, day); };
  const addDays = (date, count) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);
  const mondayOf = date => addDays(date, -((date.getDay() + 6) % 7));
  const dateLabel = (date, options = {}) => date.toLocaleDateString("en-GB", options);
  const allWorkouts = () => [...data.workouts, ...data.libraryWorkouts, ...data.newWorkouts];
  const app = document.getElementById("app-main");
  const modalBackdrop = document.getElementById("modal-backdrop");
  const modal = document.getElementById("modal");

  function currentRoute() {
    const path = location.pathname.replace(/\/+$/, "") || "/";
    const requested = new URLSearchParams(location.search).get("screen");
    if (["coach-overview", "coach-planning", "library", "client-overview", "client-planning", "workouts"].includes(requested)) return requested;
    if (path.endsWith("/overview")) return "coach-overview";
    if (path.endsWith("/recipient")) return "client-overview";
    if (path.endsWith("/library")) return "library";
    if (path.endsWith("/client-schedule")) return "client-planning";
    if (path.endsWith("/planning")) return "coach-planning";
    if (path.endsWith("/client-planning")) return "client-overview";
    return "coach-overview";
  }
  function go(route) {
    if (route === "planning") route = "coach-planning";
    history.pushState({}, "", ROUTES[route] || ROUTES.hub);
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function routeLink(route, label, cls = "") {
    return `<a class="${cls}" href="${ROUTES[route]}" data-go="${route}">${label}</a>`;
  }
  function notice() {
    return `<div class="notice"><span class="notice-mark" aria-hidden="true">i</span><span><strong>Preview environment.</strong> This workspace uses sample coaching data. Your changes stay in this browser session.</span></div>`;
  }
  function hubPage() {
    return `${notice()}
      <section class="hub-hero">
        <div class="hub-copy"><p class="page-kicker">HälsoPulsen · WorkoutPlanner</p><h1>A plan that feels <em>good to follow.</em></h1>
          <p class="lede">A calm space for the coach to build a repeatable rhythm — and for the client to know what comes next.</p>
          ${routeLink("coach-overview", 'Open coach workspace <span aria-hidden="true">→</span>', "button button-primary")}
        </div>
        <div class="hero-art" aria-hidden="true"><div class="orbit"><span class="orbit-dot one"></span><span class="orbit-dot two"></span></div><div class="hero-core"><span>H</span><small>move well</small></div></div>
      </section>
      <div class="section-heading"><h2>Choose a point of view</h2><span class="section-note">Everything here is a local mock</span></div>
      <section class="hub-route-grid" aria-label="WorkoutPlanner preview sections">
        <a class="route-card surface" href="${ROUTES["coach-overview"]}" data-go="coach-overview"><span class="route-symbol">${icons.coach}</span><span class="route-copy"><h2>Coach overview</h2><p>Active programs, recent progress and quick paths into planning.</p></span><span class="route-arrow" aria-hidden="true">↗</span></a>
        <a class="route-card surface" href="${ROUTES.planning}" data-go="planning"><span class="route-symbol">${icons.calendar}</span><span class="route-copy"><h2>Coach planning</h2><p>Shape a repeatable program in the existing planning prototype.</p></span><span class="route-arrow" aria-hidden="true">↗</span></a>
        <a class="route-card surface" href="${ROUTES.library}" data-go="library"><span class="route-symbol">${icons.library}</span><span class="route-copy"><h2>Workout library</h2><p>Reusable mock sessions for strength, aerobic work and mobility.</p></span><span class="route-arrow" aria-hidden="true">↗</span></a>
        <a class="route-card surface" href="${ROUTES["client-overview"]}" data-go="client-overview"><span class="route-symbol">${icons.client}</span><span class="route-copy"><h2>Client view</h2><p>A clear next session, the current program and a week at a glance.</p></span><span class="route-arrow" aria-hidden="true">↗</span></a>
      </section>
      <footer class="hub-foot"><span><strong>HälsoPulsen</strong> · A practical training companion</span><span>Local preview · No account or sync required</span></footer>`;
  }
  function coachPage() {
    return `${notice()}
      <header class="coach-welcome"><div><p class="page-kicker">Coach workspace / Overview</p><h1>Good morning, Alex.</h1><p class="lede">A small, steady plan is taking shape. Here’s what’s moving today.</p></div><span class="date-chip"><strong>${dateLabel(TODAY, { weekday: "short", day: "numeric", month: "short" })}</strong> · Coaching desk</span></header>
      <div class="coach-overview-grid">
        <section>
          <div class="section-heading"><h2>Active programs</h2>${routeLink("planning", "Open planning")}</div>
          <article class="active-program surface">
            <div class="active-program-banner"><span class="program-status">Published · In progress</span><h2>Strength &amp; Mobility Foundations</h2><p>A steady foundation built around three comfortable sessions each week.</p><div class="program-facts"><span>2-week block</span><span>3 sessions / week</span><span>Client · Taylor</span></div></div>
            <div class="program-content"><div class="program-progress-row"><strong>Program rhythm</strong><span>Week 1 of 2 · 2 of 3 sessions logged</span></div><div class="progress-track" aria-label="Program progress 42 percent"><div class="progress-fill"></div></div>
              <div class="program-weeks"><div class="week-summary"><small>Week 01</small><strong>Foundation</strong></div><div class="week-summary"><small>Week 02</small><strong>Build gently</strong></div><div class="week-summary"><small>Upcoming</small><strong>Next Monday</strong></div></div>
              <div class="program-footer"><span class="section-note">Last updated today · Mock data</span>${routeLink("planning", "Continue planning")}</div>
            </div>
          </article>
          <div class="section-heading" style="margin-top:27px"><h2>Saved draft</h2><span class="section-note">1 program in progress</span></div>
          <article class="surface" style="padding:17px 19px;display:flex;align-items:center;justify-content:space-between;gap:14px">
            <div><span class="program-status" style="margin-bottom:5px;color:#8b673f">Draft · Not shared</span><h3 style="margin:0 0 4px">Return-to-Running</h3><p class="section-note" style="margin:0">A gradual three-week return with walk-run intervals.</p></div>
            ${routeLink("planning", "Review draft", "button button-small")}
          </article>
        </section>
        <aside class="side-stack">
          <section class="activity-card surface"><h2>Recent activity</h2><div class="activity-list">
            <div class="activity-item"><span class="activity-icon" aria-hidden="true">✓</span><span class="activity-info"><strong>Taylor completed Strength A</strong><span>Good energy; kept the final set smooth.</span></span><time class="activity-time">Yesterday</time></div>
            <div class="activity-item"><span class="activity-icon" aria-hidden="true">↗</span><span class="activity-info"><strong>Foundation program shared</strong><span>Version 3 · Starts next week</span></span><time class="activity-time">Mon</time></div>
            <div class="activity-item"><span class="activity-icon" aria-hidden="true">+</span><span class="activity-info"><strong>Walk-run draft saved</strong><span>Three weeks · Return to running</span></span><time class="activity-time">Fri</time></div>
          </div></section>
          <section class="quick-links surface"><h2>Useful paths</h2>
            <a href="${ROUTES.planning}" data-go="planning">Plan a program <span>↗</span></a>
            <a href="${ROUTES.library}" data-go="library">Browse workout library <span>↗</span></a>
            <a href="${ROUTES["client-overview"]}" data-go="client-overview">See Taylor’s client view <span>↗</span></a>
            <a href="${ROUTES.hub}" data-go="hub">Return to preview hub <span>↗</span></a>
          </section>
        </aside>
      </div>`;
  }
  function typeClass(type) { return type.toLowerCase() === "cardio" ? "cardio" : type.toLowerCase() === "mobility" ? "mobility" : ""; }
  function workoutCard(workout) {
    return `<article class="library-card surface" data-card-type="${escape(workout.type)}" data-card-name="${escape(workout.name.toLowerCase())}">
      <div class="card-topline"><span class="type-tag ${typeClass(workout.type)}">${escape(workout.type)}</span><span class="availability-tag">${escape(workout.availability || "Independent")}</span></div>
      <h3>${escape(workout.name)}</h3><p>${escape(workout.description)}</p>
      <div class="workout-stats"><span><b>◷</b>${Number(workout.duration)} min</span><span><b>≋</b>${Number(workout.exercises)} exercises</span></div>
      <div class="library-card-footer"><small>${escape(workout.updated || "Reusable workout definition")}</small><button class="button button-small" type="button" data-action="open-workout" data-id="${escape(workout.id)}">View session</button></div>
    </article>`;
  }
  function libraryPage() {
    const list = allWorkouts().filter(item => {
      const matchesSearch = `${item.name} ${item.type} ${item.description}`.toLowerCase().includes(data.librarySearch.toLowerCase());
      return matchesSearch && (data.libraryFilter === "All" || item.type === data.libraryFilter);
    });
    return `${notice()}<header class="page-head"><div class="page-head-copy"><p class="page-kicker">Coach workspace / Reusable definitions</p><h1>Workout library</h1><p class="lede">A considered collection of sessions you can reuse in a plan. The definitions here are local mock examples.</p></div><div class="page-head-actions"><button class="button button-primary" type="button" data-action="create-workout"><span aria-hidden="true">+</span> Create workout</button></div></header>
      <div class="library-tools"><label class="search-field"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.5" stroke="currentColor" stroke-width="1.8"/><path d="m16 16 4.1 4.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><span class="sr-only">Search workout library</span><input id="library-search" type="search" placeholder="Search workouts or training type" value="${escape(data.librarySearch)}"></label>
      <div class="filter-pills" role="group" aria-label="Filter by workout type">${["All", "Strength", "Cardio", "Mobility"].map(filter => `<button type="button" data-filter="${filter}" aria-pressed="${data.libraryFilter === filter}">${filter}</button>`).join("")}</div></div>
      <div class="library-meta"><span>${list.length} ${list.length === 1 ? "workout" : "workouts"} in your library</span><span>Updated just now · Preview only</span></div>
      <section class="workout-grid" aria-label="Reusable workouts">${list.length ? list.map(workoutCard).join("") : `<div class="empty-search surface"><strong>No sessions found</strong><p>Try another search or switch to a different training type.</p><button class="button button-small" type="button" data-action="clear-search">Clear filters</button></div>`}</section>
      <p class="footnote">Workout definitions are illustrative and are not medical advice. Changes made here are held in local page state only.</p>`;
  }
  function clientPage() {
    const next = nextWorkouts()[0];
    const nextDate = next ? next.date : addDays(TODAY, 1);
    const recent = data.program.recentSessions.map(entry => {
      const schedule = data.program.schedule.find(item => item.workoutId === entry.workoutId);
      const workout = getWorkout(entry.workoutId);
      return {
        day: addDays(mondayOf(TODAY), schedule.weekday - (entry.weeksAgo * 7)),
        name: workout.name,
        detail: `${workout.duration} min · ${entry.note}`,
        workoutId: workout.id,
        duration: workout.duration,
        exercises: workout.exercises
      };
    });
    return `${notice()}
      <section class="client-banner"><div class="client-banner-copy"><p class="page-kicker">Client space / Your program</p><h1>Build a rhythm that works for you.</h1><p>Your plan is here to guide you, not rush you. Check what’s next, then make it your own.</p><div class="program-facts"><span>${escape(data.program.name)}</span><span>Week 1 of ${data.program.durationWeeks}</span><span>${data.program.sessionsPerWeek} sessions each week</span></div></div><div class="client-banner-side" aria-hidden="true"><span class="mini-ring">01</span><small>steady effort<br>over time</small></div></section>
      <div class="client-overview-grid">
        <section class="next-session surface"><div class="next-session-head"><div class="section-heading"><h2>Coming up</h2><span class="next-day-label">${dateLabel(nextDate, { weekday: "long" })}</span></div></div>
           <div class="session-spotlight"><div class="session-date-block"><small>${dateLabel(nextDate, { month: "short" })}</small><strong>${dateLabel(nextDate, { day: "numeric" })}</strong></div><div class="session-summary"><h3>${next ? escape(next.name) : "A recovery day"}</h3><p>${next ? "A planned session from your current program." : "An open day to rest or move as you like."}</p><div class="workout-stats"><span><b>◷</b>${next ? next.duration : 0} min</span><span><b>≋</b>${next ? next.exercises : 0} exercises</span></div></div>${next ? `<button class="button button-primary button-small" type="button" data-action="open-workout" data-id="${next.id}" data-exercise-count="${next.exercises}">Open workout</button>` : ""}</div>
          <div class="session-actions"><span class="section-note">Your schedule is a guide, not a deadline.</span>${routeLink("client-planning", "See your week")}</div>
        </section>
        <section class="recent-sessions surface"><h2>Recent activity</h2>${recent.map(item => `<article class="recent-row" data-workout-id="${escape(item.workoutId)}" data-duration="${item.duration}" data-exercise-count="${item.exercises}"><span class="recent-date"><small>${dateLabel(item.day, { month: "short" })}</small><strong>${dateLabel(item.day, { day: "numeric" })}</strong></span><span class="recent-copy"><strong>${item.name}</strong><span>${item.detail}</span></span><span class="done-mark" aria-label="Completed">✓</span></article>`).join("")}</section>
      </div>
      <div class="client-link-panel">
        <a class="client-link-tile surface" href="${ROUTES["client-planning"]}" data-go="client-planning"><span><strong>Your week</strong><small>A date-based look at the next seven days</small></span><span aria-hidden="true">→</span></a>
        <a class="client-link-tile surface" href="${ROUTES.workouts}" data-go="workouts"><span><strong>Workouts</strong><small>Open a session or record what you did</small></span><span aria-hidden="true">→</span></a>
      </div><p class="footnote">This is a sample client workspace. Workout completion and schedule data are illustrative.</p>`;
  }
  function clientPlanningPage() {
    const source = "/__dev/workoutplanner/client-planning/?embed=1&unified=1&workspace=planning";
    return `${notice()}<header class="page-head"><div class="page-head-copy"><p class="page-kicker">Client space / Your schedule</p><h1>A week with room to move.</h1><p class="lede">Your plan, by date. Open any session for the details, and let the rest days stay restful.</p></div><div class="page-head-actions">${routeLink("workouts", "Go to Workouts", "button")}</div></header>
      <iframe class="planning-calendar-preview" src="${escape(source)}" title="Seven-day workout calendar" loading="eager"></iframe>
      <section class="calendar-bottom surface"><div><strong>Steady is a good pace.</strong><p>There’s no catch-up required on a rest day. Your next planned session will still be here.</p></div>${routeLink("client-overview", "Back to overview", "button button-small")}</section>
      <p class="footnote">The weekly schedule is read-only. Open any session for its details or to record what you did.</p>`;
  }
  function embeddedPage(title, source) {
    return `${notice()}<header class="page-head"><div class="page-head-copy"><p class="page-kicker">WorkoutPlanner / Local mock</p><h1>${escape(title)}</h1><p class="lede">This screen reuses the existing isolated preview. It does not load or save production data.</p></div></header><iframe class="embedded-preview" src="${escape(source)}" title="${escape(title)}" loading="eager"></iframe>`;
  }
  function clientWorkoutsSource() {
    return "/__dev/workoutplanner/client-planning/?embed=1&unified=1&workspace=workouts";
  }
  function getWorkout(id) { return allWorkouts().find(item => item.id === id); }
  function openWorkout(id) {
    const workout = getWorkout(id);
    if (!workout) return;
    modal.innerHTML = `<header class="modal-head"><div><p class="page-kicker">${escape(workout.type)} · Workout details</p><h2 id="modal-title">${escape(workout.name)}</h2><p>${escape(workout.description)}</p></div><button class="modal-close" type="button" data-action="close-modal" aria-label="Close workout details">×</button></header>
      <div class="modal-body"><div class="detail-meta"><span>${workout.duration} minutes</span><span>${workout.exercises} exercises</span><span>Comfortable effort</span></div><p class="modal-copy">Move through each exercise at a pace that feels repeatable. Adjust range or rest whenever you need to.</p><div class="exercise-list">${workout.prescription.map(([name, prescription]) => `<div class="exercise-line"><strong>${escape(name)}</strong><small>${escape(prescription)}</small></div>`).join("")}</div></div><footer class="modal-footer"><button class="button" type="button" data-action="close-modal">Close</button><button class="button button-primary" type="button" data-action="open-workouts">Open in Workouts</button></footer>`;
    modalBackdrop.hidden = false;
    modal.querySelector(".modal-close").focus();
  }
  function createWorkoutDialog() {
    modal.innerHTML = `<form id="create-workout-form"><header class="modal-head"><div><p class="page-kicker">Workout library / New definition</p><h2 id="modal-title">Create a workout</h2><p>Add a reusable session to this local preview.</p></div><button class="modal-close" type="button" data-action="close-modal" aria-label="Close create workout form">×</button></header>
      <div class="modal-body"><div class="field"><label for="new-name">Workout name</label><input id="new-name" name="name" required maxlength="70" placeholder="e.g. Lunch-break mobility"></div>
      <div class="field"><label for="new-type">Training type</label><select id="new-type" name="type"><option>Strength</option><option>Cardio</option><option>Mobility</option></select></div>
      <div class="field"><label for="new-duration">Estimated time · minutes</label><input id="new-duration" name="duration" type="number" min="1" max="240" value="25" required></div>
      <div class="field"><label for="new-description">Short description</label><textarea id="new-description" name="description" maxlength="180" placeholder="What should this session feel like?"></textarea></div>
      <div class="modal-error" id="form-error" role="alert"></div></div>
      <footer class="modal-footer"><button class="button" type="button" data-action="close-modal">Cancel</button><button class="button button-primary" type="submit">Save workout</button></footer></form>`;
    modalBackdrop.hidden = false;
    modal.querySelector("#new-name").focus();
  }
  function closeModal() { modalBackdrop.hidden = true; modal.innerHTML = ""; }
  let toastTimer;
  function toast(message) {
    const region = document.getElementById("toast-region");
    region.innerHTML = `<div class="toast" role="status">${escape(message)}</div>`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { region.innerHTML = ""; }, 3200);
  }
  function nextWorkouts() {
    const monday = mondayOf(TODAY);
    return [0, 7].flatMap(weekOffset => data.program.schedule.map(entry => ({
      ...getWorkout(entry.workoutId),
      date: addDays(monday, entry.weekday + weekOffset)
    }))).filter(item => item.date >= TODAY).sort((a, b) => a.date - b.date);
  }
  function render() {
    const route = currentRoute();
    const clientMode = route.startsWith("client") || route === "workouts";
    const items = clientMode
      ? [["client-overview", "Overview"], ["client-planning", "Planning"], ["workouts", "Workouts"]]
      : [["coach-overview", "Overview"], ["coach-planning", "Planning"], ["library", "Workout Library"]];
    document.getElementById("main-nav").innerHTML = items.map(([key, label]) =>
      `<a href="${ROUTES[key]}" data-go="${key}" ${route === key ? 'aria-current="page"' : ""}>${label}</a>`
    ).join("");
    document.querySelectorAll("[data-role]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.role === (clientMode ? "client" : "coach")));
    });
    if (route === "coach-overview") app.innerHTML = coachPage();
    else if (route === "coach-planning") app.innerHTML = embeddedPage("Planning", "/__dev/workoutplanner/planning/");
    else if (route === "library") app.innerHTML = libraryPage();
    else if (route === "client-overview") app.innerHTML = clientPage();
    else if (route === "client-planning") app.innerHTML = clientPlanningPage();
    else if (route === "workouts") app.innerHTML = embeddedPage("Workouts", clientWorkoutsSource());
    else app.innerHTML = hubPage();
    app.classList.remove("view-in");
    void app.offsetWidth;
    app.classList.add("view-in");
  }
  function handleClick(event) {
    const role = event.target.closest("[data-role]");
    if (role) {
      go(role.dataset.role === "client" ? "client-overview" : "coach-overview");
      return;
    }
    const nav = event.target.closest("[data-go]");
    if (nav) {
      event.preventDefault();
      go(nav.dataset.go);
      return;
    }
    const filter = event.target.closest("[data-filter]");
    if (filter) {
      data.libraryFilter = filter.dataset.filter;
      render();
      return;
    }
    const action = event.target.closest("[data-action]");
    if (!action) return;
    switch (action.dataset.action) {
      case "open-workout": openWorkout(action.dataset.id); break;
      case "close-modal": closeModal(); break;
      case "create-workout": createWorkoutDialog(); break;
      case "clear-search": data.librarySearch = ""; data.libraryFilter = "All"; render(); break;
      case "open-workouts": go("workouts"); break;
    }
  }
  function handleInput(event) {
    if (event.target.id !== "library-search") return;
    const cursor = event.target.selectionStart;
    data.librarySearch = event.target.value;
    render();
    const next = document.getElementById("library-search");
    next.focus();
    next.setSelectionRange(cursor, cursor);
  }
  function handleSubmit(event) {
    if (event.target.id !== "create-workout-form") return;
    event.preventDefault();
    const form = new FormData(event.target);
    const name = String(form.get("name") || "").trim();
    const duration = Number(form.get("duration"));
    if (!name || !Number.isFinite(duration) || duration < 1 || duration > 240) {
      const error = document.getElementById("form-error");
      error.textContent = "Add a workout name and an estimated time between 1 and 240 minutes.";
      error.classList.add("is-visible");
      return;
    }
    data.newWorkouts.unshift({
      id: `local-${Date.now()}`, name, type: String(form.get("type") || "Strength"),
      availability: "Independent", duration, exercises: 0, description: String(form.get("description") || "").trim() || "A new local workout definition, ready to refine.",
      updated: "Created just now", prescription: [["Session details", "Definition saved in this preview"]]
    });
    closeModal();
    render();
    toast("Workout saved to this local preview.");
  }
  document.addEventListener("click", handleClick);
  document.addEventListener("input", handleInput);
  document.addEventListener("submit", handleSubmit);
  modalBackdrop.addEventListener("click", event => { if (event.target === modalBackdrop) closeModal(); });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !modalBackdrop.hidden) closeModal();
    if (event.key === "Tab" && !modalBackdrop.hidden) {
      const focusables = [...modal.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]')];
      if (!focusables.length) return;
      if (event.shiftKey && document.activeElement === focusables[0]) { event.preventDefault(); focusables.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === focusables.at(-1)) { event.preventDefault(); focusables[0].focus(); }
    }
  });
  window.addEventListener("popstate", render);
  render();
})();
