/* ══════════════════════════════════════════
   GUIDE PAGE — Interactive behaviours
══════════════════════════════════════════ */

/* ── Year ── */
document.getElementById('guideYear').textContent = new Date().getFullYear();

/* ── Mobile nav ── */
const hamburger = document.getElementById('hamburger');
const navLinks  = document.getElementById('navLinks');
if (hamburger && navLinks) {
  hamburger.addEventListener('click', () => {
    const open = navLinks.classList.toggle('open');
    hamburger.setAttribute('aria-expanded', open);
  });
  navLinks.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
    navLinks.classList.remove('open');
    hamburger.setAttribute('aria-expanded', 'false');
  }));
}

/* ── Section toggles ── */
function toggleSection(id, btn) {
  const el = document.getElementById(id);
  if (!el) return;
  const chevron = btn ? btn.querySelector('.section-chevron') : null;
  const isNowHidden = el.classList.toggle('hidden');
  if (chevron) chevron.classList.toggle('rotated', !isNowHidden);
}

/* ── LeoMoves filter ── */
const _leoFilters = { niva: 'all', tid: 'all', fokus: 'all' };

function setLeoFilter(type, value, btn) {
  _leoFilters[type] = value;
  document.querySelectorAll(`.leo-chip[data-filter-type="${type}"]`).forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  _applyLeoFilter();
}

function _applyLeoFilter() {
  const cards = document.querySelectorAll('#leoGrid .video-card');
  let visible = 0;
  cards.forEach(card => {
    const niva      = card.dataset.niva;
    const tid       = parseInt(card.dataset.tid);
    const fokus     = card.dataset.fokus;
    const filterTid = _leoFilters.tid;
    const showNiva  = _leoFilters.niva === 'all' || niva === _leoFilters.niva;
    const showFokus = _leoFilters.fokus === 'all' || fokus === _leoFilters.fokus;
    let showTid;
    if (filterTid === 'all')     showTid = true;
    else if (filterTid === '40') showTid = tid >= 40;
    else                         showTid = tid === parseInt(filterTid);
    const show = showNiva && showTid && showFokus;
    card.style.display = show ? '' : 'none';
    if (show) visible++;
  });
  const msg = document.getElementById('leoNoResults');
  if (msg) msg.classList.toggle('visible', visible === 0);
}

/* ── Accordion ── */
document.querySelectorAll('.accordion-header').forEach(header => {
  header.addEventListener('click', () => {
    const item   = header.closest('.accordion-item');
    const isOpen = item.classList.contains('open');
    document.querySelectorAll('.accordion-item.open').forEach(i => i.classList.remove('open'));
    if (!isOpen) item.classList.add('open');
  });
});

/* ── Training split tabs ── */
function switchSplit(name, btn) {
  document.querySelectorAll('.split-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.split-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('split-' + name).classList.add('active');
  btn.classList.add('active');
}

/* ── Video expand / collapse ── */
document.querySelectorAll('.video-expand-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const card    = btn.closest('.video-card');
    const isOpen  = card.classList.toggle('expanded');
    const lang    = document.documentElement.lang || 'sv';
    btn.textContent = isOpen
      ? (lang === 'en' ? '▲ Hide notes' : '▲ Dölj anteckningar')
      : (lang === 'en' ? '▼ Show notes' : '▼ Visa anteckningar');
  });
});

/* ── Share section ── */
function shareSection(hash) {
  const url = window.location.origin + window.location.pathname + '#' + hash;
  navigator.clipboard.writeText(url).then(() => {
    // Flash the button
    const btn = document.querySelector(`.section-share-btn[onclick*="'${hash}'"]`);
    if (btn) {
      const span = btn.querySelector('span');
      const origText = span ? span.textContent : '';
      btn.classList.add('copied');
      if (span) span.textContent = document.documentElement.lang === 'en' ? 'Copied!' : 'Kopierat!';
      setTimeout(() => {
        btn.classList.remove('copied');
        if (span) span.textContent = origText;
      }, 2000);
    }
    // Show toast
    let toast = document.getElementById('shareToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'shareToast';
      document.body.appendChild(toast);
    }
    toast.textContent = document.documentElement.lang === 'en' ? '🔗 Link copied!' : '🔗 Länk kopierad!';
    toast.classList.add('visible');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.classList.remove('visible'), 2500);
  });
}

/* ── Auto-open section from URL hash ── */
(function () {
  const hashMap = {
    'leomoves':  'leo-content',
    'ovningar':  'athlean-content',
    'ppl-program': 'ppl-content',
  };
  function openFromHash() {
    const hash = window.location.hash.slice(1);
    const contentId = hashMap[hash];
    if (!contentId) return;
    const content = document.getElementById(contentId);
    if (!content || !content.classList.contains('hidden')) return;
    // Find its toggle button
    const toggle = content.closest('.container')?.querySelector('.section-header-toggle');
    content.classList.remove('hidden');
    if (toggle) {
      const chevron = toggle.querySelector('.section-chevron');
      if (chevron) chevron.classList.add('rotated');
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', openFromHash);
  } else {
    openFromHash();
  }
  window.addEventListener('hashchange', openFromHash);
})();

/* ── Smooth scroll for quick-nav ── */
document.querySelectorAll('.guide-quick-nav a').forEach(a => {
  a.addEventListener('click', e => {
    const target = document.querySelector(a.getAttribute('href'));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

/* ── Language toggle ── */
(function () {
  const btn = document.getElementById('langToggle');
  let lang = localStorage.getItem('lang') || 'sv';

  function applyLang(l) {
    lang = l;
    localStorage.setItem('lang', l);
    document.querySelectorAll('[data-sv][data-en]').forEach(el => {
      el.innerHTML = l === 'sv' ? el.dataset.sv : el.dataset.en;
    });
    document.querySelectorAll('[data-sv-placeholder][data-en-placeholder]').forEach(el => {
      el.placeholder = l === 'sv' ? el.dataset.svPlaceholder : el.dataset.enPlaceholder;
    });
    // Translate split day names and activity labels
    const daysSv = ['Mån','Tis','Ons','Tor','Fre','Lör','Sön'];
    const daysEn = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const labelsSvToEn = { 'Helkropp':'Full Body','Vila':'Rest','Ben':'Legs','Överkropp':'Upper Body','Underkropp':'Lower Body','Bröst':'Chest','Rygg':'Back','Axlar':'Shoulders','Armar':'Arms' };
    const labelsEnToSv = Object.fromEntries(Object.entries(labelsSvToEn).map(([k,v]) => [v,k]));
    document.querySelectorAll('.split-day-name').forEach(el => {
      const t = el.textContent.trim();
      const iSv = daysSv.indexOf(t); const iEn = daysEn.indexOf(t);
      if (l === 'en' && iSv >= 0) el.textContent = daysEn[iSv];
      if (l === 'sv' && iEn >= 0) el.textContent = daysSv[iEn];
    });
    document.querySelectorAll('.split-day-label').forEach(el => {
      const t = el.textContent.trim();
      if (l === 'en' && labelsSvToEn[t]) el.textContent = labelsSvToEn[t];
      if (l === 'sv' && labelsEnToSv[t]) el.textContent = labelsEnToSv[t];
    });
    // Re-apply correct text on already-expanded video cards
    document.querySelectorAll('.video-card.expanded .video-expand-btn').forEach(btn => {
      btn.textContent = l === 'en' ? '▲ Hide notes' : '▲ Dölj anteckningar';
    });
    if (btn) btn.textContent = l === 'sv' ? 'EN' : 'SV';
    document.documentElement.lang = l;
  }

  if (btn) btn.addEventListener('click', () => applyLang(lang === 'sv' ? 'en' : 'sv'));
  applyLang(lang);
})();
