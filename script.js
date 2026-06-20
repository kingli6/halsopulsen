/* ================================================================
  HÄLSO PULSEN — script.js

  1. Language toggle (SV ↔ EN) with localStorage persistence
  2. Mobile navigation menu
  3. Contact form submission (Formspree via fetch, no page reload)
  4. Auto-fill current year in footer
  5. Pricing CTA → pre-select service dropdown
  6. Dynamic contact price panel (updates when service is selected)
================================================================ */

document.addEventListener('DOMContentLoaded', () => {

  /* ================================================================
    6. DYNAMIC CONTACT PRICE PANEL
    — Defined first so applyLanguage() can call it below.
    — renderPricePanel(serviceKey, lang) rebuilds the list and note
      in the contact sidebar whenever the selected service changes.
  ================================================================ */
  const SERVICE_PRICES = {
    '': {
      title: { sv: 'Snabbreferens',        en: 'Quick reference' },
      rows: [
        { sv: 'Massage (60 min)',           en: 'Massage (60 min)',          price: '550 kr' },
        { sv: 'Kostcoach',                  en: 'Nutrition Coach',           price: { sv: 'Gratis nu', en: 'Free now' } },
        { sv: 'PT — Fokussession',          en: 'PT — Focus session',        price: '150 kr' },
        { sv: 'Samtal online (60 min)',      en: 'Coaching online (60 min)',  price: '99 kr' },
      ],
      link: { sv: 'Alla priser ↑', en: 'All prices ↑' },
    },
    massage: {
      title: { sv: 'Massagepriser',         en: 'Massage prices' },
      rows: [
        { sv: 'Express (15 min)',            en: 'Express (15 min)',          price: '250 kr' },
        { sv: '30 min',                      en: '30 min',                    price: '450 kr' },
        { sv: '60 min',                      en: '60 min',                    price: '550 kr' },
        { sv: '90 min',                      en: '90 min',                    price: '650 kr' },
      ],
      link: { sv: 'Alla priser ↑', en: 'All prices ↑' },
    },
    diet: {
      title: { sv: 'Kostcoach-priser',      en: 'Nutrition Coach prices' },
      rows: [
        { sv: 'Kostanalys',                  en: 'Nutrition analysis',        price: { sv: 'Gratis nu', en: 'Free now' } },
        { sv: 'Konsultation + analys',       en: 'Consultation + analysis',   price: { sv: 'Gratis nu', en: 'Free now' } },
        { sv: 'Detektivanalys (2 v.)',        en: 'Deep analysis (2 wks)',     price: { sv: 'Gratis nu', en: 'Free now' } },
        { sv: 'Personlig måltidsplan',       en: 'Personal meal plan',        price: { sv: 'Gratis nu', en: 'Free now' } },
        { sv: 'Uppföljning (30 min)',        en: 'Follow-up (30 min)',        price: '150 kr' },
      ],
      note: { sv: 'Gratis för de 6 första kunderna', en: 'Free for the first 6 clients' },
      link: { sv: 'Alla priser ↑', en: 'All prices ↑' },
    },
    pt: {
      title: { sv: 'PT-priser',             en: 'PT prices' },
      rows: [
        { sv: 'Fokussession (60 min)',        en: 'Focus session (60 min)',    price: '150 kr' },
        { sv: 'Bedömning + Månadsplan',      en: 'Assessment + Monthly plan', price: '200 kr' },
        { sv: 'Startpaket',                  en: 'Starter pack',              price: '450 kr' },
        { sv: '5 sessioner',                 en: '5 sessions',                price: '650 kr' },
        { sv: '10 sessioner',                en: '10 sessions',               price: '1 200 kr' },
      ],
      note: { sv: 'Rabatterat för de 6 första kunderna', en: 'Discounted for the first 6 clients' },
      link: { sv: 'Alla priser ↑', en: 'All prices ↑' },
    },
    mi: {
      title: { sv: 'Samtal & Coaching',     en: 'Talk & Coaching' },
      rows: [
        { sv: 'Online (60 min)',             en: 'Online (60 min)',            price: '99 kr' },
        { sv: 'Walk & talk (60 min)',        en: 'Walk & talk (60 min)',       price: '125 kr' },
        { sv: 'På plats (60 min)',           en: 'In person (60 min)',         price: '149 kr' },
        { sv: 'Uppföljning (45 min)',        en: 'Follow-up (45 min)',         price: '175 kr' },
      ],
      note: { sv: 'Inte terapi eller psykologisk behandling', en: 'Not therapy or psychological treatment' },
      link: { sv: 'Alla priser ↑', en: 'All prices ↑' },
    },
  };

  function renderPricePanel(serviceKey, lang) {
    const labelEl = document.getElementById('contactPricesLabel');
    const listEl  = document.getElementById('contactPricesList');
    const noteEl  = document.getElementById('contactPricesNote');
    const linkEl  = document.getElementById('contactPricesLink');
    if (!labelEl || !listEl) return;

    const L    = lang || 'sv';
    const data = SERVICE_PRICES[serviceKey] || SERVICE_PRICES[''];

    labelEl.textContent = data.title[L];

    listEl.innerHTML = data.rows.map(row => {
      const name  = row[L] || (L === 'sv' ? row.sv : row.en);
      const price = typeof row.price === 'string' ? row.price : row.price[L];
      return `<li><span>${name}</span><span>${price}</span></li>`;
    }).join('');

    if (noteEl) {
      if (data.note) {
        noteEl.textContent = typeof data.note === 'string' ? data.note : data.note[L];
        noteEl.hidden = false;
      } else {
        noteEl.hidden = true;
      }
    }

    if (linkEl) {
      linkEl.textContent = data.link ? data.link[L] : (L === 'sv' ? 'Alla priser ↑' : 'All prices ↑');
      linkEl.href        = '#pricing';
    }
  }


  /* ================================================================
    1. LANGUAGE TOGGLE
    — Reads data-sv / data-en attributes on elements
    — Persists choice in localStorage so it survives page refresh
    — Re-renders the price panel so it stays in sync
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

    const svcSelect = document.getElementById('service');
    renderPricePanel(svcSelect ? svcSelect.value : '', lang);
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
          renderPricePanel('', currentLang);
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


  /* ================================================================
    5. PRICING CTA → PRE-SELECT SERVICE DROPDOWN + UPDATE PANEL
    — Any link with data-service="X" pre-selects the dropdown and
      immediately updates the price panel to match.
  ================================================================ */
  document.querySelectorAll('[data-service]').forEach(link => {
    link.addEventListener('click', () => {
      const select = document.getElementById('service');
      if (select && link.dataset.service) {
        select.value = link.dataset.service;
        renderPricePanel(link.dataset.service, currentLang);
      }
    });
  });

  /* Service dropdown → update price panel live */
  const serviceSelect = document.getElementById('service');
  if (serviceSelect) {
    serviceSelect.addEventListener('change', () => {
      renderPricePanel(serviceSelect.value, currentLang);
    });
  }


  /* ================================================================
    7. PRICING CARD SELECTION
    — Clicking anywhere on a card highlights it and pre-selects
      the matching service in the contact form dropdown.
  ================================================================ */
  document.querySelectorAll('.pricing-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.pricing-card').forEach(c => c.classList.remove('pricing-card--selected'));
      card.classList.add('pricing-card--selected');

      const cta = card.querySelector('[data-service]');
      if (cta && cta.dataset.service) {
        const select = document.getElementById('service');
        if (select) {
          select.value = cta.dataset.service;
          renderPricePanel(cta.dataset.service, currentLang);
        }
      }
    });
  });

});
