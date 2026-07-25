/* ============================ SEARCH ============================ */
function renderTagPage(tagName) {
  if (!tagName) return navigate('home');
  const tagLower = tagName.toLowerCase();
  const matchingProcs = state.index.procedure.filter(p => (p.tag || []).some(t => t.toLowerCase() === tagLower));
  const matchingClinica = (state.index.clinica || []).filter(c => (c.tag || []).some(t => t.toLowerCase() === tagLower));
  const total = matchingProcs.length + matchingClinica.length;

  $('main-content').innerHTML = `
    <div class="page-head">
      <div class="page-eyebrow">${buildBreadcrumb([{label:'Home', route:'home'}])}Tag</div>
      <h1 class="page-title">#${escapeHtml(tagName)}</h1>
      <div style="margin-top:8px;font-size:13px;color:var(--ink-muted);">${total} sched${total === 1 ? 'a' : 'e'} con questo tag</div>
    </div>
    ${matchingProcs.length > 0 ? `
      <div class="home-section">
        <div class="home-section-title"><span>Procedure (${matchingProcs.length})</span></div>
        <div class="procedure-grid">
          ${matchingProcs.map(p => renderProcedureCard(p)).join('')}
        </div>
      </div>
    ` : ''}
    ${matchingClinica.length > 0 ? `
      <div class="home-section">
        <div class="home-section-title"><span>Clinica (${matchingClinica.length})</span></div>
        <div class="procedure-grid">
          ${matchingClinica.map(c => renderClinicaCard(c)).join('')}
        </div>
      </div>
    ` : ''}
    ${total === 0 ? `<p style="color:var(--ink-muted);padding:24px 0;">Nessuna scheda usa il tag "${escapeHtml(tagName)}".</p>` : ''}`;
}

function openSearchOverlay(query) {
  const overlay = document.getElementById('search-overlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  document.documentElement.classList.add('search-overlay-open');
  document.body.classList.add('search-overlay-open');
  renderSearchResults(query, 'search-overlay-content');
  // Tap/swipe fuori dall'input attivo → chiudi tastiera mobile (blur input).
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
  // Intercetta click sui link/risultati per chiudere l'overlay prima di navigare
  if (!overlay._searchClickBound) {
    overlay._searchClickBound = true;
    overlay.addEventListener('click', (e) => {
      const link = e.target.closest('a, [onclick*="navigate"], [onclick*="goToContatto"], [onclick*="openUocWithSede"], [data-search-result]');
      if (link) {
        setTimeout(() => { closeSearchOverlay(); }, 0);
      }
    });
  }
}
function closeSearchOverlay() {
  const overlay = document.getElementById('search-overlay');
  if (!overlay) return;
  if (overlay.classList.contains('hidden')) return;  // già chiuso, no-op
  overlay.classList.add('hidden');
  document.documentElement.classList.remove('search-overlay-open');
  document.body.classList.remove('search-overlay-open');
  overlay._savedScrollY = null;
  overlay._savedRoute = null;
}

function renderSearchResults(query, targetId) {
  const target = document.getElementById(targetId || 'main-content');
  if (!target) return;
  if (!state.fuse || !query || query.length < 2) {
    target.innerHTML = `
      <div class="page-head">
        <div class="page-eyebrow">Ricerca</div>
        <h1 class="page-title">Cerca nel manuale</h1>
      </div>
      <p style="color:var(--ink-muted);">Digita almeno 2 caratteri nella barra in alto.</p>`;
    return;
  }

  // Keyword "numero"/"numeri"/"tel"/"telefono" = filtra solo risultati rubrica, rimossa dalla query
  const numeroKeywordRegex = /\b(numer[oi]|tel|telefon[oi])\b/gi;
  const onlyNumeri = numeroKeywordRegex.test(query);
  const effectiveQuery = onlyNumeri ? query.replace(numeroKeywordRegex, ' ').replace(/\s+/g, ' ').trim() : query;
  if (onlyNumeri && effectiveQuery.length < 2) {
    target.innerHTML = `
      <div class="page-head">
        <div class="page-eyebrow">Ricerca</div>
        <h1 class="page-title">Cerca nella rubrica</h1>
      </div>
      <p style="color:var(--ink-muted);">Aggiungi almeno una parola dopo "numero" (es. "numero cardiologia", "numero amb ecg").</p>`;
    return;
  }

  const terms = effectiveQuery.trim().split(/\s+/).filter(t => t.length >= 1);
  // Numeric-only query: ricerca esatta sui numeri di contatto (no fuzzy, no partial)
  const isNumericQuery = /^\d+$/.test(effectiveQuery.trim());
  // Stopword brevi: articoli/preposizioni di 2 caratteri che nel contesto della rubrica
  // sono rumore puro. Rimosse SOLO se ci sono altri token significativi (>=3 chars);
  // se la query è interamente composta da token corti, li manteniamo tutti.
  const STOPWORDS_2 = new Set(['lo','la','il','le','gli','un','di','da','in','su','al','del','dei','gl','li','ne','ci','si','se','ma','mi']);
  const significantTerms = terms.filter(t => t.length >= 3 && !STOPWORDS_2.has(t.toLowerCase()));
  const filteredTerms = significantTerms.length > 0 ? significantTerms : terms;
  let rawResults;
  if (isNumericQuery) {
    // Match esatto: il contatto deve contenere esattamente quel numero come token intero
    const target = effectiveQuery.trim();
    rawResults = [];
    getVisibleNumeriGroups().forEach(g => {
      (g.contatti || []).forEach(c => {
        const cellsPers = Array.isArray(c.cellulare_personale) ? c.cellulare_personale.map(String) : (c.cellulare_personale ? [String(c.cellulare_personale)] : []);
        const cellsPub = Array.isArray(c.cellulare_aziendale) ? c.cellulare_aziendale.map(String) : (c.cellulare_aziendale ? [String(c.cellulare_aziendale)] : []);
        const nums = [...(c.numeri || []).map(String), ...cellsPers, ...cellsPub, String(c.breve || '')].filter(Boolean);
        const exactMatch = nums.some(n => n === target);
        if (exactMatch) {
          const item = {
            type: 'numero', slug: c.id,
            titolo: c.etichetta, gruppo: g.nome, gruppoId: g.id,
            direttore: g.direttore || '',
            sede: '',
            numeri: nums.join(' '),
            ospedale: g._source || 'aopd',
            sezione: c.sezione || '',
            tag: (c.tag || []).join(' ')
          };
          rawResults.push({ item, score: 0, matches: [] });
        }
      });
    });
  } else if (filteredTerms.length > 1) {
    const extendedQuery = filteredTerms
      .filter(t => t.length >= 1)
      .map(t => t.length <= 2 ? `^${t}` : `'${t}`)
      .join(' ');
    rawResults = state.fuse.search(extendedQuery);
    if (rawResults.length < 3) {
      const allInclude = filteredTerms.filter(t => t.length >= 2).map(t => `'${t}`).join(' ');
      if (allInclude) {
        const fallback = state.fuse.search(allInclude);
        if (fallback.length > rawResults.length) rawResults = fallback;
      }
    }
    if (rawResults.length < 3) rawResults = state.fuse.search(filteredTerms.join(' '));
  } else {
    rawResults = state.fuse.search(filteredTerms.length > 0 ? filteredTerms.join(' ') : effectiveQuery);
  }

  let nonNumeri = onlyNumeri ? [] : rawResults.filter(r => r.item.type !== 'numero').slice(0, 20);
  const numeriRaw = rawResults.filter(r => r.item.type === 'numero');

  const lowerQuery = effectiveQuery.toLowerCase();
  const queryTerms = filteredTerms.map(t => t.toLowerCase());
  const wantsGuardia = /\b(guardia|mdg|reperibile)\b/i.test(effectiveQuery);

  // Sinonimi multi-token (allineati alla ricerca rubrica)
  const synonyms = {
    'reparto': ['reparto', 'reparti', 'degenza', 'degenze', 'ricovero'],
    'reparti': ['reparto', 'reparti', 'degenza', 'degenze'],
    'degenza': ['reparto', 'reparti', 'degenza', 'degenze'],
    'degenze': ['reparto', 'reparti', 'degenza', 'degenze'],
    'segreteria': ['segreteria', 'segr'],
    'ambulatorio': ['ambulatorio', 'ambulatori', 'amb'],
    'ambulatori': ['ambulatorio', 'ambulatori', 'amb'],
    'sala operatoria': ['sala operatoria', 'sale operatorie', 's.o.', 'operatoria'],
    'operatoria': ['sala operatoria', 'sale operatorie', 'operatoria'],
    'day hospital': ['day hospital', 'dh', 'day-hospital'],
    'dh': ['day hospital', 'dh', 'day-hospital'],
    'mdg': ['mdg', 'medico di guardia', 'medico guardia'],
    'guardia': ['guardia', 'mdg', 'medico di guardia'],
    'ucic': ['ucic', 'unità coronarica', 'unita coronarica', 'terapia intensiva cardiologica'],
    'utic': ['utic', 'unità terapia intensiva'],
    'emodinamica': ['emodinamica', 'cardiologia interventistica'],
    'elettrofisiologia': ['elettrofisiologia'],
    'rianimazione': ['rianimazione', 'terapia intensiva'],
    'intramoenia': ['intramoenia', 'libera professione'],
  };
  const tokenMatches = (token, text) => {
    if (text.includes(token)) return true;
    // Match con spazi/trattini rimossi: "neuroanestesia" matcha "Neuro anestesia",
    // "stroke unit" matcha "Stroke-unit", ecc. Confronta entrambi nelle versioni
    // "compatte" (senza separatori) per gestire concatenazioni o rimozioni di spazi.
    const compactToken = token.replace(/[\s\-_.]+/g, '');
    if (compactToken !== token) {
      const compactText = text.replace(/[\s\-_.]+/g, '');
      if (compactText.includes(compactToken)) return true;
    } else {
      // Anche se il token NON ha separatori, il testo potrebbe averli: confronta col testo compatto.
      const compactText = text.replace(/[\s\-_.]+/g, '');
      if (compactText.includes(token)) return true;
    }
    const alts = synonyms[token];
    if (alts) {
      for (const alt of alts) {
        if (text.includes(alt)) return true;
        const compactAlt = alt.replace(/[\s\-_.]+/g, '');
        const compactText = text.replace(/[\s\-_.]+/g, '');
        if (compactText.includes(compactAlt)) return true;
      }
    }
    return false;
  };

  // Espandi i risultati numeri: se il gruppo (nome) matcha TUTTI i token della query,
  // includi tutti i contatti del gruppo (anche quelli che non matchano direttamente).
  // Questo replica il comportamento della ricerca Rubrica.
  //
  // FILTRO STRICT: Fuse produce molti falsi positivi con fuzzy matching. Per query multi-token,
  // tengo solo i contatti dove OGNI token della query matcha (direttamente o via sinonimi)
  // nel testo del contatto OPPURE nel testo del gruppo.
  const contactText = (item) => [
    item.titolo, item.gruppo, item.direttore, item.sede, item.numeri, item.tag, item.termini
  ].filter(Boolean).join(' ').toLowerCase();
  const allTokensMatch = (text, groupText) => {
    return queryTerms.every(t => tokenMatches(t, text) || tokenMatches(t, groupText));
  };

  // FILTRO STRICT documenti: Fuse (fuzzy) produce falsi positivi — es. cercare "menz" che
  // matcha il corpo di schede non pertinenti. Tengo solo i documenti dove OGNI token
  // significativo della query compare davvero nel testo (titolo + tag + termini + corpo).
  if (queryTerms.length >= 1 && !isNumericQuery) {
    nonNumeri = nonNumeri.filter(r => {
      const it = r.item;
      const docText = [it.titolo, it.tag, it.termini, it.body].filter(Boolean).join(' ').toLowerCase();
      return queryTerms.every(t => tokenMatches(t, docText));
    });
  }

  const matchedGroupIds = new Set();
  const byGruppo = new Map();
  numeriRaw.forEach(r => {
    const gid = r.item.gruppoId;
    // Filtro stretto: ogni token della query deve matchare nel contatto o nel gruppo
    // MA almeno un token deve matchare direttamente nel testo del contatto (evita di
    // includere tutti i contatti di un gruppo solo perché il nome gruppo matcha qualche token).
    if (queryTerms.length >= 1 && !isNumericQuery) {
      const ctxt = contactText(r.item);
      const gtxt = (r.item.gruppo + ' ' + (r.item.keywords || '')).toLowerCase();
      if (!allTokensMatch(ctxt, gtxt)) return;
      // Almeno un token deve essere presente nel contatto stesso (non solo nel gruppo)
      const anyTokenInContact = queryTerms.some(t => tokenMatches(t, ctxt));
      if (!anyTokenInContact) return;
    }
    if (!byGruppo.has(gid)) {
      byGruppo.set(gid, {
        gruppoId: gid,
        gruppo: r.item.gruppo,
        ospedale: r.item.ospedale,
        direttore: r.item.direttore,
        sede: r.item.sede,
        contatti: [],
        bestScore: 1
      });
    }
    const g = byGruppo.get(gid);
    g.contatti.push(r);
    if (r.score < g.bestScore) g.bestScore = r.score;
  });

  // Aggiungo gruppi il cui NOME/direttore/alias matcha interamente la query (no sezioni tipo,
  // che è troppo specifico: "ucic" non deve espandere tutta la Cardiologia)
  const allGroupsForSearch = getVisibleNumeriGroups().filter(g => (g._source || 'aopd') === 'aopd');
  // Helper: vero se la query matcha interamente il nome/alias di una sezione del gruppo.
  // Usato per espandere il gruppo quando l'utente cerca una sezione (es. "piastra operatoria
  // gallucci"): la sezione corrispondente esiste in Cardiochirurgia → render espanso, non
  // collassato. Senza questo, cercare un nome di sezione produrrebbe solo box "UOC · Sezione"
  // collassati invece dell'header UOC con la sezione dentro.
  const groupHasMatchingSezione = (g) => {
    const sezioni = g.sezioni || [];
    return sezioni.some(s => {
      const sezText = [s.nome, Array.isArray(s.tag) ? s.tag.join(' ') : (s.tag || '')]
        .filter(Boolean).join(' ').toLowerCase();
      if (!sezText) return false;
      return queryTerms.every(t => tokenMatches(t, sezText));
    });
  };
  allGroupsForSearch.forEach(g => {
    const nameAlias = [g.nome, (g.tag || []).join(' ')].filter(Boolean).join(' ').toLowerCase();
    const groupMatches = queryTerms.every(t => tokenMatches(t, nameAlias));
    // Match parziale: almeno un token matcha il nome E gli altri matchano almeno un contatto
    // Esempio: "degenze cardiol" → "cardiol" matcha il nome, "degenze" matcha alcuni contatti
    const tokensInName = queryTerms.filter(t => tokenMatches(t, nameAlias));
    const tokensNotInName = queryTerms.filter(t => !tokenMatches(t, nameAlias));
    let partialGroupMatch = false;
    if (!groupMatches && tokensInName.length > 0 && tokensNotInName.length > 0) {
      // Controllo: esiste almeno un contatto che matcha TUTTI i token rimanenti?
      partialGroupMatch = (g.contatti || []).some(c => {
        const tagsStr = Array.isArray(c.tag) ? c.tag.join(' ') : (c.tag || '');
        const nbStr = c.nome_breve || '';
        const ctxt = [c.etichetta, c.sezione, c.sottosezione, c.edificio, c.piano, c.luogo, tagsStr, nbStr].filter(Boolean).join(' ').toLowerCase();
        return tokensNotInName.every(t => tokenMatches(t, ctxt));
      });
    }
    // Match su sezione: cercare il nome di una sezione (anche se non matcha il nome UOC)
    // espande comunque il gruppo. Esempio: "piastra operatoria gallucci" → UOC Cardiochirurgia
    // espansa con la Piastra dentro, non box collassato isolato.
    const sezioneMatches = queryTerms.length >= 1 && !isNumericQuery && groupHasMatchingSezione(g);
    if (groupMatches || partialGroupMatch || sezioneMatches) {
      matchedGroupIds.add(g.id);
      if (!byGruppo.has(g.id)) {
        byGruppo.set(g.id, {
          gruppoId: g.id,
          gruppo: g.nome,
          ospedale: g._source || 'aopd',
          direttore: g.direttore || '',
          sede: '',
          contatti: [],
          bestScore: 0.1
        });
      } else {
        const existing = byGruppo.get(g.id);
        if (existing.bestScore > 0.1) existing.bestScore = 0.1;
      }
    }
  });

  const getFullGroup = (gid) => {
    for (const g of allGroupsForSearch) {
      if (g.id === gid) return g;
    }
    return null;
  };

  const uocResults = Array.from(byGruppo.values()).map(u => {
    const full = getFullGroup(u.gruppoId);
    const allContatti = full ? (full.contatti || []) : u.contatti.map(r => r.item);
    const matchedIds = new Set(u.contatti.map(r => r.item.slug));
    const groupFullyMatched = matchedGroupIds.has(u.gruppoId);

    // Riuso la classifyContatto globale per coerenza con la rubrica
    const classifyContact = (c) => {
      const cls = classifyContatto(c);
      return { group: cls.group, isGuardia: cls.kind === 'guardia' };
    };

    const contatti = allContatti.map(c => {
      const label = (c.etichetta || '').toLowerCase();
      const tags = (c.tag || []).join(' ').toLowerCase();
      const cls = classifyContact(c);
      const matched = matchedIds.has(c.id);
      // Sub-priorità dentro "reparto" (allineata alla rubrica)
      let repSub = 4;
      if (cls.group === 2) {
        const tagsArr = (c.tag || []).map(t => t.toLowerCase());
        if (/stud(io|i) medic|medici di reparto|specializz|\bdr\.|\bprof\.|dott\.|\bdottor/i.test(label)) repSub = 1;
        else if (/caposala|coordinat/i.test(label)) repSub = 2;
        else if (/guardiola|bancone/i.test(label)) repSub = 3;
        else if (c.kind === 'utile') repSub = 5;
      }
      let relevance = 0;
      if (matched) relevance += 10;
      if (cls.isGuardia && wantsGuardia) relevance += 20;
      if (cls.isGuardia) relevance += 3;
      queryTerms.forEach(t => {
        if (label.includes(t)) relevance += 5;
        if (tags.includes(t)) relevance += 3;
      });
      return { ...c, _isGuardia: cls.isGuardia, _group: cls.group, _repSub: repSub, _matched: matched, _relevance: relevance };
    });

    // Ordinamento:
    // - Se il gruppo matcha pienamente la query (es. "cardio" → Cardiologia): uso l'ordine rubrica
    //   (group -> sub-priorità reparto -> ordine YAML originale), identico a quello mostrato aprendo la UOC
    // - Altrimenti: ordine per rilevanza (contatti che matchano meglio la query in cima)
    // Tag boost: contatti con kind esplicito (guardia/reparto/utile) più in alto a parità di match
    const tagBoost = (c) => {
      if (c.kind === 'guardia' || c._isGuardia) return 3;
      if (c.kind === 'reparto') return 2;
      if (c.kind === 'utile') return 1;
      return 0;
    };
    if (groupFullyMatched) {
      const origIdx = new Map(allContatti.map((c, i) => [c.id, i]));
      contatti.sort((a, b) => {
        if (a._group !== b._group) return a._group - b._group;
        if (a._group === 2 && a._repSub !== b._repSub) return a._repSub - b._repSub;
        return (origIdx.get(a.id) ?? 0) - (origIdx.get(b.id) ?? 0);
      });
    } else {
      contatti.sort((a, b) => {
        // Contatti con tag esplicito vengono sempre prima
        const tb = tagBoost(b) - tagBoost(a);
        if (tb !== 0) return tb;
        if (a._group !== b._group) return a._group - b._group;
        if (a._group === 2 && a._repSub !== b._repSub) return a._repSub - b._repSub;
        return b._relevance - a._relevance;
      });
    }
    const hasMatchedGuardia = contatti.some(c => c._isGuardia && c._matched);
    const hasTaggedMatched = contatti.some(c => c._matched && (c.kind === 'utile' || c.kind === 'reparto' || c.kind === 'guardia'));
    // Boost forte se un contatto del gruppo ha un match ESATTO di parola intera nell'etichetta
    // (es. query "eeg" → "Ambulatorio EEG"). Senza questo, un match diretto e specifico può
    // finire sotto a UOC che matchano la query solo via alias di tipo-sezione o fuzzy.
    const wordBoundaryHit = contatti.some(c => {
      const label = (c.etichetta || '').toLowerCase();
      return queryTerms.some(t => {
        if (t.length < 2) return false;
        const re = new RegExp('(^|[^a-z0-9àèéìòù])' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9àèéìòù])', 'i');
        return re.test(label);
      });
    });
    const scoreAdjusted = u.bestScore
      - (hasMatchedGuardia ? 0.2 : 0)
      - (wantsGuardia && hasMatchedGuardia ? 0.15 : 0)
      - (hasTaggedMatched ? 0.25 : 0)
      - (wordBoundaryHit ? 0.4 : 0);

    return {
      ...u,
      contatti,
      scoreAdjusted,
      hasMatchedGuardia,
      totalContatti: allContatti.length,
      matchedCount: matchedIds.size,
      fullGroup: full
    };
  });

  uocResults.sort((a, b) => {
    if (wantsGuardia) {
      if (a.hasMatchedGuardia !== b.hasMatchedGuardia) return a.hasMatchedGuardia ? -1 : 1;
    }
    return a.scoreAdjusted - b.scoreAdjusted;
  });

  const osp = { aopd: 'AOPD', osa: 'OSA', iov: 'IOV' };

  // Chip inline per modificare il TAG direttamente dai risultati ricerca.
  // Attivi solo in modalità modifica. Le modifiche vanno in pendingTagEdits e
  // si applicano con "Salva modifiche" / "Annulla modifiche".
  const renderInlineTagChips = (c) => {
    if (!c.id) return '';
    const pending = state.pendingTagEdits && state.pendingTagEdits.has(c.id);
    const effective = pending ? state.pendingTagEdits.get(c.id) : (c.kind || null);
    // 'none' = scelta esplicita "no tag" (no auto-detect): nessuna chip attiva, mostro label.
    const k = effective === 'none' ? null : effective;
    const isExplicitNone = effective === 'none';
    const isAutoDetect = effective === null || effective === undefined;
    const tooltips = {
      guardia: 'Guardia / MdG / Reperibile',
      reparto: 'Reparto/Sala/Guardiola',
      utile: 'Numero utile da evidenziare'
    };
    const mk = (value, label, bg, color) =>
      `<button class="kind-chip ${k === value ? 'active' : ''}" onclick="event.stopPropagation(); setContactKind('${escapeJs(c.id)}','${value}')" title="${tooltips[value]}" style="--chip-color:${color};--chip-bg:${bg};">${label}</button>`;
    return `<div class="edit-only kind-selector" style="margin-top:4px;display:inline-flex;gap:4px;flex-wrap:wrap;align-items:center;" onclick="event.stopPropagation();">
      <span style="font-size:10px;color:var(--ink-muted);font-family:var(--mono);letter-spacing:.04em;">TAG:</span>
      ${mk('guardia', '● Guardia', '#fef0ef', 'var(--danger)')}
      ${mk('reparto', '● Reparto/Sala', 'var(--accent-soft)', 'var(--accent)')}
      ${mk('utile',   '● Utili',   '#e8f5e9', '#2e7d32')}
    </div>`;
  };

  const renderContatto = (c, opts = {}) => {
    // parts: array di {value, type} dove type∈{int,breve,pers,cell}.
    // Usato per render con prefisso 'pers.' visibile sui cellulari personali.
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
    const tagsLower = (c.tag || []).map(t => t.toLowerCase());
    const isGuardia = c._isGuardia;
    const isReparto = c._group === 2 && !isGuardia && c.kind !== 'utile';
    const isUtile = c.kind === 'utile';
    const luogoStr = getLuogoContatto(c);
    const luogoHtml = (luogoStr && !opts.hideLuogo) ? `<div class="sr-contact-luogo">📍 ${escapeHtml(luogoStr)}</div>` : '';
    const sezioneHtml = (c.sezione && !opts.hideSedeMeta) ? `<span class="sr-contact-sezione">· ${escapeHtml(c.sezione)}</span>` : '';
    const tagChips = renderInlineTagChips(c);
    const labelHtml = `${escapeHtml(c.etichetta)}${sezioneHtml}`;
    const numChipClass = isGuardia ? 'sr-num-chip-guardia' : isReparto ? 'sr-num-chip-reparto' : isUtile ? 'sr-num-chip-utile' : 'sr-num-chip';
    const numChipsHtml = parts.length
      ? parts.map(p => {
          // Prefisso "pers." per numeri personali (per distinguerli dai brevi). I numeri brevi
          // non hanno prefisso: il loro formato (3-4 cifre) è già autoevidente per gli utenti.
          const prefix = p.type === 'pers' ? '<span class="sr-num-prefix">pers.</span>' : '';
          return `<span class="sr-num-chip ${numChipClass} sr-num-chip-${p.type}">${prefix}${escapeHtml(p.value)}</span>`;
        }).join('')
      : `<span class="sr-num-chip ${numChipClass}">—</span>`;

    if (isGuardia) {
      return `<div class="sr-contact sr-contact-guardia" onclick="goToContatto('${escapeJs(c.id)}')">
        <div class="sr-contact-left">
          <div class="sr-contact-label">${labelHtml}</div>
          ${luogoHtml}
          ${tagChips}
        </div>
        <div class="sr-contact-nums">${numChipsHtml}</div>
      </div>`;
    }
    if (isUtile) {
      return `<div class="sr-contact sr-contact-utile" onclick="goToContatto('${escapeJs(c.id)}')">
        <div class="sr-contact-left">
          <div class="sr-contact-label">${labelHtml}</div>
          ${luogoHtml}
          ${tagChips}
        </div>
        <div class="sr-contact-nums">${numChipsHtml}</div>
      </div>`;
    }
    if (isReparto) {
      return `<div class="sr-contact sr-contact-reparto" onclick="goToContatto('${escapeJs(c.id)}')">
        <div class="sr-contact-left">
          <div class="sr-contact-label">${labelHtml}</div>
          ${luogoHtml}
          ${tagChips}
        </div>
        <div class="sr-contact-nums">${numChipsHtml}</div>
      </div>`;
    }
    return `<div class="sr-contact" onclick="goToContatto('${escapeJs(c.id)}')">
      <div class="sr-contact-left">
        <div class="sr-contact-label">${labelHtml}</div>
        ${luogoHtml}
        ${tagChips}
      </div>
      <div class="sr-contact-nums">${numChipsHtml}</div>
    </div>`;
  };

  // Mostro i badge ospedale solo se almeno OSA o IOV sono abilitati (altrimenti è sempre AOPD)
  const anyExtendedOn = !!(state.showExtendedNumeri && (state.showExtendedNumeri.osa || state.showExtendedNumeri.iov));

  const renderUoc = (u) => {
    const groupFullyMatched = matchedGroupIds.has(u.gruppoId);
    // Se il gruppo matcha il nome (es. "cardiologia"), ma ci sono altri token
    // (es. "reparto"), mostro solo i contatti che matchano anche quei token.
    // Questo evita che lo slice(0,12) riempia un solo bucket (es. Emodinamica).
    // Helper: contatto ha tag salvato (kind: guardia/reparto/utile)?
    const hasExplicitTag = (c) => {
      const k = c && c.kind;
      return k === 'guardia' || k === 'reparto' || k === 'utile';
    };
    // Helper: ordine "priority" interno alla sezione (group 1=guardia, 2=reparto, 4=altri, 5=utili).
    // Per i contatti senza tag, usa ordine YAML (_origIdx implicito = posizione in u.contatti).
    let topContatti;
    if (groupFullyMatched) {
      // Token che NON sono già nel nome del gruppo (es. "cardiologia reparto" → token extra "reparto")
      const gName = (u.gruppo || '').toLowerCase();
      const extraTokens = queryTerms.filter(t => !tokenMatches(t, gName));
      if (extraTokens.length > 0) {
        // Filtra contatti che matchano i token extra in qualunque campo
        const filtered = u.contatti.filter(c => {
          const tagsStr = Array.isArray(c.tag) ? c.tag.join(' ') : (c.tag || '');
          const nbStr = c.nome_breve || '';
          const ctxt = [c.etichetta, c.sezione, c.sottosezione, c.edificio, c.piano, c.luogo, tagsStr, nbStr].filter(Boolean).join(' ').toLowerCase();
          return extraTokens.every(t => tokenMatches(t, ctxt));
        });
        topContatti = filtered.length > 0 ? filtered.slice(0, 30) : u.contatti.filter(hasExplicitTag);
      } else {
        // Match solo per nome UOC (es. "cardiologia"): mostro SOLO i contatti con tag
        // (manuale o auto-detect) di tutte le sezioni.
        const tagged = u.contatti.filter(hasExplicitTag);
        topContatti = tagged.length > 0 ? tagged : u.contatti.slice(0, 12);
      }
    } else {
      // Non-full-match: cerco se la query matcha il NOME di una sezione/sottosezione.
      const matchedSectionNames = new Set();
      const sezioni = (u.fullGroup && u.fullGroup.sezioni) || [];
      sezioni.forEach(s => {
        if (!s || !s.nome) return;
        const sName = s.nome.toLowerCase();
        if (queryTerms.every(t => sName.includes(t) || tokenMatches(t, sName))) matchedSectionNames.add(s.nome);
        (s.sottosezioni || []).forEach(ss => {
          if (!ss || !ss.nome) return;
          const ssName = ss.nome.toLowerCase();
          if (queryTerms.every(t => ssName.includes(t) || tokenMatches(t, ssName))) matchedSectionNames.add(ss.nome);
        });
      });
      if (matchedSectionNames.size > 0) {
        // Match per nome sezione (es. "stroke" → sezione "Stroke Unit"):
        // mostro contatti con tag della sezione + altri 5 in ordine YAML/priority.
        const sectionContatti = u.contatti.filter(c => matchedSectionNames.has(c.sezione) || matchedSectionNames.has(c.sottosezione));
        const sectionTagged = sectionContatti.filter(hasExplicitTag);
        const sectionUntagged = sectionContatti.filter(c => !hasExplicitTag(c));
        // Unisci: tutti i taggati + 5 non-taggati nell'ordine in cui appaiono in YAML
        topContatti = [...sectionTagged, ...sectionUntagged.slice(0, 5)];
      } else {
        // Match solo per contatti individuali: mostra i contatti matched (max 6)
        topContatti = u.contatti.filter(c => c._matched).slice(0, 6);
      }
    }
    const restCount = u.totalContatti - topContatti.length;
    const showOspBadge = anyExtendedOn || u.ospedale !== 'aopd';
    const ospBadge = showOspBadge
      ? `<span class="sr-uoc-badge sr-uoc-badge-${u.ospedale}">${osp[u.ospedale] || u.ospedale.toUpperCase()}</span>`
      : '';
    // L'elenco delle sedi di tutte le sezioni nell'header gruppo è ridondante quando ogni
    // bucket sezione sotto già mostra la propria sede. Rimosso.
    const sedeHtml = '';
    // Layout collassato: quando il match è per contatto/sezione (non per nome UOC),
    // niente header UOC + bucket header tipo "UOC ridotta · Sezione" non espandibile.
    const isCollapsed = !groupFullyMatched;
    // Raggruppo topContatti per sede operativa usando groupContattiBySede.
    // Ogni bucket ha un header con il nome della sede + luogo.
    let contattiHtml = '';
    if (u.fullGroup && typeof groupContattiBySede === 'function') {
      const buckets = groupContattiBySede(topContatti, u.fullGroup.sezioni);
      contattiHtml = buckets.map(b => {
        const sedeLoc = b.sede
          ? [b.sede.edificio, b.sede.piano].filter(Boolean).join(' ')
          : '';
        const sedeLocLower = sedeLoc.toLowerCase().trim();
        // Appiattisci contatti diretti + quelli delle sottosezioni (subBuckets).
        // Necessario perché bucket come "Emodinamica" hanno sottosezioni (Sala, Studi Medici,
        // Segreteria) e i contatti finiscono nei subBuckets, non in b.contatti diretto.
        const allBucketContatti = [
          ...b.contatti,
          ...((b.subBuckets || []).flatMap(sb => sb.contatti || []))
        ];
        const contattiItems = allBucketContatti.map(c => {
          const cLuogo = getLuogoContatto(c).toLowerCase().trim();
          const hide = sedeLocLower && cLuogo && (cLuogo === sedeLocLower || cLuogo.includes(sedeLocLower) || sedeLocLower.includes(cLuogo));
          return renderContatto(c, { hideLuogo: hide, hideSedeMeta: !!b.sede });
        }).join('');
        if (isCollapsed) {
          // Layout collassato: rettangolo con header "UOC · Sezione · Edificio Piano" + contatti dentro.
          // L'edificio della sezione viene ereditato dalla UOC se la sezione non lo specifica
          // (coerente con groupContattiBySede). Piano sempre solo della sezione.
          const uocShort = shortenUocName(u.fullGroup);
          const sezioneLabel = bucketSezioneLabel(b);
          const ubStruttura = (u.fullGroup && u.fullGroup.ubicazione && u.fullGroup.ubicazione.struttura) || '';
          const sezEdif = (b.sede && b.sede.edificio) || ubStruttura || '';
          const sezPiano = (b.sede && b.sede.piano) || '';
          const bucketLoc = [sezEdif, sezPiano].filter(Boolean).join(' · ');
          return `<div class="sr-sede-bucket">
            <div class="sr-sede-bucket-header sr-sede-bucket-static">
              <span class="sede-bucket-tipo">
                <span class="ctx-uoc" onclick="event.stopPropagation();navigate('numeri',{filter:'${escapeJs(u.gruppoId)}'})" title="Apri ${escapeHtml(u.gruppo)}">${escapeHtml(uocShort)}</span><span class="sede-bucket-sep"> · </span><span class="ctx-sezione" onclick="event.stopPropagation();openUocWithSede('${escapeJs(u.gruppoId)}','${escapeJs(b.sedeKey)}')" title="Apri ${escapeHtml(u.gruppo)} con ${escapeHtml(sezioneLabel)} espansa">${escapeHtml(sezioneLabel)}</span>${bucketLoc ? `<span class="sr-bucket-loc">${escapeHtml(bucketLoc)}</span>` : ''}
              </span>
            </div>
            <div class="sr-sede-bucket-contatti">${contattiItems}</div>
          </div>`;
        }
        if (b.sede) {
          const headerInner = renderSedeBucketHeader(b.sede, null, u.fullGroup);
          return `<div class="sr-sede-bucket">
            <button class="sr-sede-bucket-header" onclick="openUocWithSede('${escapeJs(u.gruppoId)}','${escapeJs(b.sedeKey)}')" title="Apri ${escapeHtml(u.gruppo)} con questa sezione espansa">${headerInner}</button>
            <div class="sr-sede-bucket-contatti">${contattiItems}</div>
          </div>`;
        }
        // Bucket dinamico (da sezione) o "Altro": wrapper neutro con header
        const label = b.customLabel || 'Altro';
        return `<div class="sr-sede-bucket">
          <div class="sr-sede-bucket-header" style="cursor:default;">
            <span class="sede-bucket-tipo">${escapeHtml(label)}</span>
          </div>
          <div class="sr-sede-bucket-contatti">${contattiItems}</div>
        </div>`;
      }).join('');
    } else {
      contattiHtml = topContatti.map(c => renderContatto(c)).join('');
    }
    // In modalità collassata: niente header UOC, niente sede grande, niente "+N altri".
    // Solo la lista dei rettangoli "UOC · Sezione" con i contatti sotto.
    if (isCollapsed) {
      return `<div class="sr-uoc sr-uoc-collapsed">
        <div class="sr-uoc-contatti">
          ${contattiHtml}
        </div>
      </div>`;
    }
    const edificioUoc = (u.fullGroup && u.fullGroup.ubicazione && u.fullGroup.ubicazione.struttura) || '';
    return `<div class="sr-uoc" onclick="event.target.closest('.sr-contact, .sr-sede-bucket-header, .sr-sede-bucket-contatti') ? null : navigate('numeri', {filter:'${escapeJs(u.gruppoId)}'})">
      <div class="sr-uoc-head">
        ${ospBadge}
      </div>
      <div class="sr-uoc-title">${escapeHtml(shortenUocName(u.fullGroup) || u.gruppo)}${edificioUoc ? `<span class="sr-uoc-edificio">${escapeHtml(edificioUoc)}</span>` : ''}</div>
      ${sedeHtml}
      <div class="sr-uoc-contatti">
        ${contattiHtml}
        ${restCount > 0 ? `<div class="sr-uoc-more">+ ${restCount} altri numeri nella UOC →</div>` : ''}
      </div>
    </div>`;
  };

  const renderOther = (r) => {
    const item = r.item;
    let click = '';
    if (item.type === 'procedura') click = `navigate('procedura', {slug:'${escapeJs(item.slug)}'})`;
    else if (item.type === 'clinica') click = `navigate('clinica-scheda', {slug:'${escapeJs(item.slug)}'})`;
    else if (item.type === 'modulo') click = `navigate('modulo', {slug:'${escapeJs(item.slug)}'})`;
    const typeLabel = item.type === 'procedura' ? 'Procedura'
      : item.type === 'clinica' ? 'Scheda clinica'
      : item.type === 'modulo' ? 'Modulo' : item.type;
    const snippet = (item.body || '').substring(0, 140) + ((item.body || '').length > 140 ? '…' : '');
    return `<div class="search-result-item" onclick="${click}">
      <div class="search-result-type">${typeLabel}</div>
      <div class="search-result-title">${escapeHtml(item.titolo)}</div>
      ${snippet ? `<div class="search-result-snippet">${escapeHtml(snippet)}</div>` : ''}
    </div>`;
  };

  const totalContatti = uocResults.reduce((s, u) => s + u.matchedCount, 0);
  const totalResults = uocResults.length + nonNumeri.length;

  // Conteggio per categoria (per filter chips). Deve riflettere i risultati EFFETTIVAMENTE
  // mostrati dopo il filtro stretto, non i raw di Fuse (che includono falsi positivi fuzzy).
  // - numeri: i contatti realmente in uocResults (totalContatti), non numeriRaw.length;
  // - documenti: i nonNumeri già filtrati strict, non rawResults grezzi.
  const countByType = {
    numeri: totalContatti,
    procedura: 0, clinica: 0, modulo: 0
  };
  nonNumeri.forEach(r => {
    if (r.item.type !== 'numero' && countByType[r.item.type] !== undefined) countByType[r.item.type]++;
  });
  // Set-based filter: multi-select con toggle
  const activeFilters = state.searchFilter instanceof Set ? state.searchFilter : new Set();
  state.searchFilter = activeFilters;
  const isFiltering = activeFilters.size > 0;
  const showNumeri = !isFiltering || activeFilters.has('numeri');
  const showProc = !isFiltering || activeFilters.has('procedura');
  const showClin = !isFiltering || activeFilters.has('clinica');
  const showMod = !isFiltering || activeFilters.has('modulo');

  const chipTypes = [
    { key: 'numeri',    label: 'Rubrica',        count: countByType.numeri },
    { key: 'procedura', label: 'Procedure',      count: countByType.procedura },
    { key: 'clinica',   label: 'Clinica',        count: countByType.clinica },
    { key: 'modulo',    label: 'Moduli',         count: countByType.modulo }
  ].filter(c => c.count > 0);

  const chipsHtml = chipTypes.length > 1 || isFiltering
    ? `<div class="search-filter-chips">
        ${isFiltering ? `<button class="search-filter-chip" onclick="clearSearchFilter()">✕ Tutti</button>` : ''}
        ${chipTypes.map(c =>
          `<button class="search-filter-chip ${activeFilters.has(c.key) ? 'active' : ''}" onclick="toggleSearchFilter('${c.key}')">${c.label} · ${c.count}</button>`
        ).join('')}
      </div>`
    : '';

  // Filtra nonNumeri secondo i filtri attivi.
  // IMPORTANTE: filtrare da `nonNumeri` (già filtrato strict), NON da `rawResults`
  // (i match fuzzy grezzi di Fuse, che includono falsi positivi). Usando rawResults
  // il chip diceva "Procedure · 1" ma cliccandolo comparivano procedure extra
  // (es. "Richiesta ECG", "Trasfusione di emoderivati") che il conteggio — basato
  // su nonNumeri — non includeva.
  const filteredNonNumeri = isFiltering
    ? nonNumeri.filter(r => r.item.type !== 'numero' && activeFilters.has(r.item.type)).slice(0, 20)
    : nonNumeri;

  target.innerHTML = `
    <div class="page-head">
      <div class="page-eyebrow">Risultati</div>
      <h1 class="page-title">Ricerca: <em>${escapeHtml(query)}</em></h1>
      <div style="margin-top:8px;font-size:13px;color:var(--ink-muted);">
        ${uocResults.length > 0 ? `${uocResults.length} UOC · ${totalContatti} contatti${nonNumeri.length > 0 ? ' · ' : ''}` : ''}
        ${nonNumeri.length > 0 ? `${nonNumeri.length} documenti` : ''}
        ${totalResults === 0 ? 'nessun risultato' : ''}
      </div>
      ${chipsHtml}
    </div>
    ${showNumeri && uocResults.length > 0 ? `<div class="sr-section-title">Rubrica</div>
    <div class="sr-uoc-list">${uocResults.map(renderUoc).join('')}</div>` : ''}
    ${(showProc || showClin || showMod) && filteredNonNumeri.length > 0 ? `<div class="sr-section-title">Documenti</div>
    <div class="search-results">${filteredNonNumeri.map(renderOther).join('')}</div>` : ''}
    ${totalResults === 0 ? `<p style="color:var(--ink-muted);padding:24px 0;">Nessun risultato per "${escapeHtml(query)}".</p>` : ''}`;
}

function toggleSearchFilter(type) {
  if (!(state.searchFilter instanceof Set)) state.searchFilter = new Set();
  if (state.searchFilter.has(type)) state.searchFilter.delete(type);
  else state.searchFilter.add(type);
  const q = $('global-search').value || state.currentParams?.query || '';
  const overlayOpen = !document.getElementById('search-overlay')?.classList.contains('hidden');
  renderSearchResults(q, overlayOpen ? 'search-overlay-content' : undefined);
}
function clearSearchFilter() {
  state.searchFilter = new Set();
  const q = $('global-search').value || state.currentParams?.query || '';
  const overlayOpen = !document.getElementById('search-overlay')?.classList.contains('hidden');
  renderSearchResults(q, overlayOpen ? 'search-overlay-content' : undefined);
}
