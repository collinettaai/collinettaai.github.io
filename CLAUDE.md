# CollinettaAI

PWA per neurologia clinica, AOPD Padova. Vanilla JS + CSS + HTML in un unico
`index.html` (~20.400 righe), più `letteraai-module.js` (~5.800 righe) caricato
lazy. **Nessun build tooling, nessun framework, nessun bundler.**

Target primario: Android Chrome PWA. Funziona anche su desktop.
Deploy: GitHub Pages → `https://collinettaai.github.io`.

---

## Regole di lavoro — leggere prima di toccare qualsiasi cosa

1. **Fix chirurgici.** Identifica il problema, spiegalo, poi fai la modifica
   minima che lo risolve. Niente refactor a sorpresa, niente riscritture
   "già che c'ero", niente cambi di stile non richiesti.
2. **Conferma prima di agire** su modifiche a rischio (rinomine globali,
   modifiche allo stato condiviso, tocchi al router o alla navigazione).
3. **Verifica la sintassi dopo OGNI edit.** Vedi sezione Verifica.
4. **Se ho segnalato che una modifica non era richiesta, va revertita**, non
   difesa.
5. Comunicazione e commenti in **italiano**.
6. **Dopo ogni modifica strutturale** (split di un blocco `<script>`,
   spostamento di codice tra file, nuovo `<script src>`, cambio nell'ordine
   di caricamento) **aggiorna, nella stessa sessione**, la mappa dei file in
   "Orientarsi nel codice" e l'ordine dei `<script src>` descritto in
   "In corso — split di index.html". Non rimandare a un edit successivo.

---

## Branch di lavoro

Lo split di `index.html` procede **direttamente su `main`**: il branch
contiene già le estrazioni di `js/splash.js`, `js/costanti.js`,
`js/schede.js` e `js/rubrica.js` (vedi "In corso — split di index.html").
Non esistono branch di lavoro separati per questo split.

Le sessioni remote devono, prima di modificare qualsiasi file:
1. verificare il branch corrente con `git branch --show-current`;
2. se non è `main`, allinearsi a `main` (es. `git checkout main` +
   `git pull`) prima di procedere.

---

## Verifica (obbligatoria dopo ogni modifica)

`index.html` — parsa tutti i blocchi `<script>` inline:

```bash
node -e "
const fs=require('fs');const html=fs.readFileSync('index.html','utf8');
const re=/<script\b[^>]*>([\s\S]*?)<\/script>/gi;let m,i=0,bad=0;
while((m=re.exec(html))){i++;const code=m[1];if(!code.trim()||/\bsrc=/.test(m[0]))continue;try{new Function(code);}catch(e){bad++;console.log('SCRIPT #'+i,e.message);}}
console.log('JS scripts checked',i,'errors',bad);
"
```

Atteso: `errors 0`. Il conteggio degli script deve restare stabile fra un
edit e l'altro — se cambia, qualcosa si è rotto nella struttura HTML.

`letteraai-module.js`:

```bash
node --check letteraai-module.js
```

**Attenzione**: questi controlli catturano errori di *sintassi*, non di
runtime. Un `const` riassegnato passa il check e crasha nel browser.
Per le modifiche non banali, verifica anche a mente la semantica.

---

## Architettura

Due repo distinti:

- **questo repo** (pubblico): `index.html`, `letteraai-module.js`,
  `manifest.json`, `icons/`. Servito da GitHub Pages su
  `collinettaai.github.io`. Nessun custom domain, nessun `CNAME`.
- **`CollinettaAI-data`** (privato): contenuti — schede cliniche, moduli,
  rubrica (`numeri.yml`), user-prefs, cestino, log attività. Accesso via
  GitHub API con PAT inserito al login.

L'app resta domain-agnostic: percorsi relativi, hash-routing, link di
condivisione costruiti da `window.location.origin`.

`raw.githubusercontent.com` non funziona con header Authorization: per i
binari del repo privato serve `gh.getFileBase64(path)` (Contents API →
base64 → data URL inline).

```js
CONFIG = {
  REPO_OWNER: 'raffaele15',
  DATA_REPO_NAME: 'CollinettaAI-data',
  BRANCH: 'main',
  API_BASE: 'https://api.github.com'
}
```

---

## Code style

- Indentazione **2 spazi**
- Funzioni private prefisso `_` (es. `_findNearestHandle`)
- Funzioni globali esposte su `window` (chiamate da `onclick=`)
- Stringhe in apici singoli, template literals con backtick
- Attributi HTML in doppi apici
- Commenti in italiano

---

## Orientarsi nel codice

Il JS è in split progressivo (vedi "In corso — split di index.html"). Stato
attuale:

- **Blocco CSS** — `<style>` in `index.html`, righe ~83–1743: BOOT SPLASH ·
  ATTIVITÀ RECENTE (admin) · MODULI COMPILABILI · NUMERO ROW (compact
  mobile-first) · CALENDARIO (regole `.cal-*`: restano qui anche dopo
  l'estrazione del JS in `js/calendario.js`) · BLOCCHI TIPIZZATI · EDITOR
  A BLOCCHI (Fase 2)
- **`js/costanti.js`**: `CATEGORIA_LABELS`, `SOTTO_LABELS`,
  `HIDE_SUBCATEGORIES` — caricato per primo, subito dopo i CDN (usato da
  più sezioni: VIEW HOME, EXPORT INDICE, CESTINO, NAV TREE, SEARCH)
- **`js/schede.js`**: VIEW PROCEDURA · BLOCCHI TIPIZZATI (schema a blocchi)
  · VIEW EDITOR · EDITOR A BLOCCHI (Fase 2) · AI IMPORT WORKFLOW
- **`js/rubrica.js`**: VIEW NUMERI (comprende anche HOME CONTATTI FISSATI
  e RIORDINO RUBRICA, senza marcatore di commento proprio)
- **`js/moduli.js`**: VIEW MODULI COMPILABILI (+ STATO) · MODULI —
  GENERAZIONE OUTPUT / PERSISTENZA GITHUB / CREAZIONE NUOVO MODULO ·
  MODULI — ELIMINAZIONE (`confirmDeleteModulo`/`doDeleteModulo`, in
  origine dentro NAV TREE) · MODULI — GESTIONE PAGINE (inserisci/rimuovi).
  Tre regioni non contigue nell'`index.html` originale, riunite in un solo
  file; `renameModulo` resta nel blocco principale (disabilitato, non
  spostato)
- **`js/calendario.js`**: VIEW CALENDARIO — costanti `CAL_CATEGORIES`,
  `CAL_LEZIONE_ANNI`, `CAL_DOW`, `CAL_MONTHS`, griglia/legenda/eventi,
  editor evento e ricorrenze, persistenza `content/calendar.yml`, import
  guardie (parser testo + PDF via `ensureLetterAI`). Include un listener
  top-level (`document.addEventListener('click', …)`) che chiude il
  dropdown "lezioni" al click fuori: gira al load, autocontenuto. Il CSS
  `.cal-*` NON è stato spostato, resta nel blocco `<style>` di `index.html`.
  Unico export verso l'esterno: `renderCalendario` (chiamata dal ROUTER).
  Legge/scrive lo stato condiviso `state.index.calendar`
- **`js/cestino.js`**: VIEW CESTINO + CESTINO OPERATIONS (cestino dei
  contenuti: schede/procedure). Definisce anche `nuovaProcedura` e
  `confirmDelete`, usati da viste lista procedure, NAV TREE e schede.js.
  Export verso ROUTER: `renderCestino`. NB: distinto da CESTINO USER-PREFS
  (in `js/admin.js`), che è il cestino delle preferenze utente
- **`js/admin.js`**: GESTIONE UTENTI · ATTIVITÀ RECENTE · CESTINO
  USER-PREFS (tre sezioni admin-only contigue). Export verso ROUTER:
  `renderGestioneUtenti`, `renderAttivita`, `renderCestinoUtenti`
- **`js/navtree.js`**: NAV TREE & EDIT MODE — il blocco più grosso e più
  eterogeneo. Contiene: (1) l'albero di navigazione/sidebar (`navState`,
  `renderNavTree`, drill in/out, builder per procedure/clinica/numeri/
  moduli/lettere, menu contestuali); (2) l'EDIT MODE con le operazioni di
  rinomina/spostamento/eliminazione di schede e procedure
  (`renameProcedura`, `_openRenameSchedaModal`, `moveProcedura`/
  `_doMoveProcedura`, `_moveSchedaCartella`, `_updateSchedaSlugReferences`,
  rename/move/delete sottocategoria e macro-categoria); (3) TUTTA l'editoria
  della rubrica/numeri (`openContattoEditor`, `editContatto`,
  `deleteContatto`, `setContactKind`, tag-edit, `saveNumeriForSource`/
  `saveNumeriFile`, gruppi e contatti) — nonostante il nome "rubrica",
  queste funzioni vivono qui, NON in `js/rubrica.js`; (4) helper generici
  molto usati altrove, definiti qui: `isAdmin`, `escapeJs`, `slugifyLocal`,
  `showProgressModal`, `checkRateLimitFor`. `renameModulo` (disabilitato)
  è qui. Nessun codice top-level attivo. Export principali verso il ROUTER
  e le altre viste: `renderNavTree`, `isAdmin`, `escapeJs` (usati da quasi
  tutti i file estratti a runtime)
- **`js/reparto.js`**: SEZIONE REPARTO (consulto AI su paziente ricoverato:
  carica cartella → anonimizza via regex di LetteraAI → prompt modificabile).
  Costanti `REPARTO_*` (incluso il template literal `REPARTO_SYSTEM_DEFAULT`)
  e init idempotente `state.reparto = state.reparto || {…}` a top-level, più
  handler `window.setReparto*/saveReparto*/…` (stile assegnazione a `window`,
  non `function`). Export verso ROUTER: `renderReparto`. Il CSS `.rep-*`
  resta in `index.html`. NB: le occorrenze di "reparto" altrove (kind
  contatto in rubrica, campo "Sede / Reparto" nei moduli, voce nav)
  NON sono questa sezione
- **`js/splash.js`**: animazione splash (emblema diapason), caricato per
  ultimo, dopo il blocco principale
- **Blocco JS principale** — `<script>` in `index.html`, ora spezzato in
  TRE segmenti inline dai `<script src>` estratti: (A) righe ~1905–~5710
  (CONFIG → VIEW HOME) · [reparto.js] · (B) ~5712–~5840 (VISTE LISTA
  PROCEDURE) · [schede.js, rubrica.js, moduli.js, calendario.js, cestino.js,
  admin.js, navtree.js] · (C) ~5848–fine (SEARCH · MODAL · INIT).
  Contenuto del segmento A: CONFIG · BOOTSTRAP PAT · UTILITIES · CHIPS
  MULTI-SELECT · USER PREFERENCES · IMAGE HELPERS · CONDIVISIONE LINK ·
  EXPORT INDICE (NotebookLM) · CRYPTO · GITHUB API + IN-MEMORY CACHES ·
  CONTENT PARSING · STATE · INDEX BUILD · LOCKS · LOGIN · ROUTER · VIEW
  HELPERS · VIEW HOME

Alcuni nomi ricorrono in blocco CSS e blocco JS (es. "BLOCCHI TIPIZZATI",
"ATTIVITÀ RECENTE"): non sono duplicati, sono la stessa feature vista dal
lato stile (CSS) e dal lato logica (JS) — quando cerchi per nome, controlla
in quale blocco/file ti trovi.

I file estratti (`js/schede.js`, `js/rubrica.js`, ecc.) non sono
autosufficienti: chiamano e vengono chiamati da funzioni/costanti che
vivono ancora nel blocco principale o in altri file estratti (es.
`blockEditor` in schede.js è usato anche dall'editor scheda clinica;
`renderContattoCard`/`_contattoMatchesQuery` in rubrica.js sono usati dal
picker "Numeri correlati" in CHIPS MULTI-SELECT). Lo split è solo
organizzativo, non introduce incapsulamento.

Alcune funzionalità della tabella sotto (LetterAI loader, Sezione Reparto,
home contatti fissati, riordino rubrica, `renderNumeroRow`, spinner/
segnalazioni) non hanno un blocco commento dedicato: si trovano cercando il
nome della funzione, non un marcatore di sezione.

**Non fidarti dei numeri di riga**: il file evolve e si spostano a ogni edit.
Cerca sempre per marcatore di commento o nome di funzione.

### Dove metto le mani per…

| Voglio modificare… | Cerca |
|---|---|
| Riga contatto (preferiti/MdG/sez. custom/UOC) | `renderNumeroRow` + CSS `.numero-row*` |
| Contatto in ricerca globale / picker | `renderContattoCard` |
| Box "UOC · Sezione" | `renderContattiGroupedBox` |
| Gerarchia UOC→sezioni (MdG) | `renderUocSezioniBox` |
| Sezioni personalizzate | `renderCustomSezioniHtml` |
| Vista/filtri rubrica | `renderNumeri(filter)` |
| Ordine contatti in una UOC | `sortContattiForDisplay` |
| Riordino manuale sezioni/contatti | `moveSezione` / `moveContatto` |
| Editor contatto | `js/navtree.js`: `openContattoEditor` |
| Preferiti (stella, popup, sezioni) | `openPinSezioniPopup`, `userPrefs` |
| Contatti fissati in home | `renderHomeNumeriSection` |
| Editor a blocchi (schede) | `blockEditor`, `_wireBlockEditorUndoRedo` |
| Editor tabella | `_renderTableEditor` + `renderBloccoTable` |
| Rinomina slug scheda | `js/navtree.js`: `_openRenameSchedaModal` + `_updateSchedaSlugReferences` |
| Sposta scheda | `js/navtree.js`: `moveProcedura` → `_doMoveProcedura` |
| Albero di navigazione / edit mode | `js/navtree.js`: `renderNavTree`, `navState`, `toggleEditMode` |
| Editoria rubrica/numeri (contatti, gruppi, macro-cat) | `js/navtree.js`: `openContattoEditor`, `saveNumeriForSource`, `renameMacroCategoria` |
| Permessi admin / escape JS / slug | `js/navtree.js`: `isAdmin`, `escapeJs`, `slugifyLocal` |
| Navigazione, history, scroll-restore | `navigate`, `_onHistoryPop`, `shouldGuardBack`, `_onPopState`, `_scrollByPos` |
| Gesti touch mobile + splash | handler `touchstart`, `hideBootSplash` |
| Altezza topbar | `initTopbarMeasure` + CSS `--topbar-height` |
| Sezione Reparto | `js/reparto.js`: `renderReparto` + costanti `REPARTO_*` + CSS `.rep-*` (in `index.html`) |
| Calendario (griglia/eventi/import) | `js/calendario.js`: `renderCalendario`, `openCalEventModal`, `parseGuardieText` + CSS `.cal-*` (in `index.html`) |
| Cestino contenuti (schede/procedure) | `js/cestino.js`: `renderCestino`, `confirmDelete`, `nuovaProcedura` |
| Admin: utenti / attività / cestino prefs | `js/admin.js`: `renderGestioneUtenti`, `renderAttivita`, `renderCestinoUtenti` |
| Generatore lettere | `letteraai-module.js` via `ensureLetterAI` / `_openLetterAI` |
| Lettura/scrittura GitHub | oggetto `gh` |
| Moduli: pagine | `inserisciPaginaModulo` / `rimuoviPaginaModulo` |
| Moduli: eliminare | `confirmDeleteModulo` / `doDeleteModulo` |
| Font box modulo (% altezza) | `_autoFitBoxFont`, `_renderModuloPaginaSuCanvas` |
| Overlay bloccante | `showBlockingOverlay` |

---

## Trappole note

- **`text-transform:uppercase`**: la regola globale `label{}` manda in ALL CAPS
  le etichette di checkbox e checklist. Fix = reset mirato, non toccare la
  regola globale.
- **`history.state` non deve contenere lo scroll**: scriverlo via `replaceState`
  corrompe il tracking di `pos`. Lo scroll vive nella mappa separata
  `_scrollByPos`.
- **Marked.js GFM**: la tilde singola viene interpretata come strikethrough nei
  blocchi di testo con notazione clinica. Bug aperto.
- **`str_replace` su contesto saturo** può cancellare header di funzioni.
  Verifica sempre dopo.
- **CSS `.rep-*` duplicato** da `.lt-*`: intenzionale, le `lt-*` esistono solo a
  modulo LetteraAI caricato.
- **PAT in localStorage**: problema architetturale noto, in attesa di un backend
  proxy. Non è una svista.
- **`<script src>` inserito dentro un blocco `<script>` ancora aperto**: il
  tokenizer HTML (e la regex di `check.js`) chiude il blocco al primo
  `</script>` che incontra — anche se è quello embedded nel tag appena
  inserito. Il codice successivo finisce trattato come HTML, non JS, e
  `check.js` non lo segnala (stesso punto cieco del browser). Quando uno
  split taglia un pezzo dal *mezzo* del blocco principale, il nuovo
  `<script src=...>` va sempre incorniciato così: `</script>` (chiude la
  parte precedente) · `<script src="...">` · `<script>` (riapre per la
  parte restante). Verifica empirica: cerca `<script\b[^>]*>([\s\S]*?)<\/script>`
  su tutto il file e controlla che i confini di ciascun match coincidano con
  quelli attesi, non fidarti solo di `node check.js`.

---

## Librerie (tutte via CDN jsdelivr, con SRI)

jsPDF 2.5.1 · PDF.js 3.11.174 · browser-image-compression · js-yaml ·
DOMPurify · marked.js (GFM) · SortableJS · Fuse.js

Niente bundle inline, niente service worker, PWA offline non implementata.

---

## Storage locale

| Key | Storage | Contenuto |
|---|---|---|
| `SESSION_KEY` | localStorage | PAT GitHub (cifrato) |
| `theme` | localStorage | light/dark |
| `font-size` | localStorage | sm/md/lg/xl |
| `modulo:<slug>` | sessionStorage | cache modulo (no pageUrls) |
| `collinetta:pazienti_recenti` | sessionStorage | ultimi 20 pazienti |

---

## In corso — split di index.html

Estrazione del blocco JS principale (originariamente righe ~1905–20319) in
file separati sotto `js/`, caricati con `<script src>` classici.

**Decisione architetturale: NIENTE ES modules.** Il codice usa `onclick="fn()"`
in centinaia di punti, che richiede le funzioni su `window`. Gli script classici
condividono lo scope globale, quindi lo spostamento è puro trasferimento di
testo senza toccare la logica. Con `type="module"` ogni funzione andrebbe
riesposta a mano.

Conseguenze da rispettare:
- L'ordine dei `<script src>` in `index.html` conta: le definizioni devono
  precedere gli usi al momento del caricamento.
- Tagliare sempre per confine di funzione, mai per numero di riga.
- Rilocalizzare i confini per marcatore di commento prima di ogni
  estrazione, mai per numero di riga (si spostano a ogni edit).
- Quando lo split taglia un pezzo dal *mezzo* del blocco `<script>`
  principale (cioè non dalla coda), va chiuso e riaperto attorno al nuovo
  `<script src>` — vedi trappola "`<script src>` inserito dentro un blocco
  `<script>` ancora aperto".
- `_stampaPagineA4` contiene un `<script>` annidato in un template literal
  (`<\/script>` con escape): non spezzare quella funzione.
- Verificare con `node check.js` dopo ogni estrazione, e comunque con la
  scansione empirica della trappola sopra (i confini `<script>`, non solo
  gli errori di sintassi).

Stato:
- ✅ `js/splash.js` — animazione splash
- ✅ `js/costanti.js` — CATEGORIA_LABELS, SOTTO_LABELS, HIDE_SUBCATEGORIES
- ✅ `js/schede.js` — VIEW PROCEDURA · BLOCCHI TIPIZZATI · VIEW EDITOR ·
  EDITOR A BLOCCHI · AI IMPORT WORKFLOW
- ✅ `js/rubrica.js` — VIEW NUMERI (+ home contatti fissati, riordino rubrica)
- ✅ `js/moduli.js` — VIEW MODULI COMPILABILI · GENERAZIONE OUTPUT ·
  PERSISTENZA GITHUB · CREAZIONE NUOVO MODULO · ELIMINAZIONE (ex NAV TREE)
  · GESTIONE PAGINE (tre regioni non contigue riunite in un file)
- ✅ `js/calendario.js` — VIEW CALENDARIO (blocco contiguo, listener
  top-level incluso; CSS `.cal-*` lasciato in `index.html`)
- ✅ `js/cestino.js` — VIEW CESTINO + CESTINO OPERATIONS (cestino contenuti)
- ✅ `js/admin.js` — GESTIONE UTENTI · ATTIVITÀ RECENTE · CESTINO USER-PREFS
  (trio admin contiguo)
- ✅ `js/reparto.js` — SEZIONE REPARTO (taglio in mezzo al blocco 1: ha
  spezzato il primo `<script>` inline in due segmenti A/B; CSS `.rep-*`
  lasciato in `index.html`)
- ✅ `js/navtree.js` — NAV TREE & EDIT MODE (taglio di testa del blocco 2;
  include anche l'editoria rubrica/numeri e gli helper `isAdmin`/`escapeJs`/
  `slugifyLocal`)
- ⬜ search → modal → core/init (per ultimo)

Baseline `check.js` attuale (dopo navtree.js): `tag 19  parsati 4
saltati 15  errori 0`.
