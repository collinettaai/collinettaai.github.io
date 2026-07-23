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

`index.html` è organizzato in blocchi commentati
`/* ======== NOMESEZIONE ======== */`.

**Non fidarti dei numeri di riga**: il file evolve e si spostano a ogni edit.
Cerca sempre per marcatore di commento o nome di funzione.

Sezioni principali, in ordine: CONFIG · BOOTSTRAP PAT · UTILITIES ·
LETTERAAI LOADER · CHIPS MULTI-SELECT · USER PREFERENCES · IMAGE HELPERS ·
CONDIVISIONE LINK · CRYPTO · GITHUB API + CACHE · CONTENT PARSING · STATE ·
INDEX BUILD · LOCKS · LOGIN · ROUTER · VIEW HELPERS · VIEW HOME ·
SEZIONE REPARTO · VIEW PROCEDURA · BLOCCHI TIPIZZATI · VIEW EDITOR ·
AI IMPORT · VIEW NUMERI (rubrica) · HOME CONTATTI FISSATI · RIORDINO
RUBRICA · renderNumeroRow · VIEW MODULI · VIEW CALENDARIO · VIEW CESTINO ·
GESTIONE UTENTI · ATTIVITÀ RECENTE · NAV TREE · SEARCH · MODAL · INIT ·
SPINNER + SEGNALAZIONI

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
| Editor contatto | `openContattoEditor` |
| Preferiti (stella, popup, sezioni) | `openPinSezioniPopup`, `userPrefs` |
| Contatti fissati in home | `renderHomeNumeriSection` |
| Editor a blocchi (schede) | `blockEditor`, `_wireBlockEditorUndoRedo` |
| Editor tabella | `_renderTableEditor` + `renderBloccoTable` |
| Rinomina slug scheda | `_openRenameSchedaModal` + `_updateSchedaSlugReferences` |
| Sposta scheda | `moveProcedura` → `_doMoveProcedura` |
| Navigazione, history, scroll-restore | `navigate`, `_onHistoryPop`, `shouldGuardBack`, `_onPopState`, `_scrollByPos` |
| Gesti touch mobile + splash | handler `touchstart`, `hideBootSplash` |
| Altezza topbar | `initTopbarMeasure` + CSS `--topbar-height` |
| Sezione Reparto | `renderReparto` + costanti `REPARTO_*` |
| Generatore lettere | `letteraai-module.js` via `ensureLetterAI` / `_openLetterAI` |
| Lettura/scrittura GitHub | oggetto `gh` |
| Permessi admin | `isAdmin()` |
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

## In corso

Split di `index.html` in moduli ES separati. Vedi il branch
`refactor/split-modules` quando attivo.
