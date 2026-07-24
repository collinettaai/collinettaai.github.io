/* ============================ VIEW — CALENDARIO ============================ */
const CAL_CATEGORIES = {
  guardie:         { label: 'Guardie',            color: '#f07070' },
  coguardie:       { label: 'Coguardie',          color: '#e8739e' },
  amb_divisionale: { label: 'Amb. divisionale',   color: '#ffa94d' },
  lezioni:         { label: 'Lezioni',            color: '#4a9b8e' },
  seminari:        { label: 'Seminari',           color: '#6ba4f5' },
  congressi:       { label: 'Congressi',          color: '#b388ff' },
  compleanni:      { label: 'Compleanni',         color: '#f5a35f' },
  altro:           { label: 'Altro',              color: '#8fc857' }
};
// Sotto-filtri per categoria "lezioni": anno del corso (1°/2°/3°/4°)
const CAL_LEZIONE_ANNI = [
  { id: '1', label: '1° anno' },
  { id: '2', label: '2° anno' },
  { id: '3', label: '3° anno' },
  { id: '4', label: '4° anno' }
];
const CAL_DOW = ['Lun','Mar','Mer','Gio','Ven','Sab','Dom'];
const CAL_MONTHS = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];

// Festività italiane per un dato anno (con Pasqua computata)
function calFestiviItaliani(year) {
  // Pasqua: algoritmo di Meeus/Jones/Butcher (Gregoriano)
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19*a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const L = (32 + 2*e + 2*i - h - k) % 7;
  const m = Math.floor((a + 11*h + 22*L) / 451);
  const month = Math.floor((h + L - 7*m + 114) / 31);
  const day = ((h + L - 7*m + 114) % 31) + 1;
  const pasqua = new Date(year, month - 1, day);
  const pasquetta = new Date(pasqua); pasquetta.setDate(pasqua.getDate() + 1);
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return new Set([
    `${year}-01-01`, // Capodanno
    `${year}-01-06`, // Epifania
    fmt(pasqua), fmt(pasquetta),
    `${year}-04-25`, // Liberazione
    `${year}-05-01`, // Festa lavoro
    `${year}-06-02`, // Repubblica
    `${year}-08-15`, // Ferragosto
    `${year}-11-01`, // Ognissanti
    `${year}-12-08`, // Immacolata
    `${year}-12-25`, `${year}-12-26`  // Natale + S. Stefano
  ]);
}

function calFormatDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function renderCalendario(params) {
  if (!state.calendarState) {
    const today = new Date();
    state.calendarState = {
      year: today.getFullYear(),
      month: today.getMonth(),
      selectedDate: calFormatDate(today),
      lezioniDropdownOpen: false
    };
  }
  const cal = state.calendarState;
  if (params && params.y) cal.year = +params.y;
  if (params && params.m !== undefined) cal.month = +params.m;

  // Render scheletro completo (chiamato solo all'apertura della view).
  // I successivi aggiornamenti (cambio mese, click giorno, toggle filtro) usano i refresh
  // granulari `_calRefresh*` che riscrivono solo la sezione interessata → evita il flicker
  // del full re-render e riduce la latenza percepita su mobile da ~100ms a ~20ms.
  $('main-content').innerHTML = `
    <div class="page-head">
      <h1 class="page-title">Calendario</h1>
    </div>

    <div class="cal-wrap">
      <div>
        <div class="cal-head" id="cal-controls"></div>
        <div class="cal-grid" id="cal-grid"></div>
        <div class="cal-legend" id="cal-legend"></div>
      </div>
      <div class="cal-events" id="cal-events"></div>
    </div>
  `;
  _calRefreshControls();
  _calRefreshGrid();
  _calRefreshLegend();
  _calRefreshEvents();
}

// Calcola lo stato derivato condiviso da grid/events (filtri categoria, eventi byDate).
// Funzione pure: nessun side effect, output deterministico dato lo state.
function _calComputeFiltered() {
  const prefs = (state.userPrefs && state.userPrefs.calendar_filters) || {};
  const hiddenCategories = new Set(Array.isArray(prefs.hidden_categories) ? prefs.hidden_categories : []);
  const lezioniAnniAttivi = Array.isArray(prefs.lezioni_anni) && prefs.lezioni_anni.length > 0
    ? new Set(prefs.lezioni_anni.map(String))
    : null;
  const eventi = (state.index.calendar && state.index.calendar.eventi) || [];
  const isActive = (e) => {
    const cat = e.categoria || 'altro';
    if (hiddenCategories.has(cat)) return false;
    if (cat === 'lezioni' && lezioniAnniAttivi) {
      const anno = String(e.anno || '');
      if (!anno || !lezioniAnniAttivi.has(anno)) return false;
    }
    return true;
  };
  const byDate = new Map();
  eventi.forEach(e => {
    if (!e.data) return;
    if (!isActive(e)) return;
    if (!byDate.has(e.data)) byDate.set(e.data, []);
    byDate.get(e.data).push(e);
  });
  return { byDate, hiddenCategories, lezioniAnniAttivi };
}

// Riscrive solo la riga controlli mese (frecce navigazione, titolo mese, Oggi, Importa)
function _calRefreshControls() {
  const cal = state.calendarState;
  const el = document.getElementById('cal-controls');
  if (!cal || !el) return;
  const monthLabel = `${CAL_MONTHS[cal.month]} ${cal.year}`;
  el.innerHTML = `
    <button class="cal-nav-btn" onclick="calPrevMonth()" title="Mese precedente" aria-label="Precedente">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
    </button>
    <button class="cal-nav-btn" onclick="calNextMonth()" title="Mese successivo" aria-label="Successivo">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
    <div class="cal-title">${monthLabel}</div>
    <button class="cal-nav-btn" onclick="calToday()" title="Oggi" aria-label="Oggi" style="width:auto;padding:0 10px;font-size:12px;font-family:var(--mono);">Oggi</button>
    <button class="cal-nav-btn" onclick="openCalImportModal()" title="Importa guardie/coguardie da testo" aria-label="Importa" style="width:auto;padding:0 10px;font-size:12px;font-family:var(--mono);">Importa</button>
  `;
}

// Riscrive solo la griglia 6×7 dei giorni del mese
function _calRefreshGrid() {
  const cal = state.calendarState;
  const el = document.getElementById('cal-grid');
  if (!cal || !el) return;
  const { byDate } = _calComputeFiltered();
  const festivi = calFestiviItaliani(cal.year);
  const todayStr = calFormatDate(new Date());

  // Costruisco la griglia del mese (6 settimane × 7 giorni, Lun-Dom)
  const firstOfMonth = new Date(cal.year, cal.month, 1);
  const dowFirst = (firstOfMonth.getDay() + 6) % 7; // 0 = Lun
  const gridStart = new Date(cal.year, cal.month, 1 - dowFirst);
  const days = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    const key = calFormatDate(d);
    const inMonth = d.getMonth() === cal.month;
    days.push({
      key, num: d.getDate(),
      dow: (d.getDay() + 6) % 7,
      inMonth,
      isToday: key === todayStr,
      isSelected: key === cal.selectedDate,
      isFestivo: festivi.has(key) || d.getDay() === 0,
      events: byDate.get(key) || []
    });
    if (i >= 34 && !inMonth) break;
  }
  while (days.length % 7 !== 0) days.pop();

  el.innerHTML = `
    ${CAL_DOW.map(d => `<div class="cal-dow">${d}</div>`).join('')}
    ${days.map(d => {
      const classes = ['cal-day'];
      if (!d.inMonth) classes.push('other-month');
      if (d.isFestivo) classes.push('festivo');
      if (d.isToday) classes.push('today');
      if (d.isSelected) classes.push('selected');
      const cats = [...new Set(d.events.map(e => e.categoria || 'altro'))].slice(0,5);
      // Colore inline da CAL_CATEGORIES (sorgente di verità) con fallback alla classe CSS:
      // così aggiungere una categoria non richiede di ricordarsi una regola .cal-dot dedicata.
      const dots = cats.map(c => {
        const col = CAL_CATEGORIES[c]?.color;
        return `<span class="cal-dot ${c}"${col ? ` style="background:${col}"` : ''}></span>`;
      }).join('');
      return `<div class="${classes.join(' ')}" onclick="calSelectDay('${d.key}')">
        <span class="cal-day-num">${d.num}</span>
        <div class="cal-dots">${dots}</div>
      </div>`;
    }).join('')}
  `;
}

// Riscrive solo la legenda (filtri categoria + dropdown anni lezioni)
function _calRefreshLegend() {
  const cal = state.calendarState;
  const el = document.getElementById('cal-legend');
  if (!cal || !el) return;
  const { hiddenCategories, lezioniAnniAttivi } = _calComputeFiltered();
  el.innerHTML = Object.entries(CAL_CATEGORIES).map(([k, v]) => {
    const active = !hiddenCategories.has(k);
    if (k === 'lezioni') {
      const allAnniActive = !lezioniAnniAttivi || lezioniAnniAttivi.size === CAL_LEZIONE_ANNI.length;
      const dropdownHtml = cal.lezioniDropdownOpen ? `
        <div class="cal-legend-dropdown" onclick="event.stopPropagation();">
          <label>
            <input type="checkbox" ${allAnniActive ? 'checked' : ''} onchange="toggleLezioniAnnoAll(this.checked)">
            <span style="font-weight:500;">Tutti gli anni</span>
          </label>
          <div style="height:1px;background:var(--rule-soft);margin:2px 0;"></div>
          ${CAL_LEZIONE_ANNI.map(a => {
            const checked = !lezioniAnniAttivi || lezioniAnniAttivi.has(a.id);
            return `<label>
              <input type="checkbox" ${checked ? 'checked' : ''} onchange="toggleLezioniAnno('${a.id}', this.checked)">
              ${escapeHtml(a.label)}
            </label>`;
          }).join('')}
        </div>` : '';
      return `<span class="cal-legend-item ${active ? '' : 'inactive'}" onclick="event.stopPropagation();toggleLezioniDropdown(event)">
        <span class="cal-legend-dot" style="background:${v.color}"></span>${v.label}
        <span class="cal-legend-caret">▾</span>
        ${dropdownHtml}
      </span>`;
    }
    return `<span class="cal-legend-item ${active ? '' : 'inactive'}" onclick="toggleCalCategory('${k}')">
      <span class="cal-legend-dot" style="background:${v.color}"></span>${v.label}
    </span>`;
  }).join('');
}

// Riscrive solo il pannello eventi del giorno selezionato (a destra)
function _calRefreshEvents() {
  const cal = state.calendarState;
  const el = document.getElementById('cal-events');
  if (!cal || !el) return;
  const { byDate } = _calComputeFiltered();
  const selectedEvents = (byDate.get(cal.selectedDate) || []).sort((a,b) => (a.ora || '').localeCompare(b.ora || ''));
  const parts = cal.selectedDate.split('-');
  const selectedDateObj = new Date(+parts[0], +parts[1] - 1, +parts[2]);
  const selectedLabel = selectedDateObj.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  el.innerHTML = `
    <div class="cal-events-head">
      <span>${escapeHtml(selectedLabel)}</span>
      <button class="cal-events-add" onclick="openCalEventModal('${cal.selectedDate}')" title="Aggiungi evento">+ Aggiungi</button>
    </div>
    ${selectedEvents.length === 0
      ? `<div class="cal-empty">Nessun evento in questa data.</div>`
      : selectedEvents.map(e => {
          const cat = e.categoria || 'altro';
          const catLabel = CAL_CATEGORIES[cat]?.label || cat;
          const timeStr = e.ora
            ? (e.ora_fine ? `${e.ora}–${e.ora_fine}` : e.ora)
            : '';
          const timeHtml = timeStr
            ? `<div class="cal-event-time-side">${escapeHtml(timeStr)}</div>`
            : '';
          const recurIcon = e.ricorrenza
            ? `<span class="cal-event-recur-icon" title="Evento ricorrente">↻</span>`
            : '';
          const annoLabel = (cat === 'lezioni' && e.anno)
            ? ` · ${escapeHtml(e.anno)}° anno` : '';
          const catColor = CAL_CATEGORIES[cat]?.color;
          return `<div class="cal-event ${cat}"${catColor ? ` style="border-left-color:${catColor}"` : ''}>
            <div class="cal-event-body">
              <div class="cal-event-titolo">${escapeHtml(e.titolo || '(senza titolo)')}${recurIcon}</div>
              <div class="cal-event-cat">${escapeHtml(catLabel)}${annoLabel}</div>
              ${e.descrizione ? `<div class="cal-event-desc">${escapeHtml(e.descrizione)}</div>` : ''}
            </div>
            ${timeHtml}
            <div class="cal-event-actions">
              <button onclick="openCalEventModal('${cal.selectedDate}','${escapeJs(e.id)}')" title="Modifica">✎</button>
            </div>
          </div>`;
        }).join('')
    }
  `;
}

function calPrevMonth() {
  const c = state.calendarState;
  c.month--;
  if (c.month < 0) { c.month = 11; c.year--; }
  // Cambio mese: aggiorno controlli (titolo) + griglia (giorni). Eventi/legenda NO.
  _calRefreshControls();
  _calRefreshGrid();
}
function calNextMonth() {
  const c = state.calendarState;
  c.month++;
  if (c.month > 11) { c.month = 0; c.year++; }
  _calRefreshControls();
  _calRefreshGrid();
}
function calToday() {
  const t = new Date();
  state.calendarState.year = t.getFullYear();
  state.calendarState.month = t.getMonth();
  state.calendarState.selectedDate = calFormatDate(t);
  // Click "Oggi" può cambiare giorno selezionato + mese: aggiorno tutto tranne legenda.
  _calRefreshControls();
  _calRefreshGrid();
  _calRefreshEvents();
}
function calSelectDay(dateStr) {
  const c = state.calendarState;
  const oldMonth = c.month, oldYear = c.year;
  c.selectedDate = dateStr;
  // Se è in un altro mese, naviga a quel mese
  const parts = dateStr.split('-');
  c.year = +parts[0];
  c.month = +parts[1] - 1;
  // Se mese cambia → refresh grid+controls; sempre refresh events (dipende da selectedDate).
  // Sempre refresh grid anche se stesso mese (per highlight giorno selezionato).
  if (c.year !== oldYear || c.month !== oldMonth) _calRefreshControls();
  _calRefreshGrid();
  _calRefreshEvents();
}
function _ensureCalFilters() {
  if (!state.userPrefs) return null;
  if (!state.userPrefs.calendar_filters) state.userPrefs.calendar_filters = {};
  return state.userPrefs.calendar_filters;
}
function toggleCalCategory(cat) {
  const f = _ensureCalFilters();
  if (!f) return;
  if (!Array.isArray(f.hidden_categories)) f.hidden_categories = [];
  const idx = f.hidden_categories.indexOf(cat);
  if (idx >= 0) f.hidden_categories.splice(idx, 1);
  else f.hidden_categories.push(cat);
  if (typeof userPrefs !== 'undefined' && userPrefs.scheduleSave) userPrefs.scheduleSave();
  // Toggle filtro: aggiorna grid (dots), legend (stato attivo/inattivo), events.
  _calRefreshGrid();
  _calRefreshLegend();
  _calRefreshEvents();
}
function toggleLezioniDropdown(evt) {
  if (evt) evt.stopPropagation();
  const c = state.calendarState;
  c.lezioniDropdownOpen = !c.lezioniDropdownOpen;
  // Solo la legenda ha bisogno di redraw (apre/chiude dropdown).
  _calRefreshLegend();
}
function toggleLezioniAnno(annoId, checked) {
  const f = _ensureCalFilters();
  if (!f) return;
  let current = Array.isArray(f.lezioni_anni) && f.lezioni_anni.length > 0
    ? f.lezioni_anni.map(String)
    : CAL_LEZIONE_ANNI.map(a => a.id);
  if (checked) {
    if (!current.includes(annoId)) current.push(annoId);
  } else {
    current = current.filter(x => x !== annoId);
  }
  if (current.length === CAL_LEZIONE_ANNI.length) f.lezioni_anni = [];
  else f.lezioni_anni = current;
  if (typeof userPrefs !== 'undefined' && userPrefs.scheduleSave) userPrefs.scheduleSave();
  _calRefreshGrid();
  _calRefreshLegend();
  _calRefreshEvents();
}
function toggleLezioniAnnoAll(checked) {
  const f = _ensureCalFilters();
  if (!f) return;
  if (checked) {
    f.lezioni_anni = [];
  } else {
    f.lezioni_anni = ['__none__'];
  }
  if (typeof userPrefs !== 'undefined' && userPrefs.scheduleSave) userPrefs.scheduleSave();
  _calRefreshGrid();
  _calRefreshLegend();
  _calRefreshEvents();
}
// Chiudi dropdown se l'utente clicca fuori
document.addEventListener('click', (e) => {
  if (!state.calendarState || !state.calendarState.lezioniDropdownOpen) return;
  if (state.currentView !== 'calendario') return;
  if (e.target.closest('.cal-legend-dropdown') || e.target.closest('.cal-legend-item')) return;
  state.calendarState.lezioniDropdownOpen = false;
  _calRefreshLegend();
});

// ==== Modal aggiunta/modifica evento ====
function openCalEventModal(dateStr, eventId) {
  const existingEvent = eventId
    ? ((state.index.calendar?.eventi || []).find(e => e.id === eventId) || null)
    : null;
  const e = existingEvent || { data: dateStr, ora: '', categoria: 'altro', titolo: '', descrizione: '' };
  const catsHtml = Object.entries(CAL_CATEGORIES).map(([k, v]) =>
    `<option value="${k}" ${e.categoria === k ? 'selected' : ''}>${v.label}</option>`
  ).join('');
  // Ricorrenza esistente (solo per eventi non ancora salvati: gli eventi esistenti
  // vengono modificati come singolo evento, perché la ricorrenza ha già generato
  // tutte le occorrenze come eventi separati al momento della creazione).
  const showRecurrence = !existingEvent;
  showModal({
    title: existingEvent ? 'Modifica evento' : 'Aggiungi evento',
    body: `
      <div style="display:grid;gap:12px;min-width:min(420px,90vw);">
        <label class="field">
          <span>Data</span>
          <input type="date" id="cal-ev-data" value="${escapeHtml(e.data)}" style="font-family:var(--sans);">
        </label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <label class="field">
            <span>Inizio (opzionale)</span>
            <input type="time" id="cal-ev-ora" value="${escapeHtml(e.ora || '')}" style="font-family:var(--sans);">
          </label>
          <label class="field">
            <span>Fine (opzionale)</span>
            <input type="time" id="cal-ev-ora-fine" value="${escapeHtml(e.ora_fine || '')}" style="font-family:var(--sans);">
          </label>
        </div>
        <label class="field">
          <span>Categoria</span>
          <select id="cal-ev-cat" style="font-family:var(--sans);" onchange="document.getElementById('cal-ev-anno-wrap').style.display = this.value === 'lezioni' ? 'flex' : 'none';">${catsHtml}</select>
        </label>
        <label class="field" id="cal-ev-anno-wrap" style="display:${e.categoria === 'lezioni' ? 'flex' : 'none'};">
          <span>Anno corso</span>
          <select id="cal-ev-anno" style="font-family:var(--sans);">
            ${CAL_LEZIONE_ANNI.map(a => `<option value="${a.id}" ${String(e.anno || '') === a.id ? 'selected' : ''}>${escapeHtml(a.label)}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span>Titolo</span>
          <input type="text" id="cal-ev-titolo" value="${escapeHtml(e.titolo || '')}" placeholder="es. Lezione EEG">
        </label>
        <label class="field">
          <span>Descrizione (opzionale)</span>
          <textarea id="cal-ev-desc" rows="3" placeholder="Aula, relatore, note…">${escapeHtml(e.descrizione || '')}</textarea>
        </label>
        ${showRecurrence ? `
        <fieldset style="border:1px solid var(--rule);border-radius:3px;padding:10px 12px;display:grid;gap:10px;">
          <legend style="padding:0 6px;font-size:12px;color:var(--ink-muted);font-family:var(--mono);">RIPETIZIONE</legend>
          <label class="field">
            <span>Frequenza</span>
            <select id="cal-ev-freq" style="font-family:var(--sans);" onchange="document.getElementById('cal-ev-recur-fields').style.display = this.value === 'none' ? 'none' : 'grid';">
              <option value="none" selected>Nessuna (evento singolo)</option>
              <option value="daily">Giornaliera</option>
              <option value="weekly">Settimanale</option>
              <option value="monthly">Mensile</option>
              <option value="yearly">Annuale</option>
            </select>
          </label>
          <div id="cal-ev-recur-fields" style="display:none;gap:10px;grid-template-columns:1fr 1fr;">
            <label class="field">
              <span>Ogni</span>
              <input type="number" id="cal-ev-interval" value="1" min="1" max="365" style="font-family:var(--sans);">
            </label>
            <label class="field">
              <span>Ripetizioni totali</span>
              <input type="number" id="cal-ev-count" value="1" min="1" max="365" style="font-family:var(--sans);">
            </label>
          </div>
        </fieldset>
        ` : ''}
      </div>
    `,
    actions: [
      { label: 'Annulla', variant: 'ghost', onClick: () => closeModal() },
      ...(existingEvent ? [{ label: 'Elimina', variant: 'danger', onClick: () => { closeModal(); deleteCalEvent(existingEvent.id); } }] : []),
      { label: 'Salva', onClick: async (btn) => {
        const data = $('cal-ev-data').value;
        const ora = $('cal-ev-ora').value;
        const ora_fine = $('cal-ev-ora-fine').value;
        const categoria = $('cal-ev-cat').value;
        const anno = categoria === 'lezioni' ? ($('cal-ev-anno')?.value || '') : '';
        const titolo = ($('cal-ev-titolo').value || '').trim();
        const descrizione = ($('cal-ev-desc').value || '').trim();
        if (!data || !titolo) { toast('Data e titolo obbligatori', 'error'); return; }
        // Validazione: l'ora di fine, se specificata, deve essere dopo l'ora di inizio.
        // Confronto stringhe HH:MM funziona perché formato fisso 24h.
        if (ora && ora_fine && ora_fine <= ora) {
          toast("L'orario di fine deve essere successivo a quello di inizio", 'error');
          return;
        }
        if (ora_fine && !ora) {
          toast("Specifica anche l'orario di inizio", 'error');
          return;
        }
        const freq = showRecurrence ? ($('cal-ev-freq')?.value || 'none') : 'none';
        const interval = freq !== 'none' ? Math.max(1, parseInt($('cal-ev-interval')?.value || '1', 10)) : 1;
        const count = freq !== 'none' ? Math.max(1, parseInt($('cal-ev-count')?.value || '1', 10)) : 1;
        btn.disabled = true; btn.textContent = 'Salvo...';
        try {
          const baseEvt = { ...(existingEvent || {}), data, ora, categoria, titolo, descrizione };
          if (ora_fine) baseEvt.ora_fine = ora_fine; else delete baseEvt.ora_fine;
          if (anno) baseEvt.anno = anno; else delete baseEvt.anno;
          if (freq === 'none' || count <= 1) {
            await saveCalEvent(baseEvt, !!existingEvent);
          } else {
            // Genera tutte le occorrenze come eventi separati
            const dates = generateRecurrenceDates(data, freq, interval, count);
            await saveCalEventsBulk(dates.map(d => {
              const ev = { data: d, ora, categoria, titolo, descrizione };
              if (ora_fine) ev.ora_fine = ora_fine;
              if (anno) ev.anno = anno;
              return ev;
            }));
          }
          closeModal();
        } catch (err) {
          console.error('[calendar] save failed:', err);
          toast('Errore salvataggio: ' + (err.message || err), 'error');
          btn.disabled = false; btn.textContent = 'Salva';
        }
      }}
    ]
  });
}

// Genera array di date YYYY-MM-DD a partire da una data, una frequenza, intervallo, e numero di ripetizioni
function generateRecurrenceDates(startDateStr, freq, interval, count) {
  const dates = [];
  const [y, m, d] = startDateStr.split('-').map(Number);
  let current = new Date(y, m - 1, d);
  for (let i = 0; i < count; i++) {
    dates.push(calFormatDate(current));
    const next = new Date(current);
    if (freq === 'daily') next.setDate(next.getDate() + interval);
    else if (freq === 'weekly') next.setDate(next.getDate() + interval * 7);
    else if (freq === 'monthly') next.setMonth(next.getMonth() + interval);
    else if (freq === 'yearly') next.setFullYear(next.getFullYear() + interval);
    current = next;
  }
  return dates;
}

// Salva un batch di eventi (per ricorrenze) in un'unica chiamata putFile
async function saveCalEventsBulk(events) {
  const cal = state.index.calendar || { eventi: [], _sha: null, _path: 'content/calendar.yml' };
  const eventi = [...(cal.eventi || [])];
  const recurrenceId = 'rec_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  events.forEach(evt => {
    eventi.push({
      ...evt,
      id: 'evt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      autore: state.session?.username || 'anonimo',
      creato: new Date().toISOString(),
      ricorrenza: recurrenceId
    });
  });
  await persistCalendar(eventi);
  toast(`${events.length} eventi creati`, 'success');
  _calRefreshGrid(); _calRefreshEvents();
}

async function saveCalEvent(evt, isUpdate) {
  const cal = state.index.calendar || { eventi: [], _sha: null, _path: 'content/calendar.yml' };
  const eventi = [...(cal.eventi || [])];
  if (isUpdate) {
    const i = eventi.findIndex(x => x.id === evt.id);
    if (i >= 0) eventi[i] = { ...eventi[i], ...evt };
  } else {
    evt.id = 'evt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    evt.autore = state.session?.username || 'anonimo';
    evt.creato = new Date().toISOString();
    eventi.push(evt);
  }
  await persistCalendar(eventi);
  toast(isUpdate ? 'Evento aggiornato' : 'Evento creato', 'success');
  _calRefreshGrid(); _calRefreshEvents();
}

async function deleteCalEvent(eventId) {
  const cal = state.index.calendar || { eventi: [], _sha: null };
  const evt = (cal.eventi || []).find(e => e.id === eventId);
  if (!evt) return;
  if (evt.ricorrenza) {
    // Evento ricorrente: mostra modale con 3 scelte
    showModal({
      title: 'Eliminare evento ricorrente',
      subtitle: `${escapeHtml(evt.titolo)} — ${escapeHtml(evt.data)}`,
      body: `<p style="margin:0;color:var(--ink-soft);font-size:14px;line-height:1.5;">
        Questo evento fa parte di una serie ricorrente. Cosa vuoi eliminare?
      </p>`,
      actions: [
        { label: 'Annulla', variant: 'ghost', onClick: () => closeModal() },
        { label: 'Solo questo', onClick: async (btn) => {
            btn.disabled = true; btn.textContent = 'Elimino...';
            try {
              const eventi = (cal.eventi || []).filter(e => e.id !== eventId);
              await persistCalendar(eventi);
              toast('Evento eliminato', 'success');
              closeModal();
              _calRefreshGrid(); _calRefreshEvents();
            } catch (err) {
              console.error('[calendar] delete failed:', err);
              toast('Errore: ' + err.message, 'error');
              btn.disabled = false; btn.textContent = 'Solo questo';
            }
          }},
        { label: 'Questo e i successivi', onClick: async (btn) => {
            btn.disabled = true; btn.textContent = 'Elimino...';
            try {
              // Mantengo solo: eventi non ricorrenti, eventi di altre serie,
              // eventi della stessa serie con data ANTERIORE a quella corrente
              const eventi = (cal.eventi || []).filter(e => {
                if (e.ricorrenza !== evt.ricorrenza) return true;
                return (e.data || '') < (evt.data || '');
              });
              await persistCalendar(eventi);
              toast('Eventi eliminati', 'success');
              closeModal();
              _calRefreshGrid(); _calRefreshEvents();
            } catch (err) {
              console.error('[calendar] delete failed:', err);
              toast('Errore: ' + err.message, 'error');
              btn.disabled = false; btn.textContent = 'Questo e i successivi';
            }
          }},
        { label: 'Tutta la serie', variant: 'danger', onClick: async (btn) => {
            btn.disabled = true; btn.textContent = 'Elimino...';
            try {
              const eventi = (cal.eventi || []).filter(e => e.ricorrenza !== evt.ricorrenza);
              await persistCalendar(eventi);
              toast('Serie eliminata', 'success');
              closeModal();
              _calRefreshGrid(); _calRefreshEvents();
            } catch (err) {
              console.error('[calendar] delete failed:', err);
              toast('Errore: ' + err.message, 'error');
              btn.disabled = false; btn.textContent = 'Tutta la serie';
            }
          }}
      ]
    });
    return;
  }
  // Evento singolo: conferma semplice
  showModal({
    title: 'Eliminare evento',
    subtitle: `${escapeHtml(evt.titolo)} — ${escapeHtml(evt.data)}`,
    body: `<p style="margin:0;color:var(--ink-soft);font-size:14px;">Confermi l'eliminazione?</p>`,
    actions: [
      { label: 'Annulla', variant: 'ghost', onClick: () => closeModal() },
      { label: 'Elimina', variant: 'danger', onClick: async (btn) => {
          btn.disabled = true; btn.textContent = 'Elimino...';
          try {
            const eventi = (cal.eventi || []).filter(e => e.id !== eventId);
            await persistCalendar(eventi);
            toast('Eliminato', 'success');
            closeModal();
            _calRefreshGrid(); _calRefreshEvents();
          } catch (err) {
            console.error('[calendar] delete failed:', err);
            toast('Errore: ' + err.message, 'error');
            btn.disabled = false; btn.textContent = 'Elimina';
          }
        }}
    ]
  });
}

async function persistCalendar(eventi) {
  const cal = state.index.calendar || { eventi: [], _sha: null, _path: 'content/calendar.yml' };
  const yamlHeader = '# Calendario condiviso della clinica\n# Categorie: ' + Object.keys(CAL_CATEGORIES).join(', ') + '\n# Formato data: YYYY-MM-DD (ora opzionale: HH:MM)\n\n';
  const content = yamlHeader + jsyaml.dump({ eventi }, { indent: 2, lineWidth: 120 });
  const username = state.session?.username || 'anonimo';
  const commitMsg = `calendar: ${eventi.length} eventi (by ${username})`;
  try {
    const res = await gh.putFile(cal._path || 'content/calendar.yml', content, cal._sha, commitMsg);
    state.index.calendar = { eventi, _sha: res.content.sha, _path: cal._path || 'content/calendar.yml' };
  } catch (err) {
    if (err.code === 'CONFLICT') {
      // Ricarica il file aggiornato dal server e ritenta
      try {
        const fresh = await gh.getFile(cal._path || 'content/calendar.yml');
        const parsed = jsyaml.load(fresh.content) || {};
        const freshEventi = Array.isArray(parsed.eventi) ? parsed.eventi : [];
        // Merge: aggiungi i nuovi eventi (per id) sopra quelli esistenti
        const existingIds = new Set(freshEventi.map(e => e.id));
        const merged = [...freshEventi, ...eventi.filter(e => e.id && !existingIds.has(e.id))];
        const mergedContent = yamlHeader + jsyaml.dump({ eventi: merged }, { indent: 2, lineWidth: 120 });
        const res2 = await gh.putFile(cal._path || 'content/calendar.yml', mergedContent, fresh.sha, commitMsg + ' (retry)');
        state.index.calendar = { eventi: merged, _sha: res2.content.sha, _path: cal._path || 'content/calendar.yml' };
      } catch (err2) {
        console.error('[calendar] retry after conflict failed:', err2);
        throw new Error('Conflitto non risolvibile: ' + (err2.message || err2));
      }
    } else {
      throw err;
    }
  }
}

// ==== Parser testo guardie ====
function parseGuardieText(text, defaultYear, defaultMonth /* 0-11 */) {
  // Pulizia
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  // Title Case: maiuscola a inizio di ogni parola, anche dopo apostrofo/trattino.
  // Preserva le iniziali disambiguanti già maiuscole (es. "Fabris E"). DALLA → Dalla, D'ANGELO → D'Angelo.
  const titleCase = s => String(s).toLowerCase().replace(/(^|[\s'’-])([a-zà-ÿ])/g, (mm, sep, ch) => sep + ch.toUpperCase())
    // ripristina iniziale singola finale in maiuscolo (es. "fabris e" → "Fabris E")
    .replace(/(\s)([a-z])\b/g, (mm, sp, ch) => sp + ch.toUpperCase());
  const months = {
    gen:0, gennaio:0, feb:1, febbraio:1, mar:2, marzo:2, apr:3, aprile:3,
    mag:4, maggio:4, giu:5, giugno:5, lug:6, luglio:6, ago:7, agosto:7,
    set:8, settembre:8, sett:8, ott:9, ottobre:9, nov:10, novembre:10, dic:11, dicembre:11
  };
  let year = defaultYear, month = defaultMonth;
  // Cerco "MESE DI MAGGIO 2026" o simili per settare year/month
  const headerRe = /mese\s+di\s+([a-zàèéìòù]+)\s+(\d{4})/i;
  for (const l of lines) {
    const m = l.match(headerRe);
    if (m) {
      const mo = months[m[1].toLowerCase()];
      if (mo !== undefined) { month = mo; year = +m[2]; break; }
    }
  }

  // Sezioni: determino la modalità corrente scansionando le righe
  // giorno-notte | amb_divisionale | guardie_osa
  const results = []; // { data, categoria, titolo, descrizione }
  let section = 'giorno-notte'; // default
  const dateRe = /(\d{1,2})\s*[-\/]?\s*(gen|feb|mar|apr|mag|giu|lug|ago|set|sett|ott|nov|dic)[a-z]*/i;

  for (const raw of lines) {
    const lower = raw.toLowerCase();
    // Detect section changes
    if (/ambulatorio\s+divisional/i.test(raw)) { section = 'amb_divisionale'; continue; }
    if (/guardie\s+notturne\s+osa/i.test(raw)) { section = 'guardie_osa'; continue; }
    if (/coguardi/i.test(raw)) { section = 'coguardie'; continue; }
    if (/guardie?\s+specializzandi/i.test(raw) || /giorno\s+notte/i.test(raw)) { section = 'giorno-notte'; continue; }

    // Skip header row "GIORNO NOTTE", "MESE DI ..."
    if (/^(giorno\s+notte|mese\s+di)/i.test(raw)) continue;

    const dm = raw.match(dateRe);
    if (!dm) continue;
    const day = +dm[1];
    const mo = months[dm[2].toLowerCase()];
    if (!day || mo === undefined) continue;

    const data = `${year}-${String(mo + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    // Parte dopo la data
    let rest = raw.replace(dateRe, '').trim();
    // Rimuovi giorno della settimana all'inizio
    rest = rest.replace(/^(lun|mar|mer|gio|ven|sab|dom)[a-zìèéù]*\s*/i, '').trim();
    // Normalizza separatori
    rest = rest.replace(/[·•|]/g, ' ').replace(/\s{2,}/g, ' ').trim();

    if (section === 'giorno-notte') {
      // Regola del formato (colonne GIORNO | NOTTE): l'ULTIMO nome della riga è la guardia di
      // NOTTE; tutto ciò che precede è la guardia di GIORNO. Più persone di giorno sono separate
      // da trattino (es. "Pauro-Rozzi Mazzucco") oppure semplicemente elencate.
      // I prefissi di cognome ("Di Mare", "Del Monte") e le iniziali disambiguanti ("Fabris E")
      // NON vanno spezzati.
      const prefixes = new Set(['di','de','del','della','dello','da','la','lo','le','san','santa']);
      // Unisce prefissi cognome e iniziali disambiguanti in un unico "nome".
      const mergeTokens = (arr) => {
        const out = [];
        for (let i = 0; i < arr.length; i++) {
          const t = arr[i];
          if (prefixes.has(t.toLowerCase()) && i + 1 < arr.length) {
            out.push(t + ' ' + arr[i + 1]); i++;
          } else if (/^[A-Z]\.?$/.test(t) && out.length > 0) {
            // iniziale disambiguante (es. "E") → si attacca al cognome precedente
            out[out.length - 1] += ' ' + t.replace('.', '');
          } else {
            out.push(t);
          }
        }
        return out;
      };
      // 1) Sostituisco i trattini fra nomi con uno spazio, MA solo quando separano nomi
      //    (non quando un'iniziale precede il trattino, es. "Fabris E-Benedetti": qui "E-Benedetti"
      //    significa "E" (di Fabris) e poi "Benedetti"). Tratto il trattino come separatore di nomi.
      const flat = rest.replace(/\s*-\s*/g, ' - ').split(/\s+/).filter(Boolean);
      // 2) Ricostruisco la lista di "nomi" rispettando i separatori "-" come confini di persona,
      //    ma unendo prima prefissi/iniziali all'interno di ogni segmento.
      const segments = [];
      let cur = [];
      for (const tok of flat) {
        if (tok === '-') { if (cur.length) { segments.push(cur); cur = []; } }
        else cur.push(tok);
      }
      if (cur.length) segments.push(cur);
      // Ogni segmento può contenere più nomi (token multipli separati da spazio): li unisco coi
      // prefissi/iniziali. Un segmento normalmente è UNA persona, ma "Mazzonetto Fabris E" è due
      // (Mazzonetto + Fabris E): mergeTokens li separa correttamente.
      let allNames = [];
      segments.forEach(seg => { allNames = allNames.concat(mergeTokens(seg)); });
      allNames = allNames.map(n => titleCase(n.trim())).filter(Boolean);

      let giorno = [], notte = [];
      if (allNames.length === 1) { giorno = []; notte = allNames; }
      else { notte = [allNames[allNames.length - 1]]; giorno = allNames.slice(0, -1); }

      if (giorno.length) {
        results.push({ data, categoria: 'guardie', titolo: 'Guardia giorno: ' + giorno.join(', '), descrizione: '' });
      }
      if (notte.length) {
        results.push({ data, categoria: 'guardie', titolo: 'Guardia notte: ' + notte.join(', '), descrizione: '' });
      }
    } else if (section === 'amb_divisionale') {
      // Unisci prefissi cognome "Di/De/Del/Della/Da/La/Lo/Le" con il token successivo
      const raw2 = rest.split(/\s+/).filter(Boolean);
      const merged = [];
      const prefixes = new Set(['di','de','del','della','dello','da','la','lo','le','san','santa']);
      for (let i = 0; i < raw2.length; i++) {
        const t = raw2[i];
        if (prefixes.has(t.toLowerCase()) && i + 1 < raw2.length) {
          merged.push(t + ' ' + raw2[i + 1]);
          i++;
        } else if (/^[A-Z]\.?$/.test(t) && merged.length > 0) {
          // iniziale disambiguante, attacco al precedente
          merged[merged.length - 1] += ' ' + t.replace('.', '');
        } else {
          merged.push(t);
        }
      }
      if (merged.length) {
        results.push({ data, categoria: 'amb_divisionale', titolo: 'Ambulatorio divisionale: ' + merged.map(n => titleCase(n.trim())).join(', '), descrizione: '' });
      }
    } else if (section === 'guardie_osa') {
      const tokens = rest.split(/\s+/).filter(Boolean);
      if (tokens.length) {
        results.push({ data, categoria: 'guardie', titolo: 'Guardia notte OSA: ' + tokens.map(n => titleCase(n.trim())).join(', '), descrizione: 'Sede: Ospedale Sant\'Antonio' });
      }
    } else if (section === 'coguardie') {
      // Nomi separati da " - " o " – " (con spazi): preserva cognomi multi-parola (es. "Dal Santo").
      // Title Case: maiuscola a inizio di ogni parola anche dopo apostrofo/trattino (DAL SANTO → Dal Santo, D'ANGELO → D'Angelo).
      const titleCase = s => s.toLowerCase().replace(/(^|[\s'’\-])([a-zà-ÿ])/g, (mm, sep, ch) => sep + ch.toUpperCase());
      const names = rest.split(/\s+[-–]\s+/).map(s => titleCase(s.trim())).filter(Boolean);
      if (names.length) {
        results.push({ data, categoria: 'coguardie', titolo: 'Coguardia: ' + names.join(', '), descrizione: '' });
      }
    }
  }
  return { year, month, events: results };
}

// ==== Modal import guardie ====
function openCalImportModal() {
  const c = state.calendarState;
  showModal({
    title: 'Importa guardie / coguardie',
    subtitle: 'Incolla il testo del PDF (guardie o coguardie). Il parser riconosce il tipo dall\u2019intestazione e crea una lista modificabile prima del salvataggio.',
    body: `
      <div style="min-width:min(560px,90vw);">
        <textarea id="cal-import-text" rows="10" style="width:100%;font-family:var(--mono);font-size:12px;" placeholder="CL. NEUROLOGICA – GUARDIE SPECIALIZZANDI – MESE DI MAGGIO 2026&#10;&#10;GIORNO  NOTTE&#10;Venerdi 01-mag Rossi-Bianchi Verdi&#10;..."></textarea>
        <div style="margin-top:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <button class="btn" onclick="calImportParse()">Analizza</button>
          <label class="btn ghost" style="cursor:pointer;margin:0;">📄 Carica PDF
            <input type="file" id="cal-import-pdf" accept="application/pdf,.pdf" style="display:none;" onchange="calImportPdf(this.files[0])">
          </label>
          <span id="cal-import-pdf-status" style="font-size:12px;color:var(--ink-muted);"></span>
          <span style="font-size:12px;color:var(--ink-muted);margin-left:auto;">Default: ${CAL_MONTHS[c.month]} ${c.year}</span>
        </div>
        <div id="cal-import-preview" style="margin-top:14px;"></div>
      </div>
    `,
    actions: [
      { label: 'Chiudi', variant: 'ghost', onClick: () => closeModal() }
    ]
  });
}

function calImportParse() {
  const c = state.calendarState;
  const txt = $('cal-import-text').value || '';
  if (!txt.trim()) { toast('Incolla prima del testo', 'error'); return; }
  const parsed = parseGuardieText(txt, c.year, c.month);
  state._calImportParsed = parsed.events.map((e, i) => ({ ...e, _idx: i, _enabled: true }));
  renderCalImportPreview();
}

// Carica direttamente un PDF: estrae il testo (riusa il modulo LetteraAI), lo mette nella
// textarea e lancia subito l'analisi.
async function calImportPdf(file) {
  if (!file) return;
  const status = document.getElementById('cal-import-pdf-status');
  if (status) status.textContent = 'Lettura PDF…';
  try {
    const L = await ensureLetterAI();
    if (!L || typeof L.extractPdfText !== 'function') throw new Error('Modulo di estrazione non disponibile');
    const text = await L.extractPdfText(file);
    const ta = document.getElementById('cal-import-text');
    if (ta) ta.value = text || '';
    if (status) status.textContent = text ? 'PDF caricato.' : 'Nessun testo estratto.';
    if (text && text.trim()) calImportParse();
  } catch (e) {
    if (status) status.textContent = 'Errore PDF: ' + e.message;
    toast('Errore lettura PDF: ' + e.message, 'error');
  }
}

function renderCalImportPreview() {
  const list = state._calImportParsed || [];
  const el = $('cal-import-preview');
  if (!el) return;
  if (list.length === 0) {
    el.innerHTML = '<div style="color:var(--ink-muted);font-size:13px;">Nessun evento trovato. Controlla il formato del testo.</div>';
    return;
  }
  // Raggruppa per data
  const byDate = new Map();
  list.forEach(e => {
    if (!byDate.has(e.data)) byDate.set(e.data, []);
    byDate.get(e.data).push(e);
  });
  const sortedDates = [...byDate.keys()].sort();
  el.innerHTML = `
    <div style="font-size:12px;color:var(--ink-muted);margin-bottom:8px;">
      Trovati <strong>${list.length}</strong> eventi in <strong>${sortedDates.length}</strong> giorni. Deseleziona quelli da escludere.
    </div>
    <div style="max-height:300px;overflow-y:auto;border:1px solid var(--rule);border-radius:3px;padding:8px;background:var(--bg-sink);">
      ${sortedDates.map(d => {
        const events = byDate.get(d);
        const dObj = (() => { const p = d.split('-'); return new Date(+p[0], +p[1]-1, +p[2]); })();
        const dLabel = dObj.toLocaleDateString('it-IT', { weekday:'short', day:'2-digit', month:'short' });
        return `<div style="margin-bottom:8px;">
          <div style="font-family:var(--mono);font-size:11px;color:var(--ink-muted);margin-bottom:3px;">${escapeHtml(dLabel)}</div>
          ${events.map(e => `<label style="display:flex;gap:8px;align-items:flex-start;padding:4px 0;cursor:pointer;font-size:12px;">
            <input type="checkbox" ${e._enabled ? 'checked' : ''} onchange="calImportToggle(${e._idx})" style="margin-top:2px;">
            <span style="flex:1;">
              <strong>${escapeHtml(e.titolo)}</strong>
              <span style="color:var(--ink-muted);font-family:var(--mono);font-size:10px;margin-left:6px;">${e.categoria}</span>
            </span>
          </label>`).join('')}
        </div>`;
      }).join('')}
    </div>
    <div style="margin-top:10px;display:flex;gap:8px;">
      <button class="btn" onclick="runWithSpinner(this, calImportSave)">Salva ${list.filter(e => e._enabled).length} eventi</button>
      <button class="btn ghost" onclick="state._calImportParsed=null;renderCalImportPreview();">Reset</button>
    </div>
  `;
}

function calImportToggle(idx) {
  const list = state._calImportParsed || [];
  const e = list.find(x => x._idx === idx);
  if (e) { e._enabled = !e._enabled; renderCalImportPreview(); }
}

async function calImportSave() {
  const list = (state._calImportParsed || []).filter(e => e._enabled);
  if (list.length === 0) { toast('Nessun evento selezionato', 'error'); return; }
  const existing = (state.index.calendar?.eventi) || [];
  const nuovi = list.map(e => ({
    id: 'evt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    data: e.data,
    ora: e.ora || '',
    categoria: e.categoria,
    titolo: e.titolo,
    descrizione: e.descrizione || '',
    autore: state.session?.username || 'anonimo',
    creato: new Date().toISOString()
  }));
  try {
    await persistCalendar([...existing, ...nuovi]);
    toast(`Importati ${nuovi.length} eventi`, 'success');
    state._calImportParsed = null;
    closeModal();
    _calRefreshGrid(); _calRefreshEvents();
  } catch (err) {
    toast('Errore salvataggio: ' + err.message, 'error');
  }
}
