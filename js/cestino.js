/* ============================ VIEW — CESTINO ============================ */
function renderCestino() {
  const items = state.index.cestino || [];
  $('main-content').innerHTML = `
    <div class="page-head">
      <div class="page-eyebrow">Sistema</div>
      <h1 class="page-title">Cestino</h1>
      <div style="margin-top:12px;font-size:13px;color:var(--ink-muted);">
        File eliminati. Possono essere ripristinati o eliminati definitivamente.
      </div>
    </div>
    ${items.length === 0 ? `
      <div class="empty">
        <div class="empty-title">Cestino vuoto</div>
        <p>Nessun file archiviato.</p>
      </div>
    ` : items.map(it => `
      <div class="numero-row">
        <div>
          <div style="font-family:var(--serif);font-size:16px;font-weight:500;color:var(--ink);">${escapeHtml(it.titolo || it.filename)}</div>
          <div style="font-size:12px;color:var(--ink-muted);margin-top:2px;">
            ${escapeHtml(it.filename)} · eliminato ${timeAgo(it.eliminato_data || it.ultima_modifica)} da <span style="font-family:var(--mono);">${escapeHtml(it.eliminato_da || it.modificato_da || '—')}</span>
          </div>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn ghost sm" onclick="restoreFromCestino('${escapeHtml(it.path)}', '${escapeHtml(it.filename)}')">Ripristina</button>
          <button class="btn ghost sm" onclick="purgeFromCestino('${escapeHtml(it.path)}', '${escapeHtml(it.filename)}', '${escapeHtml(it.sha)}')">Elimina definitivamente</button>
        </div>
      </div>
    `).join('')}`;
}

/* ============================ CESTINO OPERATIONS ============================ */
function nuovaProcedura(preset = {}) {
  if (bloccaSeNonModifica('procedure')) return;
  const existingSlugs = new Set(state.index.procedure.map(p => p.slug));
  const catOptions = Object.entries(CATEGORIA_LABELS).slice(0, 6).map(([k, v]) =>
    `<option value="${escapeHtml(k)}" ${preset.categoria === k ? 'selected' : ''}>${escapeHtml(v)}</option>`
  ).join('');

  // Collect existing sottocategorie per categoria for autocomplete
  const subsByCat = {};
  state.index.procedure.forEach(p => {
    if (!p.categoria || !p.sottocategoria) return;
    if (!subsByCat[p.categoria]) subsByCat[p.categoria] = new Set();
    subsByCat[p.categoria].add(p.sottocategoria);
  });

  showModal({
    title: 'Nuova procedura',
    subtitle: 'Crea un file vuoto e apre l\'editor.',
    body: `
      <div class="field">
        <label>Titolo</label>
        <input type="text" id="np-titolo" placeholder="es. Richiesta RX torace">
      </div>
      <div class="field">
        <label>Slug (nome file)</label>
        <input type="text" id="np-slug" class="mono-input" placeholder="es. richiesta-rx-torace">
        <div style="font-size:11px;color:var(--ink-muted);margin-top:4px;">Solo minuscole, cifre, trattini. Deve essere unico.</div>
      </div>
      <div class="field">
        <label>Categoria</label>
        <select id="np-categoria">${catOptions}</select>
      </div>
      <div class="field">
        <label>Sottocategoria (opzionale)</label>
        <input type="text" id="np-sottocategoria" class="mono-input" list="np-subs-list" placeholder="es. cardiologia" value="${escapeHtml(preset.sottocategoria || '')}">
        <datalist id="np-subs-list"></datalist>
        <div style="font-size:11px;color:var(--ink-muted);margin-top:4px;">Solo minuscole, cifre, trattini. Suggerimenti in base alla categoria scelta.</div>
      </div>
      <div id="np-error" style="color:var(--danger);font-size:13px;display:none;margin-top:8px;"></div>`,
    actions: [
      { label: 'Annulla', variant: 'ghost', onClick: closeModal },
      { label: 'Crea e apri editor', onClick: async () => {
        const titolo = $('np-titolo').value.trim();
        let slug = $('np-slug').value.trim().toLowerCase();
        const categoria = $('np-categoria').value;
        const sottocat = $('np-sottocategoria').value.trim().toLowerCase();
        const err = $('np-error');
        err.style.display = 'none';
        const show = m => { err.textContent = m; err.style.display = 'block'; };
        if (!titolo) return show('Titolo obbligatorio.');
        if (!slug) slug = titolo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
        if (!/^[a-z0-9-]+$/.test(slug)) return show('Slug non valido.');
        if (existingSlugs.has(slug)) return show('Slug già esistente.');
        if (sottocat && !/^[a-z0-9-]+$/.test(sottocat)) return show('Sottocategoria: solo minuscole, cifre, trattini.');

        const nf = {
          id: slug, titolo,
          categoria,
          tag: [],
          // Inizializza contenuti come array vuoto: così il block editor (nuovo)
          // viene usato di default per le nuove procedure invece del fallback Toast UI.
          contenuti: [],
          ultima_modifica: nowIso(),
          modificato_da: state.session.username,
          cronologia_recente: [{ data: nowIso(), utente: state.session.username, nota: 'creazione' }]
        };
        if (sottocat) nf.sottocategoria = sottocat;

        const body = '';
        const content = stringifyMarkdown(nf, body);
        // Schema cartella per scheda: content/procedure/<cat>/[<sub>/]<slug>/scheda.md
        let path = `content/procedure/${categoria}/`;
        if (sottocat) path += `${sottocat}/`;
        path += `${slug}/scheda.md`;

        try {
          const res = await gh.putFile(path, content, null, `Nuova procedura: ${slug} (by ${state.session.username})`);
          closeModal();
          toast(`Procedura "${slug}" creata`, 'success');
          state.index.procedure.push({ slug, path, sha: res.content.sha, ...nf, body_preview: '', body });
          rebuildSearchIndex();
          updateNavCounts();
          navigate('procedura-edit', { slug });
        } catch (e) {
          show('Errore creazione: ' + e.message);
        }
      }}
    ]
  });

  setTimeout(() => {
    const tIn = $('np-titolo'), sIn = $('np-slug'), catIn = $('np-categoria'), subsList = $('np-subs-list');
    let userEditedSlug = false;
    sIn.addEventListener('input', () => { userEditedSlug = true; });
    tIn.addEventListener('input', () => {
      if (userEditedSlug) return;
      sIn.value = tIn.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
    });
    function updateSubs() {
      const cat = catIn.value;
      const subs = subsByCat[cat] ? [...subsByCat[cat]] : [];
      subsList.innerHTML = subs.map(s => `<option value="${escapeHtml(s)}">`).join('');
    }
    catIn.addEventListener('change', updateSubs);
    updateSubs();
    tIn.focus();
  }, 50);
}

function confirmDelete(type, slug) {
  if (bloccaSeNonModifica(type === 'clinica' ? 'clinica' : 'procedure')) return;
  const entity = state.index[type === 'procedura' ? 'procedure' : type].find(x => x.slug === slug);
  if (!entity) return;
  showModal({
    title: 'Spostare nel cestino?',
    subtitle: `<strong>${escapeHtml(entity.titolo || slug)}</strong> sarà spostato in <code>cestino/</code>. Potrai ripristinarlo o eliminarlo definitivamente dopo.`,
    body: '<p style="font-size:13px;color:var(--ink-muted);">Questa operazione è reversibile dal cestino.</p>',
    actions: [
      { label: 'Annulla', variant: 'ghost', onClick: closeModal },
      { label: 'Sposta nel cestino', variant: 'danger', onClick: () => { closeModal(); softDelete(type, slug); } }
    ]
  });
}

async function softDelete(type, slug) {
  toast('Eliminazione in corso...', 'info', 2000);
  try {
    const typeDir = type === 'procedura' ? 'procedure' : type;
    // Schema cartella per scheda: entity.path è già 'content/<typeDir>/.../<slug>/scheda.md'.
    const entity = state.index[type === 'procedura' ? 'procedure' : type].find(x => x.slug === slug);
    if (!entity) throw new Error('Scheda non trovata in indice');
    const srcPath = entity.path;
    const file = await gh.getFile(srcPath);
    if (!file) throw new Error('File non trovato');

    const { frontmatter, body } = parseMarkdown(file.content);
    frontmatter.eliminato_data = nowIso();
    frontmatter.eliminato_da = state.session.username;
    // Memorizzo il path originale nel frontmatter del file di cestino, così il restore può
    // ricostruire la cartella scheda corretta.
    frontmatter._original_path = srcPath;
    const archivedContent = stringifyMarkdown(frontmatter, body);

    const ts = nowIso().replace(/[:.]/g, '-').replace(/\..*/, '');
    const newFilename = `${slug}__${ts}__${state.session.username}.md`;
    const newPath = `cestino/${typeDir}/${newFilename}`;

    await gh.putFile(newPath, archivedContent, null, `Sposta nel cestino: ${slug} (by ${state.session.username})`);
    await gh.deleteFile(srcPath, file.sha, `Rimuovi ${slug} (spostato in cestino by ${state.session.username})`);
    // Nota: la cartella img/ accanto resta sul repo (orfana). L'utente può cancellarla
    // a mano se sa che non vuole ripristinare la scheda. In caso di restore, le immagini
    // tornano automaticamente disponibili (sono nella cartella originale).

    toast('Spostato nel cestino', 'success');
    await buildIndex();
    navigate('home');
  } catch (e) {
    toast('Errore: ' + e.message, 'error', 6000);
  }
}

async function restoreFromCestino(path, filename) {
  const m = filename.match(/^(.+?)__\d{4}-\d{2}-\d{2}T/);
  if (!m) return toast('Formato filename non riconosciuto', 'error');
  const targetSlug = m[1];
  const typeDir = path.split('/')[1];

  // Per ricostruire il path target, controllo se nel cestino è memorizzato _original_path
  // (lo facciamo dal nuovo softDelete). Altrimenti uso path "default" content/<typeDir>/<slug>/scheda.md
  // (no sottocategoria — l'utente potrà spostarlo dopo se serve).
  let cestFile = null;
  try { cestFile = await gh.getFile(path); } catch {}
  let originalPath = null;
  if (cestFile) {
    const { frontmatter } = parseMarkdown(cestFile.content);
    originalPath = frontmatter._original_path || null;
  }
  const targetPath = originalPath || `content/${typeDir}/${targetSlug}/scheda.md`;

  const existing = await gh.getFile(targetPath);
  if (existing) {
    showModal({
      title: 'Conflitto sul nome',
      subtitle: `Esiste già un file attivo <code>${escapeHtml(targetPath)}</code>.`,
      body: `<p style="font-size:14px;color:var(--ink-soft);">Cosa vuoi fare?</p>`,
      actions: [
        { label: 'Annulla', variant: 'ghost', onClick: closeModal },
        { label: 'Sostituisci', variant: 'danger', onClick: () => { closeModal(); doRestore(path, filename, targetSlug, typeDir, true, targetPath); } },
        { label: 'Ripristina con nome diverso', onClick: () => {
          closeModal();
          const proposed = prompt('Nuovo slug per il file ripristinato:', `${targetSlug}-ripristinato`);
          if (proposed && proposed.trim()) {
            // Modifico path mantenendo la stessa directory parent ma cambiando l'ultimo segmento (slug)
            const parentDir = targetPath.replace(/\/[^/]+\/scheda\.md$/, '');
            const newTargetPath = `${parentDir}/${proposed.trim()}/scheda.md`;
            doRestore(path, filename, proposed.trim(), typeDir, false, newTargetPath);
          }
        }}
      ]
    });
  } else {
    doRestore(path, filename, targetSlug, typeDir, false, targetPath);
  }
}

async function doRestore(cestinoPath, cestinoFilename, targetSlug, typeDir, replaceExisting, targetPath) {
  try {
    const cestinoFile = await gh.getFile(cestinoPath);
    if (!cestinoFile) throw new Error('File nel cestino non trovato');
    const { frontmatter, body } = parseMarkdown(cestinoFile.content);
    delete frontmatter.eliminato_data;
    delete frontmatter.eliminato_da;
    delete frontmatter._original_path;
    frontmatter.ultima_modifica = nowIso();
    frontmatter.modificato_da = state.session.username;
    const restoredContent = stringifyMarkdown(frontmatter, body);

    if (replaceExisting) {
      const existing = await gh.getFile(targetPath);
      const ts = nowIso().replace(/[:.]/g, '-').replace(/\..*/, '');
      const archiveName = `${targetSlug}__${ts}__${state.session.username}.md`;
      const archivePath = `cestino/${typeDir}/${archiveName}`;
      await gh.putFile(archivePath, existing.content, null, `Archivio pre-restore: ${targetSlug}`);
      await gh.putFile(targetPath, restoredContent, existing.sha, `Ripristina ${targetSlug} (replace) by ${state.session.username}`);
    } else {
      await gh.putFile(targetPath, restoredContent, null, `Ripristina ${targetSlug} by ${state.session.username}`);
    }

    await gh.deleteFile(cestinoPath, cestinoFile.sha, `Svuota cestino: ${cestinoFilename}`);
    toast('Ripristinato', 'success');
    await buildIndex();
    const route = typeDir === 'procedure' ? 'procedura' : 'clinica-scheda';
    navigate(route, { slug: targetSlug });
  } catch (e) {
    toast('Errore ripristino: ' + e.message, 'error', 6000);
  }
}

function purgeFromCestino(path, filename, sha) {
  showModal({
    title: 'Eliminare definitivamente?',
    subtitle: `<strong>${escapeHtml(filename)}</strong> sarà rimosso dal repository. La Git history conserverà comunque la traccia.`,
    body: '<p style="font-size:13px;color:var(--ink-muted);">Operazione non reversibile dal cestino. Solo via Git revert.</p>',
    actions: [
      { label: 'Annulla', variant: 'ghost', onClick: closeModal },
      { label: 'Elimina definitivamente', variant: 'danger', onClick: async () => {
        closeModal();
        try {
          await gh.deleteFile(path, sha, `Elimina definitivamente ${filename} by ${state.session.username}`);
          toast('Eliminato', 'success');
          await buildIndex();
          navigate('cestino');
        } catch (e) {
          toast('Errore: ' + e.message, 'error');
        }
      }}
    ]
  });
}
