/* ============================ NAV TREE & EDIT MODE ============================ */

const navState = {
  expanded: new Set(),       // ids of currently-expanded nodes
  editMode: false,
  openMenu: null,
  drillPath: []              // stack of node ids for drill-down navigation (empty = root level)
};

function toggleEditMode(force) {
  const wasEdit = navState.editMode;
  const willEdit = (force !== undefined) ? force : !navState.editMode;

  // Se stiamo USCENDO da edit mode mentre un editor file è aperto, chiedi conferma
  // e chiudi anche l'editor (Opzione A scelta dall'utente).
  if (wasEdit && !willEdit && state.editingContext) {
    const ctx = state.editingContext;
    if (ctx.isDirty) {
      if (!confirm('Hai modifiche non salvate nel file aperto. Uscire dalla modalità modifica e perdere le modifiche?')) {
        return; // Annullato: nessun cambio di stato
      }
    }
    // Rilascia il lock se posseduto
    if (ctx.hasLock && typeof locks !== 'undefined' && locks.release) {
      locks.release(ctx.slug).catch(() => {});
    }
    // Distruggi editor instance (Toast UI legacy o block editor non ha destroy ma ok)
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    state.editingContext = null;
    // Determina dove tornare: route corrente è del tipo `procedura-edit` o `clinica-edit`
    // → torno alla rotta in lettura corrispondente
    let targetRoute = null;
    let targetParams = state.currentParams || {};
    if (state.currentView === 'procedura-edit') targetRoute = 'procedura';
    else if (state.currentView === 'clinica-edit') targetRoute = 'clinica-scheda';
    else if (state.currentView === 'modulo-edit') targetRoute = 'modulo';
    // Aggiorno stato edit mode e UI
    navState.editMode = false;
    document.body.classList.toggle('edit-mode', false);
    const banner = document.getElementById('edit-mode-banner');
    if (banner) banner.classList.add('hidden');
    document.documentElement.style.removeProperty('--edit-banner-height');
    const btnEditMode = document.getElementById('btn-edit-mode');
    if (btnEditMode) btnEditMode.classList.remove('active');
    updateEditBanner();
    renderNavTree();
    if (targetRoute) navigate(targetRoute, targetParams);
    else if (state.currentView) navigate(state.currentView, state.currentParams || {});
    return;
  }

  // Se stiamo uscendo da edit mode con modifiche pending sui tag, chiedi conferma
  if (wasEdit && !willEdit && state.pendingTagEdits && state.pendingTagEdits.size > 0) {
    if (!confirm(`Hai ${state.pendingTagEdits.size} modifica/modifiche ai tag non salvate. Uscire comunque e perderle?`)) {
      return;
    }
    state.pendingTagEdits.clear();
  }
  navState.editMode = willEdit;
  document.body.classList.toggle('edit-mode', navState.editMode);
  const banner = document.getElementById('edit-mode-banner');
  banner.classList.toggle('hidden', !navState.editMode);
  // Aggiorna --edit-banner-height per far scorrere correttamente la sidebar sticky.
  // Doppio requestAnimationFrame per essere sicuri che il layout sia stabilizzato
  // (su mobile il primo rAF può ancora restituire altezze transitorie esagerate).
  // Inoltre clampo il valore in un range sensato per evitare effetti visivi sbagliati
  // anche se la lettura fallisce per qualunque motivo.
  if (navState.editMode) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const raw = banner.offsetHeight;
      // Banner sane: ~30-60px desktop, ~30-50px mobile. Clamp per sicurezza.
      const h = Math.max(30, Math.min(80, raw));
      document.documentElement.style.setProperty('--edit-banner-height', h + 'px');
    }));
  } else {
    document.documentElement.style.removeProperty('--edit-banner-height');
  }
  document.getElementById('btn-edit-mode').classList.toggle('active', navState.editMode);
  updateEditBanner();
  renderNavTree();
  if (state.currentView) {
    // Preserva: 1) stato open dei <details>, 2) scroll position.
    // Il rerender di navigate() ricrea il DOM e i details perdono lo stato open.
    // Se non ripristiniamo, le cartelle si collassano e la pagina si accorcia,
    // facendo "saltare" il viewport in basso.
    const openDetails = new Set();
    document.querySelectorAll('main.content details[open]').forEach(d => {
      const key = d.dataset.cat || d.querySelector('.categoria-title')?.textContent?.trim();
      if (key) openDetails.add(key);
    });
    const savedScroll = window.scrollY;
    navigate(state.currentView, state.currentParams || {});
    // Ripristina open state + scroll dopo il rerender
    requestAnimationFrame(() => {
      document.querySelectorAll('main.content details').forEach(d => {
        const key = d.dataset.cat || d.querySelector('.categoria-title')?.textContent?.trim();
        if (key && openDetails.has(key)) d.open = true;
      });
      // Scroll dopo aver ripristinato i details aperti, così l'altezza è quella attesa
      requestAnimationFrame(() => window.scrollTo({ top: savedScroll, behavior: 'instant' }));
    });
  }
}

function getRootNavNodes() {
  // Le sezioni con permesso 'none' spariscono dall'albero (il router le blocca comunque)
  const visibile = (key) => (typeof puoVedere !== 'function') || puoVedere(key);
  return [
    { id: 'home', label: 'Home', kind: 'top', slug: 'home', navTarget: { route: 'home', params: {} } },
    { id: 'procedure', label: 'Procedure', count: state.index.procedure.length, kind: 'top', slug: 'procedure', navTarget: { route: 'procedure', params: {} }, children: () => buildProcedureChildren() },
    { id: 'clinica', label: 'Clinica', count: (state.index.clinica || []).length, kind: 'top', slug: 'clinica', navTarget: { route: 'clinica', params: {} }, children: () => buildClinicaChildren() },
    { id: 'numeri', label: 'Rubrica', count: countNumeri(), kind: 'top', slug: 'numeri', navTarget: { route: 'numeri', params: {} } },
    { id: 'moduli', label: 'Moduli', count: state.index.moduli.length, kind: 'top', slug: 'moduli', navTarget: { route: 'moduli', params: {} }, children: () => buildModuliChildren() },
    { id: 'calendario', label: 'Calendario', count: ((state.index.calendar && state.index.calendar.eventi) || []).length, kind: 'top', slug: 'calendario', navTarget: { route: 'calendario', params: {} } },
    { id: 'reparto', label: 'Reparto', kind: 'top', slug: 'reparto', navTarget: { route: 'reparto', params: {} } },
    { id: 'lettere', label: 'LetteraAI', count: ((state.index.lettere && state.index.lettere.casi) || []).length, kind: 'top', slug: 'lettere', navTarget: { route: 'lettere', params: {} }, children: () => buildLettereChildren() },
  ].filter(n => n.id === 'home' || visibile(n.id));
}

// Trova il nodo corrispondente a un id esplorando la gerarchia partendo dalle root
function findNavNode(id, nodes) {
  if (!nodes) nodes = getRootNavNodes();
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) {
      const found = findNavNode(id, n.children());
      if (found) return found;
    }
  }
  return null;
}

// Ritorna { node, breadcrumb } del nodo corrente nel drill path
function getCurrentDrillNode() {
  if (!navState.drillPath || navState.drillPath.length === 0) return null;
  const breadcrumb = [];
  let nodes = getRootNavNodes();
  let current = null;
  for (const id of navState.drillPath) {
    current = nodes.find(n => n.id === id);
    if (!current) return null;
    breadcrumb.push(current);
    if (current.children) nodes = current.children();
    else break;
  }
  return { node: current, breadcrumb };
}

function drillInto(nodeId) {
  navState.drillPath.push(nodeId);
  renderNavTree();
}

function drillBack() {
  navState.drillPath.pop();
  renderNavTree();
}

function resetDrill() {
  navState.drillPath = [];
  renderNavTree();
}

function renderNavTree() {
  const tree = document.getElementById('nav-tree');
  if (!tree) return;

  const drill = getCurrentDrillNode();

  if (drill && drill.node) {
    // Drill-down mode: mostra back + children del nodo corrente.
    // Mostra sempre "Indietro" come label (più chiaro del nome del parent),
    // tranne quando il parent ha un nome significativo (drill profondo).
    const parentLabel = drill.breadcrumb.length > 1
      ? drill.breadcrumb[drill.breadcrumb.length - 2].label
      : 'Principale';
    const currentNode = drill.node;
    const children = currentNode.children ? currentNode.children() : [];
    const rootTarget = currentNode.navTarget;

    const backButton = `<div class="nav-drill-back" onclick="drillBack()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      <span>${escapeHtml(parentLabel)}</span>
    </div>`;

    // L'header mostra la categoria/sottocategoria corrente: la rendo cliccabile per navigare
    // alla sua vista (panoramica). Cliccandola, chiudo anche la sidebar mobile (come quando si
    // apre una vista finale) e mostro la freccia a destra come le altre voci.
    const headerClick = rootTarget
      ? `closeMobileMenu();navigate('${escapeJs(rootTarget.route)}', ${JSON.stringify(rootTarget.params || {}).replace(/"/g, '&quot;')})`
      : '';
    const header = `<div class="nav-drill-header${rootTarget ? ' nav-drill-header-clickable' : ''}"${headerClick ? ` onclick="${headerClick}"` : ''}>
      <span class="nav-drill-title">${escapeHtml(currentNode.label)}</span>
      ${rootTarget ? '<span class="nav-tree-chevron">›</span>' : ''}
    </div>`;

    // Voce "Panoramica" rimossa: cliccando la sezione principale l'utente vede già
    // la panoramica nella pagina a destra, quindi è implicito.
    const overviewRow = '';

    const childrenHtml = children.map(c => renderNavTreeNode(c, 0)).join('');

    tree.innerHTML = backButton + header + overviewRow + childrenHtml;
  } else {
    // Root mode: mostra solo i top-level, ciascuno come entry singola senza figli inline
    const nodes = getRootNavNodes();
    tree.innerHTML = nodes.map(n => renderNavRootNode(n)).join('');
  }
}

function renderNavRootNode(node) {
  const hasChildren = !!node.children;
  // Click: se ha figli, drill-in (e naviga al navTarget se presente)
  // Se leaf: solo navigate
  const clickAction = hasChildren
    ? `handleNavRootClick('${escapeJs(node.id)}', ${node.navTarget ? `'${escapeJs(node.navTarget.route)}'` : 'null'}, ${node.navTarget && node.navTarget.params ? JSON.stringify(node.navTarget.params).replace(/"/g, '&quot;') : 'null'})`
    : (node.navTarget ? `navigate('${escapeJs(node.navTarget.route)}', ${JSON.stringify(node.navTarget.params || {}).replace(/"/g, '&quot;')})` : '');

  const folderKinds = new Set(['macro','sub','clinica-sub','gruppo','top']);
  const nodeKind = node.kind || 'top';
  const showMenuBtn = navState.editMode && (!folderKinds.has(nodeKind) || isAdmin());
  const editBtn = showMenuBtn
    ? `<span class="nav-edit-actions"><button class="btn-icon-mini" onclick="event.stopPropagation();showNavContextMenu(this, '${nodeKind}', '${escapeJs(node.slug || node.id)}')" title="Azioni">⋯</button></span>`
    : '';

  return `
    <div class="nav-tree-node" data-id="${escapeHtml(node.id)}">
      <div class="nav-tree-row nav-tree-root-row" data-slug="${escapeHtml(node.slug || '')}" data-kind="${nodeKind}" onclick="${clickAction}">
        <span class="nav-tree-label">${escapeHtml(node.label)}</span>
        ${hasChildren ? '<span class="nav-tree-chevron">›</span>' : ''}
        ${editBtn}
      </div>
    </div>`;
}

function handleNavRootClick(nodeId, route, params) {
  // 1. Drill in
  navState.drillPath = [nodeId];
  renderNavTree();
  // 2. Naviga alla pagina (se c'è un target)
  if (route) navigate(route, params || {});
}

function buildProcedureChildren() {
  const byCat = {};
  state.index.procedure.forEach(p => {
    const c = p.categoria || 'altre';
    if (!byCat[c]) byCat[c] = [];
    byCat[c].push(p);
  });
  const order = ['bedside','richieste','farmacologiche','emergenze','gestione'];
  const cats = [...order.filter(c => byCat[c]), ...Object.keys(byCat).filter(c => !order.includes(c))];
  return cats.map(cat => {
    const subs = {};
    byCat[cat].forEach(p => {
      const s = p.sottocategoria || '_senza';
      if (!subs[s]) subs[s] = [];
      subs[s].push(p);
    });
    const subKeys = Object.keys(subs).sort();
    // If only "_senza" sub: list procedures directly under macro.
    // Con HIDE_SUBCATEGORIES attivo, comportamento esteso a tutte le categorie:
    // le procedure compaiono direttamente sotto la macro, senza il livello sottocategoria.
    if (HIDE_SUBCATEGORIES || (subKeys.length === 1 && subKeys[0] === '_senza')) {
      return {
        id: 'macro:' + cat,
        label: CATEGORIA_LABELS[cat] || cat,
        count: byCat[cat].length,
        action: 'navigate',
        navTarget: { route: 'procedure-cat', params: { cat } },
        kind: 'macro',
        slug: cat,
        children: () => byCat[cat].map(p => ({
          id: 'procedura:' + p.slug,
          label: p.titolo || p.slug,
          count: null,
          action: 'navigate',
          navTarget: { route: 'procedura', params: { slug: p.slug } },
          kind: 'procedure',
          slug: p.slug,
          children: null
        }))
      };
    }
    return {
      id: 'macro:' + cat,
      label: CATEGORIA_LABELS[cat] || cat,
      count: byCat[cat].length,
      action: 'navigate',
      navTarget: { route: 'procedure-cat', params: { cat } },
      kind: 'macro',
      slug: cat,
      children: () => subKeys.map(s => ({
        id: 'sub:' + cat + ':' + s,
        label: SOTTO_LABELS[s] || (s === '_senza' ? '(senza)' : s),
        count: subs[s].length,
        action: 'navigate',
        navTarget: { route: 'procedure-cat', params: { cat, sub: s } },
        kind: 'sub',
        slug: cat + '/' + s,
        children: () => subs[s].map(p => ({
          id: 'procedura:' + p.slug,
          label: p.titolo || p.slug,
          count: null,
          action: 'navigate',
          navTarget: { route: 'procedura', params: { slug: p.slug } },
          kind: 'procedure',
          slug: p.slug,
          children: null
        }))
      }))
    };
  });
}

function buildClinicaChildren() {
  const subs = {};
  (state.index.clinica || []).forEach(c => {
    const s = c.sottocategoria || '_senza';
    if (!subs[s]) subs[s] = [];
    subs[s].push(c);
  });
  const order = ['scale-cliniche','emergenze','consulenze','prognosi','gestione-post-acuta'];
  const keys = [...order.filter(s => subs[s]), ...Object.keys(subs).filter(s => !order.includes(s))];
  return keys.map(s => {
    // Check if this sub has nested sub-subcategories
    const nested = {};
    const direct = [];
    subs[s].forEach(c => {
      if (c.sotto_sottocategoria) {
        const ss = c.sotto_sottocategoria;
        if (!nested[ss]) nested[ss] = [];
        nested[ss].push(c);
      } else {
        direct.push(c);
      }
    });
    const nestedKeys = Object.keys(nested).sort();
    const childrenFn = nestedKeys.length > 0
      ? () => [
          // Nested sub-subcategories first
          ...nestedKeys.map(ss => ({
            id: 'clinica-subsub:' + s + ':' + ss,
            label: SOTTO_LABELS[ss] || ss,
            count: nested[ss].length,
            action: 'navigate',
            navTarget: { route: 'clinica', params: { sub: s, subsub: ss } },
            kind: 'clinica-subsub',
            slug: s + '/' + ss,
            children: () => nested[ss].map(c => ({
              id: 'clinica-scheda:' + c.slug,
              label: c.titolo || c.slug,
              count: null,
              action: 'navigate',
              navTarget: { route: 'clinica-scheda', params: { slug: c.slug } },
              kind: 'clinica',
              slug: c.slug,
              children: null
            }))
          })),
          // Direct children (without sub-sub) after
          ...direct.map(c => ({
            id: 'clinica-scheda:' + c.slug,
            label: c.titolo || c.slug,
            count: null,
            action: 'navigate',
            navTarget: { route: 'clinica-scheda', params: { slug: c.slug } },
            kind: 'clinica',
            slug: c.slug,
            children: null
          }))
        ]
      : () => subs[s].map(c => ({
          id: 'clinica-scheda:' + c.slug,
          label: c.titolo || c.slug,
          count: null,
          action: 'navigate',
          navTarget: { route: 'clinica-scheda', params: { slug: c.slug } },
          kind: 'clinica',
          slug: c.slug,
          children: null
        }));
    return {
      id: 'clinica-sub:' + s,
      label: SOTTO_LABELS[s] || (s === '_senza' ? '(senza)' : s),
      count: subs[s].length,
      action: 'navigate',
      navTarget: { route: 'clinica', params: { sub: s } },
      kind: 'clinica-sub',
      slug: s,
      children: childrenFn
    };
  });
}

function buildNumeriChildren() {
  return getVisibleNumeriGroups().map(g => ({
    id: 'gruppo:' + g.id,
    label: g.nome + ((g._source && g._source !== 'aopd') ? ` · ${g._source.toUpperCase()}` : ''),
    count: (g.contatti || []).length,
    action: 'navigate',
    navTarget: { route: 'numeri', params: { filter: g.id } },
    kind: 'gruppo',
    slug: g.id,
    children: null  // contacts shown in main panel, not in sidebar
  }));
}

function buildModuliChildren() {
  return state.index.moduli.map(m => ({
    id: 'modulo:' + m.slug,
    label: m.titolo || m.slug,
    count: null,
    action: 'navigate',
    navTarget: { route: 'modulo', params: { slug: m.slug } },
    kind: 'modulo',
    slug: m.slug,
    children: null
  }));
}

// LetteraAI: voci di navigazione (flusso lettera + strumenti), come i panel dell'originale.
// Le voci admin (Segnalazioni, Editor Prompt) appaiono solo se l'utente è admin.
// I Reparti NON sono una voce separata: la gestione reparti è dentro Libreria Casi.
function buildLettereChildren() {
  const isAdmin = !!(state.session && state.session.isAdmin);
  const mk = (id, label, route, kind, numBadge) => ({
    id: 'lettere:' + id, label, count: null, action: 'navigate',
    navTarget: { route, params: {} }, kind: kind || 'lettere-sezione', slug: id, children: null,
    numBadge: numBadge != null ? numBadge : null
  });
  // Header di gruppo non cliccabile (renderizzato come etichetta di sezione)
  const grp = (id, label) => ({ id: 'lettere-grp:' + id, label, kind: 'group-label', children: null, navTarget: null });
  const nodes = [
    grp('flusso', 'Flusso di generazione'),
    // Bollini blu numerati 1-5 per il flusso (stile come la home di LetteraAI)
    mk('carica', 'Carica cartella', 'lettere-carica', null, 1),
    mk('anonimizza', 'Anonimizza dati', 'lettere-anonimizza', null, 2),
    mk('genera', 'Genera lettera', 'lettere-genera', null, 3),
    mk('verifica', 'Verifica', 'lettere-verifica', null, 4),
    mk('esporta', 'Esporta', 'lettere-esporta', null, 5),
    grp('strumenti', 'Strumenti'),
    // Stesse icone della home per gli strumenti
    mk('libreria', '📚 Libreria casi', 'lettere-libreria'),
    mk('impostazioni', '⚙ Preferenze', 'lettere-impostazioni'),
    mk('segnalazioni', '⚠ Segnala errori', 'lettere-segnalazioni'),
  ];
  if (isAdmin) {
    nodes.push(mk('segnalazioni-admin', '📋 Segnalazioni', 'lettere-segnalazioni-admin'));
    nodes.push(mk('config', '📝 Editor Prompt', 'lettere-config'));
  }
  return nodes;
}



function countNumeri() {
  return getVisibleNumeriGroups().reduce((acc, g) => acc + (g.contatti || []).length, 0);
}

function renderNavTreeNode(node, depth) {
  const hasChildren = !!node.children;
  const inDrill = navState.drillPath && navState.drillPath.length > 0;

  // Header di gruppo non cliccabile (es. "Flusso di generazione" / "Strumenti")
  if (node.kind === 'group-label') {
    return `<div class="nav-tree-group-label">${escapeHtml(node.label)}</div>`;
  }

  // In drill-mode, children navigation uses drill-in instead of inline expand
  if (inDrill) {
    const clickAction = hasChildren
      ? `handleNavDrillClick('${escapeJs(node.id)}', ${node.navTarget ? `'${escapeJs(node.navTarget.route)}'` : 'null'}, ${node.navTarget && node.navTarget.params ? JSON.stringify(node.navTarget.params).replace(/"/g, '&quot;') : 'null'})`
      : (node.navTarget ? `closeMobileMenu();navigate('${escapeJs(node.navTarget.route)}', ${JSON.stringify(node.navTarget.params || {}).replace(/"/g, '&quot;')})` : '');

    const folderKinds = new Set(['macro','sub','clinica-sub','gruppo','top']);
    const nodeKind = node.kind || 'top';
    const showMenuBtn = navState.editMode && (!folderKinds.has(nodeKind) || isAdmin());
    const editBtn = showMenuBtn
      ? `<span class="nav-edit-actions"><button class="btn-icon-mini" onclick="event.stopPropagation();showNavContextMenu(this, '${nodeKind}', '${escapeJs(node.slug || node.id)}')" title="Azioni">⋯</button></span>`
      : '';

    return `
      <div class="nav-tree-node" data-id="${escapeHtml(node.id)}">
        <div class="nav-tree-row nav-tree-drill-row" data-slug="${escapeHtml(node.slug || '')}" data-kind="${nodeKind}" onclick="${clickAction}">
          ${node.numBadge != null ? `<span class="nav-tree-num">${escapeHtml(String(node.numBadge))}</span>` : ''}
          <span class="nav-tree-label">${escapeHtml(node.label)}</span>
          ${hasChildren ? '<span class="nav-tree-chevron">›</span>' : ''}
          ${editBtn}
        </div>
      </div>`;
  }

  // Fallback legacy tree mode (non usato nel nuovo drill ma mantenuto per retrocompat)
  const expanded = navState.expanded.has(node.id);
  const childrenList = expanded && hasChildren ? node.children() : [];

  let rowClickAction;
  if (hasChildren) {
    rowClickAction = `handleNavRowClick('${escapeJs(node.id)}', ${node.navTarget ? `'${escapeJs(node.navTarget.route)}'` : 'null'}, ${node.navTarget && node.navTarget.params ? JSON.stringify(node.navTarget.params).replace(/"/g, '&quot;') : 'null'})`;
  } else if (node.navTarget) {
    rowClickAction = `navigate('${escapeJs(node.navTarget.route)}', ${JSON.stringify(node.navTarget.params || {}).replace(/"/g, '&quot;')})`;
  } else {
    rowClickAction = '';
  }

  const folderKinds = new Set(['macro','sub','clinica-sub','gruppo','top']);
  const nodeKind = node.kind || 'top';
  const showMenuBtn = navState.editMode && (!folderKinds.has(nodeKind) || isAdmin());
  const editBtn = showMenuBtn
    ? `<span class="nav-edit-actions"><button class="btn-icon-mini" onclick="event.stopPropagation();showNavContextMenu(this, '${nodeKind}', '${escapeJs(node.slug || node.id)}')" title="Azioni">⋯</button></span>`
    : '';

  return `
    <div class="nav-tree-node ${expanded ? 'open' : ''}" data-id="${escapeHtml(node.id)}">
      <div class="nav-tree-row ${expanded ? 'expanded' : ''}" data-slug="${escapeHtml(node.slug || '')}" data-kind="${node.kind || 'top'}" onclick="${rowClickAction}">
        <span class="nav-tree-caret${hasChildren ? ' nav-tree-caret-clickable' : ''}" ${hasChildren ? `onclick="event.stopPropagation(); toggleNavNode('${escapeJs(node.id)}')"` : ''}>${hasChildren ? (expanded ? '▾' : '▸') : '·'}</span>
        ${node.numBadge != null ? `<span class="nav-tree-num">${escapeHtml(String(node.numBadge))}</span>` : ''}
        <span class="nav-tree-label">${escapeHtml(node.label)}</span>
        ${node.count !== null && node.count !== undefined ? `<span class="nav-tree-count">${node.count}</span>` : ''}
        ${editBtn}
      </div>
      ${hasChildren ? `<div class="nav-tree-children">${childrenList.map(c => renderNavTreeNode(c, depth + 1)).join('')}</div>` : ''}
    </div>`;
}

function handleNavDrillClick(nodeId, route, params) {
  // Drill-in e naviga al target (se presente)
  navState.drillPath.push(nodeId);
  renderNavTree();
  if (route) navigate(route, params || {});
}

function handleNavRowClick(nodeId, route, params) {
  const wasExpanded = navState.expanded.has(nodeId);
  if (wasExpanded) {
    // Collapse: just remove from expanded set, do NOT navigate
    // (otherwise the navigate handler re-adds the node to expanded)
    navState.expanded.delete(nodeId);
    renderNavTree();
  } else {
    // Expand AND navigate
    navState.expanded.add(nodeId);
    renderNavTree();
    if (route) navigate(route, params || {});
  }
}

function toggleNavNode(id) {
  if (navState.expanded.has(id)) navState.expanded.delete(id);
  else navState.expanded.add(id);
  renderNavTree();
}


/* ----- Context menu (⋯) ----- */
function isAdmin() {
  return !!(state.session && state.session.isAdmin);
}

function showNavContextMenu(triggerBtn, kind, slug) {
  // Folder/structure operations are admin-only
  const folderKinds = new Set(['macro','sub','clinica-sub','gruppo','top']);
  if (folderKinds.has(kind) && !isAdmin()) {
    return; // silently no-op for non-admin
  }
  closeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  let items = [];

  if (kind === 'macro') {
    items = [
      { label: '+ Nuova sottocategoria', action: () => createSottocategoria(slug) },
      { label: 'Rinomina categoria', action: () => renameMacroCategoria(slug) },
      { label: 'Elimina (se vuota)', danger: true, action: () => deleteMacroCategoria(slug) },
    ];
  } else if (kind === 'sub') {
    const [cat, sub] = slug.split('/');
    items = [
      { label: '+ Nuova procedura qui', action: () => nuovaProcedura({categoria: cat, sottocategoria: sub}) },
      { label: 'Rinomina sottocategoria', action: () => renameSottocategoria(cat, sub) },
      { label: 'Sposta in altra categoria...', action: () => moveSottocategoria(cat, sub) },
      { label: 'Elimina (se vuota)', danger: true, action: () => deleteSottocategoria(cat, sub) },
    ];
  } else if (kind === 'clinica-sub') {
    items = [
      { label: '+ Nuova scheda qui', action: () => nuovaSchedaClinica({sottocategoria: slug}) },
      { label: 'Rinomina', action: () => renameClinicaSub(slug) },
    ];
  } else if (kind === 'gruppo') {
    items = [
      { label: '+ Nuovo contatto qui', action: () => nuovoContatto(slug) },
      { label: 'Rinomina gruppo', action: () => renameGruppoNumeri(slug) },
    ];
  } else if (kind === 'top') {
    if (slug === 'procedure') items = [{ label: '+ Nuova categoria di procedure', action: () => nuovaMacroCategoria() }];
    else if (slug === 'clinica') items = [{ label: '+ Nuova sottocategoria clinica', action: () => createClinicaSub() }];
    else if (slug === 'numeri') items = [{ label: '+ Nuovo gruppo di numeri', action: () => nuovoGruppoNumeri() }];
    else if (slug === 'moduli') items = [{ label: '+ Nuovo modulo', action: () => apriNuovoModuloDialog() }];
  } else if (kind === 'procedure') {
    items = [
      { label: 'Apri', action: () => navigate('procedura', {slug}) },
      { label: 'Modifica contenuto', action: () => navigate('procedura-edit', {slug}) },
      { label: 'Rinomina', action: () => renameProcedura(slug) },
      { label: 'Sposta in...', action: () => moveProcedura(slug) },
      { label: 'Elimina', danger: true, action: () => confirmDelete('procedura', slug) },
    ];
  } else if (kind === 'clinica') {
    items = [
      { label: 'Apri', action: () => navigate('clinica-scheda', {slug}) },
      { label: 'Modifica contenuto', action: () => navigate('clinica-edit', {slug}) },
      { label: 'Rinomina', action: () => renameClinica(slug) },
    ];
  } else if (kind === 'modulo') {
    items = [
      { label: 'Modifica dati', action: () => editModuloMeta(slug) },
      { label: 'Elimina', danger: true, action: () => confirmDeleteModulo(slug) },
    ];
  }

  // Fallback if no items
  if (items.length === 0) {
    items = [{ label: 'Nessuna azione disponibile', action: () => {} }];
  }

  menu.innerHTML = items.map((it, idx) => `
    <div class="context-menu-item ${it.danger ? 'danger' : ''}" data-idx="${idx}">${escapeHtml(it.label)}</div>
  `).join('');

  document.body.appendChild(menu);
  // Position with viewport overflow protection
  const rect = triggerBtn.getBoundingClientRect();
  let left = rect.right + 4;
  let top = rect.top;
  // Allow menu to be measured first
  const menuRect = menu.getBoundingClientRect();
  if (left + menuRect.width > window.innerWidth - 8) {
    left = Math.max(8, rect.left - menuRect.width - 4);
  }
  if (top + menuRect.height > window.innerHeight - 8) {
    top = Math.max(8, window.innerHeight - menuRect.height - 8);
  }
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';

  menu.querySelectorAll('.context-menu-item').forEach((el, idx) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      closeContextMenu();
      items[idx].action();
    });
  });
  navState.openMenu = menu;
  setTimeout(() => document.addEventListener('click', closeContextMenu, { once: true }), 0);
}

function showItemContextMenu(triggerBtn, kind, slug) {
  closeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  let items = [];

  if (kind === 'procedure') {
    const proc = state.index.procedure.find(p => p.slug === slug);
    items = [
      { label: 'Apri', action: () => navigate('procedura', {slug}) },
      { label: 'Modifica contenuto', action: () => navigate('procedura-edit', {slug}) },
      { label: 'Rinomina', action: () => renameProcedura(slug) },
      { label: 'Sposta in...', action: () => moveProcedura(slug) },
      { label: 'Elimina', danger: true, action: () => confirmDelete('procedura', slug) },
    ];
  } else if (kind === 'clinica') {
    items = [
      { label: 'Apri', action: () => navigate('clinica-scheda', {slug}) },
      { label: 'Modifica contenuto', action: () => navigate('clinica-edit', {slug}) },
      { label: 'Rinomina', action: () => renameClinica(slug) },
    ];
  } else if (kind === 'modulo') {
    items = [
      { label: 'Modifica dati', action: () => editModuloMeta(slug) },
      { label: 'Elimina', danger: true, action: () => confirmDeleteModulo(slug) },
    ];
  } else if (kind === 'contatto') {
    items = [
      { label: 'Mostra nella rubrica', action: () => navigate('numeri', { filter: slug }) },
      { label: 'Modifica contatto', action: () => editContatto(slug) },
      { label: 'Elimina contatto', danger: true, action: () => deleteContatto(slug) },
    ];
  }

  menu.innerHTML = items.map((it, idx) => `
    <div class="context-menu-item ${it.danger ? 'danger' : ''}" data-idx="${idx}">${escapeHtml(it.label)}</div>
  `).join('');
  const rect = triggerBtn.getBoundingClientRect();
  menu.style.left = (rect.right + 4) + 'px';
  menu.style.top = rect.top + 'px';
  document.body.appendChild(menu);
  menu.querySelectorAll('.context-menu-item').forEach((el, idx) => {
    el.addEventListener('click', () => { closeContextMenu(); items[idx].action(); });
  });
  navState.openMenu = menu;
  setTimeout(() => document.addEventListener('click', closeContextMenu, { once: true }), 0);
}

function closeContextMenu() {
  if (navState.openMenu && navState.openMenu.parentNode) {
    navState.openMenu.parentNode.removeChild(navState.openMenu);
  }
  navState.openMenu = null;
}

function escapeJs(s) { return String(s).replace(/'/g, "\\'").replace(/"/g, '\\"'); }

/* ----- Folder operations (multi-commit) ----- */

// Operazione di rename atomico (put nuovo path + delete vecchio path) con progress modal
// e rate-limit safety. Best-effort sugli accessori (img/) che non bloccano in caso di failure.
// `ops` array di { putPath, putContent, deletePath, deleteSha, commitMsg, schedaSlug, schedaTitolo,
//                  accessoriOldDir?, accessoriNewDir? }
async function _githubBatchRename(label, ops) {
  const total = ops.length * 2;
  let done = 0;
  const failures = [];

  // Show progress modal
  const modal = showProgressModal(label, total);
  try {
    for (const op of ops) {
      // Check rate limit mid-operation; bail out if too low
      if (rateLimit.remaining !== null && rateLimit.remaining < 100) {
        failures.push({ op, error: 'Rate limit GitHub quasi esaurito. Operazione interrotta per sicurezza.' });
        break;
      }
      modal.setStatus(`${op.schedaTitolo}: caricamento nuovo path...`);
      try {
        await gh.putFile(op.putPath, op.putContent, null, op.commitMsg);
        done++;
        modal.update(done, total, `${op.schedaTitolo}: caricato (${done}/${total})`);
      } catch (e) {
        failures.push({ op, phase: 'put', error: e.message });
        modal.update(done, total, `Errore PUT: ${e.message}`);
        continue; // skip delete if put failed (avoid data loss)
      }
      modal.setStatus(`${op.schedaTitolo}: eliminazione vecchio path...`);
      try {
        await gh.deleteFile(op.deletePath, op.deleteSha, `Elimina ${op.schedaSlug} da vecchio path`);
        done++;
        modal.update(done, total, `${op.schedaTitolo}: spostato (${done}/${total})`);
      } catch (e) {
        failures.push({ op, phase: 'delete', error: e.message });
        modal.update(done, total, `⚠ File duplicato (delete fallito): ${e.message}`);
      }
      // Sposta accessori (img/, allegati) se richiesto. Best-effort: failure non blocca l'operazione,
      // ma viene loggato in failures con phase='accessori' così l'admin sa che restano da pulire a mano.
      if (op.accessoriOldDir && op.accessoriNewDir) {
        modal.setStatus(`${op.schedaTitolo}: spostamento accessori (img/)…`);
        try {
          const n = await _moveSchedaAccessori(op.accessoriOldDir, op.accessoriNewDir, op.commitMsg);
          if (n > 0) modal.update(done, total, `${op.schedaTitolo}: ${n} accessori spostati`);
        } catch (e) {
          failures.push({ op, phase: 'accessori', error: e.message });
        }
      }
    }
  } finally {
    // Keep modal for 1s to show final state, then close
    await new Promise(r => setTimeout(r, 800));
    modal.close();
  }
  return { ok: failures.length === 0, total, done, failures };
}

async function checkRateLimitFor(neededCalls) {
  if (rateLimit.remaining === null) return true; // unknown: allow
  if (rateLimit.remaining < neededCalls) {
    const resetMin = rateLimit.resetAt ? Math.ceil((new Date(rateLimit.resetAt) - new Date()) / 60000) : '?';
    alert(`Rate limit GitHub insufficiente per l'operazione.\n\nChiamate necessarie: ${neededCalls}\nDisponibili: ${rateLimit.remaining}\nReset tra: ${resetMin} min\n\nRiprova dopo il reset.`);
    return false;
  }
  return true;
}

function showProgressModal(title, total) {
  // Create overlay + modal
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(20,18,14,.6);z-index:9998;display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML = `
    <div style="background:var(--bg-paper);border:1px solid var(--rule);border-radius:4px;padding:28px 32px;width:min(440px,90vw);box-shadow:0 8px 32px rgba(0,0,0,.2);">
      <div style="font-family:var(--serif);font-size:18px;font-weight:500;color:var(--ink);margin-bottom:12px;">${escapeHtml(title)}</div>
      <div style="height:6px;background:var(--rule-soft);border-radius:3px;overflow:hidden;margin:16px 0;">
        <div id="prog-bar" style="height:100%;background:var(--accent);width:0%;transition:width .3s;"></div>
      </div>
      <div id="prog-counter" style="font-family:var(--mono);font-size:12px;color:var(--ink-muted);margin-bottom:8px;">0 / ${total}</div>
      <div id="prog-status" style="font-size:13px;color:var(--ink-soft);min-height:20px;">Preparazione...</div>
    </div>`;
  document.body.appendChild(overlay);
  return {
    update(done, tot, status) {
      const pct = Math.round(done / tot * 100);
      const bar = overlay.querySelector('#prog-bar');
      const counter = overlay.querySelector('#prog-counter');
      const st = overlay.querySelector('#prog-status');
      if (bar) bar.style.width = pct + '%';
      if (counter) counter.textContent = `${done} / ${tot} (${pct}%)`;
      if (st && status) st.textContent = status;
    },
    setStatus(status) {
      const st = overlay.querySelector('#prog-status');
      if (st) st.textContent = status;
    },
    close() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
  };
}

async function renameSottocategoria(macro, oldSub) {
  if (!isAdmin()) return toast('Solo l\'admin può rinominare sottocategorie', 'warning');
  const newSub = prompt(`Rinomina sottocategoria "${oldSub}" in "${CATEGORIA_LABELS[macro] || macro}"\n\nNuovo slug (minuscole, cifre, trattini):`, oldSub);
  if (!newSub || newSub === oldSub) return;
  if (!/^[a-z0-9-]+$/.test(newSub)) return toast('Slug non valido', 'error');

  const affected = state.index.procedure.filter(p => p.categoria === macro && p.sottocategoria === oldSub);
  if (affected.length === 0) {
    toast('Sottocategoria vuota: nulla da spostare', 'info');
    return;
  }

  // Collision check
  const conflicts = state.index.procedure.filter(p => p.categoria === macro && p.sottocategoria === newSub);
  if (conflicts.length > 0) {
    if (!confirm(`"${newSub}" contiene già ${conflicts.length} schede. Le schede saranno unite.\nProcedere?`)) return;
  }

  const neededCommits = affected.length * 2;
  if (!await checkRateLimitFor(neededCommits + 20)) return;

  const ops = affected.map(p => {
    const newPath = p.path.replace(`/${oldSub}/`, `/${newSub}/`);
    const newFm = { ...p, sottocategoria: newSub };
    delete newFm.body; delete newFm.body_preview; delete newFm.path; delete newFm.sha;
    const newContent = stringifyMarkdown(newFm, p.body || '');
    // Accessori (img/ ecc.) seguono la stessa rinomina di cartella della scheda
    const oldDir = _schedaDir(p);
    const newDir = oldDir.replace(`/${oldSub}/`, `/${newSub}/`);
    return {
      schedaSlug: p.slug, schedaTitolo: p.titolo || p.slug,
      putPath: newPath, putContent: newContent,
      deletePath: p.path, deleteSha: p.sha,
      accessoriOldDir: oldDir, accessoriNewDir: newDir,
      commitMsg: `Rinomina ${oldSub} → ${newSub}: ${p.slug}`
    };
  });

  if (!confirm(`Rinominare "${oldSub}" → "${newSub}"?\n\n${affected.length} schede spostate.\n${neededCommits} commit GitHub.`)) return;

  const result = await _githubBatchRename(`Rinomina ${oldSub} → ${newSub}`, ops);
  if (result.ok) toast(`Rinominata: ${result.done}/${result.total}`, 'success');
  else toast(`Rinomina parziale: ${result.done}/${result.total}`, 'warning');
  await buildIndex();
  renderNavTree();
}

async function moveSottocategoria(currentMacro, sub) {
  if (!isAdmin()) return toast('Solo l\'admin può spostare sottocategorie', 'warning');
  const macroOrder = ['bedside','richieste','farmacologiche','emergenze','gestione'];
  const destMacros = macroOrder.filter(m => m !== currentMacro);
  const dest = prompt(`Sposta sottocategoria "${sub}" da "${CATEGORIA_LABELS[currentMacro] || currentMacro}"\n\nDestinazione (una di: ${destMacros.join(', ')}):`, destMacros[0]);
  if (!dest || dest === currentMacro) return;
  if (!macroOrder.includes(dest)) return toast('Destinazione non valida', 'error');

  const affected = state.index.procedure.filter(p => p.categoria === currentMacro && p.sottocategoria === sub);
  if (affected.length === 0) {
    toast('Sottocategoria vuota: nulla da spostare', 'info');
    return;
  }

  const conflicts = state.index.procedure.filter(p => p.categoria === dest && p.sottocategoria === sub);
  if (conflicts.length > 0) {
    if (!confirm(`In "${dest}" esiste già la sottocategoria "${sub}" con ${conflicts.length} schede. Le schede saranno unite.\nProcedere?`)) return;
  }

  const neededCommits = affected.length * 2;
  if (!await checkRateLimitFor(neededCommits + 20)) return;

  const ops = affected.map(p => {
    const newPath = p.path.replace(`procedure/${currentMacro}/${sub}/`, `procedure/${dest}/${sub}/`);
    const newFm = { ...p, categoria: dest };
    delete newFm.body; delete newFm.body_preview; delete newFm.path; delete newFm.sha;
    const newContent = stringifyMarkdown(newFm, p.body || '');
    const oldDir = _schedaDir(p);
    const newDir = oldDir.replace(`procedure/${currentMacro}/${sub}/`, `procedure/${dest}/${sub}/`);
    return {
      schedaSlug: p.slug, schedaTitolo: p.titolo || p.slug,
      putPath: newPath, putContent: newContent,
      deletePath: p.path, deleteSha: p.sha,
      accessoriOldDir: oldDir, accessoriNewDir: newDir,
      commitMsg: `Sposta ${p.slug}: ${currentMacro}/${sub} → ${dest}/${sub}`
    };
  });

  if (!confirm(`Spostare "${sub}" da "${currentMacro}" a "${dest}"?\n\n${affected.length} schede spostate.\n${neededCommits} commit GitHub.`)) return;

  const result = await _githubBatchRename(`Sposta ${sub} → ${dest}`, ops);
  if (result.ok) toast(`Spostato: ${result.done}/${result.total}`, 'success');
  else toast(`Spostamento parziale: ${result.done}/${result.total}`, 'warning');
  await buildIndex();
  renderNavTree();
}

async function deleteSottocategoria(macro, sub) {
  if (!isAdmin()) return toast('Solo l\'admin può eliminare sottocategorie', 'warning');
  const procs = state.index.procedure.filter(p => p.categoria === macro && p.sottocategoria === sub);
  if (procs.length > 0) return toast(`Sottocategoria non vuota (${procs.length} schede). Sposta o elimina prima i contenuti.`, 'warning', 4000);
  toast('Sottocategoria eliminata (cartella vuota)', 'info');
  await buildIndex();
  renderNavTree();
}

// Sposta una cartella scheda completa (scheda.md + tutto il contenuto) da oldDir a newDir.
// GitHub API non supporta "rename" atomico: si fa get → put nuovo path → delete originale per ogni file.
// Restituisce numero di file processati.
async function _moveSchedaCartella(oldDir, newDir, commitMsgPrefix) {
  // Lista contenuto cartella
  let items;
  try {
    items = await gh.listDir(oldDir);
  } catch (e) {
    throw new Error(`Cartella non leggibile: ${oldDir}`);
  }

  let processed = 0;
  for (const it of items) {
    if (it.type === 'dir') {
      // Ricorsione su sotto-cartelle (es. img/)
      const subOld = `${oldDir}/${it.name}`;
      const subNew = `${newDir}/${it.name}`;
      processed += await _moveSchedaCartella(subOld, subNew, commitMsgPrefix);
    } else if (it.type === 'file') {
      const oldFilePath = `${oldDir}/${it.name}`;
      const newFilePath = `${newDir}/${it.name}`;
      const file = await gh.getFile(oldFilePath);
      if (!file) continue;
      // Per file binari (immagini), getFile può restituire content base64 — verifica.
      // Per .md restituisce stringa decoded; per altri usa raw fetch + base64.
      let content = file.content;
      let isBase64 = false;
      // Se è un'immagine o file binario, riprendiamo via raw API
      if (!it.name.endsWith('.md') && !it.name.endsWith('.yml') && !it.name.endsWith('.txt')) {
        const rawUrl = `https://raw.githubusercontent.com/${CONFIG.REPO_OWNER}/${CONFIG.DATA_REPO_NAME}/${CONFIG.BRANCH}/${oldFilePath}`;
        const resp = await fetch(rawUrl);
        const buf = await resp.arrayBuffer();
        // Encode to base64 (browser-safe)
        let bin = '';
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
        content = btoa(bin);
        isBase64 = true;
      }
      await gh.putFile(newFilePath, content, null, `${commitMsgPrefix}: copia ${it.name}`, isBase64);
      await gh.deleteFile(oldFilePath, file.sha, `${commitMsgPrefix}: elimina vecchio ${it.name}`);
      processed++;
    }
  }
  return processed;
}

// Sposta SOLO gli accessori di una cartella scheda (img/, altri file non-scheda.md).
// Usato dalle funzioni admin in massa che riscrivono scheda.md separatamente col nuovo frontmatter.
// Restituisce numero di file accessori processati. Se oldDir non contiene accessori, ritorna 0.
async function _moveSchedaAccessori(oldDir, newDir, commitMsgPrefix) {
  let items;
  try {
    items = await gh.listDir(oldDir);
  } catch (e) {
    return 0; // Cartella non esiste o vuota: nessun accessorio da spostare
  }
  let processed = 0;
  for (const it of items) {
    if (it.type === 'dir') {
      // Ricorsione: sposta intera sotto-cartella (es. img/)
      processed += await _moveSchedaCartella(`${oldDir}/${it.name}`, `${newDir}/${it.name}`, commitMsgPrefix);
    } else if (it.type === 'file' && it.name !== 'scheda.md') {
      // File non-scheda.md (es. README, allegati): sposta singolo file
      const oldFilePath = `${oldDir}/${it.name}`;
      const newFilePath = `${newDir}/${it.name}`;
      const file = await gh.getFile(oldFilePath);
      if (!file) continue;
      let content = file.content;
      let isBase64 = false;
      if (!it.name.endsWith('.md') && !it.name.endsWith('.yml') && !it.name.endsWith('.txt')) {
        const rawUrl = `https://raw.githubusercontent.com/${CONFIG.REPO_OWNER}/${CONFIG.DATA_REPO_NAME}/${CONFIG.BRANCH}/${oldFilePath}`;
        const resp = await fetch(rawUrl);
        const buf = await resp.arrayBuffer();
        let bin = '';
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
        content = btoa(bin);
        isBase64 = true;
      }
      await gh.putFile(newFilePath, content, null, `${commitMsgPrefix}: copia ${it.name}`, isBase64);
      await gh.deleteFile(oldFilePath, file.sha, `${commitMsgPrefix}: elimina vecchio ${it.name}`);
      processed++;
    }
  }
  return processed;
}

// Aggiorna tutti i riferimenti incrociati a uno slug rinominato (oldSlug → newSlug).
// Scansiona TUTTE le schede (procedure + clinica) e sostituisce lo slug nei campi che
// puntano ad altre schede: procedure_correlate, invii_campioni_correlati (procedure_correlate
// è usato anche per i target clinica). Riscrive su GitHub solo le schede effettivamente
// modificate. Ritorna il numero di schede aggiornate. Aggiorna anche eventuali pin utente.
async function _updateSchedaSlugReferences(oldSlug, newSlug) {
  const SLUG_REF_FIELDS = ['procedure_correlate', 'invii_campioni_correlati'];
  const allSchede = [...(state.index.procedure || []), ...(state.index.clinica || [])];
  let updated = 0;
  for (const s of allSchede) {
    if (s.slug === newSlug) continue; // la scheda appena rinominata: i suoi campi non si autoreferenziano
    let touched = false;
    const newFm = { ...s };
    SLUG_REF_FIELDS.forEach(field => {
      if (Array.isArray(s[field]) && s[field].includes(oldSlug)) {
        newFm[field] = s[field].map(x => x === oldSlug ? newSlug : x);
        touched = true;
      }
    });
    if (!touched) continue;
    delete newFm.body; delete newFm.body_preview; delete newFm.path; delete newFm.sha;
    const content = stringifyMarkdown(newFm, s.body || '');
    await gh.putFile(s.path, content, s.sha, `Aggiorna riferimento ${oldSlug} → ${newSlug} in ${s.slug}`);
    updated++;
  }
  // Pin utente (preferiti procedure/clinica): aggiorno il riferimento allo slug.
  try {
    if (state.userPrefs && Array.isArray(state.userPrefs.pins)) {
      let pinTouched = false;
      state.userPrefs.pins.forEach(p => {
        if ((p.type === 'procedura' || p.type === 'clinica') && p.slug === oldSlug) { p.slug = newSlug; pinTouched = true; }
      });
      if (pinTouched) userPrefs.scheduleSave();
    }
  } catch {}
  return updated;
}

async function renameProcedura(slug) {
  if (bloccaSeNonModifica('procedure')) return;
  const proc = state.index.procedure.find(p => p.slug === slug);
  if (!proc) return;
  _openRenameSchedaModal({
    tipo: 'procedura',
    titolo: proc.titolo || slug,
    oldSlug: proc.slug,
    existsFn: (s) => !!state.index.procedure.find(p => p.slug === s),
    doRename: async () => {
      const newSlug = state._renameNewSlug;
      const oldDir = _schedaDir(proc);
      const parentDir = oldDir.replace(/\/[^/]+$/, '');
      const newDir = `${parentDir}/${newSlug}`;
      const processed = await _moveSchedaCartella(oldDir, newDir, `Rinomina ${proc.slug} → ${newSlug}`);
      const refs = await _updateSchedaSlugReferences(proc.slug, newSlug);
      toast(`Rinominata (${processed} file, ${refs} riferimenti aggiornati)`, 'success');
      await buildIndex();
      renderNavTree();
      if (state.currentView === 'procedura' && state.currentParams?.slug === slug) navigate('procedura', { slug: newSlug });
    }
  });
}

// Popup condiviso per rinominare lo slug di una scheda (procedura o clinica).
// Mostra il vecchio slug, un campo per il nuovo, validazione live, e un avviso che i
// riferimenti verranno aggiornati. opts: { tipo, titolo, oldSlug, existsFn, doRename }.
function _openRenameSchedaModal(opts) {
  const body = `
    <div style="display:flex;flex-direction:column;gap:14px;">
      <div>
        <div style="font-size:11px;font-family:var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-muted);margin-bottom:4px;">Scheda</div>
        <div style="font-size:15px;color:var(--ink);">${escapeHtml(opts.titolo)}</div>
      </div>
      <div>
        <div style="font-size:11px;font-family:var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-muted);margin-bottom:4px;">Slug attuale</div>
        <div style="font-size:14px;font-family:var(--mono);color:var(--ink-soft);background:var(--bg-sink);padding:6px 10px;border-radius:3px;word-break:break-all;">${escapeHtml(opts.oldSlug)}</div>
      </div>
      <div>
        <div style="font-size:11px;font-family:var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-muted);margin-bottom:4px;">Nuovo slug</div>
        <input type="text" id="rename-slug-input" value="${escapeHtml(opts.oldSlug)}" autocomplete="off" autocapitalize="off" spellcheck="false"
          style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--rule);border-radius:3px;font-family:var(--mono);font-size:14px;background:var(--bg-raised);color:var(--ink);">
        <div id="rename-slug-msg" style="font-size:12px;margin-top:6px;min-height:16px;color:var(--ink-muted);">Solo minuscole, cifre e trattini.</div>
      </div>
      <div style="font-size:12px;color:var(--ink-muted);line-height:1.5;border-top:1px solid var(--rule-soft);padding-top:10px;">
        ⓘ Verrà spostata l'intera cartella (scheda.md + img/). Tutti i collegamenti da altre schede che puntano a questo slug saranno aggiornati automaticamente. L'operazione richiede più commit su GitHub.
      </div>
    </div>`;
  showModal({
    title: 'Rinomina slug',
    body,
    actions: [
      { label: 'Annulla', variant: 'ghost', onClick: () => closeModal() },
      { label: 'Rinomina', onClick: async (btn) => {
          const input = document.getElementById('rename-slug-input');
          const newSlug = (input.value || '').trim();
          if (!newSlug || newSlug === opts.oldSlug) { closeModal(); return; }
          if (!/^[a-z0-9-]+$/.test(newSlug)) { toast('Slug non valido (solo minuscole, cifre, trattini)', 'error'); return; }
          if (opts.existsFn(newSlug)) { toast('Slug già esistente', 'error'); return; }
          state._renameNewSlug = newSlug;
          await runWithSpinner(btn, async () => {
            try { await opts.doRename(); closeModal(); }
            catch (e) { toast('Errore: ' + e.message, 'error'); }
          });
        }
      }
    ]
  });
  // Validazione live: abilita/disabilita il pulsante e mostra il messaggio.
  setTimeout(() => {
    const input = document.getElementById('rename-slug-input');
    const msg = document.getElementById('rename-slug-msg');
    if (!input) return;
    input.focus(); input.select();
    const validate = () => {
      const v = (input.value || '').trim();
      if (!v || v === opts.oldSlug) { msg.textContent = 'Inserisci un nuovo slug diverso da quello attuale.'; msg.style.color = 'var(--ink-muted)'; }
      else if (!/^[a-z0-9-]+$/.test(v)) { msg.textContent = '✕ Caratteri non validi (solo minuscole, cifre, trattini).'; msg.style.color = 'var(--danger)'; }
      else if (opts.existsFn(v)) { msg.textContent = '✕ Esiste già una scheda con questo slug.'; msg.style.color = 'var(--danger)'; }
      else { msg.textContent = '✓ Slug valido.'; msg.style.color = 'var(--success, #2e7d32)'; }
    };
    input.addEventListener('input', validate);
    validate();
  }, 0);
}

async function moveProcedura(slug) {
  if (bloccaSeNonModifica('procedure')) return;
  const proc = state.index.procedure.find(p => p.slug === slug);
  if (!proc) return;
  const macroOrder = ['bedside','richieste','farmacologiche','emergenze','gestione'];
  const currentCat = proc.categoria;
  const currentSub = proc.sottocategoria || '';

  // Opzioni sottocategoria per una data categoria (esistenti) + opzione "nessuna" + "nuova…".
  const subOptionsFor = (cat) => {
    const subs = [...new Set(state.index.procedure.filter(p => p.categoria === cat).map(p => p.sottocategoria).filter(Boolean))].sort();
    return subs;
  };
  const buildSubSelect = (cat, selected) => {
    const subs = subOptionsFor(cat);
    const opts = [`<option value="">— Nessuna sottocategoria —</option>`]
      .concat(subs.map(s => `<option value="${escapeHtml(s)}" ${s === selected ? 'selected' : ''}>${escapeHtml(s)}</option>`))
      .concat([`<option value="__new__">+ Nuova sottocategoria…</option>`]);
    return opts.join('');
  };
  const catOpts = macroOrder.map(c => `<option value="${c}" ${c === currentCat ? 'selected' : ''}>${escapeHtml(CATEGORIA_LABELS[c] || c)}</option>`).join('');

  const body = `
    <div style="display:flex;flex-direction:column;gap:14px;">
      <div>
        <div style="font-size:11px;font-family:var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-muted);margin-bottom:4px;">Scheda</div>
        <div style="font-size:15px;color:var(--ink);">${escapeHtml(proc.titolo || slug)}</div>
        <div style="font-size:12px;color:var(--ink-muted);margin-top:2px;">Attuale: ${escapeHtml(CATEGORIA_LABELS[currentCat] || currentCat)}${currentSub ? ' / ' + escapeHtml(currentSub) : ''}</div>
      </div>
      <div>
        <div style="font-size:11px;font-family:var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-muted);margin-bottom:4px;">Categoria destinazione</div>
        <select id="move-cat-select" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--rule);border-radius:3px;font-size:14px;background:var(--bg-raised);color:var(--ink);">${catOpts}</select>
      </div>
      <div>
        <div style="font-size:11px;font-family:var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-muted);margin-bottom:4px;">Sottocategoria destinazione</div>
        <select id="move-sub-select" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--rule);border-radius:3px;font-size:14px;background:var(--bg-raised);color:var(--ink);">${buildSubSelect(currentCat, currentSub)}</select>
        <input type="text" id="move-sub-new" placeholder="slug nuova sottocategoria (minuscole, cifre, trattini)" autocomplete="off"
          style="display:none;width:100%;box-sizing:border-box;margin-top:6px;padding:8px 10px;border:1px solid var(--rule);border-radius:3px;font-family:var(--mono);font-size:13px;background:var(--bg-raised);color:var(--ink);">
      </div>
      <div style="font-size:12px;color:var(--ink-muted);line-height:1.5;border-top:1px solid var(--rule-soft);padding-top:10px;">
        ⓘ Verrà spostata l'intera cartella (scheda.md + img/). Lo slug della scheda resta invariato, quindi i collegamenti non cambiano. Più commit su GitHub.
      </div>
    </div>`;

  showModal({
    title: 'Sposta scheda',
    body,
    actions: [
      { label: 'Annulla', variant: 'ghost', onClick: () => closeModal() },
      { label: 'Sposta', onClick: async (btn) => {
          const destCat = document.getElementById('move-cat-select').value;
          const subSel = document.getElementById('move-sub-select').value;
          let destSub = subSel;
          if (subSel === '__new__') {
            destSub = (document.getElementById('move-sub-new').value || '').trim();
            if (!destSub) { toast('Inserisci lo slug della nuova sottocategoria', 'error'); return; }
          }
          if (destSub && !/^[a-z0-9-]+$/.test(destSub)) { toast('Slug sottocategoria non valido', 'error'); return; }
          if (destCat === currentCat && destSub === currentSub) { toast('Destinazione uguale alla posizione attuale', 'info'); return; }
          await runWithSpinner(btn, async () => {
            try { await _doMoveProcedura(proc, destCat, destSub); closeModal(); }
            catch (e) { toast('Errore: ' + e.message, 'error'); }
          });
        }
      }
    ]
  });
  // Quando cambia la categoria, ripopolo le sottocategorie; gestisco l'opzione "+ Nuova…".
  setTimeout(() => {
    const catSel = document.getElementById('move-cat-select');
    const subSel = document.getElementById('move-sub-select');
    const subNew = document.getElementById('move-sub-new');
    if (!catSel || !subSel) return;
    const refreshNewVisibility = () => { subNew.style.display = subSel.value === '__new__' ? 'block' : 'none'; if (subSel.value === '__new__') subNew.focus(); };
    catSel.addEventListener('change', () => {
      subSel.innerHTML = buildSubSelect(catSel.value, '');
      refreshNewVisibility();
    });
    subSel.addEventListener('change', refreshNewVisibility);
  }, 0);
}

// Esegue lo spostamento effettivo di una procedura in categoria/sottocategoria date.
async function _doMoveProcedura(proc, destCat, destSub) {
  const slug = proc.slug;
  const newDir = `content/procedure/${destCat}/${destSub ? destSub + '/' : ''}${slug}`;
  const newPath = `${newDir}/scheda.md`;
  if (newPath === proc.path) { toast('Path invariato', 'info'); return; }

  const newFm = { ...proc, categoria: destCat };
  if (destSub) newFm.sottocategoria = destSub; else delete newFm.sottocategoria;
  delete newFm.body; delete newFm.body_preview; delete newFm.path; delete newFm.sha;
  delete newFm.tempo_esecuzione_min;
  const newSchedaContent = stringifyMarkdown(newFm, proc.body || '');

  toast('Spostamento in corso...', 'info');
  const oldDir = _schedaDir(proc);
  const items = await gh.listDir(oldDir);
  let moved = 0;
  for (const it of items) {
    if (it.type === 'dir') {
      moved += await _moveSchedaCartella(`${oldDir}/${it.name}`, `${newDir}/${it.name}`, `Sposta ${slug} → ${destCat}`);
    } else if (it.type === 'file' && it.name !== 'scheda.md') {
      const file = await gh.getFile(`${oldDir}/${it.name}`);
      if (!file) continue;
      await gh.putFile(`${newDir}/${it.name}`, file.content, null, `Sposta ${slug}: copia ${it.name}`);
      await gh.deleteFile(`${oldDir}/${it.name}`, file.sha, `Sposta ${slug}: elimina vecchio ${it.name}`);
      moved++;
    }
  }
  await gh.putFile(newPath, newSchedaContent, null, `Sposta ${slug} → ${destCat}/${destSub || ''}`);
  await gh.deleteFile(proc.path, proc.sha, `Elimina vecchio ${slug} (spostamento completato)`);
  toast(`Spostata (${moved + 1} file)`, 'success');
  await buildIndex();
  renderNavTree();
  if (state.currentView === 'procedura' && state.currentParams?.slug === slug) navigate('procedura', { slug });
}

async function renameModulo(slug) {
  // I moduli compilabili sono cartelle con boxes.yml + pagine PNG.
  // Rinominare richiede operazioni multi-file su tutta la cartella + aggiornamento di moduli/index.yml.
  // Disabilitato per ora: arriverà nelle tappe successive del refactor moduli.
  return toast('Rinomina moduli compilabili non ancora supportata. Modifica content/moduli/index.yml manualmente.', 'warning', 4000);
}

// Helper: find which source file (aopd/osa/iov) contains a contact or group
function findNumeriSource(target /* {contattoId} | {groupId} */) {
  if (target.contattoId) {
    for (const g of (state.index.numeri?.gruppi || [])) {
      if ((g.contatti || []).find(c => c.id === target.contattoId)) return 'aopd';
    }
    for (const src of ['osa', 'iov']) {
      const ext = state.index.numeriExtended?.[src];
      if (!ext) continue;
      for (const g of (ext.gruppi || [])) {
        if ((g.contatti || []).find(c => c.id === target.contattoId)) return src;
      }
    }
  } else if (target.groupId) {
    if ((state.index.numeri?.gruppi || []).find(g => g.id === target.groupId)) return 'aopd';
    for (const src of ['osa', 'iov']) {
      if ((state.index.numeriExtended?.[src]?.gruppi || []).find(g => g.id === target.groupId)) return src;
    }
  }
  return null;
}

function getNumeriDataForSource(src) {
  if (src === 'aopd') return state.index.numeri || {};
  return state.index.numeriExtended?.[src] || {};
}

async function saveNumeriForSource(src, data, changeDesc) {
  const path = src === 'aopd' ? 'content/numeri.yml' : `content/numeri-${src}.yml`;
  const file = await gh.getFile(path);
  // Strip internal _-prefixed keys before serialization
  const clean = {};
  Object.keys(data).forEach(k => { if (!k.startsWith('_')) clean[k] = data[k]; });
  // Strip _source from groups
  if (clean.gruppi) {
    clean.gruppi = clean.gruppi.map(g => {
      const c = { ...g };
      delete c._source;
      return c;
    });
  }
  const content = `# Rubrica telefonica ${src.toUpperCase()}\n# Gestita dall'app — modifica con cautela\n\n` +
    jsyaml.dump(clean, { lineWidth: 120, noRefs: true, sortKeys: false });
  // Messaggio commit: generico base + descrizione dettagliata se fornita
  // Esempi: "Aggiorna numeri-aopd (by marco) — modifica contatto: Case Manager Malattie Neuromuscolari"
  const baseMsg = `Aggiorna numeri-${src}.yml (by ${state.session.username})`;
  const fullMsg = changeDesc ? `${baseMsg} — ${changeDesc}` : baseMsg;
  await gh.putFile(path, content, file ? file.sha : null, fullMsg);
}

// Aggiorna dinamicamente il campo sottosezione in base alla sezione scelta nel modale contatto
function updateCESottosezione() {
  const sezInput = document.getElementById('ce-sezione');
  const wrap = document.getElementById('ce-sottosezione-wrap');
  const list = document.getElementById('ce-sottosezione-list');
  const input = document.getElementById('ce-sottosezione');
  if (!sezInput || !wrap || !list) return;
  const sezVal = (sezInput.value || '').trim().toLowerCase();
  // Trova il gruppo dal modale (ricerco tramite l'id nel dataset — useremo il currente)
  const gruppoId = wrap.dataset.gruppoId;
  const grp = gruppoId ? state.index?.numeri?.gruppi?.find(x => x.id === gruppoId) : null;
  const sezione = grp?.sezioni?.find(s => (s.nome || '').toLowerCase() === sezVal);
  const subs = sezione?.sottosezioni || [];
  if (subs.length) {
    wrap.style.display = '';
    list.innerHTML = subs.map(s => `<option value="${escapeHtml(s.nome)}">`).join('');
  } else {
    wrap.style.display = 'none';
    if (input) input.value = '';
  }
}

// Open the contact editor modal. mode = 'new' | 'edit'
function openContattoEditor({ mode, gruppoId, contatto }) {
  if (bloccaSeNonModifica('numeri')) return;
  const isNew = mode === 'new';
  const c = contatto || {};
  const numeriStr = (c.numeri || []).join(', ');
  const cellularePersonaleStr = Array.isArray(c.cellulare_personale) ? c.cellulare_personale.join(', ') : (c.cellulare_personale || '');
  const cellulareAziendaleStr = Array.isArray(c.cellulare_aziendale) ? c.cellulare_aziendale.join(', ') : (c.cellulare_aziendale || '');
  const tagStr = (c.tag || []).join(', ');
  // Raccolgo tutti i tag già usati nei contatti (di tutte le sorgenti) per la lista di scelta,
  // più alcuni suggerimenti fissi utili.
  const allTagsSet = new Set(['prenotazioni', 'ambulatorio', 'consulente']);
  (state.index?.numeri?.gruppi || []).forEach(g => (g.contatti || []).forEach(ct => (ct.tag || []).forEach(t => { if (t) allTagsSet.add(t); })));
  const allTagsOptions = [...allTagsSet].sort((a, b) => a.localeCompare(b)).map(t => `<option value="${escapeHtml(t)}">`).join('');
  const body = `
    <form id="contatto-form" onsubmit="return false;" style="display:flex;flex-direction:column;gap:12px;">
      <div class="field">
        <label>Etichetta <span style="color:var(--danger);">*</span></label>
        <input type="text" id="ce-etichetta" value="${escapeHtml(c.etichetta || '')}" placeholder="es. Medico di Guardia" required>
      </div>
      <div class="field">
        <label>Nome breve <span style="font-weight:normal;color:var(--ink-muted);">(mostrato quando lo spazio è poco, es. su mobile e nei preferiti)</span></label>
        <input type="text" id="ce-nome-breve" value="${escapeHtml(c.nome_breve || '')}" placeholder="es. Guardia neuro">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="field">
          <label>Numeri interni</label>
          <input type="text" id="ce-numeri" value="${escapeHtml(numeriStr)}" class="mono-input" placeholder="es. 5314, 5315">
          <div style="font-size:11px;color:var(--ink-muted);margin-top:3px;">Separati da virgola</div>
        </div>
        <div class="field">
          <label>Numero breve</label>
          <input type="text" id="ce-breve" value="${escapeHtml(c.breve ? String(c.breve) : '')}" class="mono-input" placeholder="es. 97928">
          <div style="font-size:11px;color:var(--ink-muted);margin-top:3px;">5 cifre, di solito 97xxx</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="field">
          <label>Cellulare personale <span style="color:var(--ink-muted);font-weight:400;font-size:11px;">("pers.")</span></label>
          <input type="text" id="ce-cellulare-personale" value="${escapeHtml(cellularePersonaleStr)}" class="mono-input" placeholder="es. 334.6652687">
          <div style="font-size:11px;color:var(--ink-muted);margin-top:3px;">Numero privato del singolo operatore</div>
        </div>
        <div class="field">
          <label>Cellulare aziendale</label>
          <input type="text" id="ce-cellulare-pub" value="${escapeHtml(cellulareAziendaleStr)}" class="mono-input" placeholder="es. 347.1234567">
          <div style="font-size:11px;color:var(--ink-muted);margin-top:3px;">Numero pubblico dell'ospedale</div>
        </div>
      </div>
      <div class="field">
        <label>Email</label>
        <input type="text" id="ce-email" value="${escapeHtml(c.email || '')}" class="mono-input" placeholder="es. neurologia@aopd.veneto.it">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="field">
          <label>Sezione (ruolo)</label>
          <input type="text" id="ce-sezione" value="${escapeHtml(c.sezione || '')}" list="ce-sezione-list" placeholder="es. Studi Medici" oninput="updateCESottosezione()">
          <datalist id="ce-sezione-list">
            ${(() => {
              const std = ['Degenze','Studi Medici','Ambulatori','Segreteria e Direzione','Day Hospital','Laboratorio','Portineria','Coordinamento','Tecnici','Sala Operatoria','Terapia Intensiva','Semi Intensiva','UCIC','UTIC','Emodinamica','Elettrofisiologia','Riabilitazione','Libera Professione','Altro'];
              const grp = state.index?.numeri?.gruppi?.find(x => x.id === gruppoId) || state.index?.numeriExtended?.osa?.gruppi?.find(x => x.id === gruppoId) || state.index?.numeriExtended?.iov?.gruppi?.find(x => x.id === gruppoId);
              // Preferisco i nomi definiti in sezioni (se presenti)
              const fromSezioni = grp?.sezioni ? grp.sezioni.map(s => s.nome).filter(Boolean) : [];
              const fromContatti = grp ? [...new Set((grp.contatti || []).map(x => x.sezione).filter(Boolean))] : [];
              const all = [...new Set([...fromSezioni, ...fromContatti, ...std])].sort((a,b) => a.localeCompare(b, 'it'));
              return all.map(s => `<option value="${escapeHtml(s)}">`).join('');
            })()}
          </datalist>
          <div style="font-size:11px;color:var(--ink-muted);margin-top:3px;">Scegli o digita una nuova sezione</div>
        </div>
        <div class="field">
          <label>Edificio</label>
          <input type="text" id="ce-edificio" value="${escapeHtml(c.edificio || '')}" list="ce-edificio-list" placeholder="es. Centro Gallucci">
          <datalist id="ce-edificio-list">
            ${(() => {
              // Edifici già usati nella stessa UOC (priorità) + tutti gli edifici canonici
              const grp = state.index?.numeri?.gruppi?.find(x => x.id === gruppoId) || state.index?.numeriExtended?.osa?.gruppi?.find(x => x.id === gruppoId) || state.index?.numeriExtended?.iov?.gruppi?.find(x => x.id === gruppoId);
              const fromUOC = new Set();
              if (grp?.ubicazione?.struttura) fromUOC.add(grp.ubicazione.struttura);
              (grp?.sezioni || []).forEach(s => { if (s.edificio) fromUOC.add(s.edificio); });
              (grp?.contatti || []).forEach(x => { if (x.edificio) fromUOC.add(x.edificio); });
              // Tutti gli edifici canonici dall'app
              const allEdifici = new Set();
              const allGroups = [
                ...(state.index?.numeri?.gruppi || []),
                ...(state.index?.numeriExtended?.osa?.gruppi || []),
                ...(state.index?.numeriExtended?.iov?.gruppi || []),
              ];
              allGroups.forEach(g => {
                if (g.ubicazione?.struttura) allEdifici.add(g.ubicazione.struttura);
                (g.sezioni || []).forEach(s => { if (s.edificio) allEdifici.add(s.edificio); });
                (g.contatti || []).forEach(x => { if (x.edificio) allEdifici.add(x.edificio); });
              });
              // Ordine: prima quelli della UOC corrente, poi gli altri
              const uocList = [...fromUOC].sort((a,b) => a.localeCompare(b, 'it'));
              const restList = [...allEdifici].filter(e => !fromUOC.has(e)).sort((a,b) => a.localeCompare(b, 'it'));
              return [...uocList, ...restList].map(e => `<option value="${escapeHtml(e)}">`).join('');
            })()}
          </datalist>
          <div style="font-size:11px;color:var(--ink-muted);margin-top:3px;">Scegli o digita un nuovo edificio</div>
        </div>
        <div class="field">
          <label>Piano</label>
          <input type="text" id="ce-piano" value="${escapeHtml(c.piano || '')}" list="ce-piano-list" placeholder="es. 2° piano">
          <datalist id="ce-piano-list">
            <option value="piano terra">
            <option value="piano rialzato">
            <option value="1° piano">
            <option value="2° piano">
            <option value="3° piano">
            <option value="4° piano">
            <option value="5° piano">
            <option value="6° piano">
            <option value="7° piano">
            <option value="8° piano">
            <option value="9° piano">
            <option value="10° piano">
            <option value="interrato">
            <option value="seminterrato">
            <option value="mezzanino">
            <option value="soppalco">
          </datalist>
        </div>
      </div>
      <div class="field" id="ce-sottosezione-wrap" data-gruppo-id="${escapeHtml(gruppoId)}" style="${(() => {
        // Mostra il campo sottosezione solo se la sezione scelta ha sottosezioni definite
        const grp = state.index?.numeri?.gruppi?.find(x => x.id === gruppoId);
        const sezione = grp?.sezioni?.find(s => (s.nome || '').toLowerCase() === (c.sezione || '').toLowerCase());
        return sezione?.sottosezioni?.length ? '' : 'display:none;';
      })()}">
        <label>Sottosezione</label>
        <input type="text" id="ce-sottosezione" value="${escapeHtml(c.sottosezione || '')}" list="ce-sottosezione-list" placeholder="es. Studi Medici">
        <datalist id="ce-sottosezione-list">
          ${(() => {
            const grp = state.index?.numeri?.gruppi?.find(x => x.id === gruppoId);
            const sezione = grp?.sezioni?.find(s => (s.nome || '').toLowerCase() === (c.sezione || '').toLowerCase());
            return (sezione?.sottosezioni || []).map(s => `<option value="${escapeHtml(s.nome)}">`).join('');
          })()}
        </datalist>
        <div style="font-size:11px;color:var(--ink-muted);margin-top:3px;">Solo se la sezione ha sottosezioni definite</div>
      </div>
      <div class="field">
        <label>Orari</label>
        <input type="text" id="ce-orari" value="${escapeHtml(c.orari || '')}" placeholder="es. L/V 8-14">
      </div>
      <div class="field">
        <label>Tag <span style="font-weight:normal;color:var(--ink-muted);">(per la ricerca — scegli dai suggerimenti o aggiungine di nuovi, separati da virgola)</span></label>
        <input type="text" id="ce-tag" value="${escapeHtml(tagStr)}" list="ce-tag-list" placeholder="es. prenotazioni, ambulatorio, consulente">
        <datalist id="ce-tag-list">${allTagsOptions}</datalist>
      </div>
      <div class="field">
        <label>Note</label>
        <textarea id="ce-note" rows="2" style="width:100%;resize:vertical;font-family:var(--sans);font-size:13px;padding:8px;">${escapeHtml(c.note || '')}</textarea>
      </div>
    </form>`;
  showModal({
    title: isNew ? 'Nuovo contatto' : 'Modifica contatto',
    subtitle: `Gruppo: ${escapeHtml(gruppoId)}`,
    body,
    actions: [
      { label: 'Annulla', variant: 'ghost', onClick: () => closeModal() },
      { label: isNew ? 'Crea' : 'Salva', onClick: async () => {
        const etichetta = $('ce-etichetta').value.trim();
        if (!etichetta) return toast('Etichetta obbligatoria', 'warning');
        const numeri = $('ce-numeri').value.split(',').map(s => s.trim()).filter(Boolean).map(n => /^\d+$/.test(n) ? parseInt(n, 10) : n);
        const breveStr = $('ce-breve').value.trim();
        const cellularePersonaleStr2 = $('ce-cellulare-personale').value.trim();
        const cellularePersonaleList = cellularePersonaleStr2.split(',').map(s => s.trim()).filter(Boolean);
        const cellulareAziendaleStr2 = $('ce-cellulare-pub') ? $('ce-cellulare-pub').value.trim() : '';
        const cellulareAziendaleList = cellulareAziendaleStr2.split(',').map(s => s.trim()).filter(Boolean);
        const email = $('ce-email').value.trim();
        const sezione = $('ce-sezione').value.trim();
        const edificio = $('ce-edificio').value.trim();
        const piano = $('ce-piano').value.trim();
        const orari = $('ce-orari').value.trim();
        const tag = $('ce-tag').value.split(',').map(s => s.trim()).filter(Boolean);
        const note = $('ce-note').value.trim();
        const nomeBreveEl = document.getElementById('ce-nome-breve');
        const nomeBreve = nomeBreveEl ? nomeBreveEl.value.trim() : '';
        // Parto dai campi esistenti del contatto (in modifica) così NON perdo le proprietà
        // non gestite da questo form — in particolare `kind` (chip guardia/reparto/utile),
        // impostato altrove. Poi sovrascrivo/ripulisco solo i campi del form.
        const newC = isNew
          ? { id: (slugifyLocal(`${gruppoId}-${etichetta}`).slice(0, 60) + '-' + Date.now().toString(36).slice(-4)), etichetta }
          : { ...c, etichetta };
        // Campi gestiti dal form: li ricostruisco da zero (set se valorizzati, delete se vuoti),
        // così svuotare un campo nel form lo rimuove davvero.
        if (numeri.length) newC.numeri = numeri; else delete newC.numeri;
        if (cellularePersonaleList.length === 1) newC.cellulare_personale = cellularePersonaleList[0];
        else if (cellularePersonaleList.length > 1) newC.cellulare_personale = cellularePersonaleList;
        else delete newC.cellulare_personale;
        if (cellulareAziendaleList.length === 1) newC.cellulare_aziendale = cellulareAziendaleList[0];
        else if (cellulareAziendaleList.length > 1) newC.cellulare_aziendale = cellulareAziendaleList;
        else delete newC.cellulare_aziendale;
        if (breveStr) { const n = parseInt(breveStr, 10); newC.breve = isNaN(n) ? breveStr : n; } else delete newC.breve;
        if (email) newC.email = email; else delete newC.email;
        if (sezione) newC.sezione = sezione; else delete newC.sezione;
        const sottosezioneEl = document.getElementById('ce-sottosezione');
        const sottosezione = sottosezioneEl ? sottosezioneEl.value.trim() : '';
        if (sottosezione) newC.sottosezione = sottosezione; else delete newC.sottosezione;
        if (edificio) newC.edificio = edificio; else delete newC.edificio;
        if (piano) newC.piano = piano; else delete newC.piano;
        if (orari) newC.orari = orari; else delete newC.orari;
        if (tag.length) newC.tag = tag; else delete newC.tag;
        if (note) newC.note = note; else delete newC.note;
        if (nomeBreve) newC.nome_breve = nomeBreve; else delete newC.nome_breve;
        // Rimuovo eventuali proprietà interne di runtime che non vanno persistite.
        delete newC._gruppo; delete newC._source; delete newC._classify;
        if (!newC.numeri && !newC.cellulare_personale && !newC.cellulare_aziendale && !newC.breve) {
          return toast('Inserire almeno un numero (interno, cellulare o breve)', 'warning');
        }
        // Find source and group
        const src = findNumeriSource(isNew ? { groupId: gruppoId } : { contattoId: c.id }) || 'aopd';
        const data = { ...getNumeriDataForSource(src) };
        const newGruppi = (data.gruppi || []).map(g => {
          if (g.id !== gruppoId) return g;
          let contatti = g.contatti || [];
          if (isNew) contatti = [...contatti, newC];
          else contatti = contatti.map(x => x.id === c.id ? newC : x);
          return { ...g, contatti };
        });
        try {
          const etichettaSnap = (newC && newC.etichetta) ? newC.etichetta : (c && c.etichetta) || '(senza nome)';
          const desc = isNew
            ? `aggiungi contatto: ${etichettaSnap}`
            : `modifica contatto: ${etichettaSnap}`;
          await saveNumeriForSource(src, { ...data, gruppi: newGruppi }, desc);
          toast(isNew ? 'Contatto creato' : 'Contatto aggiornato', 'success');
          closeModal();
          await buildIndex();
          if (state.showExtendedNumeri?.osa) await loadExtendedNumeri('osa');
          if (state.showExtendedNumeri?.iov) await loadExtendedNumeri('iov');
          renderNavTree();
          if (state.currentView === 'numeri') navigate('numeri', state.currentParams || {});
        } catch (e) { toast('Errore: ' + e.message, 'error'); }
      } }
    ]
  });
}

function slugifyLocal(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
}

async function editContatto(contattoId) {
  // Search across all visible groups to find the contact
  for (const g of getVisibleNumeriGroups()) {
    const c = (g.contatti || []).find(x => x.id === contattoId);
    if (c) {
      openContattoEditor({ mode: 'edit', gruppoId: g.id, contatto: c });
      return;
    }
  }
  toast('Contatto non trovato', 'error');
}

async function deleteContatto(contattoId) {
  if (!isAdmin()) return toast("Solo l'admin può eliminare contatti", 'warning');
  // Find source and group
  let foundGroup = null, foundContact = null, src = null;
  for (const sourceId of ['aopd','osa','iov']) {
    const data = getNumeriDataForSource(sourceId);
    for (const g of (data.gruppi || [])) {
      const c = (g.contatti || []).find(x => x.id === contattoId);
      if (c) { foundGroup = g; foundContact = c; src = sourceId; break; }
    }
    if (foundContact) break;
  }
  if (!foundContact) return;
  if (!confirm(`Eliminare contatto "${foundContact.etichetta}"?`)) return;
  const data = { ...getNumeriDataForSource(src) };
  const newGruppi = (data.gruppi || []).map(g => g.id !== foundGroup.id ? g : { ...g, contatti: g.contatti.filter(c => c.id !== contattoId) });
  try {
    await saveNumeriForSource(src, { ...data, gruppi: newGruppi }, `elimina contatto: ${foundContact.etichetta || contattoId}`);
    toast('Contatto eliminato', 'success');
    await buildIndex();
    if (state.showExtendedNumeri?.osa) await loadExtendedNumeri('osa');
    if (state.showExtendedNumeri?.iov) await loadExtendedNumeri('iov');
    renderNavTree();
    if (state.currentView === 'numeri') navigate('numeri', state.currentParams || {});
  } catch (e) { toast('Errore: ' + e.message, 'error'); }
}

// Imposta o rimuove il tag (kind) di un contatto: guardia/reparto/utile, 'none' per
// "senza tag esplicito" (no auto-detect), o null per ripristinare l'auto-detect.
async function setContactKind(contattoId, newKind) {
  if (bloccaSeNonModifica('numeri')) return;
  // Se siamo in edit mode, mettiamo la modifica in pending (da salvare con "Salva modifiche")
  if (navState && navState.editMode) {
    return stageTagEdit(contattoId, newKind);
  }
  // Fuori edit mode: salva subito (retrocompatibilità)
  return _commitSingleTagEdit(contattoId, newKind);
}

function stageTagEdit(contattoId, newKind) {
  if (!state.pendingTagEdits) state.pendingTagEdits = new Map();
  // Trova valore originale dal DB (null/undefined = mai taggato esplicitamente)
  let origKind = null;
  for (const sourceId of ['aopd','osa','iov']) {
    const data = getNumeriDataForSource(sourceId);
    if (!data) continue;
    for (const g of (data.gruppi || [])) {
      const c = (g.contatti || []).find(x => x.id === contattoId);
      if (c) { origKind = c.kind || null; break; }
    }
    if (origKind) break;
  }
  // Kind attualmente visualizzato (pending se esiste, altrimenti originale)
  const currentKind = state.pendingTagEdits.has(contattoId)
    ? state.pendingTagEdits.get(contattoId)
    : origKind;
  // Click sulla chip già attiva = "rimuovi tag". Imposto 'none' come valore sentinella
  // esplicito (vs null/undefined che lascerebbe attivo l'auto-detect via classifyContatto).
  // 'none' viene salvato nel YAML così la scelta dell'utente persiste anche dopo refresh.
  let target = newKind;
  if (newKind === currentKind) target = 'none';
  // Confronto "originale": null e 'none' sono entrambi "senza tag", ma null = mai toccato
  // (auto-detect attivo) mentre 'none' = scelta esplicita (auto-detect spento). Se l'utente
  // vuole arrivare allo stato originale precedente:
  // - origKind era 'reparto' e l'utente clicca per riportarlo a 'reparto' → rimuovi pending
  // - origKind era null e l'utente arriva a 'none' tramite toggle → resta pendente perché
  //   è una vera modifica (passare da auto a "esplicitamente no tag")
  if (target === origKind) {
    state.pendingTagEdits.delete(contattoId);
  } else {
    state.pendingTagEdits.set(contattoId, target);
  }
  updateEditBanner();
  // Re-render della view corrente per riflettere il pending
  const savedScroll = window.scrollY;
  if (state.currentView === 'search' || state.currentView === 'numeri') {
    navigate(state.currentView, state.currentParams || {});
    requestAnimationFrame(() => window.scrollTo({ top: savedScroll, behavior: 'instant' }));
  }
}

function updateEditBanner() {
  const pendingCount = state.pendingTagEdits ? state.pendingTagEdits.size : 0;
  const countEl = document.getElementById('edit-pending-count');
  const commitBtn = document.getElementById('btn-commit-tags');
  const cancelBtn = document.getElementById('btn-cancel-tags');
  if (countEl) countEl.textContent = pendingCount > 0 ? `· ${pendingCount} modific${pendingCount === 1 ? 'a' : 'he'} non salvat${pendingCount === 1 ? 'a' : 'e'}` : '';
  if (commitBtn) commitBtn.style.display = pendingCount > 0 ? '' : 'none';
  if (cancelBtn) cancelBtn.style.display = pendingCount > 0 ? '' : 'none';
}

async function commitTagEdits() {
  if (!state.pendingTagEdits || state.pendingTagEdits.size === 0) return;
  const edits = Array.from(state.pendingTagEdits.entries());
  // Raggruppo per source
  const bySource = { aopd: new Map(), osa: new Map(), iov: new Map() };
  for (const [cid, kind] of edits) {
    for (const sourceId of ['aopd','osa','iov']) {
      const data = getNumeriDataForSource(sourceId);
      if (!data) continue;
      const found = (data.gruppi || []).some(g => (g.contatti || []).some(c => c.id === cid));
      if (found) { bySource[sourceId].set(cid, kind); break; }
    }
  }
  let totalSaved = 0;
  for (const sourceId of ['aopd','osa','iov']) {
    const pending = bySource[sourceId];
    if (pending.size === 0) continue;
    const data = { ...getNumeriDataForSource(sourceId) };
    const newGruppi = (data.gruppi || []).map(g => ({
      ...g,
      contatti: (g.contatti || []).map(c => {
        if (!pending.has(c.id)) return c;
        const newKind = pending.get(c.id);
        const { kind, ...rest } = c;
        return newKind ? { ...rest, kind: newKind } : rest;
      })
    }));
    try {
      // Raccolgo etichette per la descrizione (max 3, poi +N altri)
      const changedLabels = [];
      for (const [cid] of pending) {
        for (const g of (data.gruppi || [])) {
          const c = (g.contatti || []).find(x => x.id === cid);
          if (c && c.etichetta) { changedLabels.push(c.etichetta); break; }
        }
      }
      const shown = changedLabels.slice(0, 3);
      const extra = changedLabels.length - shown.length;
      const desc = `aggiorna tag di ${pending.size} contatt${pending.size === 1 ? 'o' : 'i'}: ${shown.join(', ')}${extra > 0 ? ` +${extra} altr${extra === 1 ? 'o' : 'i'}` : ''}`;
      await saveNumeriForSource(sourceId, { ...data, gruppi: newGruppi }, desc);
      totalSaved += pending.size;
    } catch (e) {
      toast(`Errore salvataggio ${sourceId.toUpperCase()}: ${e.message}`, 'error');
      return;
    }
  }
  state.pendingTagEdits.clear();
  updateEditBanner();
  toast(`${totalSaved} tag salvat${totalSaved === 1 ? 'o' : 'i'}`, 'success');
  const savedScroll = window.scrollY;
  await buildIndex();
  if (state.showExtendedNumeri?.osa) await loadExtendedNumeri('osa');
  if (state.showExtendedNumeri?.iov) await loadExtendedNumeri('iov');
  renderNavTree();
  if (state.currentView) {
    navigate(state.currentView, state.currentParams || {});
    requestAnimationFrame(() => window.scrollTo({ top: savedScroll, behavior: 'instant' }));
  }
}

function cancelTagEdits() {
  if (!state.pendingTagEdits || state.pendingTagEdits.size === 0) return;
  if (!confirm(`Annullare ${state.pendingTagEdits.size} modifica/modifiche ai tag?`)) return;
  state.pendingTagEdits.clear();
  updateEditBanner();
  const savedScroll = window.scrollY;
  navigate(state.currentView, state.currentParams || {});
  requestAnimationFrame(() => window.scrollTo({ top: savedScroll, behavior: 'instant' }));
}

async function _commitSingleTagEdit(contattoId, newKind) {
  // Trova il contatto e il source
  let foundGroup = null, foundContact = null, src = null;
  for (const sourceId of ['aopd','osa','iov']) {
    const data = getNumeriDataForSource(sourceId);
    if (!data) continue;
    for (const g of (data.gruppi || [])) {
      const c = (g.contatti || []).find(x => x.id === contattoId);
      if (c) { foundGroup = g; foundContact = c; src = sourceId; break; }
    }
    if (foundContact) break;
  }
  if (!foundContact) return toast('Contatto non trovato', 'error');

  // Se il kind è già quello richiesto, rimuovilo (toggle off)
  if (foundContact.kind === newKind) newKind = null;

  const data = { ...getNumeriDataForSource(src) };
  const newGruppi = (data.gruppi || []).map(g => {
    if (g.id !== foundGroup.id) return g;
    return {
      ...g,
      contatti: (g.contatti || []).map(c => {
        if (c.id !== contattoId) return c;
        const { kind, ...rest } = c;
        return newKind ? { ...rest, kind: newKind } : rest;
      })
    };
  });

  // Preserva scroll prima del re-render
  const savedScroll = window.scrollY;
  try {
    const tagLabel = newKind || 'automatico';
    await saveNumeriForSource(src, { ...data, gruppi: newGruppi }, `tag "${tagLabel}" su contatto: ${foundContact.etichetta || contattoId}`);
    const label = newKind ? newKind : 'automatico';
    toast(`Tag aggiornato: ${label}`, 'success', 1200);
    await buildIndex();
    if (state.showExtendedNumeri?.osa) await loadExtendedNumeri('osa');
    if (state.showExtendedNumeri?.iov) await loadExtendedNumeri('iov');
    renderNavTree();
    if (state.currentView === 'numeri') {
      navigate('numeri', state.currentParams || {});
      requestAnimationFrame(() => window.scrollTo({ top: savedScroll, behavior: 'instant' }));
    }
  } catch (e) { toast('Errore: ' + e.message, 'error'); }
}

async function renameMacroCategoria(macro) {
  if (!isAdmin()) return toast('Solo l\'admin può rinominare macro categorie', 'warning');
  const label = CATEGORIA_LABELS[macro] || macro;

  // Offer both rename and cross-section move options
  const choice = prompt(
    `Operazione su macro "${label}" (${macro}):\n\n` +
    `1 = Rinomina (cambia slug, resta in Procedure)\n` +
    `2 = Sposta a Clinica (diventa sottocategoria di Clinica)\n` +
    `3 = Annulla\n\n` +
    `Scelta:`, '1'
  );
  if (!choice || choice === '3') return;
  if (choice === '2') return moveMacroToClinica(macro);
  if (choice !== '1') return toast('Scelta non valida', 'error');

  // Rename
  const newName = prompt(`Nuovo slug per "${macro}" (minuscole, cifre, trattini):`, macro);
  if (!newName || newName === macro) return;
  if (!/^[a-z0-9-]+$/.test(newName)) return toast('Slug non valido', 'error');

  const affected = state.index.procedure.filter(p => p.categoria === macro);
  if (affected.length === 0) {
    toast('Categoria vuota: rinomina locale soltanto', 'info');
    return;
  }

  const conflicts = state.index.procedure.filter(p => p.categoria === newName);
  if (conflicts.length > 0) {
    if (!confirm(`La categoria "${newName}" contiene già ${conflicts.length} schede.\nLe schede spostate saranno unite.\nProcedere?`)) return;
  }

  const neededCommits = affected.length * 2;
  if (!await checkRateLimitFor(neededCommits + 20)) return;

  const ops = affected.map(p => {
    const newPath = p.path.replace(`/procedure/${macro}/`, `/procedure/${newName}/`);
    const newFm = { ...p, categoria: newName };
    delete newFm.body; delete newFm.body_preview; delete newFm.path; delete newFm.sha;
    const newContent = stringifyMarkdown(newFm, p.body || '');
    const oldDir = _schedaDir(p);
    const newDir = oldDir.replace(`/procedure/${macro}/`, `/procedure/${newName}/`);
    return {
      schedaSlug: p.slug, schedaTitolo: p.titolo || p.slug,
      putPath: newPath, putContent: newContent,
      deletePath: p.path, deleteSha: p.sha,
      accessoriOldDir: oldDir, accessoriNewDir: newDir,
      commitMsg: `Rinomina ${macro} → ${newName}: ${p.slug}`
    };
  });

  if (!confirm(`Rinominare macro "${macro}" → "${newName}"?\n\n${affected.length} schede spostate.\n${neededCommits} commit GitHub.`)) return;

  const result = await _githubBatchRename(`Rinomina ${macro} → ${newName}`, ops);
  if (result.ok) toast(`Rinomina completata: ${result.done}/${result.total}`, 'success');
  else toast(`Rinomina parziale: ${result.done}/${result.total}`, 'warning');
  await buildIndex();
  renderNavTree();
  if (state.currentView === 'procedure-cat') navigate('procedure', {});
}

// Move a procedure macro (e.g., emergenze) to become a clinica subcategory
async function moveMacroToClinica(macro) {
  if (!isAdmin()) return toast('Solo l\'admin può spostare macro', 'warning');

  const affected = state.index.procedure.filter(p => p.categoria === macro);
  if (affected.length === 0) {
    toast('Macro vuota: nulla da spostare', 'info');
    return;
  }

  // Target sottocategoria in clinica defaults to the macro's slug (emergenze -> clinica/emergenze/)
  const targetSub = prompt(
    `Spostare tutte le schede di "${macro}" dentro Clinica come sottocategoria.\n\n` +
    `Nome della sottocategoria in Clinica:`, macro
  );
  if (!targetSub) return;
  if (!/^[a-z0-9-]+$/.test(targetSub)) return toast('Slug non valido', 'error');

  // Check collision in clinica
  const existingClinica = (state.index.clinica || []).filter(c => c.sottocategoria === targetSub);
  if (existingClinica.length > 0) {
    if (!confirm(`In Clinica esiste già "${targetSub}" con ${existingClinica.length} schede. Le schede saranno unite.\nProcedere?`)) return;
  }

  const neededCommits = affected.length * 2;
  if (!await checkRateLimitFor(neededCommits + 20)) return;

  const ops = affected.map(p => {
    // Schema cartella per scheda: scheda.md va dentro <slug>/, e gli accessori (img/)
    // accanto seguono la nuova cartella in clinica.
    const newPath = `content/clinica/${targetSub}/${p.slug}/scheda.md`;
    const newFm = { ...p, categoria: 'clinica', sottocategoria: targetSub };
    delete newFm.body; delete newFm.body_preview; delete newFm.path; delete newFm.sha;
    // Clean obsolete fields
    delete newFm.tempo_esecuzione_min;
    const newContent = stringifyMarkdown(newFm, p.body || '');
    const oldDir = _schedaDir(p);
    const newDir = `content/clinica/${targetSub}/${p.slug}`;
    return {
      schedaSlug: p.slug, schedaTitolo: p.titolo || p.slug,
      putPath: newPath, putContent: newContent,
      deletePath: p.path, deleteSha: p.sha,
      accessoriOldDir: oldDir, accessoriNewDir: newDir,
      commitMsg: `Sposta ${p.slug}: procedure/${macro} → clinica/${targetSub}`
    };
  });

  const warnText = `Spostare ${affected.length} schede da "procedure/${macro}/" a "clinica/${targetSub}/"?\n\n` +
    `• Le schede saranno riclassificate come "schede cliniche"\n` +
    `• Useranno l'editor clinica (schema YAML avanzato per campi strutturati)\n` +
    `• I riferimenti via slug continuano a funzionare\n` +
    `• ${neededCommits} commit GitHub\n\n` +
    `Proseguire?`;
  if (!confirm(warnText)) return;

  const result = await _githubBatchRename(`Sposta ${macro} → clinica/${targetSub}`, ops);
  if (result.ok) toast(`Spostamento completato: ${result.done}/${result.total}`, 'success');
  else toast(`Spostamento parziale: ${result.done}/${result.total}. Vedi console.`, 'warning', 6000);
  await buildIndex();
  renderNavTree();
  navigate('clinica', { sub: targetSub });
}

async function deleteMacroCategoria(macro) {
  if (!isAdmin()) return toast('Solo l\'admin può eliminare macro categorie', 'warning');
  const procs = state.index.procedure.filter(p => p.categoria === macro);
  if (procs.length > 0) return toast(`Categoria non vuota (${procs.length} schede). Sposta o elimina prima le schede.`, 'warning');
  toast('Categoria vuota: nessun commit necessario. Non comparirà più nella sidebar al prossimo refresh.', 'info');
  await buildIndex();
  renderNavTree();
}

async function nuovaMacroCategoria() {
  if (!isAdmin()) return toast('Solo l\'admin può creare nuove macro categorie', 'warning');
  const name = prompt('Nome nuova macro categoria (minuscole, cifre, trattini):\n(es. "protocolli" o "linee-guida")', '');
  if (!name || !/^[a-z0-9-]+$/.test(name)) return toast('Nome non valido', 'error');
  if (CATEGORIA_LABELS[name]) return toast('Categoria già esistente', 'warning');
  // Categories are implicit: they exist when a file is in them.
  // Create a placeholder by asking to add a scheda.
  if (confirm(`La macro "${name}" sarà creata aggiungendo una nuova procedura al suo interno.\nProcedere?`)) {
    nuovaProcedura({ categoria: name });
  }
}

async function createSottocategoria(macro) {
  const name = prompt(`Nuova sottocategoria in "${CATEGORIA_LABELS[macro] || macro}" (minuscole, cifre, trattini):`, '');
  if (!name || !/^[a-z0-9-]+$/.test(name)) return toast('Nome non valido', 'error');
  // Tutti possono creare sottocategorie (solo tramite creazione scheda)
  nuovaProcedura({ categoria: macro, sottocategoria: name });
}
async function renameClinica(slug) {
  if (bloccaSeNonModifica('clinica')) return;
  const scheda = (state.index.clinica || []).find(c => c.slug === slug);
  if (!scheda) return toast('Scheda clinica non trovata', 'error');
  _openRenameSchedaModal({
    tipo: 'clinica',
    titolo: scheda.titolo || slug,
    oldSlug: slug,
    existsFn: (s) => !!(state.index.clinica || []).find(c => c.slug === s),
    doRename: async () => {
      const newSlug = state._renameNewSlug;
      const oldDir = _schedaDir(scheda);
      const parentDir = oldDir.replace(/\/[^/]+$/, '');
      const newDir = `${parentDir}/${newSlug}`;
      const processed = await _moveSchedaCartella(oldDir, newDir, `Rinomina clinica ${slug} → ${newSlug}`);
      const refs = await _updateSchedaSlugReferences(slug, newSlug);
      toast(`Rinominata (${processed} file, ${refs} riferimenti aggiornati)`, 'success');
      await buildIndex();
      renderNavTree();
      if (state.currentView === 'clinica-scheda' && state.currentParams?.slug === slug) {
        navigate('clinica-scheda', { slug: newSlug });
      }
    }
  });
}

async function renameClinicaSub(sub) {
  if (!isAdmin()) return toast('Solo l\'admin può rinominare sottocategorie cliniche', 'warning');
  const newSub = prompt(`Rinomina sottocategoria clinica "${sub}"\n\nNuovo slug (minuscole, cifre, trattini):`, sub);
  if (!newSub || newSub === sub) return;
  if (!/^[a-z0-9-]+$/.test(newSub)) return toast('Slug non valido', 'error');

  const affected = (state.index.clinica || []).filter(c => c.sottocategoria === sub);
  if (affected.length === 0) {
    toast('Sottocategoria vuota: nulla da spostare', 'info');
    return;
  }

  const conflicts = (state.index.clinica || []).filter(c => c.sottocategoria === newSub);
  if (conflicts.length > 0) {
    if (!confirm(`"${newSub}" contiene già ${conflicts.length} schede. Le schede saranno unite.\nProcedere?`)) return;
  }

  const neededCommits = affected.length * 2;
  if (!await checkRateLimitFor(neededCommits + 20)) return;

  const ops = affected.map(c => {
    const newPath = c.path.replace(`/clinica/${sub}/`, `/clinica/${newSub}/`);
    const newFm = { ...c, sottocategoria: newSub };
    delete newFm.body; delete newFm.body_preview; delete newFm.path; delete newFm.sha;
    const newContent = stringifyMarkdown(newFm, c.body || '');
    const oldDir = _schedaDir(c);
    const newDir = oldDir.replace(`/clinica/${sub}/`, `/clinica/${newSub}/`);
    return {
      schedaSlug: c.slug, schedaTitolo: c.titolo || c.slug,
      putPath: newPath, putContent: newContent,
      deletePath: c.path, deleteSha: c.sha,
      accessoriOldDir: oldDir, accessoriNewDir: newDir,
      commitMsg: `Rinomina clinica/${sub} → clinica/${newSub}: ${c.slug}`
    };
  });

  if (!confirm(`Rinominare sottocategoria "${sub}" → "${newSub}"?\n\n${affected.length} schede spostate.\n${neededCommits} commit GitHub.`)) return;

  const result = await _githubBatchRename(`Rinomina ${sub} → ${newSub}`, ops);
  if (result.ok) toast(`Rinomina completata: ${result.done}/${result.total}`, 'success');
  else toast(`Rinomina parziale: ${result.done}/${result.total}`, 'warning');
  await buildIndex();
  renderNavTree();
}

async function createClinicaSub() {
  const name = prompt('Nuova sottocategoria clinica (minuscole, cifre, trattini):', '');
  if (!name || !/^[a-z0-9-]+$/.test(name)) return toast('Nome non valido', 'error');
  // Trigger creating a new scheda in that subcategoria
  nuovaSchedaClinica({ sottocategoria: name });
}
async function nuovoGruppoNumeri() {
  if (!isAdmin()) return toast("Solo l'admin può creare nuovi gruppi di numeri", 'warning');
  openGruppoEditor({ mode: 'new' });
}

async function renameGruppoNumeri(id) {
  if (!isAdmin()) return toast("Solo l'admin può modificare gruppi", 'warning');
  // Find group across sources
  let g = null, src = null;
  for (const s of ['aopd','osa','iov']) {
    const found = (getNumeriDataForSource(s).gruppi || []).find(x => x.id === id);
    if (found) { g = found; src = s; break; }
  }
  if (!g) return toast('Gruppo non trovato', 'error');
  openGruppoEditor({ mode: 'edit', gruppo: g, source: src });
}

function openGruppoEditor({ mode, gruppo, source }) {
  const isNew = mode === 'new';
  const g = gruppo || {};
  const ub = g.ubicazione || {};
  // Suggerimenti per il campo "Tag" della UOC (coerente coi contatti). La UOC salva le parole
  // chiave di ricerca nel campo `alias`; raccolgo qui sia gli alias di gruppo già usati sia i tag
  // dei contatti, così il datalist offre le stesse scelte del form contatto.
  const allGroupTagsSet = new Set();
  [
    ...(state.index?.numeri?.gruppi || []),
    ...(state.index?.numeriExtended?.osa?.gruppi || []),
    ...(state.index?.numeriExtended?.iov?.gruppi || []),
  ].forEach(gg => {
    (gg.tag || []).forEach(a => { if (a) allGroupTagsSet.add(a); });
    (gg.contatti || []).forEach(ct => (ct.tag || []).forEach(t => { if (t) allGroupTagsSet.add(t); }));
  });
  const allGroupTagsOptions = [...allGroupTagsSet].sort((a, b) => a.localeCompare(b, 'it')).map(t => `<option value="${escapeHtml(t)}">`).join('');
  const sourceOptions = ['aopd', 'osa', 'iov'].map(s => `<option value="${s}" ${(source || 'aopd') === s ? 'selected' : ''}>${s.toUpperCase()}</option>`).join('');
  const body = `
    <form id="gruppo-form" onsubmit="return false;" style="display:flex;flex-direction:column;gap:12px;">
      <div class="field">
        <label>Nome gruppo <span style="color:var(--danger);">*</span></label>
        <input type="text" id="ge-nome" value="${escapeHtml(g.nome || '')}" placeholder="es. U.O.S.D. Stroke Unit" required>
      </div>
      <div class="field">
        <label>Nome breve <span style="color:var(--ink-muted);font-weight:400;text-transform:none;letter-spacing:0;">(versione compatta usata nelle barre contesto su mobile)</span></label>
        <input type="text" id="ge-nome-breve" value="${escapeHtml(g.nome_breve || '')}" placeholder="es. Cardiologia, ORL, Mal. Infettive">
      </div>
      <div class="field">
        <label>Ospedale</label>
        <select id="ge-source" ${isNew ? '' : 'disabled'}>${sourceOptions}</select>
        ${!isNew ? '<div style="font-size:11px;color:var(--ink-muted);margin-top:3px;">Spostamento tra ospedali non supportato — eliminare e ricreare se necessario</div>' : ''}
      </div>
      <div class="field">
        <label>Direttore / Responsabile</label>
        <input type="text" id="ge-direttore" value="${escapeHtml(g.direttore || '')}" placeholder="es. Dr. Baracchini Claudio">
      </div>
      <div class="field">
        <label>Email del gruppo</label>
        <input type="text" id="ge-email" value="${escapeHtml(g.email || '')}" class="mono-input" placeholder="es. neurologia@aopd.veneto.it">
      </div>
      <div class="field">
        <label>Tag <span style="font-weight:normal;color:var(--ink-muted);">(parole chiave per la ricerca — scegli dai suggerimenti o aggiungine, separati da virgola)</span></label>
        <input type="text" id="ge-tag" value="${escapeHtml((g.tag || []).join(', '))}" list="ge-tag-list" placeholder="es. neuro, stroke unit, prenotazioni">
        <datalist id="ge-tag-list">${allGroupTagsOptions}</datalist>
      </div>
      <fieldset style="border:1px solid var(--rule);border-radius:4px;padding:10px;">
        <legend style="font-size:12px;color:var(--ink-muted);padding:0 6px;">Ubicazione</legend>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div class="field"><label>Struttura/Edificio</label><input type="text" id="ge-struttura" value="${escapeHtml(ub.struttura || '')}" placeholder="es. Edificio Neurologia"></div>
          <div class="field"><label>Piano</label><input type="text" id="ge-piano" value="${escapeHtml(ub.piano || '')}" placeholder="es. terra, 1°, 2°"></div>
          <div class="field" style="grid-column:1/-1;"><label>Indirizzo</label><input type="text" id="ge-indirizzo" value="${escapeHtml(ub.indirizzo || '')}" placeholder="es. Via Giustiniani, 2"></div>
          <div class="field" style="grid-column:1/-1;"><label>Sede ospedale <span style="font-weight:normal;color:var(--ink-muted);">(se diversa da AOPD, es. Sant'Antonio)</span></label><input type="text" id="ge-sede" value="${escapeHtml(ub.ospedale_sede || '')}" placeholder="opzionale"></div>
        </div>
      </fieldset>
    </form>`;
  showModal({
    title: isNew ? 'Nuovo gruppo di numeri' : 'Modifica gruppo',
    subtitle: isNew ? '' : `ID: ${escapeHtml(g.id)}`,
    body,
    actions: [
      { label: 'Annulla', variant: 'ghost', onClick: () => closeModal() },
      { label: isNew ? 'Crea' : 'Salva', onClick: async () => {
        const nome = $('ge-nome').value.trim();
        if (!nome) return toast('Nome obbligatorio', 'warning');
        const sourceSelected = isNew ? $('ge-source').value : source;
        const data = { ...getNumeriDataForSource(sourceSelected) };
        const gruppi = data.gruppi || [];
        const id = g.id || slugifyLocal(nome).slice(0, 60);
        if (isNew && gruppi.find(x => x.id === id)) return toast('Esiste già un gruppo con questo id', 'error');
        const updatedGroup = { id, nome };
        const nomeBreve = $('ge-nome-breve').value.trim();
        if (nomeBreve) updatedGroup.nome_breve = nomeBreve;
        const direttore = $('ge-direttore').value.trim();
        const email = $('ge-email').value.trim();
        const struttura = $('ge-struttura').value.trim();
        const piano = $('ge-piano').value.trim();
        const indirizzo = $('ge-indirizzo').value.trim();
        const sede = $('ge-sede').value.trim();
        const tagGeEl = document.getElementById('ge-tag');
        const tagGe = tagGeEl ? tagGeEl.value.split(',').map(s => s.trim()).filter(Boolean) : [];
        if (direttore) updatedGroup.direttore = direttore;
        if (email) updatedGroup.email = email;
        if (tagGe.length) updatedGroup.tag = tagGe;
        const ubicazione = {};
        if (struttura) ubicazione.struttura = struttura;
        if (piano) ubicazione.piano = piano;
        if (indirizzo) ubicazione.indirizzo = indirizzo;
        if (sede) ubicazione.ospedale_sede = sede;
        if (Object.keys(ubicazione).length) updatedGroup.ubicazione = ubicazione;
        // Preserve existing contatti and any other group-level fields (alias, sezioni, tag, etc.)
        // che non vengono toccati dal form. Senza questo passaggio le UOC perderebbero le
        // sezioni custom o altri campi al primo "Salva" da editor.
        if (!isNew) {
          const knownEditedFields = new Set(['id','nome','nome_breve','direttore','email','ubicazione','contatti','tag']);
          for (const key of Object.keys(g)) {
            if (!knownEditedFields.has(key)) {
              updatedGroup[key] = g[key];
            }
          }
        }
        updatedGroup.contatti = isNew ? [] : (g.contatti || []);
        const newGruppi = isNew ? [...gruppi, updatedGroup] : gruppi.map(x => x.id === id ? updatedGroup : x);
        try {
          const desc = isNew ? `nuovo gruppo: ${nome}` : `modifica gruppo: ${nome}`;
          await saveNumeriForSource(sourceSelected, { ...data, gruppi: newGruppi }, desc);
          toast(isNew ? 'Gruppo creato' : 'Gruppo aggiornato', 'success');
          closeModal();
          await buildIndex();
          if (state.showExtendedNumeri?.osa) await loadExtendedNumeri('osa');
          if (state.showExtendedNumeri?.iov) await loadExtendedNumeri('iov');
          renderNavTree();
          if (state.currentView === 'numeri') navigate('numeri', state.currentParams || {});
        } catch (e) { toast('Errore: ' + e.message, 'error'); }
      } }
    ]
  });
}

async function nuovoContatto(gruppoId) {
  // Open modal for new contact
  openContattoEditor({ mode: 'new', gruppoId });
}

async function deleteGruppoNumeri(id) {
  if (!isAdmin()) return toast("Solo l'admin può eliminare gruppi", 'warning');
  let g = null, src = null;
  for (const s of ['aopd','osa','iov']) {
    const found = (getNumeriDataForSource(s).gruppi || []).find(x => x.id === id);
    if (found) { g = found; src = s; break; }
  }
  if (!g) return;
  const n = (g.contatti || []).length;
  if (n > 0 && !confirm(`Il gruppo "${g.nome}" contiene ${n} contatti. Eliminare TUTTO?`)) return;
  if (n === 0 && !confirm(`Eliminare gruppo "${g.nome}"?`)) return;
  const data = { ...getNumeriDataForSource(src) };
  const newGruppi = (data.gruppi || []).filter(x => x.id !== id);
  try {
    await saveNumeriForSource(src, { ...data, gruppi: newGruppi }, `elimina gruppo: ${g.nome}${n > 0 ? ` (con ${n} contatt${n === 1 ? 'o' : 'i'})` : ''}`);
    toast('Gruppo eliminato', 'success');
    await buildIndex();
    if (state.showExtendedNumeri?.osa) await loadExtendedNumeri('osa');
    if (state.showExtendedNumeri?.iov) await loadExtendedNumeri('iov');
    renderNavTree();
    if (state.currentView === 'numeri') navigate('numeri', state.currentParams || {});
  } catch (e) { toast('Errore: ' + e.message, 'error'); }
}

async function saveNumeriFile(numeriObj, changeDesc) {
  // Legacy compatibility: saves to AOPD
  return saveNumeriForSource('aopd', numeriObj, changeDesc);
}
