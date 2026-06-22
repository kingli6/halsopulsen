/* ================================================================
  HÄLSO PULSEN — script.js

  1. Language toggle (SV ↔ EN) with localStorage persistence
  2. Mobile navigation menu
  3. Auto-fill current year in footer
================================================================ */

document.addEventListener('DOMContentLoaded', () => {

  /* ================================================================
    1. LANGUAGE TOGGLE
  ================================================================ */
  const langToggleBtn = document.getElementById('langToggle');
  let currentLang = localStorage.getItem('lang') || 'sv';

  function applyLanguage(lang) {
    currentLang = lang;
    localStorage.setItem('lang', lang);

    document.querySelectorAll('[data-sv][data-en]').forEach(el => {
      el.textContent = lang === 'sv' ? el.dataset.sv : el.dataset.en;
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
    3. FOOTER YEAR
  ================================================================ */
  const yearSpan = document.getElementById('year');
  if (yearSpan) {
    yearSpan.textContent = new Date().getFullYear();
  }

});
