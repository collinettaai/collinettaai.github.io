#!/usr/bin/env node
/**
 * Verifica sintassi CollinettaAI.
 * Uso:  node check.js
 *
 * - index.html          : parsa ogni blocco <script> inline con new Function()
 * - letteraai-module.js : parsa l'intero file
 *
 * NB: cattura errori di SINTASSI, non di runtime.
 *     Un `const` riassegnato passa il check e crasha nel browser.
 */

const fs = require('fs');

let totalErrors = 0;

/* ---------- index.html ---------- */

function checkIndexHtml(path = 'index.html') {
  if (!fs.existsSync(path)) {
    console.log(`SKIP  ${path} (non trovato)`);
    return;
  }

  const html = fs.readFileSync(path, 'utf8');
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;

  let m;
  let found = 0;    // tag <script> totali
  let parsed = 0;   // blocchi inline effettivamente parsati
  let skipped = 0;  // esterni o vuoti
  let bad = 0;

  while ((m = re.exec(html)) !== null) {
    found++;
    const tag = m[0];
    const code = m[1];

    // salta <script src="..."> e blocchi vuoti
    if (!code.trim() || /\bsrc\s*=/.test(tag)) {
      skipped++;
      continue;
    }

    // salta i blocchi non-JS (JSON-LD, template, ecc.)
    const typeMatch = tag.match(/\btype\s*=\s*["']([^"']+)["']/i);
    if (typeMatch && !/javascript|module/i.test(typeMatch[1])) {
      skipped++;
      continue;
    }

    parsed++;
    try {
      new Function(code);
    } catch (e) {
      bad++;
      console.log(`  ERRORE  script #${found}: ${e.message}`);
    }
  }

  totalErrors += bad;
  console.log(
    `index.html            tag ${found}  parsati ${parsed}  saltati ${skipped}  errori ${bad}`
  );
}

/* ---------- letteraai-module.js ---------- */

function checkModule(path = 'letteraai-module.js') {
  if (!fs.existsSync(path)) {
    console.log(`SKIP  ${path} (non trovato)`);
    return;
  }

  const js = fs.readFileSync(path, 'utf8');
  let bad = 0;

  try {
    new Function(js);
  } catch (e) {
    bad = 1;
    console.log(`  ERRORE  ${path}: ${e.message}`);
  }

  totalErrors += bad;
  console.log(`letteraai-module.js   errori ${bad}`);
}

/* ---------- moduli estratti in /js (per lo split) ---------- */

function checkSplitModules(dir = 'js') {
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  if (!files.length) return;

  let bad = 0;
  for (const f of files) {
    const src = fs.readFileSync(`${dir}/${f}`, 'utf8');
    try {
      // i moduli ES non passano da new Function(): usa il parser di Node
      new (require('vm').Script)(src, { filename: f });
    } catch (e) {
      bad++;
      console.log(`  ERRORE  ${dir}/${f}: ${e.message}`);
    }
  }

  totalErrors += bad;
  console.log(`${dir}/*.js               file ${files.length}  errori ${bad}`);
}

/* ---------- run ---------- */

console.log('');
checkIndexHtml();
checkModule();
checkSplitModules();
console.log('');
console.log(totalErrors === 0 ? '✓ nessun errore di sintassi' : `✗ ${totalErrors} errori`);
console.log('');

process.exit(totalErrors === 0 ? 0 : 1);
