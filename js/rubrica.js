/* ============================ VIEW — NUMERI ============================ */
let rubricaSearchDebounce = null;
let _lastRenderedRubricaQuery = null;
function onRubricaSearchInput(value) {
  // Allineato al pattern della ricerca globale: solo debounce + schedule, niente
  // scritture sincrone su state ad ogni keystroke. Lo state viene aggiornato dentro
  // la callback differita, riducendo il lavoro per battuta.
  if (rubricaSearchDebounce) clearTimeout(rubricaSearchDebounce);
  // Cancellazione veloce (q vuoto o 1 carattere): reagisco subito senza debounce
  if (!value || value.length < 2) {
    _doRubricaSearch(value || '');
    return;
  }
  // Debounce dinamico: dentro una UOC specifica i contatti sono <200, ma il render completo
  // di renderNumeri rifa innerHTML del main-content (header + search bar + bucket + righe).
  // Su mobile è costoso. 250ms è un compromesso tra reattività e fluidità di digitazione.
  // Fuori da UOC (rubrica intera, 4400+ contatti) → 350ms per evitare lag durante typing veloce.
  const insideUoc = !!(state.currentParams && state.currentParams.filter
    && state.index?.numeri?.gruppi?.find(g => g.id === state.currentParams.filter));
  const delay = insideUoc ? 250 : 350;
  rubricaSearchDebounce = setTimeout(() => {
    const schedule = window.requestIdleCallback
      ? (cb) => window.requestIdleCallback(cb, { timeout: 200 })
      : (cb) => requestAnimationFrame(cb);
    schedule(() => _doRubricaSearch(value));
  }, delay);
}

function _doRubricaSearch(value) {
  // Memo: se la query non è cambiata dall'ultimo render, niente da fare
  if (value === _lastRenderedRubricaQuery) return;
  _lastRenderedRubricaQuery = value;
  // Aggiorna state (qui, non a ogni keystroke)
  if ((state.rubricaSearch || '') !== value) {
    if (state.rubricaExpandedGroups) state.rubricaExpandedGroups.clear();
  }
  state.rubricaSearch = value;

  // Re-render INCREMENTALE: aggiorno solo #rubrica-results invece di tutto main-content.
  // Così l'input #rubrica-search-input non viene rimosso/ricreato → nessuna perdita di focus,
  // nessun blink, e la digitazione resta fluida anche su mobile con migliaia di contatti.
  const params = state.currentParams || {};
  const existingResults = document.getElementById('rubrica-results');
  if (!existingResults) {
    // Primo render o struttura cambiata: full render
    renderNumeri(params.filter);
    return;
  }

  // Renderizzo in un container offscreen, poi estraggo solo le parti che cambiano.
  const tempContainer = document.createElement('div');
  tempContainer.style.display = 'none';
  document.body.appendChild(tempContainer);
  try {
    renderNumeri(params.filter, tempContainer);
    const newResults = tempContainer.querySelector('#rubrica-results');
    if (!newResults) return;
    existingResults.replaceWith(newResults);
    // Aggiorno anche counter "X UOC · Y contatti" e icona ✕ (fuori da #rubrica-results)
    const newRubricaSearch = tempContainer.querySelector('.rubrica-search');
    const oldRubricaSearch = $('main-content').querySelector('.rubrica-search');
    if (newRubricaSearch && oldRubricaSearch) {
      const newCounter = newRubricaSearch.querySelector('span[style*="white-space:nowrap"]');
      const oldCounter = oldRubricaSearch.querySelector('span[style*="white-space:nowrap"]');
      const newClearBtn = newRubricaSearch.querySelector('button[onclick="clearRubricaSearch()"]');
      const oldClearBtn = oldRubricaSearch.querySelector('button[onclick="clearRubricaSearch()"]');
      if (newCounter && oldCounter) oldCounter.replaceWith(newCounter);
      else if (newCounter && !oldCounter) oldRubricaSearch.appendChild(newCounter);
      else if (!newCounter && oldCounter) oldCounter.remove();
      if (newClearBtn && oldClearBtn) oldClearBtn.replaceWith(newClearBtn);
      else if (newClearBtn && !oldClearBtn) {
        const wrap = oldRubricaSearch.querySelector('div[style*="position:relative"]');
        if (wrap) wrap.appendChild(newClearBtn);
      } else if (!newClearBtn && oldClearBtn) oldClearBtn.remove();
    }
  } catch (e) {
    console.warn('[rubricaSearch] re-render incrementale fallito, fallback full:', e);
    renderNumeri(params.filter);
  } finally {
    tempContainer.remove();
  }
}

function clearRubricaSearch() {
  state.rubricaSearch = '';
  _lastRenderedRubricaQuery = null;
  if (state.rubricaExpandedGroups) state.rubricaExpandedGroups.clear();
  const params = state.currentParams || {};
  renderNumeri(params.filter);
  const input = document.getElementById('rubrica-search-input');
  if (input) input.focus();
}

function filterRubricaByInitial(letter) {
  // Le lettere non sono de-selezionabili: si può solo cambiare quale è attiva
  state.rubricaInitialFilter = letter;
  const params = state.currentParams || {};
  renderNumeri(params.filter);
}

function openGuardieRubrica() {
  state.rubricaSearch = '';
  _lastRenderedRubricaQuery = null;
  navigate('numeri', { filter: 'guardia' });
  // Focus sull'input di ricerca dopo il render
  setTimeout(() => {
    const input = document.getElementById('rubrica-search-input');
    if (input) input.focus();
  }, 50);
}

function showAllFromGroup(groupId) {
  // Espande inline il gruppo (mostra tutti i contatti anche se la ricerca è attiva)
  if (!state.rubricaExpandedGroups) state.rubricaExpandedGroups = new Set();
  state.rubricaExpandedGroups.add(groupId);
  const params = state.currentParams || {};
  const savedScroll = window.scrollY;
  renderNumeri(params.filter);
  // Dopo il re-render scrolla al gruppo
  requestAnimationFrame(() => {
    window.scrollTo({ top: savedScroll, behavior: 'instant' });
    setTimeout(() => {
      const groups = document.querySelectorAll('.numeri-group');
      for (const el of groups) {
        const delBtn = el.querySelector(`[onclick*="deleteGruppoNumeri('${groupId}')"]`);
        if (delBtn) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          el.style.transition = 'background-color 0.3s';
          el.style.backgroundColor = 'rgba(43,74,111,0.06)';
          setTimeout(() => { el.style.backgroundColor = ''; }, 1200);
          break;
        }
      }
    }, 30);
  });
}

function collapseGroup(groupId) {
  if (state.rubricaExpandedGroups) state.rubricaExpandedGroups.delete(groupId);
  const params = state.currentParams || {};
  const savedScroll = window.scrollY;
  renderNumeri(params.filter);
  requestAnimationFrame(() => window.scrollTo({ top: savedScroll, behavior: 'instant' }));
}

// Rende le sezioni personalizzate dell'utente nella vista preferiti della rubrica.
// Ogni sezione è un blocco con i suoi contatti; in edit-mode si possono creare,
// rinominare, eliminare sezioni e aggiungere/rimuovere contatti.
function renderCustomSezioniHtml(query) {
  const q = (query || '').trim();
  const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const qn = norm(q);
  const sezioni = userPrefs.getCustomSezioni();
  const editMode = navState.editMode && !q;   // durante la ricerca niente controlli di modifica
  const blocks = sezioni.map((sez, si) => {
    const nameMatches = !!q && norm(sez.nome).includes(qn);
    let cids = (sez.contatti || []);
    // In ricerca: se il NOME della sezione combacia mostro tutti i contatti; altrimenti
    // mostro solo quelli che combaciano con la query. Sezione senza match → nascosta.
    if (q && !nameMatches) {
      cids = cids.filter(cid => {
        const c = findContattoBySlug(cid);
        if (!c) return false;
        return _contattoMatchesQuery(q, c, c._gruppo ? { nome: c._gruppo } : null);
      });
      if (!cids.length) return '';
    }
    const contattiHtml = cids.map((cid, ci) => {
      const c = findContattoBySlug(cid);
      if (!c) return '';
      const g = (c._gruppo) ? c._gruppo : '';
      const sezName = (c.sezione || '').trim();
      const uocName = g ? stripPrefixNome(g) : '';
      const eyebrow = [uocName, sezName].filter(Boolean).join(' · ');
      return renderNumeroRow(c, g || '', classifyContatto(c), {
        hideLuogo: false,
        eyebrow: eyebrow || null,
        alwaysStar: true,
        pinnedView: true,
        preferBreve: true,
        reorderCustom: editMode ? {
          onUp: `moveCsContatto('${escapeJs(sez.id)}','${escapeJs(cid)}',-1)`,
          onDown: `moveCsContatto('${escapeJs(sez.id)}','${escapeJs(cid)}',1)`
        } : null,
        reorderFirst: ci === 0,
        reorderLast: ci === cids.length - 1
      });
    }).join('') || (q ? '' : '<div style="padding:8px 14px;font-size:12px;color:var(--ink-muted);font-style:italic;">Nessun contatto in questa sezione. Usa la ☆ su un contatto per aggiungerlo qui.</div>');
    if (q && !contattiHtml) return '';
    return `<div class="fav-bucket fav-bucket-collapsed" data-cs-id="${escapeHtml(sez.id)}">
      <button class="fav-bucket-header" onclick="toggleFavBucket(this)" aria-expanded="false">
        <span class="fav-bucket-caret">&#9656;</span>
        <span class="sede-bucket-tipo">${escapeHtml(sez.nome)}</span>
        ${editMode ? `<span class="fav-bucket-edit" style="margin-left:auto;display:inline-flex;gap:6px;" onclick="event.stopPropagation();">
          <button class="btn-icon-mini" onclick="event.stopPropagation();moveCsSezione('${escapeJs(sez.id)}',-1)" title="Sposta sezione su" ${si === 0 ? 'disabled' : ''}>↑</button>
          <button class="btn-icon-mini" onclick="event.stopPropagation();moveCsSezione('${escapeJs(sez.id)}',1)" title="Sposta sezione giù" ${si === sezioni.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="btn-icon-mini" onclick="event.stopPropagation();renameCustomSezionePrompt('${escapeJs(sez.id)}')" title="Rinomina sezione">✎</button>
          <button class="btn-icon-mini" onclick="event.stopPropagation();deleteCustomSezionePrompt('${escapeJs(sez.id)}')" title="Elimina sezione">🗑</button>
        </span>` : ''}
      </button>
      <div class="fav-bucket-contatti">${contattiHtml}</div>
    </div>`;
  }).filter(Boolean).join('');
  const addSezBtn = editMode
    ? `<div style="margin:8px 0 16px;"><button class="btn ghost" style="font-size:13px;" onclick="addCustomSezionePrompt()">+ Nuova sezione personalizzata</button></div>`
    : '';
  if (!blocks && !addSezBtn) return '';
  return `<div class="custom-sezioni-wrap" style="margin-bottom:20px;">${blocks}${addSezBtn}</div>`;
}

// Handler globali per le sezioni personalizzate
function moveCsSezione(id, dir) {
  userPrefs.moveCustomSezione(id, dir);
  renderNumeri('pinned');
}
function moveCsContatto(sezId, cid, dir) {
  userPrefs.moveContactInCustomSezione(sezId, cid, dir);
  renderNumeri('pinned');
}
function addCustomSezionePrompt() {
  const nome = prompt('Nome della nuova sezione personalizzata:\n(es. "PS", "Reperibili weekend")', '');
  if (!nome || !nome.trim()) return;
  userPrefs.addCustomSezione(nome);
  renderNumeri('pinned');
}
function renameCustomSezionePrompt(id) {
  const sez = userPrefs.getCustomSezioni().find(s => s.id === id);
  if (!sez) return;
  const nome = prompt('Rinomina sezione:', sez.nome);
  if (!nome || !nome.trim()) return;
  userPrefs.renameCustomSezione(id, nome);
  renderNumeri('pinned');
}
function deleteCustomSezionePrompt(id) {
  const sez = userPrefs.getCustomSezioni().find(s => s.id === id);
  if (!sez) return;
  if (!confirm(`Eliminare la sezione "${sez.nome}"? (i contatti restano in rubrica)`)) return;
  userPrefs.deleteCustomSezione(id);
  renderNumeri('pinned');
}
function removeFromCustomSezione(sezId, cid) {
  userPrefs.removeContactFromCustomSezione(sezId, cid);
  renderNumeri('pinned');
}
// Apre un dialog per spostare un contatto in una sezione personalizzata.
// Il contatto, una volta in una sezione, non compare più sotto la sua UOC nei preferiti.
// Popup di gestione preferiti: sceglie in quali sezioni dei preferiti includere
// il contatto. Sono toggle indipendenti: la "Sezione UOC" (raggruppamento standard
// per la UOC del contatto) + tutte le sezioni personalizzate. Si può creare al volo
// una nuova sezione.
function openPinSezioniPopup(cid) {
  const c = findContattoBySlug(cid);
  if (!c) return;
  const sezioni = userPrefs.getCustomSezioni();
  const inUoc = userPrefs.hasPrefUoc(cid);
  const inHome = userPrefs.hasHomeNumero(cid);
  // Nome UOC del contatto per l'etichetta della sezione standard
  const gNome = c._gruppo ? stripPrefixNome(c._gruppo) : 'UOC';
  // Stile comune dei pulsanti-riga: testo a sinistra che va a capo (no overflow fuori dal rettangolo)
  const rowStyle = 'width:100%;text-align:left;margin-bottom:6px;white-space:normal;word-break:break-word;line-height:1.3;height:auto;';
  // Riga in evidenza: "Contatti fissati" della home (sistema home_numeri, separato dalle liste).
  const homeRow = `<button class="btn ${inHome ? '' : 'ghost'}" data-pop-home="1" style="${rowStyle}${inHome ? 'background:var(--accent-soft);border-color:var(--accent);' : ''}"
    onclick="toggleHomeNumeroFromPopup('${escapeJs(cid)}')"><span class="pop-ic">${inHome ? '📌' : '📍'}</span> Contatti fissati <span style="color:var(--ink-muted);font-weight:normal;">· in home</span></button>`;
  const uocRow = `<button class="btn ${inUoc ? '' : 'ghost'}" data-pop-sez="_uoc" style="${rowStyle}${inUoc ? 'background:var(--accent-soft);border-color:var(--accent);' : ''}"
    onclick="togglePinSezione('${escapeJs(cid)}','_uoc')"><span class="pop-ic">${inUoc ? '★' : '☆'}</span> Sezione UOC <span style="color:var(--ink-muted);font-weight:normal;">· ${escapeHtml(gNome)}</span></button>`;
  const customRows = sezioni.map(s => {
    const isIn = (s.contatti || []).includes(cid);
    return `<button class="btn ${isIn ? '' : 'ghost'}" data-pop-sez="${escapeHtml(s.id)}" style="${rowStyle}${isIn ? 'background:var(--accent-soft);border-color:var(--accent);' : ''}"
      onclick="togglePinSezione('${escapeJs(cid)}','${escapeJs(s.id)}')"><span class="pop-ic">${isIn ? '★' : '☆'}</span> ${escapeHtml(s.nome)}</button>`;
  }).join('');
  showModal({
    title: 'Preferiti',
    subtitle: escapeHtml(c.etichetta),
    body: `
      <div style="margin-bottom:10px;font-size:13px;color:var(--ink-muted);">Scegli dove salvare questo numero:</div>
      ${homeRow}
      <div style="border-top:1px solid var(--rule-soft);margin:8px 0;padding-top:10px;font-size:12px;color:var(--ink-muted);">Oppure aggiungilo a una lista dei preferiti:</div>
      ${uocRow}
      ${customRows}
      <div style="border-top:1px solid var(--rule-soft);margin-top:8px;padding-top:10px;">
        <button class="btn" style="width:100%;" onclick="createSezioneEPin('${escapeJs(cid)}')">+ Nuova sezione…</button>
      </div>`,
    actions: [{ label: 'Chiudi', variant: 'ghost', onClick: closeModal }]
  });
}
// Toggle in-place dell'appartenenza a una sezione, aggiornando il pulsante senza riaprire la modale.
function togglePinSezione(cid, sezId) {
  const isIn = userPrefs.toggleContattoInSezione(cid, sezId);
  // Aggiorno il pulsante della sezione nel popup, in-place (niente re-render della modale → niente scatto)
  const btn = document.querySelector(`[data-pop-sez="${CSS && CSS.escape ? CSS.escape(sezId) : sezId}"]`);
  if (btn) {
    btn.classList.toggle('ghost', !isIn);
    const ic = btn.querySelector('.pop-ic'); if (ic) ic.textContent = isIn ? '★' : '☆';
    if (isIn) { btn.style.background = 'var(--accent-soft)'; btn.style.borderColor = 'var(--accent)'; }
    else { btn.style.background = ''; btn.style.borderColor = ''; }
  }
  // Aggiorno le stelle dei contatti visibili in pagina
  const pinned = userPrefs.isContattoStarred(cid);
  document.querySelectorAll(`[data-pin-key="contatto:${cid}"]`).forEach(b => {
    b.classList.toggle('pinned', pinned);
    b.innerHTML = pinned ? '★' : '☆';
  });
  // Ricostruisco la vista sottostante (preferiti/home) senza toccare la modale
  if (state.currentView === 'numeri' && (state.currentParams || {}).filter === 'pinned') {
    const savedScroll = window.scrollY;
    renderNumeri('pinned');
    requestAnimationFrame(() => window.scrollTo({ top: savedScroll, behavior: 'instant' }));
  } else if (state.currentView === 'home') {
    renderHome();
  }
}
// Toggle dei "Contatti fissati" (home) dal popup, aggiornando il pulsante in-place.
function toggleHomeNumeroFromPopup(cid) {
  const inHome = userPrefs.toggleHomeNumero(cid);
  const btn = document.querySelector('[data-pop-home="1"]');
  if (btn) {
    btn.classList.toggle('ghost', !inHome);
    const ic = btn.querySelector('.pop-ic'); if (ic) ic.textContent = inHome ? '📌' : '📍';
    if (inHome) { btn.style.background = 'var(--accent-soft)'; btn.style.borderColor = 'var(--accent)'; }
    else { btn.style.background = ''; btn.style.borderColor = ''; }
  }
  const pinned = userPrefs.isContattoStarred(cid);
  document.querySelectorAll(`[data-pin-key="contatto:${cid}"]`).forEach(b => {
    b.classList.toggle('pinned', pinned);
    b.innerHTML = pinned ? '★' : '☆';
  });
  if (state.currentView === 'numeri' && (state.currentParams || {}).filter === 'pinned') {
    const savedScroll = window.scrollY;
    renderNumeri('pinned');
    requestAnimationFrame(() => window.scrollTo({ top: savedScroll, behavior: 'instant' }));
  } else if (state.currentView === 'home') {
    renderHome();
  }
}

function createSezioneEPin(cid) {
  const nome = prompt('Nome della nuova sezione personalizzata:\n(es. "PS", "Reperibili weekend")', '');
  if (!nome || !nome.trim()) return;
  const sez = userPrefs.addCustomSezione(nome);
  if (sez) { userPrefs.addContactToCustomSezione(sez.id, cid); openPinSezioniPopup(cid); }
}

// Riordina un contatto nella lista preferiti UOC (su = -1, giù = +1), preservando lo scroll.
function movePrefUoc(cid, dir) {
  if (!userPrefs.reorderPrefUoc(cid, dir)) return;
  const savedScroll = window.scrollY;
  renderNumeri('pinned');
  requestAnimationFrame(() => window.scrollTo({ top: savedScroll, behavior: 'instant' }));
}

// Sposta un intero box-UOC dei preferiti su/giù. Legge dal DOM l'ordine attualmente mostrato
// (i box con data-uoc-id) per inizializzare/mantenere coerente pin_order._uoc.
function moveUocBox(gid, dir) {
  const displayed = Array.from(document.querySelectorAll('#rubrica-results .sr-sede-bucket[data-uoc-id]'))
    .map(el => el.getAttribute('data-uoc-id'));
  if (!userPrefs.reorderUocBox(gid, dir, displayed)) return;
  const savedScroll = window.scrollY;
  renderNumeri('pinned');
  requestAnimationFrame(() => window.scrollTo({ top: savedScroll, behavior: 'instant' }));
}

function renderNumeri(filter, targetContainer) {
  // targetContainer: opzionale. Container DOM su cui scrivere. Se omesso, scrive su $('main-content').
  // Usato da _doRubricaSearch per re-render incrementale in un container offscreen.
  const container = targetContainer || $('main-content');
  const data = state.index.numeri;
  if (!data) {
    if (targetContainer) return; // in re-render incrementale silenzia errori
    return renderError('Rubrica non disponibile', 'Il file content/numeri.yml non è stato caricato.');
  }

  const codiciGen = data.codici_generali || [];
  // Pull groups from AOPD + any extended sources toggled on
  const allGroups = getVisibleNumeriGroups();
  const showExt = state.showExtendedNumeri || { osa: false, iov: false };
  const ext = state.numeriExtendedAvailable || {};

  // Apertura della rubrica senza filtro/ricerca: mostra i numeri preferiti
  // (UOC pinnate + contatti in home_numeri) invece di tutti i numeri, se ce ne sono.
  if (!filter && !state.rubricaSearch) {
    const hasAnyPin = allGroups.some(g =>
      (g.contatti || []).some(c => isPinned('contatto', c.id))
    );
    const hasCustomSezioni = userPrefs.getCustomSezioni().length > 0;
    if (hasAnyPin || hasCustomSezioni) {
      // Redirect al filtro preferiti. Uso replace (non push) così premendo "indietro" non
      // si resta intrappolati su questa entry redirect → la history torna alla pagina
      // precedente (es. Attività) invece di ri-renderizzare numeri all'infinito.
      navigate('numeri', { filter: 'pinned' }, { replace: true });
      return;
    }
  }

  let filteredGruppi = allGroups;
  let filterLabel = null;
  // UOC di contesto quando si è dentro una singola UOC: risolta sia se `filter` è un
  // id gruppo, sia se è uno slug di contatto (ingresso da preferiti/fissati/ricerca).
  // Usata più sotto per il chip filtro blu e il placeholder "Cerca in <UOC>…".
  let filterGruppo = null;
  let activeSource = 'aopd'; // quale fonte stiamo guardando: aopd (default), osa, iov
  if (filter === 'all') {
    // "Tutti": mostra tutti i gruppi (nessun filtro), senza redirect ai preferiti.
    filteredGruppi = allGroups;
  } else if (filter === 'pinned') {
    // Sotto le UOC mostro SOLO i contatti nella "sezione UOC standard" dei preferiti
    // (pref_uoc). Separato dai fissati in home (home_numeri). Le sezioni personalizzate
    // sono rese separatamente da renderCustomSezioniHtml.
    filteredGruppi = allGroups.filter(g => (g._source || 'aopd') === 'aopd').map(g => {
      let cInUoc = (g.contatti || []).filter(c => userPrefs.hasPrefUoc(c.id));
      // Ordino i preferiti UOC secondo l'ordine salvato in pref_uoc (riordinabile con ↑↓).
      const order = (state.userPrefs && state.userPrefs.pref_uoc) || [];
      cInUoc = cInUoc.slice().sort((a, b) => {
        const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
        return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
      });
      if (cInUoc.length) return { ...g, contatti: cInUoc };
      return null;
    }).filter(Boolean);
  } else if (filter === 'guardia') {
    filteredGruppi = allGroups.filter(g => (g._source || 'aopd') === 'aopd').map(g => ({ ...g, contatti: (g.contatti || []).filter(c => (c.tag || []).includes('guardia')) })).filter(g => g.contatti.length);
    // Nessuna label: il chip MdG in alto già indica il filtro attivo
  } else if (filter === 'osa') {
    filteredGruppi = allGroups.filter(g => g._source === 'osa');
    filterLabel = "Ospedale Sant'Antonio";
    activeSource = 'osa';
  } else if (filter === 'iov') {
    filteredGruppi = allGroups.filter(g => g._source === 'iov');
    filterLabel = 'Istituto Oncologico Veneto';
    activeSource = 'iov';
  } else if (filter) {
    // Prima prova: filter è un gruppoId → mostra solo quella UOC
    const gruppoMatch = allGroups.find(g => g.id === filter);
    if (gruppoMatch) {
      filteredGruppi = [gruppoMatch];
      filterLabel = `UOC: ${gruppoMatch.nome}`;
      activeSource = gruppoMatch._source || 'aopd';
      filterGruppo = gruppoMatch;
    } else {
      // Fallback: filter è un contatto slug.
      // Mostro la UOC completa (non più contatto isolato) e scrollo al contatto
      // dopo il render, espandendo solo la sua sezione.
      const c = findContattoBySlug(filter);
      if (c) {
        // Trova il gruppo che contiene il contatto
        const ownerGroup = allGroups.find(g => (g.contatti || []).some(x => x.id === filter));
        if (ownerGroup) {
          filteredGruppi = [ownerGroup];
          filterLabel = `UOC: ${ownerGroup.nome}`;
          activeSource = ownerGroup._source || 'aopd';
          filterGruppo = ownerGroup;
          // Risolvi il sedeKey della sezione del contatto per espandere solo quella.
          // groupContattiBySede genera sedeKey come slug della sezione (vedi quella funzione).
          // Apriamo la sezione corrispondente settando state.expandedSedi[gruppoId].
          //
          // NB: questo blocco si esegue una SOLA volta — quando l'utente arriva qui via click
          // dalla ricerca. Se l'utente clicca un altro bucket nella UOC overview, deve essere
          // toggleSedeBucket a gestire l'expansion/collapse, NON questo reset.
          // Usiamo state._lastFilterContattoInit come marcatore: settato a `filter` quando
          // il reset è già stato fatto per questa navigazione specifica.
          if (!state.expandedSedi) state.expandedSedi = {};
          const isFirstOpenForThisContatto = state._lastFilterContattoInit !== filter;
          if (isFirstOpenForThisContatto && c.sezione) {
            // Cerca il bucket che contiene il contatto per ricavarne il sedeKey corretto
            const sezNorm = (c.sezione || '').toLowerCase().trim();
            const sezioneIdx = (ownerGroup.sezioni || []).findIndex(s =>
              (s.nome || '').toLowerCase().trim() === sezNorm
            );
            if (sezioneIdx >= 0) {
              state.expandedSedi[ownerGroup.id] = new Set([`sede_${sezioneIdx}`]);
            } else {
              // Fallback: sezione dinamica (definita solo dai contatti, non da g.sezioni)
              state.expandedSedi[ownerGroup.id] = new Set([`dyn_${sezNorm.replace(/\s+/g,'_')}`]);
            }
            state._lastFilterContattoInit = filter;
          }
          // Schedula lo scroll al contatto dopo il render (solo prima volta)
          if (isFirstOpenForThisContatto) {
            state.pendingContattoScrollId = filter;
          }
        } else {
          filteredGruppi = [];
          filterLabel = `Contatto non trovato (id: ${filter})`;
        }
      } else {
        // Filter è un id ma non matcha né gruppo né contatto: mostra messaggio esplicito
        console.warn('[renderNumeri] filter non trovato:', filter);
        filteredGruppi = [];
        filterLabel = `Contatto non trovato (id: ${filter})`;
      }
    }
  } else {
    // Default: solo AOPD. OSA/IOV accessibili via chip dopo Z.
    filteredGruppi = allGroups.filter(g => (g._source || 'aopd') === 'aopd');
  }

  const rubricaQuery = (state.rubricaSearch || '').trim().toLowerCase();
  if (rubricaQuery) {
    // Dizionario sinonimi: una parola cercata matcha anche i suoi sinonimi
    // Il valore è la lista di ALTERNATIVE che si considerano equivalenti per la ricerca
    const synonyms = {
      'reparto': ['reparto', 'reparti', 'degenza', 'degenze', 'ricovero'],
      'reparti': ['reparto', 'reparti', 'degenza', 'degenze'],
      'degenza': ['reparto', 'reparti', 'degenza', 'degenze'],
      'degenze': ['reparto', 'reparti', 'degenza', 'degenze'],
      'segreteria': ['segreteria', 'segr'],
      'ambulatorio': ['ambulatorio', 'ambulatori', 'amb'],
      'ambulatori': ['ambulatorio', 'ambulatori', 'amb'],
      'sala operatoria': ['sala operatoria', 'sale operatorie', 's.o.', 'so ', 'operatoria'],
      'operatoria': ['sala operatoria', 'sale operatorie', 'operatoria', 'so '],
      'day hospital': ['day hospital', 'dh ', 'day-hospital'],
      'dh': ['day hospital', 'dh ', 'day-hospital'],
      'mdg': ['mdg', 'medico di guardia', 'medico guardia'],
      'guardia': ['guardia', 'mdg', 'medico di guardia'],
      'ucic': ['ucic', 'unità coronarica', 'unita coronarica', 'terapia intensiva cardiologica'],
      'utic': ['utic', 'unità terapia intensiva'],
      'emodinamica': ['emodinamica', 'cardiologia interventistica'],
      'elettrofisiologia': ['elettrofisiologia'],
      'rianimazione': ['rianimazione', 'terapia intensiva'],
      'intramoenia': ['intramoenia', 'libera professione'],
    };
    // Divido la query in termini. Token corti che sono articoli/preposizioni vengono rimossi
    // se ci sono altri token più significativi (>=3 chars), per evitare che "lo menzo"
    // matchi qualunque UOC che contiene "lo" (es. Neurologia, Malattie infettive, ecc.)
    const STOPWORDS_2 = new Set(['lo','la','il','le','gli','un','di','da','in','su','al','del','dei','gl','li','ne','ci','si','se','ma','mi']);
    const rawTokens = rubricaQuery.split(/\s+/).filter(Boolean);
    const significantTokens = rawTokens.filter(t => t.length >= 3 && !STOPWORDS_2.has(t));
    const tokens = significantTokens.length > 0 ? significantTokens : rawTokens;
    
    const tokenMatchesText = (token, text) => {
      if (text.includes(token)) return true;
      // Prova sinonimi: se il token ha sinonimi, provane uno che matcha
      const alts = synonyms[token];
      if (alts) {
        for (const alt of alts) {
          if (text.includes(alt)) return true;
        }
      }
      return false;
    };
    
    // Per ogni gruppo precomputo la mappa contatto→tipo_sede usando groupContattiBySede
    const groupSedeTipoMap = new Map();
    filteredGruppi.forEach(g => {
      try {
        const buckets = groupContattiBySede(g.contatti || [], g.sezioni);
        const m = new Map();
        buckets.forEach(b => {
          const t = b.sede && b.sede.tipo ? b.sede.tipo : '';
          if (t) (b.contatti || []).forEach(c => m.set(c.id, t));
        });
        groupSedeTipoMap.set(g.id, m);
      } catch { groupSedeTipoMap.set(g.id, new Map()); }
    });
    
    const contactText = (c, gId) => {
      const sedeTipo = (groupSedeTipoMap.get(gId) || new Map()).get(c.id) || '';
      return [
        c.etichetta, c.sezione, c.sottosezione, c.edificio, c.piano, c.luogo,
        c.cellulare_personale, c.cellulare_aziendale, c.breve,
        sedeTipo,
        ...(c.numeri || []).map(String),
        ...(c.tag || [])
      ].filter(Boolean).join(' ').toLowerCase();
    };
    
    // Testo del gruppo per matchGroupOnly: nome + tag del gruppo.
    // Le sezioni NON sono incluse: cercare "ucic" deve tornare i contatti UCIC, non
    // tutti quelli della UOC che ha UCIC tra le sue sezioni.
    const groupText = (g) => {
      return [g.nome, (g.tag || []).join(' ')].filter(Boolean).join(' ').toLowerCase();
    };
    
    // Un contatto matcha se OGNI token è soddisfatto. Per ogni token, le regole sono:
    // - Se il token è nel testo "puro" del gruppo (nome+alias), passa per tutti i contatti del gruppo.
    //   Esempio: "cardiologia" è nel nome, quindi tutti i contatti di Cardiologia matchano "cardiologia".
    // - Altrimenti DEVE matchare il testo del singolo contatto (etichetta, sezione, luogo, ecc.).
    //   Questo evita che un token tipo "ucic" — che è solo una sezione di Cardiologia — faccia
    //   matchare tutti i contatti del gruppo (gli "altri reparti"). Ora matcha solo i contatti
    //   la cui sezione/luogo/etc. contiene "ucic".
    const matchContactWithGroup = (c, gTxt, gId) => {
      const cTxt = contactText(c, gId);
      return tokens.every(tok =>
        tokenMatchesText(tok, gTxt) || tokenMatchesText(tok, cTxt)
      );
    };
    const matchGroupOnly = (gTxt) => tokens.every(tok => tokenMatchesText(tok, gTxt));
    
    const expandedSet = state.rubricaExpandedGroups || new Set();
    // Se stiamo filtrando per una UOC specifica, la ricerca deve filtrare sui contatti
    const isInsideSpecificUoc = filter && allGroups.find(g => g.id === filter);
    // Traccio quali gruppi matchano per nome UOC (non per singoli contatti).
    // Questo determina il layout di rendering: match-per-UOC mostra header + sezioni espandibili,
    // match-per-contatto mostra solo rettangoli "UOC · Sezione" collassati.
    // NB: dentro la vista UOC singola (filter=ID), il layout collassato non si applica mai —
    // la UOC è già il "soggetto" della pagina, l'header gerarchico ha senso anche ricercando.
    state._matchedGroupNames = new Set();
    state._isInsideSpecificUoc = !!isInsideSpecificUoc;
    filteredGruppi = filteredGruppi.map(g => {
      const gTxt = groupText(g);       // nome+alias del gruppo
      const groupNameMatches = matchGroupOnly(gTxt);
      // Se sono dentro la UOC, considero sempre il gruppo "matched" così il layout resta gerarchico
      if (groupNameMatches || isInsideSpecificUoc) state._matchedGroupNames.add(g.id);
      // Se il gruppo è espanso manualmente o il gruppo stesso matcha completamente, mostra tutti i contatti
      // Eccetto quando siamo dentro una UOC specifica: lì dobbiamo sempre filtrare sui contatti
      if (!isInsideSpecificUoc && (expandedSet.has(g.id) || groupNameMatches)) return g;
      // Altrimenti filtra i singoli contatti: i token non matchati dal nome del gruppo devono
      // matchare il testo del singolo contatto (sezione, luogo, etichetta, numeri).
      const contatti = (g.contatti || []).filter(c => matchContactWithGroup(c, gTxt, g.id));
      return contatti.length ? { ...g, contatti } : null;
    }).filter(Boolean);
    // Sort per rilevanza durante la ricerca:
    // 1. Gruppi che matchano per NOME UOC vengono prima (es. "infettive" → Mal. Infettive prima di Ematologia,
    //    che ha solo contatti la cui sede contiene "infettive").
    // 2. A parità: ordine alfabetico (per nome senza prefisso U.O.C.).
    if (filteredGruppi.length > 1) {
      filteredGruppi.sort((a, b) => {
        // 1. Priority: gruppi con priority numerica esplicita (es. PS) vengono PRIMA di tutti
        //    gli altri match-by-name, indipendentemente dall'ordine alfabetico.
        //    Valori più bassi = più alta priorità (1 prima di 2). Default 99 per gruppi senza.
        const aPrio = (typeof a.priority === 'number') ? a.priority : 99;
        const bPrio = (typeof b.priority === 'number') ? b.priority : 99;
        if (aPrio !== bPrio) return aPrio - bPrio;
        // 2. Match-by-name prima di match-by-content
        const aMatched = state._matchedGroupNames.has(a.id) ? 0 : 1;
        const bMatched = state._matchedGroupNames.has(b.id) ? 0 : 1;
        if (aMatched !== bMatched) return aMatched - bMatched;
        // 3. Alfabetico (escluso prefisso U.O.C.)
        return stripPrefixNome(a.nome).localeCompare(stripPrefixNome(b.nome), 'it');
      });
    }
  } else {
    state._matchedGroupNames = null; // nessuna ricerca attiva
    // Siamo dentro UOC specifica se filter è un gruppoId OPPURE un contattoId (in entrambi
    // i casi mostriamo una sola UOC). Per il caso contattoId, abbiamo già impostato
    // filteredGruppi a [ownerGroup] sopra, quindi basta controllare la lunghezza.
    state._isInsideSpecificUoc = !!filter && filteredGruppi.length === 1;
  }

  // Group by ospedale source for visual sectioning
  const bySource = { aopd: [], osa: [], iov: [] };
  filteredGruppi.forEach(g => {
    const src = g._source || 'aopd';
    if (!bySource[src]) bySource[src] = [];
    bySource[src].push(g);
  });
  const sourceLabels = { aopd: 'AOPD — Azienda Ospedale Università Padova', osa: "OSA — Ospedale Sant'Antonio", iov: 'IOV — Istituto Oncologico Veneto' };

  const toggleHtml = '';

  const totalContattiVisibili = filteredGruppi.reduce((s, g) => s + (g.contatti || []).length, 0);

  container.innerHTML = `
    <div class="page-head">
      <div class="page-eyebrow">${buildBreadcrumb([{label:'Home', route:'home'}])}Rubrica</div>
      <h1 class="page-title">Rubrica</h1>
      <div class="numeri-filters" style="margin-top:20px;">
        <button class="filter-chip ${filter === 'pinned' ? 'active' : ''}" onclick="navigate('numeri', {filter:'pinned'})" title="Solo numeri e UOC preferiti">★</button>
        <button class="filter-chip ${(filter === 'all' || !filter) ? 'active' : ''}" onclick="navigate('numeri', {filter:'all'})">Tutti</button>
        <button class="filter-chip ${filter === 'guardia' ? 'active' : ''}" onclick="navigate('numeri', {filter:'guardia'})">MdG</button>
      </div>
      ${toggleHtml}
    </div>

    <div class="rubrica-search" style="margin-bottom:8px;display:flex;align-items:center;gap:10px;">
      <div style="position:relative;flex:1;display:flex;align-items:center;">
        <input type="text" id="rubrica-search-input" inputmode="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" placeholder="${filter === 'pinned' ? 'Cerca tra i preferiti' : (filterGruppo ? `Cerca in ${escapeHtml(stripPrefixNome(filterGruppo.nome))}…` : 'Cerca in rubrica: nome, interno, reparto…')}"
          value="${escapeHtml(state.rubricaSearch || '')}"
          oninput="onRubricaSearchInput(this.value)"
          style="flex:1;font-family:var(--sans);font-size:16px;padding:10px 36px 10px 14px;background:var(--bg-raised);border:1px solid var(--rule);border-radius:2px;color:var(--ink);width:100%;box-sizing:border-box;">
        ${rubricaQuery ? `<button type="button" onclick="clearRubricaSearch()" aria-label="Cancella" title="Cancella" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);width:22px;height:22px;border:none;background:var(--bg-paper);color:var(--ink-muted);border-radius:50%;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;line-height:1;">✕</button>` : ''}
      </div>
      ${rubricaQuery ? `<span style="font-size:12px;color:var(--ink-muted);font-family:var(--mono);white-space:nowrap;">${filteredGruppi.length} UOC · ${totalContattiVisibili} contatti</span>` : ''}
    </div>
    ${(function(){
      // Chip filtro UOC quando si è dentro una UOC specifica (per id gruppo o slug contatto)
      if (!filterGruppo) return '';
      return `<div style="margin-bottom:24px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span style="font-size:11px;color:var(--ink-muted);font-family:var(--mono);text-transform:uppercase;letter-spacing:.06em;">Filtro:</span>
        <span class="filter-chip-uoc">
          ${escapeHtml(stripPrefixNome(filterGruppo.nome))}
          <button onclick="navigate('numeri', {filter:'all'})" title="Rimuovi filtro UOC" style="background:none;border:none;color:inherit;font-size:14px;cursor:pointer;padding:0 0 0 4px;line-height:1;opacity:.7;">✕</button>
        </span>
      </div>` ;
    })()}

    <div id="rubrica-results">
    ${!filter && !rubricaQuery && codiciGen.length ? `
      <div class="codici-banner">
        ${codiciGen.map(c => `
          <div class="codici-banner-item">
            <div class="codici-banner-label">${escapeHtml(c.etichetta)}</div>
            <div class="codici-banner-value">${escapeHtml(c.valore)}</div>
          </div>
        `).join('')}
      </div>
    ` : ''}

    ${(filter === 'pinned') ? renderCustomSezioniHtml(rubricaQuery) : ''}

    ${(filteredGruppi.length === 0 && !(filter === 'pinned' && userPrefs.getCustomSezioni().length)) ? `<p style="color:var(--ink-muted);">${rubricaQuery ? `Nessun risultato per "${escapeHtml(rubricaQuery)}".` : 'Nessun contatto corrisponde al filtro.'}</p>` : ''}

    ${filter !== 'pinned' ? `<div class="edit-only" style="margin: 16px 0;">
      <button class="btn ghost" onclick="nuovoGruppoNumeri()" style="font-size:13px;">+ Nuovo gruppo di numeri</button>
    </div>` : ''}

    ${['aopd','osa','iov'].map(src => {
      const list = bySource[src] || [];
      if (!list.length) return '';
      const showHeader = false;
      // Vista MdG: contatti come quelli normali, raggruppati in box "UOC · Sezione"
      if (filter === 'guardia') {
        const items = [];
        list.forEach(g => (g.contatti || []).forEach(c => items.push({ c, g })));
        return renderUocSezioniBox(items, { starAlways: true });
      }
      // Vista preferiti (★): contatti inline "Sezione · etichetta", stella sempre visibile,
      // riordino dei preferiti UOC con maniglie (in edit-mode).
      if (filter === 'pinned' && src === 'aopd') {
        const items = [];
        list.forEach(g => (g.contatti || []).forEach(c => items.push({ c, g })));
        return renderContattiGroupedBox(items, { inline: true, starAlways: true, reorderPrefUoc: true, reorderUocBoxes: true, expanded: !!rubricaQuery });
      }
      // Altre source (osa/iov) non mostrano nulla in modalità pinned
      if (filter === 'pinned') return '';
      const compactMode = !rubricaQuery && (!filter || filter === 'all');
      if (compactMode) {
        const stripPrefix = stripPrefixNome;
        // Calcolo le iniziali disponibili (solo lettere A-Z, ignoro numeri/altro)
        const initialsAvailable = new Set();
        list.forEach(g => {
          const name = stripPrefix(g.nome);
          const ch = (name.charAt(0) || '').toUpperCase();
          if (ch >= 'A' && ch <= 'Z') initialsAvailable.add(ch);
        });
        const allLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
        // Se nessuna lettera è attiva, preseleziona la prima lettera disponibile (tipicamente 'A')
        if (state.rubricaInitialFilter === null || state.rubricaInitialFilter === undefined) {
          const firstAvailable = allLetters.find(L => initialsAvailable.has(L));
          if (firstAvailable) state.rubricaInitialFilter = firstAvailable;
        }
        const activeInitial = state.rubricaInitialFilter || null;
        // Filtro la lista per iniziale se attiva
        const visibleList = activeInitial
          ? list.filter(g => stripPrefix(g.nome).charAt(0).toUpperCase() === activeInitial)
          : list;
        // Ordino per nome senza prefisso
        const sortedList = [...visibleList].sort((a,b) => stripPrefix(a.nome).localeCompare(stripPrefix(b.nome), 'it'));
        // Alfabeto cliccabile (senza chip preferiti)
        const osaAvailable = !!(state.numeriExtendedAvailable && state.numeriExtendedAvailable.osa);
        const iovAvailable = !!(state.numeriExtendedAvailable && state.numeriExtendedAvailable.iov);
        const alphabetBar = `
          <div class="rubrica-alphabet-bar">
            ${allLetters.map(L => {
              const has = initialsAvailable.has(L);
              const isActive = activeInitial === L;
              return `<button class="rubrica-alpha-btn ${isActive ? 'active' : ''} ${has ? '' : 'disabled'}"
                ${has ? `onclick="filterRubricaByInitial('${L}')"` : 'disabled'}
                title="${has ? `Mostra UOC che iniziano per ${L}` : 'Nessuna UOC'}">${L}</button>`;
            }).join('')}
            ${(src === 'aopd' && osaAvailable) ? `<button class="rubrica-alpha-btn rubrica-alpha-source" onclick="openExtendedSource('osa')" title="Ospedale Sant'Antonio">OSA</button>` : ''}
            ${(src === 'aopd' && iovAvailable) ? `<button class="rubrica-alpha-btn rubrica-alpha-source" onclick="openExtendedSource('iov')" title="Istituto Oncologico Veneto">IOV</button>` : ''}
          </div>`;
        // Il filtro preferiti è ora gestito dal chip ★ tra i filtri in alto
        const pinnedSection = '';
        return `
          ${showHeader ? `<h3 class="numeri-source-header" style="margin:28px 0 12px;font-family:var(--serif);font-size:15px;color:var(--ink-muted);font-weight:500;border-bottom:1px solid var(--rule-soft);padding-bottom:6px;">${escapeHtml(sourceLabels[src])}</h3>` : ''}
          ${pinnedSection}
          ${alphabetBar}
          <div class="uoc-compact-list">
            ${sortedList.map(g => {
              return `<div class="uoc-compact-item">
                <button style="background:none;border:none;flex:1;text-align:left;cursor:pointer;padding:0;font:inherit;color:inherit;min-width:0;" onclick="navigate('numeri', {filter:'${escapeJs(g.id)}'})">
                  <span class="uoc-compact-name">${escapeHtml(stripPrefix(g.nome))}</span>
                </button>
              </div>`;
            }).join('')}
          </div>`;
      }
      return `
        ${showHeader ? `<h3 class="numeri-source-header" style="margin:28px 0 12px;font-family:var(--serif);font-size:15px;color:var(--ink-muted);font-weight:500;border-bottom:1px solid var(--rule-soft);padding-bottom:6px;">${escapeHtml(sourceLabels[src])}</h3>` : ''}
        ${list.map(g => {
          const isManuallyExpanded = rubricaQuery && (state.rubricaExpandedGroups || new Set()).has(g.id);
          const isGuardiaFilter = filter === 'guardia';
          // Determina il modo di rendering durante una ricerca:
          // - matchedByName: il nome UOC matcha la query → header UOC ridotto + sezioni espandibili
          // - !matchedByName + ricerca attiva: layout collassato (no header UOC, header sezione = "UOC · Sezione")
          const matchedByName = rubricaQuery && state._matchedGroupNames && state._matchedGroupNames.has(g.id);
          const isCollapsedSearch = !!rubricaQuery && !matchedByName;
          // displayName: durante ricerca uso il nome ridotto (compatto), altrove nome completo
          const displayName = isGuardiaFilter
            ? stripPrefixNome(g.nome)
            : (rubricaQuery ? shortenUocName(g) : g.nome);
          return `
          <div class="numeri-group${isCollapsedSearch ? ' numeri-group-collapsed' : ''}">
            ${isCollapsedSearch ? '' : `<h2 class="numeri-group-title"><span style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
              ${rubricaQuery
                ? `<a href="#" onclick="event.preventDefault(); _navigateOutOfRubricaSearch('numeri', {filter:'${escapeJs(g.id)}'})" style="color:inherit;text-decoration:none;border-bottom:1px dotted var(--rule-strong);cursor:pointer;" title="Apri vista UOC completa">${escapeHtml(displayName)}</a>`
                : (filter && filter !== g.id)
                  ? `<a href="#" onclick="event.preventDefault(); navigate('numeri', {filter:'${escapeJs(g.id)}'})" style="color:inherit;text-decoration:none;border-bottom:1px dotted var(--rule-strong);cursor:pointer;" title="Apri tutta la UOC">${escapeHtml(displayName)}</a>`
                  : escapeHtml(displayName)
              }
              <span style="margin-left:auto;display:inline-flex;gap:6px;align-items:center;">
                ${isManuallyExpanded ? `<button class="btn-icon-mini" onclick="collapseGroup('${escapeJs(g.id)}')" title="Nascondi tutti i numeri di questa UOC" style="font-size:11px;color:var(--ink-muted);">↕ nascondi</button>` : ''}
                <span class="edit-only" style="display:inline-flex;gap:6px;">
                  <button class="btn-icon-mini" onclick="renameGruppoNumeri('${escapeJs(g.id)}')" title="Modifica gruppo">✎</button>
                  <button class="btn-icon-mini" onclick="deleteGruppoNumeri('${escapeJs(g.id)}')" title="Elimina gruppo">🗑</button>
                </span>
              </span>
              </span>
              ${isGuardiaFilter ? '' : renderUbicazioneBadge(g.ubicazione)}
            </h2>`}
            ${(g.direttore && filter !== 'guardia' && !rubricaQuery) ? `<div style="font-size:12px;color:var(--ink-muted);font-style:italic;margin-bottom:8px;">Direttore: ${escapeHtml(g.direttore)}</div>` : ''}
            ${(g.email && filter !== 'guardia' && !rubricaQuery) ? `<div style="font-size:12px;color:var(--accent);margin-bottom:8px;font-family:var(--mono);">${escapeHtml(g.email)}</div>` : ''}
            ${(function(){
              const sorted = sortContattiForDisplay(g.contatti || []);
              const buckets = groupContattiBySede(sorted, g.sezioni);
              // Caso speciale: durante una ricerca, se la UOC matcha per NOME (matchedByName)
              // e NON siamo dentro una UOC specifica, mostriamo SOLO le sezioni come pillole
              // chiuse, ognuna cliccabile per aprire la UOC overview con quella sezione espansa.
              // Questo evita di overwhelmare l'utente con tutti i contatti di una UOC grande
              // quando ha cercato il nome della UOC stessa.
              // Se l'utente ha espanso manualmente la UOC (showAllFromGroup), mostra tutto come prima.
              const showSectionPills = matchedByName && !state._isInsideSpecificUoc
                && !isManuallyExpanded
                && buckets.length > 0 && !(buckets.length === 1 && buckets[0].sedeKey === '_all');
              if (showSectionPills) {
                const uocEdif = (g.ubicazione && g.ubicazione.struttura) || '';
                // Filtra le sezioni "valide" (per indici di riordino). Skip _all bucket vuoto.
                const validBuckets = buckets.filter(b => {
                  if (b.sedeKey === '_all' && !(b.contatti || []).length) return false;
                  return true;
                });
                // Render sezioni come pillole chiuse cliccabili.
                // In edit-mode mostra anche frecce ↑/↓ per riordinare le sezioni nel YAML
                // (aggiorna g.sezioni[i].priority basandosi sul nuovo ordine).
                return `<div class="search-section-pills">
                  ${validBuckets.map((b, idx) => {
                    const isAllBucket = b.sedeKey === '_all';
                    const sezioneLabel = isAllBucket ? 'Altri contatti' : bucketSezioneLabel(b);
                    const sezEdif = (b.sede && b.sede.edificio) || uocEdif || '';
                    const sezPiano = (b.sede && b.sede.piano) || '';
                    const showEdif = sezEdif && sezEdif !== uocEdif;
                    const sedeLoc = [showEdif ? sezEdif : '', sezPiano].filter(Boolean).join(' · ');
                    const nContatti = (b.contatti || []).length;
                    // Le frecce sono attive solo per sezioni reali (con b.sede), non _all
                    const isReorderable = !isAllBucket && b.sede && b.sede.nome;
                    const isFirst = idx === 0;
                    const isLast = idx === validBuckets.length - 1;
                    const sezNomeEsc = isReorderable ? escapeJs(b.sede.nome) : '';
                    return `<div class="search-section-pill-wrap">
                      <button class="search-section-pill" onclick="openUocWithSede('${escapeJs(g.id)}','${escapeJs(b.sedeKey)}')" title="Apri ${escapeHtml(g.nome)} con ${escapeHtml(sezioneLabel)} espansa">
                        <span class="ssp-name">${escapeHtml(sezioneLabel)}</span>
                        ${sedeLoc ? `<span class="ssp-loc">${escapeHtml(sedeLoc)}</span>` : ''}
                        <span class="ssp-count">${nContatti}</span>
                      </button>
                      ${isReorderable ? `<span class="ssp-reorder edit-only">
                        <button class="btn-icon-mini" onclick="event.stopPropagation();moveSezione('${escapeJs(g.id)}','${sezNomeEsc}',-1)" title="Sposta su" ${isFirst ? 'disabled' : ''}>↑</button>
                        <button class="btn-icon-mini" onclick="event.stopPropagation();moveSezione('${escapeJs(g.id)}','${sezNomeEsc}',1)" title="Sposta giù" ${isLast ? 'disabled' : ''}>↓</button>
                        <button class="btn-icon-mini" onclick="event.stopPropagation();editSezioneAlias('${escapeJs(g.id)}','${sezNomeEsc}')" title="Rinomina sezione e modifica tag">✎</button>
                      </span>` : ''}
                    </div>`;
                  }).join('')}
                </div>`;
              }
              // Se c'è una sola bucket senza sede (UOC senza sedi strutturate), render flat senza header
              if (buckets.length === 1 && buckets[0].sedeKey === '_all') {
                const suppressCtxFlat = !!state._isInsideSpecificUoc;
                const canReorderFlat = filter !== 'pinned' && filter !== 'guardia';
                return buckets[0].contatti.map(c => renderNumeroRow(c, g.id, c._classify, { gruppo: g, suppressContext: suppressCtxFlat, reorderable: canReorderFlat, contextLine: filter === 'pinned' ? [stripPrefixNome(g.nome), c.sezione].filter(Boolean).join(' · ') : '', pinnedView: filter === 'pinned' })).join('');
              }
              // Logica inversa: espansi di default quando si apre la UOC in overview.
              // Quando si fa una ricerca (rubricaQuery) o filtro guardia: collassati,
              // mostrando solo gli header sede come shortcut di navigazione.
              // isUocOverview: vista di una UOC singola, no ricerca attiva.
              // Vale sia quando filter è un gruppoId, sia quando filter è un contattoId
              // (ora apriamo la UOC overview espandendo solo la sezione del contatto).
              const isUocOverview = !!filter
                && filter !== 'guardia'
                && !rubricaQuery
                && filteredGruppi.length === 1;
              // Modalità:
              //   - overview UOC singola (gruppoId o contattoId) → "default chiuso",
              //     ma state.expandedSedi può aprire sezioni specifiche
              //   - filtro guardia (MdG) → "default aperto" (l'utente vuole vedere subito i numeri)
              //   - rubrica generale (no filter, no ricerca) → "default aperto"
              //   - ricerca → "default aperto" (l'utente vuole vedere i match)
              const defaultOpen = !isUocOverview;
              if (!state.expandedSedi) state.expandedSedi = {};
              if (!state.collapsedSedi) state.collapsedSedi = {};
              const expanded = state.expandedSedi[g.id] || new Set();
              const collapsed = state.collapsedSedi[g.id] || new Set();
              return buckets.map((b, bIdx, allB) => {
                // Calcolo la "location string" del bucket per confrontarla col luogo del singolo contatto.
                // Edificio + piano: se il c.luogo li contiene è ridondante e va nascosto.
                // sedeLoc: edificio + piano del bucket. Se la sezione non ha edificio,
                // ereditalo da g.ubicazione.struttura (struttura dell'UOC).
                // Esempio: Cardiologia ha ubicazione=Centro Gallucci. La sezione Emodinamica ha
                // solo piano="1° piano". sedeLoc effettivo = "Centro Gallucci 1° piano".
                // Così il c.luogo "Centro Gallucci" matcha → hide.
                const inheritedEdif = (b.sede && !b.sede.edificio)
                  ? (g.ubicazione && g.ubicazione.struttura) || ''
                  : '';
                const sedeLoc = b.sede
                  ? [b.sede.edificio || inheritedEdif, b.sede.piano].filter(Boolean).join(' ')
                  : '';
                const sedeLocLower = sedeLoc.toLowerCase().trim();
                // Normalizza: rimuove separatori per confronto più tollerante
                const normalize = (s) => s.toLowerCase().replace(/[·|\-,]/g, ' ').replace(/\s+/g, ' ').trim();
                const sedeLocN = normalize(sedeLoc);
                // Se siamo in modalità "default aperto": il bucket è aperto salvo che l'utente non l'abbia chiuso
                // Se siamo in modalità "default chiuso": il bucket è chiuso salvo che l'utente non l'abbia aperto
                // In modalità isCollapsedSearch (match per contatto/sezione): SEMPRE aperto, NIENTE toggle.
                const isOpen = isCollapsedSearch ? true : (defaultOpen ? !collapsed.has(b.sedeKey) : expanded.has(b.sedeKey));
                // Badge "MdG" a destra del titolo sezione se il bucket contiene un medico di guardia.
                const mdgBadge = bucketHasGuardia(b)
                  ? '<span class="sede-bucket-mdg" title="Presente medico di guardia">MdG</span>'
                  : '';
                // Header del bucket: in modalità collassata mostra "UOC ridotta · Sezione" senza caret/toggle
                let bucketHeaderHtml;
                if (isCollapsedSearch) {
                  const uocShort = shortenUocName(g);
                  const sezioneLabel = bucketSezioneLabel(b);
                  // UOC e Sezione cliccabili separatamente: UOC → overview UOC, Sezione → UOC + sezione espansa
                  bucketHeaderHtml = `<div class="sede-bucket-toggle sede-bucket-static">
                    <span class="sede-bucket-tipo">
                      <span class="ctx-uoc" onclick="event.stopPropagation();_navigateOutOfRubricaSearch('numeri',{filter:'${escapeJs(g.id)}'})" title="Apri ${escapeHtml(g.nome)}">${escapeHtml(uocShort)}</span><span class="sede-bucket-sep"> · </span><span class="ctx-sezione sede-bucket-sez" onclick="event.stopPropagation();openUocWithSede('${escapeJs(g.id)}','${escapeJs(b.sedeKey)}')" title="Apri ${escapeHtml(g.nome)} con ${escapeHtml(sezioneLabel)} espansa">${escapeHtml(sezioneLabel)}</span>
                    </span>
                    ${mdgBadge}
                  </div>`;
                } else if (matchedByName) {
                  // Match per nome UOC durante ricerca: il bucket sezione è un link che apre la
                  // overview UOC con la sezione espansa (coerente con la ricerca globale).
                  const headerInner = b.sede
                    ? renderSedeBucketHeader(b.sede, null, g)
                    : (b.customLabel
                      ? renderSedeBucketHeader(null, b.customLabel, g)
                      : `<span class="sede-bucket-tipo">Altro</span>`);
                  bucketHeaderHtml = `<button class="sede-bucket-toggle sede-bucket-navigate" onclick="openUocWithSede('${escapeJs(g.id)}','${escapeJs(b.sedeKey)}')" title="Apri ${escapeHtml(g.nome)} con questa sezione espansa">
                    ${headerInner}
                    ${mdgBadge}
                  </button>`;
                } else {
                  const headerInner = b.sede
                    ? renderSedeBucketHeader(b.sede, null, g)
                    : (b.customLabel
                      ? renderSedeBucketHeader(null, b.customLabel, g)
                      : `<span class="sede-bucket-tipo">Altro</span>`);
                  bucketHeaderHtml = `<button class="sede-bucket-toggle ${isOpen ? 'open' : ''}" onclick="toggleSedeBucket('${escapeJs(g.id)}','${escapeJs(b.sedeKey)}', ${defaultOpen})">
                    <span class="sede-bucket-caret">${isOpen ? '▾' : '▸'}</span>
                    ${headerInner}
                    ${mdgBadge}
                  </button>`;
                }
                return `<div class="sede-bucket" data-bucket="${escapeHtml(b.sedeKey)}">
                  <div class="sede-bucket-header-row">
                    ${bucketHeaderHtml}
                    ${(b.sede && b.sede.nome) ? `<span class="ssp-reorder edit-only">
                      <button class="btn-icon-mini" onclick="event.stopPropagation();moveSezione('${escapeJs(g.id)}','${escapeJs(b.sede.nome)}',-1)" title="Sposta sezione su" ${bIdx === 0 ? 'disabled' : ''}>↑</button>
                      <button class="btn-icon-mini" onclick="event.stopPropagation();moveSezione('${escapeJs(g.id)}','${escapeJs(b.sede.nome)}',1)" title="Sposta sezione giù" ${bIdx === allB.length - 1 ? 'disabled' : ''}>↓</button>
                      <button class="btn-icon-mini" onclick="event.stopPropagation();editSezioneAlias('${escapeJs(g.id)}','${escapeJs(b.sede.nome)}')" title="Rinomina sezione e modifica tag">✎</button>
                    </span>` : ''}
                  </div>
                  ${isOpen ? `<div class="sede-bucket-contatti">${(function(){
                    // Helper: renderizza un singolo contatto nel bucket
                    const renderC = (c) => {
                      const cLuogoN = normalize(getLuogoContatto(c));
                      let hide = false;
                      if (sedeLocN && cLuogoN) {
                        hide = cLuogoN === sedeLocN || cLuogoN.includes(sedeLocN) || sedeLocN.includes(cLuogoN);
                        if (!hide) {
                          const cToks = cLuogoN.split(' ').filter(Boolean);
                          const sToks = new Set(sedeLocN.split(' ').filter(Boolean));
                          hide = cToks.length > 0 && cToks.every(t => sToks.has(t));
                        }
                      }
                      return renderNumeroRow(c, g.id, c._classify, { hideLuogo: hide, reorderable: (filter !== 'pinned' && filter !== 'guardia'), contextLine: filter === 'pinned' ? [stripPrefixNome(g.nome), c.sezione].filter(Boolean).join(' · ') : '', pinnedView: filter === 'pinned' });
                    };
                    // Se il bucket ha sottosezioni: renderizzo ogni subBucket come sezione nidificata
                    if (b.subBuckets && b.subBuckets.length) {
                      let html = b.contatti.map(renderC).join(''); // contatti direttamente nel bucket principale (senza sottosezione)
                      b.subBuckets.forEach(sb => {
                        if (!sb.contatti.length) return;
                        const subName = sb.sede?.nome || '—';
                        html += `<div class="sede-subbucket"><div class="sede-subbucket-header">${escapeHtml(subName)}</div><div class="sede-subbucket-contatti">${sb.contatti.map(renderC).join('')}</div></div>`;
                      });
                      return html;
                    }
                    return b.contatti.map(renderC).join('');
                  })()}</div>` : ''}
                </div>`;
              }).join('');
            })()}
            ${(function(){
              // Se sto filtrando e questa UOC ha più contatti di quelli visibili, mostra un hint
              if (!rubricaQuery || isManuallyExpanded) return '';
              const fullGroup = allGroups.find(x => x.id === g.id);
              const totalContacts = fullGroup ? (fullGroup.contatti || []).length : 0;
              const visibleContacts = (g.contatti || []).length;
              const hidden = totalContacts - visibleContacts;
              if (hidden > 0) {
                return `<div style="margin-top:8px;padding:8px 10px;background:var(--bg-sink);border-radius:2px;font-size:12px;">
                  <a href="#" onclick="event.preventDefault(); showAllFromGroup('${escapeJs(g.id)}')" style="color:var(--accent);text-decoration:none;">+ ${hidden} altri numeri in questa UOC →</a>
                </div>`;
              }
              return '';
            })()}
            <div class="edit-only" style="margin-top:8px;">
              <button class="btn ghost" onclick="nuovoContatto('${escapeJs(g.id)}')" style="font-size:12px;">+ Aggiungi contatto</button>
            </div>
          </div>`;
        }).join('')}
      `;
    }).join('')}
    </div>`;

  // Skip post-processing (scroll, focus, side effects) se stiamo rendendo in container offscreen.
  // In quel caso siamo dentro _doRubricaSearch che gestirà lui side effects sul DOM finale.
  if (targetContainer) return;

  // Scroll al contatto se richiesto (apertura via filter=contattoId)
  // L'expansion della sezione corrispondente è già stata schedulata via state.expandedSedi
  if (state.pendingContattoScrollId) {
    const contattoId = state.pendingContattoScrollId;
    state.pendingContattoScrollId = null;
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => {
      // Cerca la riga del contatto via data-contatto-id (selector più affidabile dei
      // pattern stringa sull'onclick, che cambiano nel tempo).
      let target = document.querySelector(`.numero-row[data-contatto-id="${CSS.escape(contattoId)}"]`);
      // Fallback per retrocompatibilità: vecchi onclick con filter:'<id>'
      if (!target) {
        const rows = document.querySelectorAll('.numero-row');
        for (const r of rows) {
          const oc = r.getAttribute('onclick') || '';
          if (oc.includes(`'${contattoId}'`)) { target = r; break; }
        }
      }
      if (!target) return;
      // Misura altezza topbar reale (PWA standalone con notch può cambiare)
      const tb = document.querySelector('header.topbar');
      let tbH = 60;
      if (tb) {
        const h = Math.round(tb.getBoundingClientRect().height);
        if (h > 30 && h < 200) tbH = h;
      }
      const banner = document.getElementById('edit-mode-banner');
      let bannerH = 0;
      if (banner && !banner.classList.contains('hidden')) {
        bannerH = Math.round(banner.getBoundingClientRect().height);
      }
      const rect = target.getBoundingClientRect();
      // Centra verticalmente la riga nello spazio visibile (sotto topbar+banner).
      // viewport disponibile = window.innerHeight - tbH - bannerH
      // posizione target = topbar+banner + (viewport_disponibile - rect.height) / 2
      const viewportH = window.innerHeight;
      const visibleH = viewportH - tbH - bannerH;
      const offsetFromTop = tbH + bannerH + Math.max(0, (visibleH - rect.height) / 2);
      const targetTop = window.scrollY + rect.top - offsetFromTop;
      try {
        window.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
      } catch {
        window.scrollTo(0, Math.max(0, targetTop));
      }
      // Evidenziazione marcata e prolungata (animazione CSS, ~3,5s)
      target.classList.remove('contatto-flash');
      // forza il reflow così l'animazione riparte anche se la classe era già presente
      void target.offsetWidth;
      target.classList.add('contatto-flash');
      setTimeout(() => { target.classList.remove('contatto-flash'); }, 3600);
    }, 50)));
  }
}

function renderHomeNumeriSection() {
  const cids = (state.userPrefs && state.userPrefs.home_numeri) || [];
  const editMode = navState.editMode;
  // Risolvi contatti da cid
  const items = [];
  cids.forEach(cid => {
    for (const g of getVisibleNumeriGroups()) {
      const c = (g.contatti || []).find(x => x.id === cid);
      if (c) { items.push({ c, g }); break; }
    }
  });

  let listHtml;
  if (editMode) {
    // In modifica: lista piatta riordinabile (drag&drop) + rimozione
    listHtml = `<div id="home-numeri-list">${items.map(({ c, g }) => {
      const nums = (c.numeri || []).join(' · ');
      const persPart = c.cellulare_personale ? (Array.isArray(c.cellulare_personale) ? c.cellulare_personale : [c.cellulare_personale]).join(' · ') : '';
      const cellPart = c.cellulare_aziendale ? (Array.isArray(c.cellulare_aziendale) ? c.cellulare_aziendale : [c.cellulare_aziendale]).join(' · ') : '';
      const extra = [c.breve ? `${c.breve}` : '', persPart, cellPart].filter(Boolean).join(' · ');
      const dispNum = [nums, extra].filter(Boolean).join(' · ');
      return `<div class="home-numero-row" data-cid="${escapeHtml(c.id)}">
        <span class="drag-handle" title="Trascina">⋮⋮</span>
        <div class="home-numero-text">
          <div class="home-numero-label">${escapeHtml(c.etichetta)}</div>
          <div class="home-numero-uoc">${escapeHtml(stripPrefixNome(g.nome))}${c.sezione ? ' · ' + escapeHtml(c.sezione) : ''}</div>
        </div>
        <div class="home-numero-num">${escapeHtml(dispNum || '—')}</div>
        <button class="btn-icon-mini" onclick="removeHomeNumero('${escapeJs(c.id)}')" title="Rimuovi">✕</button>
      </div>`;
    }).join('')}</div>`;
    setTimeout(() => initHomeNumeriSortable(), 0);
  } else {
    // Vista normale: box compatto con "UOC · Sezione" inline nel titolo (risparmia spazio),
    // ma con il rendering ricco delle righe (etichetta, luogo, orari, note) come in rubrica.
    // La stella su ogni riga apre il popup fissati/preferiti.
    listHtml = renderContattiGroupedBox(items, { rich: true, clickableHeader: true });
  }

  const empty = !items.length
    ? `<div class="empty-pins" style="padding:16px;font-size:13px;">Nessun contatto fissato. Apri la rubrica, premi la stella ☆ accanto a un contatto e scegli "Contatti fissati".</div>`
    : '';

  return `<div class="home-section home-pins-group">
    <div class="home-section-title"><span>Contatti fissati</span></div>
    ${listHtml}
    ${empty}
  </div>`;
}

// Sezione "Note del giorno": todos personali rapidi, mostrati in home dopo i contatti fissati.
// Persistiti in userPrefs.note_giorno. Ogni nota = { id, testo, fatto }.
function renderNoteGiornoSection() {
  setTimeout(() => initNoteGiornoSortable(), 0);
  return `<div class="home-section home-pins-group">
    <div class="home-section-title"><span>Note del giorno</span></div>
    <div class="ndg-add" style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
      <input type="text" id="ndg-input" placeholder="Aggiungi una nota…" maxlength="240"
        onkeydown="if(event.key==='Enter'){event.preventDefault();submitNotaGiorno();}"
        style="flex:1;min-width:0;padding:10px 12px;border:1px solid var(--rule);border-radius:3px;font-size:14px;font-family:var(--serif);background:var(--bg-paper);">
      <button class="btn primary" onmousedown="event.preventDefault()" onclick="submitNotaGiorno(this)" title="Aggiungi" style="flex-shrink:0;">+ Aggiungi</button>
    </div>
    <div class="ndg-list" id="ndg-list">${_noteGiornoRowsHtml()}</div>
    <div id="ndg-clear-wrap">${_noteGiornoClearHtml()}</div>
  </div>`;
}

// HTML delle sole righe note (riusato da render iniziale e refresh surgicale).
function _noteGiornoRowsHtml() {
  const note = userPrefs.getNoteGiorno();
  return note.length
    ? note.map(n => `
        <div class="ndg-row ${n.fatto ? 'ndg-done' : ''}" data-id="${escapeHtml(n.id)}">
          <button class="ndg-check" onclick="toggleNotaGiorno('${escapeJs(n.id)}')" title="${n.fatto ? 'Segna da fare' : 'Segna fatto'}" aria-label="Completa">${n.fatto ? '☑' : '☐'}</button>
          <span class="ndg-text">${escapeHtml(n.testo)}</span>
          <button class="ndg-edit btn-icon-mini" onclick="editNotaGiorno('${escapeJs(n.id)}')" title="Modifica" aria-label="Modifica">✎</button>
          <button class="ndg-del btn-icon-mini" onclick="removeNotaGiorno('${escapeJs(n.id)}')" title="Elimina" aria-label="Elimina">✕</button>
          <span class="ndg-drag drag-handle" title="Trascina per riordinare" aria-label="Riordina">⠿</span>
        </div>`).join('')
    : `<div class="empty-pins" style="padding:14px 16px;font-size:13px;">Nessuna nota. Scrivi qui i promemoria della giornata (es. controlli, chiamate, consegne).</div>`;
}

// HTML del bottone "Pulisci fatte" (vuoto se non ci sono note completate).
function _noteGiornoClearHtml() {
  const note = userPrefs.getNoteGiorno();
  const fatte = note.filter(n => n.fatto).length;
  return fatte > 0
    ? `<div style="margin-top:8px;text-align:right;"><button class="btn ghost" style="font-size:12px;" onclick="clearNoteGiornoFatte()" title="Rimuovi le note completate">Pulisci fatte (${fatte})</button></div>`
    : '';
}

// Aggiorna SOLO la lista note + bottone "pulisci", SENZA ricostruire la home: così l'input
// #ndg-input non viene distrutto, mantenendo focus e tastiera aperta su mobile.
function refreshNoteGiornoList() {
  const list = document.getElementById('ndg-list');
  if (list) {
    // Distruggo l'eventuale istanza Sortable precedente PRIMA di riscrivere il DOM: azzerare
    // solo il riferimento (senza destroy) lasciava agganciata la vecchia istanza ai nodi
    // sostituiti, impedendo il drag dei todo appena aggiunti finché non si rientrava in pagina.
    if (list._sortable) { try { list._sortable.destroy(); } catch {} list._sortable = null; }
    list.innerHTML = _noteGiornoRowsHtml();
  }
  const clearWrap = document.getElementById('ndg-clear-wrap');
  if (clearWrap) clearWrap.innerHTML = _noteGiornoClearHtml();
  initNoteGiornoSortable();
}

// Drag&drop di riordino delle note del giorno, stesso meccanismo dei numeri in home
// (SortableJS con handle dedicato). Persisto il nuovo ordine in userPrefs.
function initNoteGiornoSortable() {
  if (typeof Sortable === 'undefined') return;
  const el = document.getElementById('ndg-list');
  if (!el || el._sortable) return;
  el._sortable = Sortable.create(el, {
    handle: '.ndg-drag',
    animation: 150,
    onEnd: () => {
      const order = Array.from(el.children).map(x => x.dataset.id).filter(Boolean);
      userPrefs.reorderNoteGiorno(order);
    }
  });
}

function submitNotaGiorno(btnEl) {
  const input = document.getElementById('ndg-input');
  if (!input) return;
  const t = input.value.trim();
  if (!t) { input.focus(); return; }
  userPrefs.addNotaGiorno(t);
  input.value = '';
  // Refresh surgicale (no renderHome): l'input resta in DOM → focus + tastiera intatti per
  // inserimenti rapidi consecutivi.
  refreshNoteGiornoList();
  input.focus();
  // Su mobile lo stato :hover resta "appiccicato" al pulsante dopo il tap finché non si tocca
  // altrove (prima il renderHome ricreava il pulsante azzerandolo). Lo rigenero clonandolo così
  // torna al colore iniziale, senza toccare l'input (focus/tastiera restano).
  if (btnEl && btnEl.parentNode) btnEl.parentNode.replaceChild(btnEl.cloneNode(true), btnEl);
}
function toggleNotaGiorno(id) {
  userPrefs.toggleNotaGiorno(id);
  refreshNoteGiornoList();
}
function editNotaGiorno(id) {
  const nota = userPrefs.getNoteGiorno().find(x => x.id === id);
  if (!nota) return;
  const row = document.querySelector(`.ndg-row[data-id="${CSS.escape(id)}"]`);
  if (!row) return;
  const textEl = row.querySelector('.ndg-text');
  if (!textEl || row.querySelector('.ndg-edit-input')) return;  // già in edit
  // Sostituisco lo span testo con una textarea precompilata col testo attuale, editabile sul
  // posto. Uso textarea (non input) così il testo va a capo e resta tutto visibile, e cresco
  // l'altezza al contenuto invece di farlo scorrere orizzontalmente.
  const input = document.createElement('textarea');
  input.className = 'ndg-edit-input';
  input.value = nota.testo;
  input.maxLength = 240;
  input.rows = 1;
  const autosize = () => { input.style.height = 'auto'; input.style.height = input.scrollHeight + 'px'; };
  let done = false;
  const finish = (salva) => {
    if (done) return;
    done = true;
    if (salva) {
      const t = input.value.trim();
      if (t && t !== nota.testo) userPrefs.updateNotaGiorno(id, t);
    }
    refreshNoteGiornoList();  // ripristina la riga normale (e re-inizializza il Sortable)
  };
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (e) => {
    // Enter salva (senza newline); Shift+Enter inserisce un a capo; Escape annulla.
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
  textEl.replaceWith(input);
  // Marca la riga in editing: il CSS nasconde X e grip così non vengono premuti per sbaglio
  // e il testo ha più spazio a destra.
  row.classList.add('ndg-row-editing');
  autosize();
  input.focus();
  input.select();
}
function removeNotaGiorno(id) {
  // Salvo la nota e la sua posizione PRIMA di rimuoverla, così "Annulla" la ripristina dov'era.
  const note = userPrefs.getNoteGiorno();
  const pos = note.findIndex(n => n.id === id);
  const nota = pos >= 0 ? { ...note[pos] } : null;
  userPrefs.removeNotaGiorno(id);
  refreshNoteGiornoList();
  if (nota && typeof toastUndo === 'function') {
    toastUndo('Nota eliminata', () => {
      userPrefs.restoreNotaGiorno(nota, pos);
      refreshNoteGiornoList();
    });
  }
}
function clearNoteGiornoFatte() {
  userPrefs.clearNoteGiornoFatte();
  refreshNoteGiornoList();
}

// Rende un singolo contatto nello STESSO stile dei risultati di ricerca globale
// (classe sr-contact: etichetta a sinistra, numeri tutti a destra, evidenziazione per kind).
// Niente stella di default. Usato in home, MdG e preferiti per uniformare la visualizzazione.
function renderContattoCard(c, opts = {}) {
  const parts = [];
  if (c.numeri) c.numeri.forEach(n => { if (n) parts.push({ value: String(n), type: 'int' }); });
  if (c.breve) parts.push({ value: String(c.breve), type: 'breve' });
  if (c.cellulare_personale) {
    const cells = Array.isArray(c.cellulare_personale) ? c.cellulare_personale : [c.cellulare_personale];
    cells.forEach(cell => parts.push({ value: String(cell), type: 'pers' }));
  }
  if (c.cellulare_aziendale) {
    const cells = Array.isArray(c.cellulare_aziendale) ? c.cellulare_aziendale : [c.cellulare_aziendale];
    cells.forEach(cell => parts.push({ value: String(cell), type: 'cell' }));
  }
  const cls = classifyContatto(c);
  const isGuardia = cls.kind === 'guardia';
  const isReparto = cls.group === 2 && !isGuardia && c.kind !== 'utile';
  const isUtile = c.kind === 'utile';
  const numChipClass = isGuardia ? 'sr-num-chip-guardia' : isReparto ? 'sr-num-chip-reparto' : isUtile ? 'sr-num-chip-utile' : 'sr-num-chip';
  const numChipsHtml = parts.length
    ? parts.map(p => {
        const prefix = p.type === 'pers' ? '<span class="sr-num-prefix">pers.</span>' : '';
        return `<span class="sr-num-chip ${numChipClass} sr-num-chip-${p.type}" onclick="event.stopPropagation();copyNumber('${escapeJs(p.value)}')">${prefix}${escapeHtml(p.value)}</span>`;
      }).join('')
    : `<span class="sr-num-chip ${numChipClass}">—</span>`;
  const ctxHtml = opts.contextLine ? `<div class="sr-contact-luogo">${escapeHtml(opts.contextLine)}</div>` : '';
  const rowCls = isGuardia ? 'sr-contact sr-contact-guardia' : isReparto ? 'sr-contact sr-contact-reparto' : isUtile ? 'sr-contact sr-contact-utile' : 'sr-contact';
  // Stella: showStar = sempre visibile; showStarInEdit = solo in edit-mode (avvolta in .edit-only)
  const star = (opts.showStar && c.id)
    ? ` <span style="display:inline-flex;align-items:center;">${renderPinButton('contatto', c.id)}</span>`
    : (opts.showStarInEdit && c.id ? ` <span class="edit-only" style="display:inline-flex;align-items:center;">${renderPinButton('contatto', c.id)}</span>` : '');
  // Pulsante rimuovi opzionale (sezioni custom in edit-mode)
  const removeBtn = opts.removeBtn || '';
  // Prefisso inline nell'etichetta (in grigio, sulla stessa riga del nome).
  const inlinePrefix = opts.inlinePrefix
    ? `<span style="color:var(--ink-muted);font-weight:400;">${escapeHtml(opts.inlinePrefix)} · </span>`
    : '';
  // Occhiello: riga piccola SOPRA l'etichetta (es. "UOC · Sezione" o solo "Sezione").
  const eyebrowHtml = opts.eyebrow
    ? `<div style="font-size:11px;color:var(--ink-muted);line-height:1.2;margin-bottom:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(opts.eyebrow)}</div>`
    : '';
  // Nome breve: se il contatto ha un "nome breve" (primo alias) e siamo in un contesto
  // dove lo spazio è poco (preferiti), lo mostro al posto dell'etichetta completa.
  // L'etichetta intera resta nel tooltip (title).
  const nomeBreve = c.nome_breve ? String(c.nome_breve).trim() : '';
  const displayName = (opts.preferBreve && nomeBreve) ? nomeBreve : c.etichetta;
  const displayTitle = (opts.preferBreve && nomeBreve) ? ` title="${escapeHtml(c.etichetta)}"` : '';
  // Maniglie di riordino opzionali (solo edit-mode), per la lista preferiti UOC.
  // opts.reorder: { onUp, onDown } stringhe di handler onclick.
  const reorderHandles = opts.reorder
    ? `<span class="edit-only" style="display:inline-flex;gap:2px;margin-right:4px;">
         <button class="reorder-btn" onclick="event.stopPropagation();${opts.reorder.onUp}" title="Sposta su" aria-label="Sposta su">↑</button>
         <button class="reorder-btn" onclick="event.stopPropagation();${opts.reorder.onDown}" title="Sposta giù" aria-label="Sposta giù">↓</button>
       </span>`
    : '';
  // onClick della card: di default apre il contatto (goToContatto). Con noNavigate la card
  // non naviga (es. card "selezionate" dentro un editor, dove il click non deve cambiare pagina).
  const cardOnClick = opts.noNavigate ? '' : ` onclick="goToContatto('${escapeJs(c.id)}')"`;
  return `<div class="${rowCls}"${cardOnClick}>
    <div class="sr-contact-left" style="display:flex;align-items:center;gap:2px;">
      ${reorderHandles}
      <div style="flex:1;min-width:0;">
        ${eyebrowHtml}
        <div class="sr-contact-label"${displayTitle}>${inlinePrefix}${escapeHtml(displayName)}${star}${removeBtn}</div>
        ${ctxHtml}
      </div>
    </div>
    <div class="sr-contact-nums">${numChipsHtml}</div>
  </div>`;
}

// Raggruppa una lista di {c, g} per UOC+sezione e li rende dentro box con header
// "UOC ridotto · Sezione" nello stile dei risultati di ricerca. Usato da home e MdG.
// opts.starInEdit: mostra la stella in edit-mode su ogni contatto.
// opts.inline: niente box-titolo; ogni contatto mostra inline "Sezione · etichetta" (preferiti).
function renderContattiGroupedBox(items, opts = {}) {
  if (!items.length) return '';
  const groups = [];
  const byKey = {};
  // In modalità inline raggruppo solo per UOC (l'UOC fa da titolo del box), e dentro ogni
  // contatto mostro la sezione come occhiello sopra l'etichetta. Altrimenti UOC+sezione.
  items.forEach(({ c, g }) => {
    const sez = (c.sezione || '').trim();
    const key = opts.inline ? g.id : (g.id + '||' + sez);
    if (!byKey[key]) {
      byKey[key] = { gNome: stripPrefixNome(g.nome), sezione: opts.inline ? '' : sez, gId: g.id, contatti: [] };
      groups.push(byKey[key]);
    }
    byKey[key].contatti.push({ c, g });
  });
  // Riordino dei box-UOC nei preferiti: applico l'ordine salvato (pin_order._uoc) e, in
  // edit-mode, mostro le frecce ↑↓ sull'intestazione di ciascun box (come le sezioni custom).
  if (opts.reorderUocBoxes) {
    const order = userPrefs.getUocOrder();
    groups.sort((a, b) => {
      const ia = order.indexOf(a.gId), ib = order.indexOf(b.gId);
      if (ia === -1 && ib === -1) return a.gNome.localeCompare(b.gNome, 'it');
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  }
  const nGroups = groups.length;
  return groups.map((grp, gi) => {
    const titleUoc = `<span class="fav-uoc-name">${escapeHtml(grp.gNome)}</span>`;
    const titleSez = grp.sezione ? `<span class="sede-bucket-sep"> · </span><span class="fav-uoc-name sede-bucket-sez">${escapeHtml(grp.sezione)}</span>` : '';
    // Frecce di riordino del box-UOC (solo in edit-mode, solo se richiesto)
    const uocReorder = (opts.reorderUocBoxes && navState.editMode)
      ? `<span class="edit-only fav-bucket-edit" style="margin-left:auto;display:inline-flex;gap:6px;" onclick="event.stopPropagation();">
          <button class="btn-icon-mini" onclick="event.stopPropagation();moveUocBox('${escapeJs(grp.gId)}',-1)" title="Sposta UOC su" ${gi === 0 ? 'disabled' : ''}>↑</button>
          <button class="btn-icon-mini" onclick="event.stopPropagation();moveUocBox('${escapeJs(grp.gId)}',1)" title="Sposta UOC giù" ${gi === nGroups - 1 ? 'disabled' : ''}>↓</button>
        </span>`
      : '';
    const rows = grp.contatti.map(({ c }, ci) => (opts.rich || opts.inline)
      ? renderNumeroRow(c, grp.gId, classifyContatto(c), {
          hideLuogo: false,
          // Vista preferiti: stessa resa dei contatti standard (etichetta + numeri + stella),
          // con la sezione come occhiello, stella sempre visibile e riordino pref_uoc.
          eyebrow: opts.inline ? ((c.sezione || '').trim() || null) : null,
          alwaysStar: !!opts.starAlways,
          pinnedView: !!opts.inline,
          preferBreve: !!opts.inline,
          reorderPrefUoc: !!opts.reorderPrefUoc,
          reorderFirst: ci === 0,
          reorderLast: ci === grp.contatti.length - 1
        })
      : renderContattoCard(c, {
          // In modalità inline (sezione UOC standard): l'UOC è nel titolo del box, la sezione
          // del contatto è l'occhiello sopra l'etichetta.
          eyebrow: opts.inline ? ((c.sezione || '').trim() || null) : null,
          showStarInEdit: !!opts.starInEdit && !opts.starAlways,
          showStar: !!opts.starAlways,
          preferBreve: !!opts.inline,
          // Riordino della lista preferiti UOC (solo se richiesto): muove dentro pref_uoc.
          reorder: opts.reorderPrefUoc ? {
            onUp: `movePrefUoc('${escapeJs(c.id)}',-1)`,
            onDown: `movePrefUoc('${escapeJs(c.id)}',1)`
          } : null
        })).join('');
    const isExpanded = !!opts.expanded;
    if (opts.clickableHeader) {
      // Vista home: niente collasso. UOC e sezione sono link separati (come nella ricerca
      // globale collassata): UOC → overview UOC; sezione → UOC con quella sezione espansa
      // (navigando sul primo contatto del gruppo, che apre la sua sezione e ci scrolla).
      const firstId = (grp.contatti[0] && grp.contatti[0].c && grp.contatti[0].c.id) || '';
      const titleUocLink = `<span class="ctx-uoc" onclick="event.stopPropagation();navigate('numeri',{filter:'${escapeJs(grp.gId)}'})" title="Apri ${escapeHtml(grp.gNome)}">${escapeHtml(grp.gNome)}</span>`;
      const titleSezLink = grp.sezione
        ? `<span class="sede-bucket-sep"> · </span><span class="ctx-sezione sede-bucket-sez" onclick="event.stopPropagation();navigate('numeri',{filter:'${escapeJs(firstId)}'})" title="Apri ${escapeHtml(grp.gNome)} con ${escapeHtml(grp.sezione)} espansa">${escapeHtml(grp.sezione)}</span>`
        : '';
      return `<div class="fav-bucket" data-uoc-id="${escapeHtml(grp.gId)}">
        <div class="fav-bucket-header fav-bucket-header-static">
          <span class="sede-bucket-tipo">${titleUocLink}${titleSezLink}</span>${uocReorder}
        </div>
        <div class="fav-bucket-contatti">${rows}</div>
      </div>`;
    }
    return `<div class="fav-bucket ${isExpanded ? '' : 'fav-bucket-collapsed'}" data-uoc-id="${escapeHtml(grp.gId)}">
      <button class="fav-bucket-header" onclick="toggleFavBucket(this)" aria-expanded="${isExpanded ? 'true' : 'false'}">
        <span class="fav-bucket-caret">${isExpanded ? '\u25BE' : '\u25B8'}</span>
        <span class="sede-bucket-tipo">${titleUoc}${titleSez}</span>${uocReorder}
      </button>
      <div class="fav-bucket-contatti">${rows}</div>
    </div>`;
  }).join('');
}

// Rende i contatti raggruppati come nella vista UOC della ricerca globale:
// gerarchia a 2 livelli — titolo UOC in alto, poi box sezione (sr-sede-bucket) con i
// relativi contatti sotto. Usato per la MdG della rubrica.
function renderUocSezioniBox(items, opts = {}) {
  if (!items.length) return '';
  // Raggruppo per UOC, poi per sezione dentro ciascuna UOC
  const uocs = [];
  const byUoc = {};
  items.forEach(({ c, g }) => {
    if (!byUoc[g.id]) {
      byUoc[g.id] = { gId: g.id, gNome: shortenUocName(g) || stripPrefixNome(g.nome), sezioni: [], _sezByKey: {} };
      uocs.push(byUoc[g.id]);
    }
    const sez = (c.sezione || '').trim();
    const u = byUoc[g.id];
    if (!u._sezByKey[sez]) {
      u._sezByKey[sez] = { sezione: sez, contatti: [] };
      u.sezioni.push(u._sezByKey[sez]);
    }
    u._sezByKey[sez].contatti.push(c);
  });
  return uocs.map(u => {
    const sezioniHtml = u.sezioni.map(s => {
      const sezLabel = s.sezione
        ? `<span class="ctx-sezione" onclick="event.stopPropagation();navigate('numeri',{filter:'${escapeJs(u.gId)}'})">${escapeHtml(s.sezione)}</span>`
        : `<span class="ctx-sezione">Numeri</span>`;
      const rows = s.contatti.map(c => renderNumeroRow(c, u.gId, classifyContatto(c), {
        // MdG: stessa resa dei contatti standard (etichetta + numeri + stella).
        // La sezione è già nel titolo del box, quindi niente occhiello qui.
        hideLuogo: false,
        alwaysStar: !!opts.starAlways,
        pinnedView: !opts.starAlways && !!opts.starInEdit
      })).join('');
      return `<div class="sr-sede-bucket">
        <div class="sr-sede-bucket-header sr-sede-bucket-static">
          <span class="sede-bucket-tipo">${sezLabel}</span>
        </div>
        <div class="sr-sede-bucket-contatti">${rows}</div>
      </div>`;
    }).join('');
    return `<div class="sr-uoc" style="margin-bottom:14px;">
      <div class="sr-uoc-title" style="cursor:pointer;" onclick="navigate('numeri',{filter:'${escapeJs(u.gId)}'})">${escapeHtml(u.gNome)}</div>
      <div class="sr-uoc-contatti">${sezioniHtml}</div>
    </div>`;
  }).join('');
}

function initHomeNumeriSortable() {
  if (typeof Sortable === 'undefined' || !navState.editMode) return;
  const el = document.getElementById('home-numeri-list');
  if (el && !el._sortable) {
    el._sortable = Sortable.create(el, {
      handle: '.drag-handle',
      animation: 150,
      onEnd: () => {
        const order = Array.from(el.children).map(x => x.dataset.cid).filter(Boolean);
        userPrefs.reorderHomeNumeri(order);
      }
    });
  }
}

// Matching contatto allineato a rubrica e ricerca globale: token significativi (≥3 char, niente
// articoli/preposizioni), sinonimi clinici, e match sul testo del contatto OPPURE del gruppo (UOC).
// Usato dalla ricerca "Contatti fissati" così si comporta come la rubrica.
const _CONTATTO_SYNONYMS = {
  'reparto': ['reparto','reparti','degenza','degenze','ricovero'],
  'reparti': ['reparto','reparti','degenza','degenze'],
  'degenza': ['reparto','reparti','degenza','degenze'],
  'degenze': ['reparto','reparti','degenza','degenze'],
  'segreteria': ['segreteria','segr'],
  'ambulatorio': ['ambulatorio','ambulatori','amb'],
  'ambulatori': ['ambulatorio','ambulatori','amb'],
  'sala operatoria': ['sala operatoria','sale operatorie','s.o.','so ','operatoria'],
  'operatoria': ['sala operatoria','sale operatorie','operatoria','so '],
  'day hospital': ['day hospital','dh ','day-hospital'],
  'dh': ['day hospital','dh ','day-hospital'],
  'mdg': ['mdg','medico di guardia','medico guardia'],
  'guardia': ['guardia','mdg','medico di guardia'],
  'ucic': ['ucic','unità coronarica','unita coronarica','terapia intensiva cardiologica'],
  'utic': ['utic','unità terapia intensiva'],
  'emodinamica': ['emodinamica','cardiologia interventistica'],
  'elettrofisiologia': ['elettrofisiologia'],
  'rianimazione': ['rianimazione','terapia intensiva'],
  'intramoenia': ['intramoenia','libera professione'],
};
const _CONTATTO_STOPWORDS = new Set(['lo','la','il','le','gli','un','di','da','in','su','al','del','dei','gl','li','ne','ci','si','se','ma','mi']);
function _contattoMatchesQuery(query, c, g) {
  const raw = (query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!raw.length) return false;
  const sig = raw.filter(t => t.length >= 3 && !_CONTATTO_STOPWORDS.has(t));
  const tokens = sig.length ? sig : raw;
  const tmatch = (tok, text) => {
    if (text.includes(tok)) return true;
    const alts = _CONTATTO_SYNONYMS[tok];
    if (alts) { for (const a of alts) if (text.includes(a)) return true; }
    return false;
  };
  const cell1 = Array.isArray(c.cellulare_personale) ? c.cellulare_personale.join(' ') : (c.cellulare_personale || '');
  const cell2 = Array.isArray(c.cellulare_aziendale) ? c.cellulare_aziendale.join(' ') : (c.cellulare_aziendale || '');
  const cTxt = [
    c.etichetta, c.sezione, c.sottosezione, c.edificio, c.piano, c.luogo,
    cell1, cell2, c.breve,
    ...((c.numeri || []).map(String)), ...(c.tag || []), c.nome_breve || ''
  ].filter(Boolean).join(' ').toLowerCase();
  const gTxt = [g && g.nome, g && (g.tag || []).join(' ')].filter(Boolean).join(' ').toLowerCase();
  return tokens.every(tok => tmatch(tok, gTxt) || tmatch(tok, cTxt));
}

function removeHomeNumero(cid) {
  if (userPrefs.hasHomeNumero(cid)) {
    userPrefs.toggleHomeNumero(cid);
    renderHome();
  }
}

function renderPinnedContattiSection(allGroups) {
  // Raccoglie tutti i contatti pinnati con il loro gruppo
  const pinnedGroups = []; // [{ gid, nome, contatti: [c1, c2...] }]
  allGroups.forEach(g => {
    const pinnedContatti = (g.contatti || []).filter(c => c.id && isPinned('contatto', c.id));
    if (pinnedContatti.length) pinnedGroups.push({ gid: g.id, nome: g.nome, contatti: pinnedContatti });
  });

  if (!pinnedGroups.length) {
    return `<div style="padding:24px 20px;background:var(--bg-sink);border:1px dashed var(--rule);border-radius:3px;text-align:center;">
      <div style="font-size:28px;color:var(--ink-faint);margin-bottom:8px;">☆</div>
      <div style="font-size:14px;color:var(--ink);margin-bottom:6px;font-weight:500;">Nessun numero preferito</div>
      <div style="font-size:12px;color:var(--ink-muted);line-height:1.5;">Apri una UOC e clicca ☆ accanto a un numero per aggiungerlo ai preferiti.</div>
    </div>`;
  }

  // Ordina UOC secondo pin_order._uoc
  const uocOrder = userPrefs.getUocOrder();
  pinnedGroups.sort((a, b) => {
    const ia = uocOrder.indexOf(a.gid);
    const ib = uocOrder.indexOf(b.gid);
    if (ia === -1 && ib === -1) return stripPrefixNome(a.nome).localeCompare(stripPrefixNome(b.nome), 'it');
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  // Ordina contatti dentro ogni UOC
  pinnedGroups.forEach(pg => {
    const order = userPrefs.getContactOrder(pg.gid);
    pg.contatti.sort((a, b) => {
      const ia = order.indexOf(a.id);
      const ib = order.indexOf(b.id);
      if (ia === -1 && ib === -1) return 0;
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  });

  const editMode = navState.editMode;
  const editHint = editMode
    ? `<div style="font-size:11px;color:var(--ink-muted);font-style:italic;margin-bottom:10px;">✋ Trascina per riordinare UOC o numeri dentro una UOC</div>`
    : '';

  const groupsHtml = pinnedGroups.map(pg => {
    const contattiHtml = pg.contatti.map(c => {
      const nums = (c.numeri || []).join(' · ');
      const persPart = c.cellulare_personale ? (Array.isArray(c.cellulare_personale) ? c.cellulare_personale : [c.cellulare_personale]).join(' · ') : '';
      const cellPart = c.cellulare_aziendale ? (Array.isArray(c.cellulare_aziendale) ? c.cellulare_aziendale : [c.cellulare_aziendale]).join(' · ') : '';
      const extra = [c.breve ? `${c.breve}` : '', persPart, cellPart].filter(Boolean).join(' · ');
      const dispNum = [nums, extra].filter(Boolean).join(' · ');
      const cls = (typeof classifyContatto === 'function') ? classifyContatto(c) : { kind: '' };
      const numCls = cls.kind === 'guardia' ? 'pinned-contatto-num-guardia'
        : cls.kind === 'reparto' ? 'pinned-contatto-num-reparto'
        : cls.kind === 'utile' ? 'pinned-contatto-num-utile'
        : '';
      return `<div class="pinned-contatto-row" data-cid="${escapeHtml(c.id)}">
        ${editMode ? '<span class="drag-handle" title="Trascina">⋮⋮</span>' : '<span class="drag-handle-spacer"></span>'}
        <span class="pinned-contatto-label" onclick="goToContatto('${escapeJs(c.id)}')">
          <span>${escapeHtml(c.etichetta)}</span>
          <span class="pinned-contatto-num ${numCls}">${escapeHtml(dispNum || '—')}</span>
        </span>
        ${renderPinButton('contatto', c.id)}
      </div>`;
    }).join('');

    return `<div class="pinned-uoc-block" data-gid="${escapeHtml(pg.gid)}">
      <div class="pinned-uoc-header">
        ${editMode ? '<span class="drag-handle drag-handle-uoc" title="Trascina UOC">⋮⋮</span>' : ''}
        <a href="#" onclick="event.preventDefault(); navigate('numeri', {filter:'${escapeJs(pg.gid)}'})" class="pinned-uoc-name">${escapeHtml(stripPrefixNome(pg.nome))}</a>
      </div>
      <div class="pinned-uoc-contatti" data-gid="${escapeHtml(pg.gid)}">${contattiHtml}</div>
    </div>`;
  }).join('');

  // Init Sortable after render (setTimeout per garantire DOM ready)
  setTimeout(() => initPinnedSortables(), 0);

  return `${editHint}<div id="pinned-uoc-list">${groupsHtml}</div>`;
}

function initPinnedSortables() {
  if (typeof Sortable === 'undefined') return;
  if (!navState.editMode) return;
  const uocList = document.getElementById('pinned-uoc-list');
  if (uocList && !uocList._sortable) {
    uocList._sortable = Sortable.create(uocList, {
      handle: '.drag-handle-uoc',
      animation: 150,
      onEnd: () => {
        const order = Array.from(uocList.children).map(el => el.dataset.gid).filter(Boolean);
        userPrefs.setUocOrder(order);
      }
    });
  }
  document.querySelectorAll('.pinned-uoc-contatti').forEach(el => {
    if (el._sortable) return;
    el._sortable = Sortable.create(el, {
      handle: '.drag-handle:not(.drag-handle-uoc)',
      animation: 150,
      onEnd: () => {
        const gid = el.dataset.gid;
        const order = Array.from(el.children).map(c => c.dataset.cid).filter(Boolean);
        userPrefs.setContactOrder(gid, order);
      }
    });
  });
}

function renderUbicazioneBadge(ub) {
  if (!ub) return '';
  const parts = [];
  if (ub.struttura) parts.push(escapeHtml(ub.struttura));
  if (ub.piano) parts.push(`${escapeHtml(ub.piano)} piano`);
  if (ub.indirizzo) parts.push(escapeHtml(ub.indirizzo));
  if (ub.ospedale_sede) parts.push(escapeHtml(ub.ospedale_sede));
  if (!parts.length) return '';
  // Badge a capo (block) sotto il nome UOC, non inline accanto.
  // Il pin 📍 prefigge il testo per identificare visivamente il luogo.
  return `<span style="display:block;font-family:var(--mono);font-size:11px;font-weight:400;color:var(--ink-muted);background:var(--rule-soft);padding:2px 6px;border-radius:3px;margin-top:4px;width:fit-content;">📍 ${parts.join(' · ')}</span>`;
}

// classifyContatto produce { group, kind }:
// - group: 1-5, usato SOLO per ordinamento dei contatti dentro una UOC/sezione.
// - kind: una di 4 etichette ('guardia', 'reparto', 'utile', 'altro'). Solo le prime 3
//   producono pillole colorate nell'UI; 'altro' è il default per tutto il resto.
//
// Le 3 categorie esplicite ('guardia', 'reparto', 'utile') corrispondono alle 3 chip del
// selettore in edit mode. L'auto-detect via regex copre solo 'guardia' e 'reparto'
// (le 2 più meccanicamente identificabili dall'etichetta). 'utile' richiede sempre
// scelta esplicita dall'utente.
//
// 'none' = scelta esplicita dell'utente di NON taggare → kind='altro', group=5 (in fondo).
//          Distinto da kind=null/undefined del DB che invece triggera l'auto-detect.
function classifyContatto(c) {
  const pendingKind = (c.id && state.pendingTagEdits && state.pendingTagEdits.has(c.id))
    ? state.pendingTagEdits.get(c.id)
    : undefined;
  const effectiveKind = pendingKind !== undefined ? pendingKind : c.kind;

  // Scelta esplicita dell'utente "senza tag": niente pillola, in fondo, niente auto-detect
  if (effectiveKind === 'none') {
    return { group: 5, kind: 'altro' };
  }
  // Kind esplicito dal DB (o pending): solo 3 valori validi che producono pillola
  if (effectiveKind === 'guardia') return { group: 1, kind: 'guardia' };
  if (effectiveKind === 'reparto') return { group: 2, kind: 'reparto' };
  if (effectiveKind === 'utile')   return { group: 2, kind: 'utile' };

  // Auto-detect (solo per contatti senza kind nel DB): identifica solo guardia e reparto.
  // Per gli altri casi (ambulatorio, segreteria, direzione) ritorno kind='altro' MA con
  // group calcolato per mantenere l'ordinamento (es. ambulatorio dopo reparto).
  // Niente pillola visibile, ma ordinamento preservato.
  // I tag NON influenzano l'evidenziazione: servono solo alla ricerca. L'auto-detect del
  // colore guarda esclusivamente l'etichetta (o la scelta esplicita dell'utente, gestita sopra).
  const sezione = (c.sezione || '').toLowerCase();
  const isGuardia = /\b(guardia|mdg|medico di guardia|reperibile)\b/i.test(c.etichetta || '');
  const isReparto = /\b(reparto|guardiola|caposala|coordinat|sala medici|sala operatoria|medici di reparto|degenz|infermier|\bdeg\b|front office|u\.?c\.?i\.?c|u\.?t\.?i\.?c|unità coronarica|terapia intensiva|subintensiva|sub-intensiva|emodinamica|elettrofisiologia|bancone|area infermieri|stud(io|i) medici)/i.test(c.etichetta || '');
  const isSegreteria = /\b(segreteria|segr\.)\b/i.test(c.etichetta || '');
  const isDirezione = /\b(direttore|studio (medico|prof|dr|dott)|scuola|didattic|universitari[oa])\b/i.test(c.etichetta || '');
  const isAmb = /\b(ambulator|amb\.|polisonno|\beco\b|rmn|\btac\b|endoscop)\b/i.test(c.etichetta || '') || sezione === 'ambulatori';

  if (isGuardia) return { group: 1, kind: 'guardia' };
  // Ambulatorio vince su reparto (es. "Coordinatore Ambulatorio") ma niente pillola
  if (isAmb && isReparto) return { group: 3, kind: 'altro' };
  if (isReparto) return { group: 2, kind: 'reparto' };
  if (isAmb) return { group: 3, kind: 'altro' };
  if (isSegreteria) return { group: 4, kind: 'altro' };
  if (isDirezione) return { group: 5, kind: 'altro' };
  return { group: 3, kind: 'altro' };
}

function sortContattiForDisplay(contatti) {
  // Sub-priorità dentro "reparto": 
  //   1 = studi medici / medici di reparto / specializzandi (vengono PRIMA)
  //   2 = caposala / coordinatore (figure di organizzazione clinica)
  //   3 = guardiola / area infermieri (numeri del bancone infermieristico — DOPO)
  //   4 = altro (sale operatorie, piastre, box, ecc.)
  const repartoSubPriority = (c) => {
    const label = (c.etichetta || '').toLowerCase();
    const tags = (c.tag || []).map(t => t.toLowerCase());
    // 1 — studi medici, specializzandi, medici di reparto
    if (/stud(io|i) medic|medici di reparto|specializz|\bdr\.|\bprof\.|dott\.|\bdottor/i.test(label)) return 1;
    // 2 — caposala e coordinatori
    if (/caposala|coordinat/i.test(label)) return 2;
    // 3 — guardiola/bancone (rilevato solo da label, tag rimosso)
    if (/guardiola|bancone/i.test(label)) return 3;
    // 4 — altro (sale operatorie, piastre, box, ecc.)
    // 5 — numeri marcati "utili": dopo il gruppo reparto, prima degli ambulatori
    if (c.kind === 'utile') return 5;
    return 4;
  };
  const withClass = contatti.map((c, idx) => ({ ...c, _classify: classifyContatto(c), _origIdx: idx }));
  withClass.sort((a, b) => {
    if (a._classify.group !== b._classify.group) return a._classify.group - b._classify.group;
    // Dentro gruppo "reparto" (2) applico sub-priorità
    if (a._classify.group === 2) {
      const subA = repartoSubPriority(a);
      const subB = repartoSubPriority(b);
      if (subA !== subB) return subA - subB;
    }
    return a._origIdx - b._origIdx;
  });
  return withClass;
}

// Raggruppa i contatti per sezione della UOC.
// Legge g.sezioni (array di {nome, tipo, edificio, piano, area, sottosezioni?}) — nuovo formato.
// Se una sezione ha `sottosezioni`, i contatti con `c.sottosezione` sono raggruppati in sub-bucket.
// Matching a 3 livelli: (1) nome esatto, (2) regex su tipo, (3) bucket dinamico.
// Ritorna array di buckets: [{ sede, sedeKey, tipo, customLabel, contatti, subBuckets? }]
function groupContattiBySede(contatti, sezioni) {
  const sedi = sezioni || [];
  if (!sedi.length) {
    // Nessuna sezione: unico bucket "Tutti"
    return [{ sede: null, sedeKey: '_all', label: null, contatti }];
  }
  // Mapping tipo sede → regex su sezione contatto.
  // Quando un contatto ha sezione che NON matcha esattamente nessuna sede della UOC,
  // si tenta il match per tipo via questa regex (fallback).
  const sedeMatchers = [
    { tipo: 'diagnostica', re: /tc\b|tac\b|\brm\b|\bmri\b|\brx\b|mammograf|ecograf|angiograf|endoscop|piastra endosc|densitometr|neurofisiolog|\beeg\b|\bemg\b|diagnostica|esami strument/i },
    { tipo: 'terapia_intensiva', re: /terapia intensiva|rianimaz|\bucic\b|\butic\b|unit[àa] coronarica|\btipo\b|\btin\b/i },
    { tipo: 'semi_intensiva',   re: /semi.?intensiva|sub.?intensiva/i },
    { tipo: 'day_hospital',     re: /day hospital|\bdh\b/i },
    // Sala operatoria assorbe ex-emodinamica e ex-elettrofisiologia
    { tipo: 'sala_operatoria',  re: /sala operator|sale operator|\bso\b|emodinamica|cardiologia intervent|elettrofisiolog/i },
    // Reparto assorbe ex-degenze e ex-riabilitazione (per riabilitazione il match va dopo ambulatori)
    { tipo: 'reparto',          re: /degenz|reparto|front office|bancone|area infermier/i },
    { tipo: 'studi_medici',     re: /stud(io|i) medic/i },
    { tipo: 'ambulatori',       re: /ambulator|\bamb\.|riabilit/i },
    { tipo: 'laboratorio',      re: /laborator/i },
    { tipo: 'segreteria_direzione', re: /segreteria|direzione|segr\.|portineria/i },
  ];
  // Crea bucket per ogni sezione. Se ha sottosezioni, pre-inizializzo i sub-bucket.
  const buckets = sedi.map((s, idx) => {
    const bucket = {
      sede: s, sedeKey: `sede_${idx}`, tipo: s.tipo,
      contatti: []
    };
    if (s.sottosezioni && s.sottosezioni.length) {
      bucket.subBuckets = s.sottosezioni.map((ss, sidx) => ({
        sede: ss, sedeKey: `sede_${idx}_sub_${sidx}`, tipo: ss.tipo,
        contatti: []
      }));
    }
    return bucket;
  });
  const altro = { sede: null, sedeKey: '_altro', tipo: null, contatti: [] };
  // Bucket dinamici: tipo_sezione → bucket (creati al volo quando una sezione non trova sede corrispondente)
  const dynamicBuckets = new Map();
  // Assegna ogni contatto al bucket migliore
  contatti.forEach(c => {
    const sezNome = (c.sezione || '').trim();
    const sezLower = sezNome.toLowerCase();
    const sottoNome = (c.sottosezione || '').trim();
    const sottoLower = sottoNome.toLowerCase();
    const et  = (c.etichetta || '').toLowerCase();
    // 1) Match per NOME esatto di sezione (nuovo formato)
    if (sezLower) {
      const nameMatch = buckets.find(b => (b.sede?.nome || '').toLowerCase() === sezLower);
      if (nameMatch) {
        // Se c'è sottosezione e il bucket ha subBuckets, cerco il match
        if (sottoLower && nameMatch.subBuckets) {
          const subMatch = nameMatch.subBuckets.find(sb => (sb.sede?.nome || '').toLowerCase() === sottoLower);
          if (subMatch) { subMatch.contatti.push(c); return; }
        }
        nameMatch.contatti.push(c);
        return;
      }
    }
    const text = sezLower + ' ' + et;
    // 2) Fallback: trova il tipo più specifico che matcha via regex
    let matchedTipo = null;
    for (const m of sedeMatchers) {
      if (m.re.test(text)) { matchedTipo = m.tipo; break; }
    }
    const bucket = matchedTipo ? buckets.find(b => b.tipo === matchedTipo) : null;
    if (bucket) { bucket.contatti.push(c); return; }
    // 3) Fallback: se il contatto ha una sezione, crea bucket dinamico
    if (sezNome) {
      const dynKey = `dyn_${sezLower.replace(/\s+/g,'_')}`;
      let dyn = dynamicBuckets.get(dynKey);
      if (!dyn) {
        dyn = {
          sede: null,
          sedeKey: dynKey,
          tipo: matchedTipo || dynKey,
          contatti: [],
          customLabel: sezNome
        };
        dynamicBuckets.set(dynKey, dyn);
      }
      dyn.contatti.push(c);
      return;
    }
    altro.contatti.push(c);
  });
  // Ritorno solo bucket non vuoti, ordinati per priorità clinica
  // (sedi cliniche/operative prima, poi supporto, poi amministrativo)
  const tipoPriority = {
    // Terapia intensiva (tipo unificato per tutte le TI: rianimazione, UCIC, UTIC, TIPO, TIN, ecc.)
    terapia_intensiva: 1, semi_intensiva: 2,
    // Sale operatorie / interventistica (assorbe ex-emodinamica, ex-elettrofisiologia)
    sala_operatoria: 7,
    // Diagnostica per immagini e strumentale (TC, RM, RX, EEG, endoscopia, ecografia, ecc.)
    diagnostica: 8,
    // Reparto unificato (assorbe ex-degenze)
    reparto: 10, day_hospital: 11,
    // Ambulatori (assorbe ex-riabilitazione) - prima di studi medici per orientamento clinico
    ambulatori: 13,
    studi_medici: 14,
    laboratorio: 25,
    // Amministrativo / servizi (priorità bassa)
    segreteria_direzione: 40,
    altro: 50,
  };
  // Sort: priorità manuale (s.priority del YAML) prima, fallback a tipoPriority del tipo
  const getBucketSort = (b) => {
    // s.priority esplicita (numerica) ha precedenza assoluta
    if (b.sede && typeof b.sede.priority === 'number') return b.sede.priority;
    // Altrimenti usa tipoPriority (mappato a range 1000+ per non collidere con priority manuali)
    return 1000 + (tipoPriority[b.tipo] || 30);
  };
  const result = buckets
    .filter(b => b.contatti.length || (b.subBuckets && b.subBuckets.some(sb => sb.contatti.length)))
    .sort((a, b) => getBucketSort(a) - getBucketSort(b));
  // Aggiungo i bucket dinamici (basati su sezione contatto) ordinati per priorità/alfabetico
  // (i dynamic buckets non hanno s.priority, quindi sempre fallback su tipoPriority)
  const dynList = [...dynamicBuckets.values()].sort((a, b) => {
    const pa = tipoPriority[a.tipo] || 30;
    const pb = tipoPriority[b.tipo] || 30;
    if (pa !== pb) return pa - pb;
    return (a.customLabel || '').localeCompare(b.customLabel || '', 'it');
  });
  dynList.forEach(d => result.push(d));
  if (altro.contatti.length) result.push(altro);
  return result;
}

// Header per bucket sede operativa (rubrica raggruppata)
// Vero se il bucket sezione contiene almeno un contatto classificato come medico di
// guardia (stesso criterio della pillola rossa MdG sulle righe: classifyContatto.kind).
// Include anche i contatti delle eventuali sottosezioni.
function bucketHasGuardia(b) {
  const check = (list) => (list || []).some(c => classifyContatto(c).kind === 'guardia');
  if (check(b.contatti)) return true;
  if (b.subBuckets && b.subBuckets.some(sb => check(sb.contatti))) return true;
  return false;
}

function renderSedeBucketHeader(s, customLabel, gruppo) {
  const tipoLabels = {
    reparto: 'Reparto', sala_operatoria: 'Sala operatoria',
    diagnostica: 'Diagnostica',
    ambulatori: 'Ambulatori', day_hospital: 'Day Hospital',
    segreteria_direzione: 'Segreteria e Direzione',
    laboratorio: 'Laboratorio',
    terapia_intensiva: 'Terapia Intensiva', semi_intensiva: 'Semi Intensiva',
    studi_medici: 'Studi Medici',
    altro: 'Altro'
  };
  // Se è un bucket dinamico (nessuna sede ma customLabel presente): mostra solo la sezione
  if (!s && customLabel) {
    // Eredita edificio dall'UOC ma omettilo nell'header (è già visibile nel contesto pagina)
    return `<span class="sede-bucket-tipo">${escapeHtml(customLabel)}</span>`;
  }
  if (!s) {
    return `<span class="sede-bucket-tipo">${escapeHtml(customLabel || '—')}</span>`;
  }
  // Priorità al campo `nome` (nuovo formato), poi tipoLabels, poi tipo raw
  const label = s.nome || tipoLabels[s.tipo] || (s.tipo || '').replace(/_/g, ' ');
  const parts = [];
  // Edificio: usa quello della sezione o, se assente, eredita dall'UOC.
  // Se l'edificio coincide con la struttura UOC (g.ubicazione.struttura), NON mostrarlo
  // nell'header bucket: è già implicito dal contesto della pagina/UOC, evita duplicazione.
  const ubStruttura = (gruppo && gruppo.ubicazione && gruppo.ubicazione.struttura) || '';
  const edif = s.edificio || ubStruttura;
  const edifIsRedundant = edif && ubStruttura && edif.toLowerCase().trim() === ubStruttura.toLowerCase().trim();
  if (edif && !edifIsRedundant) parts.push(escapeHtml(edif));
  if (s.piano) parts.push(escapeHtml(s.piano));
  // Indirizzo: se la sezione o il gruppo ne ha uno e l'edificio non è già descrittivo dell'indirizzo
  const ind = s.indirizzo || (gruppo && gruppo.ubicazione && gruppo.ubicazione.indirizzo);
  if (ind && !parts.some(p => p.includes(ind))) parts.push(escapeHtml(ind));
  const loc = parts.join(' · ');
  return `<span class="sede-bucket-tipo">${escapeHtml(label)}</span>
    ${loc ? `<span class="sede-bucket-loc">${loc}</span>` : ''}`;
}

// Collasso/espansione LOCALE di un bucket sezione nei Preferiti (sia sezioni UOC
// raggruppate sia sezioni personalizzate). Non fa re-render: agisce solo sul DOM del
// blocco premuto, aggiornando classe e caret. Stesso comportamento visivo delle UOC.
function toggleFavBucket(btn) {
  const block = btn.closest('.fav-bucket');
  if (!block) return;
  const collapsed = block.classList.toggle('fav-bucket-collapsed');
  const caret = btn.querySelector('.fav-bucket-caret');
  if (caret) caret.textContent = collapsed ? '\u25B8' : '\u25BE';
  btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
}

function toggleSedeBucket(gid, sedeKey, defaultOpen) {
  if (!state.expandedSedi) state.expandedSedi = {};
  if (!state.collapsedSedi) state.collapsedSedi = {};
  if (defaultOpen) {
    // Modalità "default aperto": il click chiude (aggiunge a collapsed) o riapre (rimuove da collapsed)
    if (!state.collapsedSedi[gid]) state.collapsedSedi[gid] = new Set();
    const set = state.collapsedSedi[gid];
    if (set.has(sedeKey)) set.delete(sedeKey);
    else set.add(sedeKey);
  } else {
    // Modalità "default chiuso": il click apre (aggiunge a expanded) o richiude (rimuove)
    if (!state.expandedSedi[gid]) state.expandedSedi[gid] = new Set();
    const set = state.expandedSedi[gid];
    if (set.has(sedeKey)) set.delete(sedeKey);
    else set.add(sedeKey);
  }
  // Re-render only this bucket area: simplest is full re-render of numeri view
  // Salvo la posizione di scroll e la ripristino dopo il render per evitare jump in cima
  const savedScroll = window.scrollY || document.documentElement.scrollTop;
  const params = state.currentParams || {};
  renderNumeri(params.filter);
  requestAnimationFrame(() => window.scrollTo({ top: savedScroll, behavior: 'instant' }));
}

// Apre la UOC filtrata con solo questo bucket espanso, scroll al bucket
function openUocWithSede(gid, sedeKey) {
  if (!state.expandedSedi) state.expandedSedi = {};
  // Collasso tutte le altre sedi di questa UOC, espando solo quella scelta
  state.expandedSedi[gid] = new Set([sedeKey]);
  // Pulisco la search globale (l'overlay ricerca si chiude da solo via click handler)
  state.rubricaSearch = '';
  _lastRenderedRubricaQuery = null;
  navigate('numeri', { filter: gid });
  // Scroll al bucket dopo il render
  requestAnimationFrame(() => {
    setTimeout(() => {
      const el = document.querySelector(`.sede-bucket[data-bucket="${sedeKey}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // Flash evidenziazione
        el.style.transition = 'background-color 0.3s';
        el.style.backgroundColor = 'rgba(43,74,111,0.08)';
        setTimeout(() => { el.style.backgroundColor = ''; }, 1200);
      }
    }, 80);
  });
}

// Sposta una sezione su (-1) o giù (+1) all'interno della sua UOC.
// Aggiorna i campi `priority` di tutte le sezioni del gruppo per riflettere il nuovo ordine
// (1, 2, 3, ... — sequenziale e rinumerato a ogni swap).
async function moveSezione(gid, sezNome, direction) {
  if (bloccaSeNonModifica('numeri')) return;
  if (!state.session || !state.session.username) {
    return toast('Login richiesto per modificare', 'warning');
  }
  const src = findNumeriSource({ groupId: gid }) || 'aopd';
  const data = { ...getNumeriDataForSource(src) };
  const gruppi = data.gruppi || [];
  const gIdx = gruppi.findIndex(g => g.id === gid);
  if (gIdx < 0) return toast('Gruppo non trovato', 'error');
  const g = gruppi[gIdx];
  const sezioni = [...(g.sezioni || [])];
  const sIdx = sezioni.findIndex(s => (s.nome || '').trim() === sezNome);
  if (sIdx < 0) return toast('Sezione non trovata', 'error');
  const targetIdx = sIdx + direction;
  if (targetIdx < 0 || targetIdx >= sezioni.length) return; // bordi
  // Swap fisico nell'array
  [sezioni[sIdx], sezioni[targetIdx]] = [sezioni[targetIdx], sezioni[sIdx]];
  // Rinumera tutte le priority sequenzialmente (1, 2, 3, ...).
  // Eventuali sezioni aggiunte successivamente senza priority verranno comunque
  // riassegnate correttamente al primo riordino.
  const newSezioni = sezioni.map((s, i) => ({ ...s, priority: i + 1 }));
  // Aggiorno il gruppo
  const newGruppi = gruppi.map((gg, i) => i === gIdx ? { ...gg, sezioni: newSezioni } : gg);
  try {
    await saveNumeriForSource(src, { ...data, gruppi: newGruppi },
      `riordina sezioni in ${g.nome}: sposta ${sezNome} ${direction < 0 ? 'su' : 'giù'}`);
    toast('Sezione spostata', 'success');
    await buildIndex();
    if (state.showExtendedNumeri?.osa) await loadExtendedNumeri('osa');
    if (state.showExtendedNumeri?.iov) await loadExtendedNumeri('iov');
    if (state.currentView === 'numeri') {
      // Re-render preservando la posizione di scroll (evita il salto in cima a ogni spostamento)
      const savedScroll = window.scrollY;
      renderNumeri((state.currentParams || {}).filter);
      requestAnimationFrame(() => window.scrollTo({ top: savedScroll, behavior: 'instant' }));
    }
  } catch (e) {
    toast('Errore: ' + e.message, 'error');
  }
}

// Sposta un contatto su/giù DENTRO la sua UOC.
// Lo spostamento avviene rispetto all'ordine VISIBILE (quello prodotto da
// sortContattiForDisplay): trovo il contatto adiacente nella vista e scambio le
// loro posizioni nell'array YAML grezzo. Nota: l'ordinamento per categoria
// (guardia/reparto/utili) ha la precedenza, quindi lo spostamento manuale opera
// dentro la stessa categoria; non si può scavalcare una categoria diversa.
async function moveContatto(gid, cid, direction) {
  if (bloccaSeNonModifica('numeri')) return;
  if (!state.session || !state.session.username) {
    return toast('Login richiesto per modificare', 'warning');
  }
  const src = findNumeriSource({ groupId: gid }) || 'aopd';
  const data = { ...getNumeriDataForSource(src) };
  const gruppi = data.gruppi || [];
  const gIdx = gruppi.findIndex(g => g.id === gid);
  if (gIdx < 0) return toast('Gruppo non trovato', 'error');
  const g = gruppi[gIdx];
  const contattiRaw = [...(g.contatti || [])];
  // Ordine visibile (stesso usato in fase di rendering)
  const visibili = sortContattiForDisplay(contattiRaw);
  const visIdx = visibili.findIndex(c => c.id === cid);
  if (visIdx < 0) return toast('Contatto non trovato', 'error');
  const targetVisIdx = visIdx + direction;
  if (targetVisIdx < 0 || targetVisIdx >= visibili.length) return; // bordi
  // Il contatto con cui scambiare la posizione (adiacente nella vista)
  const neighborId = visibili[targetVisIdx].id;
  // Trovo i due contatti nell'array grezzo e ne scambio le posizioni
  const rawIdxA = contattiRaw.findIndex(c => c.id === cid);
  const rawIdxB = contattiRaw.findIndex(c => c.id === neighborId);
  if (rawIdxA < 0 || rawIdxB < 0) return toast('Contatto non trovato', 'error');
  [contattiRaw[rawIdxA], contattiRaw[rawIdxB]] = [contattiRaw[rawIdxB], contattiRaw[rawIdxA]];
  const newGruppi = gruppi.map((gg, i) => i === gIdx ? { ...gg, contatti: contattiRaw } : gg);
  try {
    await saveNumeriForSource(src, { ...data, gruppi: newGruppi },
      `riordina contatti in ${g.nome}: sposta ${cid} ${direction < 0 ? 'su' : 'giù'}`);
    await buildIndex();
    if (state.showExtendedNumeri?.osa) await loadExtendedNumeri('osa');
    if (state.showExtendedNumeri?.iov) await loadExtendedNumeri('iov');
    if (state.currentView === 'numeri') {
      const savedScroll = window.scrollY;
      renderNumeri((state.currentParams || {}).filter);
      requestAnimationFrame(() => window.scrollTo({ top: savedScroll, behavior: 'instant' }));
    }
  } catch (e) {
    toast('Errore: ' + e.message, 'error');
  }
}

// Modifica gli alias (nomi alternativi per la ricerca) di una sezione di un gruppo.
// Le sezioni sono salvate in g.sezioni[]; se la sezione non ha ancora un oggetto
// dedicato (è solo implicita dal campo "sezione" dei contatti), lo creo.
async function editSezioneAlias(gid, sezNome) {
  if (!state.session || !state.session.username) {
    return toast('Login richiesto per modificare', 'warning');
  }
  const src = findNumeriSource({ groupId: gid }) || 'aopd';
  const data = { ...getNumeriDataForSource(src) };
  const gruppi = data.gruppi || [];
  const g = gruppi.find(x => x.id === gid);
  if (!g) return toast('Gruppo non trovato', 'error');
  const sezObj = (g.sezioni || []).find(s => (s.nome || '').trim().toLowerCase() === sezNome.trim().toLowerCase());
  const tagStr = sezObj && Array.isArray(sezObj.tag) ? sezObj.tag.join(', ') : '';
  const nContatti = (g.contatti || []).filter(ct => (ct.sezione || '').trim().toLowerCase() === sezNome.trim().toLowerCase()).length;
  const body = `
    <form onsubmit="return false;" style="display:flex;flex-direction:column;gap:12px;">
      <div class="field">
        <label>Nome sezione</label>
        <input type="text" id="se-nome" value="${escapeHtml(sezNome)}" placeholder="es. Ambulatori">
        <div style="font-size:11px;color:var(--ink-muted);margin-top:3px;">Rinominandola, i <strong>${nContatti}</strong> contatti di questa sezione verranno aggiornati automaticamente.</div>
      </div>
      <div class="field">
        <label>Tag della sezione <span style="font-weight:normal;color:var(--ink-muted);">(parole chiave per la ricerca, separate da virgola)</span></label>
        <input type="text" id="se-tag" value="${escapeHtml(tagStr)}" placeholder="es. ucic, unità coronarica">
      </div>
    </form>`;
  showModal({
    title: 'Modifica sezione',
    subtitle: `${escapeHtml(g.nome)}`,
    body,
    actions: [
      { label: 'Annulla', variant: 'ghost', onClick: () => closeModal() },
      { label: 'Salva', onClick: async () => {
        const oldNome = sezNome.trim();
        const newNome = ($('se-nome').value || '').trim();
        if (!newNome) return toast('Il nome della sezione è obbligatorio', 'warning');
        const tag = ($('se-tag').value || '').split(',').map(s => s.trim()).filter(Boolean);
        const renaming = newNome.toLowerCase() !== oldNome.toLowerCase();

        if (renaming) {
          const collision = (g.sezioni || []).some(s => s !== sezObj && (s.nome || '').trim().toLowerCase() === newNome.toLowerCase())
            || (g.contatti || []).some(ct => (ct.sezione || '').trim().toLowerCase() === newNome.toLowerCase());
          if (collision && !confirm(`Esiste già una sezione "${newNome}" in questa UOC: i contatti verranno uniti. Procedere?`)) return;
          if (!confirm(`Rinominare la sezione "${oldNome}" in "${newNome}" e aggiornare ${nContatti} contatto/i?`)) return;
        }

        // Propago il nuovo nome a tutti i contatti della sezione nel gruppo.
        const newContatti = (g.contatti || []).map(ct =>
          (ct.sezione || '').trim().toLowerCase() === oldNome.toLowerCase() ? { ...ct, sezione: newNome } : ct
        );

        // Aggiorno/creo l'oggetto sezione (nome + tag).
        let sezioni = [...(g.sezioni || [])];
        const idx = sezioni.findIndex(s => (s.nome || '').trim().toLowerCase() === oldNome.toLowerCase());
        if (idx >= 0) {
          const updated = { ...sezioni[idx], nome: newNome };
          if (tag.length) updated.tag = tag; else delete updated.tag;
          sezioni[idx] = updated;
        } else if (tag.length || renaming) {
          sezioni.push({ nome: newNome, ...(tag.length ? { tag } : {}) });
        }
        // Se il rename porta a due oggetti sezione con lo stesso nome (merge), li fondo
        // unendo alias e sottosezioni per non lasciare duplicati.
        if (renaming) {
          const seen = {};
          const merged = [];
          sezioni.forEach(s => {
            const key = (s.nome || '').trim().toLowerCase();
            if (seen[key] != null) {
              const ex = merged[seen[key]];
              const a = [...new Set([...(ex.tag || []), ...(s.tag || [])])];
              if (a.length) ex.tag = a;
              const ss = [...(ex.sottosezioni || []), ...(s.sottosezioni || [])];
              if (ss.length) ex.sottosezioni = ss;
            } else { seen[key] = merged.length; merged.push({ ...s }); }
          });
          sezioni = merged;
        }

        const newGruppi = gruppi.map(x => x.id === gid ? { ...x, sezioni, contatti: newContatti } : x);
        try {
          await saveNumeriForSource(src, { ...data, gruppi: newGruppi }, renaming ? `rinomina sezione "${oldNome}" → "${newNome}" in ${g.nome}` : `tag sezione "${oldNome}" in ${g.nome}`);
          toast(renaming ? 'Sezione rinominata' : 'Tag sezione salvato', 'success');
          closeModal();
          await buildIndex();
          if (state.showExtendedNumeri?.osa) await loadExtendedNumeri('osa');
          if (state.showExtendedNumeri?.iov) await loadExtendedNumeri('iov');
          if (state.currentView === 'numeri') navigate('numeri', state.currentParams || {});
        } catch (e) { toast('Errore: ' + e.message, 'error'); }
      } }
    ]
  });
}

function renderNumeroRow(c, gruppoId, classify, opts) {
  const hideLuogo = opts && opts.hideLuogo;
  const cls = classify || (c._classify || classifyContatto(c));
  const rowClass = cls.kind === 'guardia' ? 'numero-row numero-row-guardia'
    : cls.kind === 'reparto' ? 'numero-row numero-row-reparto'
    : cls.kind === 'utile' ? 'numero-row numero-row-utile'
    : 'numero-row';
  // Costruisco la lista di numeri: il primo va a destra come "principale",
  // gli altri vanno nella riga inferiore come pillole extra.
  // Ordine: numeri[] interni, breve, cellulare_aziendale, cellulare_personale.
  const allNums = [];
  (c.numeri || []).forEach(n => allNums.push({ value: String(n), label: String(n), kind: 'int' }));
  if (c.breve) {
    const brevi = Array.isArray(c.breve) ? c.breve : [c.breve];
    brevi.forEach(b => allNums.push({ value: String(b), label: String(b), kind: 'breve' }));
  }
  if (c.cellulare_aziendale) {
    const cells = Array.isArray(c.cellulare_aziendale) ? c.cellulare_aziendale : [c.cellulare_aziendale];
    cells.forEach(cell => allNums.push({ value: String(cell), label: String(cell), kind: 'cell_az' }));
  }
  if (c.cellulare_personale) {
    const cells = Array.isArray(c.cellulare_personale) ? c.cellulare_personale : [c.cellulare_personale];
    cells.forEach(cell => allNums.push({ value: String(cell), label: 'pers. ' + String(cell), kind: 'cell_pe' }));
  }
  const primary = allNums[0];
  const extras = allNums.slice(1);
  const primaryHtml = primary
    ? `<button class="numero-num-primary" onclick="event.stopPropagation();copyNumber('${escapeJs(primary.value)}')" title="Copia ${escapeHtml(primary.value)}">${escapeHtml(primary.label)}</button>`
    : `<span class="numero-num-primary" style="opacity:.5;color:var(--ink-muted);">—</span>`;
  const extrasHtml = extras.map(n =>
    `<button class="numero-num-extra" onclick="event.stopPropagation();copyNumber('${escapeJs(n.value)}')" title="Copia ${escapeHtml(n.value)}">${escapeHtml(n.label)}</button>`
  ).join('');
  // Meta: sede sotto (mono small)
  const luogoStr = getLuogoContatto(c);
  const luogoText = (luogoStr && !hideLuogo) ? escapeHtml(luogoStr) : '';
  const orari = c.orari ? ` · ore ${escapeHtml(c.orari)}` : '';
  const note = c.note ? `<div class="numero-note" style="font-size:11px;color:var(--ink-muted);margin-top:3px;font-style:italic;">${escapeHtml(c.note)}</div>` : '';
  const email = c.email ? `<div style="font-size:11px;color:var(--accent);font-family:var(--mono);margin-top:2px;">${escapeHtml(c.email)}</div>` : '';
  const canReorder = opts && opts.reorderable && gruppoId;
  // Riordino "preferiti UOC" (pref_uoc): usa movePrefUoc invece di moveContatto.
  const prefReorderBtns = (opts && opts.reorderPrefUoc) ? `
    <button class="btn-icon-mini" onclick="event.stopPropagation();movePrefUoc('${escapeJs(c.id)}',-1)" title="Sposta su" ${opts.reorderFirst ? 'disabled' : ''}>↑</button>
    <button class="btn-icon-mini" onclick="event.stopPropagation();movePrefUoc('${escapeJs(c.id)}',1)" title="Sposta giù" ${opts.reorderLast ? 'disabled' : ''}>↓</button>` : '';
  // Riordino generico (sezioni personalizzate): handler onclick passati esplicitamente.
  const customReorderBtns = (opts && opts.reorderCustom) ? `
    <button class="btn-icon-mini" onclick="event.stopPropagation();${opts.reorderCustom.onUp}" title="Sposta su" ${opts.reorderFirst ? 'disabled' : ''}>↑</button>
    <button class="btn-icon-mini" onclick="event.stopPropagation();${opts.reorderCustom.onDown}" title="Sposta giù" ${opts.reorderLast ? 'disabled' : ''}>↓</button>` : '';
  const reorderBtns = (prefReorderBtns || customReorderBtns || (canReorder ? `
    <button class="btn-icon-mini" onclick="event.stopPropagation();moveContatto('${escapeJs(gruppoId)}','${escapeJs(c.id)}',-1)" title="Sposta su">↑</button>
    <button class="btn-icon-mini" onclick="event.stopPropagation();moveContatto('${escapeJs(gruppoId)}','${escapeJs(c.id)}',1)" title="Sposta giù">↓</button>` : ''));
  const pinnedView = opts && opts.pinnedView;
  const editControls = c.id ? (pinnedView
    ? ` <span class="edit-only" style="display:inline-flex;gap:4px;margin-left:4px;">${reorderBtns}</span>`
    : ` <span class="edit-only" style="display:inline-flex;gap:4px;margin-left:4px;">
    ${reorderBtns}
    <button class="btn-icon-mini" onclick="event.stopPropagation();editContatto('${escapeJs(c.id)}')" title="Modifica">✎</button>
    <button class="btn-icon-mini" onclick="event.stopPropagation();deleteContatto('${escapeJs(c.id)}')" title="Elimina">🗑</button>
  </span>`) : '';
  // Kind selector (solo edit mode)
  const pendingKind = state.pendingTagEdits && state.pendingTagEdits.has(c.id)
    ? state.pendingTagEdits.get(c.id) : undefined;
  const hasPending = pendingKind !== undefined;
  const effectiveKind = hasPending ? pendingKind : c.kind;
  // currentKind = quale chip mostrare attiva. Per 'none' (scelta esplicita "no tag")
  // nessuna chip è attiva, ma mostro la label "(senza tag)" sotto.
  const currentKind = (effectiveKind === 'none') ? null : (effectiveKind || cls.kind);
  // Stato display: 'none' = utente ha esplicitamente rimosso, undefined = auto-detect attivo
  const isExplicitNone = effectiveKind === 'none';
  const isAutoDetect = effectiveKind === undefined || effectiveKind === null;
  const kindSelector = c.id ? `<div class="edit-only kind-selector" style="margin-top:4px;display:inline-flex;gap:4px;flex-wrap:wrap;align-items:center;">
    <span style="font-size:10px;color:var(--ink-muted);font-family:var(--mono);letter-spacing:.04em;">TAG:</span>
    <button class="kind-chip ${currentKind === 'guardia' ? 'active' : ''}" onclick="event.stopPropagation();setContactKind('${escapeJs(c.id)}','guardia')" title="Guardia / MdG / Reperibile" style="--chip-color:var(--danger);--chip-bg:#fef0ef;">● Guardia</button>
    <button class="kind-chip ${currentKind === 'reparto' ? 'active' : ''}" onclick="event.stopPropagation();setContactKind('${escapeJs(c.id)}','reparto')" title="Reparto/Sala/Guardiola" style="--chip-color:var(--accent);--chip-bg:var(--accent-soft);">● Reparto/Sala</button>    <button class="kind-chip ${currentKind === 'utile' ? 'active' : ''}" onclick="event.stopPropagation();setContactKind('${escapeJs(c.id)}','utile')" title="Numero utile da evidenziare" style="--chip-color:#2e7d32;--chip-bg:#e8f5e9;">● Utili</button>
  </div>` : '';
  // Click row handler
  const rowClickHandler = c.id
    ? `onclick="handleContattoRowClick('${escapeJs(c.id)}', event)" style="cursor:pointer;"`
    : '';
  const dataContattoAttr = c.id ? `data-contatto-id="${escapeHtml(c.id)}"` : '';
  // Occhiello: riga piccola SOPRA l'etichetta (es. "Sezione"). Usato nei preferiti.
  const eyebrowHtml = (opts && opts.eyebrow)
    ? `<div style="font-size:11px;color:var(--ink-muted);line-height:1.2;margin-bottom:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(opts.eyebrow)}</div>`
    : '';
  // Stella: in vista preferiti (alwaysStar) è sempre visibile come nei contatti standard;
  // in pinnedView (home) resta solo in edit-mode; altrimenti sempre.
  const starHtml = c.id
    ? ((pinnedView && !(opts && opts.alwaysStar))
        ? `<span class="edit-only" style="display:inline-flex;">${renderPinButton('contatto', c.id)}</span>`
        : renderPinButton('contatto', c.id))
    : '';
  // Sottotitolo contestuale opzionale (es. "Sezione" o "Sezione · UOC"), mostrato
  // sotto l'etichetta. Usato in vista preferiti e sezioni personalizzate.
  const ctxLine = (opts && opts.contextLine)
    ? `<div class="numero-context" style="font-size:11px;color:var(--ink-muted);margin-top:1px;">${escapeHtml(opts.contextLine)}</div>`
    : '';
  // Nome breve: nei preferiti (preferBreve) mostro il primo alias al posto dell'etichetta
  // completa, con l'etichetta intera nel tooltip. Coerente con renderContattoCard.
  const nomeBreve = c.nome_breve ? String(c.nome_breve).trim() : '';
  const displayName = (opts && opts.preferBreve && nomeBreve) ? nomeBreve : c.etichetta;
  const displayTitle = (opts && opts.preferBreve && nomeBreve) ? ` title="${escapeHtml(c.etichetta)}"` : '';
  // Riga inferiore: solo se c'è qualcosa da mostrare (sede, extras, note, email, kindSelector)
  const hasBottom = luogoText || extrasHtml;
  const bottomHtml = hasBottom
    ? `<div class="numero-row-bottom">
        ${luogoText ? `<span class="numero-luogo">${luogoText}${orari}</span>` : '<span class="numero-luogo"></span>'}
        ${extrasHtml ? `<span class="numero-extras">${extrasHtml}</span>` : ''}
      </div>`
    : (orari ? `<div class="numero-row-bottom"><span class="numero-luogo">${orari.replace(/^ · /, '')}</span></div>` : '');
  return `
    <div class="${rowClass}" ${dataContattoAttr} ${rowClickHandler}>
      ${eyebrowHtml}
      <div class="numero-row-top">
        <div class="numero-label"${displayTitle}><span class="numero-label-text">${escapeHtml(displayName)}</span>${starHtml}${editControls}</div>
        ${primaryHtml}
      </div>
      ${ctxLine}
      ${bottomHtml}
      ${email}
      ${note}
      ${kindSelector}
    </div>`;
}

async function copyNumber(n) {
  try {
    await navigator.clipboard.writeText(n);
    toast(`${n} copiato`, 'success', 1500);
  } catch {
    toast('Copia non supportata', 'warning');
  }
}
