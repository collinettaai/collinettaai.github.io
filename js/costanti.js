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
