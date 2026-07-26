/* ============================ GESTIONE UTENTI (admin only) ============================ */
/*
 * Crypto helper schema 3.1: AES-GCM + PBKDF2-SHA256 310000 iter.
 * Compatibile con create_users.html e con il vecchio decryptUserData.
 */
async function encryptPayload(payload, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, 310000);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
  return {
    salt: b64(salt), iv: b64(iv), ciphertext: b64(ciphertext),
    iterations: 310000, algo: 'AES-GCM', kdf: 'PBKDF2-SHA256',
    updated_at: new Date().toISOString()
  };
}

async function decryptPayload(entry, passphrase) {
  return await decryptUserData(entry, passphrase);  // riuso funzione esistente
}

/* Ruoli disponibili, sincronizzato con create_users.html */
const RUOLI_STANDARD = ['specializzando', 'strutturato'];

// Stato per UI gestione utenti: ricerca e filtro ruolo
const gestioneUtentiState = {
  searchQuery: '',
  filterRuolo: 'all',     // 'all' | 'admin' | 'specializzando' | 'strutturato' | '<ruolo custom>' | '—'
  _data: null             // cache dell'ultima risposta gh_auth.getTokensFile()
};

function ruoloLabel(r) {
  if (r === '—' || !r) return 'Senza ruolo';
  return r.charAt(0).toUpperCase() + r.slice(1);
}

async function renderGestioneUtenti() {
  if (!isAdmin()) return renderError('Accesso negato', 'Solo amministratori.');
  renderLoading('Caricamento utenti...');
  try {
    const { data } = await gh_auth.getTokensFile();
    gestioneUtentiState._data = data;
    renderGestioneUtentiView();
  } catch (e) {
    renderError('Errore caricamento utenti', e.message);
  }
}

function renderGestioneUtentiView() {
  const data = gestioneUtentiState._data || { utenti: {} };
  const users = data.utenti || {};
  const entries = Object.entries(users).sort(([a], [b]) => a.localeCompare(b));

  // Conteggi per ruolo (ignorano i filtri attivi)
  const countAll = entries.length;
  const countAdmin = entries.filter(([, e]) => !!e.is_admin).length;
  const ruoloBuckets = {};
  entries.forEach(([, e]) => {
    const r = e.ruolo || '—';
    ruoloBuckets[r] = (ruoloBuckets[r] || 0) + 1;
  });
  const ruoliOrdered = [];
  RUOLI_STANDARD.forEach(r => { if (ruoloBuckets[r]) ruoliOrdered.push(r); });
  Object.keys(ruoloBuckets)
    .filter(r => !RUOLI_STANDARD.includes(r) && r !== '—')
    .sort()
    .forEach(r => ruoliOrdered.push(r));
  if (ruoloBuckets['—']) ruoliOrdered.push('—');

  // Applico filtri
  const q = gestioneUtentiState.searchQuery.trim().toLowerCase();
  const filtered = entries.filter(([uname, entry]) => {
    if (gestioneUtentiState.filterRuolo === 'admin') {
      if (!entry.is_admin) return false;
    } else if (gestioneUtentiState.filterRuolo !== 'all') {
      const r = entry.ruolo || '—';
      if (r !== gestioneUtentiState.filterRuolo) return false;
    }
    if (q) {
      const ruolo = (entry.ruolo || '').toLowerCase();
      if (!uname.toLowerCase().includes(q) && !ruolo.includes(q)) return false;
    }
    return true;
  });

  const chipActive = (val) => gestioneUtentiState.filterRuolo === val;
  const chipsHtml = `
    <button class="ut-chip ${chipActive('all') ? 'active' : ''}" data-filter="all">Tutti <span class="ut-chip-count">${countAll}</span></button>
    <button class="ut-chip ${chipActive('admin') ? 'active' : ''}" data-filter="admin">★ Admin <span class="ut-chip-count">${countAdmin}</span></button>
    ${ruoliOrdered.map(r => `
      <button class="ut-chip ${chipActive(r) ? 'active' : ''}" data-filter="${escapeHtml(r)}">${escapeHtml(ruoloLabel(r))} <span class="ut-chip-count">${ruoloBuckets[r]}</span></button>
    `).join('')}
  `;

  $('main-content').innerHTML = `
    <div class="page-head">
      <div class="page-eyebrow">${buildBreadcrumb([{label:'Home', route:'home'}])}Amministrazione</div>
      <h1 class="page-title">Gestione <em>utenti</em></h1>
      <div class="page-actions" style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap;">
        <button class="btn" id="btn-add-user">+ Aggiungi utente</button>
        <button class="btn ghost" onclick="modificaPermessiRuoli()">Permessi per ruolo</button>
        <button class="btn ghost" onclick="navigate('cestino-utenti')">Cestino utenti</button>
        <button class="btn ghost" onclick="navigate('attivita')">Attività recente</button>
        <button class="btn ghost" onclick="exportContentIndex()">Esporta contenuto (NotebookLM)</button>
        <button class="btn ghost" onclick="exportFileTree()">Esporta file tree</button>
      </div>
    </div>

    <div class="ut-toolbar">
      <div class="ut-search-wrap">
        <svg class="ut-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
        <input type="search" id="ut-search" class="ut-search-input" placeholder="Cerca per username o ruolo…" value="${escapeHtml(gestioneUtentiState.searchQuery)}" autocomplete="off">
        ${gestioneUtentiState.searchQuery ? '<button type="button" class="ut-search-clear" id="ut-search-clear" title="Pulisci" aria-label="Pulisci ricerca">×</button>' : ''}
      </div>
      <div class="ut-chips" id="ut-chips">${chipsHtml}</div>
    </div>

    <div id="ut-results" style="margin-top:20px;">${renderUtentiCards(filtered, countAll, q)}</div>
  `;

  // Event binding
  $('btn-add-user').addEventListener('click', () => aggiungiUtenteModal());

  const searchInput = $('ut-search');
  if (searchInput) {
    // input event → filtra senza refetch, non rifa l'intera UI (focus preservato)
    searchInput.addEventListener('input', (e) => {
      gestioneUtentiState.searchQuery = e.target.value;
      rerenderUtentiResults();
    });
    // Al primo render, se c'era una query attiva, riposiziona focus e cursore in coda
    if (gestioneUtentiState.searchQuery) {
      const len = searchInput.value.length;
      searchInput.focus();
      searchInput.setSelectionRange(len, len);
    }
  }
  const searchClear = $('ut-search-clear');
  if (searchClear) {
    searchClear.addEventListener('click', () => {
      gestioneUtentiState.searchQuery = '';
      renderGestioneUtentiView();  // rifa la UI per rimuovere il bottone ×
    });
  }

  // Chip filtri
  document.querySelectorAll('.ut-chip[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      gestioneUtentiState.filterRuolo = btn.dataset.filter;
      renderGestioneUtentiView();  // rifa la UI per aggiornare .active
    });
  });
}

// Ricomputa e rerenderizza solo la parte cards/empty-state senza toccare search/chips
function rerenderUtentiResults() {
  const data = gestioneUtentiState._data || { utenti: {} };
  const entries = Object.entries(data.utenti || {}).sort(([a], [b]) => a.localeCompare(b));
  const countAll = entries.length;
  const q = gestioneUtentiState.searchQuery.trim().toLowerCase();
  const filtered = entries.filter(([uname, entry]) => {
    if (gestioneUtentiState.filterRuolo === 'admin') {
      if (!entry.is_admin) return false;
    } else if (gestioneUtentiState.filterRuolo !== 'all') {
      const r = entry.ruolo || '—';
      if (r !== gestioneUtentiState.filterRuolo) return false;
    }
    if (q) {
      const ruolo = (entry.ruolo || '').toLowerCase();
      if (!uname.toLowerCase().includes(q) && !ruolo.includes(q)) return false;
    }
    return true;
  });
  const target = $('ut-results');
  if (target) target.innerHTML = renderUtentiCards(filtered, countAll, q);

  // Mostra/nascondi il bottone clear della search in base allo stato
  const wrap = document.querySelector('.ut-search-wrap');
  const existingClear = $('ut-search-clear');
  if (q && !existingClear && wrap) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ut-search-clear';
    b.id = 'ut-search-clear';
    b.title = 'Pulisci';
    b.setAttribute('aria-label', 'Pulisci ricerca');
    b.textContent = '×';
    b.addEventListener('click', () => {
      gestioneUtentiState.searchQuery = '';
      const searchInput = $('ut-search');
      if (searchInput) searchInput.value = '';
      b.remove();
      rerenderUtentiResults();
    });
    wrap.appendChild(b);
  } else if (!q && existingClear) {
    existingClear.remove();
  }
}

function renderUtentiCards(filtered, countAll, q) {
  if (countAll === 0) {
    return '<p style="color:var(--ink-muted);font-style:italic;">Nessun utente registrato.</p>';
  }
  if (filtered.length === 0) {
    return `<div style="text-align:center;padding:40px 20px;color:var(--ink-muted);font-style:italic;border:1px dashed var(--rule);border-radius:2px;">
      Nessun utente corrisponde ai filtri.
      <button class="btn ghost small" style="margin-left:8px;" onclick="resetUtentiFilters()">Azzera filtri</button>
    </div>`;
  }
  return `<div class="procedure-grid">
    ${filtered.map(([uname, entry]) => {
      const isAdminUser = !!entry.is_admin;
      const ruolo = entry.ruolo || '—';
      const rLabel = ruoloLabel(ruolo);
      // Badge "permessi personalizzati": l'utente ha override rispetto al suo ruolo
      const haPermessiCustom = !isAdminUser && entry.permessi && Object.keys(entry.permessi).length > 0;
      return `
        <div class="procedure-card" style="cursor:default;">
          <div class="procedure-card-title" style="display:flex;align-items:center;gap:10px;">
            <span>${escapeHtml(uname)}</span>
            <span style="font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;padding:3px 8px;border-radius:2px;${isAdminUser ? 'background:var(--accent);color:white;' : 'background:var(--bg-sink);color:var(--ink-muted);border:1px solid var(--rule);'}">${isAdminUser ? '★ Admin' : 'Utente'}</span>
          </div>
          <div class="procedure-card-tags" style="font-size:13px;color:var(--ink-muted);margin:6px 0;">
            Ruolo: <strong>${escapeHtml(rLabel)}</strong>${haPermessiCustom ? ' · <em>permessi personalizzati</em>' : ''}${entry.updated_at ? ' · Aggiornato ' + timeAgo(entry.updated_at) : ''}
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;">
            <button class="btn small ghost" onclick="modificaPermessiUtente('${escapeJs(uname)}')">Modifica permessi</button>
            <button class="btn small ghost" onclick="cambiaPassphrase('${escapeJs(uname)}')">Cambia passphrase</button>
            ${uname === state.session.username ? '' : `<button class="btn small ghost" onclick="cambiaStatoAdmin('${escapeJs(uname)}')">${isAdminUser ? 'Rimuovi admin' : 'Rendi admin'}</button>`}
            ${uname === state.session.username ? '' : `<button class="btn small ghost danger" onclick="rimuoviUtente('${escapeJs(uname)}')">Rimuovi</button>`}
          </div>
        </div>`;
    }).join('')}
  </div>`;
}

function resetUtentiFilters() {
  gestioneUtentiState.searchQuery = '';
  gestioneUtentiState.filterRuolo = 'all';
  renderGestioneUtentiView();
}

function aggiungiUtenteModal() {
  showModal({
    title: 'Nuovo utente',
    subtitle: `Verranno ereditati i token della tua sessione: <code>token_data</code>${state.session.tokenAuth ? ' + <code>token_auth</code> se admin' : ''}.`,
    body: `
      <div class="field" style="margin-bottom:12px;">
        <label style="display:block;font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--ink-muted);margin-bottom:6px;">Username *</label>
        <input type="text" id="au-username" placeholder="es. marco" autocomplete="off" style="width:100%;padding:10px 12px;border:1px solid var(--rule);border-radius:2px;font-size:15px;">
      </div>
      <div class="field" style="margin-bottom:12px;">
        <label style="display:block;font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--ink-muted);margin-bottom:6px;">Nome / Cognome</label>
        <div style="display:flex;gap:8px;">
          <input type="text" id="au-nome" placeholder="Nome" autocomplete="off" style="flex:1;padding:10px 12px;border:1px solid var(--rule);border-radius:2px;font-size:15px;">
          <input type="text" id="au-cognome" placeholder="Cognome" autocomplete="off" style="flex:1;padding:10px 12px;border:1px solid var(--rule);border-radius:2px;font-size:15px;">
        </div>
      </div>
      <div class="field" style="margin-bottom:12px;">
        <label style="display:block;font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--ink-muted);margin-bottom:6px;">Ruolo professionale</label>
        <select id="au-ruolo" onchange="document.getElementById('au-ruolo-altro').style.display = this.value === 'altro' ? 'block' : 'none'" style="width:100%;padding:10px 12px;border:1px solid var(--rule);border-radius:2px;font-size:15px;background:var(--bg-paper);">
          <option value="specializzando">Specializzando</option>
          <option value="strutturato">Strutturato</option>
          <option value="altro">Altro</option>
        </select>
        <input type="text" id="au-ruolo-altro" placeholder="Specifica ruolo (es. Infermiere, Caposala…)" autocomplete="off" style="margin-top:6px;display:none;width:100%;padding:10px 12px;border:1px solid var(--rule);border-radius:2px;font-size:15px;">
      </div>
      <div class="field" style="margin-bottom:12px;">
        <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg-sink);border:1px solid var(--rule);border-radius:2px;cursor:pointer;">
          <input type="checkbox" id="au-is-admin" ${state.session.tokenAuth ? '' : 'disabled'} style="width:16px;height:16px;">
          <span>
            <span style="display:block;font-weight:500;">Amministratore</span>
            <span style="display:block;font-size:12px;color:var(--ink-muted);">${state.session.tokenAuth ? 'Eredita token_auth dalla tua sessione' : 'Non puoi promuovere (manca token_auth)'}</span>
          </span>
        </label>
      </div>
      <div class="field" style="margin-bottom:8px;">
        <label style="display:block;font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--ink-muted);margin-bottom:6px;">Passphrase *</label>
        <input type="password" id="au-pass1" autocomplete="new-password" style="width:100%;padding:10px 12px;border:1px solid var(--rule);border-radius:2px;font-size:15px;">
        <input type="password" id="au-pass2" placeholder="Ripeti passphrase" autocomplete="new-password" style="margin-top:6px;width:100%;padding:10px 12px;border:1px solid var(--rule);border-radius:2px;font-size:15px;">
        <div style="font-size:12px;color:var(--warn);margin-top:8px;">Salva la passphrase in locale. Ti servirà per cambiarla in futuro.</div>
      </div>
      <div id="au-error" style="color:var(--danger);font-size:13px;display:none;margin-top:8px;padding:8px 12px;background:var(--danger-soft);border-left:3px solid var(--danger);"></div>`,
    actions: [
      { label: 'Annulla', variant: 'ghost', onClick: closeModal },
      { label: 'Crea utente', onClick: async () => {
        const uname = $('au-username').value.trim().toLowerCase();
        const nome = $('au-nome').value.trim();
        const cognome = $('au-cognome').value.trim();
        let ruolo = $('au-ruolo').value;
        if (ruolo === 'altro') {
          const custom = $('au-ruolo-altro').value.trim();
          if (!custom) return showAuError('Specifica il ruolo quando scegli "Altro".');
          ruolo = custom;
        }
        const isAdminUser = $('au-is-admin').checked;
        const p1 = $('au-pass1').value;
        const p2 = $('au-pass2').value;

        function showAuError(m) {
          const err = $('au-error');
          err.textContent = m; err.style.display = 'block';
        }

        if (!uname) return showAuError('Username obbligatorio.');
        if (!/^[a-z0-9_-]+$/.test(uname)) return showAuError('Username può contenere solo lettere minuscole, cifre, "-" e "_".');
        if (!p1) return showAuError('Passphrase obbligatoria.');
        if (p1 !== p2) return showAuError('Le passphrase non coincidono.');

        try {
          const { data, sha } = await gh_auth.getTokensFile();
          if (data.utenti && data.utenti[uname]) {
            return showAuError(`L'utente "${uname}" esiste già.`);
          }
          // Payload cifrato: eredita token dalla sessione admin corrente
          const payload = { token_data: state.session.tokenData };
          if (isAdminUser) {
            if (!state.session.tokenAuth) return showAuError('Non puoi creare admin senza tokenAuth.');
            payload.token_auth = state.session.tokenAuth;
          }
          if (nome) payload.nome = nome;
          if (cognome) payload.cognome = cognome;
          if (ruolo) payload.ruolo = ruolo;

          const entry = await encryptPayload(payload, p1);
          entry.is_admin = isAdminUser;
          if (ruolo) entry.ruolo = ruolo;

          if (!data.utenti) data.utenti = {};
          data.utenti[uname] = entry;
          data.schema_version = '3.1';

          await gh_auth.putTokensFile(data, sha, `Aggiungi utente ${uname} (by ${state.session.username})`);
          closeModal();
          toast(`Utente ${uname} creato`, 'success');
          renderGestioneUtenti();
        } catch (e) {
          showAuError('Errore: ' + e.message);
        }
      }}
    ]
  });
}

function cambiaPassphrase(username) {
  showModal({
    title: `Cambia passphrase di ${escapeHtml(username)}`,
    subtitle: 'Serve la passphrase attuale per decifrare i token, poi una nuova passphrase.',
    body: `
      <div class="field" style="margin-bottom:12px;">
        <label style="display:block;font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--ink-muted);margin-bottom:6px;">Passphrase attuale *</label>
        <input type="password" id="cp-old" autocomplete="off" style="width:100%;padding:10px 12px;border:1px solid var(--rule);border-radius:2px;font-size:15px;">
      </div>
      <div class="field" style="margin-bottom:12px;">
        <label style="display:block;font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--ink-muted);margin-bottom:6px;">Nuova passphrase *</label>
        <input type="password" id="cp-new1" autocomplete="new-password" style="width:100%;padding:10px 12px;border:1px solid var(--rule);border-radius:2px;font-size:15px;">
        <input type="password" id="cp-new2" placeholder="Ripeti nuova passphrase" autocomplete="new-password" style="margin-top:6px;width:100%;padding:10px 12px;border:1px solid var(--rule);border-radius:2px;font-size:15px;">
      </div>
      <div id="cp-error" style="color:var(--danger);font-size:13px;display:none;margin-top:8px;padding:8px 12px;background:var(--danger-soft);border-left:3px solid var(--danger);"></div>`,
    actions: [
      { label: 'Annulla', variant: 'ghost', onClick: closeModal },
      { label: 'Cambia', onClick: async () => {
        const oldPass = $('cp-old').value;
        const newPass1 = $('cp-new1').value;
        const newPass2 = $('cp-new2').value;
        function showCpError(m) {
          const err = $('cp-error');
          err.textContent = m; err.style.display = 'block';
        }
        if (!oldPass) return showCpError('Passphrase attuale obbligatoria.');
        if (!newPass1) return showCpError('Nuova passphrase obbligatoria.');
        if (newPass1 !== newPass2) return showCpError('Le nuove passphrase non coincidono.');

        try {
          const { data, sha } = await gh_auth.getTokensFile();
          const entry = data.utenti[username];
          if (!entry) return showCpError('Utente non trovato.');

          let payload;
          try {
            payload = await decryptPayload(entry, oldPass);
          } catch {
            return showCpError('Passphrase attuale errata.');
          }

          // Ricripta con la nuova passphrase, preservando i campi in chiaro
          const newEntry = await encryptPayload(payload, newPass1);
          newEntry.is_admin = entry.is_admin;
          if (entry.ruolo) newEntry.ruolo = entry.ruolo;
          if (entry.permessi) newEntry.permessi = entry.permessi;

          data.utenti[username] = newEntry;
          await gh_auth.putTokensFile(data, sha, `Cambia passphrase di ${username} (by ${state.session.username})`);
          closeModal();
          toast(`Passphrase di ${username} aggiornata`, 'success');
          renderGestioneUtenti();
        } catch (e) {
          showCpError('Errore: ' + e.message);
        }
      }}
    ]
  });
}

// Promuove ad admin o declassa un utente, chiedendo la sua passphrase per
// ricifrare il payload con/senza il token_auth. Richiede che l'admin corrente
// abbia un token_auth da condividere (per la promozione).
function cambiaStatoAdmin(username) {
  const entry = (state.tokensFile && state.tokensFile.utenti && state.tokensFile.utenti[username])
    || (gestioneUtentiState._data && gestioneUtentiState._data.utenti && gestioneUtentiState._data.utenti[username]);
  const giaAdmin = !!(entry && entry.is_admin);
  const azione = giaAdmin ? 'Rimuovi admin' : 'Rendi admin';
  if (username === state.session.username) {
    return toast('Non puoi cambiare il tuo stato admin.', 'error');
  }
  if (!giaAdmin && !state.session.tokenAuth) {
    return toast('Non hai un token admin da assegnare.', 'error');
  }
  showModal({
    title: `${azione}: ${escapeHtml(username)}`,
    subtitle: giaAdmin
      ? 'L\'utente perderà i poteri di amministratore. Serve la sua passphrase per ricifrare i token.'
      : 'L\'utente otterrà i poteri di amministratore. Serve la sua passphrase per ricifrare i token, e gli verrà assegnato il token admin della tua sessione.',
    body: `
      <div class="field" style="margin-bottom:12px;">
        <label style="display:block;font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--ink-muted);margin-bottom:6px;">Passphrase di ${escapeHtml(username)} *</label>
        <input type="password" id="ca-pass" autocomplete="off" style="width:100%;padding:10px 12px;border:1px solid var(--rule);border-radius:2px;font-size:15px;">
      </div>
      <div id="ca-error" style="color:var(--danger);font-size:13px;display:none;margin-top:8px;padding:8px 12px;background:var(--danger-soft);border-left:3px solid var(--danger);"></div>`,
    actions: [
      { label: 'Annulla', variant: 'ghost', onClick: closeModal },
      { label: azione, onClick: async () => {
        const pass = $('ca-pass').value;
        function showCaError(m) { const err = $('ca-error'); err.textContent = m; err.style.display = 'block'; }
        if (!pass) return showCaError('Passphrase obbligatoria.');
        try {
          const { data, sha } = await gh_auth.getTokensFile();
          const ent = data.utenti[username];
          if (!ent) return showCaError('Utente non trovato.');
          let payload;
          try {
            payload = await decryptPayload(ent, pass);
          } catch {
            return showCaError('Passphrase errata.');
          }
          if (giaAdmin) {
            // Declassa: rimuove il token admin dal payload
            delete payload.token_auth;
          } else {
            // Promuove: assegna il token admin della sessione corrente
            if (!state.session.tokenAuth) return showCaError('Non hai un token admin da assegnare.');
            payload.token_auth = state.session.tokenAuth;
          }
          // Ricifra preservando i campi in chiaro, aggiornando is_admin
          const newEntry = await encryptPayload(payload, pass);
          newEntry.is_admin = !giaAdmin;
          if (ent.ruolo) newEntry.ruolo = ent.ruolo;
          if (ent.permessi) newEntry.permessi = ent.permessi;
          data.utenti[username] = newEntry;
          await gh_auth.putTokensFile(data, sha, `${giaAdmin ? 'Rimuovi' : 'Assegna'} admin a ${username} (by ${state.session.username})`);
          closeModal();
          toast(`${username} ${giaAdmin ? 'non è più admin' : 'è ora admin'}`, 'success');
          renderGestioneUtenti();
        } catch (e) {
          showCaError('Errore: ' + e.message);
        }
      }}
    ]
  });
}

function rimuoviUtente(username) {
  if (username === state.session.username) {
    return toast('Non puoi rimuovere te stesso.', 'error');
  }
  showModal({
    title: `Rimuovere ${escapeHtml(username)}?`,
    subtitle: 'L\'utente non potrà più accedere. Le sue preferenze home vengono spostate nel cestino (recuperabili).',
    body: '<p style="font-size:13px;color:var(--ink-muted);">Dal cestino potrai ripristinare o eliminare definitivamente le preferenze.</p>',
    actions: [
      { label: 'Annulla', variant: 'ghost', onClick: closeModal },
      { label: 'Rimuovi', variant: 'danger', onClick: async () => {
        closeModal();
        try {
          // 1. Rimuovo l'entry dal file auth
          const { data, sha } = await gh_auth.getTokensFile();
          if (data.utenti) delete data.utenti[username];
          await gh_auth.putTokensFile(data, sha, `Rimuovi utente ${username} (by ${state.session.username})`);

          // 2. Sposto il file user-prefs nel cestino (se esiste)
          try {
            const prefsPath = `content/user-prefs/${username}.yml`;
            const existing = await gh.getFile(prefsPath);
            if (existing) {
              const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
              const cestinoPath = `cestino/user-prefs/${username}__${timestamp}__${state.session.username}.yml`;
              await gh.putFile(cestinoPath, existing.content, null, `Archivio preferenze di ${username} (by ${state.session.username})`);
              await gh.deleteFile(prefsPath, existing.sha, `Rimuovi preferenze di ${username} (archiviato in cestino)`);
            }
          } catch (e) {
            console.warn('Impossibile spostare le preferenze nel cestino:', e);
          }

          toast(`${username} rimosso`, 'success');
          renderGestioneUtenti();
        } catch (e) {
          toast('Errore: ' + e.message, 'error');
        }
      }}
    ]
  });
}

/* ============================ ATTIVITA RECENTE (admin only) ============================
   Aggregatore client-side delle modifiche recenti in tutte le aree dell'app.
   Fonte dati: cronologia_recente nei file (già in state.index) + commit messages
   del repo CollinettaAI-data per azioni senza file-level cronologia (es. numeri.yml).
   Non aggiunge chiamate API obbligatorie — la chiamata commits è una sola, opzionale
   con ultimi 100 commit (sufficienti per un log settimanale).
*/
function renderAttivita() {
  if (!isAdmin()) return renderError('Accesso negato', 'Solo amministratori.');

  // Stato locale di questa vista (filtri e caricamento commits)
  if (!state._attivitaState) {
    state._attivitaState = {
      filter: 'tutti',          // tutti | procedure | clinica | moduli | numeri | utenti
      loadingCommits: false,
      commits: null,            // array di eventi da commit GitHub
      error: null
    };
  }
  const s = state._attivitaState;

  // 1) EVENTI DA cronologia_recente NEI FILE
  //    Tutti gli oggetti (procedura, clinica, modulo) con cronologia_recente
  //    producono un evento per ogni entry.
  const eventsFromFiles = [];
  const pushEntries = (items, tipo) => {
    (items || []).forEach(item => {
      const storia = item.cronologia_recente || [];
      storia.forEach(s => {
        if (!s.data) return;
        eventsFromFiles.push({
          when: new Date(s.data),
          user: s.utente || '—',
          tipo,
          slug: item.slug || item.id,
          label: item.titolo || item.slug || item.id,
          nota: s.nota || 'aggiornamento',
          source: 'file'
        });
      });
    });
  };
  pushEntries(state.index.procedure, 'procedura');
  pushEntries(state.index.clinica, 'clinica');
  pushEntries(state.index.moduli, 'modulo');

  // 2) EVENTI DA COMMIT GITHUB (opzionale, caricati on-demand)
  //    Cattura modifiche che non hanno cronologia nel file (numeri.yml, utenti, ecc.).
  const eventsFromCommits = s.commits || [];

  // Unione + ordinamento cronologico DESC + filtri
  let allEvents = [...eventsFromFiles, ...eventsFromCommits];
  allEvents.sort((a, b) => b.when - a.when);

  // Dedup commit "preferenze": ogni salvataggio genera un commit, quindi si accumulano
  // molte righe identiche. Tengo solo la più recente per utente/giorno.
  const _seenPref = new Set();
  allEvents = allEvents.filter(e => {
    if (e.tipo !== 'preferenze') return true;
    const dayKey = `${e.user}|${e.when.toISOString().slice(0, 10)}`;
    if (_seenPref.has(dayKey)) return false;
    _seenPref.add(dayKey);
    return true;
  });

  const filtered = s.filter === 'tutti'
    ? allEvents
    : allEvents.filter(e => e.tipo === s.filter);

  // Metriche
  const now = new Date();
  const events24h = allEvents.filter(e => (now - e.when) < 24 * 3600 * 1000).length;
  const users7d = new Set(allEvents.filter(e => (now - e.when) < 7 * 24 * 3600 * 1000).map(e => e.user).filter(u => u && u !== '—')).size;
  const apiText = (rateLimit.remaining != null)
    ? `${rateLimit.remaining} / ${rateLimit.limit}`
    : '—';

  // Chip conteggi globali (per i filtri)
  const counts = { tutti: allEvents.length };
  allEvents.forEach(e => { counts[e.tipo] = (counts[e.tipo] || 0) + 1; });
  const chipDefs = [
    { key: 'tutti', label: 'Tutti' },
    { key: 'procedura', label: 'Procedure' },
    { key: 'clinica', label: 'Cliniche' },
    { key: 'numeri', label: 'Numeri' },
    { key: 'modulo', label: 'Moduli' },
    { key: 'utenti', label: 'Utenti' }
  ];
  const chipsHtml = chipDefs
    .filter(c => c.key === 'tutti' || counts[c.key])
    .map(c => `<button class="ut-chip ${s.filter === c.key ? 'active' : ''}" data-at-filter="${c.key}">${escapeHtml(c.label)} <span class="ut-chip-count">${counts[c.key] || 0}</span></button>`)
    .join('');

  // Lista eventi
  const eventsHtml = filtered.length === 0
    ? '<div style="padding:40px 16px;text-align:center;color:var(--ink-muted);font-style:italic;">Nessun evento trovato con questi filtri.</div>'
    : filtered.slice(0, 100).map(e => renderAttivitaEvent(e)).join('');

  $('main-content').innerHTML = `
    <div class="page-head">
      <div class="page-eyebrow">${buildBreadcrumb([{label:'Home', route:'home'}, {label:'Gestione utenti', route:'utenti'}])} · Attività</div>
      <h1 class="page-title">Attività <em>recente</em></h1>
      <div style="margin-top:8px;font-size:13px;color:var(--ink-muted);">
        Cronologia delle modifiche rilevate dai file. Le modifiche a <code>numeri.yml</code> e le azioni sugli utenti sono visibili solo dopo aver caricato la cronologia commit.
      </div>
    </div>

    <div class="at-metrics">
      <div class="at-metric">
        <div class="at-metric-label">Modifiche 24h</div>
        <div class="at-metric-value">${events24h}</div>
      </div>
      <div class="at-metric">
        <div class="at-metric-label">Utenti attivi 7 giorni</div>
        <div class="at-metric-value">${users7d}</div>
      </div>
      <div class="at-metric">
        <div class="at-metric-label">API GitHub residua</div>
        <div class="at-metric-value at-metric-api ${(rateLimit.remaining != null && rateLimit.remaining < 1000) ? 'warning' : ''} ${(rateLimit.remaining != null && rateLimit.remaining < 200) ? 'danger' : ''}">${escapeHtml(apiText)}</div>
      </div>
    </div>

    <div class="at-toolbar">
      <div class="at-chips">${chipsHtml}</div>
      <div class="at-toolbar-actions">
        ${s.commits ? `<span style="font-size:12px;color:var(--ink-muted);">Commit caricati: ${s.commits.length}</span>` : ''}
        <button class="btn ghost" id="btn-load-commits" ${s.loadingCommits ? 'disabled' : ''}>
          ${s.loadingCommits ? 'Caricamento...' : (s.commits ? 'Ricarica commit' : 'Carica commit GitHub')}
        </button>
      </div>
    </div>

    ${s.error ? `<div class="at-error">${escapeHtml(s.error)}</div>` : ''}

    <div class="at-events">${eventsHtml}</div>

    ${filtered.length > 100 ? `<div style="padding:12px;text-align:center;color:var(--ink-muted);font-size:12px;">Mostrati i 100 eventi più recenti su ${filtered.length} totali.</div>` : ''}
  `;

  // Handlers
  $('btn-load-commits').onclick = async () => {
    s.loadingCommits = true; s.error = null;
    renderAttivita();
    try {
      s.commits = await _fetchAttivitaCommits();
    } catch (err) {
      s.error = 'Errore caricamento commit: ' + err.message;
    }
    s.loadingCommits = false;
    renderAttivita();
  };

  document.querySelectorAll('[data-at-filter]').forEach(btn => {
    btn.onclick = () => {
      s.filter = btn.dataset.atFilter;
      renderAttivita();
    };
  });
}

/* Iniziali per l'avatar di un evento attività: prima e ultima lettera dello username
 * (gli username sono nel formato "nome"+iniziale cognome, es. raffaelep → RP, danieln → DN). */
function computeUserInitials(rawUser) {
  const u = (rawUser || '').trim();
  if (!u || u === '—') return '?';
  return (u.length >= 2 ? (u[0] + u[u.length - 1]) : u).toUpperCase();
}

/* Render di un singolo evento (riga nella lista) */
function renderAttivitaEvent(e) {
  const initials = computeUserInitials(e.user);
  const userIsAdmin = e.user && state.tokensFile && state.tokensFile.utenti
    && state.tokensFile.utenti[e.user] && state.tokensFile.utenti[e.user].is_admin;
  const avatarClass = userIsAdmin ? 'at-avatar at-avatar-admin' : 'at-avatar';
  // Click porta alla risorsa se disponibile
  let clickHandler = '';
  if (e.slug && e.tipo === 'procedura') clickHandler = `onclick="navigate('procedura',{slug:'${escapeJs(e.slug)}'})"`;
  else if (e.slug && e.tipo === 'clinica') clickHandler = `onclick="navigate('clinica-scheda',{slug:'${escapeJs(e.slug)}'})"`;
  else if (e.slug && e.tipo === 'modulo') clickHandler = `onclick="navigate('modulo',{slug:'${escapeJs(e.slug)}'})"`;
  else if (e.tipo === 'numeri' && e.slug) clickHandler = `onclick="navigate('numeri',{filter:'${escapeJs(e.slug)}'})"`;
  else if (e.tipo === 'numeri') clickHandler = `onclick="navigate('numeri')"`;

  return `<div class="at-event" ${clickHandler} ${clickHandler ? 'style="cursor:pointer;"' : ''}>
    <div class="${avatarClass}" title="${escapeHtml(e.user || '—')}">${escapeHtml(initials)}</div>
    <div class="at-event-main">
      <div class="at-event-line">
        <strong>${escapeHtml(e.user || '—')}</strong>
        <span class="at-event-verb">${e.source === 'commit' ? 'ha aggiornato' : 'ha modificato'}</span>
        <span class="at-event-target">${escapeHtml(e.label || e.slug || '(anonimo)')}</span>
      </div>
      ${e.nota ? `<div class="at-event-nota">${escapeHtml(e.nota)} · ${timeAgo(e.when.toISOString())}</div>` : `<div class="at-event-nota">${timeAgo(e.when.toISOString())}</div>`}
    </div>
    <span class="at-event-tipo">${escapeHtml(e.tipo)}</span>
  </div>`;
}

/* Fetch dei commit GitHub dal repo dati E dal repo auth (se admin con tokenAuth),
   parse username dal messaggio ("Aggiorna foo (by marco) — dettaglio"). Ritorna
   array di eventi normalizzati. */
async function _fetchAttivitaCommits() {
  const fetchRepo = async (repo, token) => {
    if (!token) return [];
    const url = `${CONFIG.API_BASE}/repos/${CONFIG.REPO_OWNER}/${repo}/commits?per_page=100`;
    const res = await fetch(url, {
      headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github+json' }
    });
    updateRateLimitFromHeaders(res);
    if (!res.ok) throw new Error(`GET ${repo} commits: ${res.status}`);
    return await res.json();
  };

  const [dataCommits, authCommits] = await Promise.all([
    fetchRepo(CONFIG.DATA_REPO_NAME, state.session.tokenData),
    fetchRepo(CONFIG.AUTH_REPO_NAME, state.session.tokenAuth)
  ]);

  const all = [...dataCommits, ...authCommits];
  const out = [];
  for (const c of all) {
    const msg = (c.commit && c.commit.message) || '';
    const dateStr = c.commit && c.commit.author && c.commit.author.date;
    if (!dateStr) continue;
    // Estrae "by <user>" dal messaggio (formato del nostro codice)
    const m = msg.match(/\(by ([^)]+)\)/);
    let user = m ? m[1] : '—';
    // Prima riga = titolo
    const firstLine = msg.split('\n')[0] || '';
    // Euristica per classificare il tipo dal messaggio
    let tipo = 'altro';
    let label = firstLine;
    let slug = null;
    let notaOverride = null;
    if (/encrypted-tokens/i.test(firstLine)) {
      tipo = 'utenti';
      label = firstLine.replace(/\(by [^)]+\)\s*—?\s*/, '').trim();
    } else if (/^Aggiorna numeri/i.test(firstLine)) {
      tipo = 'numeri';
      // La desc segue " — " (em-dash). Se assente, fallback generico.
      const descMatch = firstLine.match(/\s—\s(.+)$/);
      label = descMatch ? descMatch[1] : 'rubrica numeri';
      // Deep-link al contatto. Per le modifiche a singolo contatto uso l'etichetta diretta;
      // per le modifiche multiple ("tag di N contatti: X, Y") prendo il PRIMO della lista,
      // così almeno si atterra nella UOC giusta. I gruppi/sezioni restano non deep-linkabili.
      let etich = null;
      let cMatch = label.match(/(?:aggiungi|modifica|elimina)\s+contatto:\s*(.+)$/i)
                || label.match(/tag di 1 contatto:\s*(.+)$/i);
      if (cMatch) {
        etich = cMatch[1].trim();
      } else {
        const multiMatch = label.match(/tag di \d+ contatti:\s*(.+)$/i);
        if (multiMatch) etich = multiMatch[1].split(',')[0].trim();
      }
      if (etich) {
        const found = findContattoByEtichetta(etich);
        if (found) slug = found.id;
      }
    } else if (/^Aggiorna clinica\//i.test(firstLine)) {
      tipo = 'clinica';
      slug = firstLine.match(/^Aggiorna clinica\/([^\s—]+)/i)?.[1];
      label = slug || 'scheda clinica';
    } else if (/^(Aggiorna|Nuova procedura|Nuova scheda)/i.test(firstLine)) {
      tipo = 'procedura';
      slug = firstLine.match(/^(?:Aggiorna|Nuova procedura:)\s+([^\s—]+)/i)?.[1];
      label = slug || 'procedura';
    } else if (/^Sposta nel cestino/i.test(firstLine)) {
      tipo = 'cestino';
      slug = firstLine.match(/^Sposta nel cestino:\s+([^\s(]+)/i)?.[1];
      label = `eliminato: ${slug || '?'}`;
    } else if (/^Carica immagine/i.test(firstLine)) {
      tipo = 'immagine';
      label = firstLine;
    } else if (/^chore:\s*preferenze home di\s+(.+)$/i.test(firstLine)) {
      // Commit delle preferenze home personali (formato "chore: preferenze home di <user>").
      // Non ha il marcatore "(by user)", quindi l'user va estratto da qui. Mostro una label
      // pulita senza il prefisso tecnico "chore:".
      tipo = 'preferenze';
      const mPref = firstLine.match(/^chore:\s*preferenze home di\s+(.+?)(?:\s*\(retry\))?$/i);
      if (mPref) user = mPref[1].trim();
      label = 'preferenze home';
      notaOverride = '';
    } else if (/^(acquire|release|chore\(locks\))/i.test(firstLine)) {
      continue; // filtro locks: troppo rumore
    } else if (/^chore\(moduli\)/i.test(firstLine) || /^(Modifica|Nuovo|Elimina) modulo/i.test(firstLine)) {
      continue; // filtro commit tecnici dei moduli (timestamp, box, ecc.): rumore automatico
    }
    // De-dup: per procedure/cliniche/moduli la cronologia_recente nei file
    // copre già le modifiche. I commit su quei file sarebbero un duplicato.
    // Tengo solo numeri, utenti, cestino, immagine, altro.
    if (tipo === 'procedura' || tipo === 'clinica' || tipo === 'modulo') {
      continue;
    }
    out.push({
      when: new Date(dateStr),
      user,
      tipo,
      slug,
      label,
      nota: notaOverride !== null ? notaOverride : (user !== '—' ? firstLine.replace(/\(by [^)]+\)\s*—?\s*/, '').replace(/\(by [^)]+\)/, '').trim() : firstLine),
      source: 'commit'
    });
  }
  return out;
}

/* ============================ CESTINO USER-PREFS (admin only) ============================ */
async function renderCestinoUtenti() {
  if (!isAdmin()) return renderError('Accesso negato', 'Solo amministratori.');
  renderLoading('Caricamento cestino utenti...');
  try {
    let items = [];
    try {
      const list = await gh.listDir('cestino/user-prefs');
      items = Array.isArray(list) ? list.filter(x => x.type === 'file' && x.name.endsWith('.yml')) : [];
    } catch (e) {
      // Cartella inesistente
      items = [];
    }

    // Parse ogni nome file: <username>__<timestamp>__<admin>.yml
    const parsed = items.map(f => {
      const name = f.name.replace(/\.yml$/, '');
      const parts = name.split('__');
      return {
        file: f,
        username: parts[0] || name,
        timestamp: parts[1] || null,
        removedBy: parts[2] || null
      };
    }).sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

    // Per sapere se un ripristino è sicuro, carico la lista utenti correnti
    let currentUsers = new Set();
    try {
      const { data } = await gh_auth.getTokensFile();
      currentUsers = new Set(Object.keys(data.utenti || {}));
    } catch {}

    $('main-content').innerHTML = `
      <div class="page-head">
        <div class="page-eyebrow">${buildBreadcrumb([{label:'Home', route:'home'}, {label:'Gestione utenti', route:'utenti'}])} · Cestino</div>
        <h1 class="page-title">Cestino <em>utenti</em></h1>
        <div style="margin-top:12px;font-size:13px;color:var(--ink-muted);">
          File di preferenze archiviati quando gli utenti vengono rimossi. Ripristinabili (solo se lo username non è riutilizzato) o eliminabili definitivamente.
        </div>
        <div class="page-actions" style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap;">
          ${parsed.length > 0 ? `<button class="btn danger ghost" onclick="svuotaCestinoUtenti()">Svuota cestino (${parsed.length})</button>` : ''}
          <button class="btn ghost" onclick="navigate('utenti')">← Gestione utenti</button>
        </div>
      </div>
      <div style="margin-top:24px;">
        ${parsed.length === 0 ? '<p style="color:var(--ink-muted);font-style:italic;">Cestino vuoto.</p>' :
          parsed.map(p => {
            const isReplaceable = !currentUsers.has(p.username);
            const date = p.timestamp ? new Date(p.timestamp.replace(/-/g, (m, i) => i > 9 ? ':' : '-')).toLocaleString('it-IT') : '—';
            return `
              <div class="procedure-card" style="cursor:default;margin-bottom:8px;">
                <div class="procedure-card-title">
                  <span>${escapeHtml(p.username)}</span>
                </div>
                <div style="font-size:13px;color:var(--ink-muted);margin:6px 0;">
                  Rimosso il ${escapeHtml(date)}${p.removedBy ? ' da <strong>' + escapeHtml(p.removedBy) + '</strong>' : ''}
                </div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;">
                  ${isReplaceable
                    ? `<button class="btn small ghost" onclick="ripristinaUtentePref('${escapeJs(p.file.path)}','${escapeJs(p.username)}')">Ripristina</button>`
                    : `<span style="font-size:12px;color:var(--warn);font-style:italic;padding:6px 10px;">Username già in uso, ripristino bloccato</span>`}
                  <button class="btn small ghost danger" onclick="eliminaDefPref('${escapeJs(p.file.path)}','${escapeJs(p.file.sha)}','${escapeJs(p.username)}')">Elimina definitivamente</button>
                </div>
              </div>`;
          }).join('')}
      </div>`;
  } catch (e) {
    renderError('Errore caricamento cestino', e.message);
  }
}

async function ripristinaUtentePref(cestinoPath, username) {
  showModal({
    title: `Ripristinare preferenze di ${escapeHtml(username)}?`,
    subtitle: 'Il file viene spostato dal cestino a content/user-prefs/. L\'utente deve comunque essere ricreato separatamente (questa operazione ripristina solo le sue preferenze, non le credenziali).',
    body: '',
    actions: [
      { label: 'Annulla', variant: 'ghost', onClick: closeModal },
      { label: 'Ripristina', onClick: async () => {
        closeModal();
        try {
          const cestinoFile = await gh.getFile(cestinoPath);
          if (!cestinoFile) throw new Error('File cestino non trovato');
          const targetPath = `content/user-prefs/${username}.yml`;
          // Verifica che non esista già un file identico (nuovo utente omonimo)
          const existing = await gh.getFile(targetPath);
          if (existing) throw new Error(`Esiste già un file ${targetPath}. Rimuovi o rinomina l'utente attuale prima di ripristinare.`);
          await gh.putFile(targetPath, cestinoFile.content, null, `Ripristina preferenze di ${username} (by ${state.session.username})`);
          await gh.deleteFile(cestinoPath, cestinoFile.sha, `Rimuovi da cestino: ${username} ripristinato`);
          toast(`Preferenze di ${username} ripristinate`, 'success');
          renderCestinoUtenti();
        } catch (e) {
          toast('Errore: ' + e.message, 'error');
        }
      }}
    ]
  });
}

async function eliminaDefPref(cestinoPath, sha, username) {
  showModal({
    title: `Eliminare definitivamente?`,
    subtitle: `Questa operazione è irreversibile. Verrà cancellato il file di preferenze archiviato di <strong>${escapeHtml(username)}</strong>.`,
    body: '',
    actions: [
      { label: 'Annulla', variant: 'ghost', onClick: closeModal },
      { label: 'Elimina', variant: 'danger', onClick: async () => {
        closeModal();
        try {
          await gh.deleteFile(cestinoPath, sha, `Elimina definitivamente preferenze di ${username} (by ${state.session.username})`);
          toast(`Preferenze di ${username} eliminate definitivamente`, 'success');
          renderCestinoUtenti();
        } catch (e) {
          toast('Errore: ' + e.message, 'error');
        }
      }}
    ]
  });
}

async function svuotaCestinoUtenti() {
  showModal({
    title: 'Svuotare cestino utenti?',
    subtitle: 'Verranno eliminati definitivamente TUTTI i file di preferenze archiviati. Operazione irreversibile.',
    body: '',
    actions: [
      { label: 'Annulla', variant: 'ghost', onClick: closeModal },
      { label: 'Svuota', variant: 'danger', onClick: async () => {
        closeModal();
        try {
          const list = await gh.listDir('cestino/user-prefs');
          const files = Array.isArray(list) ? list.filter(x => x.type === 'file') : [];
          for (const f of files) {
            try {
              await gh.deleteFile(f.path, f.sha, `Svuota cestino user-prefs (by ${state.session.username})`);
            } catch (e) { console.warn('delete failed for', f.path, e); }
          }
          toast(`Cestino utenti svuotato (${files.length} file)`, 'success');
          renderCestinoUtenti();
        } catch (e) {
          toast('Errore: ' + e.message, 'error');
        }
      }}
    ]
  });
}
