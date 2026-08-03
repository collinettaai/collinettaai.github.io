// Guardia anti-cache-disallineata: se l'index.html servito dalla cache è di una build diversa
// dai file JS (es. HTML/CSS vecchio + JS nuovo → markup che usa classi CSS non ancora presenti,
// badge/modali "rotti"), l'app si ricarica UNA volta per riallinearsi. costanti.js è il primo
// file JS caricato, quindi il controllo avviene prima di renderizzare la UI.
// IMPORTANTE: bumpare APP_JS_BUILD INSIEME a window.__APP_HTML_BUILD in index.html a ogni deploy
// che cambia CSS/HTML inline.
const APP_JS_BUILD = '2';
(function () {
  try {
    const htmlB = window.__APP_HTML_BUILD;
    const reloadedFor = sessionStorage.getItem('__ccai_reloaded_build');
    if (htmlB !== APP_JS_BUILD) {
      // Disallineamento (o index.html vecchio senza marcatore): ricarico una sola volta per build.
      if (reloadedFor !== APP_JS_BUILD) {
        sessionStorage.setItem('__ccai_reloaded_build', APP_JS_BUILD);
        location.reload();
      }
    } else if (reloadedFor) {
      sessionStorage.removeItem('__ccai_reloaded_build');
    }
  } catch (e) { /* sessionStorage non disponibile: ignoro */ }
})();

const CATEGORIA_LABELS = {
  bedside: 'Bedside',
  richieste: 'Richieste',
  farmacologiche: 'Farmacologiche',
  emergenze: 'Emergenze',
  gestione: 'Gestione',
  clinica: 'Clinica',
  'procedure-reparto': 'Procedura reparto',
  workflow: 'Workflow',
  educational: 'Educational'
};

// Nasconde temporaneamente il livello "sottocategoria" sotto le categorie di procedure
// (es. procedure/bedside/...): le schede vengono mostrate direttamente sotto la categoria,
// sia nella sidebar sia nella pagina categoria. La logica di raggruppamento resta intatta:
// rimettere a false per riattivare il livello sottocategoria.
const HIDE_SUBCATEGORIES = true;

const SOTTO_LABELS = {
  'liquorali': 'Liquorali',
  'cardiologia': 'Cardiologia',
  'pneumologia': 'Pneumologia',
  'neuroimaging': 'Neuroimaging',
  'altri-imaging': 'Altri imaging',
  'neurofisiologia': 'Neurofisiologia',
  'angiologia': 'Angiologia',
  'invii-campioni': 'Invii campioni',
  'altre-richieste': 'Altre richieste',
  'emoderivati': 'Emoderivati',
  'immunoterapia': 'Immunoterapia',
  'pompe-infusione': 'Pompe infusione',
  'somministrazioni-complesse': 'Somministrazioni complesse',
  'monitoraggi-ematici': 'Monitoraggi ematici',
  'prognosi': 'Prognosi',
  'gestione-post-acuta': 'Gestione post-acuta',
  'scale-cliniche': 'Scale cliniche',
  'consulenze': 'Consulenze',
  'emergenze': 'Emergenze',
  'dimissione': 'Dimissione',
  'ingresso': 'Ingresso'
};
