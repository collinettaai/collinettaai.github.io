/* ============================ VIEW — PROCEDURA ============================ */
/* ============================ BLOCCHI TIPIZZATI (schema a blocchi) ============================
   Ogni scheda può avere un campo `contenuti` = array di blocchi.
   Tipi supportati in Fase 1: text, list, checklist, callout, table, image,
   system_code, link, form_ref, internal_ref, clinical_note.
   I blocchi sono renderizzati in ordine. Ciascuno ha struttura:
     { tipo: 'string', ...campi specifici del tipo }
*/
function renderBlocco(b, idx, scheda) {
  if (!b || typeof b !== 'object' || !b.tipo) return '';
  // ID DOM stabile per ogni blocco — usato per deep-link, scroll, AI citations, condivisione
  const schedaId = (scheda && (scheda.id || scheda.slug)) || 'x';
  const blockId = `bl-${schedaId}-${idx}`;
  // URL condivisibile del blocco specifico (se sappiamo il tipo di scheda)
  const routeType = (scheda && scheda._routeType) || 'procedura';
  const slug = scheda && scheda.slug;
  let html;
  switch (b.tipo) {
    case 'text':          html = renderBloccoText(b, scheda); break;
    case 'list':          html = renderBloccoList(b); break;
    case 'checklist':     html = renderBloccoChecklist(b, idx, scheda); break;
    case 'callout':       html = renderBloccoCallout(b); break;
    case 'table':         html = renderBloccoTable(b); break;
    case 'image':         html = renderBloccoImage(b, scheda); break;
    case 'system_code':   html = renderBloccoSystemCode(b); break;
    case 'link':          html = renderBloccoLink(b); break;
    case 'form_ref':      html = renderBloccoFormRef(b); break;
    case 'internal_ref':  html = renderBloccoInternalRef(b); break;
    case 'clinical_note': html = renderBloccoClinicalNote(b, idx, scheda); break;
    default:
      console.warn('[renderBlocco] tipo sconosciuto:', b.tipo);
      html = `<div class="bl bl-unknown">Blocco non supportato: <code>${escapeHtml(b.tipo)}</code></div>`;
  }
  // Inietto l'id e il bottone di condivisione nell'elemento radice del blocco.
  // Il primo elemento ha sempre class="bl ..." — aggiungo id e un piccolo bottone overlay.
  // Titolo condivisione: "CollinettaAI · {scheda} · {blocco}" con fallback graduali.
  const schedaTitolo = (scheda && (scheda.titolo || scheda.nome || scheda.slug)) || '';
  const bloccoTitolo = (b.titolo || b.caption || '').toString().trim();
  const parts = ['CollinettaAI'];
  if (schedaTitolo) parts.push(schedaTitolo);
  if (bloccoTitolo) parts.push(bloccoTitolo);
  const shareTitle = parts.join(' · ');
  const shareBtn = slug
    ? `<button class="bl-share-btn" onclick="event.stopPropagation();event.preventDefault();shareLink(buildShareUrl('${routeType}', {slug:'${escapeJs(slug)}'}, '${blockId}'), '${escapeJs(shareTitle)}')" title="Condividi link a questo blocco" aria-label="Condividi blocco"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></button>`
    : '';
  return html.replace(/^(<[a-z]+\s+[^>]*?class="bl[^"]*")/i, `$1 id="${blockId}"`)
             .replace(/^(<[a-z]+\s+[^>]*?class="bl[^"]*"[^>]*>)/i, `$1${shareBtn}`);
}

function renderBloccoText(b, scheda) {
  if (!b.testo) return '';
  const md = (typeof renderMarkdownWithImages === 'function')
    ? renderMarkdownWithImages(b.testo, scheda && scheda.path)
    : escapeHtml(b.testo).replace(/\n\n/g, '</p><p>').replace(/^/, '<p>') + '</p>';
  const title = b.titolo ? `<div class="bl-title">${escapeHtml(b.titolo)}</div>` : '';
  return `<div class="bl bl-text">${title}<div class="bl-text-body">${md}</div></div>`;
}

function renderBloccoList(b) {
  if (!Array.isArray(b.items) || !b.items.length) return '';
  const title = b.titolo ? `<div class="bl-title ${b.variante === 'warning' ? 'bl-title-warn' : ''}">${escapeHtml(b.titolo)}</div>` : '';
  const items = b.items.map(i => `<li>${escapeHtml(String(i))}</li>`).join('');
  return `<div class="bl bl-list ${b.variante === 'warning' ? 'bl-list-warn' : ''}">${title}<ul>${items}</ul></div>`;
}

function renderBloccoChecklist(b, idx, scheda) {
  if (!Array.isArray(b.items) || !b.items.length) return '';
  const title = b.titolo ? `<div class="bl-title">${escapeHtml(b.titolo)}</div>` : '';
  // Stato checkbox è solo client-side (per uso durante procedura), non salvato
  const blockId = `cl-${scheda && scheda.slug ? scheda.slug : 'x'}-${idx}`;
  const items = b.items.map((i, ii) => {
    const itemId = `${blockId}-${ii}`;
    return `<li class="bl-checklist-item">
      <label for="${itemId}">
        <input type="checkbox" id="${itemId}" class="bl-checklist-cb">
        <span class="bl-checklist-text">${escapeHtml(String(i))}</span>
      </label>
    </li>`;
  }).join('');
  return `<div class="bl bl-checklist">${title}<ul>${items}</ul>
    <div class="bl-checklist-actions"><button onclick="resetChecklist('${blockId}')" class="bl-mini-btn">Azzera</button></div>
  </div>`;
}


function renderBloccoCallout(b) {
  const variante = ['warning', 'info', 'tip', 'danger'].includes(b.variante) ? b.variante : 'info';
  const title = b.titolo ? `<div class="bl-callout-title">${escapeHtml(b.titolo)}</div>` : '';
  const body = b.testo ? `<div class="bl-callout-body">${escapeHtml(b.testo)}</div>` : '';
  return `<div class="bl bl-callout bl-callout-${variante}">${title}${body}</div>`;
}

function renderBloccoTable(b) {
  if (!Array.isArray(b.headers) || !Array.isArray(b.rows)) return '';
  const title = b.titolo ? `<div class="bl-title">${escapeHtml(b.titolo)}</div>` : '';
  // Larghezze colonna scelte nell'editor (px); 0/assente = automatica.
  const colWidths = Array.isArray(b.colWidths) ? b.colWidths : [];
  const colGroup = colWidths.some(w => parseInt(w, 10) > 0)
    ? `<colgroup>${b.headers.map((_, ci) => {
        const w = parseInt(colWidths[ci], 10);
        return `<col${w > 0 ? ` style="width:${w}px"` : ''}>`;
      }).join('')}</colgroup>`
    : '';
  const th = b.headers.map(h => `<th>${escapeHtml(String(h))}</th>`).join('');
  const tr = b.rows.map(row => {
    const cells = Array.isArray(row) ? row : [row];
    return `<tr>${cells.map(c => `<td>${escapeHtml(String(c == null ? '' : c))}</td>`).join('')}</tr>`;
  }).join('');
  return `<div class="bl bl-table">${title}<div class="bl-table-wrap"><table>${colGroup}<thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div></div>`;
}

// Restituisce la directory della cartella scheda (senza '/scheda.md' finale).
// Esempio: 'content/procedure/emergenze/rachicentesi/scheda.md' → 'content/procedure/emergenze/rachicentesi'
function _schedaDir(scheda) {
  if (!scheda || !scheda.path) return '';
  return scheda.path.replace(/\/scheda\.md$/, '');
}

function renderBloccoImage(b, scheda) {
  if (!b.src) return '';
  // Costruisco URL come per markdown images: se relativo, punta alla cartella img/ della scheda.
  let url = b.src;
  if (!/^(https?:|data:|\/)/i.test(url)) {
    // Path relativo: <cartella-scheda>/img/<src>
    const dir = _schedaDir(scheda);
    const basePath = dir ? `${dir}/img/` : 'content/img/';
    url = `https://raw.githubusercontent.com/${CONFIG.REPO_OWNER}/${CONFIG.DATA_REPO_NAME}/${CONFIG.BRANCH}/${basePath}${url.replace(/^\.?\//, '')}`;
  }
  const caption = b.caption ? `<figcaption class="bl-image-caption">${escapeHtml(b.caption)}</figcaption>` : '';
  const alt = b.alt || b.caption || 'Immagine';
  // Campo b.descrizione (opzionale): descrizione estesa non visualizzata, usata per RAG/AI.
  // Viene propagata come data-attribute per essere estratta da pipeline esterne senza parse YAML.
  const descrAttr = b.descrizione ? ` data-descrizione="${escapeHtml(String(b.descrizione))}"` : '';
  return `<figure class="bl bl-image"${descrAttr}>
    <img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" class="bl-image-img" data-lightbox="1">
    ${caption}
  </figure>`;
}

function renderBloccoSystemCode(b) {
  if (!b.codici && !b.percorso && !b.titolo) return '';
  const sistema = b.sistema || 'Sistema';
  const title = `<div class="bl-sc-head">
    <span class="bl-sc-sistema">${escapeHtml(sistema)}</span>
    ${b.titolo ? `<span class="bl-sc-titolo">${escapeHtml(b.titolo)}</span>` : ''}
  </div>`;
  const percorso = b.percorso ? `<div class="bl-sc-percorso">${escapeHtml(b.percorso)}</div>` : '';
  let codici = '';
  if (Array.isArray(b.codici) && b.codici.length) {
    codici = '<div class="bl-sc-codici">' + b.codici.map(c => {
      const codice = c.codice || '';
      const desc = c.descrizione ? `<span class="bl-sc-desc">${escapeHtml(c.descrizione)}</span>` : '';
      return `<button class="bl-sc-codice" onclick="copyNumber('${escapeJs(codice)}')" title="Copia il codice">
        <span class="bl-sc-codice-val">${escapeHtml(codice)}</span>${desc}
      </button>`;
    }).join('') + '</div>';
  }
  const note = b.note ? `<div class="bl-sc-note">${escapeHtml(b.note)}</div>` : '';
  return `<div class="bl bl-sc">${title}${percorso}${codici}${note}</div>`;
}

function renderBloccoLink(b) {
  if (!b.url) return '';
  const titolo = b.titolo || b.url;
  const fonte = b.fonte ? `<div class="bl-link-fonte">${escapeHtml(b.fonte)}${b.data_accesso ? ' · ' + escapeHtml(String(b.data_accesso)) : ''}</div>` : '';
  return `<a href="${escapeHtml(b.url)}" target="_blank" rel="noopener" class="bl bl-link">
    <div class="bl-link-head">
      <span class="bl-link-icon">↗</span>
      <span class="bl-link-titolo">${escapeHtml(titolo)}</span>
    </div>
    ${fonte}
  </a>`;
}

function renderBloccoFormRef(b) {
  if (!b.modulo) return '';
  const label = b.label || b.modulo;
  return `<a href="#" class="bl bl-form-ref" onclick="event.preventDefault();navigate('modulo',{slug:'${escapeJs(b.modulo)}'})">
    <span class="bl-icon-doc">📄</span>
    <span class="bl-form-ref-label">${escapeHtml(label)}</span>
    <span class="bl-arrow">→</span>
  </a>`;
}

function renderBloccoInternalRef(b) {
  if (!b.target) return '';
  const tipoToRoute = {
    procedura: 'procedura',
    modulo: 'modulo',
    clinica: 'clinica-scheda',
    numero: 'numeri'
  };
  const route = tipoToRoute[b.target_tipo] || 'procedura';
  const params = b.target_tipo === 'numero' ? `{filter:'${escapeJs(b.target)}'}` : `{slug:'${escapeJs(b.target)}'}`;
  const label = b.label || b.target;
  const tipoLabel = b.target_tipo ? b.target_tipo.charAt(0).toUpperCase() + b.target_tipo.slice(1) : 'Riferimento';
  return `<a href="#" class="bl bl-internal-ref" onclick="event.preventDefault();navigate('${route}',${params})">
    <span class="bl-internal-tipo">${escapeHtml(tipoLabel)}</span>
    <span class="bl-internal-label">${escapeHtml(label)}</span>
    <span class="bl-arrow">→</span>
  </a>`;
}

function renderBloccoClinicalNote(b, idx, scheda) {
  if (!b.testo) return '';
  const title = b.titolo || 'Nota clinica (template)';
  const blockId = `cn-${scheda && scheda.slug ? scheda.slug : 'x'}-${idx}`;
  return `<div class="bl bl-clinical-note">
    <div class="bl-cn-head">
      <span class="bl-cn-title">${escapeHtml(title)}</span>
      <button class="bl-mini-btn" onclick="copyClinicalNote('${blockId}')" title="Copia il testo">Copia</button>
    </div>
    <div class="bl-cn-body" id="${blockId}">${escapeHtml(b.testo)}</div>
  </div>`;
}

/* Helper: azzera una checklist client-side */
function resetChecklist(blockId) {
  document.querySelectorAll(`[id^="${blockId}-"]`).forEach(cb => {
    if (cb.type === 'checkbox') cb.checked = false;
  });
}

/* Helper: copia testo nota clinica */
function copyClinicalNote(blockId) {
  const el = document.getElementById(blockId);
  if (!el) return;
  const text = el.textContent || '';
  navigator.clipboard.writeText(text).then(() => {
    if (typeof toast === 'function') toast('Nota copiata', 'success');
  }).catch(() => {
    if (typeof toast === 'function') toast('Impossibile copiare', 'error');
  });
}

/* Scroll fluido + flash a un blocco della scheda (usato dall'indice cliccabile). */
function scrollToSchedaBlock(id) {
  const el = document.getElementById(id);
  if (!el) return;
  try { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  catch (e) { el.scrollIntoView(); }
  el.classList.add('bl-flash');
  setTimeout(() => el.classList.remove('bl-flash'), 2000);
}
window.scrollToSchedaBlock = scrollToSchedaBlock;

function renderSchedaBody(scheda) {
  const sections = [];

  // Indice cliccabile delle sezioni (blocchi con titolo) in cima alla scheda.
  const _schedaId = (scheda && (scheda.id || scheda.slug)) || 'x';
  const _tocItems = (Array.isArray(scheda.contenuti) ? scheda.contenuti : [])
    .map((b, idx) => ({ idx, titolo: (b && (b.titolo || b.caption) || '').toString().trim() }))
    .filter(x => x.titolo);
  if (_tocItems.length >= 2) {
    const _toc = _tocItems.map((t, i) =>
      `<li><a class="scheda-toc-link" onclick="scrollToSchedaBlock('bl-${escapeJs(_schedaId)}-${t.idx}')"><span class="scheda-toc-num">${i + 1}.</span><span class="scheda-toc-text">${escapeHtml(t.titolo)}</span></a></li>`
    ).join('');
    sections.push(schedaSection('Indice', `<ul class="scheda-toc">${_toc}</ul>`, true));
  }

  // Nuovo schema a blocchi tipizzati (contenuti = array di blocchi)
  if (Array.isArray(scheda.contenuti) && scheda.contenuti.length) {
    const blocchiHtml = scheda.contenuti.map((b, idx) => renderBlocco(b, idx, scheda)).filter(Boolean).join('');
    if (blocchiHtml) {
      sections.push(`<div class="scheda-blocchi">${blocchiHtml}</div>`);
    }
  }

  if (Array.isArray(scheda.indicazioni) || Array.isArray(scheda.controindicazioni)) {
    const ind = Array.isArray(scheda.indicazioni) && scheda.indicazioni.length
      ? `<div><div class="scheda-subtitle">Indicazioni</div><ul class="scheda-list">${scheda.indicazioni.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul></div>` : '';
    const ctr = Array.isArray(scheda.controindicazioni) && scheda.controindicazioni.length
      ? `<div><div class="scheda-subtitle scheda-subtitle-warn">Controindicazioni</div><ul class="scheda-list">${scheda.controindicazioni.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul></div>` : '';
    if (ind || ctr) sections.push(schedaSection('Indicazioni e controindicazioni', `<div class="scheda-two-col">${ind}${ctr}</div>`, true));
  }

  if (Array.isArray(scheda.criteri_valutazione) && scheda.criteri_valutazione.length) {
    sections.push(schedaSection('Criteri di valutazione', `<ul class="scheda-list">${scheda.criteri_valutazione.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`));
  }
  if (scheda.punteggio) {
    const p = scheda.punteggio;
    const intBlock = Array.isArray(p.interpretazione) ? `<ul class="scheda-list" style="margin-top:8px;">${p.interpretazione.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : '';
    sections.push(schedaSection('Punteggio', `<div><strong>Range:</strong> ${escapeHtml(p.range || '—')}</div>${intBlock}`));
  }
  if (scheda.interpretazione && typeof scheda.interpretazione === 'string') {
    sections.push(schedaSection('Interpretazione', renderMarkdownWithImages(scheda.interpretazione, scheda.path)));
  }

  if (Array.isArray(scheda.prerequisiti) && scheda.prerequisiti.length) {
    sections.push(schedaSection('Prerequisiti', `<ul class="scheda-list scheda-checklist">${scheda.prerequisiti.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`));
  }

  if (scheda.preparazione && typeof scheda.preparazione === 'object') {
    const p = scheda.preparazione;
    const rows = [];
    if (p.diluizione) rows.push(['Diluizione', p.diluizione]);
    if (p.concentrazione) rows.push(['Concentrazione', p.concentrazione]);
    if (p.via_somministrazione) rows.push(['Via', p.via_somministrazione]);
    if (p.compatibilita) rows.push(['Compatibilità', p.compatibilita]);
    if (p.materiale) rows.push(['Materiale', p.materiale]);
    if (p.note) rows.push(['Note', p.note]);
    if (rows.length) sections.push(schedaSection('Preparazione', scheda2ColTable(rows)));
  }

  if (scheda.dosaggio && typeof scheda.dosaggio === 'object') {
    const d = scheda.dosaggio;
    const rows = [];
    if (d.carico) rows.push(['Carico', d.carico]);
    if (d.mantenimento) rows.push(['Mantenimento', d.mantenimento]);
    if (d.titolazione) rows.push(['Titolazione', d.titolazione]);
    if (d.massimo) rows.push(['Dose massima', d.massimo]);
    if (rows.length) sections.push(schedaSection('Dosaggio', scheda2ColTable(rows)));
  }

  if (scheda.algoritmo_linee && typeof scheda.algoritmo_linee === 'object') {
    const lineeHtml = Object.entries(scheda.algoritmo_linee).map(([key, linea]) => {
      const nome = key.replace(/_/g, ' ').replace(/linea (\d)/, 'Linea $1');
      const finestra = linea.finestra_temporale ? `<div style="font-family:var(--mono);font-size:11px;color:var(--ink-muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;">⏱ ${escapeHtml(linea.finestra_temporale)}</div>` : '';
      const cond = linea.condizione ? `<div style="font-style:italic;color:var(--ink-muted);margin-bottom:8px;font-size:14px;">${escapeHtml(linea.condizione)}</div>` : '';
      const req = linea.richiede ? `<div style="background:var(--danger-soft);border-left:3px solid var(--danger);padding:8px 12px;margin-bottom:10px;font-size:13px;color:var(--danger);">${escapeHtml(linea.richiede)}</div>` : '';
      const farmaci = Array.isArray(linea.farmaci) ? linea.farmaci.map(f => `
        <div style="padding:10px 0;border-bottom:1px solid var(--rule-soft);">
          <div style="font-family:var(--serif);font-weight:600;font-size:15px;color:var(--ink);">${escapeHtml(f.nome)}</div>
          <div style="font-size:13px;color:var(--ink-soft);margin-top:2px;"><strong>Dose:</strong> ${escapeHtml(f.dose || '—')}</div>
          ${f.via ? `<div style="font-size:13px;color:var(--ink-soft);"><strong>Via:</strong> ${escapeHtml(f.via)}</div>` : ''}
          ${f.alternative ? `<div style="font-size:12px;color:var(--ink-muted);font-style:italic;">Alt: ${escapeHtml(f.alternative)}</div>` : ''}
          ${f.note ? `<div style="font-size:12px;color:var(--ink-muted);font-style:italic;">${escapeHtml(f.note)}</div>` : ''}
          ${f.controindicazioni ? `<div style="font-size:12px;color:var(--danger);">⚠ ${escapeHtml(f.controindicazioni)}</div>` : ''}
        </div>`).join('') : '';
      const rip = linea.ripetibile ? `<div style="font-size:12px;color:var(--ink-muted);margin-top:8px;font-style:italic;">Ripetibile: ${escapeHtml(linea.ripetibile)}</div>` : '';
      return `
        <div style="margin-bottom:20px;padding:16px;background:var(--bg-paper);border:1px solid var(--rule);border-radius:2px;">
          <div style="font-family:var(--serif);font-size:18px;font-weight:500;text-transform:capitalize;margin-bottom:8px;">${escapeHtml(nome)}</div>
          ${finestra}${cond}${req}${farmaci}${rip}
        </div>`;
    }).join('');
    sections.push(schedaSection('Algoritmo terapeutico', lineeHtml, true));
  }

  if (Array.isArray(scheda.target_clinici) && scheda.target_clinici.length) {
    sections.push(schedaSection('Target clinici', `<ul class="scheda-list">${scheda.target_clinici.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`));
  }

  if (scheda.richiesta_galileo && typeof scheda.richiesta_galileo === 'object') {
    const rg = scheda.richiesta_galileo;
    const rows = [];
    if (rg.percorso) rows.push(['Percorso', rg.percorso]);
    if (rg.urgenza) rows.push(['Urgenza', rg.urgenza]);
    if (rg.note_quesito) rows.push(['Note quesito', rg.note_quesito]);
    if (rg.allegati) rows.push(['Allegati', rg.allegati]);
    if (rows.length) sections.push(schedaSection('Richiesta Galileo', scheda2ColTable(rows), true));
  }

  if (Array.isArray(scheda.numeri_chiave) && scheda.numeri_chiave.length) {
    const numsHtml = scheda.numeri_chiave.map(n => {
      const allNums = (n.numeri || []).map(String);
      const primary = allNums[0];
      const extras = allNums.slice(1);
      const primaryHtml = primary
        ? `<button class="numero-num-primary" onclick="event.stopPropagation();copyNumber('${escapeJs(primary)}')" title="Copia ${escapeHtml(primary)}">${escapeHtml(primary)}</button>`
        : `<span class="numero-num-primary" style="opacity:.5;color:var(--ink-muted);">—</span>`;
      const extrasHtml = extras.map(num =>
        `<button class="numero-num-extra" onclick="event.stopPropagation();copyNumber('${escapeJs(num)}')" title="Copia ${escapeHtml(num)}">${escapeHtml(num)}</button>`
      ).join('');
      return `
        <div class="numero-row">
          <div class="numero-row-top">
            <div class="numero-label">${escapeHtml(n.etichetta)}${n.orari ? ` <span style="color:var(--ink-muted);font-size:12px;">· ${escapeHtml(n.orari)}</span>` : ''}</div>
            ${primaryHtml}
          </div>
          ${extrasHtml ? `<div class="numero-row-bottom"><span class="numero-luogo"></span><span class="numero-extras">${extrasHtml}</span></div>` : ''}
          ${n.note ? `<div class="numero-note">${escapeHtml(n.note)}</div>` : ''}
        </div>`;
    }).join('');
    sections.push(schedaSection('Numeri chiave', numsHtml, true));
  }

  if (scheda.orari || scheda.tempistica || scheda.durata_tipica) {
    const rows = [];
    if (scheda.orari) rows.push(['Orari', scheda.orari]);
    if (scheda.tempistica) rows.push(['Tempistica', scheda.tempistica]);
    if (scheda.durata_tipica) rows.push(['Durata tipica', scheda.durata_tipica]);
    sections.push(schedaSection('Tempistiche', scheda2ColTable(rows)));
  }

  if (scheda.monitoraggio && typeof scheda.monitoraggio === 'object') {
    const m = scheda.monitoraggio;
    const parts = [];
    if (Array.isArray(m.parametri)) parts.push(`<div><strong>Parametri:</strong> ${m.parametri.map(escapeHtml).join(', ')}</div>`);
    if (m.frequenza) parts.push(`<div><strong>Frequenza:</strong> ${escapeHtml(m.frequenza)}</div>`);
    if (m.target) parts.push(`<div><strong>Target:</strong> ${escapeHtml(m.target)}</div>`);
    if (Array.isArray(m.allarmi) && m.allarmi.length) parts.push(`<div style="margin-top:8px;"><strong>Allarmi</strong><ul class="scheda-list" style="margin-top:4px;">${m.allarmi.map(a => `<li>${escapeHtml(a)}</li>`).join('')}</ul></div>`);
    sections.push(schedaSection('Monitoraggio', parts.join(''), true));
  }

  if (scheda.sospensione_weaning) sections.push(schedaSection('Sospensione / Weaning', `<p>${escapeHtml(scheda.sospensione_weaning)}</p>`));
  if (scheda.sospensione_farmaci) sections.push(schedaSection('Sospensione farmaci', typeof scheda.sospensione_farmaci === 'string' ? `<p>${escapeHtml(scheda.sospensione_farmaci)}</p>` : `<p>Vedi tabella correlata.</p>`));

  if (Array.isArray(scheda.post_procedura) && scheda.post_procedura.length) {
    sections.push(schedaSection('Post-procedura', `<ul class="scheda-list">${scheda.post_procedura.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`));
  }
  if (Array.isArray(scheda.effetti_avversi) && scheda.effetti_avversi.length) {
    sections.push(schedaSection('Effetti avversi', `<ul class="scheda-list">${scheda.effetti_avversi.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`));
  }
  if (Array.isArray(scheda.interazioni) && scheda.interazioni.length) {
    sections.push(schedaSection('Interazioni', `<ul class="scheda-list">${scheda.interazioni.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`));
  }
  if (scheda.accesso_venoso) sections.push(schedaSection('Accesso venoso', `<p>${escapeHtml(scheda.accesso_venoso)}</p>`));

  if (scheda.nota_diario_template) {
    sections.push(schedaSection('Nota diario (template)',
      `<div style="position:relative;">
        <pre style="font-family:var(--serif);font-size:14px;line-height:1.6;background:var(--bg-sink);padding:16px 20px;border-left:3px solid var(--ink-faint);border-radius:0 2px 2px 0;white-space:pre-wrap;font-style:italic;color:var(--ink-soft);margin:0;">${escapeHtml(scheda.nota_diario_template)}</pre>
        <button class="btn sm ghost" style="position:absolute;top:8px;right:8px;" onclick="copyDiarioNote(this)" data-text="${escapeHtml(scheda.nota_diario_template)}">Copia</button>
      </div>`));
  }
  if (scheda.note_libere) sections.push(schedaSection('Note libere', renderMarkdownWithImages(scheda.note_libere, scheda.path)));
  if (scheda.riferimenti_bibliografici) sections.push(schedaSection('Riferimenti bibliografici', renderMarkdownWithImages(scheda.riferimenti_bibliografici, scheda.path)));

  return sections.join('');
}

function renderSchedaRelated(scheda, isClinica) {
  const related = [];
  (scheda.moduli_correlati || []).forEach(mid => {
    const m = state.index.moduli.find(x => x.slug === mid);
    if (m) related.push({ label: 'Modulo', title: m.titolo, click: `navigate('modulo', {slug:'${m.slug}'})` });
  });
  (scheda.procedure_correlate || []).forEach(pid => {
    const p = state.index.procedure.find(x => x.slug === pid);
    if (p) related.push({ label: 'Procedura', title: p.titolo, click: `navigate('procedura', {slug:'${p.slug}'})` });
    else {
      const c = (state.index.clinica || []).find(x => x.slug === pid);
      if (c) related.push({ label: 'Clinica', title: c.titolo, click: `navigate('clinica-scheda', {slug:'${c.slug}'})` });
    }
  });
  (scheda.invii_campioni_correlati || []).forEach(pid => {
    const p = state.index.procedure.find(x => x.slug === pid);
    if (p) related.push({ label: 'Invio campione', title: p.titolo, click: `navigate('procedura', {slug:'${p.slug}'})` });
  });
  (scheda.numeri_correlati || []).forEach(nid => {
    const n = findContattoBySlug(nid);
    if (n) related.push({ label: 'Numero', title: `${n.etichetta} (${(n.numeri || []).join(', ')})`, click: `navigate('numeri', {filter:'${escapeHtml(nid)}'})` });
  });
  if (!related.length) return '';
  return `<div class="related-grid">${related.map(r => `
    <div class="related-card" onclick="${r.click}">
      <div class="related-card-label">${escapeHtml(r.label)}</div>
      <div class="related-card-title">${escapeHtml(r.title)}</div>
    </div>`).join('')}</div>`;
}

function renderProcedura(slug) {
  const proc = state.index.procedure.find(p => p.slug === slug);
  if (!proc) return renderError('Procedura non trovata', slug);
  // Marca il tipo di scheda per renderBlocco (per costruire URL di condivisione corretti)
  proc._routeType = 'procedura';
  const tagsHtml = (proc.tag || []).map(t => `<span class="tag tag-procedura clickable" onclick="navigate('tag', {tag:'${escapeJs(t)}'})">${escapeHtml(t)}</span>`).join('');

  const catLabel = proc.categoria ? CATEGORIA_LABELS[proc.categoria] || proc.categoria : 'Procedure';
  const subLabel = proc.sottocategoria ? SOTTO_LABELS[proc.sottocategoria] || proc.sottocategoria : null;
  const breadcrumb = buildBreadcrumb([
        { label: 'Procedure', route: 'procedure' },
        { label: catLabel, route: 'procedure-cat', params: { cat: proc.categoria } },
        ...(subLabel ? [{ label: subLabel, route: 'procedure-cat', params: { cat: proc.categoria, sub: proc.sottocategoria } }] : [])
      ]);

  const bodyHtml = proc.body && proc.body.trim() ? renderMarkdownWithImages(proc.body, proc.path) : '';

  $('main-content').innerHTML = `
    <div class="page-head">
      <div class="page-eyebrow">${breadcrumb}</div>
      <h1 class="page-title">${escapeHtml(proc.titolo || proc.slug)} ${renderPinButton('procedura', proc.slug)}</h1>
      <div style="margin-top:12px;">${tagsHtml}</div>
      <div class="page-meta">
        <div class="page-meta-item">Aggiornata ${timeAgo(proc.ultima_modifica)} da <strong style="color:var(--ink-soft);font-family:var(--mono);font-size:12px;margin-left:4px;">${escapeHtml(proc.modificato_da || '—')}</strong></div>
      </div>
      <div class="page-actions">
        <button class="btn ghost" onclick="shareLink(buildShareUrl('procedura', {slug:'${escapeHtml(slug)}'}), 'CollinettaAI · ${escapeHtml(proc.titolo || slug).replace(/'/g, '\\\'')}')" title="Condividi link a questa scheda"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> Condividi</button>
        <button class="btn edit-only" onclick="navigate('procedura-edit', {slug:'${escapeHtml(slug)}'}, {replace:true})">Modifica</button>
        <button class="btn ghost edit-only" onclick="showHistoryModal('${escapeHtml(slug)}')">Cronologia</button>
        <button class="btn ghost edit-only" onclick="confirmDelete('procedura', '${escapeHtml(slug)}')">Elimina</button>
      </div>
    </div>
    <article class="procedura-body">
      ${renderSchedaBody(proc)}
      ${bodyHtml ? `<div style="margin-top:32px;padding-top:24px;border-top:1px solid var(--rule);">${bodyHtml}</div>` : ''}
    </article>
    ${renderSchedaRelated(proc, false)}`;
  scrollToPendingBlock();
}

function renderClinicaList(subFilter) {
  const items = state.index.clinica || [];
  const bySub = {};
  items.forEach(c => {
    const s = c.sottocategoria || '_senza';
    if (!bySub[s]) bySub[s] = [];
    bySub[s].push(c);
  });
  const subs = Object.keys(bySub).sort();
  const subOrder = ['prognosi', 'gestione-post-acuta', 'scale-cliniche'];
  const orderedSubs = [...subOrder.filter(s => bySub[s]), ...subs.filter(s => !subOrder.includes(s))];
  const filtered = subFilter ? (bySub[subFilter] || []) : items;

  // Auto-expand clinica node in sidebar
  navState.expanded.add('clinica');
  if (subFilter) navState.expanded.add('clinica-sub:' + subFilter);
  renderNavTree();

  const pageTitle = subFilter
    ? (SOTTO_LABELS[subFilter] || subFilter)
    : 'Clinica';
  const breadcrumb = subFilter
    ? buildBreadcrumb([{ label: 'Clinica', route: 'clinica' }])
    : buildBreadcrumb([{ label: 'Home', route: 'home' }]);
  const subtitle = subFilter
    ? `${filtered.length} schede`
    : 'Materiale di riferimento consultabile al letto.';

  $('main-content').innerHTML = `
    <div class="page-head">
      <div class="page-eyebrow">${breadcrumb}</div>
      <h1 class="page-title">${escapeHtml(pageTitle)} ${subFilter ? renderPinButton('clinica-sub', subFilter) : ''}</h1>
      <div style="margin-top:8px;font-size:13px;color:var(--ink-muted);">${subtitle}</div>
      <div class="page-actions">
        <button class="btn edit-only" onclick="nuovaSchedaClinica(${subFilter && subFilter !== '_senza' ? `{sottocategoria:'${escapeHtml(subFilter)}'}` : ''})">+ Nuova scheda clinica</button>
      </div>
    </div>
    ${items.length === 0 ? '<p style="color:var(--ink-muted);">Nessuna scheda clinica ancora caricata.</p>' :
      subFilter || (orderedSubs.length === 1 && orderedSubs[0] === '_senza')
        ? `<div class="procedure-grid">${filtered.map(c => renderClinicaCard(c)).join('')}</div>`
        : orderedSubs.map(s => `
            <details class="categoria-block sottocategoria-standalone">
              <summary class="categoria-summary">
                <span class="categoria-title">${escapeHtml(SOTTO_LABELS[s] || (s === '_senza' ? 'Senza sottocategoria' : s))}</span>
                <span class="categoria-count">${bySub[s].length}</span>
              </summary>
              <div class="categoria-content">
                <div class="procedure-grid">
                  ${bySub[s].map(c => renderClinicaCard(c)).join('')}
                </div>
              </div>
            </details>
          `).join('')
    }`;
}

function renderClinicaCard(c) {
  return renderSchedaCard(c, 'clinica');
}

function renderSchedaClinica(slug) {
  const scheda = (state.index.clinica || []).find(c => c.slug === slug);
  if (!scheda) return renderError('Scheda clinica non trovata', slug);
  // Marca tipo di scheda per renderBlocco (URL condivisione corretti)
  scheda._routeType = 'clinica-scheda';
  const tagsHtml = (scheda.tag || []).map(t => `<span class="tag tag-procedura clickable" onclick="navigate('tag', {tag:'${escapeJs(t)}'})">${escapeHtml(t)}</span>`).join('');
  const subLabel = scheda.sottocategoria ? SOTTO_LABELS[scheda.sottocategoria] || scheda.sottocategoria : null;
  const breadcrumb = buildBreadcrumb([
    { label: 'Clinica', route: 'clinica' },
    ...(subLabel ? [{ label: subLabel, route: 'clinica', params: { sub: scheda.sottocategoria } }] : [])
  ]);
  const bodyHtml = scheda.body && scheda.body.trim() ? renderMarkdownWithImages(scheda.body, scheda.path) : '';

  $('main-content').innerHTML = `
    <div class="page-head">
      <div class="page-eyebrow">${breadcrumb}</div>
      <h1 class="page-title">${escapeHtml(scheda.titolo || scheda.slug)} ${renderPinButton('clinica', scheda.slug)}</h1>
      <div style="margin-top:12px;">${tagsHtml}</div>
      <div class="page-meta">
        <div class="page-meta-item">Aggiornata ${timeAgo(scheda.ultima_modifica)} da <strong style="color:var(--ink-soft);font-family:var(--mono);font-size:12px;margin-left:4px;">${escapeHtml(scheda.modificato_da || '—')}</strong></div>
      </div>
      <div class="page-actions">
        <button class="btn ghost" onclick="shareLink(buildShareUrl('clinica-scheda', {slug:'${escapeHtml(slug)}'}), 'CollinettaAI · ${escapeHtml(scheda.titolo || slug).replace(/'/g, '\\\'')}')" title="Condividi link a questa scheda"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> Condividi</button>
        <button class="btn edit-only" onclick="navigate('clinica-edit', {slug:'${escapeHtml(slug)}'}, {replace:true})">Modifica</button>
        <button class="btn ghost edit-only" onclick="showClinicaHistoryModal('${escapeHtml(slug)}')">Cronologia</button>
      </div>
    </div>
    <article class="procedura-body">
      ${renderSchedaBody(scheda)}
      ${bodyHtml ? `<div style="margin-top:32px;padding-top:24px;border-top:1px solid var(--rule);">${bodyHtml}</div>` : ''}
    </article>
    ${renderSchedaRelated(scheda, true)}`;
  scrollToPendingBlock();
}

function showClinicaHistoryModal(slug) {
  const c = (state.index.clinica || []).find(x => x.slug === slug);
  if (!c) return;
  const storia = c.cronologia_recente || [];
  const rows = storia.length
    ? storia.map(s => `<div class="numero-row"><div><div style="font-size:14px;">${escapeHtml(s.nota || '—')}</div><div style="font-size:12px;color:var(--ink-muted);margin-top:2px;"><span style="font-family:var(--mono);">${escapeHtml(s.utente)}</span> · ${timeAgo(s.data)}</div></div></div>`).join('')
    : '<p style="color:var(--ink-muted);padding:16px 0;">Nessuna cronologia.</p>';
  showModal({ title: 'Cronologia', subtitle: '', body: rows, actions: [{ label: 'Chiudi', onClick: closeModal }] });
}

// Editor for clinical cards — reuses procedure editor with a flag
async function renderSchedaClinicaEditor(slug) {
  renderLoading('Preparazione editor clinica...');
  const lockResult = await locks.acquire('clinica-' + slug);
  if (!lockResult.acquired) {
    showModal({
      title: 'File già in modifica',
      subtitle: `In modifica da <strong style="font-family:var(--mono);">${escapeHtml(lockResult.heldBy)}</strong>.`,
      body: '',
      actions: [
        { label: 'Annulla', variant: 'ghost', onClick: () => { closeModal(); navigate('clinica-scheda', {slug}); } },
        { label: 'Modifica comunque', variant: 'danger', onClick: () => { closeModal(); proceedToEditClinica(slug, true); } }
      ]
    });
    return;
  }
  proceedToEditClinica(slug, false);
}

async function proceedToEditClinica(slug, forceOverride) {
  try {
    const scheda = (state.index.clinica || []).find(c => c.slug === slug);
    if (!scheda) throw new Error('Scheda non trovata');
    const file = await gh.getFile(scheda.path);
    if (!file) throw new Error('File non trovato');
    const { frontmatter, body } = parseMarkdown(file.content);
    state.editingContext = {
      type: 'clinica', slug, path: file.path, sha: file.sha,
      originalFrontmatter: { ...frontmatter }, originalBody: body,
      isDirty: false, hasLock: !forceOverride
    };
    renderEditorUIClinica(slug, frontmatter, body);
    window.addEventListener('beforeunload', beforeUnloadHandler);
    armBackGuard(false); // proteggi dalla pressione back accidentale
  } catch (e) {
    renderError('Errore apertura editor', e.message);
  }
}

function renderEditorUIClinica(slug, frontmatter, body) {
  // Simplified editor: Metadata + Markdown body + raw YAML for advanced fields
  // Sottocategorie predefinite rimosse: i suggerimenti derivano solo dalle schede esistenti.
  // (Reintrodurre qui un elenco di default quando si vorranno riproporre sottocategorie fisse.)
  const subOpts = [];
  // Sottocategoria a testo libero: suggerimenti = standard + quelle già esistenti nel repo.
  // Pre-riempio con la sottocategoria derivata (dalla cartella) per non riassegnarla per sbaglio al salvataggio.
  const editSubs = [...new Set([...subOpts, ...(state.index.clinica || []).map(c => c.sottocategoria).filter(Boolean)])].sort();
  const currentSub = frontmatter.sottocategoria || ((state.index.clinica || []).find(c => c.slug === slug) || {}).sottocategoria || '';
  // Extract known schema fields from frontmatter to a YAML blob for manual editing
  const standardKeys = ['id','titolo','categoria','sottocategoria','tag','termini_equivalenti','ultima_modifica','modificato_da','cronologia_recente','contenuti','sintesi'];
  const advancedFrontmatter = {};
  Object.keys(frontmatter).forEach(k => {
    if (!standardKeys.includes(k)) advancedFrontmatter[k] = frontmatter[k];
  });
  const advancedYaml = Object.keys(advancedFrontmatter).length
    ? jsyaml.dump(advancedFrontmatter, { lineWidth: 120, noRefs: true, sortKeys: false })
    : '';

  $('main-content').innerHTML = `
    <div class="editor-head">
      <div class="editor-head-main">
        <div class="editor-head-sub">Clinica · Modifica — ${escapeHtml(slug)}.md</div>
      </div>
      <div class="editor-head-actions">
        <span class="editor-head-undo">
          <button class="btn ghost" id="btn-undo-edit" title="Annulla ultima modifica (Ctrl+Z)" disabled>↶</button>
          <button class="btn ghost" id="btn-redo-edit" title="Ripeti (Ctrl+Y)" disabled>↷</button>
        </span>
        <button class="btn ghost" id="btn-cancel-edit">Annulla</button>
        <button class="btn" id="btn-save-edit">Salva</button>
      </div>
    </div>
    <div class="editor-head-spacer"></div>

    <div class="editor-section">
      <div class="editor-section-head"><div class="editor-section-title">Metadati</div></div>
      <div class="editor-section-body">
        <div class="meta-grid">
          <div class="field">
            <label>Titolo</label>
            <input type="text" id="meta-titolo" value="${escapeHtml(frontmatter.titolo || '')}">
          </div>
          <div class="field">
            <label>Sottocategoria</label>
            <input type="text" id="meta-sottocategoria" class="mono-input" list="meta-clinica-subs" placeholder="scegli o digita (es. esame-obiettivo)" value="${escapeHtml(currentSub)}">
            <datalist id="meta-clinica-subs">${editSubs.map(s => `<option value="${escapeHtml(s)}">`).join('')}</datalist>
          </div>
          <div class="field" style="grid-column:1/-1;">
            <label>Tag</label>
            ${renderChipsField({
              id: 'meta-tag-chips',
              values: frontmatter.tag || [],
              suggestions: collectAllTags(),
              placeholder: 'cerca o crea tag…',
              allowNew: true
            })}
          </div>
          <div class="field" style="grid-column:1/-1;">
            <label>Termini equivalenti</label>
            ${renderChipsField({
              id: 'meta-termini-chips',
              values: frontmatter.termini_equivalenti || [],
              suggestions: collectAllTermini(),
              placeholder: 'cerca o crea sinonimo…',
              allowNew: true
            })}
          </div>
          <div class="field" style="grid-column:1/-1;">
            <label>Nota modifica (va in cronologia)</label>
            <input type="text" id="meta-note-modifica" placeholder="es. aggiunto score FOUR">
          </div>
        </div>
      </div>
    </div>

    <div class="editor-section">
      <div class="editor-section-head"><div class="editor-section-title">Campi strutturati (YAML avanzato)</div></div>
      <div class="editor-section-body">
        <div style="font-size:12px;color:var(--ink-muted);margin-bottom:8px;">Campi come <code>sintesi</code>, <code>indicazioni</code>, <code>punteggio</code>, <code>numeri_chiave</code>, etc. Sintassi YAML.</div>
        <textarea id="meta-advanced-yaml" rows="14" class="mono-input" style="font-size:12px;line-height:1.5;">${escapeHtml(advancedYaml)}</textarea>
      </div>
    </div>

    <div class="editor-section">
      <div class="editor-section-head" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <div class="editor-section-title">Contenuto</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <button type="button" class="btn ghost sm" id="btn-ai-import-clinica" title="Importa una scheda clinica da testo grezzo con l'aiuto di un'AI esterna">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2L9 9l-7 1 5 5-1 7 6-3 6 3-1-7 5-5-7-1z"/></svg>
            <span style="margin-left:4px;">Importa con AI</span>
          </button>
        </div>
      </div>
      <div id="editor-wrapper"></div>
    </div>`;

  // Tutte le schede usano il block editor (schema con `contenuti: []`).
  // Se per qualche motivo il frontmatter non ha `contenuti` array (file legacy che non
  // dovrebbero esistere in produzione), inizializzo a array vuoto e l'utente potrà ricostruire
  // il contenuto a blocchi. Il body markdown puro non viene più supportato.
  const contenuti = Array.isArray(frontmatter.contenuti) ? frontmatter.contenuti : [];
  if (!Array.isArray(frontmatter.contenuti) && body && body.trim()) {
    toast('Schema legacy rilevato: il body markdown è stato rimosso. Ricostruisci il contenuto con il block editor.', 'warning', 8000);
    console.warn('[renderEditorUIClinica] frontmatter senza `contenuti` array per', slug, '— body markdown ignorato');
  }
  blockEditor.render($('editor-wrapper'), contenuti);
  state.editingContext._usesBlockEditor = true;

  // Init chips
  chipsInit('meta-tag-chips', collectAllTags());
  chipsInit('meta-termini-chips', collectAllTermini());

  ['meta-titolo','meta-sottocategoria','meta-note-modifica','meta-advanced-yaml'].forEach(id => {
    const el = $(id); if (el) el.addEventListener('input', () => { if (state.editingContext) state.editingContext.isDirty = true; });
  });

  $('btn-cancel-edit').onclick = () => {
    if (state.editingContext.isDirty && !confirm('Annullare le modifiche?')) return;
    if (state.editingContext.hasLock) locks.release('clinica-' + state.editingContext.slug).catch(() => {});
    state.editingContext = null;
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    navigate('clinica-scheda', { slug });
  };
  $('btn-save-edit').onclick = function () { runWithSpinner(this, saveSchedaClinica); };
  _wireBlockEditorUndoRedo();
  // AI Import workflow: bottone opzionale per popolare i blocchi a partire da
  // testo grezzo, tramite un'AI esterna.
  const btnAiClinica = $('btn-ai-import-clinica');
  if (btnAiClinica) btnAiClinica.onclick = () => openAIImportModal('clinica');
}

// Collega i pulsanti Undo/Redo della barra editor al blockEditor e ne aggiorna lo stato
// (abilitato/disabilitato) a ogni cambiamento. Usato sia per le schede cliniche che procedure.
function _measureEditorHead() {
  const bar = document.querySelector('.editor-head');
  if (!bar) return;
  // requestAnimationFrame: assicura che il layout (e l'eventuale wrap su mobile) sia stabile.
  requestAnimationFrame(() => {
    const h = Math.round(bar.getBoundingClientRect().height);
    if (h > 0) document.documentElement.style.setProperty('--editor-head-height', h + 'px');
  });
}

function _wireBlockEditorUndoRedo() {
  const undoBtn = $('btn-undo-edit');
  const redoBtn = $('btn-redo-edit');
  if (!undoBtn || !redoBtn || typeof blockEditor === 'undefined' || !blockEditor.setOnChange) return;
  const sync = () => {
    undoBtn.disabled = !blockEditor.canUndo();
    redoBtn.disabled = !blockEditor.canRedo();
  };
  undoBtn.onclick = () => { blockEditor.undo(); sync(); };
  redoBtn.onclick = () => { blockEditor.redo(); sync(); };
  blockEditor.setOnChange(sync);
  sync();
  // Misuro l'altezza reale della barra editor (fixed) e la riporto nello spacer via CSS var,
  // così il contenuto non finisce sotto la barra. Rimisuro su resize/orientamento perché su
  // mobile la barra può andare a capo cambiando altezza.
  _measureEditorHead();
  if (!window._editorHeadResizeBound) {
    window._editorHeadResizeBound = true;
    window.addEventListener('resize', () => { _measureEditorHead(); });
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => { _measureEditorHead(); });
  }
  // Scorciatoie tastiera: Ctrl/Cmd+Z = undo, Ctrl/Cmd+Y o Ctrl/Cmd+Shift+Z = redo.
  // Rimosse automaticamente all'uscita perché la barra viene rigenerata a ogni apertura editor.
  if (!document._blockEditorUndoKeysBound) {
    document._blockEditorUndoKeysBound = true;
    document.addEventListener('keydown', (e) => {
      if (!$('btn-undo-edit')) return; // siamo in un editor a blocchi?
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); blockEditor.undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); blockEditor.redo(); }
    });
  }
}

async function saveSchedaClinica() {
  const ctx = state.editingContext;
  if (!ctx) return;
  const btn = $('btn-save-edit');
  btn.disabled = true;
  btn.textContent = 'Salvataggio...';
  try {
    // Parse advanced YAML
    let advancedFm = {};
    const yamlStr = $('meta-advanced-yaml').value.trim();
    if (yamlStr) {
      try { advancedFm = jsyaml.load(yamlStr) || {}; }
      catch (e) { throw new Error('YAML avanzato non valido: ' + e.message); }
    }
    const nf = {
      id: ctx.slug,
      titolo: $('meta-titolo').value.trim() || ctx.slug,
      categoria: 'clinica',
      sottocategoria: $('meta-sottocategoria').value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,''),
      tag: chipsGet('meta-tag-chips'),
      termini_equivalenti: chipsGet('meta-termini-chips'),
      ...advancedFm,
      ultima_modifica: nowIso(),
      modificato_da: state.session.username
    };
    const nota = $('meta-note-modifica').value.trim() || 'aggiornamento';
    nf.cronologia_recente = [
      { data: nowIso(), utente: state.session.username, nota },
      ...((ctx.originalFrontmatter.cronologia_recente || []).slice(0, 4))
    ];

    // Tutte le schede usano il block editor: leggo i blocchi e azzero il body markdown
    nf.contenuti = blockEditor.getBlocks();
    const newBody = '';
    const newContent = stringifyMarkdown(nf, newBody);
    const commitMsg = `Aggiorna clinica/${ctx.slug} — ${nota} (by ${state.session.username})`;

    await gh.putFile(ctx.path, newContent, ctx.sha, commitMsg);
    toast('Salvato', 'success');
    if (ctx.hasLock) locks.release('clinica-' + ctx.slug).catch(() => {});

    // Update local index
    const idx = state.index.clinica.findIndex(c => c.slug === ctx.slug);
    if (idx >= 0) {
      state.index.clinica[idx] = { ...state.index.clinica[idx], ...nf, body: newBody, body_preview: newBody.substring(0, 300) };
      rebuildSearchIndex();
    }
    state.editingContext = null;
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    navigate('clinica-scheda', { slug: ctx.slug });
  } catch (e) {
    toast('Errore: ' + e.message, 'error', 6000);
    btn.disabled = false;
    btn.textContent = 'Salva';
  }
}

function nuovaSchedaClinica(preset = {}) {
  if (bloccaSeNonModifica('clinica')) return;
  const existingSlugs = new Set((state.index.clinica || []).map(c => c.slug));
  // Sottocategorie predefinite rimosse: i suggerimenti derivano solo dalle schede esistenti.
  const subOpts = [];
  const ncSubs = [...new Set([...subOpts, ...(state.index.clinica || []).map(c => c.sottocategoria).filter(Boolean)])].sort();

  showModal({
    title: 'Nuova scheda clinica',
    subtitle: 'Prognosi, gestione post-acuta, o scala clinica.',
    body: `
      <div class="field"><label>Titolo</label><input type="text" id="nc-titolo" placeholder="es. ICH Score"></div>
      <div class="field">
        <label>Slug (nome file)</label>
        <input type="text" id="nc-slug" class="mono-input" placeholder="es. ich-score">
      </div>
      <div class="field">
        <label>Sottocategoria</label>
        <input type="text" id="nc-sottocategoria" class="mono-input" list="nc-subs-list" placeholder="scegli o digita (es. esame-obiettivo)" value="${escapeHtml(preset.sottocategoria || '')}">
        <datalist id="nc-subs-list">${ncSubs.map(s => `<option value="${escapeHtml(s)}">`).join('')}</datalist>
      </div>
      <div id="nc-error" style="color:var(--danger);font-size:13px;display:none;margin-top:8px;"></div>`,
    actions: [
      { label: 'Annulla', variant: 'ghost', onClick: closeModal },
      { label: 'Crea e apri editor', onClick: async () => {
        const titolo = $('nc-titolo').value.trim();
        let slug = $('nc-slug').value.trim().toLowerCase();
        let sottocat = $('nc-sottocategoria').value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
        const err = $('nc-error');
        const show = m => { err.textContent = m; err.style.display = 'block'; };
        if (!titolo) return show('Titolo obbligatorio.');
        if (!sottocat) return show('Sottocategoria obbligatoria.');
        if (!slug) slug = titolo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
        if (!/^[a-z0-9-]+$/.test(slug)) return show('Slug non valido.');
        if (existingSlugs.has(slug)) return show('Slug già esistente.');

        const nf = {
          id: slug, titolo,
          categoria: 'clinica',
          sottocategoria: sottocat,
          tag: [],
          ultima_modifica: nowIso(),
          modificato_da: state.session.username,
          cronologia_recente: [{ data: nowIso(), utente: state.session.username, nota: 'creazione' }]
        };
        const content = stringifyMarkdown(nf, '');
        // Schema cartella per scheda: content/clinica/<sub>/<slug>/scheda.md
        const path = `content/clinica/${sottocat}/${slug}/scheda.md`;
        try {
          const res = await gh.putFile(path, content, null, `Nuova scheda clinica: ${slug} (by ${state.session.username})`);
          closeModal();
          toast(`Scheda "${slug}" creata`, 'success');
          state.index.clinica.push({ slug, path, sha: res.content.sha, ...nf, body: '', body_preview: '' });
          rebuildSearchIndex();
          updateNavCounts();
          navigate('clinica-edit', { slug });
        } catch (e) { show('Errore: ' + e.message); }
      }}
    ]
  });
  setTimeout(() => {
    const t = $('nc-titolo'), s = $('nc-slug');
    let edited = false;
    s.addEventListener('input', () => { edited = true; });
    t.addEventListener('input', () => {
      if (edited) return;
      s.value = t.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
    });
    t.focus();
  }, 50);
}


function schedaSection(title, html, defaultOpen = false) {
  const id = 'sec-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `
    <details class="scheda-section" ${defaultOpen ? 'open' : ''}>
      <summary class="scheda-summary">${escapeHtml(title)}</summary>
      <div class="scheda-content">${html}</div>
    </details>`;
}

function scheda2ColTable(rows) {
  return `<table class="scheda-kv-table"><tbody>${rows.map(([k, v]) => `
    <tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>
  `).join('')}</tbody></table>`;
}

function copyDiarioNote(btn) {
  const text = btn.dataset.text;
  navigator.clipboard.writeText(text).then(
    () => toast('Nota diario copiata', 'success', 1500),
    () => toast('Copia fallita', 'error')
  );
}

function showHistoryModal(slug) {
  const proc = state.index.procedure.find(p => p.slug === slug);
  if (!proc) return;
  const storia = proc.cronologia_recente || [];
  const rows = storia.length
    ? storia.map(s => `
        <div class="numero-row">
          <div>
            <div style="font-size:14px;">${escapeHtml(s.nota || '—')}</div>
            <div style="font-size:12px;color:var(--ink-muted);margin-top:2px;">
              <span style="font-family:var(--mono);">${escapeHtml(s.utente)}</span> · ${timeAgo(s.data)}
            </div>
          </div>
        </div>`).join('')
    : '<p style="color:var(--ink-muted);padding:16px 0;">Nessuna cronologia nel file.</p>';
  const ghUrl = `https://github.com/${CONFIG.REPO_OWNER}/${CONFIG.DATA_REPO_NAME}/commits/${CONFIG.BRANCH}/${proc.path}`;
  showModal({
    title: 'Cronologia modifiche',
    subtitle: 'Ultime revisioni registrate nel file.',
    body: rows + `<p style="margin-top:16px;font-size:13px;color:var(--ink-muted);">Per la cronologia Git completa: <a href="${ghUrl}" target="_blank" rel="noopener">vedi su GitHub</a></p>`,
    actions: [{ label: 'Chiudi', onClick: closeModal }]
  });
}


/* ============================ VIEW — EDITOR ============================ */
async function renderProceduraEditor(slug) {
  renderLoading('Preparazione editor...');
  const lockResult = await locks.acquire(slug);
  if (!lockResult.acquired) {
    showModal({
      title: 'File già in modifica',
      subtitle: `Il file è attualmente in modifica da <strong style="font-family:var(--mono);">${escapeHtml(lockResult.heldBy)}</strong> dal ${new Date(lockResult.since).toLocaleTimeString('it-IT')}.`,
      body: '<p style="font-size:14px;color:var(--ink-soft);">Cosa vuoi fare?</p>',
      actions: [
        { label: 'Annulla', variant: 'ghost', onClick: () => { closeModal(); navigate('procedura', {slug}); } },
        { label: 'Modifica comunque', variant: 'danger', onClick: () => { closeModal(); proceedToEdit(slug, true); } }
      ]
    });
    return;
  }
  proceedToEdit(slug, false);
}

async function proceedToEdit(slug, forceOverride) {
  try {
    const proc = state.index.procedure.find(p => p.slug === slug);
    if (!proc) throw new Error('Procedura non in indice. Prova a fare refresh.');
    const file = await gh.getFile(proc.path);
    if (!file) throw new Error(`File non trovato (${proc.path})`);
    const { frontmatter, body } = parseMarkdown(file.content);
    // Log diagnostico per debug body vuoto
    if (!body || body.trim().length < 10) {
      console.warn('[editor] body molto corto o vuoto per', slug, {
        path: proc.path,
        contentLength: file.content ? file.content.length : 0,
        bodyLength: body ? body.length : 0,
        contentPreview: (file.content || '').substring(0, 200)
      });
    }
    state.editingContext = {
      type: 'procedura', slug, path: file.path, sha: file.sha,
      originalFrontmatter: { ...frontmatter },
      originalBody: body,
      isDirty: false,
      hasLock: !forceOverride
    };
    renderEditorUI(slug, frontmatter, body);
    window.addEventListener('beforeunload', beforeUnloadHandler);
    armBackGuard(false); // proteggi dalla pressione back accidentale
  } catch (e) {
    renderError('Errore apertura editor', e.message);
  }
}

function beforeUnloadHandler(e) {
  if (state.editingContext && state.editingContext.isDirty) {
    e.preventDefault();
    e.returnValue = '';
    return '';
  }
}

// Best-effort flush of pending pin saves when tab closes.
// Uses synchronous-style approach by firing a non-awaited persist().
window.addEventListener('beforeunload', () => {
  if (state.userPrefs && state.userPrefs._pending) {
    if (state.userPrefs._saveTimer) clearTimeout(state.userPrefs._saveTimer);
    userPrefs.persist().catch(() => {});
  }
});

/* ============================ EDITOR A BLOCCHI (Fase 2) ============================
   Editor Notion-like per schede con schema a blocchi tipizzati.
   Design: UI gentile per specializzandi non-tecnici, nessun gergo visibile,
   menu bottoni solo su hover, aggiungi blocco con selettore visuale, riordino ↑↓×.
   API pubblica:
     - blockEditor.render(container, contenuti): monta editor in container con array iniziale
     - blockEditor.getBlocks(): ritorna l'array corrente letto dal DOM
     - blockEditor.hasBlocks(): true se c'è almeno un blocco (anche vuoto)
*/
const blockEditor = (function() {
  // === UNDO/REDO ===
  // Stack di snapshot JSON dei blocchi. _histPos punta allo stato corrente.
  // Le modifiche strutturali (aggiungi/elimina/sposta/tabella/codici) registrano
  // subito uno snapshot; le digitazioni nei campi testo sono raggruppate con debounce
  // così un undo annulla un'intera "raffica" di battitura invece di un singolo carattere.
  let _history = [];
  let _histPos = -1;
  let _snapTimer = null;
  let _onChange = null;     // callback notificata quando cambia lo stato (per aggiornare i pulsanti)
  const _HIST_MAX = 100;
  function _snapshot() { return JSON.stringify(_blocks); }
  function _notifyChange() { if (typeof _onChange === 'function') { try { _onChange(); } catch {} } }
  function _resetHistory() {
    _history = [_snapshot()];
    _histPos = 0;
    if (_snapTimer) { clearTimeout(_snapTimer); _snapTimer = null; }
    _notifyChange();
  }
  // Registra lo stato corrente come nuovo punto nella history (tronca eventuali redo).
  function _pushHistory() {
    if (_snapTimer) { clearTimeout(_snapTimer); _snapTimer = null; }
    const snap = _snapshot();
    if (_history[_histPos] === snap) return; // nessun cambiamento reale
    _history = _history.slice(0, _histPos + 1);
    _history.push(snap);
    if (_history.length > _HIST_MAX) _history.shift();
    _histPos = _history.length - 1;
    _notifyChange();
  }
  // Per le digitazioni: rimanda lo snapshot di ~500ms così i caratteri consecutivi
  // confluiscono in un unico passo di undo.
  function _pushHistoryDebounced() {
    if (_snapTimer) clearTimeout(_snapTimer);
    _snapTimer = setTimeout(() => { _snapTimer = null; _pushHistory(); }, 500);
  }
  function _restore(snap) {
    _blocks = JSON.parse(snap);
    _fullRender();
    _notifyChange();
  }
  // Tipi disponibili. Ognuno ha: label (ita, per utente), icon (SVG 16x16), render() per form inline
  const TIPI = {
    text: {
      label: 'Testo',
      descrizione: 'Paragrafo con formattazione base',
      icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7V5h16v2M9 19h6M12 5v14"/></svg>',
      defaults: { testo: '' },
      fields: [
        { key: 'titolo', label: 'Titolo (opzionale)', type: 'text', placeholder: 'es. Note operative' },
        { key: 'testo', label: 'Testo', type: 'textarea', rows: 3, placeholder: 'Scrivi qui. Puoi usare **grassetto**, *corsivo*, `codice`.' }
      ]
    },
    list: {
      label: 'Elenco',
      descrizione: 'Elenco puntato, normale o evidenziato',
      icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/></svg>',
      defaults: { items: [''] },
      fields: [
        { key: 'titolo', label: 'Titolo (opzionale)', type: 'text', placeholder: 'es. Indicazioni' },
        { key: 'variante', label: 'Stile', type: 'select', options: [
          { value: '', label: 'Normale' },
          { value: 'warning', label: 'Evidenziato (rosso, per controindicazioni)' }
        ]},
        { key: 'items', label: 'Voci', type: 'string-list', placeholder: 'una voce per riga' }
      ]
    },
    checklist: {
      label: 'Checklist',
      descrizione: 'Elenco con caselle da spuntare durante la procedura',
      icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="6" height="6" rx="1"/><path d="M5 6l1 1 2-2"/><path d="M12 6h9M12 12h9M12 18h9"/><rect x="3" y="9" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/></svg>',
      defaults: { items: [''] },
      fields: [
        { key: 'titolo', label: 'Titolo', type: 'text', placeholder: 'es. Controlli pre-procedura' },
        { key: 'items', label: 'Voci da spuntare', type: 'string-list', placeholder: 'una per riga' }
      ]
    },
    callout: {
      label: 'Avviso',
      descrizione: 'Box evidenziato per note importanti',
      icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 22h20L12 2z"/><line x1="12" y1="9" x2="12" y2="14"/><circle cx="12" cy="17" r="0.5" fill="currentColor"/></svg>',
      defaults: { variante: 'warning', testo: '' },
      fields: [
        { key: 'variante', label: 'Tipo', type: 'select', options: [
          { value: 'warning', label: '⚠ Avviso (arancio)' },
          { value: 'info', label: 'ℹ Informazione (blu)' },
          { value: 'tip', label: '✓ Consiglio (verde)' },
          { value: 'danger', label: '✗ Pericolo (rosso)' }
        ]},
        { key: 'titolo', label: 'Titolo', type: 'text', placeholder: 'es. Prima di pungere' },
        { key: 'testo', label: 'Testo', type: 'textarea', rows: 2 }
      ]
    },
    table: {
      label: 'Tabella',
      descrizione: 'Tabella con intestazioni e righe',
      icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="1"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="3" x2="9" y2="21"/></svg>',
      defaults: { headers: ['Colonna 1', 'Colonna 2'], rows: [['', '']] },
      fields: [
        { key: 'titolo', label: 'Titolo', type: 'text', placeholder: 'es. Analisi specifiche' },
        { key: '_table', type: 'table-editor' }
      ]
    },
    image: {
      label: 'Immagine',
      descrizione: 'Immagine con didascalia e descrizione',
      icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
      defaults: { src: '' },
      fields: [
        { key: 'src', label: 'Nome file immagine', type: 'text', placeholder: 'es. rachicentesi-repere.jpg', hint: 'Il file deve esistere nella cartella img/ accanto a scheda.md. Usa il pulsante sopra per caricare.' },
        { key: 'alt', label: 'Testo alternativo', type: 'text', placeholder: 'breve descrizione per accessibilità' },
        { key: 'caption', label: 'Didascalia (visibile)', type: 'text', placeholder: 'es. Punto di repere L3-L4' },
        { key: 'descrizione', label: 'Descrizione estesa (per AI, non visibile)', type: 'textarea', rows: 3, hint: 'Descrivi cosa mostra l\'immagine in dettaglio. Sarà usato da un\'AI futura per rispondere a domande.' }
      ]
    },
    system_code: {
      label: 'Codice sistema',
      descrizione: 'Codici per sistemi ospedalieri (Galileo, GIPSE)',
      icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
      defaults: { sistema: 'Galileo', codici: [{ codice: '', descrizione: '' }] },
      fields: [
        { key: 'sistema', label: 'Sistema', type: 'select', options: [
          { value: 'Galileo', label: 'Galileo' },
          { value: 'GIPSE', label: 'GIPSE' },
          { value: 'Altro', label: 'Altro sistema' }
        ]},
        { key: 'titolo', label: 'Titolo richiesta', type: 'text', placeholder: 'es. Esame del liquor' },
        { key: 'percorso', label: 'Percorso nel sistema', type: 'text', placeholder: 'es. SR MEDICINA DI LABORATORIO → ESAME DEL LIQUOR' },
        { key: '_codici', type: 'codici-editor' },
        { key: 'note', label: 'Note', type: 'textarea', rows: 2, placeholder: 'es. Feriali entro le 14' }
      ]
    },
    link: {
      label: 'Link esterno',
      descrizione: 'Collegamento a linea guida, articolo, sito',
      icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1"/><path d="M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1"/></svg>',
      defaults: { url: '' },
      fields: [
        { key: 'url', label: 'URL', type: 'text', placeholder: 'https://...' },
        { key: 'titolo', label: 'Titolo', type: 'text', placeholder: 'es. Lumbar puncture — StatPearls' },
        { key: 'fonte', label: 'Fonte', type: 'text', placeholder: 'es. NCBI Bookshelf' },
        { key: 'data_accesso', label: 'Data di accesso (opzionale)', type: 'text', placeholder: 'es. 2026-04-15' }
      ]
    },
    form_ref: {
      label: 'Modulo interno',
      descrizione: 'Rimando a un modulo dell\'app',
      icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>',
      defaults: { modulo: '' },
      fields: [
        { key: 'modulo', label: 'Modulo', type: 'select-dynamic', sourceKey: 'moduli' },
        { key: 'label', label: 'Etichetta da mostrare', type: 'text', placeholder: 'es. Modulo consenso informato' }
      ]
    },
    internal_ref: {
      label: 'Link interno',
      descrizione: 'Link ad altra scheda, modulo o contatto',
      icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17l10-10M7 7h10v10"/></svg>',
      defaults: { target_tipo: 'procedura', target: '' },
      fields: [
        { key: 'target_tipo', label: 'Tipo di risorsa', type: 'select', options: [
          { value: 'procedura', label: 'Procedura' },
          { value: 'clinica', label: 'Scheda clinica' },
          { value: 'modulo', label: 'Modulo' },
          { value: 'numero', label: 'Contatto/numero' }
        ]},
        { key: 'target', label: 'Risorsa', type: 'select-dynamic', sourceKeyFrom: 'target_tipo' },
        { key: 'label', label: 'Etichetta da mostrare', type: 'text', placeholder: 'es. Procedura rachicentesi' }
      ]
    },
    clinical_note: {
      label: 'Template nota clinica',
      descrizione: 'Testo pronto da copiare nel diario clinico',
      icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
      defaults: { testo: '' },
      fields: [
        { key: 'titolo', label: 'Titolo', type: 'text', placeholder: 'es. Template nota di diario' },
        { key: 'testo', label: 'Testo della nota', type: 'textarea', rows: 5, placeholder: 'Scrivi qui il template...' }
      ]
    }
  };

  // Stato modulo (non esposto)
  let _root = null;         // <div> container
  let _blocks = [];         // array corrente (sincronizzato con DOM alla lettura)
  let _uid = 0;             // contatore per id temporanei univoci

  function uid() { return ++_uid; }

  // Normalizza array di valori: converte textarea line-break in array items
  function _normalizeBlock(b) {
    const out = { ...b };
    // Rimuovi campi vuoti/undefined (a parte tipo) e proprietà transitorie di UI (prefisso _,
    // es. _tblExpanded: stato espandi/comprimi tabella che non va salvato nel dato).
    Object.keys(out).forEach(k => {
      if (k === 'tipo') return;
      if (k.charAt(0) === '_') { delete out[k]; return; }
      if (out[k] === '' || out[k] == null) delete out[k];
      else if (Array.isArray(out[k]) && out[k].length === 0) delete out[k];
    });
    return out;
  }

  // === Funzioni di source per select-dynamic (moduli, ecc.) ===
  function _sourcesFor(tipo) {
    if (tipo === 'procedura') return state.index.procedure.map(x => ({ id: x.slug, label: x.titolo || x.slug }));
    if (tipo === 'clinica') return state.index.clinica.map(x => ({ id: x.slug, label: x.titolo || x.slug }));
    if (tipo === 'modulo') return state.index.moduli.map(x => ({ id: x.slug, label: x.titolo || x.slug }));
    if (tipo === 'numero') {
      const out = [];
      (state.index.numeri && state.index.numeri.gruppi || []).forEach(g => {
        (g.contatti || []).forEach(c => { if (c.id) out.push({ id: c.id, label: c.etichetta || c.id }); });
      });
      return out;
    }
    if (tipo === 'moduli') return state.index.moduli.map(x => ({ id: x.slug, label: x.titolo || x.slug }));
    return [];
  }

  function _renderFieldHtml(field, value, blockIdx, fieldCtx) {
    const fv = value == null ? '' : value;
    const name = `bk-f-${blockIdx}-${field.key}`;
    const id = `bk-field-${blockIdx}-${field.key}`;
    const hint = field.hint ? `<div class="bk-field-hint">${escapeHtml(field.hint)}</div>` : '';
    const lbl = field.label ? `<label for="${id}" class="bk-field-label">${escapeHtml(field.label)}</label>` : '';

    if (field.type === 'text') {
      return `<div class="bk-field">${lbl}<input type="text" id="${id}" class="bk-input" data-field="${field.key}" value="${escapeHtml(String(fv))}" placeholder="${escapeHtml(field.placeholder || '')}">${hint}</div>`;
    }
    if (field.type === 'textarea') {
      return `<div class="bk-field">${lbl}<textarea id="${id}" class="bk-textarea" data-field="${field.key}" rows="${field.rows || 3}" placeholder="${escapeHtml(field.placeholder || '')}">${escapeHtml(String(fv))}</textarea>${hint}</div>`;
    }
    if (field.type === 'select') {
      const opts = (field.options || []).map(o => `<option value="${escapeHtml(o.value)}" ${o.value === fv ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('');
      return `<div class="bk-field">${lbl}<select id="${id}" class="bk-select" data-field="${field.key}">${opts}</select>${hint}</div>`;
    }
    if (field.type === 'select-dynamic') {
      // Risolve source dinamico in base al tipo corrente (per internal_ref) o chiave fissa (per form_ref)
      const srcKey = field.sourceKeyFrom ? fieldCtx[field.sourceKeyFrom] : field.sourceKey;
      const items = _sourcesFor(srcKey);
      const opts = '<option value="">— scegli —</option>' + items.map(it => `<option value="${escapeHtml(it.id)}" ${it.id === fv ? 'selected' : ''}>${escapeHtml(it.label)}</option>`).join('');
      return `<div class="bk-field">${lbl}<select id="${id}" class="bk-select" data-field="${field.key}" data-source="${srcKey || ''}">${opts}</select>${hint}</div>`;
    }
    if (field.type === 'string-list') {
      // Textarea dove ogni riga è un item
      const lines = Array.isArray(fv) ? fv.join('\n') : String(fv || '');
      return `<div class="bk-field">${lbl}<textarea id="${id}" class="bk-textarea bk-string-list" data-field="${field.key}" rows="4" placeholder="${escapeHtml(field.placeholder || 'una voce per riga')}">${escapeHtml(lines)}</textarea>${hint}</div>`;
    }
    if (field.type === 'table-editor') {
      return _renderTableEditor(blockIdx, fieldCtx);
    }
    if (field.type === 'codici-editor') {
      return _renderCodiciEditor(blockIdx, fieldCtx.codici || []);
    }
    return '';
  }

  function _renderTableEditor(blockIdx, ctx) {
    const headers = Array.isArray(ctx.headers) ? ctx.headers : ['Colonna 1'];
    const rows = Array.isArray(ctx.rows) ? ctx.rows : [];
    const nCols = headers.length;
    // Larghezze colonna scelte dall'utente (px). Array parallelo a headers; valore 0/assente = auto.
    const colWidths = Array.isArray(ctx.colWidths) ? ctx.colWidths : [];
    // Stato espanso/collassato per-blocco (transitorio, non salvato). Espanso = celle
    // a tutta altezza con il testo completo (textarea auto-size); collassato = compatto.
    const expanded = !!ctx._tblExpanded;
    const cellTag = (cls, attrs, val) => expanded
      ? `<textarea class="bk-input ${cls} bk-cell-area" ${attrs} rows="1" placeholder="">${escapeHtml(String(val != null ? val : ''))}</textarea>`
      : `<input type="text" class="bk-input ${cls}" ${attrs} value="${escapeHtml(String(val != null ? val : ''))}">`;

    // <colgroup>: applica le larghezze scelte (le colonne senza larghezza restano auto).
    const colGroup = `<colgroup>${headers.map((_, ci) => {
      const w = parseInt(colWidths[ci], 10);
      return `<col${w > 0 ? ` style="width:${w}px"` : ''}>`;
    }).join('')}<col class="bk-col-actions-col"></colgroup>`;

    // Riga 1 dell'header: SOLO i controlli colonna, così sono tutti allineati sulla stessa
    // riga indipendentemente dalla lunghezza del testo nell'intestazione o nelle celle.
    const ctrlCells = headers.map((h, ci) => {
      const w = parseInt(colWidths[ci], 10) || 0;
      return `<th class="bk-col-ctrl-cell">
        <div class="bk-col-ctrls">
          <button type="button" class="bk-col-btn" data-col-left="${ci}" title="Sposta colonna a sinistra" ${ci === 0 ? 'disabled' : ''}>◂</button>
          <button type="button" class="bk-col-btn" data-col-narrow="${ci}" title="Restringi colonna">−</button>
          <button type="button" class="bk-col-btn" data-col-wider="${ci}" title="Allarga colonna">+</button>
          <button type="button" class="bk-col-btn" data-col-auto="${ci}" title="Larghezza automatica" ${w ? '' : 'disabled'}>⇋</button>
          <button type="button" class="bk-col-btn bk-col-btn-del" data-col-del-at="${ci}" title="Elimina questa colonna" ${nCols <= 1 ? 'disabled' : ''}>×</button>
          <button type="button" class="bk-col-btn" data-col-right="${ci}" title="Sposta colonna a destra" ${ci === nCols - 1 ? 'disabled' : ''}>▸</button>
        </div>
      </th>`;
    }).join('');

    // Riga 2 dell'header: i campi intestazione.
    const thCells = headers.map((h, ci) =>
      `<th>${cellTag('bk-th', `data-col="${ci}" placeholder="Intestazione"`, h)}</th>`
    ).join('');

    const trRows = rows.map((row, ri) => {
      const cells = headers.map((_, ci) =>
        `<td>${cellTag('bk-td', `data-row="${ri}" data-col="${ci}"`, row[ci])}</td>`
      ).join('');
      const rowCtrls = `<td class="bk-row-actions">
        <div class="bk-row-ctrls">
          <button type="button" class="bk-row-btn" data-row-up="${ri}" title="Sposta riga su" ${ri === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="bk-row-btn" data-row-down="${ri}" title="Sposta riga giù" ${ri === rows.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" class="bk-row-btn bk-row-btn-del" data-row-del="${ri}" title="Elimina riga">×</button>
        </div>
      </td>`;
      return `<tr>${cells}${rowCtrls}</tr>`;
    }).join('');

    return `<div class="bk-field bk-table-editor ${expanded ? 'bk-table-expanded' : ''}">
      <div class="bk-table-head-row">
        <label class="bk-field-label">Tabella</label>
        <button type="button" class="bk-mini-btn bk-table-toggle" data-table-toggle title="${expanded ? 'Comprimi: celle compatte' : 'Espandi: mostra il testo completo nelle celle'}">
          ${expanded ? '⊟ Comprimi' : '⊞ Espandi'}
        </button>
      </div>
      <div class="bk-table-wrap">
        <table>
          ${colGroup}
          <thead>
            <tr class="bk-col-ctrl-row">${ctrlCells}<th class="bk-col-actions-head"></th></tr>
            <tr>${thCells}<th class="bk-col-actions-head"></th></tr>
          </thead>
          <tbody>${trRows}</tbody>
        </table>
      </div>
      <div class="bk-table-actions">
        <button type="button" class="bk-mini-btn" data-row-add>+ Aggiungi riga</button>
        <button type="button" class="bk-mini-btn" data-col-add>+ Aggiungi colonna</button>
      </div>
    </div>`;
  }

  function _renderCodiciEditor(blockIdx, codici) {
    const list = (codici && codici.length) ? codici : [{ codice: '', descrizione: '' }];
    const rows = list.map((c, ci) => `
      <div class="bk-codice-row" data-idx="${ci}">
        <input type="text" class="bk-input bk-codice-val" placeholder="es. LIQUO" value="${escapeHtml(String(c.codice || ''))}">
        <input type="text" class="bk-input bk-codice-desc" placeholder="es. Chimico-fisico" value="${escapeHtml(String(c.descrizione || ''))}">
        <button type="button" class="bk-mini-btn" data-codice-del="${ci}" title="Rimuovi">×</button>
      </div>
    `).join('');
    return `<div class="bk-field bk-codici-editor">
      <label class="bk-field-label">Codici</label>
      <div class="bk-codici-list">${rows}</div>
      <button type="button" class="bk-mini-btn" data-codice-add>+ Aggiungi codice</button>
    </div>`;
  }

  // Costruisce un blocco DOM per un blocco dati
  function _renderBlock(b, idx) {
    const def = TIPI[b.tipo];
    if (!def) {
      return `<div class="bk-item bk-item-unknown" data-bk-idx="${idx}" data-bk-tipo="${escapeHtml(b.tipo)}">
        <div class="bk-item-head"><span class="bk-item-type">Tipo sconosciuto: ${escapeHtml(b.tipo)}</span></div>
      </div>`;
    }
    const fieldsHtml = def.fields.map(f => _renderFieldHtml(f, b[f.key], idx, b)).join('');
    return `<div class="bk-item" data-bk-idx="${idx}" data-bk-tipo="${escapeHtml(b.tipo)}">
      <div class="bk-item-head">
        <span class="bk-item-icon">${def.icon}</span>
        <span class="bk-item-type">${escapeHtml(def.label)}</span>
        <div class="bk-item-actions">
          <button type="button" class="bk-mini-btn" data-move-up title="Sposta su">↑</button>
          <button type="button" class="bk-mini-btn" data-move-down title="Sposta giù">↓</button>
          <button type="button" class="bk-mini-btn bk-mini-btn-danger" data-delete title="Elimina blocco">×</button>
        </div>
      </div>
      <div class="bk-item-body">${fieldsHtml}</div>
    </div>`;
  }

  function _renderAddMenu() {
    const btns = Object.keys(TIPI).map(t => {
      const def = TIPI[t];
      return `<button type="button" class="bk-add-option" data-add-type="${t}">
        <span class="bk-add-icon">${def.icon}</span>
        <span class="bk-add-label">
          <strong>${escapeHtml(def.label)}</strong>
          <span class="bk-add-desc">${escapeHtml(def.descrizione)}</span>
        </span>
      </button>`;
    }).join('');
    return `<details class="bk-add-menu">
      <summary class="bk-add-summary">+ Aggiungi blocco</summary>
      <div class="bk-add-options">${btns}</div>
    </details>`;
  }

  function _fullRender() {
    if (!_root) return;
    const blocksHtml = _blocks.map((b, i) => _renderBlock(b, i)).join('');
    _root.innerHTML = `
      <div class="bk-list">${blocksHtml || '<div class="bk-empty">Nessun blocco. Usa il pulsante qui sotto per iniziare.</div>'}</div>
      ${_renderAddMenu()}
    `;
    _attachEvents();
  }

  function _markDirty() {
    if (state.editingContext) state.editingContext.isDirty = true;
  }

  function _attachEvents() {
    if (!_root) return;

    // Input generici: rileggono valore nel blocco e marcano dirty
    _root.querySelectorAll('.bk-item input[data-field], .bk-item select[data-field], .bk-item textarea[data-field]').forEach(el => {
      el.addEventListener('input', () => {
        const item = el.closest('.bk-item');
        if (!item) return;
        const idx = parseInt(item.dataset.bkIdx, 10);
        const key = el.dataset.field;
        const b = _blocks[idx];
        if (!b) return;
        if (el.classList.contains('bk-string-list')) {
          b[key] = el.value.split('\n').map(s => s.trim()).filter(Boolean);
        } else {
          b[key] = el.value;
        }
        _markDirty();
        _pushHistoryDebounced();
        // Se è cambiato target_tipo in internal_ref, rigenera il secondo select
        if (b.tipo === 'internal_ref' && key === 'target_tipo') {
          b.target = '';
          _pushHistory();
          _fullRender();
        }
      });
    });

    // Table editor: input su th/td + bottoni riga/colonna
    _root.querySelectorAll('.bk-table-editor').forEach(tblEl => {
      const item = tblEl.closest('.bk-item');
      const idx = parseInt(item.dataset.bkIdx, 10);
      const b = _blocks[idx];
      if (!b) return;

      // Auto-resize delle textarea in modalità espansa (altezza = contenuto).
      const autoSize = (ta) => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
      tblEl.querySelectorAll('.bk-cell-area').forEach(autoSize);

      // Input intestazioni (input o textarea a seconda di espanso/collassato)
      tblEl.querySelectorAll('.bk-th').forEach(inp => {
        inp.addEventListener('input', () => {
          const ci = parseInt(inp.dataset.col, 10);
          if (!Array.isArray(b.headers)) b.headers = [];
          b.headers[ci] = inp.value;
          if (inp.classList.contains('bk-cell-area')) autoSize(inp);
          _markDirty();
          _pushHistoryDebounced();
        });
      });
      tblEl.querySelectorAll('.bk-td').forEach(inp => {
        inp.addEventListener('input', () => {
          const ri = parseInt(inp.dataset.row, 10);
          const ci = parseInt(inp.dataset.col, 10);
          if (!Array.isArray(b.rows)) b.rows = [];
          if (!Array.isArray(b.rows[ri])) b.rows[ri] = [];
          b.rows[ri][ci] = inp.value;
          if (inp.classList.contains('bk-cell-area')) autoSize(inp);
          _markDirty();
          _pushHistoryDebounced();
        });
      });

      // Toggle espandi/comprimi (stato transitorio, conservato nel blocco)
      const btnToggle = tblEl.querySelector('[data-table-toggle]');
      if (btnToggle) btnToggle.onclick = () => {
        b._tblExpanded = !b._tblExpanded;
        _fullRender(); // non tocca la history: è solo una preferenza di visualizzazione
      };

      const btnRowAdd = tblEl.querySelector('[data-row-add]');
      if (btnRowAdd) btnRowAdd.onclick = () => {
        if (!Array.isArray(b.rows)) b.rows = [];
        b.rows.push(new Array((b.headers || []).length).fill(''));
        _markDirty(); _pushHistory(); _fullRender();
      };
      const btnColAdd = tblEl.querySelector('[data-col-add]');
      if (btnColAdd) btnColAdd.onclick = () => {
        if (!Array.isArray(b.headers)) b.headers = [];
        b.headers.push(`Colonna ${b.headers.length + 1}`);
        (b.rows || []).forEach(r => r.push(''));
        if (Array.isArray(b.colWidths)) b.colWidths.push(0);
        _markDirty(); _pushHistory(); _fullRender();
      };

      // Elimina una colonna SPECIFICA (dal pulsante × sulla sua intestazione)
      tblEl.querySelectorAll('[data-col-del-at]').forEach(btn => {
        btn.onclick = () => {
          const ci = parseInt(btn.dataset.colDelAt, 10);
          if (!Array.isArray(b.headers) || b.headers.length <= 1) return;
          const nome = (b.headers[ci] || '').trim();
          if (!confirm(`Eliminare la colonna${nome ? ' "' + nome + '"' : ''}?`)) return;
          b.headers.splice(ci, 1);
          (b.rows || []).forEach(r => { if (Array.isArray(r)) r.splice(ci, 1); });
          if (Array.isArray(b.colWidths)) b.colWidths.splice(ci, 1);
          _markDirty(); _pushHistory(); _fullRender();
        };
      });

      // Sposta colonna a sinistra / destra (scambio con l'adiacente)
      const moveCol = (ci, dir) => {
        const cj = ci + dir;
        if (!Array.isArray(b.headers) || cj < 0 || cj >= b.headers.length) return;
        const swap = (arr) => { if (!Array.isArray(arr)) return; const t = arr[ci]; arr[ci] = arr[cj]; arr[cj] = t; };
        swap(b.headers);
        (b.rows || []).forEach(r => { if (Array.isArray(r)) swap(r); });
        swap(b.colWidths); // mantengo le larghezze allineate alle colonne
        _markDirty(); _pushHistory(); _fullRender();
      };
      tblEl.querySelectorAll('[data-col-left]').forEach(btn => {
        btn.onclick = () => moveCol(parseInt(btn.dataset.colLeft, 10), -1);
      });
      tblEl.querySelectorAll('[data-col-right]').forEach(btn => {
        btn.onclick = () => moveCol(parseInt(btn.dataset.colRight, 10), 1);
      });

      // Larghezza colonna: restringi / allarga (step 40px, range 60–600) / auto.
      const STEP = 40, MINW = 60, MAXW = 600, DEFW = 160;
      const setColWidth = (ci, val) => {
        if (!Array.isArray(b.colWidths)) b.colWidths = [];
        // Assicuro la lunghezza dell'array fino a ci
        while (b.colWidths.length < b.headers.length) b.colWidths.push(0);
        b.colWidths[ci] = val;
        _markDirty(); _pushHistory(); _fullRender();
      };
      tblEl.querySelectorAll('[data-col-wider]').forEach(btn => {
        btn.onclick = () => {
          const ci = parseInt(btn.dataset.colWider, 10);
          const cur = parseInt((b.colWidths || [])[ci], 10) || DEFW;
          setColWidth(ci, Math.min(MAXW, cur + STEP));
        };
      });
      tblEl.querySelectorAll('[data-col-narrow]').forEach(btn => {
        btn.onclick = () => {
          const ci = parseInt(btn.dataset.colNarrow, 10);
          const cur = parseInt((b.colWidths || [])[ci], 10) || DEFW;
          setColWidth(ci, Math.max(MINW, cur - STEP));
        };
      });
      tblEl.querySelectorAll('[data-col-auto]').forEach(btn => {
        btn.onclick = () => setColWidth(parseInt(btn.dataset.colAuto, 10), 0);
      });

      // Sposta riga su / giù (scambio con l'adiacente)
      const moveRow = (ri, dir) => {
        const rj = ri + dir;
        if (!Array.isArray(b.rows) || rj < 0 || rj >= b.rows.length) return;
        const t = b.rows[ri]; b.rows[ri] = b.rows[rj]; b.rows[rj] = t;
        _markDirty(); _pushHistory(); _fullRender();
      };
      tblEl.querySelectorAll('[data-row-up]').forEach(btn => {
        btn.onclick = () => moveRow(parseInt(btn.dataset.rowUp, 10), -1);
      });
      tblEl.querySelectorAll('[data-row-down]').forEach(btn => {
        btn.onclick = () => moveRow(parseInt(btn.dataset.rowDown, 10), 1);
      });

      tblEl.querySelectorAll('[data-row-del]').forEach(btn => {
        btn.onclick = () => {
          const ri = parseInt(btn.dataset.rowDel, 10);
          if (Array.isArray(b.rows) && ri >= 0 && ri < b.rows.length) {
            b.rows.splice(ri, 1);
            _markDirty(); _pushHistory(); _fullRender();
          }
        };
      });
    });

    // Codici editor (system_code)
    _root.querySelectorAll('.bk-codici-editor').forEach(codEl => {
      const item = codEl.closest('.bk-item');
      const idx = parseInt(item.dataset.bkIdx, 10);
      const b = _blocks[idx];
      if (!b) return;
      if (!Array.isArray(b.codici)) b.codici = [{ codice: '', descrizione: '' }];

      codEl.querySelectorAll('.bk-codice-row').forEach(rowEl => {
        const ci = parseInt(rowEl.dataset.idx, 10);
        rowEl.querySelector('.bk-codice-val').addEventListener('input', (e) => {
          if (!b.codici[ci]) b.codici[ci] = { codice: '', descrizione: '' };
          b.codici[ci].codice = e.target.value;
          _markDirty();
        });
        rowEl.querySelector('.bk-codice-desc').addEventListener('input', (e) => {
          if (!b.codici[ci]) b.codici[ci] = { codice: '', descrizione: '' };
          b.codici[ci].descrizione = e.target.value;
          _markDirty();
        });
      });
      codEl.querySelectorAll('[data-codice-del]').forEach(btn => {
        btn.onclick = () => {
          const ci = parseInt(btn.dataset.codiceDel, 10);
          if (b.codici.length > 1) b.codici.splice(ci, 1);
          else b.codici[0] = { codice: '', descrizione: '' };
          _markDirty(); _pushHistory(); _fullRender();
        };
      });
      const btnAdd = codEl.querySelector('[data-codice-add]');
      if (btnAdd) btnAdd.onclick = () => {
        b.codici.push({ codice: '', descrizione: '' });
        _markDirty(); _pushHistory(); _fullRender();
      };
    });

    // Azioni blocco: sposta su/giù, elimina
    _root.querySelectorAll('.bk-item').forEach(item => {
      const idx = parseInt(item.dataset.bkIdx, 10);
      const upBtn = item.querySelector('[data-move-up]');
      const dnBtn = item.querySelector('[data-move-down]');
      const delBtn = item.querySelector('[data-delete]');
      if (upBtn) upBtn.onclick = () => {
        if (idx <= 0) return;
        const tmp = _blocks[idx]; _blocks[idx] = _blocks[idx - 1]; _blocks[idx - 1] = tmp;
        _markDirty(); _pushHistory(); _fullRender();
      };
      if (dnBtn) dnBtn.onclick = () => {
        if (idx >= _blocks.length - 1) return;
        const tmp = _blocks[idx]; _blocks[idx] = _blocks[idx + 1]; _blocks[idx + 1] = tmp;
        _markDirty(); _pushHistory(); _fullRender();
      };
      if (delBtn) delBtn.onclick = () => {
        if (!confirm('Eliminare questo blocco?')) return;
        _blocks.splice(idx, 1);
        _markDirty(); _pushHistory(); _fullRender();
      };
    });

    // Aggiungi blocco
    _root.querySelectorAll('[data-add-type]').forEach(btn => {
      btn.onclick = () => {
        const t = btn.dataset.addType;
        const def = TIPI[t];
        if (!def) return;
        // Clone profondo dei defaults per evitare condivisione di riferimenti
        const newB = { tipo: t, ...JSON.parse(JSON.stringify(def.defaults)) };
        _blocks.push(newB);
        _markDirty();
        _pushHistory();
        _fullRender();
        // Chiude il menu aperto
        const menu = _root.querySelector('.bk-add-menu');
        if (menu) menu.removeAttribute('open');
        // Scroll al nuovo blocco
        setTimeout(() => {
          const items = _root.querySelectorAll('.bk-item');
          const last = items[items.length - 1];
          if (last) last.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 50);
      };
    });
  }

  // === API pubblica ===
  return {
    render(container, contenuti) {
      _root = container;
      // Copia profonda dei blocchi iniziali (per non mutare il frontmatter originale)
      _blocks = Array.isArray(contenuti) ? JSON.parse(JSON.stringify(contenuti)) : [];
      _fullRender();
      _resetHistory();
    },
    getBlocks() {
      // Rilettura finale: ripulisce campi vuoti e normalizza
      return _blocks.map(b => _normalizeBlock(b));
    },
    hasBlocks() { return _blocks.length > 0; },
    // Undo/redo: ripristina lo snapshot precedente/successivo.
    undo() {
      if (_snapTimer) { clearTimeout(_snapTimer); _snapTimer = null; _pushHistory(); }
      if (_histPos > 0) { _histPos--; _restore(_history[_histPos]); _markDirty(); }
    },
    redo() {
      if (_histPos < _history.length - 1) { _histPos++; _restore(_history[_histPos]); _markDirty(); }
    },
    canUndo() { return _histPos > 0; },
    canRedo() { return _histPos < _history.length - 1; },
    // Callback invocata a ogni cambiamento di stato (per aggiornare i pulsanti undo/redo).
    setOnChange(fn) { _onChange = fn; },
    // Esposto solo per test
    _tipi: TIPI
  };
})();

function renderEditorUI(slug, frontmatter, body) {
  const moduliOpts = state.index.moduli.map(m => m.slug);
  const proceduraOpts = state.index.procedure.map(p => p.slug).filter(s => s !== slug);

  $('main-content').innerHTML = `
    <div class="editor-head">
      <div class="editor-head-main">
        <div class="editor-head-sub">Modifica — ${escapeHtml(slug)}.md</div>
      </div>
      <div class="editor-head-actions">
        <span class="editor-head-undo">
          <button class="btn ghost" id="btn-undo-edit" title="Annulla ultima modifica (Ctrl+Z)" disabled>↶</button>
          <button class="btn ghost" id="btn-redo-edit" title="Ripeti (Ctrl+Y)" disabled>↷</button>
        </span>
        <button class="btn ghost" id="btn-cancel-edit">Annulla</button>
        <button class="btn" id="btn-save-edit">Salva</button>
      </div>
    </div>
    <div class="editor-head-spacer"></div>

    <div class="editor-section">
      <div class="editor-section-head"><div class="editor-section-title">Metadati</div></div>
      <div class="editor-section-body">
        <div class="meta-grid">
          <div class="field">
            <label for="meta-titolo">Titolo</label>
            <input type="text" id="meta-titolo" value="${escapeHtml(frontmatter.titolo || '')}">
          </div>
          <div class="field">
            <label for="meta-categoria">Categoria</label>
            <select id="meta-categoria">
              ${['bedside','richieste','farmacologiche','emergenze','gestione'].map(k =>
                `<option value="${k}" ${frontmatter.categoria === k ? 'selected' : ''}>${escapeHtml(CATEGORIA_LABELS[k] || k)}</option>`
              ).join('')}
            </select>
          </div>
          <div class="field" style="grid-column:1/-1;">
            <label>Sottocategoria</label>
            ${renderChipsField({
              id: 'meta-sottocategoria-chips',
              values: frontmatter.sottocategoria ? [frontmatter.sottocategoria] : [],
              suggestions: [],
              placeholder: 'cerca o crea una sottocategoria…',
              allowNew: true
            })}
            <div style="font-size:11px;color:var(--ink-muted);margin-top:4px;">Una sola sottocategoria. Le opzioni dipendono dalla Categoria scelta.</div>
          </div>
          <div class="field" style="grid-column:1/-1;">
            <label>Tag</label>
            ${renderChipsField({
              id: 'meta-tag-chips',
              values: frontmatter.tag || [],
              suggestions: collectAllTags(),
              placeholder: 'cerca o crea tag…',
              allowNew: true
            })}
          </div>
          <div class="field" style="grid-column:1/-1;">
            <label>Termini equivalenti / sinonimi</label>
            ${renderChipsField({
              id: 'meta-termini-chips',
              values: frontmatter.termini_equivalenti || [],
              suggestions: collectAllTermini(),
              placeholder: 'cerca o crea sinonimo…',
              allowNew: true
            })}
          </div>
          <div class="field" style="grid-column:1/-1;">
            <label for="meta-note-modifica">Nota breve su questa modifica (appare in cronologia)</label>
            <input type="text" id="meta-note-modifica" placeholder="es. aggiornato numero lab neurologia">
          </div>
        </div>
      </div>
    </div>

    <div class="editor-section">
      <div class="editor-section-head"><div class="editor-section-title">Relazioni</div></div>
      <div class="editor-section-body">
        <div class="meta-grid">
          <div class="field" style="grid-column:1/-1;">
            <label>Procedure correlate</label>
            ${renderChipsField({
              id: 'meta-procedure-chips',
              values: frontmatter.procedure_correlate || [],
              suggestions: state.index.procedure.filter(p => p.slug !== slug).map(p => ({ id: p.slug, label: p.titolo || p.slug })),
              placeholder: 'cerca procedure…',
              allowNew: false
            })}
          </div>
          <div class="field" style="grid-column:1/-1;">
            <label>Moduli correlati</label>
            ${renderChipsField({
              id: 'meta-moduli-chips',
              values: frontmatter.moduli_correlati || [],
              suggestions: state.index.moduli.map(m => ({ id: m.slug, label: m.titolo || m.slug })),
              placeholder: 'cerca moduli…',
              allowNew: false
            })}
          </div>
          <div class="field" style="grid-column:1/-1;">
            <label>Numeri correlati</label>
            ${renderNumeriCorrelatiPicker(frontmatter.numeri_correlati || [])}
          </div>
        </div>
      </div>
    </div>

    <div class="editor-section">
      <div class="editor-section-head" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <div class="editor-section-title">Contenuto</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <button type="button" class="btn ghost sm" id="btn-ai-import-proc" title="Importa una procedura da testo grezzo con l'aiuto di un'AI esterna">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2L9 9l-7 1 5 5-1 7 6-3 6 3-1-7 5-5-7-1z"/></svg>
            <span style="margin-left:4px;">Importa con AI</span>
          </button>
        </div>
      </div>
      <div id="editor-wrapper"></div>
    </div>`;

  // Tutte le schede usano il block editor. Se manca `contenuti` array (file legacy),
  // mostro avviso e inizializzo array vuoto.
  const contenuti = Array.isArray(frontmatter.contenuti) ? frontmatter.contenuti : [];
  if (!Array.isArray(frontmatter.contenuti) && body && body.trim()) {
    toast('Schema legacy rilevato: il body markdown è stato rimosso. Ricostruisci il contenuto con il block editor.', 'warning', 8000);
    console.warn('[renderEditorUI] frontmatter senza `contenuti` array per', slug, '— body markdown ignorato');
  }
  blockEditor.render($('editor-wrapper'), contenuti);
  state.editingContext._usesBlockEditor = true;

  // Initialize chips fields
  function refreshSottocategorieChips() {
    const cat = $('meta-categoria').value;
    const c = document.getElementById('meta-sottocategoria-chips');
    if (c) c._suggestions = buildSottocategorieForCategoria(cat);
  }
  chipsInit('meta-sottocategoria-chips', buildSottocategorieForCategoria(frontmatter.categoria || 'bedside'));
  chipsInit('meta-tag-chips', collectAllTags());
  chipsInit('meta-termini-chips', collectAllTermini());
  chipsInit('meta-procedure-chips', state.index.procedure.filter(p => p.slug !== slug).map(p => ({ id: p.slug, label: p.titolo || p.slug })));
  chipsInit('meta-moduli-chips', state.index.moduli.map(m => ({ id: m.slug, label: m.titolo || m.slug })));
  initNumeriCorrelatiPicker();

  $('meta-categoria').addEventListener('change', refreshSottocategorieChips);

  ['meta-titolo','meta-categoria','meta-note-modifica'].forEach(id => {
    const el = $(id); if (el) el.addEventListener('input', () => { if (state.editingContext) state.editingContext.isDirty = true; });
  });

  $('btn-cancel-edit').onclick = () => {
    if (state.editingContext.isDirty && !confirm('Annullare le modifiche non salvate?')) return;
    if (state.editingContext.hasLock) locks.release(state.editingContext.slug).catch(() => {});
    state.editingContext = null;
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    navigate('procedura', { slug });
  };
  $('btn-save-edit').onclick = function () { runWithSpinner(this, saveProcedura); };
  _wireBlockEditorUndoRedo();
  // AI Import workflow: bottone opzionale per popolare i blocchi a partire da
  // testo grezzo, tramite un'AI esterna.
  const btnAi = $('btn-ai-import-proc');
  if (btnAi) btnAi.onclick = () => openAIImportModal('procedura');
}

/* ============================ AI IMPORT WORKFLOW ============================
   Permette di popolare l'editor a blocchi a partire da testo grezzo,
   tramite un'AI esterna (ChatGPT, Claude, Gemini, ecc.).
   Workflow a 3 step:
   1) L'utente incolla testo grezzo (es. linee guida copiate da PDF/web)
   2) L'app mostra un prompt completo da copiare in un'AI esterna
   3) L'utente incolla il JSON ottenuto, l'app valida e popola i blocchi.
*/
// Template prompt per import AI di schede cliniche/procedure: descrizione dei tipi di blocco
// + schema JSON. Estratto come costante a livello di modulo per leggibilità (era inline nel
// modal, ~70 righe di string literal in mezzo alla logica UI).
// Usa il placeholder __INSERT_TESTO__ per inserire il testo dell'utente.
// Schema frontmatter per ogni tipo di scheda. Usato sia dall'editor sia dal prompt AI Import
// per dire all'AI esterna quali campi può/deve compilare. NB: l'AI suggerisce i valori; il
// medico li può sempre rivedere/modificare prima di salvare.
const AI_FRONTMATTER_SCHEMA = {
  procedura: {
    titolo: 'Stringa breve, descrittiva, in italiano. Es: "Rachicentesi diagnostica".',
    categoria: 'Una tra: bedside, richieste, farmacologiche, emergenze, gestione.',
    sottocategoria: 'Stringa libera, una parola/breve frase. Es: "esami liquor", "ictus", "delirium".',
    tag: 'Array di stringhe (parole chiave, lowercase). Es: ["liquor","puntura lombare","diagnostica"].',
    termini_equivalenti: 'Array di sinonimi/forme alternative usate dai clinici per cercare la procedura. Es: ["puntura lombare","LP","tap lombare"].'
  },
  clinica: {
    titolo: 'Stringa breve, descrittiva. Es: "Score NIHSS" o "Prognosi ictus ischemico".',
    sottocategoria: 'Una tra: prognosi, gestione-post-acuta, scale-cliniche.',
    tag: 'Array di stringhe (parole chiave, lowercase). Es: ["ictus","scala","emergenza"].',
    termini_equivalenti: 'Array di sinonimi. Es: ["NIH stroke scale","scala NIH"].'
  }
};

// Genera il prompt completo per l'AI esterna. Include: descrizione tipi blocco, schema
// frontmatter del tipo scheda, opzionalmente l'istruzione di riassunto, e il testo grezzo.
function buildAIImportPrompt(tipo, rawText, opts) {
  opts = opts || {};
  const riassumi = !!opts.riassumi;
  const fmSchema = AI_FRONTMATTER_SCHEMA[tipo] || AI_FRONTMATTER_SCHEMA.procedura;
  const fmFields = Object.entries(fmSchema).map(([k, v]) => `  - "${k}": ${v}`).join('\n');
  const fmExample = tipo === 'clinica'
    ? `{"titolo":"Score NIHSS","sottocategoria":"scale-cliniche","tag":["ictus","scala"],"termini_equivalenti":["NIH stroke scale","scala NIH"]}`
    : `{"titolo":"Rachicentesi diagnostica","categoria":"bedside","sottocategoria":"esami liquor","tag":["liquor","puntura lombare"],"termini_equivalenti":["puntura lombare","LP"]}`;

  const riassuntoSection = riassumi
    ? `MODALITÀ RIASSUNTO ATTIVA:
- Se il testo originale è prolisso, ridondante o contiene divagazioni, RIASSUMI mantenendo l'essenziale clinico.
- Privilegia chiarezza e concisione: rimuovi ripetizioni, riformula frasi pesanti.
- NON omettere informazioni cliniche rilevanti (dosaggi, controindicazioni, criteri, codici).
- Mantieni invariati: numeri, dosaggi, codici di sistemi (Galileo, Ormaweb), nomi di farmaci/strumenti, riferimenti bibliografici.

`
    : `FEDELTÀ AL TESTO:
- NON riassumere e NON inventare contenuti che non sono nel testo originale.
- Riproduci tutto ciò che è clinicamente rilevante.

`;

  return `Sei un assistente che converte testo medico/clinico in un JSON strutturato per un'app di documentazione clinica.

L'output deve essere ESCLUSIVAMENTE un oggetto JSON con due campi: "frontmatter" e "contenuti". Nessun testo prima o dopo, nessun markdown code fence (no triple backticks), solo JSON puro che inizi con { e finisca con }.

STRUTTURA OUTPUT:
{
  "frontmatter": { ... },   // metadati della scheda (vedi sotto)
  "contenuti": [ ... ]       // array di blocchi (vedi sotto)
}

CAMPI FRONTMATTER (per scheda di tipo "${tipo}"):
${fmFields}

Esempio frontmatter valido:
${fmExample}

L'utente potrà modificare i metadati dopo l'import: scegli valori sensati, non inventare se non hai segnali nel testo (in quel caso lascia il campo come stringa vuota o array vuoto).

TIPI DI BLOCCO DISPONIBILI per "contenuti":

1. text — paragrafo di testo. Supporta **grassetto**, *corsivo*, codice inline (con singole virgolette gravi).
 Campi: { tipo:"text", titolo?:string, testo:string }

2. list — elenco puntato.
 Campi: { tipo:"list", titolo?:string, items:string[] }

3. checklist — lista di voci da spuntare (controlli, requisiti, step da completare).
 Campi: { tipo:"checklist", titolo?:string, items:string[] }

4. callout — riquadro di avviso/attenzione/info/successo.
 Campi: { tipo:"callout", titolo?:string, variante:"warning"|"info"|"danger"|"success", testo:string }

5. table — tabella con headers e righe.
 Campi: { tipo:"table", titolo?:string, headers:string[], rows:string[][] }

6. image — riferimento a un'immagine (NON inserire questo blocco a meno che non sia esplicitamente menzionato nel testo originale con un percorso o nome file).
 Campi: { tipo:"image", src:string, alt?:string, caption?:string, descrizione?:string }

7. system_code — codici da inserire in sistemi gestionali (es. Galileo, Ormaweb).
 Campi: { tipo:"system_code", titolo?:string, sistema:"Galileo"|"Ormaweb"|"Altro", percorso?:string, codici:[{codice:string, descrizione:string}], note?:string }

8. link — link esterno (paper, linee guida, sito).
 Campi: { tipo:"link", titolo?:string, url:string, label?:string, fonte?:string, data_accesso?:string }

9. clinical_note — template di nota clinica (testo che il medico copierà nella cartella).
 Campi: { tipo:"clinical_note", titolo?:string, testo:string }

10. form_ref — riferimento a un modulo dell'app (NON usare a meno che non sia esplicitamente menzionato).
  Campi: { tipo:"form_ref", label:string, modulo:string }

11. internal_ref — riferimento a un'altra procedura/scheda dell'app (NON usare a meno che non sia esplicitamente menzionato).
  Campi: { tipo:"internal_ref", label:string, target_tipo:"procedura"|"clinica"|"modulo", target:string }

LINEE GUIDA CONTENUTI:
- Mantieni la lingua del testo originale (italiano se il testo è in italiano).
- Spezza il contenuto in blocchi logici: ogni sezione importante è un blocco a sé.
- Per controlli pre-procedura, criteri, checklist usa "checklist".
- Per avvisi/attenzioni usa "callout" con variante:"warning" o "danger".
- Per informazioni di contesto/contesto utile usa "callout" con variante:"info".
- Per elenchi semplici (indicazioni, controindicazioni, materiali) usa "list".
- Le tabelle presenti nel testo vanno SEMPRE preservate come blocco "table", con TUTTE le righe e le colonne dell'originale (anche tabelle larghe, multi-colonna): non spezzarle e non riassumerle. Se le celle contengono codici di sistema (Galileo, Ormaweb, ecc.), lasciali come testo dentro la cella — NON estrarli in blocchi separati.
- Usa "system_code" SOLO per codici di sistemi gestionali che nel testo compaiono isolati, FUORI da una tabella (es. un singolo "SR MEDICINA → ESAME LIQUOR" citato in un paragrafo o in un elenco). Se invece il codice fa parte di una tabella, resta nella tabella.
- I template di refertazione/nota di diario vanno in "clinical_note".
- NON usare image/form_ref/internal_ref a meno che non siano esplicitamente menzionati nel testo.
- Se il testo originale contiene URL, usa il blocco "link".

${riassuntoSection}ESEMPIO DI OUTPUT VALIDO:
{
  "frontmatter": ${fmExample},
  "contenuti": [
    {"tipo":"callout","variante":"warning","titolo":"Prima di procedere","testo":"Verificare allergie e terapie in corso."},
    {"tipo":"checklist","titolo":"Controlli pre-procedura","items":["INR < 1.5","Piastrine > 50.000","Consenso firmato"]},
    {"tipo":"text","testo":"La procedura va eseguita in posizione laterale o seduta."},
    {"tipo":"list","titolo":"Materiale necessario","items":["Ago atraumatico 22G","Provette per liquor x4","Antisettico"]}
  ]
}

TESTO DA CONVERTIRE:
---
${rawText}
---

Restituisci SOLO l'oggetto JSON, niente altro.`;
}

function openAIImportModal(tipo) {
  // Costruisco il prompt al volo: descrizione dei tipi di blocco + schema JSON.
  // Questa è la "knowledge base" che l'AI esterna riceve, identica a quella usata
  // dall'editor a blocchi nell'app.
  // tipo: 'procedura' | 'clinica' — determina lo schema frontmatter incluso nel prompt
  //                                  e i campi che verranno popolati al passo Importa.

  let step = 1;
  let rawText = '';
  let riassumi = false;
  let aiJson = '';

  function renderStep() {
    if (step === 1) {
      return `
        <div style="display:flex;gap:8px;margin-bottom:16px;">
          <span class="ai-step ai-step-active">1. Testo</span>
          <span class="ai-step">2. Prompt AI</span>
          <span class="ai-step">3. JSON</span>
        </div>
        <p style="margin:0 0 12px;font-size:13px;color:var(--ink-soft);line-height:1.5;">
          Incolla qui il testo grezzo della ${tipo === 'clinica' ? 'scheda clinica' : 'procedura'} (es. copiato da un PDF, da una linea guida, da un altro documento).
          Al passo successivo riceverai un prompt da incollare in un'AI esterna (ChatGPT, Claude, Gemini), che lo convertirà in JSON strutturato.
        </p>
        <div class="field">
          <label>Testo grezzo</label>
          <textarea id="ai-import-raw" rows="12" placeholder="Incolla qui il testo della ${tipo === 'clinica' ? 'scheda' : 'procedura'}..." style="font-family:var(--mono);font-size:13px;line-height:1.5;">${escapeHtml(rawText)}</textarea>
        </div>
        <label style="display:flex;align-items:flex-start;gap:8px;margin-top:12px;font-size:13px;line-height:1.4;cursor:pointer;color:var(--ink-soft);">
          <input type="checkbox" id="ai-import-riassumi" ${riassumi ? 'checked' : ''} style="margin-top:2px;flex-shrink:0;">
          <span><strong>Riassumi se il testo è prolisso o ridondante.</strong><br>
          <span style="color:var(--ink-muted);font-size:12px;">L'AI manterrà l'essenziale clinico (dosaggi, codici, criteri) ma potrà accorciare frasi pesanti e rimuovere ripetizioni. Lascia disattivato se il testo è già conciso.</span></span>
        </label>`;
    }
    if (step === 2) {
      const fullPrompt = buildAIImportPrompt(tipo, rawText, { riassumi });
      return `
        <div style="display:flex;gap:8px;margin-bottom:16px;">
          <span class="ai-step ai-step-done">1. Testo ✓</span>
          <span class="ai-step ai-step-active">2. Prompt AI</span>
          <span class="ai-step">3. JSON</span>
        </div>
        <p style="margin:0 0 12px;font-size:13px;color:var(--ink-soft);line-height:1.5;">
          <strong>1.</strong> Copia il prompt qui sotto. <strong>2.</strong> Incollalo in <strong>ChatGPT</strong>, <strong>Claude</strong> o <strong>Gemini</strong>. <strong>3.</strong> Copia la risposta JSON che riceverai e incollala al passo successivo.
        </p>
        ${riassumi ? '<p style="margin:0 0 8px;font-size:12px;color:var(--accent);"><strong>Modalità riassunto attiva</strong> — l\'AI accorcerà il testo se prolisso.</p>' : ''}
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-bottom:6px;">
          <button type="button" class="btn ghost sm" id="ai-copy-prompt">📋 Copia prompt</button>
        </div>
        <textarea id="ai-import-prompt" rows="12" readonly style="font-family:var(--mono);font-size:11px;line-height:1.4;background:var(--bg-sink);">${escapeHtml(fullPrompt)}</textarea>`;
    }
    if (step === 3) {
      return `
        <div style="display:flex;gap:8px;margin-bottom:16px;">
          <span class="ai-step ai-step-done">1. Testo ✓</span>
          <span class="ai-step ai-step-done">2. Prompt AI ✓</span>
          <span class="ai-step ai-step-active">3. JSON</span>
        </div>
        <p style="margin:0 0 12px;font-size:13px;color:var(--ink-soft);line-height:1.5;">
          Incolla qui il <strong>JSON</strong> ricevuto dall'AI. Deve essere un oggetto con campi <code>frontmatter</code> e <code>contenuti</code>, racchiuso tra <code>{</code> e <code>}</code>.
        </p>
        <div class="field">
          <label>JSON dall'AI</label>
          <textarea id="ai-import-json" rows="12" placeholder='{"frontmatter":{...},"contenuti":[...]}' style="font-family:var(--mono);font-size:12px;line-height:1.4;">${escapeHtml(aiJson)}</textarea>
        </div>
        <div id="ai-import-error" style="display:none;color:var(--danger);font-size:12px;margin-top:8px;padding:8px 10px;background:var(--danger-soft);border-radius:2px;"></div>
        <p style="margin:8px 0 0;font-size:12px;color:var(--ink-muted);line-height:1.4;">
          I metadati (titolo, tag, ecc.) verranno pre-compilati dall'AI nei campi sopra: potrai modificarli prima di salvare.
        </p>`;
    }
  }

  function actionsForStep() {
    if (step === 1) {
      return [
        { label: 'Annulla', variant: 'ghost', onClick: () => closeModal() },
        { label: 'Avanti →', onClick: () => {
            const v = ($('ai-import-raw').value || '').trim();
            if (!v) { toast('Incolla del testo prima di continuare', 'error'); return; }
            rawText = v;
            const cb = $('ai-import-riassumi');
            riassumi = !!(cb && cb.checked);
            step = 2;
            rerenderModal();
          }
        }
      ];
    }
    if (step === 2) {
      return [
        { label: '← Indietro', variant: 'ghost', onClick: () => { step = 1; rerenderModal(); } },
        { label: 'Avanti →', onClick: () => { step = 3; rerenderModal(); } }
      ];
    }
    if (step === 3) {
      return [
        { label: '← Indietro', variant: 'ghost', onClick: () => { step = 2; rerenderModal(); } },
        { label: 'Importa nei blocchi', onClick: () => {
            const txt = ($('ai-import-json').value || '').trim();
            if (!txt) { showAiError('Incolla il JSON ricevuto dall\'AI'); return; }
            aiJson = txt;
            // Ripulisci eventuali code fence (alcune AI li aggiungono nonostante il prompt)
            let cleaned = txt.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
            let parsed;
            try { parsed = JSON.parse(cleaned); }
            catch (e) { showAiError('JSON non valido: ' + e.message); return; }
            // Accetta sia il NUOVO schema {frontmatter, contenuti} sia il VECCHIO (array di blocchi
            // diretto) per retrocompatibilità con prompt precedenti che l'utente potrebbe avere
            // ancora aperti in chat AI.
            let frontmatterIn = null;
            let contenutiIn = null;
            if (Array.isArray(parsed)) {
              contenutiIn = parsed;
            } else if (parsed && typeof parsed === 'object') {
              if (Array.isArray(parsed.contenuti)) {
                contenutiIn = parsed.contenuti;
                frontmatterIn = (parsed.frontmatter && typeof parsed.frontmatter === 'object') ? parsed.frontmatter : null;
              } else {
                showAiError('JSON: manca il campo "contenuti" (array di blocchi)');
                return;
              }
            } else {
              showAiError('Il JSON deve essere un oggetto {frontmatter, contenuti} o un array di blocchi');
              return;
            }
            // Validazione blocchi: ogni blocco deve avere "tipo" tra quelli supportati
            const VALID_TIPI = ['text','list','checklist','callout','table','image','system_code','link','form_ref','internal_ref','clinical_note'];
            const errors = [];
            const validBlocks = [];
            contenutiIn.forEach((b, i) => {
              if (!b || typeof b !== 'object' || !b.tipo) {
                errors.push(`Blocco #${i+1}: manca il campo "tipo"`);
                return;
              }
              if (!VALID_TIPI.includes(b.tipo)) {
                errors.push(`Blocco #${i+1}: tipo "${b.tipo}" non valido`);
                return;
              }
              validBlocks.push(b);
            });
            if (validBlocks.length === 0) {
              showAiError('Nessun blocco valido nel JSON.\n' + errors.join('\n'));
              return;
            }
            // Importa nei blocchi: append o replace?
            const existing = (typeof blockEditor !== 'undefined' && blockEditor.getBlocks) ? blockEditor.getBlocks() : [];
            const hasExisting = existing.some(b => b && (b.testo || b.items?.length || b.headers?.length || b.codici?.length));
            const doImport = (mode) => {
              const wrapper = $('editor-wrapper');
              if (!wrapper) { toast('Editor non trovato', 'error'); return; }
              const newBlocks = mode === 'append' ? [...existing, ...validBlocks] : validBlocks;
              blockEditor.render(wrapper, newBlocks);
              if (state.editingContext) state.editingContext.isDirty = true;
              // Applico il frontmatter ai campi metadata dell'editor (sovrascrive solo i campi
              // suggeriti dall'AI; gli altri restano com'erano).
              let fmCount = 0;
              if (frontmatterIn) {
                fmCount = applyAIFrontmatter(tipo, frontmatterIn);
              }
              const errMsg = errors.length ? ` (${errors.length} blocchi scartati)` : '';
              const fmMsg = fmCount > 0 ? `, ${fmCount} metadati pre-compilati` : '';
              toast(`${validBlocks.length} blocchi importati${fmMsg}${errMsg}`, 'success');
              closeModal();
            };
            if (hasExisting) {
              // Chiedo conferma: append o replace
              showModal({
                title: 'Hai già blocchi nell\'editor',
                body: '<p style="margin:0;font-size:14px;color:var(--ink-soft);line-height:1.5;">Vuoi <strong>aggiungere</strong> i nuovi blocchi a quelli esistenti, oppure <strong>sostituire</strong> tutto con i nuovi?</p>',
                actions: [
                  { label: 'Annulla', variant: 'ghost', onClick: () => closeModal() },
                  { label: 'Aggiungi in coda', onClick: () => doImport('append') },
                  { label: 'Sostituisci tutto', variant: 'danger', onClick: () => doImport('replace') }
                ]
              });
            } else {
              doImport('replace');
            }
          }
        }
      ];
    }
  }

  function showAiError(msg) {
    const el = $('ai-import-error');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
    else toast(msg, 'error', 5000);
  }

  function rerenderModal() {
    closeModal();
    setTimeout(() => {
      showModal({
        title: 'Importa con AI',
        subtitle: `Converti testo grezzo in ${tipo === 'clinica' ? 'una scheda clinica' : 'una procedura'} con un'AI esterna`,
        body: renderStep(),
        actions: actionsForStep()
      });
      // Bind copia prompt
      if (step === 2) {
        const cb = $('ai-copy-prompt');
        if (cb) cb.onclick = async function() {
          const ta = $('ai-import-prompt');
          if (!ta) return;
          try {
            await navigator.clipboard.writeText(ta.value);
            toast('Prompt copiato', 'success');
          } catch (e) {
            ta.select();
            try { document.execCommand('copy'); toast('Prompt copiato', 'success'); }
            catch { toast('Impossibile copiare. Seleziona e copia manualmente.', 'error'); }
          }
        };
      }
    }, 50);
  }

  rerenderModal();
}

// Applica i metadati suggeriti dall'AI ai campi dell'editor. Restituisce il numero di
// campi effettivamente popolati (per il toast di feedback). Sovrascrive solo i campi che
// l'AI ha valorizzato; gli altri restano com'erano. L'utente può rivedere/modificare tutto
// prima di salvare.
function applyAIFrontmatter(tipo, fm) {
  if (!fm || typeof fm !== 'object') return 0;
  let count = 0;
  // Helper: svuota una chips-list e re-popola con i valori dati. Usa chipsAdd
  // (che è già il pattern di "scrittura" della chip field) dopo aver azzerato il dataset.
  const replaceChips = (id, items) => {
    const container = document.getElementById(id);
    if (!container || typeof chipsAdd !== 'function') return false;
    // Svuota chip esistenti dal DOM
    container.querySelectorAll('.chip').forEach(c => c.remove());
    container.dataset.values = '[]';
    items.forEach(v => {
      const slug = String(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'');
      if (slug) chipsAdd(id, slug, String(v));
    });
    return items.length > 0;
  };
  // titolo (procedura + clinica)
  if (typeof fm.titolo === 'string' && fm.titolo.trim()) {
    const el = $('meta-titolo');
    if (el) { el.value = fm.titolo.trim(); count++; }
  }
  // tag (chips, procedura + clinica)
  if (Array.isArray(fm.tag) && fm.tag.length) {
    const tagsClean = fm.tag.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim());
    if (tagsClean.length && replaceChips('meta-tag-chips', tagsClean)) count++;
  }
  // termini equivalenti (chips, procedura + clinica)
  if (Array.isArray(fm.termini_equivalenti) && fm.termini_equivalenti.length) {
    const termClean = fm.termini_equivalenti.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim());
    if (termClean.length && replaceChips('meta-termini-chips', termClean)) count++;
  }
  if (tipo === 'procedura') {
    // categoria (select)
    if (typeof fm.categoria === 'string') {
      const valid = ['bedside','richieste','farmacologiche','emergenze','gestione'];
      if (valid.includes(fm.categoria)) {
        const el = $('meta-categoria');
        if (el) { el.value = fm.categoria; count++; }
      }
    }
    // sottocategoria (chips single-value)
    if (typeof fm.sottocategoria === 'string' && fm.sottocategoria.trim()) {
      if (replaceChips('meta-sottocategoria-chips', [fm.sottocategoria.trim()])) count++;
    }
  } else if (tipo === 'clinica') {
    // sottocategoria (select fissa)
    if (typeof fm.sottocategoria === 'string') {
      const valid = ['prognosi', 'gestione-post-acuta', 'scale-cliniche'];
      if (valid.includes(fm.sottocategoria)) {
        const el = $('meta-sottocategoria');
        if (el) { el.value = fm.sottocategoria; count++; }
      }
    }
  }
  return count;
}

async function saveProcedura() {
  const ctx = state.editingContext;
  if (!ctx) return;
  const btn = $('btn-save-edit');
  btn.disabled = true;
  btn.textContent = 'Salvataggio...';

  try {
    const nf = { ...ctx.originalFrontmatter };
    nf.titolo = $('meta-titolo').value.trim() || ctx.slug;
    nf.categoria = $('meta-categoria').value;
    // Sottocategoria (chips single-value)
    const subChips = typeof chipsGet === 'function' ? chipsGet('meta-sottocategoria-chips') : [];
    if (subChips.length > 0) nf.sottocategoria = subChips[0]; else delete nf.sottocategoria;
    // Tag / termini / relazioni from chips
    nf.tag = typeof chipsGet === 'function' ? chipsGet('meta-tag-chips') : [];
    // Remove deprecated tempo_esecuzione_min
    delete nf.tempo_esecuzione_min;
    nf.termini_equivalenti = chipsGet('meta-termini-chips');
    nf.moduli_correlati = chipsGet('meta-moduli-chips');
    nf.procedure_correlate = chipsGet('meta-procedure-chips');
    nf.numeri_correlati = chipsGet('meta-numeri-chips');
    nf.ultima_modifica = nowIso();
    nf.modificato_da = state.session.username;

    const nota = $('meta-note-modifica').value.trim() || 'aggiornamento';
    nf.cronologia_recente = [
      { data: nowIso(), utente: state.session.username, nota },
      ...((ctx.originalFrontmatter.cronologia_recente || []).slice(0, 4))
    ];

    // Tutte le schede usano il block editor: leggo i blocchi e azzero il body markdown.
    nf.contenuti = blockEditor.getBlocks();
    const newBody = '';
    const newContent = stringifyMarkdown(nf, newBody);
    const commitMsg = `Aggiorna ${ctx.slug} — ${nota} (by ${state.session.username})`;

    try { await gh.putFile(ctx.path, newContent, ctx.sha, commitMsg); }
    catch (e) {
      if (e.code === 'CONFLICT') return handleConflict(ctx, newContent, commitMsg);
      throw e;
    }

    toast('Modifiche salvate', 'success');
    if (ctx.hasLock) locks.release(ctx.slug).catch(() => {});

    const idx = state.index.procedure.findIndex(p => p.slug === ctx.slug);
    if (idx >= 0) {
      state.index.procedure[idx] = {
        ...state.index.procedure[idx], ...nf,
        body: newBody, body_preview: newBody.substring(0, 300)
      };
      rebuildSearchIndex();
    }

    state.editingContext = null;
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    navigate('procedura', { slug: ctx.slug });
  } catch (e) {
    toast('Errore salvataggio: ' + e.message, 'error', 6000);
    btn.disabled = false;
    btn.textContent = 'Salva';
  }
}

async function handleConflict(ctx, ourNewContent, commitMsg) {
  const btn = $('btn-save-edit');
  const fresh = await gh.getFile(ctx.path);
  const { frontmatter: theirFm } = parseMarkdown(fresh.content);
  showModal({
    title: 'Conflitto di modifiche',
    subtitle: `Il file è stato aggiornato da <strong style="font-family:var(--mono);">${escapeHtml(theirFm.modificato_da || 'qualcun altro')}</strong> ${timeAgo(theirFm.ultima_modifica)}.`,
    body: `
      <p style="font-size:14px;color:var(--ink-soft);margin-bottom:16px;">
        La risoluzione a livello di sezione arriverà in v1.1. Per ora due strade:
      </p>
      <div style="display:grid;gap:10px;">
        <div style="padding:14px;background:var(--bg-sink);border-left:3px solid var(--accent);border-radius:2px;">
          <strong style="font-size:13px;">Ricarica e riapplica</strong><br>
          <span style="font-size:13px;color:var(--ink-soft);">Perdi le tue modifiche, riparti dalla versione fresca.</span>
        </div>
        <div style="padding:14px;background:var(--bg-sink);border-left:3px solid var(--danger);border-radius:2px;">
          <strong style="font-size:13px;">Sovrascrivi</strong><br>
          <span style="font-size:13px;color:var(--ink-soft);">Salvi la tua versione. Le loro modifiche restano in Git history ma non nel file attuale.</span>
        </div>
      </div>`,
    actions: [
      { label: 'Ricarica e riapplica', onClick: async () => {
        closeModal();
        const slugLocal = ctx.slug;
        state.editingContext = null;
        window.removeEventListener('beforeunload', beforeUnloadHandler);
        await buildIndex();
        navigate('procedura-edit', { slug: slugLocal });
      }},
      { label: 'Sovrascrivi', variant: 'danger', onClick: async () => {
        closeModal();
        try {
          await gh.putFile(ctx.path, ourNewContent, fresh.sha, commitMsg + ' [OVERRIDE]');
          toast('Salvato (sovrascritto)', 'warning');
          if (ctx.hasLock) locks.release(ctx.slug).catch(() => {});
          const slugLocal = ctx.slug;
          state.editingContext = null;
          window.removeEventListener('beforeunload', beforeUnloadHandler);
          await buildIndex();
          navigate('procedura', { slug: slugLocal });
        } catch (e) {
          toast('Override fallito: ' + e.message, 'error');
          btn.disabled = false; btn.textContent = 'Salva';
        }
      }},
      { label: 'Annulla', variant: 'ghost', onClick: () => { closeModal(); btn.disabled = false; btn.textContent = 'Salva'; } }
    ]
  });
}
