/* ============================ INIT ============================ */
// =============================================================================
// EVENT LISTENERS GLOBALI
// =============================================================================
// initEventListeners è l'orchestratore: chiama gli init helper per dominio.
// Ognuno di questi è autonomo e raggruppa event handler con stato condiviso (closure).
//
// I 7 setup in cui è stato spezzato:
// - initLoginAndNav: form login + click su nav-item, logout, brand
// - initMobileDrawer: hamburger, swipe sidebar, pull-down search, scroll lock body
// - initTopbarMeasure: misura altezza topbar (var CSS --topbar-height) + resize listener
// - initEditModeButtons: pulsanti edit/exit/commit/cancel tag, refresh indice
// - initGlobalSearch: search input, clear, keyboard shortcut Cmd/Ctrl+K, ESC
// - initWindowResize: cleanup mobile drawer + refresh overlay moduli su resize
// - (ESC modale viene gestito dentro initGlobalSearch perché condivide l'handler keydown)

function initEventListeners() {
  initLoginAndNav();
  initMobileDrawer();
  initTopbarMeasure();
  initEditModeButtons();
  initGlobalSearch();
  initWindowResize();
}

function initLoginAndNav() {
  $('login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const u = $('login-username').value.trim();
    const p = $('login-passphrase').value;
    if (u && p) attemptLogin(u, p);
  });

  $$('.nav-item').forEach(el => {
    if (el.dataset.route) {
      el.addEventListener('click', () => navigate(el.dataset.route));
    }
  });

  $('nav-logout').addEventListener('click', () => {
    logout();
  });

  $('brand-home').addEventListener('click', () => { closeMobileMenu(); resetDrill(); navigate('home'); });
}

// Stato condiviso del mobile drawer (variabili in chiusura del modulo per essere accessibili
// anche da brand-home click che chiama closeMobileMenu prima dell'init drawer)
let _scrollLockY = 0;
function isMobileViewport(){ return window.innerWidth <= 900; }
function openMobileMenu(){
  if (!isMobileViewport()) return;
  _scrollLockY = window.scrollY || window.pageYOffset || 0;
  $('sidebar').classList.add('mobile-open');
  $('sidebar-overlay').classList.add('show');
  $('btn-hamburger').classList.add('active');
  $('btn-hamburger').setAttribute('aria-expanded', 'true');
  // Lock body scroll (iOS-safe: position fixed mantiene la posizione)
  document.body.style.position = 'fixed';
  document.body.style.top = `-${_scrollLockY}px`;
  document.body.style.left = '0';
  document.body.style.right = '0';
  document.body.style.width = '100%';
  document.body.style.overflow = 'hidden';
}
function closeMobileMenu(){
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;  // chiamato prima dell'init DOM
  const wasOpen = sidebar.classList.contains('mobile-open');
  sidebar.classList.remove('mobile-open');
  const overlay = document.getElementById('sidebar-overlay');
  if (overlay) overlay.classList.remove('show');
  const burger = document.getElementById('btn-hamburger');
  if (burger) {
    burger.classList.remove('active');
    burger.setAttribute('aria-expanded', 'false');
  }
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  document.body.style.width = '';
  document.body.style.overflow = '';
  if (wasOpen && _scrollLockY) {
    window.scrollTo(0, _scrollLockY);
    _scrollLockY = 0;
  }
}

function initMobileDrawer() {
  $('btn-hamburger').addEventListener('click', (e) => {
    e.stopPropagation();
    if ($('sidebar').classList.contains('mobile-open')) closeMobileMenu();
    else openMobileMenu();
  });
  $('sidebar-overlay').addEventListener('click', closeMobileMenu);
  $('sidebar-close').addEventListener('click', closeMobileMenu);

  // Swipe gesture: da sinistra (primo terzo dello schermo) verso destra = apre sidebar
  //                sulla sidebar aperta verso sinistra = chiude
  //                dalla cima verso il basso = focus sulla barra di ricerca
  let touchStart = null;
  // Altezza massima vista del visualViewport: baseline "schermo senza tastiera". Usata per
  // capire se la tastiera è attualmente visibile (viewport sensibilmente più basso di questa).
  let _vvMaxH = window.visualViewport ? window.visualViewport.height : 0;
  // Ritorna il container scrollabile orizzontalmente più vicino al touch (o null), risalendo gli
  // antenati (es. tabelle in overflow .bl-table-wrap / .bk-table-wrap, .mod-page-scroll). Non
  // hardcoda i selettori, così copre anche container futuri. La decisione se bloccare l'apertura
  // della sidebar è presa al primo movimento, in base alla direzione e a quanto resta da scorrere:
  // se il container è già tutto a sinistra (scrollLeft<=0) lo swipe verso destra può aprire la sidebar.
  const _horizScrollableAncestor = (el) => {
    let node = el;
    while (node && node !== document.body && node.nodeType === 1) {
      // scrollWidth > clientWidth → c'è contenuto extra in orizzontale
      if (node.scrollWidth - node.clientWidth > 2) {
        const ox = getComputedStyle(node).overflowX;
        if (ox === 'auto' || ox === 'scroll') return node;
      }
      node = node.parentElement;
    }
    return null;
  };
  const OPEN_THRESHOLD = 60;       // px di swipe orizzontale per aprire sidebar
  const VERT_TOLERANCE = 40;       // px max verticale tollerato per swipe orizz.
  const PULL_DOWN_THRESHOLD = 90;  // px di pull-down per attivare focus search
  const HORIZ_TOLERANCE = 40;      // px max orizzontale tollerato per pull-down
  document.addEventListener('touchstart', (e) => {
    if (!isMobileViewport()) return;
    // Splash di boot ancora visibile: ignoro i gesti (swipe sidebar / pull-down ricerca).
    // Durante il boot l'app-view è già nel DOM sotto lo splash, e uno swipe verso il basso
    // poteva attivare il pull-down che mette a fuoco la ricerca → tastiera aperta sullo splash.
    if (!document.documentElement.classList.contains('splash-removed')) { touchStart = null; return; }
    const t = e.touches[0];
    if (!t) return;
    const edgeZone = window.innerWidth / 2;
    const sidebarOpen = $('sidebar').classList.contains('mobile-open');
    // Pulldown deve poter attivare il focus sull'input ANCHE quando l'overlay ricerca
    // è aperto (utente al top dei risultati che vuole tornare a digitare). In quel caso
    // il riferimento di scroll è overlay.scrollTop, non window.scrollY (il body è bloccato).
    const searchOverlayOpen = document.body.classList.contains('search-overlay-open');
    const overlay = document.getElementById('search-overlay');
    const overlayAtTop = searchOverlayOpen && overlay && overlay.scrollTop <= 0;
    const pageAtTop = !searchOverlayOpen && (window.scrollY <= 0);
    // Se un modal è aperto (es. dialog "Nuovo modulo"), il body è in overflow:hidden e window.scrollY=0
    // ma il vero contesto di scroll è dentro .modal. Disabilito pulldown in questo caso, altrimenti
    // lo swipe-giù sul modal triggera l'overlay ricerca globale.
    const modalOpen = !!document.getElementById('current-modal-backdrop');
    // Se siamo in editMode di un modulo (drag box su immagine), disabilito sia sidebar-edge
    // che pulldown: i gesti dell'utente sono per il box, non per la navigazione globale.
    const moduloEditMode = state.currentView === 'modulo' &&
                           state.currentParams && state.currentParams.slug &&
                           state.moduliCache && state.moduliCache[state.currentParams.slug] &&
                           state.moduliCache[state.currentParams.slug].editMode;
    // Container scrollabile orizzontalmente in cui parte il touch (o null). La decisione di
    // bloccare l'apertura sidebar è rimandata al touchmove, quando conosco la direzione.
    const scrollableX = _horizScrollableAncestor(e.target);
    // Tastiera mobile aperta: blocco apertura sidebar/pulldown solo se la tastiera è DAVVERO
    // visibile. Non basta che un campo sia a fuoco: dopo che la tastiera si chiude (es. gesture
    // back) il focus può restare nel campo di ricerca, ma in quel caso la gesture sidebar deve
    // tornare a funzionare. Stimo la visibilità reale della tastiera dal visualViewport.
    // Uso come riferimento il MASSIMO tra innerHeight e l'altezza nota senza tastiera: su Android
    // innerHeight si restringe con la tastiera (a differenza di iOS), quindi confrontare con esso
    // soltanto fallirebbe. Traccio l'altezza massima vista del viewport come baseline "no tastiera".
    const ae = document.activeElement;
    const fieldFocused = !!ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
    const vv = window.visualViewport;
    if (vv) { _vvMaxH = Math.max(_vvMaxH || 0, vv.height); }
    const baseline = vv ? Math.max(_vvMaxH || 0, window.innerHeight) : 0;
    const kbLikelyVisible = vv ? (vv.height < baseline - 120) : false;
    const keyboardOpen = fieldFocused && kbLikelyVisible;
    // Memorizzo lo startY e tutti i mode potenzialmente validi; il mode effettivo viene deciso al primo movimento
    touchStart = {
      x: t.clientX, y: t.clientY,
      sidebarOpen,
      scrollableX,
      canOpen: !sidebarOpen && !searchOverlayOpen && !modalOpen && !moduloEditMode && !keyboardOpen && t.clientX <= edgeZone,
      canClose: sidebarOpen,
      canPulldown: !sidebarOpen && !modalOpen && !moduloEditMode && !keyboardOpen && (pageAtTop || overlayAtTop),
      searchOverlayOpen,
      modalOpen,
      moduloEditMode,
      mode: null // deciso al primo touchmove in base alla direzione
    };
  }, { passive: true });

  // Helper: true se siamo "al top" del contesto attivo (pagina o overlay ricerca aperto)
  const isAtTopForPulldown = (ts) => {
    if (ts && ts.searchOverlayOpen) {
      const ov = document.getElementById('search-overlay');
      return !!ov && ov.scrollTop <= 0;
    }
    return window.scrollY <= 0;
  };

  // Listener NON-PASSIVO per bloccare il pull-to-refresh nativo quando l'utente
  // sta facendo pull-down sull'app. overscroll-behavior-y:contain dovrebbe bastare,
  // ma questo è un fallback per browser che non lo supportano pienamente.
  document.addEventListener('touchmove', (e) => {
    if (!touchStart || !isMobileViewport()) return;
    if (touchStart.mode === 'pulldown' || touchStart.canPulldown) {
      const t = e.touches[0];
      if (!t) return;
      const dy = t.clientY - touchStart.y;
      const absDx = Math.abs(t.clientX - touchStart.x);
      if (dy > 0 && absDx < HORIZ_TOLERANCE && isAtTopForPulldown(touchStart)) {
        e.preventDefault();
      }
    }
  }, { passive: false });

  document.addEventListener('touchmove', (e) => {
    if (!touchStart) return;
    const t = e.touches[0];
    if (!t) return;
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    // Decido il mode al primo movimento significativo (>15px in una direzione)
    if (!touchStart.mode) {
      if (absDx < 15 && absDy < 15) return;
      if (absDy > absDx && dy > 0 && touchStart.canPulldown) {
        touchStart.mode = 'pulldown';
      }
      else if (absDx > absDy) {
        // Swipe verso destra: se parte dentro un container scrollabile orizzontalmente che
        // NON è già tutto a sinistra (scrollLeft>0), il gesto serve a scorrere quel contenuto,
        // non ad aprire la sidebar. Se è già al margine sinistro, lascio aprire la sidebar.
        if (dx > 0 && touchStart.scrollableX && touchStart.scrollableX.scrollLeft > 0) {
          touchStart = null; return;
        }
        if (dx > 0 && touchStart.canOpen) touchStart.mode = 'open';
        else if (dx < 0 && touchStart.canClose) touchStart.mode = 'close';
        else { touchStart = null; return; }
      }
      else {
        touchStart = null; return;
      }
    }
    if (touchStart.mode === 'pulldown') {
      if (!isAtTopForPulldown(touchStart)) { touchStart = null; return; }
      if (absDx > HORIZ_TOLERANCE) { touchStart = null; return; }
      if (dy > PULL_DOWN_THRESHOLD) {
        // Su iOS/Android il focus+keyboard funziona in modo affidabile SOLO se chiamato
        // durante touchend (gesto "completato"), non durante touchmove.
        touchStart.shouldFocusSearch = true;
      }
    } else {
      if (absDy > VERT_TOLERANCE) { touchStart = null; return; }
      if (touchStart.mode === 'open' && dx > OPEN_THRESHOLD) {
        openMobileMenu();
        touchStart = null;
      } else if (touchStart.mode === 'close' && dx < -OPEN_THRESHOLD) {
        closeMobileMenu();
        touchStart = null;
      }
    }
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (touchStart && touchStart.shouldFocusSearch) {
      const input = document.getElementById('global-search');
      if (input) {
        // iOS apre la tastiera SOLO se focus() è chiamato in modo sincrono dentro il gesto utente
        // (qui touchend). Dentro requestAnimationFrame il focus è deferito e iOS ignora la tastiera.
        input.focus();
        try {
          input.scrollIntoView({ block: 'center', behavior: 'instant' });
        } catch (e) {
          input.scrollIntoView(false);
        }
        input.select();
      }
    }
    touchStart = null;
  }, { passive: true });
  document.addEventListener('touchcancel', () => { touchStart = null; }, { passive: true });
  // Chiudo il drawer quando l'utente naviga (click su nav-item o nav-tree-row)
  $('sidebar').addEventListener('click', (e) => {
    const navItem = e.target.closest('.nav-item, .nav-tree-row');
    if (!navItem || !isMobileViewport()) return;
    if (e.target.closest('.nav-tree-caret') || e.target.closest('.nav-edit-actions')) return;
    closeMobileMenu();
  });
  // Tap sul main content (fuori dalla sidebar) → chiude
  $('main-content').addEventListener('click', () => {
    if ($('sidebar').classList.contains('mobile-open')) closeMobileMenu();
  }, true);
  // Chiudo con ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('sidebar').classList.contains('mobile-open')) closeMobileMenu();
  });
}

// Misura l'altezza reale della topbar e la propaga come CSS var --topbar-height.
// Necessario per scroll-margin-top accurato (deep-link a blocchi, sezioni).
// Le breakpoint statiche (60/68px) non sono affidabili perché la topbar wrap
// su mobile può crescere a 2 righe quando ci sono molti elementi.
function initTopbarMeasure() {
  let _lastTopbarH = 0;
  const measureTopbar = () => {
    const tb = document.querySelector('header.topbar');
    if (!tb) return;
    // Math.ceil (NON round): se l'altezza reale è 63.4px, round darebbe 63px →
    // mancano 0.4px di padding-top e il contenuto viene tagliato di qualche pixel
    // in alto. Arrotondando per eccesso il padding copre sempre tutta la topbar.
    const h = Math.ceil(tb.getBoundingClientRect().height);
    if (h > 30 && h < 200 && h !== _lastTopbarH) {
      _lastTopbarH = h;
      document.documentElement.style.setProperty('--topbar-height', h + 'px');
    }
  };
  measureTopbar();
  window.addEventListener('resize', measureTopbar);
  window.addEventListener('orientationchange', () => setTimeout(measureTopbar, 100));
  // Doppio rAF per essere certi che fonts/layout siano stabili
  requestAnimationFrame(() => requestAnimationFrame(measureTopbar));
  // ResizeObserver: rimisura AUTOMATICAMENTE ogni volta che l'altezza reale della
  // topbar cambia, qualunque sia la causa (safe-area del notch applicata in ritardo,
  // font non ancora caricati al primo render, barra indirizzi del browser che si
  // ritrae, wrap su 2 righe su mobile). È più affidabile dei timer fissi: il taglio
  // di qualche pixel compariva anche ad aperture successive proprio perché i timer
  // [120,350,700,1500]ms non sempre coincidono col momento in cui il layout stabilizza.
  const tb0 = document.querySelector('header.topbar');
  if (tb0 && 'ResizeObserver' in window) {
    const ro = new ResizeObserver(() => measureTopbar());
    ro.observe(tb0);
  } else {
    // Fallback browser senza ResizeObserver: ri-misure temporizzate.
    [120, 350, 700, 1500].forEach(ms => setTimeout(measureTopbar, ms));
  }
  // Ri-misuro al caricamento completo (immagini/risorse) e quando i font sono pronti.
  window.addEventListener('load', () => setTimeout(measureTopbar, 50));
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => measureTopbar());
  }
  // Su mobile la viewport può cambiare quando la barra indirizzi del browser scorre via:
  // ascolto i resize del visualViewport per riallineare.
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', measureTopbar);
  }
}

function initWindowResize() {
  window.addEventListener('resize', () => {
    if (!isMobileViewport() && $('sidebar').classList.contains('mobile-open')) {
      closeMobileMenu();
    }
    // Se siamo su un modulo aperto, rallinea gli overlay box (l'immagine ha cambiato dimensione)
    if (state.currentView === 'modulo' && state.currentParams && state.currentParams.slug) {
      const slug = state.currentParams.slug;
      if (state.moduliCache[slug]) {
        // Debounce con rAF per evitare re-flow eccessivi durante il drag della finestra
        cancelAnimationFrame(window._modOverlayRaf);
        window._modOverlayRaf = requestAnimationFrame(() => refreshModuloOverlays(slug));
      }
    }
  });
}

function initEditModeButtons() {
  $('btn-edit-mode').addEventListener('click', () => toggleEditMode());
  $('btn-exit-edit').addEventListener('click', () => toggleEditMode(false));
  $('btn-commit-tags').addEventListener('click', () => commitTagEdits());
  $('btn-cancel-tags').addEventListener('click', () => cancelTagEdits());

  $('btn-refresh').addEventListener('click', async () => {
    if (state.editingContext && state.editingContext.isDirty) {
      if (!confirm('Hai modifiche non salvate. Ricaricare comunque (perderai le modifiche)?')) return;
    }
    $('btn-refresh').classList.add('has-badge');
    toast('Ricaricamento indice...', 'info', 2000);
    try {
      await buildIndex();
      toast('Indice aggiornato', 'success');
      $('btn-refresh').classList.remove('has-badge');
      navigate(state.currentView);
    } catch (e) {
      toast('Errore refresh: ' + e.message, 'error');
    }
  });
}

function initGlobalSearch() {
  const searchInput = $('global-search');
  const searchClear = $('global-search-clear');
  let searchTimeout = null;
  let lastRenderedQuery = null;
  // BUG FIX (mobile scroll-jump): updateSearchClear deve mutare il DOM SOLO quando lo
  // stato del bottone cambia davvero (vuoto ↔ non-vuoto). Chiamarlo ad ogni keystroke
  // con classList.toggle (anche se nop logico) può causare un repaint della topbar
  // sticky con backdrop-filter, che su Android Chrome durante typing con tastiera aperta
  // si traduce in micro-scroll della pagina sotto.
  let _clearShown = null;  // null = non ancora deciso
  const updateSearchClear = () => {
    if (!searchClear) return;
    const shouldShow = !!searchInput.value;
    if (shouldShow === _clearShown) return;  // no-op se stato invariato
    _clearShown = shouldShow;
    searchClear.classList.toggle('hidden', !shouldShow);
  };
  updateSearchClear();
  const doSearch = (q) => {
    if (q === lastRenderedQuery) return;
    lastRenderedQuery = q;
    state.searchFilter = new Set();
    if (q.length >= 2) {
      const overlay = document.getElementById('search-overlay');
      const wasOpen = overlay && !overlay.classList.contains('hidden');
      if (wasOpen) {
        // Overlay già visibile: aggiorna solo i risultati, NON rifare openSearchOverlay
        // (che riapplicherebbe overflow:hidden body, scrollTop=1, ecc. → causa di scatti
        // e scroll verso l'alto della pagina sotto a ogni keystroke).
        renderSearchResults(q, 'search-overlay-content');
      } else {
        openSearchOverlay(q);
      }
      if (overlay) {
        try { overlay.scrollTo({ top: 0, behavior: 'instant' }); }
        catch { overlay.scrollTop = 0; }
      }
    } else {
      closeSearchOverlay();
    }
  };
  searchInput.addEventListener('input', (e) => {
    const q = e.target.value;
    updateSearchClear();
    clearTimeout(searchTimeout);
    if (q.length < 2) {
      doSearch(q);
      return;
    }
    // Debounce 350ms per ricerche: evita lag durante typing veloce.
    searchTimeout = setTimeout(() => {
      const schedule = window.requestIdleCallback
        ? (cb) => window.requestIdleCallback(cb, { timeout: 200 })
        : (cb) => requestAnimationFrame(cb);
      schedule(() => doSearch(q));
    }, 350);
  });
  if (searchClear) {
    searchClear.addEventListener('click', () => {
      searchInput.value = '';
      updateSearchClear();
      closeSearchOverlay();
      searchInput.focus();
    });
  }
  // Se l'utente torna sull'input con testo già presente, riapri l'overlay con quei risultati.
  // MA solo se l'overlay è effettivamente chiuso.
  searchInput.addEventListener('focus', () => {
    const q = searchInput.value;
    const overlay = document.getElementById('search-overlay');
    const overlayOpen = overlay && !overlay.classList.contains('hidden');
    if (q.length >= 2 && !overlayOpen) openSearchOverlay(q);
  });

  // Keyboard shortcut: Cmd/Ctrl + K focuses search; ESC chiude modale o overlay
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
    if (e.key === 'Escape') {
      if ($('modal-container').children.length > 0) closeModal();
      else {
        if (!$('search-overlay').classList.contains('hidden')) closeSearchOverlay();
        // Se sto digitando nella barra di ricerca, esco anche dal focus (chiude tastiera su mobile).
        if (document.activeElement === searchInput) searchInput.blur();
      }
    }
  });
}

async function init() {
  initTheme();
  initEventListeners();

  // Bind globale blur-on-touch per qualsiasi input mobile (rubrica, ricerca globale, ecc.).
  // Idempotente: se openSearchOverlay lo bindasse di nuovo, il flag previene duplicati.
  if (!document._blurInputOnTouchBound) {
    document._blurInputOnTouchBound = true;
    const PROTECTED_SELECTORS = ['.search-wrap', '.rubrica-search', '.ut-search-wrap', '.ndg-add'];
    document.addEventListener('touchstart', (e) => {
      const active = document.activeElement;
      if (!active || (active.tagName !== 'INPUT' && active.tagName !== 'TEXTAREA')) return;
      const wrap = PROTECTED_SELECTORS.map(s => active.closest(s)).find(Boolean);
      if (!wrap) return;                    // input non di ricerca (es. textbox di un modulo): non toccare
      if (wrap.contains(e.target)) return;  // tocco dentro la stessa barra/area: mantieni la tastiera
      // Tocco su un ALTRO campo editabile (o dentro una barra protetta): l'utente sta passando da
      // un input all'altro (es. ricerca ↔ todos) → NON blurare, la tastiera deve restare aperta.
      if (e.target.closest('input, textarea, [contenteditable="true"]')) return;
      if (PROTECTED_SELECTORS.some(s => e.target.closest(s))) return;
      active.blur();                        // tocco fuori da qualsiasi campo: chiudi la tastiera
    }, { passive: true });
  }

  // Kbd indicator: Ctrl su Windows/Linux, ⌘ su Mac
  const kbdEl = document.getElementById('search-kbd-indicator');
  if (kbdEl) {
    const isMac = /mac|iphone|ipad|ipod/i.test(navigator.userAgent || navigator.platform || '');
    kbdEl.textContent = isMac ? '⌘K' : 'Ctrl K';
  }

  // Check for existing session
  const saved = loadSession();
  if (saved && saved.username && (saved.tokenData || saved.token)) {
    // Compatibilità con sessioni legacy (campo 'token' vecchio → 'tokenData' nuovo)
    if (saved.token && !saved.tokenData) {
      saved.tokenData = saved.token;
      delete saved.token;
    }
    state.session = saved;
    // Valida il token contro il repo dati
    try {
      const testRes = await fetch(`${CONFIG.API_BASE}/repos/${CONFIG.REPO_OWNER}/${CONFIG.DATA_REPO_NAME}`, {
        headers: { 'Authorization': `token ${saved.tokenData}`, 'Accept': 'application/vnd.github+json' }
      });
      if (testRes.ok) {
        await enterApp();
        hideBootSplash();  // app pronta dopo enterApp (preferenze caricate, primo render fatto)
        return;
      }
    } catch {}
    clearSession();
  }

  // Show login
  $('login-view').classList.remove('hidden');
  $('app-view').classList.add('hidden');
  setTimeout(() => $('login-username').focus(), 100);
  hideBootSplash();  // non c'è sessione, mostra login
}

/**
 * Nasconde lo splash di boot con un fade. Coperto da CSS:
 * - aggiunge .splash-done → opacity:0
 * - dopo 250ms (durata fade) aggiunge .splash-removed → display:none
 * Idempotente: chiamarlo più volte non fa danno.
 */
function hideBootSplash() {
  if (document.documentElement.classList.contains('splash-done')) return;
  if (window.CollinettaSplash) window.CollinettaSplash.finish();
  document.documentElement.classList.add('splash-done');
  setTimeout(() => {
    document.documentElement.classList.add('splash-removed');
  }, 280);
}

/**
 * Ri-mostra lo splash di boot (con l'animazione che riparte) sopra tutto.
 * Usato dopo la validazione del login per coprire il caricamento dell'app
 * (buildIndex ecc.) finché enterApp non ha completato il primo render.
 */
function showBootSplash() {
  const html = document.documentElement;
  const el = document.getElementById('boot-splash');
  if (!el) return;
  html.classList.remove('splash-removed');   // torna display:flex
  void el.offsetWidth;                        // reflow per riabilitare la transition
  html.classList.remove('splash-done');       // opacity 0 → 1 (fade-in)
  if (window.CollinettaSplash && window.CollinettaSplash.restart) {
    window.CollinettaSplash.restart();
  }
}

document.addEventListener('DOMContentLoaded', init);
// Safety net: se per qualche motivo init non chiama hideBootSplash entro 8s,
// lo nascondo comunque per evitare che l'utente resti bloccato sullo splash.
setTimeout(() => {
  if (!document.documentElement.classList.contains('splash-done')) {
    console.warn('[boot] splash safety timeout — hide forced');
    hideBootSplash();
  }
}, 8000);
