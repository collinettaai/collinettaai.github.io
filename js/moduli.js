/* ============================ VIEW — MODULI COMPILABILI ============================ */
/* Nuova generazione: i moduli sono cartelle con boxes.yml + pagine PNG.
   Tappa 1 implementa solo lista + dettaglio placeholder. Le tappe 2-5 aggiungeranno
   form compilazione, viewer pagine, editor box, generazione PDF, persistenza GitHub. */

/* ============================ MODULI COMPILABILI — STATO ============================ */
// Per ciascun slug carico boxes.yml + URL pagine PNG. Cache in sessionStorage,
// si svuota a chiusura tab. La cache evita di rifetchare il YAML ad ogni navigazione
// della stessa sessione, ma garantisce dati freschi quando l'admin aggiorna su GitHub.
state.moduliCache = state.moduliCache || {};       // { slug: { boxesData, pageUrls, formValues } }

// Helper di persistenza modulo in sessionStorage. Esclude i dataUrl pesanti (pageUrls,
// pageUrlsLight: possono pesare diversi MB ciascuno per moduli con molte pagine ad alta
// risoluzione) dalla serializzazione. Senza questa esclusione, ogni keystroke nel form
// (oninput) serializzava 2-10 MB → quota exceeded silenziosa con perdita di stato.
// Le pageUrls/pageUrlsLight restano in memoria (state.moduliCache) e vengono ricaricate
// da GitHub al refresh della pagina (loadModuloDettaglio).
function _persistModulo(slug) {
  const c = state.moduliCache[slug];
  if (!c) return;
  // Costruisco oggetto serializzabile escludendo i dataUrl pesanti
  const lightweight = {
    boxesData: c.boxesData,
    boxesSha: c.boxesSha,
    pristineBoxes: c.pristineBoxes,
    pristineCampi: c.pristineCampi,
    formValues: c.formValues,
    currentPage: c.currentPage,
    zoom: c.zoom,
    editMode: c.editMode,
    selectedBoxIdx: c.selectedBoxIdx,
  };
  try {
    sessionStorage.setItem('modulo:' + slug, JSON.stringify(lightweight));
  } catch (e) {
    // Quota exceeded o sessionStorage non disponibile (es. modalità privacy iOS)
    // Non bloccare il flow, lo stato resta comunque in state.moduliCache (in-memory)
    if (e.name !== 'QuotaExceededError') {
      console.warn('[persistModulo]', slug, e);
    }
  }
}

// Carica boxes.yml + pre-calcola gli URL delle pagine PNG. Idempotente.
async function loadModuloDettaglio(slug, options) {
  // options: { skipBoxes: true } per il primo render del viewer (apertura modulo).
  //   Carico solo le pagine PNG → schermata di stampa/condivisione disponibile subito.
  //   I box (boxes.yml) vengono caricati solo quando l'utente preme "Compila" o "Modifica box"
  //   tramite loadModuloBoxes(slug). Risparmio ~1 GET API e mostro l'anteprima molto più velocemente.
  const opts = options || {};
  if (state.moduliCache[slug] && state.moduliCache[slug].pageUrls) {
    // Verifico coerenza: se la cache ha pageUrls vuoti ma index.yml dice che ci sono pagine,
    // invalido la cache e ricarico (cache stale da una creazione precedente con bug).
    const cached = state.moduliCache[slug];
    const m = (state.index.moduli || []).find(x => x.slug === slug);
    const expectedPages = (m && m.pagine) || 1;
    if (cached.pageUrls && cached.pageUrls.length >= expectedPages) {
      // Se mi servono i box e non li ho ancora caricati, li carico ora.
      if (!opts.skipBoxes && !cached.boxesData) {
        await loadModuloBoxes(slug);
      }
      return cached;
    }
    // Cache stale: rigenero
    console.warn('[loadModuloDettaglio] cache stale per', slug, '— rigenero');
    delete state.moduliCache[slug];
  }
  // Prova prima sessionStorage (sopravvive a refresh ma non a chiusura tab).
  // Da quando _persistModulo esclude pageUrls/pageUrlsLight (troppo grandi per sessionStorage),
  // qui ricostruiamo l'oggetto cache solo con i metadati: pageUrls verranno rifetchate dal repo
  // (sotto). Questo è il comportamento corretto: sessionStorage ricorda boxesData/formValues
  // (preziosi se l'utente sta compilando), le immagini sono sempre lazy-load da GitHub.
  try {
    const raw = sessionStorage.getItem('modulo:' + slug);
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj.boxesData) {
        // Pre-popolo la cache con i metadati; pageUrls verrà aggiunto dopo
        state.moduliCache[slug] = obj;
        // ... e fall-through al fetch pageUrls
      }
    }
  } catch (e) {
    console.warn('[loadModuloDettaglio] errore lettura sessionStorage:', e);
  }

  const m = (state.index.moduli || []).find(x => x.slug === slug);
  if (!m) throw new Error('Modulo non trovato in indice: ' + slug);

  // Box: lazy-loaded. Inizializzo a null/empty, verranno caricati su richiesta da loadModuloBoxes().
  let boxesData = null;
  let boxesSha = null;
  if (!opts.skipBoxes) {
    const fetched = await _fetchBoxesYml(slug);
    boxesData = fetched.boxesData;
    boxesSha = fetched.boxesSha;
  }

  // Genera URL pagine. Se m.pagine non è valido o è 0, faccio probe per discovery.
  let nPagine = (m.pagine && m.pagine > 0) ? m.pagine : 0;
  if (nPagine === 0) {
    // Probe: provo a leggere page-1.png, page-2.png, ... finché non fallisce (max 20).
    nPagine = await _probeModuloPagine(slug);
    if (nPagine > 0) {
      console.warn(`[loadModuloDettaglio] m.pagine non valido per ${slug}; probe ha trovato ${nPagine} pagine.`);
      m.pagine = nPagine;  // aggiorno in memoria (l'index.yml su repo non viene riscritto qui)
    }
  }
  if (nPagine === 0) nPagine = 1;  // fallback minimo

  // Fetch delle PNG via Contents API (necessario per repo privati: raw.githubusercontent.com
  // NON funziona con token via header). Convertiamo ogni PNG in data URL inline così l'<img>
  // può visualizzarla senza ulteriore auth. Le data URL non vengono salvate in sessionStorage
  // (potrebbero superare la quota), restano solo in memoria (state.moduliCache).
  // pageUrls = originali (alta risoluzione, usati per generazione PDF/PNG output).
  // pageUrlsLight = versioni ridimensionate (max 1200px lato lungo) per editor/viewer:
  //   il rendering è molto più veloce, lo zoom/scroll fluido anche su mobile.
  const pageUrls = [];
  const pageUrlsLight = [];
  for (let i = 1; i <= nPagine; i++) {
    const path = `content/moduli/${slug}/page-${i}.png`;
    try {
      const f = await gh.getFileBase64(path);
      if (f && f.base64) {
        const fullUrl = `data:${f.mimeType};base64,${f.base64}`;
        pageUrls.push(fullUrl);
        // Genero versione light in parallelo (canvas resize). Se fallisce, fallback all'originale.
        try {
          const lightUrl = await _resizeImageDataUrl(fullUrl, 1200);
          pageUrlsLight.push(lightUrl);
        } catch (e) {
          console.warn(`[loadModuloDettaglio] resize light fallita per pagina ${i}, uso originale:`, e);
          pageUrlsLight.push(fullUrl);
        }
      } else {
        // Pagina dichiarata in index.yml ma file mancante sul repo: push placeholder
        const fallback = `https://raw.githubusercontent.com/${CONFIG.REPO_OWNER}/${CONFIG.DATA_REPO_NAME}/${CONFIG.BRANCH}/${path}`;
        pageUrls.push(fallback);
        pageUrlsLight.push(fallback);
      }
    } catch (e) {
      console.warn(`[loadModuloDettaglio] errore fetch ${path}:`, e);
      const fallback = `https://raw.githubusercontent.com/${CONFIG.REPO_OWNER}/${CONFIG.DATA_REPO_NAME}/${CONFIG.BRANCH}/${path}`;
      pageUrls.push(fallback);
      pageUrlsLight.push(fallback);
    }
  }

  // Snapshot pristine dei box per dirty detection (deep clone). Se boxesData è null
  // (skipBoxes=true), pristine viene popolato in loadModuloBoxes() al momento del fetch.
  const pristineBoxes = boxesData ? JSON.parse(JSON.stringify(boxesData.box || [])) : null;
  const pristineCampi = boxesData ? JSON.parse(JSON.stringify(boxesData.campi_richiesti || [])) : null;

  // Se sessionStorage aveva già metadati (boxesData, formValues, ecc. da una sessione precedente),
  // li preservo e aggiungo solo pageUrls/pageUrlsLight appena fetchati. Altrimenti creo da zero.
  const cachedMeta = state.moduliCache[slug] && state.moduliCache[slug].boxesData
    ? state.moduliCache[slug] : null;
  const obj = cachedMeta ? {
    ...cachedMeta,
    boxesData: cachedMeta.boxesData || boxesData,
    boxesSha: cachedMeta.boxesSha || boxesSha,
    pristineBoxes: cachedMeta.pristineBoxes || pristineBoxes,
    pristineCampi: cachedMeta.pristineCampi || pristineCampi,
    pageUrls,
    pageUrlsLight,
  } : {
    boxesData, boxesSha, pristineBoxes, pristineCampi,
    pageUrls, pageUrlsLight,
    formValues: {},
    currentPage: 1,
  };
  state.moduliCache[slug] = obj;
  // _persistModulo NON salva pageUrls in sessionStorage (escluse perché pesanti)
  return obj;
}

// Helper: fetcha boxes.yml per un modulo. Restituisce { boxesData, boxesSha }.
// Estratto come funzione separata perché può essere chiamato sia in loadModuloDettaglio
// (caricamento iniziale completo) sia in loadModuloBoxes (lazy load on demand).
async function _fetchBoxesYml(slug) {
  const boxesPath = `content/moduli/${slug}/boxes.yml`;
  let boxesData = { campi_richiesti: [], box: [] };
  let boxesSha = null;
  try {
    const f = await gh.getFile(boxesPath);
    if (f) {
      boxesData = jsyaml.load(f.content) || boxesData;
      // Assicura il campo "Sede / Reparto" tra i campi disponibili (anche per i moduli già esistenti):
      // l'admin potrà assegnarlo a un box dall'editor; in compilazione si pre-compila con la sede di default.
      if (Array.isArray(boxesData.campi_richiesti) && !boxesData.campi_richiesti.some(c => c && c.id === 'sede')) {
        boxesData.campi_richiesti.push({ id: 'sede', label: 'Sede / Reparto', tipo: 'testo', default: 'Clinica Neurologica' });
      }
      boxesSha = f.sha;  // necessario per il PUT con check conflitti
    }
  } catch (e) {
    console.warn('[_fetchBoxesYml] boxes.yml mancante o non valido per', slug, ':', e);
  }
  return { boxesData, boxesSha };
}

// Carica i box (boxes.yml) per un modulo già aperto come viewer-only.
// Aggiorna state.moduliCache[slug] coi nuovi boxesData/boxesSha/pristineBoxes.
// Se i box sono già caricati, no-op.
async function loadModuloBoxes(slug) {
  const c = state.moduliCache[slug];
  if (!c) throw new Error('Modulo non in cache: ' + slug);
  if (c.boxesData) return c;  // già caricati
  const { boxesData, boxesSha } = await _fetchBoxesYml(slug);
  c.boxesData = boxesData;
  c.boxesSha = boxesSha;
  c.pristineBoxes = JSON.parse(JSON.stringify(boxesData.box || []));
  c.pristineCampi = JSON.parse(JSON.stringify(boxesData.campi_richiesti || []));
  return c;
}

// Helper: ridimensiona un data URL di un'immagine in modo che il lato più lungo non superi maxSide.
// Restituisce un nuovo data URL JPEG quality 0.85 (più piccolo del PNG originale).
// Se l'immagine è già più piccola di maxSide, ritorna l'originale invariato.
function _resizeImageDataUrl(dataUrl, maxSide) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img;
      if (Math.max(w, h) <= maxSide) { resolve(dataUrl); return; }
      const scale = maxSide / Math.max(w, h);
      const nw = Math.round(w * scale);
      const nh = Math.round(h * scale);
      const canvas = document.createElement('canvas');
      canvas.width = nw;
      canvas.height = nh;
      const ctx = canvas.getContext('2d');
      // Sfondo bianco (le PNG originali possono avere trasparenza che diventa nera in JPEG)
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, nw, nh);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, nw, nh);
      // JPEG quality 0.85 → file molto più leggero del PNG, qualità sufficiente per editor
      try {
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

// Probe: scopri quante pagine ha un modulo controllando l'esistenza di page-N.png su GitHub API
// (no fetch della PNG — usa solo HEAD via Contents API).
async function _probeModuloPagine(slug) {
  let n = 0;
  for (let i = 1; i <= 20; i++) {
    try {
      const f = await gh.getFile(`content/moduli/${slug}/page-${i}.png`);
      if (f) n = i;
      else break;
    } catch {
      break;
    }
  }
  return n;
}

// Compara box/campi correnti con lo snapshot pristine; ritorna true se ci sono differenze.
function _boxesAreDirty(slug) {
  const c = state.moduliCache[slug];
  if (!c || !c.boxesData) return false;
  // Baseline mancanti (moduli ripristinati da sessionStorage — che in passato non salvava
  // pristineCampi — o con boxes appena caricati): le inizializzo alla situazione corrente, così
  // le modifiche successive a box/campi vengono rilevate e compare il pulsante "Salva".
  // Prima, se pristineBoxes era null, la funzione usciva subito senza controllare i campi:
  // di conseguenza l'aggiunta di un campo non attivava "Salva" su quei moduli.
  if (c.pristineBoxes == null) c.pristineBoxes = JSON.parse(JSON.stringify(c.boxesData.box || []));
  if (c.pristineCampi == null) c.pristineCampi = JSON.parse(JSON.stringify(c.boxesData.campi_richiesti || []));
  const cur = c.boxesData.box || [];
  if (JSON.stringify(cur) !== JSON.stringify(c.pristineBoxes)) return true;
  // Anche le modifiche ai campi (aggiunta/rinomina/eliminazione) contano come non salvate.
  const curCampi = c.boxesData.campi_richiesti || [];
  if (JSON.stringify(curCampi) !== JSON.stringify(c.pristineCampi)) return true;
  return false;
}

// Costruisce il valore visibile del box a partire dai valoriCampi del form e dalla def del campo.
// Esempio: campo "paziente" tipo paziente_completo → output "Cognome Nome (gg/mm/aaaa)".
// Genera un testo placeholder esemplificativo per un box senza valore. Usato in editMode
// per dare al box un contenuto testuale stabile (evita lo pseudo-element ::before e altre
// soluzioni che causavano scivolamento su Android Chrome). Il testo dipende dal tipo del
// campo associato e dal formato selezionato.
function _placeholderForBox(box, campiDefs) {
  if (!box.campo) return '— campo —';
  const def = campiDefs.find(c => c.id === box.campo);
  if (!def) return '— campo —';
  const f = box.formato || '';
  if (def.tipo === 'paziente_completo') {
    if (f === 'cognome') return 'Cognome';
    if (f === 'nome') return 'Nome';
    if (f === 'nome_cognome') return 'Nome Cognome';
    if (f === 'cognome_nome') return 'Cognome Nome';
    if (f === 'data_nascita_completa' || f === 'data_nascita') return 'GG/MM/AAAA';
    if (f === 'giorno_nascita') return 'GG';
    if (f === 'mese_nascita') return 'MM';
    if (f === 'anno_nascita') return 'AAAA';
    if (f === 'anno_breve_nascita') return 'AA';
    if (f === 'gg_mm_nascita') return 'GG/MM';
    if (f === 'mm_aaaa_nascita') return 'MM/AAAA';
    if (f === 'mese_nascita_nome') return 'mese';
    if (f === 'mese_anno_nascita_nome') return 'mese AAAA';
    return 'Cognome Nome';  // default
  }
  if (def.tipo === 'medico_nome') {
    if (f === 'cognome') return 'Cognome';
    if (f === 'nome') return 'Nome';
    if (f === 'nome_cognome') return 'Nome Cognome';
    if (f === 'n_cognome') return 'N. Cognome';
    if (f === 'cognome_n') return 'Cognome N.';
    if (f === 'iniziali') return 'N.C.';
    return 'Cognome Nome';  // default
  }
  if (def.tipo === 'data') {
    if (f === 'giorno') return 'GG';
    if (f === 'mese') return 'MM';
    if (f === 'anno') return 'AAAA';
    if (f === 'anno_breve') return 'AA';
    if (f === 'mm_aaaa') return 'MM/AAAA';
    if (f === 'mese_nome') return 'mese';
    if (f === 'mese_anno_nome') return 'mese AAAA';
    return 'GG/MM/AAAA';  // default
  }
  // Fallback: usa il label del campo
  return def.label || '— campo —';
}

// Restituisce l'elenco di formati disponibili per un dato tipo di campo,
// usato dal dropdown "Formato" nel pannello editor box.
function _formatoOptionsPerTipo(tipo) {
  if (tipo === 'paziente_completo') {
    return [
      { value: '',                         label: 'Cognome Nome' },
      { value: 'nome_cognome',             label: 'Nome Cognome' },
      { value: 'cognome',                  label: 'Solo cognome' },
      { value: 'nome',                     label: 'Solo nome' },
      { value: 'data_nascita_completa',    label: 'Data nascita: gg/mm/aaaa' },
      { value: 'giorno_nascita',           label: 'Data nascita: solo giorno (gg)' },
      { value: 'mese_nascita',             label: 'Data nascita: solo mese (mm)' },
      { value: 'anno_nascita',             label: 'Data nascita: solo anno (aaaa)' },
      { value: 'anno_breve_nascita',       label: 'Data nascita: solo anno breve (aa)' },
      { value: 'gg_mm_nascita',            label: 'Data nascita: gg/mm' },
      { value: 'mm_aaaa_nascita',          label: 'Data nascita: mm/aaaa' },
      { value: 'mese_nascita_nome',        label: 'Data nascita: nome mese (es. marzo)' },
      { value: 'mese_anno_nascita_nome',   label: 'Data nascita: nome mese + anno' }
    ];
  }
  if (tipo === 'medico_nome') {
    return [
      { value: '',             label: 'Cognome Nome' },
      { value: 'cognome_nome', label: 'Cognome Nome' },
      { value: 'nome_cognome', label: 'Nome Cognome' },
      { value: 'n_cognome',    label: 'N. Cognome (nome puntato)' },
      { value: 'cognome_n',    label: 'Cognome N. (nome puntato)' },
      { value: 'iniziali',     label: 'Iniziali puntate (N.C.)' },
      { value: 'cognome',      label: 'Solo cognome' },
      { value: 'nome',         label: 'Solo nome' }
    ];
  }
  if (tipo === 'data') {
    return [
      { value: '',                 label: 'Data completa: gg/mm/aaaa' },
      { value: 'completa',         label: 'Data completa: gg/mm/aaaa' },
      { value: 'giorno',           label: 'Solo giorno (gg)' },
      { value: 'mese',             label: 'Solo mese (mm)' },
      { value: 'anno',             label: 'Solo anno (aaaa)' },
      { value: 'anno_breve',       label: 'Solo anno breve (aa)' },
      { value: 'gg_mm',            label: 'gg/mm' },
      { value: 'mm_aaaa',          label: 'mm/aaaa' },
      { value: 'mese_nome',        label: 'Nome mese (es. marzo)' },
      { value: 'mese_anno_nome',   label: 'Nome mese + anno' }
    ];
  }
  return [];
}

// Parsa una data in formato gg/mm/aaaa (o gg-mm-aaaa, gg.mm.aaaa) e restituisce { giorno, mese, anno }.
// Se la stringa non è parsabile, ritorna null.
function _parseDataString(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{1,2})[\/\-\.\s](\d{1,2})[\/\-\.\s](\d{2,4})$/);
  if (!m) return null;
  let [, gg, mm, aaaa] = m;
  if (aaaa.length === 2) aaaa = _expandAnnoBreve(aaaa);
  return {
    giorno: gg.padStart(2, '0'),
    mese: mm.padStart(2, '0'),
    anno: aaaa
  };
}

// Espande un anno a 2 cifre nel secolo corretto. Per evitare errori a cavallo di fine anno,
// gli anni fino a (anno corrente + 2) restano nel 2000 (es. 26→2026, 28→2028), mentre da
// (anno corrente + 3) in poi vanno nel 1900 (es. 29→1929). La soglia è dinamica sull'anno reale.
function _expandAnnoBreve(aa2) {
  const n = parseInt(aa2, 10);
  const annoCorrente = new Date().getFullYear();
  const cutoff = (annoCorrente % 100) + 2;  // es. 2026 → 28
  return (n <= cutoff ? '20' : '19') + String(n).padStart(2, '0');
}

// Estrai una "porzione" da una stringa data secondo il formato richiesto.
// formato: 'completa' | 'giorno' | 'mese' | 'anno' | 'gg_mm' | 'mm_aaaa' | 'mese_nome' | 'mese_anno_nome'
function _formatDataPortion(dataStr, formato) {
  const parsed = _parseDataString(dataStr);
  if (!parsed) return dataStr || '';  // fallback: se non parsabile, mostra la stringa originale
  const MESI = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
  switch (formato) {
    case 'giorno': return parsed.giorno;
    case 'mese': return parsed.mese;
    case 'anno': return parsed.anno;
    case 'anno_breve': return parsed.anno.slice(-2);
    case 'gg_mm': return `${parsed.giorno}/${parsed.mese}`;
    case 'mm_aaaa': return `${parsed.mese}/${parsed.anno}`;
    case 'mese_nome': return MESI[parseInt(parsed.mese, 10) - 1] || parsed.mese;
    case 'mese_anno_nome': return `${MESI[parseInt(parsed.mese, 10) - 1] || parsed.mese} ${parsed.anno}`;
    case 'completa':
    default: return `${parsed.giorno}/${parsed.mese}/${parsed.anno}`;
  }
}

function _formatBoxValue(box, campiDefs, valoriCampi) {
  if (!box.campo) return ''; // box senza campo = placeholder firma, non si compila
  const def = campiDefs.find(c => c.id === box.campo);
  if (!def) return '';
  const v = valoriCampi[box.campo];
  if (!v) return '';

  // Campo composito paziente: nome + cognome + data nascita.
  // Formati: cognome_nome (default), nome_cognome, cognome, nome, data_nascita_completa,
  //          giorno_nascita, mese_nascita, anno_nascita, gg_mm_nascita, mm_aaaa_nascita,
  //          mese_nascita_nome, mese_anno_nascita_nome
  if (def.tipo === 'paziente_completo' && typeof v === 'object') {
    const f = box.formato || '';
    if (f === 'cognome') return v.cognome || '';
    if (f === 'nome') return v.nome || '';
    if (f === 'nome_cognome') return [v.nome, v.cognome].filter(Boolean).join(' ');
    if (f === 'cognome_nome') return [v.cognome, v.nome].filter(Boolean).join(' ');
    // Sotto-formati della data di nascita
    if (f === 'data_nascita' || f === 'data_nascita_completa') return _formatDataPortion(v.dataNascita, 'completa');
    if (f === 'giorno_nascita') return _formatDataPortion(v.dataNascita, 'giorno');
    if (f === 'mese_nascita') return _formatDataPortion(v.dataNascita, 'mese');
    if (f === 'anno_nascita') return _formatDataPortion(v.dataNascita, 'anno');
    if (f === 'anno_breve_nascita') return _formatDataPortion(v.dataNascita, 'anno_breve');
    if (f === 'gg_mm_nascita') return _formatDataPortion(v.dataNascita, 'gg_mm');
    if (f === 'mm_aaaa_nascita') return _formatDataPortion(v.dataNascita, 'mm_aaaa');
    if (f === 'mese_nascita_nome') return _formatDataPortion(v.dataNascita, 'mese_nome');
    if (f === 'mese_anno_nascita_nome') return _formatDataPortion(v.dataNascita, 'mese_anno_nome');
    // Default (formato vuoto): "Cognome Nome" senza data — coerente con il dropdown editor
    return [v.cognome, v.nome].filter(Boolean).join(' ');
  }

  // Campo composito medico: cognome + nome (entrambi obbligatori per scrittura legale)
  // Formati: cognome_nome (default), nome_cognome, cognome, nome
  if (def.tipo === 'medico_nome' && typeof v === 'object') {
    const f = box.formato || '';
    // Iniziali puntate di TUTTE le parole (gestisce nomi multipli: "Mario Luigi" → "M.L.").
    const inits = s => (s || '').trim().split(/\s+/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + '.').join('');
    if (f === 'cognome') return v.cognome || '';
    if (f === 'nome') return v.nome || '';
    if (f === 'nome_cognome') return [v.nome, v.cognome].filter(Boolean).join(' ');
    if (f === 'n_cognome') return [inits(v.nome), v.cognome].filter(Boolean).join(' ');   // N.[N.] Cognome
    if (f === 'cognome_n') return [v.cognome, inits(v.nome)].filter(Boolean).join(' ');   // Cognome N.[N.]
    if (f === 'iniziali') return inits(v.nome) + inits(v.cognome);                         // N.[N.]C.
    // default: cognome_nome
    return [v.cognome, v.nome].filter(Boolean).join(' ');
  }

  // Campo data semplice (es. data_consenso): la stringa è gg/mm/aaaa.
  // Formato sub-portion: giorno, mese, anno, gg_mm, mm_aaaa, mese_nome, mese_anno_nome.
  if (def.tipo === 'data' && box.formato) {
    return _formatDataPortion(v, box.formato);
  }

  return String(v);
}

// Resolve default values (es. "oggi", "ora_corrente", or static string)
function _resolveDefault(def) {
  if (def.default == null) return '';
  if (def.default === 'oggi') {
    const d = new Date();
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  }
  if (def.default === 'ora_corrente') {
    const d = new Date();
    const date = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
    const time = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    return `${date} ${time}`;
  }
  return def.default;
}

/* ============================ VIEW — MODULI COMPILABILI ============================ */
// Raccoglie le categorie distinte presenti tra i moduli (per datalist/suggerimenti).
function _collectModuliCategorie() {
  const set = new Set();
  (state.index.moduli || []).forEach(m => { if (m.categoria && m.categoria.trim()) set.add(m.categoria.trim()); });
  return [...set].sort((a, b) => a.localeCompare(b, 'it'));
}

function renderModuliList() {
  const moduli = state.index.moduli || [];
  const cardHtml = (m) => `
    <div class="procedure-card" onclick="navigate('modulo', {slug:'${escapeHtml(m.slug)}'})">
      <div class="procedure-card-title">${escapeHtml(m.titolo || m.slug)}
        <span class="card-actions">${renderPinButton('modulo', m.slug)}<button class="btn-icon-mini edit-only card-edit-btn" onclick="event.stopPropagation();showNavContextMenu(this, 'modulo', '${escapeJs(m.slug)}')" title="Azioni">⋯</button></span>
      </div>
      ${m.descrizione ? `<div class="procedure-card-desc" style="font-size:13px;color:var(--ink-muted);margin-top:6px;line-height:1.4;">${escapeHtml(m.descrizione)}</div>` : ''}
      ${(m.tag && m.tag.length) ? `<div style="margin-top:8px;">${m.tag.slice(0,3).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
      <div class="procedure-card-meta" style="margin-top:8px;">
        <span>${m.pagine || 1} ${(m.pagine || 1) === 1 ? 'pagina' : 'pagine'}</span>
        ${m.autore ? `<span>· ${escapeHtml(m.autore)}</span>` : ''}
      </div>
    </div>`;

  // Raggruppo per categoria. I moduli senza categoria vanno in un gruppo finale "Altri".
  const SENZA = '__senza__';
  const gruppi = new Map();
  moduli.forEach(m => {
    const key = (m.categoria && m.categoria.trim()) ? m.categoria.trim() : SENZA;
    if (!gruppi.has(key)) gruppi.set(key, []);
    gruppi.get(key).push(m);
  });
  // Ordino le categorie alfabeticamente, "Altri" sempre per ultimo
  const categorie = [...gruppi.keys()].filter(k => k !== SENZA).sort((a, b) => a.localeCompare(b, 'it'));
  if (gruppi.has(SENZA)) categorie.push(SENZA);

  let bodyHtml;
  if (!moduli.length) {
    bodyHtml = '<p style="color:var(--ink-muted);font-style:italic;">Nessun modulo presente. Premi "+ Nuovo modulo" per crearne uno.</p>';
  } else if (categorie.length === 1 && categorie[0] === SENZA) {
    // Nessuna categoria assegnata: mostro la griglia piatta come prima
    bodyHtml = `<div class="procedure-grid">${moduli.map(cardHtml).join('')}</div>`;
  } else {
    bodyHtml = categorie.map(cat => {
      const items = gruppi.get(cat);
      const titolo = cat === SENZA ? 'Altri' : cat;
      return `<details class="categoria-block">
        <summary class="categoria-summary">
          <span class="categoria-title">${escapeHtml(titolo)}</span>
          <span class="categoria-count">${items.length}</span>
        </summary>
        <div class="categoria-content">
          <div class="procedure-grid">${items.map(cardHtml).join('')}</div>
        </div>
      </details>`;
    }).join('');
  }

  $('main-content').innerHTML = `
    <div class="page-head">
      <div class="page-eyebrow">${buildBreadcrumb([{label:'Home', route:'home'}])}</div>
      <h1 class="page-title">Moduli</h1>
      <div class="page-actions" style="margin-top:16px;">
        ${puoModificare('moduli') ? `<button class="btn primary" onclick="apriNuovoModuloDialog()" style="background:var(--ink);color:var(--bg-paper);border-color:var(--ink);">+ Nuovo modulo</button>` : ''}
      </div>
    </div>
    ${bodyHtml}`;
}

// Modifica i metadati di un modulo: titolo, descrizione e (opzionale) slug.
// Cambiare lo slug comporta lo spostamento dell'intera cartella content/moduli/<slug>/
// (boxes.yml + PNG delle pagine) e l'aggiornamento di content/moduli/index.yml.
async function editModuloMeta(slug) {
  if (bloccaSeNonModifica('moduli')) return;
  if (!state.session || !state.session.tokenAuth) {
    return toast('Login richiesto per modificare moduli', 'error');
  }
  const m = (state.index.moduli || []).find(x => x.slug === slug);
  if (!m) return toast('Modulo non trovato', 'error');
  const body = `
    <form onsubmit="return false;" style="display:flex;flex-direction:column;gap:12px;">
      <div class="field">
        <label>Titolo</label>
        <input type="text" id="me-titolo" class="mod-input" value="${escapeHtml(m.titolo || '')}" placeholder="es. Consenso rachicentesi">
      </div>
      <div class="field">
        <label>Descrizione <span style="font-weight:normal;color:var(--ink-muted);">(opzionale)</span></label>
        <input type="text" id="me-descrizione" class="mod-input" value="${escapeHtml(m.descrizione || '')}" placeholder="Breve descrizione">
      </div>
      <div class="field">
        <label>Categoria <span style="font-weight:normal;color:var(--ink-muted);">(opzionale — es. Imaging, Biopsie, Cardiologici)</span></label>
        <input type="text" id="me-categoria" class="mod-input" value="${escapeHtml(m.categoria || '')}" placeholder="es. Imaging" list="me-categoria-list" autocomplete="off">
        <datalist id="me-categoria-list">${_collectModuliCategorie().map(c => `<option value="${escapeHtml(c)}"></option>`).join('')}</datalist>
      </div>
      <div class="field">
        <label>Tag <span style="font-weight:normal;color:var(--ink-muted);">(opzionale)</span></label>
        ${renderChipsField({
          id: 'me-tag-chips',
          values: m.tag || [],
          suggestions: collectAllTags(),
          placeholder: 'cerca o crea tag…',
          allowNew: true
        })}
      </div>
      <div class="field">
        <label>Termini equivalenti <span style="font-weight:normal;color:var(--ink-muted);">(sinonimi/sigle per la ricerca — es. PL, puntura lombare)</span></label>
        ${renderChipsField({
          id: 'me-termini-chips',
          values: m.termini_equivalenti || [],
          suggestions: [],
          placeholder: 'aggiungi sinonimo…',
          allowNew: true
        })}
      </div>
      <div class="field">
        <label>Note <span style="font-weight:normal;color:var(--ink-muted);">(opzionale)</span></label>
        <textarea id="me-note" class="mod-input" rows="4" placeholder="Es. come compilare il modulo, a chi inviarlo, dove consegnarlo…">${escapeHtml(m.note || '')}</textarea>
      </div>
      <div class="field">
        <label>Slug <span style="font-weight:normal;color:var(--ink-muted);">(identificativo cartella — cambiarlo sposta i file)</span></label>
        <input type="text" id="me-slug" class="mod-input mono-input" value="${escapeHtml(m.slug)}" placeholder="es. consenso-rachicentesi">
        <div style="font-size:11px;color:var(--warning);margin-top:3px;">⚠ Cambiare lo slug richiede di spostare l'intera cartella del modulo. Può richiedere qualche secondo.</div>
      </div>
    </form>`;
  showModal({
    title: 'Modifica modulo',
    subtitle: escapeHtml(m.titolo || m.slug),
    body,
    actions: [
      { label: 'Annulla', variant: 'ghost', onClick: () => closeModal() },
      { label: 'Salva', onClick: async () => {
        const titolo = ($('me-titolo').value || '').trim();
        const descrizione = ($('me-descrizione').value || '').trim();
        const categoria = ($('me-categoria') ? ($('me-categoria').value || '').trim() : '');
        const tag = typeof chipsGet === 'function' ? chipsGet('me-tag-chips') : [];
        const terminiEq = typeof chipsGet === 'function' ? chipsGet('me-termini-chips') : [];
        const note = ($('me-note').value || '').trim();
        const newSlug = slugifyLocal(($('me-slug').value || '').trim());
        if (!titolo) return toast('Titolo obbligatorio', 'warning');
        if (!newSlug) return toast('Slug obbligatorio', 'warning');
        const slugChanged = newSlug !== slug;
        try {
          // 1. Carico l'index.yml dei moduli
          const idxFile = await gh.getFile('content/moduli/index.yml');
          if (!idxFile) throw new Error('index.yml dei moduli non trovato');
          const idxData = jsyaml.load(idxFile.content) || {};
          const moduliArr = idxData.moduli || [];
          const entry = moduliArr.find(x => x.slug === slug);
          if (!entry) throw new Error('Modulo non presente in index.yml');
          // 2. Se cambia lo slug, controllo che non esista già e sposto la cartella
          if (slugChanged) {
            if (moduliArr.some(x => x.slug === newSlug)) return toast('Esiste già un modulo con questo slug', 'error');
            closeModal();
            toast('Spostamento cartella in corso...', 'info');
            const oldDir = `content/moduli/${slug}`;
            const newDir = `content/moduli/${newSlug}`;
            const items = await gh.listDir(oldDir);
            for (const it of items) {
              if (it.type !== 'file') continue;
              const isYaml = it.name.endsWith('.yml') || it.name.endsWith('.yaml');
              if (isYaml) {
                const f = await gh.getFile(`${oldDir}/${it.name}`);
                if (!f) continue;
                await gh.putFile(`${newDir}/${it.name}`, f.content, null, `Sposta modulo ${slug}→${newSlug}: ${it.name}`);
                await gh.deleteFile(`${oldDir}/${it.name}`, f.sha, `Sposta modulo: elimina vecchio ${it.name}`);
              } else {
                // File binario (PNG): copio via base64 senza decodificare
                const fb = await gh.getFileBase64(`${oldDir}/${it.name}`);
                if (!fb) continue;
                await gh.putFile(`${newDir}/${it.name}`, fb.base64, null, `Sposta modulo ${slug}→${newSlug}: ${it.name}`, true);
                await gh.deleteFile(`${oldDir}/${it.name}`, fb.sha, `Sposta modulo: elimina vecchio ${it.name}`);
              }
            }
          } else {
            closeModal();
          }
          // 3. Aggiorno l'entry in index.yml
          entry.titolo = titolo;
          entry.descrizione = descrizione;
          if (categoria) entry.categoria = categoria; else delete entry.categoria;
          if (tag.length) entry.tag = tag; else delete entry.tag;
          if (terminiEq.length) entry.termini_equivalenti = terminiEq; else delete entry.termini_equivalenti;
          if (note) entry.note = note; else delete entry.note;
          if (slugChanged) entry.slug = newSlug;
          entry.aggiornato = new Date().toISOString();
          const freshIdx = await gh.getFile('content/moduli/index.yml');
          await gh.putFile('content/moduli/index.yml', jsyaml.dump(idxData), freshIdx ? freshIdx.sha : idxFile.sha, `Modifica modulo: ${titolo}`);
          // 4. Pulisco la cache del modulo e ricostruisco
          if (state.moduliCache) { delete state.moduliCache[slug]; if (slugChanged) delete state.moduliCache[newSlug]; }
          toast('Modulo aggiornato', 'success');
          await buildIndex();
          renderNavTree();
          if (state.currentView === 'moduli') renderModuliList();
        } catch (e) { toast('Errore: ' + e.message, 'error'); }
      } }
    ]
  });
  // Inizializzo i chip dei tag dopo che il modal è nel DOM.
  if (typeof chipsInit === 'function') chipsInit('me-tag-chips', collectAllTags());
  if (typeof chipsInit === 'function') chipsInit('me-termini-chips', []);
}

async function renderModulo(slug, opts = {}) {
  const m = (state.index.moduli || []).find(x => x.slug === slug);
  if (!m) return renderError('Modulo non trovato', slug);

  // Header sempre visibile (subito), caricamento detail in background
  const relatedProcs = (m.procedure_correlate || []).map(pid => state.index.procedure.find(p => p.slug === pid)).filter(Boolean);
  $('main-content').innerHTML = `
    <div class="page-head">
      <div class="page-eyebrow">${buildBreadcrumb([{label:'Moduli', route:'moduli'}])}</div>
      <h1 class="page-title">${escapeHtml(m.titolo || slug)} ${renderPinButton('modulo', slug)}</h1>
      ${(m.tag && m.tag.length) ? `<div style="margin-top:12px;">${m.tag.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
      <div class="page-meta" style="margin-top:12px;">
        <div class="page-meta-item">${m.pagine || 1} ${(m.pagine || 1) === 1 ? 'pagina' : 'pagine'}</div>
        ${m.autore ? `<div class="page-meta-item">${escapeHtml(m.autore)}</div>` : ''}
        ${m.aggiornato ? `<div class="page-meta-item">Aggiornato ${timeAgo(m.aggiornato)}</div>` : ''}
      </div>
      <div class="page-actions">
        <button class="btn ghost" onclick="shareLink(buildShareUrl('modulo', {slug:'${escapeHtml(slug)}'}), 'CollinettaAI · ${escapeHtml((m.titolo || slug).replace(/'/g, '\\\''))}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          Condividi
        </button>
        <button class="btn ghost edit-only" onclick="editModuloMeta('${escapeJs(slug)}')">Modifica</button>
        <button class="btn ghost edit-only" style="color:#A32D2D;" onclick="confirmDeleteModulo('${escapeJs(slug)}')">Elimina</button>
      </div>
    </div>
    ${m.note ? `<div class="mod-note-box" style="margin-top:20px;padding:16px 20px;background:var(--bg-sink);border-left:3px solid var(--accent);border-radius:0 2px 2px 0;">
      <div style="font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-muted);font-weight:500;margin-bottom:8px;">Note</div>
      <div style="font-size:14px;line-height:1.6;color:var(--ink-soft);white-space:pre-wrap;">${escapeHtml(m.note)}</div>
    </div>` : ''}
    <div id="mod-detail-area" style="margin-top:24px;">
      <p style="color:var(--ink-muted);font-style:italic;">Caricamento modulo…</p>
    </div>
    ${relatedProcs.length ? `
      <div class="related-grid" style="margin-top:32px;">
        ${relatedProcs.map(p => `
          <div class="related-card" onclick="navigate('procedura', {slug:'${escapeHtml(p.slug)}'})">
            <div class="related-card-label">Procedura</div>
            <div class="related-card-title">${escapeHtml(p.titolo)}</div>
          </div>`).join('')}
      </div>` : ''}`;

  // Caricamento dettaglio (lazy): primo render = solo viewer (PNG pagine + bottone Compila).
  // I box vengono caricati solo quando l'utente preme "Compila" → apertura modulo molto più rapida.
  try {
    const det = await loadModuloDettaglio(slug, { skipBoxes: true });
    renderModuloViewer(slug, det);
  } catch (e) {
    const area = document.getElementById('mod-detail-area');
    if (area) area.innerHTML = `<div class="callout callout-warning"><p>Errore caricamento modulo: ${escapeHtml(e.message)}</p></div>`;
  }
  scrollToPendingBlock();
}

// Render "viewer-only": mostra solo le pagine PNG con bottoni Stampa/Condividi/Compila.
// I box non sono caricati: l'utente vede subito il modulo senza l'overhead della lettura
// di boxes.yml + setup del form di compilazione.
// Helper unico per nav pagine + zoom toolbar dei moduli. Usato sia dal viewer (read-only)
// che dal compilatore (editing form) — l'unica differenza erano le callback target.
// mode: 'viewer' → callback changeModuloPageViewer / setModuloZoomViewer
// mode: 'compilatore' → callback changeModuloPage / setModuloZoom
function _renderModuloPageNav(slug, det, mode) {
  const totalPages = det.pageUrls.length;
  const cur = det.currentPage || 1;
  const zoom = det.zoom || 1;
  const fnPage = mode === 'viewer' ? 'changeModuloPageViewer' : 'changeModuloPage';
  const fnZoom = mode === 'viewer' ? 'setModuloZoomViewer' : 'setModuloZoom';
  const navHtml = totalPages > 1 ? `
    <div class="mod-page-nav">
      <button class="btn ghost mod-page-prev" ${cur <= 1 ? 'disabled' : ''} onclick="${fnPage}('${escapeJs(slug)}', ${cur - 1})" aria-label="Pagina precedente"><span class="mod-page-arrow">◀</span><span class="mod-page-text"> Precedente</span></button>
      <span class="mod-page-indicator">Pagina ${cur} / ${totalPages}</span>
      <button class="btn ghost mod-page-next" ${cur >= totalPages ? 'disabled' : ''} onclick="${fnPage}('${escapeJs(slug)}', ${cur + 1})" aria-label="Pagina successiva"><span class="mod-page-text">Successiva </span><span class="mod-page-arrow">▶</span></button>
    </div>` : `<div class="mod-page-indicator" style="margin-bottom:8px;">Pagina unica</div>`;
  const zoomToolbar = `
    <div class="mod-zoom-toolbar">
      <button class="btn ghost mod-zoom-btn" onclick="${fnZoom}('${escapeJs(slug)}', ${Math.max(0.5, zoom - 0.25)})" aria-label="Riduci zoom">−</button>
      <span class="mod-zoom-indicator">${Math.round(zoom * 100)}%</span>
      <button class="btn ghost mod-zoom-btn" onclick="${fnZoom}('${escapeJs(slug)}', ${Math.min(4, zoom + 0.25)})" aria-label="Aumenta zoom">+</button>
      <button class="btn ghost mod-zoom-btn" onclick="${fnZoom}('${escapeJs(slug)}', 1)" aria-label="Reset zoom" title="Reset 100%">⟲</button>
    </div>`;
  return { navHtml, zoomToolbar };
}

function renderModuloViewer(slug, det) {
  const area = document.getElementById('mod-detail-area');
  if (!area) return;
  const { pageUrls, pageUrlsLight } = det;
  const displayUrls = pageUrlsLight && pageUrlsLight.length === pageUrls.length ? pageUrlsLight : pageUrls;
  const cur = det.currentPage || 1;
  const zoom = det.zoom || 1;
  const { navHtml, zoomToolbar } = _renderModuloPageNav(slug, det, 'viewer');

  area.innerHTML = `
    <div class="mod-toolbar" style="margin-bottom:16px;">
      <button class="btn primary" onclick="apriModuloCompilatore('${escapeJs(slug)}')">📝 Compila modulo</button>
      <button class="btn ghost" onclick="stampaModuloViewer('${escapeJs(slug)}')">🖨 Stampa</button>
      <button class="btn ghost" onclick="condividiModuloViewer('${escapeJs(slug)}')">↗ Condividi</button>
    </div>
    <div class="mod-preview" id="mod-viewer-section">
      ${navHtml}
      ${zoomToolbar}
      <div class="mod-page-scroll">
        <div class="mod-page-stage" style="width:${zoom * 100}%;">
          <img class="mod-page-img" src="${displayUrls[cur - 1]}" alt="Pagina ${cur}">
        </div>
      </div>
    </div>`;
}

// Cambia pagina nel viewer-only (versione legacy, ora wrapper della funzione unificata)
function changeModuloPageViewer(slug, newPage) {
  changeModuloPage(slug, newPage, 'viewer');
}

// Zoom nel viewer-only (versione legacy, ora wrapper della funzione unificata)
function setModuloZoomViewer(slug, newZoom) {
  setModuloZoom(slug, newZoom, 'viewer');
}

// Apre il compilatore: carica i box (se non già caricati) e renderizza il form completo.
async function apriModuloCompilatore(slug) {
  const c = state.moduliCache[slug];
  if (!c) return;
  const area = document.getElementById('mod-detail-area');
  if (area && !c.boxesData) {
    area.innerHTML = `<div class="loading"><span class="spinner"></span> Caricamento campi modulo…</div>`;
  }
  try {
    if (!c.boxesData) await loadModuloBoxes(slug);
    c.editMode = false;  // "Compila" apre sempre il form di compilazione, mai l'editor box
    c.selectedBoxIdx = null;
    renderModuloCompilatore(slug, c);
  } catch (e) {
    if (area) area.innerHTML = `<div class="callout callout-warning"><p>Errore caricamento campi: ${escapeHtml(e.message)}</p></div>`;
  }
}

// Apre la finestra di stampa con la pagina corrente del modulo
// Helper unico per stampa modulo (A4 fronte/retro). Usato da:
// - stampaModuloViewer: passa le pagine originali ad alta risoluzione (preview viewer)
// - stampaModuloCompilato: passa i canvas dataURL renderizzati con i valori utente
//
// CSS critico per print:
// - @page A4 con margin 0: il browser usa l'intera pagina A4.
// - .page = container 210×297mm con object-fit:contain → l'immagine entra senza overflow.
//   Se l'aspect ratio del PNG sorgente è diverso da A4, lo spazio extra resta bianco MA
//   resta DENTRO la stessa pagina fisica — niente pagina bianca extra.
// - break-after: page sui contenitori (tranne l'ultimo) per garantire una pagina fisica
//   per ogni pagina logica → il driver di stampa può abilitare fronte/retro.
// - break-inside: avoid per evitare che il contenuto si spezzi su due pagine.
function _stampaPagineA4(slug, pageDataUrls, suffix) {
  if (!pageDataUrls || !pageDataUrls.length) return toast('Nessuna pagina da stampare', 'error');
  const w = window.open('', '_blank');
  if (!w) return toast('Popup bloccati: abilita i popup per stampare', 'warning', 4000);
  const m = (state.index.moduli || []).find(x => x.slug === slug);
  const titolo = m ? (m.titolo || slug) : slug;
  const titoloHead = suffix ? `${titolo} - ${suffix}` : titolo;
  w.document.write(`<!DOCTYPE html><html><head><title>${escapeHtml(titoloHead)}</title>
    <style>
      @page { size: A4 portrait; margin: 0; }
      html, body { margin: 0; padding: 0; background: white; }
      .page {
        width: 210mm;
        height: 297mm;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        page-break-after: always;
        page-break-inside: avoid;
        break-after: page;
        break-inside: avoid;
      }
      .page:last-child { page-break-after: auto; break-after: auto; }
      .page img {
        max-width: 100%;
        max-height: 100%;
        width: auto;
        height: auto;
        object-fit: contain;
        display: block;
      }
    </style></head><body>
    ${pageDataUrls.map((u, i) => `<div class="page"><img src="${u}" alt="Pagina ${i+1}"></div>`).join('')}
    <script>window.onload = () => setTimeout(() => window.print(), 300);<\/script>
    </body></html>`);
  w.document.close();
}

function stampaModuloViewer(slug) {
  const c = state.moduliCache[slug];
  if (!c || !c.pageUrls || !c.pageUrls.length) return toast('Pagine non caricate', 'error');
  _stampaPagineA4(slug, c.pageUrls);
}

// Condivide il modulo via Web Share API (se disponibile) o copia link
async function condividiModuloViewer(slug) {
  const m = (state.index.moduli || []).find(x => x.slug === slug);
  const titolo = m ? (m.titolo || slug) : slug;
  const url = buildShareUrl('modulo', { slug });
  if (typeof shareLink === 'function') {
    shareLink(url, `CollinettaAI · ${titolo}`);
  } else if (navigator.share) {
    try { await navigator.share({ title: titolo, url }); } catch {}
  } else {
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copiato negli appunti', 'success');
    } catch {
      toast('Impossibile condividere su questo dispositivo', 'warning');
    }
  }
}

// Render del compilatore: form a sinistra (su mobile in alto), preview pagine a destra (sotto su mobile).
function renderModuloCompilatore(slug, det) {
  const area = document.getElementById('mod-detail-area');
  if (!area) return;
  const { boxesData, pageUrls } = det;
  if (!boxesData) {
    // I box non sono ancora caricati: non posso renderizzare il compilatore/editor.
    // Lo carico e ritento, evitando l'accesso a boxesData.campi_richiesti su null.
    loadModuloBoxes(slug).then(() => renderModuloCompilatore(slug, state.moduliCache[slug] || det)).catch(() => {});
    area.innerHTML = `<div class="loading"><span class="spinner"></span> Caricamento campi modulo…</div>`;
    return;
  }
  const campiDefs = boxesData.campi_richiesti || [];
  const boxes = boxesData.box || [];
  const editMode = !!det.editMode;

  // Inizializza valori default solo al primo render
  if (Object.keys(det.formValues).length === 0) {
    campiDefs.forEach(c => {
      if (c.tipo === 'paziente_completo') {
        det.formValues[c.id] = { cognome: '', nome: '', dataNascita: '' };
      } else if (c.tipo === 'medico_nome') {
        // Pre-compila col medico loggato come default; i campi restano modificabili
        det.formValues[c.id] = {
          cognome: (state.session && state.session.cognome) || '',
          nome: (state.session && state.session.nome) || ''
        };
      } else {
        det.formValues[c.id] = _resolveDefault(c);
      }
    });
  }

  // Filtra i campi mostrati nel form: solo quelli effettivamente usati dai box di questo modulo.
  // I campi_richiesti possono includere voci "boilerplate" (paziente, medico, data) ereditate da
  // un template, ma se nessun box del modulo le referenzia non ha senso mostrarle nel form.
  // In edit mode invece mostro tutti i campi (l'editor sta ancora costruendo i box).
  const campiUsati = new Set();
  boxes.forEach(b => { if (b.campo) campiUsati.add(b.campo); });
  const campiDaMostrare = editMode
    ? campiDefs
    : campiDefs.filter(c => campiUsati.has(c.id));

  const formHtml = campiDaMostrare.map(c => _renderCampoInput(c, det.formValues[c.id], slug)).join('');
  const noBoxesHint = boxes.length === 0 && !editMode ? `
    <div class="callout callout-info" style="margin-bottom:12px;">
      <p><strong>Nessun box configurato.</strong> Attiva la modalità modifica per disegnare i box sul modulo.</p>
    </div>` : '';

  const editorPanelHtml = editMode ? _renderModuloEditorPanel(slug, det) : '';
  const isDirty = editMode && _boxesAreDirty(slug);

  area.innerHTML = `
    <div class="mod-toolbar" id="mod-toolbar">
      <button class="btn ghost" onclick="renderModuloViewer('${escapeJs(slug)}', state.moduliCache['${escapeJs(slug)}'])" title="Torna alla vista pagine">◀ Indietro</button>
      ${(editMode || puoModificare('moduli')) ? `
      <button class="btn ${editMode ? 'primary' : 'ghost'}" onclick="toggleModuloEditMode('${escapeJs(slug)}')">
        ${editMode ? '✓ Esci modalità modifica' : '✎ Modifica box'}
      </button>` : ''}
      ${editMode ? `
        <button class="btn ghost" onclick="addModuloBox('${escapeJs(slug)}')">+ Aggiungi box</button>
        <button class="btn ${det.showGrid ? 'primary' : 'ghost'}" onclick="toggleModuloGrid('${escapeJs(slug)}')" title="Mostra/nascondi griglia di allineamento (con snap)"${det.showGrid ? ' style="background:#185FA5;border-color:#185FA5;"' : ''}>▦ Griglia</button>
        ${isDirty ? `
          <button class="btn primary" id="mod-btn-save" onclick="salvaModuloBoxes('${escapeJs(slug)}')" style="background:#185FA5;border-color:#185FA5;">Salva</button>
          <button class="btn ghost" onclick="scartaModuloBoxesModifiche('${escapeJs(slug)}')">Scarta</button>
          <span class="mod-toolbar-hint" style="color:#A32D2D;font-style:normal;">Modifiche non salvate</span>
        ` : `<span class="mod-toolbar-hint">Trascina i box per spostarli, usa gli angoli per ridimensionarli.</span>`}
      ` : ''}
    </div>
    <div class="mod-layout ${editMode ? 'mod-layout-edit' : ''}">
      <aside class="mod-form" id="mod-form-aside">
        ${editMode ? editorPanelHtml : `
          <div class="mod-form-head">
            <h3 style="margin:0 0 6px 0;font-family:var(--serif);font-size:18px;">Dati di compilazione</h3>
            <p style="margin:0;font-size:12px;color:var(--ink-muted);">I valori inseriti verranno sovrapposti automaticamente al modulo nei punti predefiniti.</p>
          </div>
          ${noBoxesHint}
          <div class="mod-form-fields">
            ${formHtml}
          </div>
          <div class="mod-form-actions" style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;">
            <div class="mod-dropdown-wrap">
              <button class="btn primary" onclick="toggleModuloDownloadMenu(event,'${escapeJs(slug)}')">Scarica ▾</button>
              <div class="mod-dropdown-menu" id="mod-download-menu-${escapeJs(slug)}">
                <button type="button" onclick="downloadModuloPdf('${escapeJs(slug)}');closeModuloDownloadMenu();">📄 PDF</button>
                <button type="button" onclick="downloadModuloPng('${escapeJs(slug)}');closeModuloDownloadMenu();">🖼 PNG</button>
              </div>
            </div>
            <button class="btn ghost" onclick="stampaModuloCompilato('${escapeJs(slug)}')">🖨 Stampa</button>
            ${navigator.share ? `<button class="btn ghost" onclick="shareModulo('${escapeJs(slug)}')">Condividi</button>` : ''}
            <button class="btn ghost" onclick="resetModuloFormValues('${escapeJs(slug)}')" style="margin-left:auto;">Resetta</button>
          </div>
        `}
      </aside>
      <section class="mod-preview" id="mod-preview-section">
        ${_renderModuloPaginatedPreview(slug, det)}
      </section>
    </div>`;
}

// Toggle modalità modifica box. Riapre il compilatore col nuovo stato.
function toggleModuloEditMode(slug) {
  const c = state.moduliCache[slug];
  if (!c) return;
  // Entrare in modalità modifica richiede il permesso; uscirne no
  if (!c.editMode && bloccaSeNonModifica('moduli')) return;
  // Se sto USCENDO dalla modalità modifica con modifiche non salvate, chiedi conferma
  if (c.editMode && _boxesAreDirty(slug)) {
    const ok = confirm('Ci sono modifiche non salvate ai box.\n\nUscendo dalla modalità modifica le modifiche restano in questa sessione ma non sul repo.\n\nVuoi uscire comunque? (Per salvare, usa "Salva")');
    if (!ok) return;
  }
  c.editMode = !c.editMode;
  c.selectedBoxIdx = null;
  _persistModulo(slug);
  renderModuloCompilatore(slug, c);
}

// Pannello laterale in modalità modifica: lista campi + dettaglio box selezionato.
function _renderModuloEditorPanel(slug, det) {
  const campiDefs = det.boxesData.campi_richiesti || [];
  const boxes = det.boxesData.box || [];
  const selIdx = det.selectedBoxIdx;
  const selBox = (selIdx != null) ? boxes[selIdx] : null;

  let detailsHtml = '';
  if (selBox) {
    const isFirma = selBox.tipo === 'firma';
    detailsHtml = `
      <div class="mod-edit-details">
        <div class="mod-edit-section-title">Box selezionato (#${selIdx + 1})</div>
        <div class="mod-field-group">
          <label class="mod-field-label">Tipo</label>
          <div class="mod-segmented">
            <button class="mod-seg ${!isFirma ? 'active' : ''}" onclick="setBoxTipo('${escapeJs(slug)}',${selIdx},'campo')">Campo dato</button>
            <button class="mod-seg ${isFirma ? 'active' : ''}" onclick="setBoxTipo('${escapeJs(slug)}',${selIdx},'firma')">Firma</button>
          </div>
        </div>
        ${!isFirma ? `
          <div class="mod-field-group">
            <label class="mod-field-label">Campo associato</label>
            <select class="mod-input" onchange="setBoxAttr('${escapeJs(slug)}',${selIdx},'campo',this.value)">
              <option value="">— scegli campo —</option>
              ${campiDefs.map(c => `<option value="${escapeHtml(c.id)}" ${selBox.campo === c.id ? 'selected' : ''}>${escapeHtml(c.label)} (${escapeHtml(c.tipo)})</option>`).join('')}
            </select>
          </div>
          ${(() => {
            const def = campiDefs.find(c => c.id === selBox.campo);
            if (!def) return '';
            const opts = _formatoOptionsPerTipo(def.tipo);
            if (!opts.length) return '';
            return `<div class="mod-field-group">
              <label class="mod-field-label">Formato</label>
              <select class="mod-input" onchange="setBoxAttr('${escapeJs(slug)}',${selIdx},'formato',this.value)">
                ${opts.map(o => `<option value="${escapeHtml(o.value)}" ${(selBox.formato || '') === o.value ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
              </select>
            </div>`;
          })()}
        ` : `
          <div class="mod-field-group">
            <label class="mod-field-label">Etichetta firma</label>
            <input type="text" class="mod-input" value="${escapeHtml(selBox.label || 'Firma')}"
                   oninput="setBoxAttr('${escapeJs(slug)}',${selIdx},'label',this.value)">
          </div>
        `}
        <div class="mod-field-group">
          <label class="mod-field-label">Allineamento testo</label>
          <div class="mod-segmented">
            <button class="mod-seg ${(selBox.align || 'left') === 'left' ? 'active' : ''}" onclick="setBoxAttr('${escapeJs(slug)}',${selIdx},'align','left')">Sx</button>
            <button class="mod-seg ${selBox.align === 'center' ? 'active' : ''}" onclick="setBoxAttr('${escapeJs(slug)}',${selIdx},'align','center')">Centro</button>
            <button class="mod-seg ${selBox.align === 'right' ? 'active' : ''}" onclick="setBoxAttr('${escapeJs(slug)}',${selIdx},'align','right')">Dx</button>
          </div>
        </div>
        <div class="mod-field-group">
          <label class="mod-field-label">Dimensione font (% pagina)</label>
          <div class="mod-fontsize-stepper">
            <button type="button" class="btn ghost mod-fs-btn" onclick="changeBoxFontSize('${escapeJs(slug)}',${selIdx},-0.2)" aria-label="Riduci dimensione font">−</button>
            <input type="text" inputmode="decimal" class="mod-input mod-fs-input" value="${selBox.font_size || 2.0}"
                   oninput="setBoxAttr('${escapeJs(slug)}',${selIdx},'font_size',Math.min(10,Math.max(0.5,parseFloat(this.value)||2.0)))">
            <button type="button" class="btn ghost mod-fs-btn" onclick="changeBoxFontSize('${escapeJs(slug)}',${selIdx},+0.2)" aria-label="Aumenta dimensione font">+</button>
          </div>
        </div>
        ${!isFirma ? `
          <div class="mod-field-group">
            <label class="mod-field-label">Distanza lettere</label>
            <div class="mod-fontsize-stepper">
              <button type="button" class="btn ghost mod-fs-btn" onclick="changeBoxLetterSpacing('${escapeJs(slug)}',${selIdx},-0.05)" aria-label="Riduci distanza lettere">−</button>
              <input type="text" inputmode="decimal" class="mod-input mod-fs-input mod-lh-input" value="${selBox.letter_spacing || 0}"
                     oninput="setBoxAttr('${escapeJs(slug)}',${selIdx},'letter_spacing',Math.min(3,Math.max(0,parseFloat(this.value)||0)))">
              <button type="button" class="btn ghost mod-fs-btn" onclick="changeBoxLetterSpacing('${escapeJs(slug)}',${selIdx},+0.05)" aria-label="Aumenta distanza lettere">+</button>
            </div>
            <p style="margin:4px 0 0;font-size:11px;color:var(--ink-muted);font-style:italic;">Spazio extra tra i caratteri (in em). Utile per campi con celle per lettera/numero.</p>
          </div>
          <div class="mod-field-group">
            <label class="mod-field-label">Testo</label>
            <div class="mod-segmented">
              <button class="mod-seg ${!selBox.multiline ? 'active' : ''}" onclick="setBoxMultiline('${escapeJs(slug)}',${selIdx},false)">Una riga</button>
              <button class="mod-seg ${selBox.multiline ? 'active' : ''}" onclick="setBoxMultiline('${escapeJs(slug)}',${selIdx},true)">Più righe</button>
            </div>
          </div>
          ${selBox.multiline ? `
            <div class="mod-field-group">
              <label class="mod-field-label">Numero di righe</label>
              <div class="mod-fontsize-stepper">
                <button type="button" class="btn ghost mod-fs-btn" onclick="changeBoxLines('${escapeJs(slug)}',${selIdx},-1)" aria-label="Meno righe">−</button>
                <input type="text" inputmode="numeric" class="mod-input mod-fs-input mod-lh-input" value="${selBox.lines || 2}"
                       oninput="setBoxAttr('${escapeJs(slug)}',${selIdx},'lines',Math.min(30,Math.max(1,Math.round(parseFloat(this.value)||2))))">
                <button type="button" class="btn ghost mod-fs-btn" onclick="changeBoxLines('${escapeJs(slug)}',${selIdx},+1)" aria-label="Più righe">+</button>
              </div>
              <p style="margin:4px 0 0;font-size:11px;color:var(--ink-muted);font-style:italic;">In modifica vedi le righe come guide: dimensiona il box così che il testo ci stia senza tagliarsi.</p>
            </div>
            <div class="mod-field-group">
              <label class="mod-field-label">Interlinea (distanza tra le righe)</label>
              <div class="mod-fontsize-stepper">
                <button type="button" class="btn ghost mod-fs-btn" onclick="changeBoxLineHeight('${escapeJs(slug)}',${selIdx},-0.1)" aria-label="Riduci interlinea">−</button>
                <input type="text" inputmode="decimal" class="mod-input mod-fs-input mod-lh-input" value="${selBox.line_height || 1.2}"
                       oninput="setBoxAttr('${escapeJs(slug)}',${selIdx},'line_height',Math.min(3,Math.max(0.8,parseFloat(this.value)||1.2)))">
                <button type="button" class="btn ghost mod-fs-btn" onclick="changeBoxLineHeight('${escapeJs(slug)}',${selIdx},+0.1)" aria-label="Aumenta interlinea">+</button>
              </div>
            </div>
          ` : ''}
        ` : ''}
        <div class="mod-form-actions" style="margin-top:12px;display:flex;gap:8px;">
          <button class="btn ghost" onclick="duplicateModuloBox('${escapeJs(slug)}',${selIdx})">Duplica</button>
          <button class="btn ghost" style="color:#A32D2D;" onclick="deleteModuloBox('${escapeJs(slug)}',${selIdx})">Elimina</button>
        </div>
      </div>`;
  }

  const boxListHtml = boxes.length ? boxes.map((b, i) => {
    const def = campiDefs.find(c => c.id === b.campo);
    const label = b.tipo === 'firma' ? `✎ ${b.label || 'Firma'}` : (def ? def.label : (b.campo || '— senza campo —'));
    return `<div class="mod-box-list-item ${selIdx === i ? 'selected' : ''}" onclick="selectModuloBox('${escapeJs(slug)}',${i})">
      <span class="mod-box-list-num">#${i + 1}</span>
      <span class="mod-box-list-label">${escapeHtml(label)}</span>
      <span class="mod-box-list-page">p${b.pagina || 1}</span>
    </div>`;
  }).join('') : '<p style="margin:0;color:var(--ink-muted);font-size:12px;font-style:italic;">Nessun box. Clicca "+ Aggiungi box" per iniziare.</p>';

  return `
    <div class="mod-form-head">
      <h3 style="margin:0 0 6px 0;font-family:var(--serif);font-size:18px;">Editor box</h3>
      <p style="margin:0;font-size:12px;color:var(--ink-muted);">Posiziona i box sul modulo. Le modifiche restano in questa sessione finché non vengono salvate sul repo (Tappa 5).</p>
    </div>
    <div class="mod-edit-section">
      <div class="mod-edit-section-title">Gestione pagine</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn ghost" onclick="inserisciPaginaModulo('${escapeJs(slug)}')">+ Inserisci pagina</button>
        <button class="btn ghost" style="color:#A32D2D;" onclick="rimuoviPaginaModulo('${escapeJs(slug)}', ${det.currentPage || 1})">− Rimuovi pagina ${det.currentPage || 1}</button>
      </div>
      <p style="margin:6px 0 0;font-size:11px;color:var(--ink-muted);font-style:italic;">Inserendo/rimuovendo pagine i box scorrono con le rispettive pagine; quelli della pagina rimossa vengono eliminati. Operazione salvata subito sul repo.</p>
    </div>
    <div class="mod-edit-section">
      <div class="mod-edit-section-title">Campi del documento (${campiDefs.length})</div>
      <div class="mod-campi-list">
        ${campiDefs.length ? campiDefs.map(cd => `
          <div class="mod-campo-item">
            <span class="mod-campo-label">${escapeHtml(cd.label)}</span>
            <span class="mod-campo-tipo">${escapeHtml(_tipoCampoLabel(cd.tipo))}</span>
            <button class="mod-campo-btn" title="Rinomina / cambia tipo" onclick="editModuloCampo('${escapeJs(slug)}','${escapeJs(cd.id)}')">✎</button>
            <button class="mod-campo-btn" title="Elimina campo" style="color:#A32D2D;" onclick="deleteModuloCampo('${escapeJs(slug)}','${escapeJs(cd.id)}')">×</button>
          </div>`).join('') : '<p style="margin:0;color:var(--ink-muted);font-size:12px;font-style:italic;">Nessun campo.</p>'}
      </div>
      <button class="btn ghost" style="margin-top:8px;" onclick="addModuloCampo('${escapeJs(slug)}')">+ Aggiungi campo</button>
      <p style="margin:6px 0 0;font-size:11px;color:var(--ink-muted);font-style:italic;">I campi qui elencati sono selezionabili come "Campo associato" nei box. Es. "Quesito diagnostico" (testo lungo).</p>
    </div>
    <div class="mod-edit-section">
      <div class="mod-edit-section-title">Tutti i box (${boxes.length})</div>
      <div class="mod-box-list">${boxListHtml}</div>
    </div>
    ${detailsHtml}`;
}

// Etichetta leggibile per il tipo di campo (usata nella lista campi dell'editor).
function _tipoCampoLabel(tipo) {
  const map = {
    testo: 'Testo breve', testo_lungo: 'Testo lungo', data: 'Data',
    paziente_completo: 'Paziente', medico_nome: 'Medico'
  };
  return map[tipo] || tipo;
}

// Tipi di campo creabili dall'utente nell'editor (i compositi paziente/medico restano
// riservati ai template e non vengono esposti qui).
const _MODULO_CAMPO_TIPI = [
  { value: 'testo', label: 'Testo breve (una riga)' },
  { value: 'testo_lungo', label: 'Testo lungo (più righe)' },
  { value: 'data', label: 'Data' }
];

// Apre la modale per creare (campoId null) o modificare un campo del modulo.
function addModuloCampo(slug) { _openCampoModal(slug, null); }
function editModuloCampo(slug, campoId) { _openCampoModal(slug, campoId); }

function _openCampoModal(slug, campoId) {
  const c = state.moduliCache[slug];
  if (!c || !c.boxesData) return;
  const campi = c.boxesData.campi_richiesti || [];
  const existing = campoId ? campi.find(x => x.id === campoId) : null;
  const isEdit = !!existing;
  // Se il campo è di tipo composito (paziente/medico) non espongo il selettore tipo: solo rinomina.
  const tipoRiservato = isEdit && !_MODULO_CAMPO_TIPI.some(t => t.value === existing.tipo);
  const tipoOpts = _MODULO_CAMPO_TIPI
    .map(t => `<option value="${t.value}" ${existing && existing.tipo === t.value ? 'selected' : ''}>${escapeHtml(t.label)}</option>`)
    .join('');
  const body = `
    <div style="margin-bottom:12px;">
      <label style="display:block;font-size:12px;color:var(--ink-muted);margin-bottom:4px;">Etichetta *</label>
      <input type="text" id="campo-label-input" class="mono-input" style="width:100%;" placeholder="es. Quesito diagnostico" value="${escapeHtml(existing ? existing.label : '')}">
    </div>
    ${tipoRiservato
      ? `<p style="font-size:12px;color:var(--ink-muted);margin:0;">Tipo: ${escapeHtml(_tipoCampoLabel(existing.tipo))} (non modificabile)</p>`
      : `<div>
          <label style="display:block;font-size:12px;color:var(--ink-muted);margin-bottom:4px;">Tipo</label>
          <select id="campo-tipo-input" class="mono-input" style="width:100%;">${tipoOpts}</select>
        </div>`}`;
  showModal({
    title: isEdit ? 'Modifica campo' : 'Nuovo campo',
    body,
    actions: [
      { label: 'Annulla', variant: 'ghost', onClick: () => closeModal() },
      { label: isEdit ? 'Salva' : 'Aggiungi', onClick: () => _confermaCampoModal(slug, campoId) }
    ]
  });
  setTimeout(() => { const el = document.getElementById('campo-label-input'); if (el) el.focus(); }, 50);
}

function _confermaCampoModal(slug, campoId) {
  const c = state.moduliCache[slug];
  if (!c || !c.boxesData) return;
  if (!c.boxesData.campi_richiesti) c.boxesData.campi_richiesti = [];
  const campi = c.boxesData.campi_richiesti;
  const label = (document.getElementById('campo-label-input') || {}).value;
  const labelTrim = (label || '').trim();
  if (!labelTrim) { toast('Etichetta obbligatoria', 'warning'); return; }
  const tipoEl = document.getElementById('campo-tipo-input');
  if (campoId) {
    const existing = campi.find(x => x.id === campoId);
    if (!existing) { closeModal(); return; }
    existing.label = labelTrim;
    if (tipoEl) existing.tipo = tipoEl.value;
  } else {
    const tipo = tipoEl ? tipoEl.value : 'testo';
    // id univoco derivato dall'etichetta
    let base = slugifyLocal(labelTrim).slice(0, 40) || 'campo';
    let id = base, n = 2;
    while (campi.some(x => x.id === id)) { id = base + '-' + n; n++; }
    campi.push({ id, label: labelTrim, tipo });
  }
  closeModal();
  _persistModulo(slug);
  refreshModuloOverlays(slug);
  _refreshModuloEditorPanelLight(slug);
}

function deleteModuloCampo(slug, campoId) {
  const c = state.moduliCache[slug];
  if (!c || !c.boxesData) return;
  const campi = c.boxesData.campi_richiesti || [];
  const campo = campi.find(x => x.id === campoId);
  if (!campo) return;
  const boxesUsing = (c.boxesData.box || []).filter(b => b.campo === campoId);
  const msg = boxesUsing.length
    ? `Eliminare il campo "${campo.label}"?\n\nÈ associato a ${boxesUsing.length} box: verranno scollegati (i box restano ma senza campo).`
    : `Eliminare il campo "${campo.label}"?`;
  if (!confirm(msg)) return;
  c.boxesData.campi_richiesti = campi.filter(x => x.id !== campoId);
  // Scollega i box che usavano il campo eliminato
  (c.boxesData.box || []).forEach(b => { if (b.campo === campoId) { b.campo = ''; delete b.formato; } });
  _persistModulo(slug);
  refreshModuloOverlays(slug);
  _refreshModuloEditorPanelLight(slug);
}

// Sceglie un box (lo evidenzia + apre il pannello dettagli)
function selectModuloBox(slug, idx) {
  const c = state.moduliCache[slug];
  if (!c) return;
  c.selectedBoxIdx = (c.selectedBoxIdx === idx) ? null : idx;
  // Se il box è su un'altra pagina, salta a quella (richiede full re-render)
  const b = (c.boxesData.box || [])[idx];
  const pageChanged = b && (b.pagina || 1) !== c.currentPage;
  if (pageChanged) c.currentPage = b.pagina || 1;
  _persistModulo(slug);
  if (pageChanged) {
    renderModuloCompilatore(slug, c);
  } else {
    // Refresh leggero: solo overlay (per ridipingere selected/handles) + panel (per dettagli)
    refreshModuloOverlays(slug);
    _refreshModuloEditorPanelLight(slug);
  }
}

// Aggiunge un nuovo box di default al centro di ciò che l'utente sta GUARDANDO (viewport
// scrollata/zoomata), così appare subito a schermo invece che in una posizione fissa.
function addModuloBox(slug) {
  const c = state.moduliCache[slug];
  if (!c) return;
  const W = 40, H = 4;
  let x = 30, y = 45;
  // Centro visibile → coordinate % del layer overlay
  const scrollEl = document.getElementById('mod-page-scroll-' + slug);
  const layer = document.getElementById('mod-overlay-' + slug);
  if (scrollEl && layer) {
    const layerRect = layer.getBoundingClientRect();
    const scRect = scrollEl.getBoundingClientRect();
    if (layerRect.width > 0 && layerRect.height > 0) {
      const cxScreen = scRect.left + scRect.width / 2;
      const cyScreen = scRect.top + scRect.height / 2;
      x = ((cxScreen - layerRect.left) / layerRect.width) * 100 - W / 2;
      y = ((cyScreen - layerRect.top) / layerRect.height) * 100 - H / 2;
    }
  }
  if (c.showGrid) { const g = 2; x = Math.round(x / g) * g; y = Math.round(y / g) * g; }
  x = Math.max(0, Math.min(100 - W, x));
  y = Math.max(0, Math.min(100 - H, y));
  const newBox = {
    pagina: c.currentPage || 1,
    x, y, w: W, h: H,
    campo: '',
    align: 'left',
    font_size: 2.0  // % dell'altezza pagina (universale)
  };
  if (!c.boxesData.box) c.boxesData.box = [];
  c.boxesData.box.push(newBox);
  c.selectedBoxIdx = c.boxesData.box.length - 1;
  _persistModulo(slug);
  refreshModuloOverlays(slug);
  _refreshModuloEditorPanelLight(slug);
}

// Toggle griglia di allineamento (con snap-to-grid durante drag/resize). Stato in cache.
function toggleModuloGrid(slug) {
  const c = state.moduliCache[slug];
  if (!c) return;
  c.showGrid = !c.showGrid;
  const layer = document.getElementById('mod-overlay-' + slug);
  if (layer) {
    if (c.showGrid) layer.classList.add('grid-on');
    else layer.classList.remove('grid-on');
  }
  _refreshModuloToolbar(slug);
}

// Duplica un box (offset di 2% per non sovrapporlo)
function duplicateModuloBox(slug, idx) {
  const c = state.moduliCache[slug];
  if (!c || !c.boxesData.box || !c.boxesData.box[idx]) return;
  const orig = c.boxesData.box[idx];
  const copy = JSON.parse(JSON.stringify(orig));
  copy.x = Math.min(95, (copy.x || 0) + 2);
  copy.y = Math.min(95, (copy.y || 0) + 2);
  c.boxesData.box.push(copy);
  c.selectedBoxIdx = c.boxesData.box.length - 1;
  _persistModulo(slug);
  refreshModuloOverlays(slug);
  _refreshModuloEditorPanelLight(slug);
}

// Elimina un box (con conferma)
function deleteModuloBox(slug, idx) {
  const c = state.moduliCache[slug];
  if (!c || !c.boxesData.box) return;
  if (!confirm('Eliminare questo box?')) return;
  c.boxesData.box.splice(idx, 1);
  c.selectedBoxIdx = null;
  _persistModulo(slug);
  refreshModuloOverlays(slug);
  _refreshModuloEditorPanelLight(slug);
}

// Setta un attributo (campo, align, font_size, label, formato) di un box
// Incrementa/decrementa la dimensione del font del box selezionato.
// font_size è in % dell'ALTEZZA della pagina (universale tra dispositivi). Step 0.2%, range 0.5–10%.
// Usato dai bottoni +/- nel pannello editor: aggiorna il valore dell'input visualizzato
// e re-renderizza l'overlay con il nuovo font (auto-fit lo ridurrà ulteriormente se serve).
function changeBoxFontSize(slug, idx, delta) {
  const c = state.moduliCache[slug];
  if (!c || !c.boxesData.box || !c.boxesData.box[idx]) return;
  const cur = c.boxesData.box[idx].font_size || 2.0;
  const next = Math.round(Math.max(0.5, Math.min(10, cur + delta)) * 10) / 10;
  if (next === cur) return;
  c.boxesData.box[idx].font_size = next;
  const input = document.querySelector('.mod-fs-input');
  if (input) input.value = next;
  _persistModulo(slug);
  refreshModuloOverlays(slug);
  _refreshModuloToolbar(slug);
}

// Attiva/disattiva il testo su più righe per un box. Con multiline attivo il testo va a capo
// (a-capo automatico + \n espliciti) e diventa regolabile con l'interlinea. Cambia i controlli
// del pannello (mostra/nasconde l'interlinea), quindi qui SI fa re-render del panel.
function setBoxMultiline(slug, idx, val) {
  const c = state.moduliCache[slug];
  if (!c || !c.boxesData.box || !c.boxesData.box[idx]) return;
  const box = c.boxesData.box[idx];
  if (val) { box.multiline = true; if (box.line_height == null) box.line_height = 1.2; if (box.lines == null) box.lines = 2; }
  else { delete box.multiline; delete box.line_height; delete box.lines; }
  _persistModulo(slug);
  refreshModuloOverlays(slug);
  _refreshModuloEditorPanelLight(slug);
}

// Incrementa/decrementa il numero di righe del box (solo box multi-riga). Step 1, range 1–30.
function changeBoxLines(slug, idx, delta) {
  const c = state.moduliCache[slug];
  if (!c || !c.boxesData.box || !c.boxesData.box[idx]) return;
  const box = c.boxesData.box[idx];
  const cur = box.lines || 2;
  box.lines = Math.min(30, Math.max(1, Math.round(cur + delta)));
  _persistModulo(slug);
  refreshModuloOverlays(slug);
  _refreshModuloEditorPanelLight(slug);
}

// Incrementa/decrementa la distanza tra le lettere (em) del box. Step 0.05, range 0–3.
function changeBoxLetterSpacing(slug, idx, delta) {
  const c = state.moduliCache[slug];
  if (!c || !c.boxesData.box || !c.boxesData.box[idx]) return;
  const box = c.boxesData.box[idx];
  const cur = box.letter_spacing || 0;
  box.letter_spacing = Math.min(3, Math.max(0, Math.round((cur + delta) * 100) / 100));
  _persistModulo(slug);
  refreshModuloOverlays(slug);
  _refreshModuloEditorPanelLight(slug);
}

// Incrementa/decrementa l'interlinea del box selezionato (solo box multi-riga). Step 0.1, range 0.8–3.
function changeBoxLineHeight(slug, idx, delta) {
  const c = state.moduliCache[slug];
  if (!c || !c.boxesData.box || !c.boxesData.box[idx]) return;
  const cur = c.boxesData.box[idx].line_height || 1.2;
  const next = Math.round(Math.max(0.8, Math.min(3, cur + delta)) * 10) / 10;
  if (next === cur) return;
  c.boxesData.box[idx].line_height = next;
  const input = document.querySelector('.mod-lh-input');
  if (input) input.value = next;
  _persistModulo(slug);
  refreshModuloOverlays(slug);
  _refreshModuloToolbar(slug);
}

function setBoxAttr(slug, idx, attr, value) {
  const c = state.moduliCache[slug];
  if (!c || !c.boxesData.box || !c.boxesData.box[idx]) return;
  c.boxesData.box[idx][attr] = value;
  // Quando cambia il campo: reset del formato (le opzioni dipendono dal tipo del nuovo campo,
  // i valori vecchi non sono compatibili con il nuovo tipo).
  if (attr === 'campo') {
    delete c.boxesData.box[idx].formato;
  }
  _persistModulo(slug);
  refreshModuloOverlays(slug);
  // Re-render del panel quando cambia 'campo' (le opzioni del dropdown formato dipendono dal
  // tipo del campo) o 'align' (i pulsanti segmentati Sx/Centro/Dx devono aggiornare lo stato
  // attivo → cambio colore). Per font_size/formato niente re-render → niente focus perso.
  if (attr === 'campo' || attr === 'align') {
    _refreshModuloEditorPanelLight(slug); // aggiorna anche la toolbar
  } else {
    _refreshModuloToolbar(slug); // il dirty può essere cambiato: aggiorno i pulsanti salva/scarta
  }
}

// Cambia il tipo di box: 'campo' = legato a un campo, 'firma' = solo placeholder.
// Cambia la struttura dei controlli del pannello (mostra/nasconde dropdown campo/formato),
// quindi qui SI fa re-render del panel.
function setBoxTipo(slug, idx, tipo) {
  const c = state.moduliCache[slug];
  if (!c || !c.boxesData.box || !c.boxesData.box[idx]) return;
  const b = c.boxesData.box[idx];
  if (tipo === 'firma') {
    b.tipo = 'firma';
    b.label = b.label || 'Firma';
    delete b.campo;
    delete b.formato;
  } else {
    delete b.tipo;
    delete b.label;
  }
  _persistModulo(slug);
  refreshModuloOverlays(slug);
  _refreshModuloEditorPanelLight(slug);
}

// Renderizza un singolo campo del form. Aggiorna `state.moduliCache[slug].formValues[c.id]`
// e ri-renderizza i box overlay sulla preview a ogni input change.
function _renderCampoInput(c, value, slug) {
  const id = `mod-fld-${c.id}`;
  const required = c.required ? ' <span style="color:#A32D2D;">*</span>' : '';
  if (c.tipo === 'paziente_completo') {
    const v = value || {};
    const salvati = userPrefs.getPazientiSalvati();
    const recenti = _getPazientiRecenti();
    const showSelector = salvati.length > 0 || recenti.length > 0;
    const optSalvati = salvati.length
      ? `<optgroup label="★ Salvati">${salvati.map((p, i) => `<option value="s:${i}">${escapeHtml(p.cognome)} ${escapeHtml(p.nome)}${p.dataNascita ? ' · ' + escapeHtml(p.dataNascita) : ''}</option>`).join('')}</optgroup>`
      : '';
    const optRecenti = recenti.length
      ? `<optgroup label="Recenti (questa sessione)">${recenti.map((p, i) => `<option value="r:${i}">${escapeHtml(p.cognome)} ${escapeHtml(p.nome)}${p.dataNascita ? ' · ' + escapeHtml(p.dataNascita) : ''}</option>`).join('')}</optgroup>`
      : '';
    return `
      <div class="mod-field-group">
        <label class="mod-field-label">${escapeHtml(c.label)}${required}</label>
        ${showSelector ? `
          <select class="mod-input" style="margin-bottom:6px;" onchange="selezionaPaziente('${escapeJs(slug)}','${escapeJs(c.id)}',this.value);this.value='';">
            <option value="">— Carica un paziente —</option>
            ${optSalvati}${optRecenti}
          </select>
        ` : ''}
        <div class="mod-field-grid-2">
          <input type="text" placeholder="Cognome" class="mod-input" value="${escapeHtml(v.cognome || '')}"
                 data-paziente-field="cognome" data-paziente-fid="${escapeHtml(c.id)}"
                 oninput="updateModuloField('${escapeJs(slug)}','${escapeJs(c.id)}','cognome',this.value)"
                 onblur="_salvaPazienteSeCompleto('${escapeJs(slug)}','${escapeJs(c.id)}')">
          <input type="text" placeholder="Nome" class="mod-input" value="${escapeHtml(v.nome || '')}"
                 data-paziente-field="nome" data-paziente-fid="${escapeHtml(c.id)}"
                 oninput="updateModuloField('${escapeJs(slug)}','${escapeJs(c.id)}','nome',this.value)"
                 onblur="_salvaPazienteSeCompleto('${escapeJs(slug)}','${escapeJs(c.id)}')">
        </div>
        <input type="text" inputmode="numeric" placeholder="gg/mm/aaaa" class="mod-input" style="margin-top:6px;"
               value="${escapeHtml(v.dataNascita || '')}"
               data-paziente-field="dataNascita" data-paziente-fid="${escapeHtml(c.id)}"
               oninput="maskDataInput(this,'${escapeJs(slug)}','${escapeJs(c.id)}','dataNascita')"
               onblur="_salvaPazienteSeCompleto('${escapeJs(slug)}','${escapeJs(c.id)}')">
        <div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn ghost sm" onclick="salvaPazienteCorrente('${escapeJs(slug)}','${escapeJs(c.id)}')" title="Salva questo paziente per le prossime volte">💾 Salva paziente</button>
          ${salvati.length ? `<button class="btn ghost sm" onclick="gestisciPazientiSalvati('${escapeJs(slug)}','${escapeJs(c.id)}')" title="Gestisci ed elimina i pazienti salvati">🗂 Gestisci salvati (${salvati.length})</button>` : ''}
        </div>
      </div>`;
  }
  if (c.tipo === 'medico_nome') {
    const v = value || { cognome: '', nome: '' };
    return `
      <div class="mod-field-group">
        <label class="mod-field-label">${escapeHtml(c.label)}${required}</label>
        <div class="mod-field-grid-2">
          <input type="text" placeholder="Cognome" class="mod-input" value="${escapeHtml(v.cognome || '')}"
                 oninput="updateModuloField('${escapeJs(slug)}','${escapeJs(c.id)}','cognome',this.value)">
          <input type="text" placeholder="Nome" class="mod-input" value="${escapeHtml(v.nome || '')}"
                 oninput="updateModuloField('${escapeJs(slug)}','${escapeJs(c.id)}','nome',this.value)">
        </div>
      </div>`;
  }
  if (c.tipo === 'data') {
    return `
      <div class="mod-field-group">
        <label class="mod-field-label" for="${id}">${escapeHtml(c.label)}${required}</label>
        <input type="text" id="${id}" inputmode="numeric" class="mod-input" placeholder="gg/mm/aaaa" value="${escapeHtml(value || '')}"
               oninput="maskDataInput(this,'${escapeJs(slug)}','${escapeJs(c.id)}',null)">
      </div>`;
  }
  if (c.tipo === 'testo_lungo') {
    return `
      <div class="mod-field-group">
        <label class="mod-field-label" for="${id}">${escapeHtml(c.label)}${required}</label>
        <textarea id="${id}" class="mod-input" rows="2"
                  oninput="updateModuloField('${escapeJs(slug)}','${escapeJs(c.id)}',null,this.value)">${escapeHtml(value || '')}</textarea>
      </div>`;
  }
  // default: testo
  return `
    <div class="mod-field-group">
      <label class="mod-field-label" for="${id}">${escapeHtml(c.label)}${required}</label>
      <input type="text" id="${id}" class="mod-input" value="${escapeHtml(value || '')}"
             oninput="updateModuloField('${escapeJs(slug)}','${escapeJs(c.id)}',null,this.value)">
    </div>`;
}

// Maschera per gli input data: mentre l'utente digita le cifre, inserisce automaticamente gli
// slash nelle posizioni gg/mm/aaaa. Accetta sia anno intero (4 cifre) sia ridotto (2 cifre): non
// forza la lunghezza dell'anno, così "01/02/26" e "01/02/2026" sono entrambi validi (l'espansione
// del secolo avviene poi in _parseDataString). Aggiorna l'input in-place e propaga il valore.
function maskDataInput(el, slug, fieldId, subKey) {
  const raw = el.value;
  // Tengo solo le cifre; ammetto fino a 8 (gg mm aaaa). Se l'utente digita più di 8, taglio.
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  let out = digits;
  if (digits.length > 4) out = digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4);
  else if (digits.length > 2) out = digits.slice(0, 2) + '/' + digits.slice(2);
  // Se l'utente sta cancellando e resta uno slash finale "12/", lo lascio per non bloccare.
  el.value = out;
  if (subKey) updateModuloField(slug, fieldId, subKey, out);
  else updateModuloField(slug, fieldId, null, out);
}

// Update field handler: aggiorna stato + re-render overlay (NON l'intero compilatore)
function updateModuloField(slug, fieldId, subKey, val) {
  const c = state.moduliCache[slug];
  if (!c) return;
  if (subKey) {
    if (typeof c.formValues[fieldId] !== 'object') c.formValues[fieldId] = {};
    c.formValues[fieldId][subKey] = val;
  } else {
    c.formValues[fieldId] = val;
  }
  _persistModulo(slug);
  // Aggiorno solo gli overlay box, non l'intero form (evita perdita focus)
  refreshModuloOverlays(slug);
}

/* --------- Pazienti recenti (cache di sessione) ---------
   Quando l'utente compila il form di un modulo con cognome+nome+dataNascita completi,
   salviamo il paziente in sessionStorage. Al prossimo modulo nella stessa sessione, mostriamo
   un dropdown coi pazienti recenti per selezione rapida.
   Privacy: i dati restano SOLO sul dispositivo dell'utente nel tab corrente — alla chiusura
   del tab/browser la lista viene svuotata automaticamente. Mai inviati al repo o a server.
   Lista massima 20 pazienti, FIFO. */
const PAZIENTI_RECENTI_KEY = 'collinetta:pazienti_recenti';
const PAZIENTI_RECENTI_MAX = 20;

function _getPazientiRecenti() {
  try {
    const raw = sessionStorage.getItem(PAZIENTI_RECENTI_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function _setPazientiRecenti(arr) {
  try {
    sessionStorage.setItem(PAZIENTI_RECENTI_KEY, JSON.stringify(arr.slice(0, PAZIENTI_RECENTI_MAX)));
  } catch (e) {
    console.warn('[pazientiRecenti] sessionStorage write fallito:', e);
  }
}

// Chiamata al blur dei campi paziente: se cognome+nome+dataNascita sono tutti compilati,
// salva il paziente nei recenti (deduplicato per cognome+nome+dataNascita case-insensitive).
function _salvaPazienteSeCompleto(slug, fieldId) {
  const c = state.moduliCache[slug];
  if (!c) return;
  const v = c.formValues[fieldId];
  if (!v || typeof v !== 'object') return;
  const cognome = (v.cognome || '').trim();
  const nome = (v.nome || '').trim();
  const dataNascita = (v.dataNascita || '').trim();
  if (!cognome || !nome || !dataNascita) return;
  // Validazione minima della data: deve avere almeno 3 numeri separati
  const parsed = _parseDataString(dataNascita);
  if (!parsed) return;
  const recenti = _getPazientiRecenti();
  const key = (cognome + '|' + nome + '|' + dataNascita).toLowerCase();
  // Rimuovo eventuale duplicato e lo rimetto in cima (most-recent-first)
  const filtered = recenti.filter(p =>
    (p.cognome + '|' + p.nome + '|' + p.dataNascita).toLowerCase() !== key
  );
  filtered.unshift({ cognome, nome, dataNascita, salvato: new Date().toISOString() });
  _setPazientiRecenti(filtered);
}

// Selezione di un paziente recente dal dropdown: popola i 3 campi del form e refresh overlay.
function selezionaPazienteRecente(slug, fieldId, idx) {
  const i = parseInt(idx, 10);
  if (isNaN(i)) return;
  const recenti = _getPazientiRecenti();
  const p = recenti[i];
  if (!p) return;
  const c = state.moduliCache[slug];
  if (!c) return;
  if (typeof c.formValues[fieldId] !== 'object') c.formValues[fieldId] = {};
  c.formValues[fieldId].cognome = p.cognome;
  c.formValues[fieldId].nome = p.nome;
  c.formValues[fieldId].dataNascita = p.dataNascita;
  _persistModulo(slug);
  // Aggiorno gli input visivamente (no full re-render: preservo focus altri campi)
  const cognomeInput = document.querySelector(`input[data-paziente-fid="${fieldId}"][data-paziente-field="cognome"]`);
  const nomeInput = document.querySelector(`input[data-paziente-fid="${fieldId}"][data-paziente-field="nome"]`);
  const dataInput = document.querySelector(`input[data-paziente-fid="${fieldId}"][data-paziente-field="dataNascita"]`);
  if (cognomeInput) cognomeInput.value = p.cognome;
  if (nomeInput) nomeInput.value = p.nome;
  if (dataInput) dataInput.value = p.dataNascita;
  refreshModuloOverlays(slug);
  // Sposta il paziente in cima ai recenti (è quello appena usato)
  const filtered = recenti.filter((_, j) => j !== i);
  filtered.unshift(p);
  _setPazientiRecenti(filtered);
}

// Selezione da dropdown unificato: "s:i" = salvato persistente, "r:i" = recente di sessione.
function selezionaPaziente(slug, fieldId, val) {
  if (!val) return;
  const m = String(val).match(/^([sr]):(\d+)$/);
  if (!m) return;
  const idx = parseInt(m[2], 10);
  const p = m[1] === 's' ? userPrefs.getPazientiSalvati()[idx] : _getPazientiRecenti()[idx];
  if (!p) return;
  const c = state.moduliCache[slug];
  if (!c) return;
  if (typeof c.formValues[fieldId] !== 'object') c.formValues[fieldId] = {};
  c.formValues[fieldId].cognome = p.cognome;
  c.formValues[fieldId].nome = p.nome;
  c.formValues[fieldId].dataNascita = p.dataNascita;
  _persistModulo(slug);
  const ci = document.querySelector(`input[data-paziente-fid="${fieldId}"][data-paziente-field="cognome"]`);
  const ni = document.querySelector(`input[data-paziente-fid="${fieldId}"][data-paziente-field="nome"]`);
  const di = document.querySelector(`input[data-paziente-fid="${fieldId}"][data-paziente-field="dataNascita"]`);
  if (ci) ci.value = p.cognome;
  if (ni) ni.value = p.nome;
  if (di) di.value = p.dataNascita;
  refreshModuloOverlays(slug);
}

// Salva esplicitamente il paziente corrente nei salvati persistenti (per-utente).
function salvaPazienteCorrente(slug, fieldId) {
  const c = state.moduliCache[slug];
  if (!c) return;
  const v = c.formValues[fieldId];
  if (!v || typeof v !== 'object' || !(v.cognome || '').trim() || !(v.nome || '').trim() || !(v.dataNascita || '').trim()) {
    toast('Compila cognome, nome e data di nascita prima di salvare.', 'error');
    return;
  }
  const ok = userPrefs.savePazienteSalvato({ cognome: v.cognome, nome: v.nome, dataNascita: v.dataNascita });
  toast(ok ? 'Paziente salvato.' : 'Paziente già presente tra i salvati.', ok ? 'success' : 'info');
  renderModuloCompilatore(slug, c);
}

// Modal di gestione: elenco dei pazienti salvati con eliminazione.
function gestisciPazientiSalvati(slug, fieldId) {
  const list = userPrefs.getPazientiSalvati();
  const rows = list.length
    ? list.map(p => {
        const key = userPrefs._pazienteKey(p);
        return `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--rule-soft);">
          <div style="flex:1;min-width:0;">
            <div style="font-size:14px;color:var(--ink);">${escapeHtml(p.cognome)} ${escapeHtml(p.nome)}</div>
            <div style="font-size:12px;color:var(--ink-muted);font-family:var(--mono);">${escapeHtml(p.dataNascita || '')}</div>
          </div>
          <button class="btn ghost danger sm" onclick="eliminaPazienteSalvato('${escapeJs(key)}','${escapeJs(slug)}','${escapeJs(fieldId)}')" title="Elimina dai salvati">🗑</button>
        </div>`;
      }).join('')
    : '<div style="padding:12px 0;color:var(--ink-muted);font-style:italic;">Nessun paziente salvato.</div>';
  showModal({
    title: 'Pazienti salvati',
    subtitle: 'Dati memorizzati solo nelle tue preferenze personali.',
    body: `<div style="min-width:min(420px,86vw);">${rows}</div>`,
    actions: [{ label: 'Chiudi', variant: 'ghost', onClick: () => closeModal() }]
  });
}

function eliminaPazienteSalvato(key, slug, fieldId) {
  userPrefs.deletePazienteSalvato(key);
  gestisciPazientiSalvati(slug, fieldId); // re-render del modal (showModal richiama closeModal)
  const c = state.moduliCache[slug];
  if (c) renderModuloCompilatore(slug, c);
}

function resetModuloFormValues(slug) {
  if (!confirm('Resettare tutti i campi compilati?')) return;
  const c = state.moduliCache[slug];
  if (!c) return;
  c.formValues = {};
  _persistModulo(slug);
  renderModuloCompilatore(slug, c);
}

// Renderizza l'intera area preview (header pagine + pagina corrente con overlay).
function _renderModuloPaginatedPreview(slug, det) {
  const { pageUrls, pageUrlsLight } = det;
  // Per il viewer/editor usiamo pageUrlsLight (versione ridimensionata, JPEG q.85 max 1200px)
  // se disponibile: rendering molto più veloce, scroll/zoom fluidi anche su mobile.
  // pageUrls (originali alta risoluzione) restano disponibili per la generazione PDF/PNG output.
  const displayUrls = pageUrlsLight && pageUrlsLight.length === pageUrls.length ? pageUrlsLight : pageUrls;
  const cur = det.currentPage || 1;
  const zoom = det.zoom || 1;
  const { navHtml, zoomToolbar } = _renderModuloPageNav(slug, det, 'compilatore');

  return `
    ${navHtml}
    ${zoomToolbar}
    <div class="mod-page-scroll" id="mod-page-scroll-${escapeHtml(slug)}">
      <div class="mod-page-stage" id="mod-page-stage-${escapeHtml(slug)}" style="position:relative;width:${zoom * 100}%;">
        <img class="mod-page-img" src="${displayUrls[cur - 1]}" alt="Pagina ${cur}"
             onload="onModuloPageImgLoad('${escapeJs(slug)}', this)"
             onerror="this.parentElement.innerHTML='<div style=padding:32px;text-align:center;color:var(--ink-muted);font-style:italic;>Pagina ${cur} non trovata. Verifica che <code>content/moduli/${escapeJs(slug)}/page-${cur}.png</code> sia caricato nel repo.</div>'">
        <div class="mod-overlay-layer" id="mod-overlay-${escapeHtml(slug)}" style="position:absolute;left:0;top:0;width:100%;height:100%;"></div>
      </div>
    </div>`;
}

// Cambia il livello di zoom della preview pagina (1.0 = 100%, range 0.5-4.0)
function setModuloZoom(slug, newZoom, mode) {
  const c = state.moduliCache[slug];
  if (!c) return;
  const oldZoom = c.zoom || 1;
  newZoom = Math.max(0.5, Math.min(4, newZoom));
  if (newZoom === oldZoom) return;
  mode = mode || 'compilatore';

  // Salvo il centro visibile della pagina PRIMA del re-render, così posso ricentrarlo dopo.
  // Il container scrollabile è .mod-page-scroll. Calcolo la posizione del punto centrale del
  // viewport rispetto al contenuto totale (in coordinate "non zoomate").
  // Nota: in mode='viewer' lo scroll element è dentro renderModuloViewer (no id-suffisso slug),
  // quindi cerchiamo per classe; in mode='compilatore' c'è il suffisso `mod-page-scroll-${slug}`.
  const scrollEl = mode === 'viewer'
    ? document.querySelector('#mod-viewer-section .mod-page-scroll')
    : document.getElementById('mod-page-scroll-' + slug);
  let centerXInContent = null, centerYInContent = null;
  if (scrollEl) {
    const visW = scrollEl.clientWidth;
    const visH = scrollEl.clientHeight;
    const cxPost = scrollEl.scrollLeft + visW / 2;
    const cyPost = scrollEl.scrollTop + visH / 2;
    const totalWPost = scrollEl.scrollWidth;
    const totalHPost = scrollEl.scrollHeight;
    if (totalWPost > 0) centerXInContent = cxPost / totalWPost;
    if (totalHPost > 0) centerYInContent = cyPost / totalHPost;
  }

  c.zoom = newZoom;
  _persistModulo(slug);

  // Re-render: viewer ricostruisce tutto, compilatore solo la sezione preview
  if (mode === 'viewer') {
    renderModuloViewer(slug, c);
  } else {
    const sec = document.getElementById('mod-preview-section');
    if (sec) sec.innerHTML = _renderModuloPaginatedPreview(slug, c);
    // L'immagine può essere già in cache (onload non rispara), quindi forzo il refresh degli
    // overlay/auto-fit sul nuovo layout zoomato, altrimenti il font non si ricalcola.
    requestAnimationFrame(() => refreshModuloOverlays(slug));
  }

  // Dopo il re-render: ricentro lo scroll sul punto che era al centro prima.
  if (centerXInContent != null) {
    requestAnimationFrame(() => {
      const newScrollEl = mode === 'viewer'
        ? document.querySelector('#mod-viewer-section .mod-page-scroll')
        : document.getElementById('mod-page-scroll-' + slug);
      if (!newScrollEl) return;
      const visW = newScrollEl.clientWidth;
      const visH = newScrollEl.clientHeight;
      const totalW = newScrollEl.scrollWidth;
      const totalH = newScrollEl.scrollHeight;
      newScrollEl.scrollLeft = Math.max(0, centerXInContent * totalW - visW / 2);
      newScrollEl.scrollTop = Math.max(0, centerYInContent * totalH - visH / 2);
    });
  }
}

// Quando l'immagine carica, allineo l'overlay alle dimensioni renderizzate
function onModuloPageImgLoad(slug, imgEl) {
  refreshModuloOverlays(slug);
}

// Cambia pagina visualizzata: re-renderizzo l'area preview (overlay si rinnoverà al carico img)
function changeModuloPage(slug, newPage, mode) {
  const c = state.moduliCache[slug];
  if (!c) return;
  c.currentPage = Math.max(1, Math.min(newPage, c.pageUrls.length));
  _persistModulo(slug);
  mode = mode || 'compilatore';
  if (mode === 'viewer') {
    renderModuloViewer(slug, c);
  } else {
    const sec = document.getElementById('mod-preview-section');
    if (sec) sec.innerHTML = _renderModuloPaginatedPreview(slug, c);
  }
}

// Ridisegna gli overlay del modulo (chiamato da updateModuloField + onModuloPageImgLoad).
// I box hanno coordinate in PERCENTUALE; con --img-w/h CSS vars (impostate qui),
// gli overlay si auto-allineano all'immagine renderizzata.
function refreshModuloOverlays(slug) {
  const c = state.moduliCache[slug];
  if (!c) return;
  const layer = document.getElementById('mod-overlay-' + slug);
  const stage = document.getElementById('mod-page-stage-' + slug);
  if (!layer || !stage) return;
  const img = stage.querySelector('img.mod-page-img');
  if (!img || !img.complete || !img.naturalWidth) return;

  // L'overlay si allinea all'immagine tramite CSS (stage position:relative + overlay
  // position:absolute; inset:0; width/height:100%): lo stage si dimensiona sull'immagine, quindi
  // le percentuali dei box combaciano sempre. NON misuro più img.clientWidth/Height in px: al
  // primo render (box vuoti, subito dopo il load) la misura poteva essere letta prima che il
  // layout dell'immagine fosse completo → overlay troppo alto → box giganti finché non si
  // ri-renderizzava (es. scrivendo in un campo). Forzo 100% inline (robusto anche se il CSS
  // .mod-overlay-layer arrivasse disallineato dalla cache): l'overlay copre esattamente lo stage.
  layer.style.width = '100%';
  layer.style.height = '100%';

  const editMode = !!c.editMode;
  const selIdx = c.selectedBoxIdx;
  const campiDefs = c.boxesData.campi_richiesti || [];
  const allBoxes = c.boxesData.box || [];
  // Manteniamo l'indice ORIGINALE (non quello nel filter) così i click selezionano il box giusto
  const visibleBoxIdx = allBoxes
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => (b.pagina || 1) === c.currentPage);

  // Quando in editMode l'overlay layer riceve eventi (per drag/resize/click)
  layer.style.pointerEvents = editMode ? 'auto' : 'none';
  // touch-action: in editMode permettiamo lo scroll/zoom del container parent (per navigare la
  // pagina zoomata) toccando aree vuote del layer; il blocco dello scroll è applicato SOLO sui
  // box (.mod-box ha touch-action:none in CSS), così tap su box → drag, tap fuori → scroll pagina.
  layer.style.touchAction = editMode ? 'pan-x pan-y' : '';

  // Griglia di allineamento (toggle): applico la classe a ogni refresh così persiste
  // anche dopo i re-render dell'overlay (selezione box, cambio valore, ecc.).
  if (editMode && c.showGrid) layer.classList.add('grid-on');
  else layer.classList.remove('grid-on');

  layer.innerHTML = visibleBoxIdx.map(({ b, i }) => {
    const value = _formatBoxValue(b, campiDefs, c.formValues);
    const isFirma = b.tipo === 'firma';
    // In editMode mostro un placeholder esemplificativo per i box senza valore reale
    // (così il box ha sempre del testo dentro, comportamento identico al box firma — niente
    // ::before pseudo-element né flusso flex variabile che causava scivolamento su Android).
    const placeholder = (!value && !isFirma && editMode) ? _placeholderForBox(b, campiDefs) : '';
    const isEmpty = !value && !isFirma && !placeholder;
    const display = isFirma ? '✎ Firma' : (value || placeholder);
    const align = b.align || 'left';
    const fontSizePct = b.font_size || 2.0;  // % dell'altezza della pagina (universale)
    const isSelected = editMode && i === selIdx;
    const nLines = b.multiline ? Math.max(1, Math.min(30, Math.round(b.lines || 2))) : 0;
    // Guide righe (solo in modifica, box multi-riga con ≥2 righe): linee orizzontali a ogni 1/N
    // dell'altezza, così si vede come sono disposte le righe e si dimensiona il box di conseguenza.
    const lineGuides = (editMode && b.multiline && nLines > 1)
      ? `background-image:repeating-linear-gradient(to bottom,transparent 0,transparent calc(100%/${nLines} - 1px),rgba(24,95,165,.35) calc(100%/${nLines} - 1px),rgba(24,95,165,.35) calc(100%/${nLines}));`
      : '';
    // N righe fisse: testo allineato in alto (riempie le righe dall'alto, coerente con guide e stampa).
    const topAlign = (b.multiline && nLines) ? 'align-items:flex-start;' : '';
    // Distanza lettere (em): spazio extra tra i caratteri, per campi con celle per lettera/numero.
    const ls = parseFloat(b.letter_spacing) || 0;
    const lsStyle = ls > 0 ? `letter-spacing:${ls}em;` : '';
    const handles = isSelected ? `
      <span class="mod-handle mod-handle-resize" data-handle="tr" title="Trascina per ridimensionare">⤢</span>
    ` : '';
    return `<div class="mod-box ${isEmpty ? 'mod-vuoto' : ''} ${placeholder ? 'mod-segnaposto' : ''} ${isFirma ? 'firma' : ''} ${b.multiline ? 'multiline' : ''} ${editMode ? 'editable' : ''} ${isSelected ? 'selected' : ''} ${align === 'center' ? 'align-center' : align === 'right' ? 'align-right' : ''}"
              data-box-idx="${i}" data-font-pct="${fontSizePct}" data-letter-spacing="${ls}"${b.multiline ? ` data-multiline="1" data-line-height="${b.line_height || 1.2}" data-lines="${nLines}"` : ''}
              style="left:${b.x}%;top:${b.y}%;width:${b.w}%;height:${b.h}%;
                     text-align:${align};${topAlign}${lsStyle}${lineGuides}"
              title="${escapeHtml(b.campo || b.label || '')}"><span class="mod-box-text">${escapeHtml(display)}</span>${handles}</div>`;
  }).join('');

  // Auto-fit del font: se il testo del box overflow rispetto alla sua larghezza/altezza,
  // riduco il font dinamicamente fino a fittare (min 6px). Il box rappresenta lo SPAZIO MASSIMO
  // disponibile sul modulo cartaceo, quindi il testo deve adattarsi a quello spazio.
  // Salto box vuoti e firma (non hanno valore variabile da adattare).
  // requestAnimationFrame: serve aspettare che il browser abbia layout-ato i box (clientWidth/Height
  // sono 0 finché il layout non è completato dopo l'innerHTML setting).
  requestAnimationFrame(() => {
    layer.querySelectorAll('.mod-box').forEach(boxEl => {
      if (boxEl.classList.contains('mod-vuoto') || boxEl.classList.contains('firma')) return;
      _autoFitBoxFont(boxEl);
    });
  });

  // Bind eventi drag/resize in editMode
  if (editMode) _bindModuloOverlayInteractions(slug, layer, img);
}

// Auto-fit del font dentro un box: parte dalla font_size configurata e riduce finché il
// testo non entra in larghezza+altezza (o si raggiunge il minimo 6px).
// MISURA con canvas measureText (NON scrollWidth/scrollHeight): su un flex con
// justify-content:center / align-items:center l'overflow è simmetrico e scrollWidth/Height NON
// lo riportano → i box centrati non si riducevano e il testo sforava. Canvas è indipendente
// dall'allineamento e usa lo STESSO metodo della stampa → editor e output coincidono.
let _autoFitCtx = null;
function _autoFitBoxFont(boxEl) {
  const textEl = boxEl.querySelector('.mod-box-text');
  if (!textEl) return;
  const text = textEl.textContent || '';
  if (!text) return;
  // baseSize ricavato da font_pct (% dell'ALTEZZA della pagina), come la stampa → universale.
  // Trovo l'altezza dell'immagine pagina (il layer dei box è dimensionato su di essa).
  const layer = boxEl.closest('.mod-overlay-layer') || boxEl.parentElement;
  const stage = layer ? layer.parentElement : null;
  const pageImg = stage ? stage.querySelector('img.mod-page-img') : null;
  const pageH = pageImg && pageImg.clientHeight > 0 ? pageImg.clientHeight : (layer ? layer.clientHeight : 0);
  const fontPct = parseFloat(boxEl.dataset.fontPct) || 2.0;
  const baseSize = pageH > 0 ? (fontPct / 100) * pageH : 11;
  const ls = parseFloat(boxEl.dataset.letterSpacing) || 0;  // distanza lettere in em
  const MIN_SIZE = 6;
  const cs = getComputedStyle(boxEl);
  const padL = parseFloat(cs.paddingLeft) || 0;
  const padR = parseFloat(cs.paddingRight) || 0;
  const availW = boxEl.clientWidth - padL - padR;
  const availH = boxEl.clientHeight;
  if (availW <= 0 || availH <= 0) return;
  if (!_autoFitCtx) _autoFitCtx = document.createElement('canvas').getContext('2d');
  const ctx = _autoFitCtx;
  const fam = cs.fontFamily || 'sans-serif';
  const style = cs.fontStyle || 'normal';
  const weight = cs.fontWeight || '400';
  // Box multi-riga: mando a capo il testo, calcolo il font che entra in larghezza+altezza con
  // l'interlinea richiesta e riscrivo lo span con gli a-capo calcolati (così la preview mostra
  // ESATTAMENTE le stesse righe della stampa, che usa lo stesso algoritmo di wrapping).
  if (boxEl.dataset.multiline === '1') {
    const lineHeight = parseFloat(boxEl.dataset.lineHeight) || 1.2;
    const targetLines = parseInt(boxEl.dataset.lines, 10) || 0;
    const buildFont = s => `${style} ${weight} ${s}px ${fam}`;
    const { size, lines } = _fitMultilineFont(ctx, text, availW, availH, baseSize, MIN_SIZE, lineHeight, buildFont, targetLines, ls);
    boxEl.style.fontSize = size + 'px';
    boxEl.style.lineHeight = String(lineHeight);
    textEl.textContent = lines.join('\n');
    return;
  }
  ctx.font = `${style} ${weight} ${baseSize}px ${fam}`;
  try { ctx.letterSpacing = (ls * baseSize) + 'px'; } catch (e) {}
  const measuredW = ctx.measureText(text).width;
  let size = baseSize;
  if (measuredW > availW) size = baseSize * (availW / measuredW);
  if (size > availH) size = availH;
  if (size < MIN_SIZE) size = MIN_SIZE;
  boxEl.style.fontSize = size + 'px';
  try { ctx.letterSpacing = '0px'; } catch (e) {}  // reset (ctx condiviso)
}

// Divide `text` in righe rispettando gli a-capo espliciti (\n) e mandando a capo le parole che
// non entrano in `maxWidth`. `ctx.font` deve essere già impostato. Condiviso tra l'auto-fit
// dell'editor e il rendering su canvas (stampa) per ottenere righe identiche nelle due viste.
function _wrapBoxLines(ctx, text, maxWidth) {
  const lines = [];
  const paragraphs = String(text).split('\n');
  for (const para of paragraphs) {
    if (!para) { lines.push(''); continue; }
    const tokens = para.split(/(\s+)/); // conserva gli spazi come token separati
    let line = '';
    for (const tok of tokens) {
      const candidate = line + tok;
      if (line && ctx.measureText(candidate).width > maxWidth) {
        lines.push(line.replace(/\s+$/, ''));
        line = tok.replace(/^\s+/, '');
      } else {
        line = candidate;
      }
    }
    lines.push(line.replace(/\s+$/, ''));
  }
  return lines;
}

// Trova la dimensione font massima (partendo da baseSize, min minSize) per cui il testo, mandato
// a capo su maxWidth=availW con interlinea lineHeight, entra in availW×availH. Ritorna {size, lines}.
// buildFont(size) → stringa font completa per ctx.
// Se targetLines è impostato (box a "N righe fisse"): il font deriva dall'altezza / N / interlinea,
// così N righe riempiono esattamente il box e scalano con esso (il testo non si taglia se il box
// viene ridotto: rimpicciolisce). Il testo va comunque a capo su availW; l'eventuale eccedenza
// oltre le N righe viene clippata dal box (l'utente sceglie N per il contenuto atteso).
function _fitMultilineFont(ctx, text, availW, availH, baseSize, minSize, lineHeight, buildFont, targetLines, ls) {
  ls = ls || 0;  // distanza lettere in em
  const setLS = s => { try { ctx.letterSpacing = (ls * s) + 'px'; } catch (e) {} };
  if (targetLines && targetLines > 0) {
    let size = availH / (targetLines * (lineHeight || 1.2));
    if (!(size > 0)) size = minSize;
    size = Math.max(minSize, size);
    ctx.font = buildFont(size);
    setLS(size);
    const lines = _wrapBoxLines(ctx, text, availW);
    setLS(0);
    return { size, lines };
  }
  let size = baseSize;
  let lines = [];
  for (let i = 0; i < 100; i++) {
    ctx.font = buildFont(size);
    setLS(size);
    lines = _wrapBoxLines(ctx, text, availW);
    const totalH = lines.length * size * lineHeight;
    let maxW = 0;
    for (const ln of lines) { const w = ctx.measureText(ln).width; if (w > maxW) maxW = w; }
    if (totalH <= availH && maxW <= availW) break;
    if (size <= minSize) { size = minSize; ctx.font = buildFont(size); setLS(size); lines = _wrapBoxLines(ctx, text, availW); break; }
    size = Math.max(minSize, size * 0.94);
  }
  setLS(0);  // reset (ctx condiviso con altre misure)
  return { size, lines };
}

// Bind degli eventi drag/resize/click sui box. Pointer events unificati per mouse+touch.
function _bindModuloOverlayInteractions(slug, layer, img) {
  const c = state.moduliCache[slug];
  if (!c) return;

  // In editMode il layer cattura tutti i pointer (drag/resize). touch-action consente solo scroll
  // del container parent (utile quando la pagina è zoomata) ma NON il pinch-zoom del browser.
  // Il blocco completo è applicato sui singoli box via CSS.
  layer.style.touchAction = 'pan-x pan-y';

  // Click su area vuota del layer → deseleziona, MA solo se è un tap fermo (no swipe).
  // Su mobile l'utente potrebbe voler scrollare la pagina e accidentalmente touchare il layer:
  // non vogliamo che ogni piccolo movimento triggeri una deselezione + full re-render.
  // Soluzione: tracciamo pointerdown/up/cancel; deselezione solo se delta < TAP_THRESHOLD.
  let layerTapStart = null;
  const TAP_THRESHOLD = 10;  // px di movimento massimo per qualificare come "tap" (non swipe)
  layer.onpointerdown = (e) => {
    if (e.target !== layer) return;  // se è su un box, lascio gestire al box
    layerTapStart = { x: e.clientX, y: e.clientY };
  };
  layer.onpointerup = (e) => {
    if (!layerTapStart) return;
    const dx = e.clientX - layerTapStart.x;
    const dy = e.clientY - layerTapStart.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    layerTapStart = null;
    if (dist > TAP_THRESHOLD) return;  // era uno swipe, non deseleziono
    if (e.target !== layer) return;
    // Tap su area vuota: deseleziono il box senza full re-render (più fluido)
    if (c.selectedBoxIdx != null) {
      c.selectedBoxIdx = null;
      _persistModulo(slug);
      // Re-render leggero: solo overlay + lista box nel pannello
      refreshModuloOverlays(slug);
      _refreshModuloEditorPanelLight(slug);
    }
  };
  layer.onpointercancel = () => { layerTapStart = null; };

  layer.querySelectorAll('.mod-box').forEach(boxEl => {
    const idx = parseInt(boxEl.dataset.boxIdx, 10);
    // Su mobile: touchstart con preventDefault è il SOLO modo affidabile per impedire al browser
    // di decidere "questo è scroll" prima ancora che pointermove possa eseguire preventDefault.
    // Bind con passive:false è obbligatorio per poter chiamare preventDefault.
    boxEl.addEventListener('touchstart', (e) => {
      // Solo se il box è già selezionato OR il touch è su una handle (preventDefault sul tap di
      // selezione iniziale impedirebbe altri gesti utili; lo facciamo solo quando partiremo a draggare).
      const isSelected = c.selectedBoxIdx === idx;
      const touch = e.touches[0];
      const nearHandle = touch && _findNearestHandle(boxEl, touch.clientX, touch.clientY);
      if (isSelected || nearHandle) {
        e.preventDefault();
      }
    }, { passive: false });
    boxEl.onpointerdown = (e) => {
      e.stopPropagation();
      const isSelected = c.selectedBoxIdx === idx;
      // Hit detection con tolleranza: se il pointer è entro un raggio dalle 4 maniglie del box
      // selezionato, conta come resize anche se il target tecnico è il box (le maniglie sono
      // piccole e su touch il polpastrello copre un'area maggiore del singolo punto).
      let handleType = null;
      if (isSelected) {
        handleType = _findNearestHandle(boxEl, e.clientX, e.clientY);
      }
      if (!isSelected && !handleType) {
        // Prima volta che lo clicco: solo seleziono, non draggo (evita drift accidentali)
        c.selectedBoxIdx = idx;
        _persistModulo(slug);
        // Re-render leggero (overlay+pannello) invece del full
        refreshModuloOverlays(slug);
        _refreshModuloEditorPanelLight(slug);
        return;
      }
      _startBoxDragOrResize(slug, idx, e, handleType, layer, img);
    };
  });
}

// Trova la maniglia di resize entro una soglia di tolleranza dal punto (clientX, clientY).
// Restituisce 'tr' se l'utente è vicino alla maniglia visibile, null altrimenti.
// La maniglia è visivamente esterna all'angolo top-right del box (offset ~26-34px) e usa
// logica resize TR (bottom-left ancorato): trascinando in alto/destra, il box cresce in
// entrambe le dimensioni mantenendo l'angolo opposto fisso.
function _findNearestHandle(boxEl, clientX, clientY) {
  const handleEl = boxEl.querySelector('.mod-handle-resize');
  if (!handleEl) return null;
  const hRect = handleEl.getBoundingClientRect();
  const isCoarse = (window.matchMedia && window.matchMedia('(pointer:coarse)').matches);
  // Tolleranza ESTESA all'esterno della maniglia: l'area cliccabile è ben più grande del
  // pixel-rect visivo, per facilitare il tap su mobile dove il polpastrello copre 30-40px.
  const padding = isCoarse ? 16 : 8;
  if (clientX >= hRect.left - padding && clientX <= hRect.right + padding &&
      clientY >= hRect.top - padding && clientY <= hRect.bottom + padding) {
    return 'tr';
  }
  return null;
}

// Re-render LEGGERO del solo pannello editor (non l'intero compilatore).
// Evita di rimontare l'aside al click su un box: aggiornato solo il dettaglio "selezionato".
function _refreshModuloEditorPanelLight(slug) {
  const c = state.moduliCache[slug];
  if (!c || !c.editMode) return;
  const aside = document.getElementById('mod-form-aside');
  if (!aside) return;
  // Ri-renderizzo l'editor panel inline (no toolbar/preview, già in DOM)
  aside.innerHTML = _renderModuloEditorPanel(slug, c);
  // Aggiorno anche la toolbar perché lo stato dirty potrebbe essere cambiato
  _refreshModuloToolbar(slug);
}

// Ridisegna SOLO la toolbar dei moduli (senza full re-render), così il pulsante
// "Salva"/"Scarta" compare/sparisce subito quando cambia lo stato dirty dei box.
function _refreshModuloToolbar(slug) {
  const c = state.moduliCache[slug];
  if (!c) return;
  const tb = document.getElementById('mod-toolbar');
  if (!tb) return;
  const editMode = !!c.editMode;
  const isDirty = editMode && _boxesAreDirty(slug);
  tb.innerHTML = `
    <button class="btn ghost" onclick="renderModuloViewer('${escapeJs(slug)}', state.moduliCache['${escapeJs(slug)}'])" title="Torna alla vista pagine">◀ Indietro</button>
    <button class="btn ${editMode ? 'primary' : 'ghost'}" onclick="toggleModuloEditMode('${escapeJs(slug)}')">
      ${editMode ? '✓ Esci modalità modifica' : '✎ Modifica box'}
    </button>
    ${editMode ? `
      <button class="btn ghost" onclick="addModuloBox('${escapeJs(slug)}')">+ Aggiungi box</button>
      <button class="btn ${c.showGrid ? 'primary' : 'ghost'}" onclick="toggleModuloGrid('${escapeJs(slug)}')" title="Mostra/nascondi griglia di allineamento (con snap)"${c.showGrid ? ' style="background:#185FA5;border-color:#185FA5;"' : ''}>▦ Griglia</button>
      ${isDirty ? `
        <button class="btn primary" id="mod-btn-save" onclick="salvaModuloBoxes('${escapeJs(slug)}')" style="background:#185FA5;border-color:#185FA5;">Salva</button>
        <button class="btn ghost" onclick="scartaModuloBoxesModifiche('${escapeJs(slug)}')">Scarta</button>
        <span class="mod-toolbar-hint" style="color:#A32D2D;font-style:normal;">Modifiche non salvate</span>
      ` : `<span class="mod-toolbar-hint">Trascina i box per spostarli, usa gli angoli per ridimensionarli.</span>`}
    ` : ''}`;
}

// Avvia drag (handle=null) o resize (handle=tl/tr/bl/br). Usa Pointer Events per mouse+touch.
function _startBoxDragOrResize(slug, idx, ev, handleType, layer, img) {
  const c = state.moduliCache[slug];
  if (!c) return;
  const box = c.boxesData.box[idx];
  if (!box) return;

  ev.preventDefault();
  ev.stopPropagation();
  // Pointer capture sul layer: gli eventi continuano ad arrivare anche se il dito esce dall'area
  try { layer.setPointerCapture(ev.pointerId); } catch {}

  // Blocco lo scroll della pagina aggiungendo una classe sul <body>. Stile via CSS:
  // `body.is-dragging-modulo-box { touch-action: none; overscroll-behavior: none; }` —
  // questo evita che il browser interpreti la gesture come scroll. Lo metto su body (non html)
  // per non causare cancellazione dei pointer events (che il browser fa se html ha touch-action:none).
  document.body.classList.add('is-dragging-modulo-box');

  const layerRect = layer.getBoundingClientRect();
  const W = layerRect.width;
  const H = layerRect.height;

  // Posizione iniziale del puntatore in percentuali del layer
  const startPctX = ((ev.clientX - layerRect.left) / W) * 100;
  const startPctY = ((ev.clientY - layerRect.top) / H) * 100;
  const startBox = { x: box.x, y: box.y, w: box.w, h: box.h };

  // Trova l'elemento DOM del box (per preview live senza re-render completo)
  const boxEl = layer.querySelector(`.mod-box[data-box-idx="${idx}"]`);

  // rAF throttle: pointermove può scatenare ~120 eventi/sec su mobile, ma il browser non
  // dipinge più di ~60 fps. Bufferizziamo l'ultimo evento e lo applichiamo al prossimo
  // animation frame → niente reflow inutili, drag fluido.
  let pendingEvent = null;
  let rafId = null;
  const computeAndApply = () => {
    rafId = null;
    const e = pendingEvent;
    if (!e) return;
    pendingEvent = null;
    const curPctX = ((e.clientX - layerRect.left) / W) * 100;
    const curPctY = ((e.clientY - layerRect.top) / H) * 100;
    const dx = curPctX - startPctX;
    const dy = curPctY - startPctY;

    let nx = startBox.x, ny = startBox.y, nw = startBox.w, nh = startBox.h;
    const MIN_W = 0.5, MIN_H = 0.3;
    if (!handleType) {
      // Drag
      nx = Math.max(0, Math.min(100 - startBox.w, startBox.x + dx));
      ny = Math.max(0, Math.min(100 - startBox.h, startBox.y + dy));
    } else {
      if (handleType === 'br') {
        nw = Math.max(MIN_W, Math.min(100 - startBox.x, startBox.w + dx));
        nh = Math.max(MIN_H, Math.min(100 - startBox.y, startBox.h + dy));
      } else if (handleType === 'tr') {
        nw = Math.max(MIN_W, Math.min(100 - startBox.x, startBox.w + dx));
        const newY = Math.max(0, Math.min(startBox.y + startBox.h - MIN_H, startBox.y + dy));
        nh = startBox.h - (newY - startBox.y);
        ny = newY;
      } else if (handleType === 'bl') {
        const newX = Math.max(0, Math.min(startBox.x + startBox.w - MIN_W, startBox.x + dx));
        nw = startBox.w - (newX - startBox.x);
        nx = newX;
        nh = Math.max(MIN_H, Math.min(100 - startBox.y, startBox.h + dy));
      } else if (handleType === 'tl') {
        const newX = Math.max(0, Math.min(startBox.x + startBox.w - MIN_W, startBox.x + dx));
        const newY = Math.max(0, Math.min(startBox.y + startBox.h - MIN_H, startBox.y + dy));
        nw = startBox.w - (newX - startBox.x);
        nh = startBox.h - (newY - startBox.y);
        nx = newX;
        ny = newY;
      } else if (handleType === 'n') {
        const newY = Math.max(0, Math.min(startBox.y + startBox.h - MIN_H, startBox.y + dy));
        nh = startBox.h - (newY - startBox.y);
        ny = newY;
      } else if (handleType === 's') {
        nh = Math.max(MIN_H, Math.min(100 - startBox.y, startBox.h + dy));
      } else if (handleType === 'e') {
        nw = Math.max(MIN_W, Math.min(100 - startBox.x, startBox.w + dx));
      } else if (handleType === 'w') {
        const newX = Math.max(0, Math.min(startBox.x + startBox.w - MIN_W, startBox.x + dx));
        nw = startBox.w - (newX - startBox.x);
        nx = newX;
      }
    }
    // Snap-to-grid quando la griglia di allineamento è attiva (aiuta ad allineare i campi)
    if (c.showGrid) {
      const GRID = 2;
      const snap = v => Math.round(v / GRID) * GRID;
      if (!handleType) {
        nx = snap(nx); ny = snap(ny);
      } else {
        nw = Math.max(MIN_W, snap(nw));
        nh = Math.max(MIN_H, snap(nh));
        nx = snap(nx); ny = snap(ny);
      }
      nx = Math.max(0, Math.min(100 - nw, nx));
      ny = Math.max(0, Math.min(100 - nh, ny));
    }
    box.x = nx; box.y = ny; box.w = nw; box.h = nh;
    if (boxEl) {
      if (!handleType) {
        // Drag puro: uso transform translate per evitare reflow del layout (hardware-accelerated).
        // Lo scrivo come delta percentuale rispetto alla posizione iniziale.
        // Inoltre lascio left/top fissati al valore iniziale, così il transform sposta solo visivamente
        // e al rilascio del drag (onEnd) sincronizziamo left/top con i nuovi valori.
        const tx = nx - startBox.x;
        const ty = ny - startBox.y;
        boxEl.style.transform = `translate(${(tx / startBox.w) * 100}%, ${(ty / startBox.h) * 100}%)`;
      } else {
        // Resize: bisogna cambiare width/height (reflow inevitabile). Uso left/top diretti.
        boxEl.style.transform = '';
        boxEl.style.left = nx + '%';
        boxEl.style.top = ny + '%';
        boxEl.style.width = nw + '%';
        boxEl.style.height = nh + '%';
        // Auto-fit del font in tempo reale: il box rappresenta lo spazio massimo disponibile,
        // quindi se viene rimpicciolito il testo si adatta. Skip se è firma (no testo dinamico).
        if (!boxEl.classList.contains('firma')) {
          _autoFitBoxFont(boxEl);
        }
      }
    }
  };

  const onMove = (e) => {
    e.preventDefault();
    pendingEvent = e;
    if (rafId == null) rafId = requestAnimationFrame(computeAndApply);
  };

  const onEnd = (e) => {
    if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
    try { layer.releasePointerCapture(ev.pointerId); } catch {}
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onEnd);
    document.removeEventListener('pointercancel', onEnd);
    document.removeEventListener('touchmove', onTouchMove);
    document.body.classList.remove('is-dragging-modulo-box');
    // Committo il transform di drag in left/top reali, così lo state finale è coerente
    // con quello che l'utente vede e ulteriori operazioni partono dalla posizione giusta.
    if (boxEl && !handleType) {
      boxEl.style.transform = '';
      boxEl.style.left = box.x + '%';
      boxEl.style.top = box.y + '%';
    }
    _persistModulo(slug);
    // Aggiorno solo la toolbar (compare "Salva"/"Scarta"); nessun re-render full del drag.
    _refreshModuloToolbar(slug);
  };

  // Su Android, pointer events possono coesistere con touch events. Se il browser triggera
  // anche touchmove (per scroll), il preventDefault qui blocca esplicitamente lo scroll.
  const onTouchMove = (te) => { te.preventDefault(); };

  // Un SOLO listener su document (passive:false per poter chiamare preventDefault).
  // Non bind sul layer: con setPointerCapture sul layer, gli eventi pointer arrivano comunque
  // tramite document, e doppi listener causano onMove chiamato 2 volte → scatti su mobile.
  document.addEventListener('pointermove', onMove, { passive: false });
  document.addEventListener('pointerup', onEnd);
  document.addEventListener('pointercancel', onEnd);
  document.addEventListener('touchmove', onTouchMove, { passive: false });
}

/* ============================ MODULI — GENERAZIONE OUTPUT ============================ */

// Carica un'immagine come Image() (Promise). Necessario per draw su canvas.
// crossOrigin=anonymous serve per evitare canvas tainted (raw.githubusercontent.com supporta CORS).
function _loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error('Caricamento immagine fallito: ' + src));
    img.src = src;
  });
}

// Renderizza una singola pagina del modulo su canvas (alle dimensioni naturali della PNG)
// con i box compilati sovrapposti come testo nativo.
async function _renderModuloPaginaSuCanvas(slug, pageIndex /* 1-based */) {
  const c = state.moduliCache[slug];
  if (!c) throw new Error('Modulo non in cache');
  const url = c.pageUrls[pageIndex - 1];
  if (!url) throw new Error('Pagina ' + pageIndex + ' non disponibile');
  const img = await _loadImage(url);

  // Canvas alle dimensioni naturali della PNG → output ad alta risoluzione (stampa)
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  // Disegno i box di questa pagina come testo nativo
  const campiDefs = c.boxesData.campi_richiesti || [];
  const boxes = (c.boxesData.box || []).filter(b => (b.pagina || 1) === pageIndex);

  ctx.fillStyle = '#000';
  ctx.textBaseline = 'top';

  // Font IDENTICO a quello dell'editor live (.mod-box usa var(--sans) = "Instrument Sans" …).
  // Prima il canvas usava Helvetica/Arial (metriche diverse, più larghe): il testo entrava nel box
  // sullo schermo (Instrument Sans, più stretto) ma traboccava sul canvas → l'auto-fit riduceva il
  // font SOLO in stampa e non nell'editor. Usando lo stesso font le due viste si adattano uguale.
  const fontFamily = getComputedStyle(document.body).fontFamily || 'Helvetica, Arial, sans-serif';

  boxes.forEach(b => {
    const value = _formatBoxValue(b, campiDefs, c.formValues);
    if (!value) return; // box vuoto o firma → niente testo
    if (b.tipo === 'firma') return; // firma non si stampa, è solo placeholder per firma manuale

    // Le coordinate sono in % della pagina; converto in pixel sul canvas
    const x = (b.x / 100) * canvas.width;
    const y = (b.y / 100) * canvas.height;
    const w = (b.w / 100) * canvas.width;
    const h = (b.h / 100) * canvas.height;

    // font_size è espresso in % dell'ALTEZZA della pagina (come x/y/w/h), quindi universale:
    // indipendente da dispositivo e risoluzione. Lo converto in px del canvas qui.
    // Auto-fit: riduco solo se il testo non entra in larghezza/altezza del box.
    const padW = (0.4 / 100) * canvas.width;  // ~0.4% larghezza pagina di padding orizzontale (2px*2 su ~1000px)
    const availW = Math.max(1, w - padW);
    const availH = Math.max(1, h);
    const MIN_SIZE_PX = Math.max((0.6 / 100) * canvas.height, 4);
    const baseSize = ((b.font_size || 2.0) / 100) * canvas.height;

    ctx.textAlign = b.align === 'center' ? 'center' : (b.align === 'right' ? 'right' : 'left');

    // Posizione X in base ad align
    let drawX = x;
    if (b.align === 'center') drawX = x + w / 2;
    else if (b.align === 'right') drawX = x + w;

    // Clip al rettangolo del box per evitare overflow visivo
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    if (b.multiline) {
      // Testo su più righe: stesso wrapping dell'editor (righe identiche in preview e stampa).
      const lineHeight = b.line_height || 1.2;
      const targetLines = b.lines || 0;
      const ls = b.letter_spacing || 0;  // distanza lettere in em
      const buildFont = s => `${s}px ${fontFamily}`;
      const { size, lines } = _fitMultilineFont(ctx, value, availW, availH, baseSize, MIN_SIZE_PX, lineHeight, buildFont, targetLines, ls);
      ctx.font = buildFont(size);
      try { ctx.letterSpacing = (ls * size) + 'px'; } catch (e) {}
      const totalH = lines.length * size * lineHeight;
      // N righe fisse → allineo in alto (il testo riempie le righe dall'alto). Auto-fit → centrato.
      let startY = targetLines ? y : y + (availH - totalH) / 2;
      if (startY < y) startY = y;  // blocco di testo più alto del box → parti dal bordo (verrà clippato)
      for (let li = 0; li < lines.length; li++) {
        ctx.fillText(lines[li], drawX, startY + li * size * lineHeight);
      }
    } else {
      const ls = b.letter_spacing || 0;  // distanza lettere in em
      let fontSize = baseSize;
      ctx.font = `${fontSize}px ${fontFamily}`;
      try { ctx.letterSpacing = (ls * fontSize) + 'px'; } catch (e) {}
      const measuredW = ctx.measureText(value).width;
      if (measuredW > availW) fontSize = fontSize * (availW / measuredW);
      if (fontSize > availH) fontSize = availH;
      if (fontSize < MIN_SIZE_PX) fontSize = MIN_SIZE_PX;
      ctx.font = `${fontSize}px ${fontFamily}`;
      try { ctx.letterSpacing = (ls * fontSize) + 'px'; } catch (e) {}
      const drawY = y + (h - fontSize) / 2;  // centratura verticale
      ctx.fillText(value, drawX, drawY);
    }
    ctx.restore();
  });

  return canvas;
}

// Genera array di canvas, uno per pagina del modulo
async function _renderModuloTutteLePagine(slug) {
  const c = state.moduliCache[slug];
  if (!c) throw new Error('Modulo non in cache');
  // Attendo che i web font (Instrument Sans) siano caricati: il canvas misura/disegna con lo
  // stesso font dell'editor, quindi il font dev'essere pronto o ripiegherebbe su un fallback
  // con metriche diverse (auto-fit incoerente con l'anteprima).
  try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch {}
  const canvases = [];
  for (let i = 1; i <= c.pageUrls.length; i++) {
    const cv = await _renderModuloPaginaSuCanvas(slug, i);
    canvases.push(cv);
  }
  return canvases;
}

// Helper: nome file per output (slug + cognome paziente se disponibile + data)
function _moduloOutputFileName(slug, ext) {
  const c = state.moduliCache[slug];
  const m = (state.index.moduli || []).find(x => x.slug === slug);
  const titolo = m ? (m.titolo || slug) : slug;
  const baseSlug = titolo.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  // Trova un campo paziente_completo per estrarre il cognome
  let pzSuffix = '';
  if (c) {
    const pzDef = (c.boxesData.campi_richiesti || []).find(d => d.tipo === 'paziente_completo');
    if (pzDef) {
      const v = c.formValues[pzDef.id];
      if (v && v.cognome) {
        pzSuffix = '_' + v.cognome.toLowerCase().replace(/[^a-z0-9]+/g, '');
      }
    }
  }
  const d = new Date();
  const dateStr = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  return `${baseSlug}${pzSuffix}_${dateStr}.${ext}`;
}

// Verifica che i campi required siano compilati. Restituisce array di label dei campi mancanti.
// Considera SOLO i campi effettivamente referenziati dai box del modulo: se un campo è
// dichiarato required nel template ma nessun box lo usa, non c'è motivo di richiederlo
// (non comparirebbe comunque nell'output PDF/PNG).
function _validateModuloRequired(slug) {
  const c = state.moduliCache[slug];
  if (!c) return [];
  const missing = [];
  // Set dei campi usati dai box (esclude box firma, che non ha campo associato)
  const campiUsati = new Set();
  (c.boxesData.box || []).forEach(b => { if (b.campo) campiUsati.add(b.campo); });
  (c.boxesData.campi_richiesti || []).forEach(def => {
    if (!def.required) return;
    if (!campiUsati.has(def.id)) return;  // campo non usato → non richiesto in pratica
    const v = c.formValues[def.id];
    if (def.tipo === 'paziente_completo') {
      if (!v || !v.cognome || !v.nome) missing.push(def.label);
    } else if (def.tipo === 'medico_nome') {
      if (!v || !v.cognome) missing.push(def.label);
    } else {
      if (!v || !String(v).trim()) missing.push(def.label);
    }
  });
  return missing;
}

// Genera PNG (singola pagina o multi-page strip) e scarica.
// Per moduli multi-pagina facciamo download multipli (una PNG per pagina).
// Toggle del menu dropdown "Scarica" (PDF/PNG). Click outside chiude.
function toggleModuloDownloadMenu(evt, slug) {
  evt.stopPropagation();
  const menu = document.getElementById(`mod-download-menu-${slug}`);
  if (!menu) return;
  const isOpen = menu.classList.contains('open');
  // Chiudi tutti i dropdown aperti (solo uno alla volta)
  document.querySelectorAll('.mod-dropdown-menu.open').forEach(m => m.classList.remove('open'));
  if (!isOpen) {
    menu.classList.add('open');
    // Click outside chiude
    setTimeout(() => {
      const closer = (e) => {
        if (!menu.contains(e.target)) {
          menu.classList.remove('open');
          document.removeEventListener('click', closer);
        }
      };
      document.addEventListener('click', closer);
    }, 0);
  }
}

function closeModuloDownloadMenu() {
  document.querySelectorAll('.mod-dropdown-menu.open').forEach(m => m.classList.remove('open'));
}

async function downloadModuloPng(slug) {
  const missing = _validateModuloRequired(slug);
  if (missing.length && !confirm('Campi obbligatori non compilati:\n• ' + missing.join('\n• ') + '\n\nGenerare comunque il modulo?')) return;
  try {
    const canvases = await _renderModuloTutteLePagine(slug);
    const baseName = _moduloOutputFileName(slug, 'png').replace(/\.png$/, '');
    for (let i = 0; i < canvases.length; i++) {
      const blob = await new Promise(resolve => canvases[i].toBlob(resolve, 'image/png'));
      const fname = canvases.length > 1 ? `${baseName}_pag${i + 1}.png` : `${baseName}.png`;
      _triggerDownload(blob, fname);
    }
    toast(`Modulo PNG ${canvases.length > 1 ? '(' + canvases.length + ' pagine) ' : ''}scaricato`, 'success');
  } catch (e) {
    console.error(e);
    toast('Errore generazione PNG: ' + e.message, 'error');
  }
}

// Genera PDF multipagina e scarica.
async function downloadModuloPdf(slug) {
  const missing = _validateModuloRequired(slug);
  if (missing.length && !confirm('Campi obbligatori non compilati:\n• ' + missing.join('\n• ') + '\n\nGenerare comunque il modulo?')) return;
  try {
    await _ensureLib('jspdf');
    const canvases = await _renderModuloTutteLePagine(slug);
    const blob = await _canvasesToPdfBlob(canvases);
    _triggerDownload(blob, _moduloOutputFileName(slug, 'pdf'));
    toast('Modulo PDF scaricato', 'success');
  } catch (e) {
    console.error(e);
    toast('Errore generazione PDF: ' + e.message, 'error');
  }
}

// Converte array di canvas in un singolo Blob PDF (A4 portrait, una pagina per canvas)
async function _canvasesToPdfBlob(canvases) {
  const { jsPDF } = window.jspdf;
  // A4 in mm: 210x297. Scelgo unità mm così il layout è prevedibile.
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  for (let i = 0; i < canvases.length; i++) {
    if (i > 0) pdf.addPage();
    const canvas = canvases[i];
    const aspect = canvas.height / canvas.width;
    const pageW = 210;
    const imgW = pageW;
    const imgH = imgW * aspect;
    // Se l'immagine eccede l'altezza A4, scaliamo per altezza
    let finalW = imgW, finalH = imgH;
    if (imgH > 297) {
      finalH = 297;
      finalW = finalH / aspect;
    }
    const dataUrl = canvas.toDataURL('image/png'); // PNG lossless: testo nitido (JPEG sgranava le lettere)
    const offsetX = (pageW - finalW) / 2;
    const offsetY = (297 - finalH) / 2;
    pdf.addImage(dataUrl, 'PNG', offsetX, offsetY, finalW, finalH);
  }
  return pdf.output('blob');
}

// Stampa il modulo COMPILATO: rende ogni pagina come canvas (con box riempiti), apre una
// finestra con tutte le pagine in formato A4 e lancia il dialog di stampa del browser.
// Stesso approccio di stampaModuloViewer ma con le immagini canvas riempite invece delle PNG vuote.
async function stampaModuloCompilato(slug) {
  const missing = _validateModuloRequired(slug);
  if (missing.length && !confirm('Campi obbligatori non compilati:\n• ' + missing.join('\n• ') + '\n\nStampare comunque il modulo?')) return;
  try {
    const canvases = await _renderModuloTutteLePagine(slug);
    if (!canvases.length) return toast('Nessuna pagina da stampare', 'error');
    // PNG lossless: il JPEG (anche a qualità alta) introduce artefatti di compressione attorno
    // al testo nero su sfondo bianco, rendendolo sgranato in stampa. Il PNG mantiene il testo nitido.
    const pageDataUrls = canvases.map(c => c.toDataURL('image/png'));
    _stampaPagineA4(slug, pageDataUrls, 'compilato');
  } catch (e) {
    console.error(e);
    toast('Errore stampa: ' + e.message, 'error');
  }
}

// Trigger download di un Blob (cross-browser)
function _triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

// Web Share API: condivide il modulo come file (PDF preferito, PNG fallback) via WhatsApp/email/etc.
async function shareModulo(slug) {
  const missing = _validateModuloRequired(slug);
  if (missing.length && !confirm('Campi obbligatori non compilati:\n• ' + missing.join('\n• ') + '\n\nCondividere comunque?')) return;
  if (!navigator.share) {
    return toast('Condivisione file non supportata su questo browser. Usa "Scarica PDF" o "Scarica PNG".', 'warning', 5000);
  }
  try {
    const canvases = await _renderModuloTutteLePagine(slug);
    let file;
    const m = (state.index.moduli || []).find(x => x.slug === slug);
    const title = m ? (m.titolo || slug) : slug;
    // Provo a caricare jsPDF (lazy): se OK genero PDF, altrimenti fallback a PNG prima pagina
    let canUsePdf = false;
    try {
      await _ensureLib('jspdf');
      canUsePdf = !!(window.jspdf && window.jspdf.jsPDF);
    } catch {}
    if (canUsePdf) {
      const blob = await _canvasesToPdfBlob(canvases);
      file = new File([blob], _moduloOutputFileName(slug, 'pdf'), { type: 'application/pdf' });
    } else {
      const blob = await new Promise(resolve => canvases[0].toBlob(resolve, 'image/png'));
      file = new File([blob], _moduloOutputFileName(slug, 'png'), { type: 'image/png' });
    }
    // Test canShare con i file (alcuni browser non supportano file share anche se share è disponibile)
    if (navigator.canShare && !navigator.canShare({ files: [file] })) {
      return toast('Condivisione file non supportata. Usa "Scarica PDF" o "Scarica PNG".', 'warning', 5000);
    }
    await navigator.share({ files: [file], title: title, text: title });
  } catch (e) {
    if (e.name !== 'AbortError') {  // utente ha cancellato il dialog
      console.error(e);
      toast('Errore condivisione: ' + e.message, 'error');
    }
  }
}

/* ============================ MODULI — PERSISTENZA GITHUB ============================ */

// Salva il boxes.yml corrente sul repo dati. Aggiorna anche moduli/index.yml col nuovo
// `aggiornato` (così altri client invalidano la cache e fetchano la nuova versione).
async function salvaModuloBoxes(slug) {
  if (bloccaSeNonModifica('moduli')) return;
  const c = state.moduliCache[slug];
  if (!c) return toast('Modulo non in cache', 'error');
  if (!_boxesAreDirty(slug)) {
    return toast('Nessuna modifica da salvare', 'info');
  }
  if (!state.session || !state.session.tokenAuth) {
    return toast('Login richiesto per salvare modifiche', 'error');
  }

  const m = (state.index.moduli || []).find(x => x.slug === slug);
  if (!m) return toast('Modulo non in indice', 'error');

  // Conferma esplicita (operazione "permanente" sul repo) tramite popup dell'app, non confirm() nativo.
  const nBoxes = (c.boxesData.box || []).length;
  showModal({
    title: 'Salvare le modifiche?',
    subtitle: ``,
    actions: [
      { label: 'Annulla', variant: 'ghost', onClick: () => closeModal() },
      { label: 'Salva', onClick: () => { closeModal(); _doSalvaModuloBoxes(slug); } }
    ]
  });
}

// Esegue il salvataggio effettivo dei box su GitHub (chiamato dopo la conferma nel popup).
async function _doSalvaModuloBoxes(slug) {
  const c = state.moduliCache[slug];
  if (!c) return toast('Modulo non in cache', 'error');
  const m = (state.index.moduli || []).find(x => x.slug === slug);
  if (!m) return toast('Modulo non in indice', 'error');
  const nBoxes = (c.boxesData.box || []).length;

  const btn = document.getElementById('mod-btn-save');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvataggio…'; }

  try {
    // 1) Scrivi boxes.yml
    const boxesPath = `content/moduli/${slug}/boxes.yml`;
    // Pulisci dati per scrittura: solo campi_richiesti + box (no metadati app)
    const toWrite = {
      campi_richiesti: c.boxesData.campi_richiesti || [],
      box: c.boxesData.box || []
    };
    const yamlStr = `# Box e campi per "${m.titolo || slug}".\n# Coordinate in PERCENTUALE (0-100) sulla pagina, origine top-left.\n# Aggiornato da ${state.session.username || '?'} il ${new Date().toLocaleString('it-IT')}.\n\n` +
      jsyaml.dump(toWrite, { lineWidth: 120, noRefs: true, sortKeys: false });

    const commitMsg = `chore(moduli): aggiorna box ${slug} (${nBoxes} box, by ${state.session.username})`;
    // Lo sha potrebbe non essere in memoria (box creati da import o altra sessione, o cache senza sha):
    // in quel caso lo recupero dal repo, altrimenti GitHub rifiuta l'update con 422 "sha wasn't supplied".
    // Se il file non esiste (modulo nuovo) getFile torna null e lo sha resta assente → creazione corretta.
    let boxesSha = c.boxesSha;
    if (!boxesSha) {
      try { const existing = await gh.getFile(boxesPath); if (existing && existing.sha) boxesSha = existing.sha; } catch (e) {}
    }
    const res = await gh.putFile(boxesPath, yamlStr, boxesSha, commitMsg);
    if (res && res.content && res.content.sha) {
      c.boxesSha = res.content.sha;
    }

    // 2) Aggiorna moduli/index.yml col nuovo `aggiornato` (data odierna)
    try {
      const indexPath = 'content/moduli/index.yml';
      const f = await gh.getFile(indexPath);
      if (f) {
        const idx = jsyaml.load(f.content) || { moduli: [] };
        const today = new Date().toISOString().slice(0, 10);
        let touched = false;
        (idx.moduli || []).forEach(mm => {
          if (mm.slug === slug) {
            mm.aggiornato = today;
            touched = true;
          }
        });
        if (touched) {
          const newContent = jsyaml.dump(idx, { lineWidth: 120, noRefs: true, sortKeys: false });
          await gh.putFile(indexPath, newContent, f.sha, `chore(moduli): timestamp aggiornamento ${slug}`);
          // Riallinea state.index.moduli in memoria
          const localM = (state.index.moduli || []).find(x => x.slug === slug);
          if (localM) {
            localM.aggiornato = today;
            localM.ultima_modifica = today;
          }
        }
      }
    } catch (e) {
      console.warn('[salvaModuloBoxes] aggiornamento index.yml fallito (non critico):', e);
    }

    // 3) Aggiorna snapshot pristine (= il salvato è ora il "nuovo pristine")
    c.pristineBoxes = JSON.parse(JSON.stringify(c.boxesData.box || []));
    c.pristineCampi = JSON.parse(JSON.stringify(c.boxesData.campi_richiesti || []));
    _persistModulo(slug);

    toast('Modifiche salvate su GitHub', 'success');
    renderModuloCompilatore(slug, c);
  } catch (e) {
    console.error(e);
    if (e.message && e.message.includes('409')) {
      toast('Conflitto: il file è stato modificato da un altro utente. Ricarica la pagina.', 'error', 6000);
    } else {
      toast('Errore salvataggio: ' + e.message, 'error');
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Salva'; }
  }
}

// Scarta le modifiche locali e ricarica i box dal pristine
function scartaModuloBoxesModifiche(slug) {
  const c = state.moduliCache[slug];
  if (!c || !c.pristineBoxes) return;
  if (!_boxesAreDirty(slug)) return toast('Nessuna modifica da scartare', 'info');
  if (!confirm('Scartare tutte le modifiche locali (box e campi)?\n\nLe modifiche non salvate andranno perse.')) return;
  c.boxesData.box = JSON.parse(JSON.stringify(c.pristineBoxes));
  if (c.pristineCampi != null) c.boxesData.campi_richiesti = JSON.parse(JSON.stringify(c.pristineCampi));
  c.selectedBoxIdx = null;
  _persistModulo(slug);
  renderModuloCompilatore(slug, c);
  toast('Modifiche scartate', 'info');
}

/* ============================ MODULI — CREAZIONE NUOVO MODULO ============================ */

// Stato del wizard di creazione (popolato durante il dialog)
let _nuovoModuloDraft = null;

// Helper: deriva uno slug dal titolo (lowercase, no caratteri speciali, trattini)
function _slugifyTitolo(s) {
  return (s || '').toLowerCase()
    .replace(/[àáâãäå]/g, 'a').replace(/[èéêë]/g, 'e').replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõö]/g, 'o').replace(/[ùúûü]/g, 'u').replace(/[ýÿ]/g, 'y')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 60);
}

// Apre il dialog wizard "Nuovo modulo"
function apriNuovoModuloDialog() {
  if (bloccaSeNonModifica('moduli')) return;
  if (!state.session || !state.session.tokenAuth) {
    return toast('Login richiesto per creare moduli', 'error');
  }
  // Reset draft
  _nuovoModuloDraft = {
    titolo: '',
    descrizione: '',
    categoria: '',
    autore: state.session.cognome && state.session.nome
      ? `${state.session.nome} ${state.session.cognome}`
      : (state.session.username || ''),
    slug: '',
    pages: []  // array di { dataUrl, blob, originalName }
  };
  _renderNuovoModuloDialog();
}

function _renderNuovoModuloDialog() {
  const draft = _nuovoModuloDraft;
  if (!draft) return;
  const slugAuto = draft.slug || _slugifyTitolo(draft.titolo);
  const slugConflict = (state.index.moduli || []).find(m => m.slug === slugAuto);
  const canSubmit = draft.titolo.trim() && draft.pages.length > 0 && slugAuto && !slugConflict;

  showModal({
    title: 'Nuovo modulo compilabile',
    subtitle: 'Carica un PDF o una serie di immagini delle pagine del modulo',
    body: `
      <div style="display:grid;gap:14px;font-family:var(--sans);">
        <div class="field">
          <label class="mod-field-label" for="nm-titolo">Titolo del modulo *</label>
          <input type="text" id="nm-titolo" class="mod-input" placeholder="es. Consenso rachicentesi"
                 value="${escapeHtml(draft.titolo)}"
                 oninput="_updateNuovoModuloField('titolo', this.value)">
        </div>
        <div class="field">
          <label class="mod-field-label" for="nm-slug">Slug (nome cartella su GitHub)</label>
          <input type="text" id="nm-slug" class="mod-input" placeholder="auto-generato dal titolo"
                 value="${escapeHtml(slugAuto)}"
                 oninput="_updateNuovoModuloField('slug', this.value)">
          ${slugConflict ? `<div style="font-size:12px;color:#A32D2D;margin-top:4px;">⚠ Slug già esistente, scegline uno diverso</div>` : ''}
        </div>
        <div class="field">
          <label class="mod-field-label" for="nm-descr">Descrizione</label>
          <textarea id="nm-descr" class="mod-input" rows="2" placeholder="Breve descrizione (opzionale)"
                    oninput="_updateNuovoModuloField('descrizione', this.value)">${escapeHtml(draft.descrizione)}</textarea>
        </div>
        <div class="field">
          <label class="mod-field-label" for="nm-categoria">Categoria <span style="font-weight:normal;color:var(--ink-muted);">(opzionale — es. Imaging, Biopsie)</span></label>
          <input type="text" id="nm-categoria" class="mod-input" placeholder="es. Imaging" list="nm-categoria-list" autocomplete="off"
                 value="${escapeHtml(draft.categoria || '')}"
                 oninput="_updateNuovoModuloField('categoria', this.value)">
          <datalist id="nm-categoria-list">${_collectModuliCategorie().map(c => `<option value="${escapeHtml(c)}"></option>`).join('')}</datalist>
        </div>
        <div class="field">
          <label class="mod-field-label" for="nm-autore">Autore</label>
          <input type="text" id="nm-autore" class="mod-input" placeholder="Chi ha creato questo modulo"
                 value="${escapeHtml(draft.autore)}"
                 oninput="_updateNuovoModuloField('autore', this.value)">
        </div>

        <div class="field" style="border-top:1px solid var(--rule-soft);padding-top:14px;">
          <label class="mod-field-label">Pagine del modulo *</label>
          <div style="font-size:12px;color:var(--ink-muted);margin-bottom:8px;">
            Carica un PDF (verrà splittato in pagine) o uno o più file immagine (PNG/JPG).<br>
            <strong>Per file Word</strong>: salvali prima in PDF (Word: File → Salva come → PDF), poi carica il PDF qui.
          </div>
          <input type="file" id="nm-file-input" accept=".pdf,image/*,.doc,.docx" multiple style="display:none;"
                 onchange="_handleNuovoModuloFiles(this.files)">
          <button type="button" class="btn ghost" onclick="document.getElementById('nm-file-input').click()" style="width:100%;padding:14px 12px;border:2px dashed var(--rule);background:var(--bg-sink);font-size:14px;line-height:1.3;text-align:center;white-space:normal;">
            ${draft.pages.length === 0 ? '📄 Scegli file<br><span style="font-size:11px;color:var(--ink-muted);font-weight:normal;">PDF o immagini</span>' : '+ Aggiungi pagine'}
          </button>
          ${draft.pages.length > 0 ? `
            <div style="margin-top:10px;display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:6px;">
              ${draft.pages.map((p, i) => `
                <div style="position:relative;background:#fff;border:1px solid var(--rule);border-radius:2px;padding:4px;font-size:11px;text-align:center;">
                  <img src="${p.dataUrl}" alt="Pagina ${i+1}" style="width:100%;height:80px;object-fit:contain;display:block;">
                  <div style="margin-top:2px;color:var(--ink-muted);font-family:var(--mono);">p${i+1}</div>
                  <button type="button" onclick="_removeNuovoModuloPage(${i})" title="Rimuovi pagina"
                    style="position:absolute;top:2px;right:2px;background:rgba(180,0,0,.85);color:white;border:none;width:18px;height:18px;border-radius:50%;font-size:11px;cursor:pointer;line-height:1;padding:0;">×</button>
                </div>
              `).join('')}
            </div>
            <div style="margin-top:6px;font-size:11px;color:var(--ink-muted);">
              ${draft.pages.length} ${draft.pages.length === 1 ? 'pagina' : 'pagine'}
            </div>
          ` : ''}
        </div>

        <div id="nm-progress" style="display:none;padding:10px;background:var(--bg-sink);border-radius:2px;font-family:var(--mono);font-size:12px;color:var(--ink-soft);"></div>
      </div>`,
    actions: [
      { label: 'Annulla', variant: 'ghost', onClick: () => { _nuovoModuloDraft = null; closeModal(); } },
      { label: 'Crea modulo', disabled: !canSubmit, onClick: (btn) => {
          if (!canSubmit) return;
          runWithSpinner(btn, () => _confermaNuovoModulo());
        } }
    ]
  });
}

function _updateNuovoModuloField(field, value) {
  if (!_nuovoModuloDraft) return;
  _nuovoModuloDraft[field] = value;
  // Se l'utente non ha customizzato lo slug, lo riderivo dal titolo
  if (field === 'titolo' && !_nuovoModuloDraft._slugManuale) {
    _nuovoModuloDraft.slug = '';  // sarà auto-rigenerato al prossimo render
  }
  if (field === 'slug') {
    _nuovoModuloDraft._slugManuale = !!value;
  }
  // Per i campi testo, NON ri-render del dialog: aggiornerei solo l'avviso slug duplicato
  // ma perderei focus/cursore. Aggiorno solo il warning slug se necessario.
  // Re-render completo solo quando le pagine cambiano (handled da _handleNuovoModuloFiles/_removeNuovoModuloPage).
  _refreshSlugWarningInDialog();
}

// Aggiorna solo l'avviso "slug già esistente" e lo stato disabled del bottone Crea, senza re-render completo
function _refreshSlugWarningInDialog() {
  const draft = _nuovoModuloDraft;
  if (!draft) return;
  const slugInput = document.getElementById('nm-slug');
  if (!slugInput) return;
  // Se lo slug è auto-generato dal titolo, aggiorno il valore visualizzato
  if (!draft._slugManuale) {
    const newSlug = _slugifyTitolo(draft.titolo);
    if (slugInput.value !== newSlug) slugInput.value = newSlug;
  }
  const slugVal = slugInput.value || _slugifyTitolo(draft.titolo);
  const conflict = (state.index.moduli || []).find(m => m.slug === slugVal);
  // Cerco il warning esistente sotto lo slug input
  let warning = slugInput.parentElement.querySelector('.nm-slug-warning');
  if (conflict) {
    if (!warning) {
      warning = document.createElement('div');
      warning.className = 'nm-slug-warning';
      warning.style.cssText = 'font-size:12px;color:#A32D2D;margin-top:4px;';
      slugInput.parentElement.appendChild(warning);
    }
    warning.textContent = '⚠ Slug già esistente, scegline uno diverso';
  } else if (warning) {
    warning.remove();
  }
  // Aggiorna stato disabled del bottone "Crea modulo" senza re-render del modal
  const canSubmit = draft.titolo.trim() && draft.pages.length > 0 && slugVal && !conflict;
  document.querySelectorAll('.modal-actions [data-action-idx]').forEach(btn => {
    const label = btn.textContent.trim();
    if (label === 'Crea modulo') btn.disabled = !canSubmit;
  });
}

function _removeNuovoModuloPage(idx) {
  if (!_nuovoModuloDraft) return;
  _nuovoModuloDraft.pages.splice(idx, 1);
  _renderNuovoModuloDialog();
}

// Gestisce i file selezionati: li converte in pages (dataUrl + blob).
// PDF → split in pagine via PDF.js; immagini → 1 pagina ciascuna.
async function _handleNuovoModuloFiles(fileList) {
  if (!_nuovoModuloDraft) return;
  const files = Array.from(fileList);
  if (files.length === 0) return;

  const progressEl = document.getElementById('nm-progress');
  if (progressEl) {
    progressEl.style.display = 'block';
    progressEl.textContent = `Elaborazione ${files.length} file…`;
  }

  for (const file of files) {
    try {
      const lower = file.name.toLowerCase();
      if (file.type === 'application/pdf' || lower.endsWith('.pdf')) {
        await _processPdfToPages(file, progressEl);
      } else if (file.type.startsWith('image/')) {
        await _processImageToPage(file, progressEl);
      } else if (lower.endsWith('.doc') || lower.endsWith('.docx') ||
                 file.type === 'application/msword' ||
                 file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        // I file Word non possono essere visualizzati nel browser: serve un PDF o immagini.
        // Un parser .docx → HTML (es. mammoth.js) richiederebbe poi un renderer HTML→canvas
        // affidabile, cosa non triviale per documenti istituzionali con tabelle/intestazioni.
        // Soluzione pragmatica: chiedo all'utente di convertire prima il Word in PDF.
        toast(`File Word non supportato direttamente.\nApri "${file.name}" e usa "Salva come PDF" (o stampa → PDF), poi carica il PDF qui.`, 'warning', 8000);
      } else {
        toast(`Tipo file non supportato: ${file.name}. Carica PDF, PNG o JPG.`, 'warning', 5000);
      }
    } catch (e) {
      console.error('[nuovoModulo] errore processing file', file.name, e);
      toast(`Errore con ${file.name}: ${e.message}`, 'error', 4000);
    }
  }
  if (progressEl) progressEl.style.display = 'none';
  _renderNuovoModuloDialog();
}

// Splitta un PDF in pagine PNG via PDF.js. Renderizza ogni pagina a 200 DPI.
async function _processPdfToPages(file, progressEl) {
  // PDF.js caricata lazy: necessario await prima dell'uso
  await _ensureLib('pdfjs');
  const arrayBuf = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuf }).promise;
  const SCALE = 2.0;  // ~150-200 DPI: buon compromesso qualità/dimensione
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    if (progressEl) progressEl.textContent = `Estrazione pagina ${pageNum} di ${pdf.numPages} da ${file.name}…`;
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: SCALE });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    // Sfondo bianco (PDF a volte trasparenti → eviterei artefatti compress)
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    const dataUrl = canvas.toDataURL('image/png');
    _nuovoModuloDraft.pages.push({ dataUrl, blob, originalName: `${file.name} p.${pageNum}` });
  }
}

// Converte una immagine (PNG/JPG) in un page entry. Comprime se >2MB.
async function _processImageToPage(file, progressEl) {
  if (progressEl) progressEl.textContent = `Caricamento ${file.name}…`;
  let blob = file;
  // Se è grossa o non-PNG, comprimi/riconverti
  if (file.size > 2 * 1024 * 1024 || !file.type.includes('png')) {
    try {
      await _ensureLib('imageCompression');
      blob = await window.imageCompression(file, { maxSizeMB: 2, maxWidthOrHeight: 2400, useWebWorker: true });
    } catch (e) {
      console.warn('[nuovoModulo] compressione fallita, uso originale:', e);
    }
  }
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
  _nuovoModuloDraft.pages.push({ dataUrl, blob, originalName: file.name });
}

// Conferma e crea il modulo: upload PNG + boxes.yml + aggiorna index.yml
// Boxes data di default per un nuovo modulo: 3 campi standard, 0 box.
// L'admin disegnerà i box dopo la creazione tramite "Modifica box" sull'immagine.
function _nuovoModuloDefaultBoxesData() {
  return {
    campi_richiesti: [
      { id: 'paziente', label: 'Paziente', tipo: 'paziente_completo', required: true },
      { id: 'medico', label: 'Medico', tipo: 'medico_nome', required: true },
      { id: 'sede', label: 'Sede / Reparto', tipo: 'testo', default: 'Clinica Neurologica' },
      { id: 'data', label: 'Data', tipo: 'data', default: 'oggi' }
    ],
    box: []
  };
}

// STEP 1 — Upload delle PNG di ogni pagina come binari sul repo.
async function _uploadPaginePNG(slug, pages, progressEl) {
  for (let i = 0; i < pages.length; i++) {
    if (progressEl) progressEl.textContent = `Upload pagina ${i+1}/${pages.length}…`;
    const page = pages[i];
    const path = `content/moduli/${slug}/page-${i+1}.png`;
    // Converto blob in base64 (browser-safe, no atob su binari)
    const base64 = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result.split(',')[1]);
      r.onerror = reject;
      r.readAsDataURL(page.blob);
    });
    await gh.putFile(path, base64, null, `Nuovo modulo ${slug}: pagina ${i+1}`, true);
  }
}

// STEP 2 — Crea boxes.yml col template default.
async function _creaBoxesYmlIniziale(slug, titolo) {
  const boxesData = _nuovoModuloDefaultBoxesData();
  const yamlStr = `# Box e campi per "${titolo}".\n# Coordinate in PERCENTUALE (0-100) sulla pagina, origine top-left.\n# Creato da ${state.session.username || '?'} il ${new Date().toLocaleString('it-IT')}.\n# Per disegnare i box, apri il modulo nell'app e usa "Modifica box".\n\n` +
    jsyaml.dump(boxesData, { lineWidth: 120, noRefs: true, sortKeys: false });
  await gh.putFile(`content/moduli/${slug}/boxes.yml`, yamlStr, null, `Nuovo modulo ${slug}: boxes.yml`);
}

// STEP 3 — Aggiorna content/moduli/index.yml aggiungendo la nuova entry.
// Restituisce la entry creata (per popolare lo state locale subito).
async function _appendModuloIndex(slug, draft) {
  const indexPath = 'content/moduli/index.yml';
  const today = new Date().toISOString().slice(0, 10);
  const newEntry = {
    slug,
    titolo: draft.titolo.trim(),
    descrizione: draft.descrizione.trim() || undefined,
    pagine: draft.pages.length,
    autore: draft.autore.trim() || undefined,
    categoria: (draft.categoria && draft.categoria.trim()) || undefined,
    aggiornato: today
  };
  // Rimuovi chiavi undefined (jsyaml le scriverebbe come null, sporcando il file)
  Object.keys(newEntry).forEach(k => newEntry[k] === undefined && delete newEntry[k]);

  let indexFile = null;
  try { indexFile = await gh.getFile(indexPath); } catch {}
  let idx = { moduli: [] };
  if (indexFile) {
    idx = jsyaml.load(indexFile.content) || { moduli: [] };
    if (!Array.isArray(idx.moduli)) idx.moduli = [];
  }
  idx.moduli.push(newEntry);
  const newIndexContent = jsyaml.dump(idx, { lineWidth: 120, noRefs: true, sortKeys: false });
  await gh.putFile(indexPath, newIndexContent, indexFile ? indexFile.sha : null, `Nuovo modulo: ${slug}`);
  return { ...newEntry, path: indexPath };
}

// STEP 4 — Pre-popola state.moduliCache coi dataUrl locali (no roundtrip CDN).
// Evita il delay di propagazione raw.githubusercontent.com (può servire 404 per
// qualche secondo dopo il primo PUT). L'utente vede subito le PNG.
// Al refresh dell'app, loadModuloDettaglio rifetcherà dal repo (Contents API).
async function _prepoplaCacheModulo(slug, draft) {
  const localPageUrls = draft.pages.map(p => p.dataUrl);
  // Genero anche versioni light (max 1200px JPEG q.85) per editor/viewer più fluidi.
  // Le originali restano in pageUrls per la generazione PDF/PNG output ad alta risoluzione.
  const localPageUrlsLight = [];
  for (const url of localPageUrls) {
    try { localPageUrlsLight.push(await _resizeImageDataUrl(url, 1200)); }
    catch { localPageUrlsLight.push(url); }
  }
  state.moduliCache = state.moduliCache || {};
  state.moduliCache[slug] = {
    boxesData: _nuovoModuloDefaultBoxesData(),
    boxesSha: null,  // verrà popolato al prossimo getFile (al refresh)
    pristineBoxes: [],
    pageUrls: localPageUrls,           // originali alta risoluzione
    pageUrlsLight: localPageUrlsLight, // versioni ridimensionate per editor
    formValues: {},
    currentPage: 1
  };
  // NB: NON salvato in sessionStorage (vedi _persistModulo: pageUrls escluse perché pesanti)
}

async function _confermaNuovoModulo() {
  const draft = _nuovoModuloDraft;
  if (!draft) return;
  const slug = draft.slug || _slugifyTitolo(draft.titolo);
  if (!slug || !draft.titolo.trim() || draft.pages.length === 0) return;
  if ((state.index.moduli || []).find(m => m.slug === slug)) {
    return toast('Slug già esistente', 'error');
  }

  const progressEl = document.getElementById('nm-progress');
  if (progressEl) progressEl.style.display = 'block';

  try {
    await _uploadPaginePNG(slug, draft.pages, progressEl);
    if (progressEl) progressEl.textContent = 'Creazione boxes.yml…';
    await _creaBoxesYmlIniziale(slug, draft.titolo);
    if (progressEl) progressEl.textContent = 'Aggiornamento index.yml…';
    const indexEntry = await _appendModuloIndex(slug, draft);

    // Aggiorna stato locale (così appare subito senza rebuildIndex)
    state.index.moduli.push(indexEntry);
    rebuildSearchIndex();
    renderNavTree();

    await _prepoplaCacheModulo(slug, draft);

    _nuovoModuloDraft = null;
    closeModal();
    toast(`Modulo "${draft.titolo}" creato`, 'success');
    navigate('modulo', { slug });
  } catch (e) {
    console.error('[nuovoModulo] errore:', e);
    if (progressEl) progressEl.style.display = 'none';
    toast('Errore creazione modulo: ' + e.message, 'error', 6000);
  }
}

/* ============================ MODULI — ELIMINAZIONE (NAV TREE) ============================ */
async function confirmDeleteModulo(slug) {
  if (bloccaSeNonModifica('moduli')) return;
  const m = (state.index.moduli || []).find(x => x.slug === slug);
  const titolo = m ? (m.titolo || slug) : slug;
  showModal({
    title: 'Eliminare il modulo?',
    subtitle: `<strong>${escapeHtml(titolo)}</strong> verrà eliminato definitivamente (cartella e pagine). L'operazione non è reversibile.`,
    body: '<p style="font-size:13px;color:var(--ink-muted);">A differenza di schede e procedure, i moduli non hanno cestino: verranno rimossi subito dal repository.</p>',
    actions: [
      { label: 'Annulla', variant: 'ghost', onClick: closeModal },
      { label: 'Elimina definitivamente', variant: 'danger', onClick: () => { closeModal(); doDeleteModulo(slug); } }
    ]
  });
}

async function doDeleteModulo(slug) {
  showBlockingOverlay('Eliminazione modulo…', 'Non chiudere o ricaricare la pagina.');
  try {
    // 1. Elimino PRIMA tutti i file della cartella content/moduli/<slug>/ (boxes.yml + PNG).
    //    Se qualcosa fallisce, la voce in index.yml NON viene rimossa → il modulo resta
    //    visibile e riprovabile, senza lasciare pagine orfane sul repo.
    const dir = `content/moduli/${slug}`;
    let items = [];
    try { etagCache.delete('dir:' + dir); } catch (e) {}
    try { items = await gh.listDir(dir); } catch (e) { items = []; }
    const fileItems = items.filter(it => it.type === 'file');
    const failed = [];
    let _fi = 0;
    for (const it of fileItems) {
      _fi++;
      updateBlockingOverlay('Eliminazione file…', `File ${_fi} di ${fileItems.length}`);
      try {
        await gh.deleteFile(`${dir}/${it.name}`, it.sha, `Elimina modulo ${slug}: ${it.name}`);
      } catch (e) {
        console.warn('delete file modulo fallita', it.name, e);
        failed.push(it.name);
      }
    }
    if (failed.length) {
      throw new Error(`Impossibile eliminare ${failed.length} file (${failed.join(', ')}). Riprova.`);
    }

    // 2. Solo ora rimuovo la voce da content/moduli/index.yml
    updateBlockingOverlay('Aggiornamento indice…', '');
    const idxFile = await gh.getFile('content/moduli/index.yml');
    if (!idxFile) throw new Error('index.yml dei moduli non trovato');
    const idxData = jsyaml.load(idxFile.content) || {};
    const moduliArr = idxData.moduli || [];
    const before = moduliArr.length;
    idxData.moduli = moduliArr.filter(x => x.slug !== slug);
    if (idxData.moduli.length === before) {
      // Le pagine sono già state eliminate; segnalo ma non blocco (il modulo è di fatto vuoto).
      console.warn('Modulo non presente in index.yml, ma file cartella eliminati:', slug);
    } else {
      await gh.putFile('content/moduli/index.yml', jsyaml.dump(idxData), idxFile.sha, `Elimina modulo: ${slug} (by ${state.session.username})`);
    }

    // 3. Pulisco cache e ricostruisco indice/navigazione
    if (state.moduliCache) delete state.moduliCache[slug];
    hideBlockingOverlay();
    toast('Modulo eliminato', 'success');
    await buildIndex();
    renderNavTree();
    navigate('moduli');
  } catch (e) {
    hideBlockingOverlay();
    toast('Errore eliminazione: ' + e.message, 'error', 6000);
  }
}

/* ====================== MODULI — GESTIONE PAGINE (inserisci / rimuovi) ====================== */

// Estrae le pagine da un file caricato (PDF multipagina o immagine singola) in un array
// di { base64 } pronti per l'upload come page-N.png. Riusa la pipeline del wizard.
async function _estraiPaginePerInserimento(file) {
  const out = [];
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (isPdf) {
    await _ensureLib('pdfjs');
    const arrayBuf = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuf }).promise;
    const SCALE = 2.0;
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width; canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const dataUrl = canvas.toDataURL('image/png');
      out.push({ base64: dataUrl.split(',')[1] });
    }
  } else {
    // immagine: riconverto a PNG via canvas per uniformità (page-N.png)
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file);
    });
    const img = await new Promise((resolve, reject) => {
      const im = new Image(); im.onload = () => resolve(im); im.onerror = reject; im.src = dataUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    out.push({ base64: canvas.toDataURL('image/png').split(',')[1] });
  }
  return out;
}

// Conta le pagine effettive del modulo (da index.yml, con fallback alla cache).
function _moduloPageCount(slug) {
  const m = (state.index.moduli || []).find(x => x.slug === slug);
  if (m && m.pagine > 0) return m.pagine;
  const c = state.moduliCache && state.moduliCache[slug];
  if (c && c.pageUrls) return c.pageUrls.length;
  return 1;
}

// Sposta page-from.png → page-to.png (copia base64 + elimina origine). Usato per rinumerare.
async function _spostaPaginaFile(slug, from, to) {
  const dir = `content/moduli/${slug}`;
  const src = await gh.getFileBase64(`${dir}/page-${from}.png`);
  if (!src) throw new Error(`page-${from}.png non trovata`);
  await gh.putFile(`${dir}/page-${to}.png`, src.base64, null, `Sposta pagina ${from}→${to} (${slug})`, true);
  await gh.deleteFile(`${dir}/page-${from}.png`, src.sha, `Rimuovi vecchia page-${from}.png (${slug})`);
}

// Aggiorna il conteggio pagine in content/moduli/index.yml.
async function _aggiornaPagineIndex(slug, nuovoConteggio) {
  const idxFile = await gh.getFile('content/moduli/index.yml');
  if (!idxFile) throw new Error('index.yml non trovato');
  const idxData = jsyaml.load(idxFile.content) || {};
  const entry = (idxData.moduli || []).find(x => x.slug === slug);
  if (!entry) throw new Error('Modulo non in index.yml');
  entry.pagine = nuovoConteggio;
  entry.aggiornato = new Date().toISOString();
  await gh.putFile('content/moduli/index.yml', jsyaml.dump(idxData), idxFile.sha, `Aggiorna pagine modulo ${slug}: ${nuovoConteggio}`);
}

// Riscrive boxes.yml dopo aver rimappato i box (slittamento pagine).
async function _salvaBoxesRimappati(slug, boxesData) {
  const dir = `content/moduli/${slug}`;
  const f = await gh.getFile(`${dir}/boxes.yml`);
  const yamlStr = jsyaml.dump(boxesData, { lineWidth: 120, noRefs: true, sortKeys: false });
  await gh.putFile(`${dir}/boxes.yml`, yamlStr, f ? f.sha : null, `Rimappa box dopo modifica pagine (${slug})`);
}

// INSERISCI una o più pagine alla posizione `pos` (1-based; pos = N+1 per aggiungere in fondo).
async function inserisciPaginaModulo(slug) {
  if (bloccaSeNonModifica('moduli')) return;
  const total = _moduloPageCount(slug);
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/pdf,image/png,image/jpeg';
  input.onchange = () => {
    const file = input.files && input.files[0];
    if (!file) return;
    // Popup app per scegliere la posizione di inserimento
    const opts = [];
    for (let p = 1; p <= total; p++) opts.push(`<option value="${p}">Prima della pagina ${p}</option>`);
    opts.push(`<option value="${total + 1}" selected>In fondo (dopo la pagina ${total})</option>`);
    showModal({
      title: 'Inserisci pagina',
      subtitle: `File: <strong>${escapeHtml(file.name)}</strong>`,
      body: `<div class="mod-field-group">
        <label class="mod-field-label">Posizione</label>
        <select id="mod-insert-pos" class="mod-input">${opts.join('')}</select>
      </div>`,
      actions: [
        { label: 'Annulla', variant: 'ghost', onClick: closeModal },
        { label: 'Inserisci', onClick: () => {
            const sel = document.getElementById('mod-insert-pos');
            const pos = sel ? parseInt(sel.value, 10) : (total + 1);
            closeModal();
            if (isNaN(pos) || pos < 1 || pos > total + 1) return toast('Posizione non valida', 'error');
            _doInserisciPagina(slug, file, pos, total);
          } }
      ]
    });
  };
  input.click();
}

async function _doInserisciPagina(slug, file, pos, total) {
  showBlockingOverlay('Estrazione pagine…', 'Non chiudere o ricaricare la pagina.');
  try {
    const nuove = await _estraiPaginePerInserimento(file);
    const k = nuove.length;
    if (!k) { hideBlockingOverlay(); return toast('Nessuna pagina estratta', 'error'); }
    const dir = `content/moduli/${slug}`;
    try { etagCache.delete('dir:' + dir); } catch (e) {}
    let step = 0;
    const totSteps = (total - pos + 1) + k + 2; // spostamenti + scritture + boxes + index
    const tick = (label) => { step++; updateBlockingOverlay(label, `Passo ${step} di ${totSteps}`); };
    // 1. Sposto in avanti le pagine esistenti >= pos, dall'ultima alla pos (per non sovrascrivere)
    for (let p = total; p >= pos; p--) {
      tick('Riordino pagine…');
      await _spostaPaginaFile(slug, p, p + k);
    }
    // 2. Scrivo le nuove pagine in pos..pos+k-1
    for (let i = 0; i < k; i++) {
      tick(`Caricamento nuova pagina ${i + 1} di ${k}…`);
      await gh.putFile(`${dir}/page-${pos + i}.png`, nuove[i].base64, null, `Inserisci pagina ${pos + i} (${slug})`, true);
    }
    // 3. Rimappo i box: quelli con pagina >= pos slittano di +k
    tick('Aggiornamento box…');
    const c = state.moduliCache && state.moduliCache[slug];
    if (c && c.boxesData && Array.isArray(c.boxesData.box)) {
      c.boxesData.box.forEach(b => { if ((b.pagina || 1) >= pos) b.pagina = (b.pagina || 1) + k; });
      await _salvaBoxesRimappati(slug, c.boxesData);
    } else {
      const f = await gh.getFile(`${dir}/boxes.yml`);
      if (f) {
        const bd = jsyaml.load(f.content) || { box: [] };
        (bd.box || []).forEach(b => { if ((b.pagina || 1) >= pos) b.pagina = (b.pagina || 1) + k; });
        await _salvaBoxesRimappati(slug, bd);
      }
    }
    // 4. Aggiorno conteggio e ricostruisco
    tick('Finalizzazione…');
    await _aggiornaPagineIndex(slug, total + k);
    if (state.moduliCache) delete state.moduliCache[slug];
    hideBlockingOverlay();
    toast(`${k} pagina/e inserita/e`, 'success');
    await buildIndex();
    navigate('modulo', { slug });
  } catch (e) {
    hideBlockingOverlay();
    toast('Errore inserimento pagina: ' + e.message, 'error', 6000);
  }
}

// RIMUOVI la pagina `pageNum`.
function rimuoviPaginaModulo(slug, pageNum) {
  if (bloccaSeNonModifica('moduli')) return;
  const total = _moduloPageCount(slug);
  if (total <= 1) return toast('Un modulo deve avere almeno una pagina', 'warning');
  showModal({
    title: `Rimuovere la pagina ${pageNum}?`,
    subtitle: `La pagina ${pageNum} e i box su di essa verranno eliminati. Le pagine successive verranno rinumerate.`,
    body: '<p style="font-size:13px;color:var(--ink-muted);">Operazione non reversibile.</p>',
    actions: [
      { label: 'Annulla', variant: 'ghost', onClick: closeModal },
      { label: 'Rimuovi pagina', variant: 'danger', onClick: () => { closeModal(); _doRimuoviPaginaModulo(slug, pageNum, total); } }
    ]
  });
}

async function _doRimuoviPaginaModulo(slug, pageNum, total) {
  showBlockingOverlay('Rimozione pagina…', 'Non chiudere o ricaricare la pagina.');
  try {
    const dir = `content/moduli/${slug}`;
    try { etagCache.delete('dir:' + dir); } catch (e) {}
    let step = 0;
    const totSteps = 1 + (total - pageNum) + 2;
    const tick = (label) => { step++; updateBlockingOverlay(label, `Passo ${step} di ${totSteps}`); };
    // 1. Elimino il file della pagina
    tick('Eliminazione pagina…');
    const target = await gh.getFileBase64(`${dir}/page-${pageNum}.png`);
    if (target) await gh.deleteFile(`${dir}/page-${pageNum}.png`, target.sha, `Rimuovi pagina ${pageNum} (${slug})`);
    // 2. Sposto indietro di 1 le pagine successive (pageNum+1 → pageNum, ecc.)
    for (let p = pageNum + 1; p <= total; p++) {
      tick('Riordino pagine…');
      await _spostaPaginaFile(slug, p, p - 1);
    }
    // 3. Rimappo i box: elimino quelli di pageNum, decremento quelli > pageNum
    tick('Aggiornamento box…');
    const applyBoxRemap = (bd) => {
      bd.box = (bd.box || [])
        .filter(b => (b.pagina || 1) !== pageNum)
        .map(b => { if ((b.pagina || 1) > pageNum) b.pagina = (b.pagina || 1) - 1; return b; });
      return bd;
    };
    const c = state.moduliCache && state.moduliCache[slug];
    if (c && c.boxesData && Array.isArray(c.boxesData.box)) {
      applyBoxRemap(c.boxesData);
      await _salvaBoxesRimappati(slug, c.boxesData);
    } else {
      const f = await gh.getFile(`${dir}/boxes.yml`);
      if (f) { const bd = applyBoxRemap(jsyaml.load(f.content) || { box: [] }); await _salvaBoxesRimappati(slug, bd); }
    }
    // 4. Aggiorno conteggio e ricostruisco
    tick('Finalizzazione…');
    await _aggiornaPagineIndex(slug, total - 1);
    if (state.moduliCache) delete state.moduliCache[slug];
    hideBlockingOverlay();
    toast('Pagina rimossa', 'success');
    await buildIndex();
    navigate('modulo', { slug });
  } catch (e) {
    hideBlockingOverlay();
    toast('Errore rimozione pagina: ' + e.message, 'error', 6000);
  }
}

