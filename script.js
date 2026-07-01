/* ================================================================
  HÄLSO PULSEN — script.js

  1. Progress data — UPDATE NUMBERS HERE when clients book
  2. Language toggle (SV ↔ EN) with localStorage persistence
  3. Mobile navigation menu
  4. Auto-fill current year in footer
================================================================ */


/* ================================================================
  0. TESTIMONIALS
  ← Add a quote here every time a client gives you feedback.
  The section appears automatically once there is at least one entry.

  Fields:
    quote   — what they said (keep it short, 1–2 sentences)
    name    — first name or initials, e.g. "Anna S."
    service — one of: "massage" | "nutrition" | "pt"

  Example (remove the // to activate):
  { quote: "Världens bästa massage — helt otroligt!", name: "Anna S.", service: "massage" },
================================================================ */
const TESTIMONIALS = [
  // { quote: "...", name: "...", service: "massage" },
];

const SERVICE_LABEL = { massage: "Massage", nutrition: "Kostcoach", pt: "Personlig Träning" };
const SERVICE_ICON  = { massage: "💆", nutrition: "🥗", pt: "💪" };

function renderTestimonials() {
  const section = document.getElementById('testimonials');
  const grid    = document.getElementById('testimonialsGrid');
  if (!section || !grid) return;

  if (TESTIMONIALS.length === 0) { section.hidden = true; return; }

  section.hidden = false;
  grid.innerHTML = TESTIMONIALS.map(t => `
    <figure class="testimonial-card">
      <blockquote class="testimonial-quote">"${t.quote}"</blockquote>
      <figcaption class="testimonial-meta">
        <span class="testimonial-name">${t.name}</span>
        <span class="testimonial-service">${SERVICE_ICON[t.service] || ''} ${SERVICE_LABEL[t.service] || ''}</span>
      </figcaption>
    </figure>`).join('');
}


/* ================================================================
  1. PROGRESS DATA
  ← This is the only place you need to edit when numbers change.
  Update a number, save the file, and the page reflects it.
================================================================ */
const PROGRESS = {
  massage: {
    clients:       0,   // current number of journalled clients
    clientsTotal:  5,   // required total
    sessions:      0,   // journalled sessions so far
    sessionsTotal: 15,  // required total
    practice:      15,  // practice massages signed so far
    practiceTotal: 35,  // required total
  },
  nutrition: {
    clients:       0,
    clientsTotal:  3,
    meetings:      0,
    meetingsTotal: 12,
  },
  pt: {
    clients:       0,
    clientsTotal:  4,
    sessions:      0,
    sessionsTotal: 16,
  },
};

function pct(done, total) {
  return total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
}

function applyProgress() {
  const m = PROGRESS.massage;
  const n = PROGRESS.nutrition;
  const p = PROGRESS.pt;

  function set(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
  function setW(id, done, total) { const el = document.getElementById(id); if (el) el.style.width = pct(done, total) + '%'; }
  function setAria(id, label) { const el = document.getElementById(id); if (el) el.setAttribute('aria-label', label); }

  // Massage
  set('prog-massage-clients',       m.clients);
  set('prog-massage-clients-total', `/${m.clientsTotal}`);
  setW('prog-massage-bar',          m.clients, m.clientsTotal);
  setAria('prog-massage-bar-wrap',  `${m.clients} av ${m.clientsTotal} klienter`);
  set('prog-massage-sessions',      `${m.sessions}/${m.sessionsTotal}`);
  set('prog-massage-practice',      `${m.practice}/${m.practiceTotal}`);
  setW('prog-massage-practice-bar', m.practice, m.practiceTotal);
  setAria('prog-massage-practice-bar-wrap', `${m.practice} av ${m.practiceTotal} praktikmassager`);

  // Nutrition
  set('prog-nutrition-clients',       n.clients);
  set('prog-nutrition-clients-total', `/${n.clientsTotal}`);
  setW('prog-nutrition-bar',          n.clients, n.clientsTotal);
  setAria('prog-nutrition-bar-wrap',  `${n.clients} av ${n.clientsTotal} klienter`);
  set('prog-nutrition-meetings',      `${n.meetings}/${n.meetingsTotal}`);

  // PT
  set('prog-pt-clients',       p.clients);
  set('prog-pt-clients-total', `/${p.clientsTotal}`);
  setW('prog-pt-bar',          p.clients, p.clientsTotal);
  setAria('prog-pt-bar-wrap',  `${p.clients} av ${p.clientsTotal} klienter`);
  set('prog-pt-sessions',      `${p.sessions}/${p.sessionsTotal}`);
}


document.addEventListener('DOMContentLoaded', () => {

  /* Run progress and testimonials render */
  applyProgress();
  renderTestimonials();


  /* ================================================================
    2. LANGUAGE TOGGLE
  ================================================================ */
  const langToggleBtn = document.getElementById('langToggle');
  let currentLang = localStorage.getItem('lang') || 'sv';

  function applyLanguage(lang) {
    currentLang = lang;
    localStorage.setItem('lang', lang);

    document.querySelectorAll('[data-sv][data-en]').forEach(el => {
      el.textContent = lang === 'sv' ? el.dataset.sv : el.dataset.en;
    });

    // Translate input/textarea placeholders
    document.querySelectorAll('[data-sv-placeholder][data-en-placeholder]').forEach(el => {
      el.placeholder = lang === 'sv' ? el.dataset.svPlaceholder : el.dataset.enPlaceholder;
    });

    if (langToggleBtn) {
      langToggleBtn.textContent = lang === 'sv' ? 'EN' : 'SV';
    }

    document.documentElement.lang = lang;
  }

  if (langToggleBtn) {
    langToggleBtn.addEventListener('click', () => {
      applyLanguage(currentLang === 'sv' ? 'en' : 'sv');
    });
  }

  applyLanguage(currentLang);


  /* ================================================================
    3. MOBILE NAVIGATION MENU
  ================================================================ */
  const hamburger = document.getElementById('hamburger');
  const navLinks  = document.getElementById('navLinks');

  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
      const isOpen = navLinks.classList.toggle('open');
      hamburger.setAttribute('aria-expanded', isOpen);
    });

    navLinks.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        navLinks.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');
      });
    });
  }


  /* ================================================================
    4. FOOTER YEAR
  ================================================================ */
  const yearSpan = document.getElementById('year');
  if (yearSpan) {
    yearSpan.textContent = new Date().getFullYear();
  }

});
