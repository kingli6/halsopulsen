/* ================================================================
  HÄLSO PULSEN — script.js

  What this file does:
  1. Language toggle (SV ↔ EN)
  2. Mobile navigation menu
  3. Contact form submission (Formspree)
  4. Auto-fill current year in footer
================================================================ */


/* ================================================================
  1. LANGUAGE TOGGLE
  — Reads data-sv / data-en attributes on elements
  — Persists choice in localStorage so it survives page refresh
================================================================ */

const langToggleBtn = document.getElementById('langToggle');
let currentLang = localStorage.getItem('lang') || 'sv';

function applyLanguage(lang) {
  currentLang = lang;
  localStorage.setItem('lang', lang);

  /* Update all elements that have data-sv / data-en */
  document.querySelectorAll('[data-sv][data-en]').forEach(el => {
    el.textContent = lang === 'sv' ? el.dataset.sv : el.dataset.en;
  });

  /* Update input / textarea placeholders */
  document.querySelectorAll('[data-placeholder-sv][data-placeholder-en]').forEach(el => {
    el.placeholder = lang === 'sv' ? el.dataset.placeholderSv : el.dataset.placeholderEn;
  });

  /* Update select option texts */
  document.querySelectorAll('select option[data-sv][data-en]').forEach(opt => {
    opt.textContent = lang === 'sv' ? opt.dataset.sv : opt.dataset.en;
  });

  /* Update the toggle button label to show the OTHER language */
  langToggleBtn.textContent = lang === 'sv' ? 'EN' : 'SV';

  /* Update the html lang attribute for accessibility / SEO */
  document.documentElement.lang = lang;
}

langToggleBtn.addEventListener('click', () => {
  applyLanguage(currentLang === 'sv' ? 'en' : 'sv');
});

/* Apply stored language on first load */
applyLanguage(currentLang);


/* ================================================================
  2. MOBILE NAVIGATION MENU
  — Toggles the .open class on the nav links list
================================================================ */

const hamburger  = document.getElementById('hamburger');
const navLinks   = document.getElementById('navLinks');

hamburger.addEventListener('click', () => {
  const isOpen = navLinks.classList.toggle('open');
  hamburger.setAttribute('aria-expanded', isOpen);
});

/* Close menu when a link is tapped (smooth scroll takes over) */
navLinks.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    navLinks.classList.remove('open');
    hamburger.setAttribute('aria-expanded', 'false');
  });
});


/* ================================================================
  3. CONTACT FORM — FORMSPREE SUBMISSION
  — Submits via fetch so the user stays on the page
  — Remember to replace YOUR_FORMSPREE_ID in index.html
================================================================ */

const contactForm  = document.getElementById('contactForm');
const formSuccess  = document.getElementById('formSuccess');
const formError    = document.getElementById('formError');

contactForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const submitBtn = contactForm.querySelector('[type="submit"]');
  submitBtn.disabled = true;

  /* Hide previous messages */
  formSuccess.hidden = true;
  formError.hidden   = true;

  try {
    const response = await fetch(contactForm.action, {
      method:  'POST',
      body:    new FormData(contactForm),
      headers: { 'Accept': 'application/json' }
    });

    if (response.ok) {
      /* Show localised success message */
      formSuccess.textContent = currentLang === 'sv'
        ? formSuccess.dataset.sv
        : formSuccess.dataset.en;
      formSuccess.hidden = false;
      contactForm.reset();
    } else {
      throw new Error('Server error');
    }
  } catch {
    formError.textContent = currentLang === 'sv'
      ? formError.dataset.sv
      : formError.dataset.en;
    formError.hidden = false;
  } finally {
    submitBtn.disabled = false;
  }
});


/* ================================================================
  4. FOOTER YEAR
  — Keeps the copyright year current automatically
================================================================ */

document.getElementById('year').textContent = new Date().getFullYear();
