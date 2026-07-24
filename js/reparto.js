// ═══════════════════════════════════════════════════════════════════
//  SEZIONE REPARTO — consulto AI su paziente ricoverato
//  Carica cartella → anonimizza (regex di LetteraAI) → prompt modificabile
//  da incollare in un'AI esterna per criticità / DD / esami / attenzioni.
// ═══════════════════════════════════════════════════════════════════
state.reparto = state.reparto || {
  rawText: '',
  anonText: '',
  anonimizzato: false,
  xlsText: '',          // testo della tabella esami estratta dall'XLS
  // Cosa chiedere all'AI (preferenze): di default tutte attive
  chiedi: { criticita: true, ddx: true, esami: true, attenzioni: true },
  systemPrompt: null,   // istruzioni di sistema modificabili (null = usa default)
  systemPromptSha: null,// sha del file nel repo (per evitare conflitti al salvataggio)
  systemPromptLoaded: false, // true dopo il primo tentativo di caricamento dal repo
  topicsCustom: {},     // override delle istruzioni dei topic: { id: 'istruzione' } (vuoto = usa default)
  topicsSha: null,      // sha del file topics nel repo
  promptCustom: '',     // se l'utente edita il prompt finale, lo conserviamo
  richiestaLibera: '',  // richiesta libera aggiuntiva da iniettare nel prompt
  promptTab: 'full'     // vista attiva nei tab del prompt: full | system | user
};

// Percorso nel repo dati dove persistono le istruzioni personalizzate dei topic del Reparto.
const REPARTO_TOPICS_PATH = 'content/reparto/topics.json';

// Percorso nel repo dati CollinettaAI-data dove persiste il system prompt del Reparto.
// Stesso schema dei prompt di LetteraAI (file .md nel repo, condiviso tra tutti i login).
const REPARTO_SYSTEM_PATH = 'content/reparto/system_prompt.md';

// Istruzioni di sistema di default per il consulto Reparto (modificabili dall'utente)
const REPARTO_SYSTEM_DEFAULT = `Sei un medico esperto. Ti fornisco la cartella clinica ANONIMIZZATA di un paziente attualmente ricoverato. Analizzala con attenzione e aiutami nella gestione clinica.

Indicazioni generali:
- Basati esclusivamente sui dati presenti nella cartella; se un'informazione manca, segnalalo invece di inventarla.
- Sii concreto e clinicamente utile, con un linguaggio da collega a collega.
- Non riportare dati identificativi (la cartella è già anonimizzata).

Valori di laboratorio:
- Riporta TUTTI i valori presenti, senza ometterne nessuno.
- Scrivi prima la voce "Nella norma:" seguita dall'elenco dei valori risultati nella norma, e SOLO DOPO l'elenco dei valori alterati/patologici.
- Per ogni valore patologico durante il decorso, ricostruisci la serie temporale riportando anche i valori precedenti e successivi, in ordine cronologico, separati da freccette (es. "Na 128 → 131 → 135 mEq/L").
- Includi anche tutti i risultati di microbiologia, indicando ogni microrganismo cercato con il relativo esito (positivo/negativo/non rilevato), e tutta la sierologia, indicando ogni anticorpo cercato con il relativo esito. Riporta anche gli esami con esito negativo o non rilevato.

Terapia farmacologica:
- Presenta la terapia in una tabella a 4 colonne con intestazioni: Farmaco | Posologia | Orario | Note.

Formattazione del documento:
- Usa il font Times New Roman, dimensione 10,5.`;

// Le 4 aree di consulto. Ogni voce ha label (UI) e istruzione (testo nel prompt).
const REPARTO_TOPICS = [
  { id: 'criticita',  label: 'Criticità cliniche', istr: 'le principali criticità cliniche attive e i problemi da non sottovalutare' },
  { id: 'ddx',        label: 'Diagnosi differenziali', istr: 'le diagnosi differenziali da considerare, ordinate per probabilità, con il razionale' },
  { id: 'esami',      label: 'Esami da richiedere', istr: 'gli esami o accertamenti utili da richiedere e perché' },
  { id: 'attenzioni', label: 'Punti di attenzione', istr: 'gli aspetti a cui prestare particolare attenzione nella gestione del paziente' }
];

// Istruzione effettiva di un topic: override personalizzato (se presente e non vuoto) o default.
function repartoTopicIstr(t) {
  const custom = state.reparto.topicsCustom && state.reparto.topicsCustom[t.id];
  return (custom !== undefined && custom !== null && String(custom).trim()) ? String(custom).trim() : t.istr;
}

// Costruisce le parti del prompt (istruzioni + caso clinico) per le viste a tab.
// system = istruzioni di sistema + elenco delle richieste; user = cartella + esami.
function repartoPromptParts() {
  const r = state.reparto;
  const sys = (r.systemPrompt !== null ? r.systemPrompt : REPARTO_SYSTEM_DEFAULT).trim();
  const richieste = REPARTO_TOPICS.filter(t => r.chiedi[t.id]);
  const elenco = richieste.length
    ? richieste.map((t, i) => { const istr = repartoTopicIstr(t); return `${i + 1}. ${istr.charAt(0).toUpperCase() + istr.slice(1)}`; }).join('\n')
    : '1. Un inquadramento clinico generale del caso';
  const cartella = (r.anonText || '').trim() || '[INCOLLA QUI LA CARTELLA ANONIMIZZATA]';
  const esamiBlock = (r.xlsText || '').trim()
    ? `\n\n### Tabella esami di laboratorio\n\n${r.xlsText.trim()}`
    : '';
  const libera = (r.richiestaLibera || '').trim()
    ? `\n\nRichiesta aggiuntiva:\n${(r.richiestaLibera || '').trim()}`
    : '';
  const system = `${sys}\n\nSulla base dei soli dati forniti, indica:\n${elenco}${libera}`;
  const user = `### Cartella clinica anonimizzata\n\n${cartella}${esamiBlock}`;
  return { system, user };
}

// Costruisce il prompt finale in base a system prompt, preferenze, cartella ed esami.
function buildRepartoPrompt() {
  const p = repartoPromptParts();
  return `${p.system}\n\n${p.user}`;
}

// Testo mostrato nei tab Completo / Istruzioni / Caso clinico (replica LetteraAI).
function repartoPromptViewText(tab) {
  const r = state.reparto;
  if (tab === 'system') return repartoPromptParts().system;
  if (tab === 'user') return repartoPromptParts().user;
  // Vista completa: se l'utente ha editato il prompt, mostra il suo testo
  return r.promptCustom || buildRepartoPrompt();
}

function renderReparto() {
  const r = state.reparto;
  // Al primo accesso, carico il system prompt e i topic salvati nel repo (se esistono).
  if (!r.systemPromptLoaded) {
    r.systemPromptLoaded = true;
    Promise.all([loadRepartoSystemPrompt(), loadRepartoTopics()]).then(() => {
      if (state.currentView === 'reparto') renderReparto();
    }).catch(() => {});
  }
  const topicChecks = REPARTO_TOPICS.map(t =>
    `<label style="display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer;padding:4px 0;text-transform:none;letter-spacing:normal;font-family:inherit;font-weight:400;color:var(--ink);">
      <input type="checkbox" ${r.chiedi[t.id] ? 'checked' : ''} onchange="window.setRepartoTopic('${t.id}', this.checked)">
      <span>${escapeHtml(t.label)}</span>
    </label>`).join('');
  const sysVal = r.systemPrompt !== null ? r.systemPrompt : REPARTO_SYSTEM_DEFAULT;
  const ptab = r.promptTab || 'full';
  const ptabBtn = (k, l) => `<button class="rep-tab${ptab === k ? ' on' : ''}" onclick="window.setRepartoPromptTab('${k}')">${l}</button>`;
  $('main-content').innerHTML = `
    <div class="page-head">
      <h1 class="page-title">Reparto</h1>
    </div>

    <div class="rep-card">
      <div class="rep-dz-title">Carica PDF cartella clinica completa</div>
      <div class="rep-dz" id="reparto-drop" onclick="document.getElementById('reparto-pdf').click()"
        ondragover="event.preventDefault();this.classList.add('drag')"
        ondragleave="this.classList.remove('drag')"
        ondrop="event.preventDefault();this.classList.remove('drag');window.onRepartoPdf(event.dataTransfer.files)">
        <input type="file" id="reparto-pdf" accept="application/pdf" multiple style="display:none" onchange="window.onRepartoPdf(this.files)">
        <div class="rep-dz-ic">📁</div>
        <div class="rep-dz-txt"><strong>Clicca o trascina uno o più PDF</strong></div>
      </div>
      <div id="reparto-pdf-status" class="rep-dz-status" style="${r.anonimizzato ? '' : 'display:none;'}"></div>
    </div>

    <div class="rep-card">
      <div class="rep-dz-title">Carica tabella esami di laboratorio — opzionale</div>
      <div class="rep-dz" id="reparto-xls-drop" onclick="document.getElementById('reparto-xls').click()"
        ondragover="event.preventDefault();this.classList.add('drag')"
        ondragleave="this.classList.remove('drag')"
        ondrop="event.preventDefault();this.classList.remove('drag');window.onRepartoXls(event.dataTransfer.files[0])">
        <input type="file" id="reparto-xls" accept=".xls,.xlsx,.csv" style="display:none" onchange="window.onRepartoXls(this.files[0])">
        <div class="rep-dz-ic">🧪</div>
        <div class="rep-dz-txt"><strong>Clicca o trascina XLS</strong></div>
      </div>
      <div id="reparto-xls-status" class="rep-dz-status" style="display:none;"></div>
      ${r.xlsText ? `
        <div style="margin-top:10px;">
          <label style="font-size:12px;color:var(--ink-muted);">Valori estratti (rivedibili)</label>
          <textarea id="reparto-xls-text" rows="6" class="mono-input" style="width:100%;font-size:12px;" oninput="window.setRepartoXls(this.value)">${escapeHtml(r.xlsText)}</textarea>
          <button class="btn" style="margin-top:6px;font-size:12px;" onclick="window.clearRepartoXls()">✕ Rimuovi esami</button>
        </div>` : ''}
    </div>

    <div class="rep-card">
      <div class="rep-dz-title">Testo cartella clinica completa</div>
      <textarea id="reparto-raw" rows="8" class="mono-input" style="width:100%;font-size:12px;" placeholder="Incolla qui il testo copiato dal PDF della cartella clinica" oninput="window.setRepartoRaw(this.value)" onchange="window.anonimizzaReparto()">${escapeHtml(r.rawText)}</textarea>
      ${r.anonimizzato ? `
        <div style="margin-top:12px;">
          <label style="font-size:12px;color:var(--ink-muted);">Cartella anonimizzata</label>
          <textarea id="reparto-anon" rows="8" class="mono-input" style="width:100%;font-size:12px;" oninput="window.setRepartoAnon(this.value)">${escapeHtml(r.anonText)}</textarea>
        </div>` : '<div style="font-size:12px;color:var(--ink-muted);margin-top:10px;">La cartella viene anonimizzata automaticamente: nomi, date e dati identificativi vengono rimossi.</div>'}
    </div>

    <div class="rep-card">
      <div class="rep-dz-title">Cosa vuoi chiedere all'AI</div>
      <div style="margin-top:8px;">${topicChecks}</div>
      <div style="margin-top:12px;">
        <label style="font-size:12px;color:var(--ink-muted);font-weight:600;">Richiesta libera (opzionale)</label>
        <textarea id="reparto-richiesta-libera" rows="3" class="mono-input" style="width:100%;font-size:12px;" placeholder="Aggiungi qui una richiesta specifica da includere nel prompt..." oninput="window.setRepartoRichiestaLibera(this.value)">${escapeHtml(r.richiestaLibera || '')}</textarea>
      </div>
      <details style="margin-top:12px;">
        <summary style="cursor:pointer;font-size:13px;color:var(--accent);">⚙ Istruzioni di sistema e dei punti (modificabili)</summary>
        <div style="margin-top:10px;">
          <label style="font-size:12px;color:var(--ink-muted);font-weight:600;">Istruzioni di sistema</label>
          <textarea id="reparto-sys" rows="8" class="mono-input" style="width:100%;font-size:12px;" oninput="window.setRepartoSys(this.value)">${escapeHtml(sysVal)}</textarea>
          <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap;">
            ${isAdmin() ? `<button class="btn primary" style="font-size:12px;background:var(--ink);color:var(--bg-paper);border-color:var(--ink);" onclick="runWithSpinner(this, window.saveRepartoSys)">💾 Salva</button>` : ''}
            <button class="btn" style="font-size:12px;" onclick="window.resetRepartoSys()">⟲ Ripristina istruzioni di default</button>
          </div>

          <div style="border-top:1px solid var(--rule-soft);margin-top:14px;padding-top:12px;">
            <label style="font-size:12px;color:var(--ink-muted);font-weight:600;">Istruzioni dei punti (criticità, diagnosi differenziali, ecc.)</label>
            <div style="font-size:11px;color:var(--ink-muted);margin:4px 0 8px;">Testo inserito nel prompt per ciascun punto quando è selezionato.</div>
            ${REPARTO_TOPICS.map(t => `
              <div style="margin-bottom:8px;">
                <label style="font-size:11px;color:var(--ink-muted);">${escapeHtml(t.label)}</label>
                <textarea id="reparto-topic-${t.id}" rows="2" class="mono-input" style="width:100%;font-size:12px;" oninput="window.setRepartoTopicIstr('${t.id}', this.value)">${escapeHtml(repartoTopicIstr(t))}</textarea>
              </div>`).join('')}
            <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap;">
              ${isAdmin() ? `<button class="btn primary" style="font-size:12px;background:var(--ink);color:var(--bg-paper);border-color:var(--ink);" onclick="runWithSpinner(this, window.saveRepartoTopics)">💾 Salva punti</button>` : ''}
              <button class="btn" style="font-size:12px;" onclick="window.resetRepartoTopics()">⟲ Ripristina punti di default</button>
            </div>
          </div>

          <div style="font-size:11px;color:var(--ink-muted);margin-top:10px;">${isAdmin() ? '' : 'Solo gli amministratori possono salvare istruzioni condivise. Le tue modifiche valgono solo per questa sessione.'}</div>
        </div>
      </details>
    </div>

    <div class="rep-card">
      <div class="rep-dz-title">Prompt completo</div>
      <div class="rep-tabs" style="margin-bottom:10px;">${ptabBtn('full', 'Completo')}${ptabBtn('system', 'Istruzioni')}${ptabBtn('user', 'Caso clinico')}</div>
      <textarea id="reparto-prompt" rows="14" class="mono-input" style="width:100%;font-size:12px;" ${ptab === 'full' ? `oninput="window.setRepartoPromptCustom(this.value)"` : 'readonly'}>${escapeHtml(repartoPromptViewText(ptab))}</textarea>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
        <button class="btn primary" onclick="window.copyRepartoPrompt()" style="background:var(--ink);color:var(--bg-paper);border-color:var(--ink);">⎘ Copia prompt</button>
        <button class="btn" onclick="window.copyRepartoCartella()">⎘ Copia cartella anonimizzata</button>
        <button class="btn ghost sm" onclick="window.rebuildRepartoPrompt()">↻ Ricostruisci</button>
        <button class="btn ghost" onclick="window.resetRepartoCartella()">✕ Reset</button>
      </div>
    </div>`;
}

// ── Handler della sezione Reparto (esposti su window per gli onclick) ──
window.setRepartoRaw = function (v) { state.reparto.rawText = v; };
window.setRepartoAnon = function (v) { state.reparto.anonText = v; };
window.setRepartoXls = function (v) { state.reparto.xlsText = v; };
window.setRepartoPromptCustom = function (v) { state.reparto.promptCustom = v; };
// Richiesta libera aggiuntiva: aggiorna il prompt se l'utente non l'ha editato a mano.
window.setRepartoRichiestaLibera = function (v) {
  state.reparto.richiestaLibera = v;
  if (!state.reparto.promptCustom && (state.reparto.promptTab || 'full') === 'full') {
    const ta = document.getElementById('reparto-prompt');
    if (ta) ta.value = buildRepartoPrompt();
  }
};
// Cambia la vista del prompt (Completo / Istruzioni / Caso clinico) e ri-renderizza.
window.setRepartoPromptTab = function (tab) {
  state.reparto.promptTab = tab;
  renderReparto();
};
window.setRepartoSys = function (v) {
  state.reparto.systemPrompt = v;
  if (!state.reparto.promptCustom) {
    const ta = document.getElementById('reparto-prompt');
    if (ta) ta.value = buildRepartoPrompt();
  }
};
window.resetRepartoSys = function () {
  state.reparto.systemPrompt = null;
  renderReparto();
  toast('Istruzioni di sistema ripristinate', 'info');
};

// Carica il system prompt del Reparto da CollinettaAI-data (se presente).
async function loadRepartoSystemPrompt() {
  try {
    const f = await gh.getFile(REPARTO_SYSTEM_PATH);
    if (f && f.content && f.content.trim()) {
      state.reparto.systemPrompt = f.content;
      state.reparto.systemPromptSha = f.sha;
      state.reparto.promptCustom = '';
    }
  } catch (e) { /* file assente: si usa il default */ }
}

// Salva il system prompt del Reparto in CollinettaAI-data, persistente tra i login.
window.saveRepartoSys = async function () {
  if (!isAdmin()) {
    return toast('Solo gli amministratori possono modificare le istruzioni di sistema', 'error');
  }
  const ta = document.getElementById('reparto-sys');
  const text = ta ? ta.value : (state.reparto.systemPrompt !== null ? state.reparto.systemPrompt : REPARTO_SYSTEM_DEFAULT);
  state.reparto.systemPrompt = text;
  try {
    const res = await gh.putFile(REPARTO_SYSTEM_PATH, text, state.reparto.systemPromptSha || null,
      `Aggiorna system prompt Reparto (by ${state.session.username})`);
    if (res && res.content) state.reparto.systemPromptSha = res.content.sha;
    toast('Istruzioni di sistema salvate nel repo', 'success');
  } catch (e) {
    if (e && e.code === 'CONFLICT') {
      toast('Conflitto: ricarico la versione aggiornata', 'warning');
      await loadRepartoSystemPrompt();
      renderReparto();
    } else {
      toast('Errore salvataggio: ' + e.message, 'error');
    }
  }
};
// ── Istruzioni dei punti (topic) — modificabili e salvabili come il system prompt ──
window.setRepartoTopicIstr = function (id, v) {
  if (!state.reparto.topicsCustom) state.reparto.topicsCustom = {};
  state.reparto.topicsCustom[id] = v;
  if (!state.reparto.promptCustom) {
    const ta = document.getElementById('reparto-prompt');
    if (ta) ta.value = buildRepartoPrompt();
  }
};
window.resetRepartoTopics = function () {
  state.reparto.topicsCustom = {};
  renderReparto();
  toast('Istruzioni dei punti ripristinate', 'info');
};

// Carica le istruzioni personalizzate dei topic da CollinettaAI-data (se presenti).
async function loadRepartoTopics() {
  try {
    const f = await gh.getFile(REPARTO_TOPICS_PATH);
    if (f && f.content && f.content.trim()) {
      const parsed = JSON.parse(f.content);
      if (parsed && typeof parsed === 'object') {
        // Tengo solo gli id validi, ignorando chiavi sconosciute
        const valid = {};
        REPARTO_TOPICS.forEach(t => { if (typeof parsed[t.id] === 'string') valid[t.id] = parsed[t.id]; });
        state.reparto.topicsCustom = valid;
      }
      state.reparto.topicsSha = f.sha;
    }
  } catch (e) { /* file assente o JSON non valido: si usano i default */ }
}

// Salva le istruzioni personalizzate dei topic in CollinettaAI-data (solo admin).
window.saveRepartoTopics = async function () {
  if (!isAdmin()) {
    return toast('Solo gli amministratori possono modificare le istruzioni dei punti', 'error');
  }
  // Raccolgo i valori correnti dai textarea (fallback allo stato)
  const out = {};
  REPARTO_TOPICS.forEach(t => {
    const ta = document.getElementById('reparto-topic-' + t.id);
    const v = ta ? ta.value : (state.reparto.topicsCustom || {})[t.id];
    if (v !== undefined && v !== null) out[t.id] = String(v);
  });
  state.reparto.topicsCustom = out;
  try {
    const res = await gh.putFile(REPARTO_TOPICS_PATH, JSON.stringify(out, null, 2), state.reparto.topicsSha || null,
      `Aggiorna istruzioni punti Reparto (by ${state.session.username})`);
    if (res && res.content) state.reparto.topicsSha = res.content.sha;
    toast('Istruzioni dei punti salvate nel repo', 'success');
  } catch (e) {
    if (e && e.code === 'CONFLICT') {
      toast('Conflitto: ricarico la versione aggiornata', 'warning');
      await loadRepartoTopics();
      renderReparto();
    } else {
      toast('Errore salvataggio: ' + e.message, 'error');
    }
  }
};

window.clearRepartoXls = function () {
  state.reparto.xlsText = '';
  state.reparto.promptCustom = '';
  renderReparto();
};
window.onRepartoXls = async function (file) {
  if (!file) return;
  const status = document.getElementById('reparto-xls-status');
  if (status) { status.style.display = ''; status.textContent = 'Lettura esami…'; }
  try {
    const L = await ensureLetterAI();
    if (!L || typeof L.extractXlsRows !== 'function') throw new Error('Modulo esami non disponibile');
    const rows = await L.extractXlsRows(file);
    const out = L.xlsToRawText(rows, '');
    state.reparto.xlsText = (out && out.text) ? out.text : '';
    state.reparto.promptCustom = '';
    renderReparto();
    toast('Tabella esami caricata', 'success');
  } catch (e) {
    if (status) status.textContent = 'Errore esami: ' + e.message;
  }
};
window.setRepartoTopic = function (id, checked) {
  state.reparto.chiedi[id] = checked;
  // Se l'utente non ha editato manualmente il prompt, lo rigenero per riflettere la scelta
  if (!state.reparto.promptCustom) {
    const ta = document.getElementById('reparto-prompt');
    if (ta) ta.value = buildRepartoPrompt();
  }
};
window.rebuildRepartoPrompt = function () {
  state.reparto.promptCustom = '';
  state.reparto.promptTab = 'full';
  renderReparto();
  toast('Prompt rigenerato dal modello', 'info');
};
window.copyRepartoPrompt = async function () {
  // Copia sempre il prompt completo, a prescindere dalla vista (tab) attiva.
  const txt = state.reparto.promptCustom || buildRepartoPrompt();
  try { await navigator.clipboard.writeText(txt); toast('Prompt copiato', 'success'); }
  catch (e) { toast('Copia non riuscita', 'error'); }
};
// Copia la sola cartella anonimizzata (con eventuali esami in coda), senza il prompt.
window.copyRepartoCartella = async function () {
  const r = state.reparto;
  const cartella = (r.anonText || '').trim();
  if (!cartella) return toast('Carica prima una cartella', 'warning');
  const esami = (r.xlsText || '').trim() ? `\n\n### Tabella esami di laboratorio\n\n${r.xlsText.trim()}` : '';
  try { await navigator.clipboard.writeText(cartella + esami); toast('Cartella anonimizzata copiata', 'success'); }
  catch (e) { toast('Copia non riuscita', 'error'); }
};
// Reset: svuota cartella ed esami e li rimuove dal prompt, per caricarne un'altra.
window.resetRepartoCartella = function () {
  const r = state.reparto;
  r.rawText = '';
  r.anonText = '';
  r.anonimizzato = false;
  r.xlsText = '';
  r.promptCustom = '';
  renderReparto();
  toast('Cartella ed esami azzerati', 'info');
};
window.onRepartoPdf = async function (files) {
  // Accetta un singolo File (retrocompat) o un FileList con più PDF.
  const list = files ? (files.length !== undefined ? Array.from(files) : [files]) : [];
  if (!list.length) return;
  const status = document.getElementById('reparto-pdf-status');
  if (status) { status.style.display = ''; status.textContent = list.length > 1 ? `Lettura ${list.length} PDF…` : 'Lettura PDF…'; }
  try {
    const L = await ensureLetterAI();
    if (!L || typeof L.extractPdfText !== 'function') throw new Error('Modulo di estrazione non disponibile');
    let raw = '';
    for (let i = 0; i < list.length; i++) {
      if (status && list.length > 1) status.textContent = `Lettura PDF ${i + 1}/${list.length}…`;
      const t = await L.extractPdfText(list[i]);
      raw = raw ? raw + '\n\n' + t : t;
    }
    state.reparto.rawText = raw;
    const ta = document.getElementById('reparto-raw');
    if (ta) ta.value = raw;
    if (status) status.textContent = '✓ PDF letto, anonimizzazione in corso…';
    await window.anonimizzaReparto();
    // Dopo l'anonimizzazione la UI è stata ri-renderizzata e la cartella
    // anonimizzata è già visibile: non aggiorno più lo status (elemento staccato).
  } catch (e) {
    if (status) status.textContent = 'Errore PDF: ' + e.message;
  }
};
window.anonimizzaReparto = async function () {
  const raw = (state.reparto.rawText || '').trim();
  if (!raw) {
    // Niente testo: azzero lo stato anonimizzato senza warning (può scattare da onchange)
    if (state.reparto.anonimizzato) { state.reparto.anonimizzato = false; state.reparto.anonText = ''; }
    return;
  }
  try {
    const L = await ensureLetterAI();
    if (!L || typeof L.anonymizeText !== 'function') throw new Error('Motore di anonimizzazione non disponibile');
    const res = L.anonymizeText(raw);
    state.reparto.anonText = res.text || '';
    state.reparto.anonimizzato = true;
    state.reparto.promptCustom = ''; // rigenero il prompt con la cartella anonimizzata
    renderReparto();
  } catch (e) {
    toast('Errore anonimizzazione: ' + e.message, 'error');
  }
};
