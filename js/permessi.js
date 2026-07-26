/* ============================ PERMESSI (per sezione: visualizza / modifica) ============================
 *
 * Modello a due livelli per ogni sezione dell'app:
 *   'none' → sezione nascosta (voce di nav rimossa, rotte bloccate)
 *   'view' → sola lettura
 *   'edit' → lettura + creazione / modifica / eliminazione
 *
 * Risoluzione, dal più specifico al più generico:
 *   1. admin (is_admin + token_auth) → 'edit' su tutto, sempre
 *   2. permessi del singolo utente   → data.utenti[<username>].permessi
 *   3. permessi del ruolo            → data.permessi_ruoli[<ruolo>]
 *   4. default                       → PERMESSO_DEFAULT ('edit')
 *
 * Il default è 'edit' di proposito: un'installazione senza permessi configurati
 * si comporta esattamente come prima di questa feature. Le restrizioni vanno
 * aggiunte esplicitamente dall'admin.
 *
 * Persistenza: file auth `data/encrypted-tokens.json`, in chiaro accanto a
 * `is_admin` e `ruolo` (non sono dati sensibili). Scrittura via `gh_auth`,
 * quindi solo admin.
 *
 * Per aggiungere una sezione futura basta una riga in PERMESSI_SEZIONI: la
 * modale, i filtri di nav e la guardia del router la prendono da lì.
 */

const PERMESSO_DEFAULT = 'edit';

const PERMESSI_SEZIONI = [
  { key: 'procedure',  label: 'Procedure',       routes: ['procedure', 'procedure-cat', 'procedura'], routesEdit: ['procedura-edit'] },
  { key: 'clinica',    label: 'Schede cliniche', routes: ['clinica', 'clinica-scheda'],               routesEdit: ['clinica-edit'] },
  { key: 'numeri',     label: 'Rubrica',         routes: ['numeri'],                                  routesEdit: [] },
  { key: 'moduli',     label: 'Moduli',          routes: ['moduli', 'modulo'],                        routesEdit: ['modulo-edit'] },
  { key: 'calendario', label: 'Calendario',      routes: ['calendario'],                              routesEdit: [] },
  { key: 'reparto',    label: 'Reparto',         routes: ['reparto'],                                 routesEdit: [] },
  { key: 'lettere',    label: 'LetteraAI',       routes: ['lettere'],                                 routesEdit: [], routePrefix: 'lettere-' }
];

/* --- Modello ------------------------------------------------------------ */

// Mappa {sezione: livello} con tutte le sezioni al livello indicato
function permessiTutti(livello) {
  const out = {};
  PERMESSI_SEZIONI.forEach(s => { out[s.key] = livello; });
  return out;
}

// Ripulisce una mappa letta dal file auth: solo chiavi note, solo livelli validi
function normalizzaPermessi(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  PERMESSI_SEZIONI.forEach(s => {
    const v = raw[s.key];
    if (v === 'none' || v === 'view' || v === 'edit') out[s.key] = v;
  });
  return out;
}

// Permessi effettivi di un utente: override personali sopra i default del ruolo
function permessiEffettivi(entry, ruoliMap) {
  entry = entry || {};
  if (entry.is_admin) return permessiTutti('edit');
  const ruolo = entry.ruolo || '—';
  const daRuolo = normalizzaPermessi((ruoliMap || {})[ruolo]);
  const daUtente = normalizzaPermessi(entry.permessi);
  const out = {};
  PERMESSI_SEZIONI.forEach(s => {
    out[s.key] = daUtente[s.key] || daRuolo[s.key] || PERMESSO_DEFAULT;
  });
  return out;
}

// Calcola i permessi da salvare in state.session al login (o al refresh)
function permessiPerSessione(entry, tokensFile) {
  return permessiEffettivi(entry, (tokensFile || {}).permessi_ruoli);
}

/* --- Interrogazione a runtime ------------------------------------------- */

// Livello effettivo della sessione corrente su una sezione
function permessoSezione(key) {
  if (typeof isAdmin === 'function' && isAdmin()) return 'edit';
  const p = (state.session && state.session.permessi) || null;
  if (!p) return PERMESSO_DEFAULT;   // sessione vecchia (pre-permessi): comportamento storico
  return p[key] || PERMESSO_DEFAULT;
}

function puoVedere(key) {
  return permessoSezione(key) !== 'none';
}

function puoModificare(key) {
  return permessoSezione(key) === 'edit';
}

// Guardia da mettere in testa alle azioni di modifica: se il permesso manca
// avvisa e restituisce true (il chiamante fa `return`). L'avviso è la modale di
// js/richieste.js, che offre anche l'invio della richiesta agli admin.
function bloccaSeNonModifica(key) {
  if (puoModificare(key)) return false;
  if (typeof openAzioneBloccataModal === 'function') {
    openAzioneBloccataModal(key);
  } else {
    const sez = PERMESSI_SEZIONI.find(s => s.key === key);
    toast(`Non hai i permessi per modificare ${sez ? sez.label : key}.`, 'warning');
  }
  return true;
}

// Sezione a cui appartiene una rotta del router (null se non governata)
function sezionePerRoute(route) {
  if (!route) return null;
  for (const s of PERMESSI_SEZIONI) {
    if (s.routes.includes(route)) return s;
    if ((s.routesEdit || []).includes(route)) return s;
    if (s.routePrefix && route.startsWith(s.routePrefix)) return s;
  }
  return null;
}

// Messaggio di rifiuto se la rotta non è consentita, altrimenti null.
// Usata come guardia in navigate().
function permessoRouteNegato(route) {
  const sez = sezionePerRoute(route);
  if (!sez) return null;
  const liv = permessoSezione(sez.key);
  if (liv === 'none') return `Non hai i permessi per visualizzare la sezione "${sez.label}".`;
  if ((sez.routesEdit || []).includes(route) && liv !== 'edit') {
    return `Non hai i permessi per modificare la sezione "${sez.label}".`;
  }
  return null;
}

// Riallinea i permessi della sessione al file auth, senza bloccare il boot:
// così le modifiche dell'admin valgono dal riavvio dell'app, non dal prossimo login.
async function refreshPermessiSessione() {
  try {
    if (!state.session || !state.session.username) return;
    const tf = await loadTokensFile();
    state.tokensFile = tf;
    const entry = (tf.utenti || {})[state.session.username];
    if (!entry) return;
    const nuovi = permessiPerSessione(entry, tf);
    const cambiati = JSON.stringify(nuovi) !== JSON.stringify(state.session.permessi || null);
    if (!cambiati) return;
    state.session.permessi = nuovi;
    saveSession();
    if (typeof renderNavTree === 'function') renderNavTree();
  } catch (e) {
    console.warn('[permessi] refresh non riuscito:', e);
  }
}

/* --- UI condivisa: griglia di checkbox ----------------------------------- */

/*
 * Griglia "Visualizza / Modifica" usata da entrambe le modali.
 * `prefix` distingue gli id quando la griglia viene ricostruita (modale ruoli).
 * `permessi` è la mappa iniziale; `eredita` mostra, per ogni sezione, il livello
 * ereditato quando l'utente non ha override.
 */
function renderPermessiGrid(prefix, permessi, opts) {
  opts = opts || {};
  const p = permessi || {};
  const disabled = opts.disabled ? ' disabled' : '';
  const rows = PERMESSI_SEZIONI.map(s => {
    const liv = p[s.key] || PERMESSO_DEFAULT;
    const vChecked = liv !== 'none' ? ' checked' : '';
    const eChecked = liv === 'edit' ? ' checked' : '';
    const hint = opts.hints && opts.hints[s.key] ? `<span class="perm-hint">${escapeHtml(opts.hints[s.key])}</span>` : '';
    return `
      <div class="perm-row">
        <div class="perm-sez">${escapeHtml(s.label)}${hint}</div>
        <label class="perm-cell"><input type="checkbox" data-perm-view="${s.key}" id="${prefix}-v-${s.key}"${vChecked}${disabled}><span>Visualizza</span></label>
        <label class="perm-cell"><input type="checkbox" data-perm-edit="${s.key}" id="${prefix}-e-${s.key}"${eChecked}${disabled}><span>Modifica</span></label>
      </div>`;
  }).join('');
  return `<div class="perm-grid" id="${prefix}-grid">${rows}</div>`;
}

// Collega la logica fra le due checkbox: "Modifica" implica "Visualizza".
function wirePermessiGrid(prefix) {
  const grid = document.getElementById(`${prefix}-grid`);
  if (!grid) return;
  grid.querySelectorAll('[data-perm-edit]').forEach(cbE => {
    const key = cbE.dataset.permEdit;
    const cbV = document.getElementById(`${prefix}-v-${key}`);
    cbE.addEventListener('change', () => { if (cbE.checked && cbV) cbV.checked = true; });
    if (cbV) cbV.addEventListener('change', () => { if (!cbV.checked) cbE.checked = false; });
  });
}

// Legge la griglia e restituisce la mappa {sezione: livello}
function leggiPermessiGrid(prefix) {
  const out = {};
  PERMESSI_SEZIONI.forEach(s => {
    const v = document.getElementById(`${prefix}-v-${s.key}`);
    const e = document.getElementById(`${prefix}-e-${s.key}`);
    if (!v || !e) return;
    out[s.key] = e.checked ? 'edit' : (v.checked ? 'view' : 'none');
  });
  return out;
}

/* --- Modale: permessi del singolo utente --------------------------------- */

function modificaPermessiUtente(username) {
  if (!isAdmin()) return toast('Solo gli amministratori possono modificare i permessi.', 'error');
  const data = (gestioneUtentiState && gestioneUtentiState._data) || {};
  const entry = (data.utenti || {})[username];
  if (!entry) return toast('Utente non trovato.', 'error');

  if (entry.is_admin) {
    return showModal({
      title: `Permessi di ${escapeHtml(username)}`,
      subtitle: 'Utente amministratore.',
      body: `<p style="font-size:14px;color:var(--ink-muted);">Gli amministratori hanno sempre accesso completo a tutte le sezioni. Per limitarli, rimuovi prima lo stato admin con "Rimuovi admin".</p>`,
      actions: [{ label: 'Chiudi', variant: 'ghost', onClick: closeModal }]
    });
  }

  const ruolo = entry.ruolo || '—';
  const ruoliMap = data.permessi_ruoli || {};
  const daRuolo = normalizzaPermessi(ruoliMap[ruolo]);
  const override = normalizzaPermessi(entry.permessi);
  const haOverride = Object.keys(override).length > 0;
  // Valori mostrati: gli effettivi (override se c'è, altrimenti quelli del ruolo)
  const effettivi = permessiEffettivi(entry, ruoliMap);
  const etichettaLivello = { none: 'nascosta', view: 'sola lettura', edit: 'modifica' };
  const hints = {};
  PERMESSI_SEZIONI.forEach(s => {
    hints[s.key] = `da ruolo: ${etichettaLivello[daRuolo[s.key] || PERMESSO_DEFAULT]}`;
  });

  showModal({
    title: `Permessi di ${escapeHtml(username)}`,
    subtitle: `Ruolo: <strong>${escapeHtml(ruoloLabel(ruolo))}</strong>. "Modifica" include creazione ed eliminazione. Senza "Visualizza" la sezione sparisce dalla navigazione.`,
    body: `
      <label class="perm-inherit">
        <input type="checkbox" id="pu-eredita" ${haOverride ? '' : 'checked'}>
        <span>Usa i permessi del ruolo (nessuna personalizzazione)</span>
      </label>
      ${renderPermessiGrid('pu', effettivi, { hints })}
      <div id="pu-error" style="color:var(--danger);font-size:13px;display:none;margin-top:8px;padding:8px 12px;background:var(--danger-soft);border-left:3px solid var(--danger);"></div>`,
    actions: [
      { label: 'Annulla', variant: 'ghost', onClick: closeModal },
      { label: 'Salva permessi', onClick: async (btn) => {
        const err = $('pu-error');
        const showErr = (m) => { err.textContent = m; err.style.display = 'block'; };
        const eredita = $('pu-eredita').checked;
        const nuovi = leggiPermessiGrid('pu');
        btn.disabled = true;
        try {
          const { data: fresh, sha } = await gh_auth.getTokensFile();
          const ent = (fresh.utenti || {})[username];
          if (!ent) { btn.disabled = false; return showErr('Utente non trovato.'); }
          if (eredita) delete ent.permessi;
          else ent.permessi = nuovi;
          await gh_auth.putTokensFile(fresh, sha, `Permessi di ${username} aggiornati (by ${state.session.username})`);
          closeModal();
          toast(`Permessi di ${username} aggiornati`, 'success');
          renderGestioneUtenti();
        } catch (e) {
          btn.disabled = false;
          showErr('Errore: ' + e.message);
        }
      }}
    ]
  });

  wirePermessiGrid('pu');
  // La spunta "eredita dal ruolo" disabilita la griglia
  const cbEredita = $('pu-eredita');
  const syncEredita = () => {
    const off = cbEredita.checked;
    const grid = $('pu-grid');
    if (grid) {
      grid.classList.toggle('perm-grid-off', off);
      grid.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.disabled = off; });
    }
  };
  cbEredita.addEventListener('change', () => {
    // Tornando all'ereditarietà rimetto in griglia i valori del ruolo
    if (cbEredita.checked) {
      PERMESSI_SEZIONI.forEach(s => {
        const liv = daRuolo[s.key] || PERMESSO_DEFAULT;
        const v = document.getElementById(`pu-v-${s.key}`);
        const e = document.getElementById(`pu-e-${s.key}`);
        if (v) v.checked = liv !== 'none';
        if (e) e.checked = liv === 'edit';
      });
    }
    syncEredita();
  });
  syncEredita();
}

/* --- Modale: permessi per ruolo ------------------------------------------ */

// Elenco dei ruoli presenti nel file auth, più quelli standard
function ruoliDisponibili(data) {
  const set = new Set(RUOLI_STANDARD);
  Object.values((data && data.utenti) || {}).forEach(e => {
    if (e.ruolo) set.add(e.ruolo);
    else set.add('—');
  });
  Object.keys((data && data.permessi_ruoli) || {}).forEach(r => set.add(r));
  const arr = Array.from(set).filter(r => r !== '—').sort((a, b) => a.localeCompare(b));
  if (set.has('—')) arr.push('—');
  return arr;
}

// Stato della modale ruoli: modifiche pending per tutti i ruoli toccati
const permessiRuoliState = { ruoloCorrente: null, pending: {} };

function modificaPermessiRuoli() {
  if (!isAdmin()) return toast('Solo gli amministratori possono modificare i permessi.', 'error');
  const data = (gestioneUtentiState && gestioneUtentiState._data) || {};
  const ruoli = ruoliDisponibili(data);
  if (!ruoli.length) return toast('Nessun ruolo definito.', 'error');

  permessiRuoliState.pending = {};
  ruoli.forEach(r => {
    permessiRuoliState.pending[r] = Object.assign(
      permessiTutti(PERMESSO_DEFAULT),
      normalizzaPermessi((data.permessi_ruoli || {})[r])
    );
  });
  permessiRuoliState.ruoloCorrente = ruoli[0];

  const opzioni = ruoli.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(ruoloLabel(r))}</option>`).join('');

  showModal({
    title: 'Permessi per ruolo',
    subtitle: 'Valgono per tutti gli utenti del ruolo, tranne quelli con permessi personalizzati. Gli amministratori hanno sempre accesso completo.',
    body: `
      <div class="field" style="margin-bottom:12px;">
        <label style="display:block;font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--ink-muted);margin-bottom:6px;">Ruolo</label>
        <select id="pr-ruolo" style="width:100%;padding:10px 12px;border:1px solid var(--rule);border-radius:2px;font-size:15px;background:var(--bg-paper);">${opzioni}</select>
      </div>
      <div id="pr-grid-wrap">${renderPermessiGrid('pr', permessiRuoliState.pending[permessiRuoliState.ruoloCorrente])}</div>
      <div id="pr-dirty" style="font-size:12px;color:var(--ink-muted);margin-top:10px;"></div>
      <div id="pr-error" style="color:var(--danger);font-size:13px;display:none;margin-top:8px;padding:8px 12px;background:var(--danger-soft);border-left:3px solid var(--danger);"></div>`,
    actions: [
      { label: 'Annulla', variant: 'ghost', onClick: closeModal },
      { label: 'Salva tutti i ruoli', onClick: async (btn) => {
        _prSyncPending();
        const err = $('pr-error');
        const showErr = (m) => { err.textContent = m; err.style.display = 'block'; };
        btn.disabled = true;
        try {
          const { data: fresh, sha } = await gh_auth.getTokensFile();
          if (!fresh.permessi_ruoli) fresh.permessi_ruoli = {};
          Object.keys(permessiRuoliState.pending).forEach(r => {
            fresh.permessi_ruoli[r] = permessiRuoliState.pending[r];
          });
          await gh_auth.putTokensFile(fresh, sha, `Permessi per ruolo aggiornati (by ${state.session.username})`);
          closeModal();
          toast('Permessi per ruolo aggiornati', 'success');
          renderGestioneUtenti();
        } catch (e) {
          btn.disabled = false;
          showErr('Errore: ' + e.message);
        }
      }}
    ]
  });

  wirePermessiGrid('pr');
  _prAggiornaNota();
  $('pr-ruolo').addEventListener('change', (e) => {
    _prSyncPending();                              // salvo le spunte del ruolo che sto lasciando
    permessiRuoliState.ruoloCorrente = e.target.value;
    $('pr-grid-wrap').innerHTML = renderPermessiGrid('pr', permessiRuoliState.pending[permessiRuoliState.ruoloCorrente]);
    wirePermessiGrid('pr');
    _prAggiornaNota();
  });
}

// Travasa le spunte visibili nello stato pending del ruolo corrente
function _prSyncPending() {
  const r = permessiRuoliState.ruoloCorrente;
  if (!r) return;
  permessiRuoliState.pending[r] = leggiPermessiGrid('pr');
}

function _prAggiornaNota() {
  const el = $('pr-dirty');
  if (!el) return;
  const data = (gestioneUtentiState && gestioneUtentiState._data) || {};
  const r = permessiRuoliState.ruoloCorrente;
  const n = Object.entries((data.utenti || {})).filter(([, e]) => !e.is_admin && (e.ruolo || '—') === r).length;
  const nOverride = Object.entries((data.utenti || {})).filter(([, e]) => !e.is_admin && (e.ruolo || '—') === r && e.permessi).length;
  el.textContent = `${n} utente/i con questo ruolo` + (nOverride ? ` · ${nOverride} con permessi personalizzati (non toccati)` : '');
}
