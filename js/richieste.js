/* ============================ RICHIESTE DI MODIFICA ============================
 *
 * Valvola di sfogo del sistema permessi: chi può visualizzare ma non modificare
 * descrive la modifica che vorrebbe, gli admin la leggono e la applicano a mano,
 * poi segnano la richiesta come fatta o rifiutata. Nessun permesso viene toccato
 * dall'approvazione (per concedere davvero i permessi c'è js/permessi.js).
 *
 * Storage: `content/richieste.yml` nel repo dati, stesso schema di
 * `content/segnalazioni.yml` (scrittura col token_data dell'utente, quindi
 * accessibile a tutti i loggati).
 *
 * Punti d'ingresso: modale dell'azione bloccata (`bloccaSeNonModifica` in
 * js/permessi.js), pagina "Accesso negato" del router e voce nel menu utente.
 * Vista admin: rotta `richieste` (`renderRichieste`).
 */

const RICHIESTE_PATH = 'content/richieste.yml';

async function _loadRichieste() {
  try {
    const f = await gh.getFile(RICHIESTE_PATH);
    if (!f) return { lista: [], sha: null };
    const data = jsyaml.load(f.content) || {};
    return { lista: Array.isArray(data.richieste) ? data.richieste : [], sha: f.sha };
  } catch (e) { console.warn('[richieste] load fallito', e); return { lista: [], sha: null }; }
}

async function _saveRichieste(lista, sha, msg) {
  const content = `# Richieste di modifica — gestite dall'app, non modificare a mano\n\n` +
    jsyaml.dump({ richieste: lista }, { lineWidth: 120, noRefs: true });
  return gh.putFile(RICHIESTE_PATH, content, sha, msg);
}

// Descrizione leggibile della pagina da cui parte la richiesta
function _contestoCorrente() {
  const p = state.currentParams || {};
  const extra = p.slug || p.id || p.tag || p.filter || p.cat || '';
  return (state.currentView || '') + (extra ? ' · ' + extra : '');
}

/*
 * Modale di richiesta. `opts.sezione` precompila la sezione (arriva dall'azione
 * bloccata); senza opzioni l'utente sceglie da sé (voce del menu utente).
 */
function openRichiestaModal(opts) {
  opts = opts || {};
  const sezSel = opts.sezione || '';
  const options = PERMESSI_SEZIONI.map(s =>
    `<option value="${escapeHtml(s.key)}"${s.key === sezSel ? ' selected' : ''}>${escapeHtml(s.label)}</option>`
  ).join('');
  showModal({
    title: 'Richiedi una modifica',
    subtitle: 'Descrivi la modifica che vorresti: gli amministratori la vedranno e potranno applicarla.',
    body: `<div style="min-width:min(460px,88vw);">
      <div class="field" style="margin-bottom:12px;">
        <label>Sezione</label>
        <select id="rich-sezione" style="width:100%;padding:10px 12px;border:1px solid var(--rule);border-radius:2px;font-size:15px;background:var(--bg-paper);">
          <option value="">— nessuna in particolare —</option>
          ${options}
        </select>
      </div>
      <div class="field">
        <label>Cosa va modificato</label>
        <textarea id="rich-text" rows="5" class="mono-input" style="width:100%;" placeholder="Es. nella scheda Rachicentesi il dosaggio al punto 3 è sbagliato, va 10 mg"></textarea>
      </div>
      <div style="font-size:12px;color:var(--ink-muted);margin-top:6px;">Verranno salvati anche il tuo nome utente e la pagina corrente${opts.contesto ? ` (<code>${escapeHtml(opts.contesto)}</code>)` : ''}, per dare contesto.</div>
    </div>`,
    actions: [
      { label: 'Annulla', variant: 'ghost', onClick: () => closeModal() },
      { label: 'Invia richiesta', onClick: (btn) => runWithSpinner(btn, () => inviaRichiestaModifica(opts.contesto)) }
    ]
  });
  setTimeout(() => { const t = document.getElementById('rich-text'); if (t) t.focus(); }, 50);
}

async function inviaRichiestaModifica(contesto) {
  const ta = document.getElementById('rich-text');
  const testo = ta ? ta.value.trim() : '';
  if (!testo) { toast('Descrivi la modifica prima di inviare.', 'error'); return; }
  const selEl = document.getElementById('rich-sezione');
  const sezione = selEl ? selEl.value : '';
  const { lista, sha } = await _loadRichieste();
  lista.unshift({
    id: 'r-' + Date.now().toString(36),
    testo,
    sezione: sezione || '',
    utente: (state.session && state.session.username) || 'anon',
    data: nowIso(),
    contesto: contesto || _contestoCorrente(),
    stato: 'aperta'
  });
  try {
    await _saveRichieste(lista, sha, `Nuova richiesta di modifica da ${(state.session && state.session.username) || 'anon'}`);
    closeModal();
    toast('Richiesta inviata agli amministratori.', 'success');
  } catch (e) {
    toast("Errore nell'invio della richiesta.", 'error');
  }
}

/*
 * Modale mostrata al posto del vecchio toast quando un'azione di modifica è
 * bloccata dai permessi: spiega e offre la scorciatoia per la richiesta.
 */
function openAzioneBloccataModal(sezioneKey) {
  const sez = PERMESSI_SEZIONI.find(s => s.key === sezioneKey);
  const label = sez ? sez.label : sezioneKey;
  showModal({
    title: 'Permesso mancante',
    subtitle: `Non hai il permesso di modificare la sezione <strong>${escapeHtml(label)}</strong>.`,
    body: `<p style="font-size:14px;color:var(--ink-muted);max-width:440px;">Puoi consultarla, ma non modificarla. Se serve una correzione, chiedila agli amministratori: la applicheranno loro.</p>`,
    actions: [
      { label: 'Chiudi', variant: 'ghost', onClick: () => closeModal() },
      { label: 'Richiedi agli amministratori', onClick: () => openRichiestaModal({ sezione: sezioneKey, contesto: _contestoCorrente() }) }
    ]
  });
}

// Pagina "Accesso negato" del router, con la scorciatoia alla richiesta
function renderAccessoNegato(messaggio, route) {
  const sez = (typeof sezionePerRoute === 'function') ? sezionePerRoute(route) : null;
  $('main-content').innerHTML = `
    <div class="empty">
      <div class="empty-title">Accesso negato</div>
      <p>${escapeHtml(messaggio || '')}</p>
      <div style="margin-top:20px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
        <button class="btn ghost" onclick="navigate('home')">Torna alla home</button>
        <button class="btn" onclick="openRichiestaModal({sezione:'${escapeJs(sez ? sez.key : '')}'})">Richiedi agli amministratori</button>
      </div>
    </div>`;
}

/* --- Vista admin --------------------------------------------------------- */

async function renderRichieste() {
  const mc = $('main-content');
  if (!mc) return;
  if (!isAdmin()) {
    return renderError('Accesso negato', 'Solo amministratori.');
  }
  mc.innerHTML = `<div class="loading"><span class="spinner"></span> Caricamento richieste...</div>`;
  const { lista } = await _loadRichieste();
  const aperte = lista.filter(r => (r.stato || 'aperta') === 'aperta');
  const fatte = lista.filter(r => r.stato === 'fatta');
  const rifiutate = lista.filter(r => r.stato === 'rifiutata');

  const sezLabel = (key) => {
    const s = PERMESSI_SEZIONI.find(x => x.key === key);
    return s ? s.label : (key || '');
  };
  const card = (r) => {
    const chiusa = (r.stato || 'aperta') !== 'aperta';
    return `<div style="border:1px solid var(--rule);border-radius:6px;padding:12px 14px;margin-bottom:10px;background:var(--bg-paper);${chiusa ? 'opacity:.6;' : ''}">
      <div style="font-size:14px;color:var(--ink);white-space:pre-wrap;">${escapeHtml(r.testo)}</div>
      <div style="font-size:12px;color:var(--ink-muted);font-family:var(--mono);margin-top:6px;">
        ${escapeHtml(r.utente || '?')} · ${escapeHtml((r.data || '').slice(0, 16).replace('T', ' '))}${r.sezione ? ' · ' + escapeHtml(sezLabel(r.sezione)) : ''}${r.contesto ? ' · ' + escapeHtml(r.contesto) : ''}
        ${r.gestita_da ? `<br>${escapeHtml(r.stato === 'fatta' ? 'fatta' : 'rifiutata')} da ${escapeHtml(r.gestita_da)} · ${escapeHtml((r.gestita_il || '').slice(0, 16).replace('T', ' '))}` : ''}
      </div>
      <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
        ${chiusa
          ? `<button class="btn ghost sm" onclick="setStatoRichiesta('${escapeJs(r.id)}', 'aperta', this)">↺ Riapri</button>`
          : `<button class="btn ghost sm" onclick="setStatoRichiesta('${escapeJs(r.id)}', 'fatta', this)">✓ Fatto</button>
             <button class="btn ghost sm" onclick="setStatoRichiesta('${escapeJs(r.id)}', 'rifiutata', this)">✕ Rifiuta</button>`}
        <button class="btn ghost danger sm" onclick="eliminaRichiesta('${escapeJs(r.id)}', this)">🗑 Elimina</button>
      </div>
    </div>`;
  };
  const sectTitle = (t) => `<div style="font-family:var(--mono);font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-muted);margin:14px 0 8px;">${t}</div>`;

  mc.innerHTML = `
    <div class="page-head">
      <div class="page-eyebrow">${buildBreadcrumb([{label:'Home', route:'home'}])}Amministrazione</div>
      <h1 class="page-title">Richieste di <em>modifica</em></h1>
      <div class="page-actions" style="margin-top:16px;">
        <button class="btn ghost" onclick="navigate('utenti')">Gestione utenti</button>
      </div>
    </div>
    ${lista.length === 0 ? '<p style="color:var(--ink-muted);">Nessuna richiesta ricevuta.</p>' : ''}
    ${aperte.length ? sectTitle(`Da gestire (${aperte.length})`) + aperte.map(card).join('') : ''}
    ${fatte.length ? sectTitle(`Fatte (${fatte.length})`) + fatte.map(card).join('') : ''}
    ${rifiutate.length ? sectTitle(`Rifiutate (${rifiutate.length})`) + rifiutate.map(card).join('') : ''}`;
}

async function setStatoRichiesta(id, stato, btn) {
  await runWithSpinner(btn, async () => {
    const { lista, sha } = await _loadRichieste();
    const r = lista.find(x => x.id === id);
    if (!r) return;
    r.stato = stato;
    if (stato === 'aperta') {
      delete r.gestita_da;
      delete r.gestita_il;
    } else {
      r.gestita_da = (state.session && state.session.username) || '?';
      r.gestita_il = nowIso();
    }
    await _saveRichieste(lista, sha, `Richiesta ${id} → ${stato}`);
    renderRichieste();
  });
}

async function eliminaRichiesta(id, btn) {
  if (!confirm('Eliminare definitivamente questa richiesta?')) return;
  await runWithSpinner(btn, async () => {
    const { lista, sha } = await _loadRichieste();
    await _saveRichieste(lista.filter(x => x.id !== id), sha, `Elimina richiesta ${id}`);
    renderRichieste();
  });
}
