/* ================================================================
  HÄLSO PULSEN — script.js

  What this file does:
  1. Language toggle (SV ↔ EN) with localStorage persistence
  2. Mobile navigation menu
  3. Contact form submission (Formspree via fetch, no page reload)
  4. Auto-fill current year in footer
  5. Pricing CTA → pre-select service dropdown
  6. Dynamic contact price panel (updates when service is selected)

  All code is wrapped in DOMContentLoaded so the browser has
  finished building the page before we try to find any elements.
================================================================ */

document.addEventListener('DOMContentLoaded', () => {

  /* ================================================================
    6. DYNAMIC CONTACT PRICE PANEL
    — Defined first so applyLanguage() can call it below.
    — Data object holds per-service price rows in SV + EN.
    — renderPricePanel(serviceKey, lang) rebuilds the list, note,
      and label in the contact sidebar on demand.
  ================================================================ */
  const SERVICE_PRICES = {
    '': {
      title: { sv: 'Snabbreferens',      en: 'Quick reference' },
      rows: [
        { sv: 'Massage (60 min)',    en: 'Massage (60 min)',         price: '550 kr' },
        { sv: 'Massage Workshop',   en: 'Massage Workshop',          price: { sv: '995 kr/par',    en: '995 kr/couple' } },
        { sv: 'Kostcoach',          en: 'Nutrition Coach',           price: { sv: 'Gratis nu',     en: 'Free now' } },
        { sv: 'Personlig Träning',  en: 'Personal Training',         price: '150 kr/session' },
        { sv: 'MI-samtal',          en: 'MI Conversation',           price: '250 kr' },
      ],
      bundle: { sv: 'Hälsostart-paketet', en: 'Hälsostart Package', price: '750 kr' },
      link:  { sv: 'Alla priser ↑',       en: 'All prices ↑' },
    },
    massage: {
      title: { sv: 'Massagepriser',       en: 'Massage prices' },
      rows: [
        { sv: '30 min',                   en: '30 min',              price: '250 kr' },
        { sv: '60 min',                   en: '60 min',              price: '550 kr' },
        { sv: '90 min',                   en: '90 min',              price: '650 kr' },
        { sv: 'Duo-massage (60 min)',      en: 'Duo massage (60 min)', price: { sv: '650 kr/pers', en: '650 kr/person' } },
      ],
      link: { sv: 'Alla priser ↑', en: 'All prices ↑' },
    },
    workshop: {
      title: { sv: 'Workshop-priser',     en: 'Workshop prices' },
      rows: [
        { sv: 'Per person',               en: 'Per person',          price: '~600 kr' },
        { sv: 'Par-pris',                 en: 'Couple price',        price: '995 kr' },
        { sv: 'Grupp 3–6 pers',           en: 'Group 3–6',          price: { sv: '450 kr/pers', en: '450 kr/person' } },
      ],
      note: { sv: '2–3 timmar · inkl. fika & material', en: '2–3 hours · incl. coffee & materials' },
      link: { sv: 'Läs mer om workshopen ↓', en: 'Read more ↓' },
      linkHref: '#workshop',
    },
    diet: {
      title: { sv: 'Kostcoach-priser',    en: 'Nutrition Coach prices' },
      rows: [
        { sv: 'Kostanalys (60 min)',       en: 'Nutrition analysis (60 min)', price: { sv: 'Gratis nu', en: 'Free now' } },
        { sv: 'Marknadspris',             en: 'Market price',               price: '550 kr' },
      ],
      note: { sv: 'Erbjudandet gäller de 6 första klienterna', en: 'Offer valid for the first 6 clients' },
      link: { sv: 'Alla priser ↑', en: 'All prices ↑' },
    },
    pt: {
      title: { sv: 'PT-priser',           en: 'PT prices' },
      rows: [
        { sv: 'Enskild session (60 min)',  en: 'Single session (60 min)', price: '150 kr' },
        { sv: 'Startpaket (plan + 2 sess)', en: 'Starter pack (plan + 2 sess)', price: '450 kr' },
        { sv: '4-sessionspaket (1x/v)',   en: '4-session pack (1x/wk)', price: '550 kr' },
        { sv: 'Månadspaket 2x/vecka (8 sess)', en: 'Monthly 2x/week (8 sess)', price: '1 350 kr' },
        { sv: 'Intensivpaket 3x/vecka (12 sess)', en: 'Intensive 3x/week (12 sess)', price: '1 950 kr' },
      ],
      note: { sv: 'Rabatterat för de 6 första klienterna', en: 'Discounted for the first 6 clients' },
      link: { sv: 'Alla priser ↑', en: 'All prices ↑' },
    },
    mi: {
      title: { sv: 'MI-samtal',           en: 'MI Conversation' },
      rows: [
        { sv: 'Inledande samtal (60 min)', en: 'Initial session (60 min)', price: '250 kr' },
        { sv: 'Uppföljning (45 min)',      en: 'Follow-up (45 min)',       price: '200 kr' },
      ],
      note: { sv: 'Online, walk & talk, eller på plats', en: 'Online, walk & talk, or in person' },
      link: { sv: 'Alla priser ↑', en: 'All prices ↑' },
    },
    'hälsostart': {
      title: { sv: 'Hälsostart-paketet',  en: 'Hälsostart Package' },
      rows: [
        { sv: '💬 MI-samtal (60 min)',     en: '💬 MI session (60 min)',    price: '250 kr' },
        { sv: '🥗 Kostanalys (60 min)',    en: '🥗 Nutrition analysis (60 min)', price: '550 kr' },
        { sv: '💪 PT-session (60 min)',    en: '💪 PT session (60 min)',   price: '150 kr' },
      ],
      bundle: { sv: 'Paketpris',          en: 'Package price',            price: '750 kr' },
      note:   { sv: 'Normalt ~950 kr — du sparar 200 kr', en: 'Normally ~950 kr — you save 200 kr' },
      link:   { sv: 'Alla priser ↑', en: 'All prices ↑' },
    },
    group: {
      title: { sv: 'GroupFinder',         en: 'GroupFinder' },
      rows: [
        { sv: 'Öppen träning',            en: 'Open training',  price: { sv: 'Gratis',       en: 'Free' } },
        { sv: 'Privat grupp',             en: 'Private group',  price: { sv: 'Kontakta mig', en: 'Contact me' } },
        { sv: 'Företag & Team',           en: 'Business & Team', price: { sv: 'Offert',      en: 'Quote' } },
      ],
      link: { sv: 'Se GroupFinder ↓', en: 'See GroupFinder ↓' },
      linkHref: '#groupfinder',
    },
    online: {
      title: { sv: 'Online-sessioner',    en: 'Online sessions' },
      rows: [
        { sv: 'Kostcoach online',         en: 'Nutrition coach online', price: { sv: 'Gratis nu', en: 'Free now' } },
        { sv: 'PT online',                en: 'PT online',              price: '150 kr' },
        { sv: 'MI-samtal online',         en: 'MI session online',      price: '250 kr' },
      ],
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

    if (data.bundle) {
      const bName = typeof data.bundle.sv === 'string'
        ? (L === 'sv' ? data.bundle.sv : data.bundle.en)
        : data.bundle[L];
      listEl.innerHTML += `<li class="contact-prices-bundle"><span>${bName}</span><span>${data.bundle.price}</span></li>`;
    }

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
      linkEl.href        = data.linkHref || '#pricing';
    }
  }


  /* ================================================================
    1. LANGUAGE TOGGLE
    — Reads data-sv / data-en attributes on elements
    — Persists choice in localStorage so it survives page refresh
    — Skips formSuccess / formError elements (they start hidden and
      have their own text set at submission time)
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


  /* ================================================================
    Service dropdown → update price panel live
  ================================================================ */
  const serviceSelect = document.getElementById('service');
  if (serviceSelect) {
    serviceSelect.addEventListener('change', () => {
      renderPricePanel(serviceSelect.value, currentLang);
    });
  }


  /* ================================================================
    7. SPOT COUNTERS
    — Reads data-spots="N" on each .pricing-card
    — Injects a live badge showing remaining discounted spots
    — To update: change data-spots="N" in the HTML (e.g. to 5, 4…)
    — At 0 the badge turns gray and says "Inga platser kvar"
  ================================================================ */
  document.querySelectorAll('.pricing-card[data-spots]').forEach(card => {
    const total = 6;
    const remaining = parseInt(card.dataset.spots, 10);
    if (isNaN(remaining)) return;

    const badge = document.createElement('div');
    badge.className = 'spots-badge' + (remaining === 0 ? ' spots-badge--full' : remaining <= 2 ? ' spots-badge--low' : '');

    const dots = Array.from({ length: total }, (_, i) => {
      const dot = document.createElement('span');
      dot.className = 'spots-dot' + (i < remaining ? ' spots-dot--open' : ' spots-dot--taken');
      return dot.outerHTML;
    }).join('');

    const label = document.createElement('span');
    label.className = 'spots-label';
    label.setAttribute('data-sv-remaining', remaining);

    function updateSpotLabel(lang) {
      if (remaining === 0) {
        label.textContent = lang === 'sv' ? 'Inga rabattplatser kvar' : 'No discounted spots left';
      } else if (remaining === 1) {
        label.textContent = lang === 'sv' ? '1 rabattplats kvar' : '1 discounted spot left';
      } else {
        label.textContent = lang === 'sv'
          ? `${remaining} av ${total} rabattplatser kvar`
          : `${remaining} of ${total} discounted spots left`;
      }
    }

    updateSpotLabel(currentLang);
    badge.innerHTML = dots;
    badge.appendChild(label);

    const cta = card.querySelector('.pricing-cta');
    if (cta) {
      card.insertBefore(badge, cta);
    } else {
      card.appendChild(badge);
    }

    card._updateSpotLabel = updateSpotLabel;
  });

  const _origApply = applyLanguage;
  (function patchApply() {
    const orig = applyLanguage;
    applyLanguage = function(lang) {
      orig(lang);
      document.querySelectorAll('.pricing-card[data-spots]').forEach(card => {
        if (card._updateSpotLabel) card._updateSpotLabel(lang);
      });
    };
  })();

});
