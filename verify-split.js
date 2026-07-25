#!/usr/bin/env node
/**
 * Verifica strutturale dello split di index.html — CollinettaAI.
 * Uso:  node verify-split.js
 *
 * Complementare a check.js (che verifica solo la SINTASSI). Qui controlla la
 * COERENZA dello split, indipendente dai numeri di riga (si adatta da solo man
 * mano che l'estrazione procede):
 *
 *   1) Sintassi di ogni blocco <script> inline e di ogni file js/*.js + letteraai
 *   2) Ordine di caricamento dei <script src> (le definizioni prima degli usi)
 *   3) Definizioni top-level duplicate fra index.html e i vari js/*.js
 *      (una funzione/const definita in due file crasha o si sovrascrive in modo
 *       silenzioso nel browser: check.js NON lo vede)
 *   4) Conteggio dei blocchi inline parsati (deve restare stabile fra un edit e
 *      l'altro: se cambia, un confine <script> si è rotto — cfr. trappola CLAUDE.md)
 *   5) Target del ROUTER (case '<route>': fn(...)) tutti risolti a una definizione
 *   6) [opzionale] Confronto con un commit git: l'insieme delle definizioni
 *      top-level dev'essere INVARIANTE (uno split sposta il codice, non lo perde
 *      né lo duplica). Utile per validare l'ultimo split:
 *          node verify-split.js --diff HEAD     (split non ancora committato)
 *          node verify-split.js --diff HEAD~1   (ultimo split già committato)
 *      Segnala come errore ogni nome PRESENTE nel ref ma SPARITO ora.
 *
 * Exit code 0 = tutto ok, 1 = almeno un problema. Nessun errore atteso.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let problems = 0;
const fail = (msg) => { console.log('  ✗ ' + msg); problems++; };
const ok = (msg) => console.log('  ✓ ' + msg);

const ROOT = __dirname;
const INDEX = path.join(ROOT, 'index.html');
const JS_DIR = path.join(ROOT, 'js');
const LETTERAI = path.join(ROOT, 'letteraai-module.js');

if (!fs.existsSync(INDEX)) { console.error('index.html non trovato — esegui dalla root del repo'); process.exit(2); }

const html = fs.readFileSync(INDEX, 'utf8');

/* ---- helper: rimuove stringhe/commenti per l'analisi delle definizioni ---- */
function strip(s) {
  let o = '', i = 0; const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === '/' && s[i + 1] === '/') { while (i < n && s[i] !== '\n') i++; }
    else if (c === '/' && s[i + 1] === '*') { i += 2; while (i < n && !(s[i] === '*' && s[i + 1] === '/')) i++; i += 2; }
    else if (c === "'" || c === '"') { const q = c; i++; while (i < n && s[i] !== q) { if (s[i] === '\\') i++; i++; } i++; o += ' '; }
    else if (c === '`') { i++; while (i < n && s[i] !== '`') { if (s[i] === '\\') i++; i++; } i++; o += ' '; }
    else { o += c; i++; }
  }
  return o;
}

/* ---- helper: definizioni top-level (colonna 0) di un sorgente ---- */
function topLevelDefs(src) {
  const defs = [];
  for (const line of src.split('\n')) {
    let m;
    if ((m = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(line))) defs.push(m[1]);
    else if ((m = /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(line))) defs.push(m[1]);
  }
  return defs;
}

/* ======================= 1) SINTASSI + 4) CONTEGGIO ======================= */
console.log('\n[1] Sintassi blocchi inline + file js/');
const reScript = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m, inlineParsed = 0, srcTags = [], tagTotal = 0;
const inlineSources = [];
while ((m = reScript.exec(html)) !== null) {
  tagTotal++;
  const attrs = m[1], code = m[2];
  const srcMatch = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs);
  if (srcMatch) { srcTags.push(srcMatch[1]); continue; }
  if (!code.trim()) continue;
  const typeMatch = /\btype\s*=\s*["']([^"']+)["']/i.exec(attrs);
  if (typeMatch && !/javascript|module/i.test(typeMatch[1])) continue;
  inlineParsed++;
  inlineSources.push(code);
  try { new Function(code); }
  catch (e) { fail(`blocco inline #${inlineParsed}: ${e.message}`); }
}
ok(`tag <script> totali: ${tagTotal} — inline JS parsati: ${inlineParsed} — src: ${srcTags.length}`);

const jsFiles = fs.existsSync(JS_DIR) ? fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js')).sort() : [];
for (const f of jsFiles) {
  const src = fs.readFileSync(path.join(JS_DIR, f), 'utf8');
  try { new Function(src); ok(`js/${f}`); }
  catch (e) { fail(`js/${f}: ${e.message}`); }
}
if (fs.existsSync(LETTERAI)) {
  try { new Function(fs.readFileSync(LETTERAI, 'utf8')); ok('letteraai-module.js'); }
  catch (e) { fail(`letteraai-module.js: ${e.message}`); }
}

/* ======================= 2) ORDINE <script src> ======================= */
console.log('\n[2] Ordine di caricamento <script src> (dentro <head>/<body>, in ordine di documento)');
console.log('  ' + srcTags.filter(s => !/^https?:/.test(s)).join('  →  '));

/* =================== 3) DEFINIZIONI DUPLICATE =================== */
console.log('\n[3] Definizioni top-level duplicate fra file');
const defOwners = new Map(); // name -> [file...]
const record = (name, where) => {
  if (!defOwners.has(name)) defOwners.set(name, []);
  defOwners.get(name).push(where);
};
inlineSources.forEach((code, i) => topLevelDefs(code).forEach(n => record(n, `index.html:inline#${i + 1}`)));
for (const f of jsFiles) topLevelDefs(fs.readFileSync(path.join(JS_DIR, f), 'utf8')).forEach(n => record(n, `js/${f}`));

let dupCount = 0;
for (const [name, owners] of defOwners) {
  // più occorrenze in file DIVERSI (o più volte nello stesso) = sospetto
  const uniq = [...new Set(owners)];
  if (owners.length > 1) { fail(`"${name}" definito ${owners.length}× → ${owners.join(', ')}`); dupCount++; }
  else if (uniq.length > 1) { fail(`"${name}" definito in più file → ${uniq.join(', ')}`); dupCount++; }
}
if (dupCount === 0) ok(`nessun duplicato (${defOwners.size} identificatori top-level unici)`);

/* =================== 5) TARGET DEL ROUTER =================== */
console.log('\n[5] Target del ROUTER risolti a una definizione');
const allDefs = new Set(defOwners.keys());
// aggiungo i nomi definiti in letteraai (potrebbero essere target)
if (fs.existsSync(LETTERAI)) topLevelDefs(fs.readFileSync(LETTERAI, 'utf8')).forEach(n => allDefs.add(n));
// individuo il/i router: righe "case '<x>': fnName("
const routerRe = /case\s+['"][\w-]+['"]\s*:\s*([A-Za-z_$][\w$]*)\s*\(/g;
let r, routerTargets = new Set();
// sul sorgente GREZZO: le label dei case sono stringhe, strip() le cancellerebbe
const KW = new Set(['if', 'for', 'while', 'switch', 'return', 'await', 'typeof', 'new', 'do', 'else', 'try', 'throw']);
while ((r = routerRe.exec(html)) !== null) if (!KW.has(r[1])) routerTargets.add(r[1]);
if (routerTargets.size === 0) {
  console.log('  (nessun case router riconosciuto — pattern cambiato? verifica manuale)');
} else {
  let missing = 0;
  for (const t of routerTargets) if (!allDefs.has(t)) { fail(`target router "${t}" non definito in nessun file`); missing++; }
  if (missing === 0) ok(`${routerTargets.size} target router tutti risolti`);
}

/* =============== 6) CONFRONTO CON UN COMMIT (opzionale) =============== */
const diffIdx = process.argv.indexOf('--diff');
if (diffIdx !== -1) {
  const ref = process.argv[diffIdx + 1] || 'HEAD';
  console.log(`\n[6] Invarianza definizioni top-level vs "${ref}" (uno split sposta, non perde)`);
  try {
    // estrae blocchi inline JS dal sorgente di index.html a quel ref
    const inlineDefsOf = (src) => {
      const out = [];
      const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
      let mm;
      while ((mm = re.exec(src)) !== null) {
        const attrs = mm[1], code = mm[2];
        if (/\bsrc\s*=/.test(attrs) || !code.trim()) continue;
        const tm = /\btype\s*=\s*["']([^"']+)["']/i.exec(attrs);
        if (tm && !/javascript|module/i.test(tm[1])) continue;
        out.push(...topLevelDefs(code));
      }
      return out;
    };
    // elenco file tracciati al ref: index.html + js/*.js (+ letteraai se c'è)
    const tracked = execSync(`git ls-tree -r --name-only ${ref}`, { cwd: ROOT, encoding: 'utf8' })
      .split('\n').map(s => s.trim()).filter(Boolean);
    const refDefs = new Set();
    for (const file of tracked) {
      if (file !== 'index.html' && !/^js\/.+\.js$/.test(file) && file !== 'letteraai-module.js') continue;
      const src = execSync(`git show ${ref}:${file}`, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      (file === 'index.html' ? inlineDefsOf(src) : topLevelDefs(src)).forEach(n => refDefs.add(n));
    }
    // insieme attuale (working tree): defOwners chiavi + letteraai
    const nowDefs = new Set(defOwners.keys());
    if (fs.existsSync(LETTERAI)) topLevelDefs(fs.readFileSync(LETTERAI, 'utf8')).forEach(n => nowDefs.add(n));

    const lost = [...refDefs].filter(n => !nowDefs.has(n));
    const added = [...nowDefs].filter(n => !refDefs.has(n));
    if (lost.length) lost.forEach(n => fail(`definizione "${n}" presente in ${ref} ma SPARITA ora`));
    else ok(`nessuna definizione persa (${refDefs.size} nomi al ref, ${nowDefs.size} ora)`);
    if (added.length) console.log(`  · ${added.length} nuove definizioni (attese se hai aggiunto codice): ${added.slice(0, 12).join(', ')}${added.length > 12 ? '…' : ''}`);
  } catch (e) {
    fail(`confronto con ${ref} non riuscito: ${e.message.split('\n')[0]}`);
  }
}

/* ======================= ESITO ======================= */
console.log('\n' + (problems === 0
  ? '✓ VERIFICA OK — nessun problema strutturale'
  : `✗ ${problems} problema/i — vedi sopra`));
process.exit(problems === 0 ? 0 : 1);
