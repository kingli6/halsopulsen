/* ================================================================
  HÄLSO PULSEN — script.js

  What this file does:
  1. Language toggle (SV ↔ EN) with localStorage persistence
  2. Mobile navigation menu
  3. Contact form submission (Formspree via fetch, no page reload)
  4. Auto-fill current year in footer

  All code is wrapped in DOMContentLoaded so the browser has
  finished building the page before we try to find any elements.
================================================================ */

document.addEventListener('DOMContentLoaded', () => {

  /* ================================================================
    1. LANGUAGE TOGGLE
    — Reads data-sv / data-en attributes on elements
    — Persists choice in localStorage so it survives page refresh
    — Skips formSuccess / formError elements (they start hidden and
      have their own text set at submission time)
  ================================================================ */
  const langToggleBtn = document.getElementById('langToggle');
  let currentLang = localStorage.getItem('lang') || 'sv';

  function applyLanguage(lang) {
    currentLang = lang;
    localStorage.setItem('lang', lang);

    document.querySelectorAll('[data-sv][data-en]').forEach(el => {
      if (el.id !== 'formSuccess' && el.id !== 'formError') {
        el.textContent = lang === 'sv' ? el.dataset.sv : el.dataset.en;
      }
    });

    document.querySelectorAll('[data-placeholder-sv][data-placeholder-en]').forEach(el => {
      el.placeholder = lang === 'sv'
        ? el.getAttribute('data-placeholder-sv')
        : el.getAttribute('data-placeholder-en');
    });

    document.querySelectorAll('select option[data-sv][data-en]').forEach(opt => {
      opt.textContent = lang === 'sv' ? opt.dataset.sv : opt.dataset.en;
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
    2. MOBILE NAVIGATION MENU
    — Toggles the .open class on the nav links list
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
    3. CONTACT FORM — FORMSPREE SUBMISSION
    — Submits via fetch so the user stays on the page
    — Remember to replace YOUR_FORMSPREE_ID in index.html
  ================================================================ */
  const contactForm = document.getElementById('contactForm');
  const formSuccess = document.getElementById('formSuccess');
  const formError   = document.getElementById('formError');

  if (contactForm) {
    contactForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const submitBtn = contactForm.querySelector('[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;

      if (formSuccess) formSuccess.hidden = true;
      if (formError)   formError.hidden   = true;

      try {
        const response = await fetch(contactForm.action, {
          method:  'POST',
          body:    new FormData(contactForm),
          headers: { 'Accept': 'application/json' }
        });

        if (response.ok) {
          if (formSuccess) {
            formSuccess.textContent = currentLang === 'sv'
              ? formSuccess.dataset.sv
              : formSuccess.dataset.en;
            formSuccess.hidden = false;
          }
          contactForm.reset();
        } else {
          throw new Error('Server error');
        }
      } catch {
        if (formError) {
          formError.textContent = currentLang === 'sv'
            ? formError.dataset.sv
            : formError.dataset.en;
          formError.hidden = false;
        }
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }


  /* ================================================================
    4. FOOTER YEAR
    — Keeps the copyright year current automatically
  ================================================================ */
  const yearSpan = document.getElementById('year');
  if (yearSpan) {
    yearSpan.textContent = new Date().getFullYear();
  }

});
