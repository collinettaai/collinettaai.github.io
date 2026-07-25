/* ============================ MODAL ============================ */
function showModal({ title, subtitle, body, actions }) {
  closeModal();
  const container = $('modal-container');
  const actionsHtml = (actions || []).map((a, i) => {
    const variant = a.variant === 'danger' ? 'danger' : a.variant === 'ghost' ? 'ghost' : '';
    const disabledAttr = a.disabled ? ' disabled' : '';
    return `<button class="btn ${variant}" data-action-idx="${i}"${disabledAttr}>${escapeHtml(a.label)}</button>`;
  }).join('');
  container.innerHTML = `
    <div class="modal-backdrop" id="current-modal-backdrop">
      <div class="modal">
        <div class="modal-head">
          <div class="modal-title">${title}</div>
          ${subtitle ? `<div class="modal-sub">${subtitle}</div>` : ''}
        </div>
        ${body ? `<div class="modal-body">${body}</div>` : ''}
        ${actionsHtml ? `<div class="modal-actions">${actionsHtml}</div>` : ''}
      </div>
    </div>`;
  $$('[data-action-idx]').forEach(btn => {
    const idx = parseInt(btn.dataset.actionIdx, 10);
    btn.addEventListener('click', () => {
      const action = actions[idx];
      if (action && action.onClick) action.onClick(btn);
    });
  });
  const backdrop = $('current-modal-backdrop');
  if (backdrop) backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
}

function closeModal() {
  $('modal-container').innerHTML = '';
}

// Overlay bloccante per operazioni multi-step (gestione pagine, eliminazione moduli).
// Mostra spinner + messaggio principale e un sottotitolo opzionale (es. progresso "2/5").
// Blocca click e navigazione finché non viene chiuso con hideBlockingOverlay().
let _blockingActive = false;
window.addEventListener('beforeunload', (e) => {
  if (_blockingActive) { e.preventDefault(); e.returnValue = ''; return ''; }
});
function showBlockingOverlay(msg, sub) {
  const el = document.getElementById('blocking-overlay');
  if (!el) return;
  el.innerHTML = `
    <div class="blocking-card" role="status" aria-live="polite">
      <div class="blocking-spinner"></div>
      <div class="blocking-msg" id="blocking-msg">${escapeHtml(msg || 'Operazione in corso…')}</div>
      <div class="blocking-sub" id="blocking-sub">${escapeHtml(sub || 'Non chiudere o ricaricare la pagina.')}</div>
    </div>`;
  el.classList.add('show');
  el.setAttribute('aria-hidden', 'false');
  _blockingActive = true;
}
function updateBlockingOverlay(msg, sub) {
  if (!_blockingActive) return;
  const m = document.getElementById('blocking-msg');
  const s = document.getElementById('blocking-sub');
  if (m && msg != null) m.textContent = msg;
  if (s && sub != null) s.textContent = sub;
}
function hideBlockingOverlay() {
  const el = document.getElementById('blocking-overlay');
  if (!el) return;
  el.classList.remove('show');
  el.innerHTML = '';
  el.setAttribute('aria-hidden', 'true');
  _blockingActive = false;
}

// Esegue un'azione asincrona (salvataggio/modifica) mostrando uno spinner nel pulsante e
// disabilitandolo finché non finisce, così l'utente non può cliccare più volte.
async function runWithSpinner(btn, fn) {
  if (btn && btn.disabled) return;
  let orig = null;
  if (btn) {
    orig = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add('btn-loading');
    btn.innerHTML = '<span class="btn-spinner"></span>';
  }
  try {
    await fn();
  } catch (e) {
    console.warn('[runWithSpinner] azione fallita:', e);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('btn-loading');
      // Se il pulsante è ancora nel DOM (la vista non è stata ridisegnata) ripristino l'etichetta.
      if (btn.isConnected) btn.innerHTML = orig;
    }
  }
}
window.runWithSpinner = runWithSpinner;

// ── Segnalazioni utenti (feedback errori) — storage in content/segnalazioni.yml ──
const SEGNALAZIONI_PATH = 'content/segnalazioni.yml';
async function _loadSegnalazioni() {
  try {
    const f = await gh.getFile(SEGNALAZIONI_PATH);
    if (!f) return { lista: [], sha: null };
    const data = jsyaml.load(f.content) || {};
    return { lista: Array.isArray(data.segnalazioni) ? data.segnalazioni : [], sha: f.sha };
  } catch (e) { console.warn('[segnalazioni] load fallito', e); return { lista: [], sha: null }; }
}
async function _saveSegnalazioni(lista, sha, msg) {
  const content = `# Segnalazioni utenti — gestite dall'app, non modificare a mano\n\n` +
    jsyaml.dump({ segnalazioni: lista }, { lineWidth: 120, noRefs: true });
  return gh.putFile(SEGNALAZIONI_PATH, content, sha, msg);
}

function openSegnalazioneModal() {
  showModal({
    title: 'Segnala un problema',
    subtitle: "Descrivi l'errore o il suggerimento: gli amministratori lo leggeranno.",
    body: `<div style="min-width:min(460px,88vw);">
      <textarea id="segn-text" rows="5" class="mono-input" style="width:100%;" placeholder="Es. Nel modulo consenso il campo data non si salva..."></textarea>
      <div style="font-size:12px;color:var(--ink-muted);margin-top:6px;">Verranno salvati anche il tuo nome utente e la pagina corrente, per dare contesto.</div>
    </div>`,
    actions: [
      { label: 'Annulla', variant: 'ghost', onClick: () => closeModal() },
      { label: 'Invia segnalazione', onClick: (btn) => runWithSpinner(btn, inviaSegnalazione) }
    ]
  });
  setTimeout(() => { const t = document.getElementById('segn-text'); if (t) t.focus(); }, 50);
}

async function inviaSegnalazione() {
  const ta = document.getElementById('segn-text');
  const testo = ta ? ta.value.trim() : '';
  if (!testo) { toast('Scrivi una descrizione prima di inviare.', 'error'); return; }
  const { lista, sha } = await _loadSegnalazioni();
  lista.unshift({
    id: 's-' + Date.now().toString(36),
    testo,
    utente: (state.session && state.session.username) || 'anon',
    data: nowIso(),
    contesto: state.currentView || '',
    risolto: false
  });
  try {
    await _saveSegnalazioni(lista, sha, `Nuova segnalazione da ${(state.session && state.session.username) || 'anon'}`);
    closeModal();
    toast('Segnalazione inviata. Grazie!', 'success');
  } catch (e) {
    toast("Errore nell'invio della segnalazione.", 'error');
  }
}

async function renderSegnalazioni() {
  const mc = $('main-content');
  if (!mc) return;
  if (typeof isAdmin === 'function' && !isAdmin()) {
    mc.innerHTML = `<div class="page-head"><h1 class="page-title">Segnalazioni</h1></div><p style="color:var(--ink-muted);">Sezione riservata agli amministratori.</p>`;
    return;
  }
  mc.innerHTML = `<div class="loading"><span class="spinner"></span> Caricamento segnalazioni...</div>`;
  const { lista } = await _loadSegnalazioni();
  const aperte = lista.filter(s => !s.risolto);
  const risolte = lista.filter(s => s.risolto);
  const card = (s) => `<div style="border:1px solid var(--rule);border-radius:6px;padding:12px 14px;margin-bottom:10px;background:var(--bg-paper);${s.risolto ? 'opacity:.6;' : ''}">
      <div style="font-size:14px;color:var(--ink);white-space:pre-wrap;">${escapeHtml(s.testo)}</div>
      <div style="font-size:12px;color:var(--ink-muted);font-family:var(--mono);margin-top:6px;">${escapeHtml(s.utente || '?')} · ${escapeHtml((s.data || '').slice(0, 16).replace('T', ' '))}${s.contesto ? ' · ' + escapeHtml(s.contesto) : ''}</div>
      <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn ghost sm" onclick="toggleSegnalazioneRisolta('${escapeJs(s.id)}', this)">${s.risolto ? '↺ Riapri' : '✓ Segna risolta'}</button>
        <button class="btn ghost danger sm" onclick="eliminaSegnalazione('${escapeJs(s.id)}', this)">🗑 Elimina</button>
      </div>
    </div>`;
  const sectTitle = (t) => `<div style="font-family:var(--mono);font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-muted);margin:14px 0 8px;">${t}</div>`;
  mc.innerHTML = `
    <div class="page-head"><div class="page-eyebrow">Amministrazione</div><h1 class="page-title">Segnalazioni</h1></div>
    ${lista.length === 0 ? '<p style="color:var(--ink-muted);">Nessuna segnalazione ricevuta.</p>' : ''}
    ${aperte.length ? sectTitle(`Da gestire (${aperte.length})`) + aperte.map(card).join('') : ''}
    ${risolte.length ? sectTitle(`Risolte (${risolte.length})`) + risolte.map(card).join('') : ''}`;
}

async function toggleSegnalazioneRisolta(id, btn) {
  await runWithSpinner(btn, async () => {
    const { lista, sha } = await _loadSegnalazioni();
    const s = lista.find(x => x.id === id);
    if (!s) return;
    s.risolto = !s.risolto;
    await _saveSegnalazioni(lista, sha, `Aggiorna segnalazione ${id}`);
    renderSegnalazioni();
  });
}

async function eliminaSegnalazione(id, btn) {
  if (!confirm('Eliminare definitivamente questa segnalazione?')) return;
  await runWithSpinner(btn, async () => {
    const { lista, sha } = await _loadSegnalazioni();
    await _saveSegnalazioni(lista.filter(x => x.id !== id), sha, `Elimina segnalazione ${id}`);
    renderSegnalazioni();
  });
}

// API helper sopra showModal per pattern comuni. NON sostituisce showModal (che resta
// l'API base per modali con body custom), ma offre scorciatoie per i casi tipici:
// - Modals.confirm({title, message, confirmLabel, danger, onConfirm}): conferma sì/no
// - Modals.alert({title, message, label?}): notifica con un solo pulsante "OK"
// - Modals.cancelAction({onCancel?}): genera l'action "Annulla" standard (chiude modale)
const Modals = {
  // Action "Annulla" riusabile (variant ghost, chiude sempre la modale + callback opzionale)
  cancelAction(onCancel) {
    return {
      label: 'Annulla',
      variant: 'ghost',
      onClick: () => { if (onCancel) onCancel(); closeModal(); }
    };
  },

  // Conferma sì/no. onConfirm può essere async; il pulsante viene disabilitato durante l'esec.
  // Esempio: Modals.confirm({ title: 'Eliminare?', message: 'Operazione irreversibile.',
  //   confirmLabel: 'Elimina', danger: true, onConfirm: async () => { await api.delete(); } });
  confirm({ title, subtitle, message, confirmLabel, danger, onConfirm, onCancel }) {
    showModal({
      title,
      subtitle,
      body: message ? `<p style="margin:0;color:var(--ink-soft);font-size:14px;line-height:1.5;">${escapeHtml(message)}</p>` : '',
      actions: [
        Modals.cancelAction(onCancel),
        {
          label: confirmLabel || 'Conferma',
          variant: danger ? 'danger' : '',
          onClick: async (btn) => {
            btn.disabled = true;
            const oldLabel = btn.textContent;
            btn.textContent = '…';
            try {
              if (onConfirm) await onConfirm(btn);
              closeModal();
            } catch (e) {
              btn.disabled = false;
              btn.textContent = oldLabel;
              toast('Errore: ' + (e.message || e), 'error');
            }
          }
        }
      ]
    });
  },

  // Notifica semplice con un solo bottone "OK" (o label custom)
  alert({ title, subtitle, message, label }) {
    showModal({
      title,
      subtitle,
      body: message ? `<p style="margin:0;color:var(--ink-soft);font-size:14px;line-height:1.5;">${escapeHtml(message)}</p>` : '',
      actions: [{ label: label || 'OK', onClick: () => closeModal() }]
    });
  }
};
window.Modals = Modals;
