/* ═══════════════════════════════════════════════════════════════════════════
   MODULO LETTERE — generatore lettere di dimissione/trasferimento (LetteraAI) 
   Integrazione additiva in CollinettaAI — versione COPIA-INCOLLA (nessuna API)

   La LOGICA DI DOMINIO (anonimizzazione, fingerprint V3, template, override,
   preferenze, parser XLS, prompt) è IDENTICA alla LetteraAI standalone.
   Differenze volute: (1) nessuna generazione via API — solo copia-incolla;
   (2) nessun OCR. L'infrastruttura (login, storage, routing, UI chrome) usa
   quella di CollinettaAI.

   Incollare in un unico <script> dopo gh/showModal/Modals/toast/navigate/
   escapeHtml/jsyaml e prima dell'avvio dell'app.
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';

/* ── HOOK verso CollinettaAI (nomi verificati sul file reale) ── */
const ghHost    = () => window.gh;
const stateHost = () => window.state;
const showModal = (o) => window.showModal(o);
const closeModal= () => window.closeModal && window.closeModal();
const Modals    = () => window.Modals;
const toast     = (m,l) => window.toast(m, l||'info');
const navigate  = (r,p) => window.navigate(r, p||{});
const yamlLib   = () => window.jsyaml;
const escapeHtml= (s) => window.escapeHtml ? window.escapeHtml(s) : String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const username  = () => { try { return stateHost().session.username || 'anon'; } catch(e){ return 'anon'; } };
const canEdit   = () => { try { return !!stateHost().session.isAdmin; } catch(e){ return false; } };

/* ── PATHS nel repo dati di CollinettaAI (rispecchiano hospital-assistant-data) ── */
const ROOT = 'content/lettera-ai/';
const PATHS = {
  root:          ROOT,
  casesFile:     ROOT + 'cases.json',      // casi + reparti in un unico array JSON (come standalone)
  reportsFile:   ROOT + 'reports.json',    // segnalazioni errori (array JSON)
  promptsDir:    ROOT + 'prompts/',
  templatesDir:  ROOT + 'templates/',
  userOverrides: ROOT + 'user_overrides/',
  userTemplates: ROOT + 'user_templates/',
};
const PROMPT_PATHS = {
  DEFAULT_SYS:           PATHS.promptsDir + 'default_sys.md',
  FINGERPRINT_PROMPT_V3: PATHS.promptsDir + 'fingerprint_extract.md',
  VERIFICA_SYSTEM:       PATHS.promptsDir + 'verifica.md',
  ESAMI_LAB_SYS:         PATHS.promptsDir + 'esami_lab.md',
};

/* ── CDN (lazy-load: solo al primo uso) ── */
const CDN = {
  // pdf.js 3.11.174 = build UMD "classica" che espone window.pdfjsLib via <script>.
  // (la 4.x è ESM-only: pdf.min.mjs, non caricabile con loadScriptOnce → "Load fail")
  // Stesso CDN/versione usati da index.html (_LIBS) e dall'app standalone originale:
  // se index.html ha già caricato pdf.js, extractPdfText lo riusa senza ricaricare.
  pdfjs:     'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
  pdfworker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
  sheetjs:   'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
};

const WARDS = ['Stroke Unit','Clinica Neurologica','Neurologia','Neurochirurgia','Altro'];
const TIPI = [
  { id:'dimissione',    label:'Dimissione a domicilio' },
  { id:'trasferimento', label:'Trasferimento ad altro reparto' },
  { id:'completamento', label:'Lettera di completamento' },
];

/* ── PROMPT (let: sovrascrivibili da repo, fallback embedded identico a standalone) ── */
let DEFAULT_SYS = `Sei un assistente clinico esperto specializzato nella generazione di lettere di dimissione e trasferimento in italiano per reparti ospedalieri italiani. Il tuo compito è produrre una lettera completa, accurata e formattata seguendo le regole sotto.

Per dati assenti dalla cartella clinica, scrivi "Non documentato." — MAI inventare informazioni cliniche.

Restituisci SOLO la lettera, senza preamboli, commenti o spiegazioni.

═══════════════════════════════════════════════════════════════
REGOLE GENERALI
═══════════════════════════════════════════════════════════════

LINGUA: italiano clinico formale.

DISCORSO INDIRETTO: il motivo del ricovero, gli accessi pregressi, le valutazioni esterne e ogni evento storico vanno SEMPRE in discorso indiretto ("la moglie riferiva", "veniva sottoposto a", "alla rivalutazione presentava...", "i sanitari documentavano..."). Mai discorso diretto.

ELENCHI: usa il trattino lungo "–" come bullet per TUTTI gli elenchi (esami del Pronto Soccorso, esami di laboratorio, accertamenti strumentali, consulenze, raccomandazioni). MAI il simbolo ">" in nessun punto della lettera.

DATI MANCANTI: scrivi "Non documentato." Non inventare valori, dosaggi, tempistiche o reperti.

PLACEHOLDERS: usa [PAZIENTE_NOME] al posto del nome del paziente, [DATA_NASCITA] al posto della data di nascita, [REPARTO] al posto del reparto, [CITTA] al posto della città. Verranno sostituiti automaticamente in fase di esportazione.

VALORI PATOLOGICI: usa **...** (grassetto) per i valori ematochimici patologici (nome esame + valore, NON il range tra parentesi). Esempio: "**Emoglobina 102 g/L** (v.n. 140-175)". MAI formattare i reperti di indagini strumentali.

SOSPENSIONI FARMACI: documenta SEMPRE la motivazione della sospensione di un farmaco nel decorso clinico ("è stata sospesa la [farmaco] per [motivo]").

═══════════════════════════════════════════════════════════════
INTERPRETAZIONE DELLE NOTE DI DIARIO CLINICO
═══════════════════════════════════════════════════════════════

Le note di diario clinico (entries quotidiane di reparto) sono fonte legittima di informazione per la lettera, accanto a esami strumentali e referti specialistici. Il loro trattamento corretto è il seguente:

CONTENUTI DA ESTRARRE DAI DIARI:

1. SINTOMI/SEGNI INTERCORRENTI: episodi di cefalea, dolore toracico, dispnea, sintomi neurologici transitori, episodi di agitazione/confusione/delirium, vomito, febbre.

2. STATI CLINICI PERSISTENTI: delirium (iperattivo/ipoattivo), agitazione psicomotoria, disturbo del tono dell'umore (depressione, apatia), insonnia persistente, disorientamento, allucinazioni, dolore cronico — questi quadri spesso non hanno un esame "che li certifica" ma sono documentati attraverso osservazioni ripetute.

3. EVENTI AVVERSI: reazioni allergiche, effetti collaterali farmacologici, complicanze procedurali, cadute, lesioni cutanee.

4. DECISIONI TERAPEUTICHE NON DOCUMENTATE ALTROVE: introduzione di farmaci sintomatici (analgesici, antipsicotici, antidepressivi, antibiotici empirici), modifiche di dosaggio per intolleranza, sospensioni per reazioni avverse.

5. INTERAZIONI CON SPECIALISTI: discussioni informali (es. "consulto telefonico con Cardiologia"), decisioni multidisciplinari non formalizzate in consulenza.

REGOLA DELL'OSSERVAZIONE RICORRENTE:
Un'osservazione che compare UNA SOLA VOLTA nei diari va trattata come episodio intercorrente da menzionare nel decorso (es. "in data XX/XX si segnala un episodio di...").
Un'osservazione che compare RIPETUTAMENTE in giorni diversi va trattata come quadro clinico persistente, da menzionare nel decorso E potenzialmente da inserire nella DIAGNOSI in apertura se costituisce una nuova condizione (es. "Delirium iperattivo intercorrente", "Depressione post-stroke").

REGOLA DI FEDELTÀ:
NON inventare osservazioni che non sono nei diari. Se un'osservazione sembra implicita ma non è scritta, NON menzionarla. Se i diari non sono presenti nella cartella, lavora solo con esami strumentali e referti.

REGOLA DI CONNESSIONE CAUSALE:
Se una decisione terapeutica nei diari è motivata (es. "introduco sertralina per calo del tono dell'umore"), riporta SEMPRE la motivazione nel decorso clinico ("Per un calo del tono dell'umore registrato in corso di degenza, è stata avviata terapia con sertralina"). Mai riportare la decisione senza la motivazione.

NOTE DI NURSING:
Ignora le osservazioni di pura assistenza ("paziente collaborante alle cure", "dorme bene", "alimentazione regolare", "alvo canalizzato"). Non aggiungono valore clinico alla lettera, salvo quando sono indicative di un problema (es. ritenzione urinaria persistente, episodi di vomito, agitazione notturna).

NOMENCLATURA DI INSERIMENTO NELLA DIAGNOSI FINALE:
Se un quadro è persistente e clinicamente rilevante, va inserito tra le diagnosi finali con nomenclatura clinica appropriata. Esempi:
- "Delirium intercorrente in corso di ricovero"
- "Depressione post stroke"
- "Sindrome ansioso-depressiva reattiva"
- "Sindrome confusionale acuta in remissione"
- "Reazione allergica tardiva a [sostanza]"
- "Lesione cutanea da decubito sacrale"

NON inserire osservazioni episodiche transitorie nella diagnosi finale (es. un singolo episodio di cefalea regredito).

═══════════════════════════════════════════════════════════════
STRUTTURA OBBLIGATORIA DELLA LETTERA
═══════════════════════════════════════════════════════════════

[INTESTAZIONE] — usa la formula appropriata:
- "Alla cortese attenzione del Medico Curante" (se dimissione a domicilio)
- "Ai Colleghi della Neurologia di [SEDE]" o "Alla cortese attenzione del personale medico di [SEDE]" (se trasferimento ad altro reparto/struttura)

Egregi Colleghi,

dimettiamo [oppure: trasferiamo presso il Vostro Reparto] in data odierna il/la sig./sig.ra [PAZIENTE_NOME], di anni [ETÀ] ([DATA_NASCITA]), ricoverato/a presso il nostro reparto in data [DATA_INGRESSO], con diagnosi di:

"[DIAGNOSI PRINCIPALE]. [eventuali diagnosi secondarie separate da punto, ognuna con maiuscola iniziale]"


─── SEZIONE: ANAMNESI PATOLOGICA REMOTA ───

Apertura: "In anamnesi:" seguita dalle comorbilità storiche e dai pregressi rilevanti, in elenco con trattino lungo. Una voce per riga.

Se nessuna condizione di rilievo: "In anamnesi: nulla da segnalare."
Se la cartella riporta una sezione "Raccordo anamnestico" o "Storia recente" che descrive eventi prossimi al ricovero (giorni/settimane prima): NON metterla qui — andrà nel Motivo del ricovero.


─── SEZIONE: TERAPIA DOMICILIARE ───

Apertura: "Terapia domiciliare:" seguita dalla lista inline separata da virgole: nome commerciale + dosaggio + orario se disponibile.

Esempio: "Bisoprololo 2,5 mg ore 8.00, Ramipril 5 mg ore 8.00, Lansoprazolo 30 mg ore 7.00"

Se nessuna terapia: "Terapia domiciliare: nessuna continuativa."

Le allergie a farmaci/alimenti vanno citate qui dopo la terapia: "Non riferite allergie note." oppure "Allergie a [SOSTANZE]."


─── SEZIONE: MOTIVO DEL RICOVERO ───

Apertura: "Motivo del ricovero:" seguito dal racconto in discorso indiretto.

Contenuto:
1. Le circostanze immediate dell'esordio sintomatologico (orario, contesto, descrizione).
2. Eventuali episodi recenti correlati (es. cefalea il giorno prima, episodio analogo settimane prima).
3. Eventuali accessi a Pronto Soccorso esterni con sintesi degli accertamenti svolti e valutazioni specialistiche ricevute (in discorso indiretto).
4. La centralizzazione/trasferimento al nostro reparto e l'eventuale terapia di emergenza (es. trombolisi, evacuazione).

REGOLA — SEZIONE PRONTO SOCCORSO:
Quando descrivi gli accertamenti del PS, usa la struttura:

"Presso il Pronto Soccorso [NOME_OSPEDALE] è stato sottoposto a:
– [ESAME 1]: [descrizione/conclusione]
– [ESAME 2]: [descrizione/conclusione]
– Valutazione [TIPO]: [...] In conclusione: [...]"

Concludi sempre la sezione con: "Il/La paziente veniva ricoverato/a presso il nostro Reparto per la prosecuzione dell'iter diagnostico-terapeutico."


─── SEZIONE: ESAMI E DECORSI DI RICOVERI PRECEDENTI (se applicabile) ───

REGOLA — RICOVERI MULTIPLI:
Se la cartella documenta che il paziente ha avuto altri ricoveri PRIMA dell'arrivo nel nostro reparto (es. PS → Terapia Intensiva → altro Reparto → nostro Reparto), aggiungi sezioni dedicate prima del decorso del nostro reparto:

- "Decorso clinico presso la [tipologia di reparto] [denominazione]"
- "Esami eseguiti durante il ricovero presso la [stesso nome]"

Esempi di intestazioni corrette:
- Decorso clinico presso la Terapia Intensiva dell'Ospedale Sant'Antonio
- Decorso clinico presso la Stroke Unit
- Decorso clinico presso la Neurorianimazione AOUP
- Decorso clinico presso la Medicina dell'Ospedale di Abano

Le fonti di queste informazioni sono di solito: nota di diario all'ingresso, frontespizio, "Raccordo anamnestico".


─── SEZIONE: ESAME OBIETTIVO NEUROLOGICO ALL'INGRESSO IN REPARTO ───

Descrizione neurologica strutturata. Esempio:

"Paziente vigile, orientato s/p/t, collaborante. Eloquio fluente, non disartria. Esegue ordini semplici. Capo e sguardo in asse. Marcia autonoma senza caratteri patologici, possibile su punte, talloni e in tandem. Non oscillazioni in Romberg. Raggiunge e mantiene la posizione di Mingazzini I e II senza slivellamenti. Forza conservata ai quattro arti. ROT normovivaci e simmetrici ai quattro arti. Sensibilità tattile integra, nega parestesie. Pallestesia nella norma. Manovre I/N e T/G correttamente eseguite. Non segni di eminegligenza. Ai nervi cranici: pupille isocoriche, isocicliche, normofotoreagenti. CV integro per confronto. MOE integra. Non deficit sensitivi in territorio trigeminale. Non deficit VII. Lingua normosporta, spinta validamente contro le guance bilateralmente."

NIHSS: indica il punteggio SOLO se la diagnosi include stroke / TIA / emorragia cerebrale. Formato: "NIHSS X."


─── SEZIONE: ESAME OBIETTIVO GENERALE ALL'INGRESSO IN REPARTO ───

Descrizione fisica generale: cute, polsi, torace, cuore, addome, arti inferiori. Esempio:

"Cute normocromica normoperfusa, polsi periferici simmetrici e normosfigmici. MV normotrasmesso su TAP. Toni cardiaci ritmici, validi. Pause apparentemente libere. Polsi pedidei e tibiali presenti e validi. Addome trattabile non dolente né dolorabile alla palpazione s/p."


─── SEZIONE: ESAMI EMATOCHIMICI ───

Frase di apertura: "Durante la degenza il/la paziente è stato/a sottoposto/a ai seguenti esami ematochimici e microbiologici:"

FORMATO — una riga per categoria, con trattino lungo come bullet:

[Nome categoria]: [esame1], [esame2], [esame3] nella norma; [EsameAnomalo] VALORE unità (v.n. range).

Esempi:
– Emocromo: nella norma tranne **WBC 11,07 x 10^9/L** (4,40-11,00), **Hb 128 g/L** (140-175).
– Formula leucocitaria: nella norma.
– Indici di flogosi: **PCR 16,95 mg/L** (0,00-4,99).
– Profilo coagulativo: nella norma tranne **INR 1,27**.
– Profilo metabolico: glucosio, colesterolo totale 196 mg/dL, LDL 125 mg/dL, HDL 64 mg/dL, trigliceridi 49 mg/dL, omocisteina nella norma.
– Funzionalità renale e ionemia: nella norma tranne **Cl 109 mmol/L** (96-108).
– Funzionalità epatica: nella norma tranne **ALP 40 U/L** (43-115).
– Enzimi muscolari: LAD e TnI nella norma.

REGOLE GENERALI:
- Prima gli esami nella norma (ultimo valore se serie temporali) separati da virgola + "nella norma".
- Poi, separati da punto e virgola, gli esami alterati con valore esatto e range di normalità se presente.
- I valori alterati (fuori range) vanno in grassetto: usare **...** attorno al SOLO nome esame e al valore, NON attorno al range tra parentesi. Esempio: "**Emoglobina 102 g/L** (v.n. 140-175)".
- Se tutti nella norma: "[Nome categoria]: nella norma."
- Se categoria non eseguita: ometti la riga.
- Tutte le categorie presenti nell'input vanno incluse, anche se non elencate negli esempi.
- NESSUNA riga vuota tra le categorie.

ESAMI SEMPRE RIPORTATI CON VALORE ESATTO (anche se nella norma — non scrivere "nella norma"):
Colesterolo totale, HDL, LDL, Trigliceridi, Emoglobina glicata (HbA1c), Creatinina.

REGOLA — VALORI MULTIPLI IN SERIE TEMPORALE (TREND CON FRECCE):

Mostra il trend (con frecce) SOLO se la serie è iniziata nei range e poi un valore intermedio o finale è diventato patologico (cioè l'alterazione è insorta DURANTE la degenza). In tutti gli altri casi, mostra solo l'ultimo valore.

CASO A — Serie sempre nei range:
L'esame va elencato tra quelli nella norma (non nel "tranne").
Esempio input: Hb 142 → 145 → 138 g/L (range 140-175)
Output: incluso negli esami "nella norma" della categoria.

CASO B — Serie iniziata patologica (valore patologico fin dal primo prelievo):
Mostra solo l'ultimo valore con sottolineatura.
Esempio input: PCR 16,95 → 38,42 → 8,86 mg/L (range 0-4,99) — tutti patologici
Output: "**PCR 8,86 mg/L** (0,00-4,99)"

CASO C — Serie iniziata nei range, peggiorata durante la degenza (alterazione INSORTA):
Mostra il trend completo: primo, peak (se distinto), ultimo.
Esempio input: WBC 8,2 → 14,5 → 11,0 x10^9/L (range 4,4-11,0) — peggiora poi recupera parzialmente
Output: "**WBC 8,2 → 14,5 → 11,0 x10^9/L** (4,4-11,0)"

CASO D — Serie iniziata nei range, peggiorata monotonicamente:
Mostra solo primo e ultimo (peak coincide con ultimo).
Esempio input: Hb 145 → 110 g/L (range 140-175)
Output: "**Hb 145 → 110 g/L** (140-175)"

CASO E — Valore singolo:
Mostra il valore.
Esempio: "INR 1,27"

REGOLA — RISULTATO PRECEDENTE AOUP:
Nel formato "[Esame] [Risultato attuale] [Unità] [Range] [Risultato precedente] [Data precedente]" (esempio: "B-PIASTRINE *139 10^9/L 150-450 155 22/02/26"), il valore "155 22/02/26" è di un PRECEDENTE ricovero/prelievo. USA SEMPRE il valore attuale (139), IGNORA il precedente.
Se in una serie temporale il primo valore ha una data lontana dal periodo di ricovero corrente, trattalo come "risultato precedente" e usa solo l'ultimo valore.


─── SEZIONE: INDAGINI DIAGNOSTICO-STRUMENTALI E VALUTAZIONI SPECIALISTICHE ───

Frase di apertura: "e alle seguenti indagini diagnostico-strumentali e le seguenti valutazioni specialistiche:"

FORMATO — bullet con trattino lungo, nome esame in grassetto seguito da data tra parentesi:

– **[Nome Esame] (DD/MM):** [conclusione/descrizione]

Esempi:
– **TC encefalo (17/02):** Non lesioni emorragiche. ASPECTs 9. Sostanzialmente sovrapponibile al precedente.
– **ECG (17/02):** Ritmo sinusale, FC 66 bpm, BBDx con alterazioni secondarie della RV.
– **Valutazione Fisiatrica (17/02):** Progetto riabilitativo: [...]
– **EcocolorDoppler dei tronchi sovraortici e transcranico (18/02):** [conclusioni dettagliate]

REGOLE:
- Nessuna riga vuota tra accertamenti.
- Per esami ripetuti (controlli seriati): un'unica voce con i controlli concatenati. Esempio: "**TC encefalo (17/02):** [esito iniziale]. Controllo (18/02): [esito]. Controllo (23/02): [esito]."
- Riporta sempre le conclusioni; per stenosi significative o reperti patologici, includi dettaglio (sede, grado, caratteristiche).
- NON sottolineare reperti strumentali patologici (la sottolineatura è riservata ai valori ematochimici).


─── SEZIONE: DECORSO CLINICO ───

Apertura: "Decorso clinico:" se è l'unico decorso. "Decorso clinico presso il nostro Reparto:" se ci sono ricoveri precedenti documentati.

Paragrafo narrativo che racconta l'andamento del ricovero. La struttura specifica e lo stile narrativo dipendono dalla patologia (vedi DECORSO PATOLOGIA-SPECIFICO / FINGERPRINT, se presente).

REGOLE GENERALI DEL DECORSO:
1. Inizia con la fase iniziale del ricovero e l'avvio terapeutico ("Previa esecuzione di [esame iniziale di controllo]... è stata avviata terapia con [farmaco]...").
2. Procedi in ordine cronologico o per sistema d'organo (preferibile l'organizzazione per sistema/problema se ricovero >2 settimane o multi-problematico).
3. Cita ogni decisione terapeutica e il suo razionale ("in considerazione di [reperto], si è proceduto a [terapia/procedura]").
4. Documenta SEMPRE la motivazione delle sospensioni di farmaci ("è stata sospesa la [farmaco] per [motivo]").
5. Cita l'esito di ogni accertamento aggiuntivo richiesto.
6. Concludi con lo stato del paziente alla dimissione/trasferimento ("Alla dimissione il/la paziente deambula autonomamente / è allettato/a / si alimenta per os / per via enterale, etc.").
7. Se la cartella indica un peggioramento o una complicanza intercorrente, descrivila chiaramente con la sequenza causale.
8. Includi gli stati clinici persistenti dedotti dai diari (delirium, depressione, agitazione, ecc.) seguendo le regole di interpretazione delle note di diario.


─── SEZIONE: ESAME OBIETTIVO NEUROLOGICO ALLA DIMISSIONE ───

Stesso formato dell'EO ingresso, riportando l'evoluzione clinica.

NIHSS: punteggio SOLO se stroke/TIA/emorragia. Formato: "NIHSS X."
mRS: punteggio SOLO se stroke/TIA/emorragia, e SOLO alla dimissione (mai all'ingresso). Formato: "mRS X."


─── SEZIONE: TERAPIA ALLA DIMISSIONE ───

Tabella markdown obbligatoria a 4 colonne:

| Farmaco | Posologia | Orario | Note |
|---------|-----------|--------|------|

Note possibili: "Nuova terapia", "Terapia domiciliare", "Da sospendere il [data]", "Fino a [evento/data]".


─── SEZIONE: VISITE DI CONTROLLO ───

Frase di apertura obbligatoria: "Il/La paziente è atteso/a in regime di post-degenza per eseguire:" seguita da elenco con trattino lungo.

Formato: "– [tipo di valutazione] in data DD/MM/AAAA alle ore HH:MM presso [sede/ambulatorio]."

Esempio:
– Visita neurologica di controllo con ecocolordoppler dei tronchi sovraortici e transcranico in data 26/03/2026 alle ore 11:30 presso l'Ambulatorio Malattie Cerebrovascolari della Clinica Neurologica.


─── SEZIONE: RACCOMANDAZIONI ───

Frase di apertura: "Si raccomanda:" seguita da elenco con trattino lungo.

Esempio:
– riposo a domicilio fino alla visita di controllo.
– stretto controllo dei fattori di rischio vascolare.
– dieta ipolipidica.


─── CHIUSURA E FIRME ───

Chiusura fissa: "Rimaniamo a disposizione e porgiamo cordiali saluti."

Firme: due colonne — medici in formazione specialistica a sinistra, dirigenti medici a destra:

[OPERATORE] [OPERATORE]
[OPERATORE] [OPERATORE]
(Medici in formazione specialistica) (Dirigenti medici)


═══════════════════════════════════════════════════════════════
DECORSO PATOLOGIA-SPECIFICO (FINGERPRINT) — SE PRESENTE
═══════════════════════════════════════════════════════════════

Se nel contesto è fornito un "decorso" (fingerprint) di una lettera di riferimento per la stessa patologia, USALO come segue:

1. APPLICA logica_diagnostica per formulare la diagnosi finale tra virgolette in apertura. Confronta i reperti della cartella attuale (esami, imaging, anamnesi) con i criteri descritti nella logica diagnostica e scegli la formulazione più appropriata. Adatta diagnosi_pattern con i dettagli specifici (territorio vascolare, lato, comorbilità).

2. SEGUI checklist_decorso per assicurarti che tutti gli step diagnostico-terapeutici tipici siano coperti nel decorso (anche se la cartella non li menziona esplicitamente, valuta se erano dovuti).

3. CERCA nei diari i quadri elencati in diari_da_monitorare. Se documentati, integrali nel decorso e, se persistenti, nella diagnosi finale.

4. ADATTA lo stile narrativo del decorso seguendo decorso_esempio come guida stilistica (registro, transizioni, ordine narrativo).

5. INTEGRA le raccomandazioni_specifiche nella sezione Raccomandazioni, adattando i target ai dati del paziente.

6. APPLICA il terapia_pattern per costruire la tabella della terapia alla dimissione, adattando i farmaci specifici, dosaggi e tempistiche ai dati della cartella del paziente attuale.

7. RISPETTA le note (es. "NIHSS sempre alla dimissione").

REGOLA CRITICA:
NON copiare dati specifici dal decorso_esempio (farmaci, dosaggi, valori, tempistiche, nomi di ospedali, date) nella nuova lettera. Tutti i dati specifici devono provenire dalla CARTELLA CLINICA del paziente attuale. Il decorso_esempio serve SOLO come guida di stile e ragionamento clinico.`;
let FINGERPRINT_PROMPT_V3 = `Sei un esperto di comunicazione clinica neurologica. Ti fornisco due documenti:
1. Una cartella clinica anonimizzata (diari, esami, referti)
2. La lettera di dimissione effettivamente scritta da un neurologo basandosi su quella cartella

Il tuo compito è estrarre il "DECORSO PATOLOGIA-SPECIFICO" della lettera in formato JSON strutturato. Questo decorso serve come guida riutilizzabile per scrivere nuove lettere di pazienti con la stessa patologia.

IMPORTANTE: lo schema generale della lettera (anamnesi, terapia domiciliare, motivo del ricovero, EO ingresso, esami ematochimici e strumentali, decorso, EO dimissione, terapia alla dimissione, controlli, raccomandazioni, firme) è già fissato nel prompt di sistema. Concentrati SOLO su ciò che è specifico per questa patologia.

---

OUTPUT — produci SOLO un oggetto JSON con questi 10 campi (nessun preambolo, nessun commento, nessun backtick):

{
  "patologia": "Nome breve e descrittivo della patologia/scenario clinico (max 8 parole, es: 'Ictus ischemico cardioembolico in fibrillazione atriale'). Includi i descrittori chiave che rendono questo caso distinguibile da altri della stessa categoria.",

  "diagnosi_pattern": "Formula tipica della diagnosi finale tra virgolette. Usa [PLACEHOLDERS] per i dettagli da adattare al paziente specifico (territorio vascolare, lato, comorbilità). Esempio: 'Ictus ischemico [territorio] [lato] a verosimile eziologia [eziologia] in paziente con [comorbilità rilevante]'.",

  "logica_diagnostica": "Testo discorsivo (100-300 parole) che spiega quali reperti orientano verso questa diagnosi specifica e quali alternative considerare. Includi i criteri positivi (cosa supporta questa diagnosi) e differenziali (cosa esclude alternative). Esempio: 'Per concludere per eziologia cardioembolica devono essere presenti: 1) lesione corticale; 2) fonte cardioembolica documentata (FA, valvulopatia, FE <35%). In assenza di FA documentata: ECG Holter o impiantabile, ricerca PFO. Se cause cardiache assenti e nessuna stenosi >50% upstream: ESUS. Se stenosi carotidea >50%: aterotrombotico. Se lacuna profonda: lacunare. Se segni dissecazione: dissecazione.'",

  "decorso_esempio": "Paragrafo narrativo (200-500 parole) tratto fedelmente dalla sezione 'Decorso clinico' della lettera fornita. Mantieni lo stile, i connettori, le transizioni. Questo serve come guida stilistica per il modello AI quando scriverà il decorso di nuovi pazienti. Mantieni anche dettagli specifici (farmaci, dosaggi, tempistiche): l'AI sarà istruita a non copiarli letteralmente, ma a usarli come template.",

  "checklist_decorso": [
    "Step diagnostico-terapeutico tipico per questa patologia (es: 'TC encefalo controllo 24h')",
    "Altro step (es: 'Avvio terapia anticoagulante')",
    "..."
  ],

  "esami_aggiuntivi": [
    "Esami specifici da cercare/segnalare per questa patologia (es: 'screening immunologico se paziente <60a')",
    "Altro esame (es: 'Lp(a), omocisteina')",
    "..."
  ],

  "diari_da_monitorare": [
    "Quadri tipici da cercare nelle note di diario per questa patologia. Esempio: 'Tono dell'umore: stroke ha alta incidenza di depressione post-stroke, da cercare nei diari segnali di apatia, anedonia, calo motivazionale → se documentato, inserire in diagnosi e decorso'",
    "Altro quadro (es: 'Delirium: pazienti anziani spesso sviluppano delirium ipo/iperattivo')",
    "..."
  ],

  "raccomandazioni_specifiche": [
    "Raccomandazione tipica per questa patologia (es: 'target LDL <70 mg/dL')",
    "Altra raccomandazione (es: 'controllo CPK e transaminasi a 1 mese se statina')",
    "..."
  ],

  "terapia_pattern": "Pattern di terapia alla dimissione tipico per questa patologia. Esempio: 'Anticoagulante (DOAC nella maggior parte dei casi, warfarin se valvolare/protesi meccanica) + statina ad alto dosaggio + IPP. Se cardioembolico: DOAC sostituisce ASA. Se PFO chiuso: DAPT 6 mesi. NO doppia antiaggregazione.'",

  "note": "Vincoli speciali (es: 'NIHSS sempre alla dimissione, mRS solo dimissione. Sezione neurosonologica obbligatoria. Visita controllo ambulatorio malattie cerebrovascolari.')."
}

---

REGOLE GENERALI:
- Estrai solo informazione patologia-specifica, non duplicare quello che è già nel prompt di sistema
- Se un campo non è applicabile per questa patologia, restituisci array vuoto [] o stringa vuota ""
- Sii concreto e clinicamente preciso
- NON includere [PAZIENTE_NOME] o [DATA_NASCITA] o altri placeholder generici nel decorso_esempio
- decorso_esempio deve essere prosa narrativa fedele all'originale; gli altri campi sono guide strutturate
- Solo JSON valido, senza testo prima o dopo, senza backtick markdown

===== CARTELLA CLINICA =====
[INCOLLA QUI LA CARTELLA CLINICA ANONIMIZZATA]

===== LETTERA DI DIMISSIONE =====
[INCOLLA QUI LA LETTERA DI DIMISSIONE]`;
let VERIFICA_SYSTEM = `Sei un clinico esperto che verifica la coerenza tra una cartella clinica anonimizzata e una lettera di dimissione.
Analizza ogni affermazione fattuale nella lettera (diagnosi, farmaci, dosi, date, valori di laboratorio, procedure, parametri vitali, anamnesi) e verificala contro la cartella.

Restituisci SOLO un array JSON valido, senza testo prima o dopo, senza backtick.
Ogni elemento ha questa struttura:
{
  "quote": "frase esatta dalla lettera (max 120 caratteri, abbastanza specifica da essere univoca)",
  "severity": "contradiction" | "unsupported" | "inferred",
  "reason": "spiegazione in italiano in una riga (max 100 caratteri)"
}

Severity:
- "contradiction": la lettera afferma qualcosa che contraddice esplicitamente la cartella
- "unsupported": la lettera afferma un fatto specifico completamente assente dalla cartella
- "inferred": la lettera riporta un'inferenza clinicamente ragionevole ma non esplicitamente documentata

Non segnalare frasi generiche, formule di cortesia, struttura della lettera o stile.
Segnala solo contenuto clinico fattuale. Se la lettera è completamente fedele alla cartella, restituisci [].`;
let ESAMI_LAB_SYS = `Sei un assistente clinico esperto. Il tuo compito è generare SOLO la sezione "esami ematochimici" formattata per una lettera di dimissione italiana, partendo dalla tabella grezza degli esami di laboratorio.

Restituisci SOLO il testo della sezione esami, senza intestazione lettera, senza decorso, senza terapia, senza raccomandazioni. Nient'altro.

═══════════════════════════════════════════════════════════════
FORMATO INPUT
═══════════════════════════════════════════════════════════════

La tabella è in formato tab-separated con queste colonne:
- Col 0: Nome esame (es. "B-MCV", "P-CRP", "S-TSH")
- Col 1: Unità di misura
- Col 2: Range di riferimento (es. "4.40 - 11.00")
- Col 3, 4, 5...: Valori per ogni data di prelievo (la colonna più a sinistra = più recente)

Le date sono nelle intestazioni di colonna (riga 0). Le righe senza valori numerici sono intestazioni di categoria.

═══════════════════════════════════════════════════════════════
FORMATO OUTPUT OBBLIGATORIO
═══════════════════════════════════════════════════════════════

Inizia con la frase:
"Durante la degenza il/la paziente è stato/a sottoposto/a ai seguenti esami ematochimici e microbiologici:"

Poi elenca gli esami raggruppati per categoria, con trattino lungo "–" come bullet, tutti gli esami di ogni categoria su UNA SOLA RIGA separati da virgola:

– Emocromo: Hb 132 g/L (140-175), MCV nella norma, MCH nella norma, piastrine nella norma, WBC nella norma.
– Indici di flogosi: **PCR 1,01 → 47,90 → 29,65 mg/L** (0,00-4,99), procalcitonina nella norma.
– Coagulazione: **INR 1,40** RATIO (0,90-1,20), **D-dimero 643 → 1885 µg/L FEU** (190-600), fibrinogeno nella norma, APTT ratio nella norma.

═══════════════════════════════════════════════════════════════
REGOLE
═══════════════════════════════════════════════════════════════

VALORI PATOLOGICI: usa **...** (grassetto) attorno al nome esame + valori patologici (NON il range tra parentesi).

NOMI ESAMI: riporta il nome come nel file (es. "MCV", "Hb in PEC", "gGT"), rimuovendo solo il prefisso "B-", "P-", "S-", "U-".

ESAMI CON VALORE SEMPRE ESPLICITO (anche se nella norma):
Colesterolo totale, HDL, LDL, trigliceridi, HbA1c, creatinina, TSH, urea.

TREND (valori in progressione temporale — ordine cronologico, dal più vecchio al più recente):
- Mostra il trend SOLO se la serie è iniziata nei range e poi è diventata patologica.
  Formato: primo_valore → **picco** → ultimo_valore (con → tra i valori).
- Se sempre patologica dall'inizio: mostra solo l'ultimo valore.
- Se sempre nella norma: "nella norma" (eccetto esami con valore sempre esplicito).

COMPRESSIONE: gli esami tutti nella norma nella stessa categoria si elencano al fondo della riga separati da virgola seguiti da "nella norma". Es: "Hb **132** g/L (140-175); MCV, MCH, MCHC, RDW, WBC nella norma."

SEPARATORI: usa ";" per separare esami con valori specifici dagli esami "nella norma" nella stessa categoria.

CATEGORIE: usa le categorie del file. Se la tabella contiene categorie aggiuntive non elencate nei titoli di sezione standard, includile comunque (es. "Marcatori tumorali", "Sierologia", "Profilo immunologico").

"CAMPIONE NON PERVENUTO" / "ESAME ANNULLATO": riportalo come "nome esame: campione non pervenuto".

DISCORSO: italiano clinico formale. MAI inventare valori non presenti nella tabella.`;
let FINGERPRINT_PROMPT_V2 = FINGERPRINT_PROMPT_V3;
const PROMPT_EMBEDDED_FALLBACKS = { DEFAULT_SYS, FINGERPRINT_PROMPT_V3, VERIFICA_SYSTEM, ESAMI_LAB_SYS };

/* ── Costanti dominio (verbatim da standalone) ── */
const DEFAULT_USER_PREFS = {
  lab: 'all',       // 'all' | 'altered'
  acc: 'brief',     // 'brief' | 'extended'
  dec: 'standard',  // 'short' | 'standard' | 'long'
  an: 'complete',   // 'essential' | 'complete'
  rac: 'all',       // 'main' | 'all'
  ter: 'last',      // 'last' | 'lastPlusHome'
  custom: ''        // free-text additional preferences
};

/* ── TEMPLATE_SECTIONS_AVAILABLE ── */
const TEMPLATE_SECTIONS_AVAILABLE = [
  { id: 'diagnosi_quotata',           label: 'Diagnosi (in apertura)' },
  { id: 'anamnesi_patologica_remota', label: 'Anamnesi patologica remota' },
  { id: 'terapia_domiciliare',        label: 'Terapia domiciliare' },
  { id: 'motivo_ricovero',            label: 'Motivo del ricovero' },
  { id: 'ricoveri_precedenti',        label: 'Ricoveri precedenti (auto-skip se assenti)' },
  { id: 'eo_neurologico_ingresso',    label: 'Esame obiettivo neurologico all\'ingresso' },
  { id: 'eo_generale_ingresso',       label: 'Esame obiettivo generale all\'ingresso' },
  { id: 'esami_ematochimici',         label: 'Esami ematochimici' },
  { id: 'indagini_strumentali',       label: 'Indagini diagnostico-strumentali' },
  { id: 'decorso_clinico',            label: 'Decorso clinico' },
  { id: 'eo_neurologico_dimissione',  label: 'Esame obiettivo neurologico alla dimissione' },
  { id: 'terapia_dimissione',         label: 'Terapia alla dimissione (tabella)' },
  { id: 'visite_controllo',           label: 'Visite di controllo' },
  { id: 'raccomandazioni',            label: 'Raccomandazioni' },
];

/* ── DEFAULT_TEMPLATE_EMBEDDED ── */
const DEFAULT_TEMPLATE_EMBEDDED = {
  id: 'default',
  name: 'Dimissione standard (default)',
  scenario: 'dimissione_domicilio',
  intestazione: 'Alla cortese attenzione del Medico Curante',
  saluto: 'Egregi Colleghi,',
  apertura: 'dimettiamo in data odierna il/la sig./sig.ra [PAZIENTE_NOME], di anni [ETÀ] ([DATA_NASCITA]), ricoverato/a presso il nostro reparto in data [DATA_INGRESSO], con diagnosi di:',
  ordine_sezioni: [
    'diagnosi_quotata',
    'anamnesi_patologica_remota',
    'terapia_domiciliare',
    'motivo_ricovero',
    'ricoveri_precedenti',
    'eo_neurologico_ingresso',
    'eo_generale_ingresso',
    'esami_ematochimici',
    'indagini_strumentali',
    'decorso_clinico',
    'eo_neurologico_dimissione',
    'terapia_dimissione',
    'visite_controllo',
    'raccomandazioni',
  ],
  chiusura: 'Rimaniamo a disposizione e porgiamo cordiali saluti.',
  firma_specializzando_label: '[NOME_SPECIALIZZANDO]',
  firma_dirigente_label: '[NOME_DIRIGENTE]',
  firma_ruolo_sx: 'Medico in formazione specialistica',
  firma_ruolo_dx: 'Dirigente medico',
};

/* ═══════════════════════════════════════════════════════════════════════════
   STATO MODULO + shim di compatibilità "S" (mappa lo stato standalone)
   ═══════════════════════════════════════════════════════════════════════════ */
const L = {
  casi: [], wards: [], allItems: [], templates: [],
  systemPromptSha: {},
  userOverride: '', userOverrideSha: null,
  userTemplateData: null, userTemplateSha: null,
  _casesSha: null, _reportsSha: null,
  loaded: false,
  wiz: null,
};
// Variabili module-level usate dalle funzioni di dominio (nomi identici a standalone)
let _userOverride = '';
let _userTemplateData = null;
let _templates = [];
let _refInjectMode = 'none';
let _refCaseId = null;

// S_XLS: stato file esami (identico a standalone)
const S_XLS = { text:'', filename:'', rawRows:null };

// Shim "S": le funzioni di dominio leggono S.anonText, S.tempPrefs, S.userPrefs, S.has(...)
const S = {
  anonText: '',
  tempPrefs: null,             // preferenze della lettera corrente
  userPrefs: null,             // preferenze utente di default
  currentUser: username(),
  has(key){ return false; },   // placeholder: lo standalone usa S.has per ref-case; gestito via getRefCase
};

// getLetterTemplateType: nel wizard il tipo lettera è in L.wiz.tipo
function getLetterTemplateType(){ return (L.wiz && L.wiz.tipo) || 'dimissione'; }

// getActiveFpObjects / getRefCase / getRefInjectMode: adattati al wizard
function getActiveFpObjects(){
  // Ward fingerprint non usato nella versione integrata base → nessun addendum ward
  return { wardFpObj: null };
}
function getRefInjectMode(){ return _refInjectMode; }
// Seleziona automaticamente il caso di riferimento più simile (primo del RAG)
function _autoSelectRefCase(){
  const w = L.wiz;
  if(!w) return;
  if((L._refMode||'auto')!=='auto') return;
  _refCaseId = (w.ragExamples && w.ragExamples[0]) ? w.ragExamples[0].id : null;
  if(_refInjectMode==='none') _refInjectMode='fingerprint';
}
function getRefCase(){
  if(!_refCaseId) return null;
  const c = L.casi.find(x => x.id === _refCaseId);
  if(!c) return null;
  return {
    name: c.diagnosi || c.name || c.id,
    folder: c.cartella || c.folder || '',
    letter: c.letter || '',
    fingerprint: c.fingerprint || '',
  };
}

// Compat: buildLetterTemplate legge document.getElementById('transferWard').value.
// Manteniamo un input nascosto sincronizzato col wizard per non modificare la funzione verbatim.
function syncTransferWardDom(){
  let el = document.getElementById('transferWard');
  if (!el){ el = document.createElement('input'); el.type='hidden'; el.id='transferWard'; document.body.appendChild(el); }
  el.value = (L.wiz && L.wiz.ward) || '';
}

/* ── Utility ── */
function esc(s){ return escapeHtml(s); }
function slugify(s){
  return String(s||'').toLowerCase()
    .replace(/[àáâä]/g,'a').replace(/[èéêë]/g,'e').replace(/[ìíîï]/g,'i')
    .replace(/[òóôö]/g,'o').replace(/[ùúûü]/g,'u')
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40) || 'caso';
}
function todayISO(){ return new Date().toISOString().slice(0,10); }
function tsCompact(){ return new Date().toISOString().replace(/[:.]/g,'-').replace(/\..*/,''); }
function genId(){ return 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
async function loadScriptOnce(src){
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement('script');
    s.src = src; s.onload = () => res(); s.onerror = () => rej(new Error('Load fail: '+src));
    document.head.appendChild(s);
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   ANONIMIZZATORE (verbatim da standalone: ANON_CONFIG + BKTree + funzioni)
   ═══════════════════════════════════════════════════════════════════════════ */
const ANON_CONFIG = {
  regexRules: [
    // ── Intestazioni istituzionali AOUP / Regione Veneto ────────────────────
    { pattern: /Regione\s+Veneto\s+AZIENDA\s+OSPEDALE\s*[-–]\s*UNIVERSIT[AÀ]['']?\s*PADOV[AO]/gi,
      label: '[INTESTAZIONE_AOUP]', type: 'boiler' },
    { pattern: /REGIONE\s+VENETO\s+AZIENDA\s+OSPEDALE\s*[-–]\s*UNIVERSIT[AÀ]['']?\s*PADOV[AO]/g,
      label: '[INTESTAZIONE_AOUP]', type: 'boiler' },
    { pattern: /^AZIENDA\s+OSPEDALE\s*[-–]\s*UNIVERSIT[AÀ]['']?\s*(?:DI\s+)?PADOV[AO]\s*$/gim,
      label: '[INTESTAZIONE_AOUP]', type: 'boiler' },
    { pattern: /AZIENDA\s+OSPEDALIERA\s*[-–]\s*UNIVERSIT[AÀ]['']?\s*(?:DI\s+)?PADOV[AO]/gi,
      label: '[INTESTAZIONE_AOUP]', type: 'boiler' },
    { pattern: /^Regione\s+VENETO\s*$/gim,
      label: '[INTESTAZIONE_REGIONE]', type: 'boiler' },
    { pattern: /^REGIONE\s+VENETO\s*$/gim,
      label: '[INTESTAZIONE_REGIONE]', type: 'boiler' },
    // ── Episodio headers MUST run before ID/date patterns ───────────────────
    { pattern: /Episodio\s+RIC_AO_\S+\s+[A-Z]+\s+[A-Z]+\s+nato\/a\s+il\s+[\d\/]+/gi,
      label: '[INTESTAZIONE_EPISODIO]', type: 'boiler' },
    { pattern: /^Episodio\s+[A-Z0-9_\-]+\s+[A-Z]+\s+[A-Z]+\s+[\d\/]+$/gim,
      label: '[INTESTAZIONE_EPISODIO]', type: 'boiler' },
    // Catch already-partially-replaced episodio lines
    { pattern: /^Episodio\s+\S+\s+[A-Z]{2,}\s+[A-Z]{2,}(?:\s+\[DATA_NASCITA\])?$/gim,
      label: '[INTESTAZIONE_EPISODIO]', type: 'boiler' },
    // ────────────────────────────────────────────────────────────────────────
    { pattern: /\b[A-Z]{6}\d{2}[A-EHLMPRST]\d{2}[A-Z]\d{3}[A-Z]\b/g,
      label: '[CODICE_FISCALE]', type: 'id' },
    { pattern: /\bRIC_AO_\d{6,12}\b/g, label: '[ID_EPISODIO]', type: 'id' },
    { pattern: /\b(?:Nosografico|Ref\.?\s*SSI|Ric\/Ref|Ref\.|ASSIPCA|Num\.\s*(?:interno|esterno)|N\.\s*Richiesta)\s*:?\s*[\d\/\-A-Z_]+/gi,
      label: '[ID_INTERNO]', type: 'id' },
    { pattern: /\b\d\/\d{4}\/\d{4,6}\b/g, label: '[ID_RICOVERO]', type: 'id' },
    { pattern: /(?:nato\/a?\s+il|[Nn]ato\s+il\s*:|d\.n\.|Data\s+(?:di\s+)?[Nn]ascita\s*:?)\s*\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/gi,
      label: '[DATA_NASCITA]', type: 'date' },
    { pattern: /\[PAZIENTE\][^\n]{0,50}?:\s*(\d{2}[\/\.]\d{2}[\/\.]\d{2,4})/g,
      label: '[PAZIENTE]: [DATA_NASCITA]', type: 'date' },
    { pattern: /\bDN\s+\d{2}[\/\.]\d{2}[\/\.]\d{2,4}\b/gi,
      label: '[DATA_NASCITA]', type: 'date' },
    { pattern: /\(d\.n\.\d{2}\/\d{2}\/\d{2,4}\)/gi,
      label: '[DATA_NASCITA]', type: 'date' },
    { pattern: /\b[Nn]ato(?:\/a)?\s+il\s*:?\s*\d{2}[\/\-\.]\d{2}[\/\-\.]\d{2,4}\b/gi,
      label: '[DATA_NASCITA]', type: 'date' },
    { pattern: /di\s+anni\s+\d{1,3}\s+\(D\.?N\.?\s+\d{2}[\/\.]\d{2}[\/\.]\d{2,4}\)/gi,
      label: '[ETA_DN]', type: 'date' },
    { pattern: /di\s+anni\s+\d{1,3}\s+\(d\.n\.\d{2}\/\d{2}\/\d{2,4}\)/gi,
      label: '[ETA_DN]', type: 'date' },
    { pattern: /\(n[\s.]+\s*\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\)/gi,
      label: '([DATA_NASCITA])', type: 'date' },
    { pattern: /(?:^|\r?\n)\s*(?:Paziente|Intestatario|Nominativo)\s*:\s*(?!(?:Nato|Data|Sesso|Cod|RIC|vigile|orientato|deceduto)\b)[A-Z][a-z\u00C0-\u00FF]+(?:\s+(?!(?:Nato|Data|Sesso|Cod|RIC)\b)[A-Z][a-z\u00C0-\u00FF]+)?/gm,
      label: '[PAZIENTE]', type: 'name' },
    { pattern: /(?<=(?:dimettiamo|trasferiamo)\s+in\s+data\s+odierna\s+(?:il\s+[Ss]ig\.?(?:nor)?(?:ra?)?\.?\s+|la\s+[Ss]ig\.?(?:nora)?(?:ra)?\.?\s+))[A-Z][a-zA-Z\u00C0-\u00FF]+(?:\s+[A-Z][a-zA-Z\u00C0-\u00FF]+)?(?=\s*,)/gi,
      label: '[PAZIENTE]', type: 'name' },
    { pattern: /\bil\s+(?:[Ss]ig\.(?:nor)?(?:ra)?|[Pp]aziente)\s+([A-Z][a-zA-Z\u00C0-\u00FF]+(?:\s+[A-Z][a-zA-Z\u00C0-\u00FF]+){0,2})/g,
      label: 'il sig. [PAZIENTE]', type: 'name' },
    // "Sig. Cognome Nome" / "Sig.ra Cognome Nome" in report headers (1-2 words)
    { pattern: /\bSig\.(?:ra\.?)?\s+[A-Z][a-z\u00C0-\u00FF]{2,}(?:\s+[A-Z][a-z\u00C0-\u00FF]{2,})?/g,
      label: '[PAZIENTE]', type: 'name' },
    // ALL-CAPS surname immediately before [NOME] tag
    { pattern: /\b[A-Z]{3,}(?=\s+\[NOME\])/g,
      label: '[PAZIENTE]', type: 'name' },
    // Digits glued to ALL-CAPS surname before [NOME]
    { pattern: /(?<=\d)[A-Z]{3,}(?=\s+\[NOME\])/g,
      label: '[PAZIENTE]', type: 'name' },
    { pattern: /Stampato\s+(?:il\s+)?\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}\s+[^\n]*Stampato\s+da\s*:\s*[^\n]*/g,
      label: '[DATA_STAMPA]Stampato da: [OPERATORE]', type: 'boiler' },
    { pattern: /Stampato\s+da\s*:\s*[^\n]+/g,
      label: 'Stampato da: [OPERATORE]', type: 'name' },
    // FIX: Specializzando pattern — flexible title prefix (dott/dr with or without dot, any case)
    { pattern: /Specializzando\s*:\s*(?:(?:[Dd]ott\.?(?:ssa\.?)?|[Dd]r\.?(?:ssa\.?)?)\s+)?(?:[A-Z]\.\s*)?[A-Z][a-zA-Z'\u00C0-\u00FF]+(?:\s+[A-Z][a-zA-Z'\u00C0-\u00FF]+)*/g,
      label: 'Specializzando: [OPERATORE]', type: 'name' },
    // FIX: "Medico: Nome Cognome" — require line start to avoid matching glued text like "D'ErricoMedico:"
    { pattern: /(?:^|\n)Medico\s*:\s*[A-Z][a-z\u00C0-\u00FF][a-zA-Z\u00C0-\u00FF]*(?:\s+[A-Z][a-zA-Z\u00C0-\u00FF]+)*/gm,
      label: 'Medico: [OPERATORE]', type: 'name' },
    // "Infermiere: [NOME] Cognome" — residual surname after partial redaction
    { pattern: /Infermiere\s*:\s*(?:\[NOME\]\s+)?[A-Z][a-z\u00C0-\u00FF]{2,}/g,
      label: 'Infermiere: [OPERATORE]', type: 'name' },
    // "Dr. I. D'Errico" / "dott Pieroni" / "prof Guerra" — flexible title (with/without dot,
    // any case: dott dott. Dott. dr Dr. prof Prof. med), optional ssa suffix,
    // optional initials, then name with compound/apostrophe surnames.
    // Include varianti con errori di scrittura: Dott.sa, dottsa, ott.ssa, D.ssa, Dssa, dr.sa, drssa
    { pattern: /(?:[Dd]ott?\.?(?:\.?ss?a\.?)?|[Dd]r\.?(?:\.?ss?a\.?)?|[Dd]\.?ss?a\.?|[Oo]tt\.?(?:\.?ss?a\.?)?|[Pp]r?of\.?(?:ss?a\.?)?|[Pp]orf\.?|[Mm]ed\.?)\s*(?:[A-Z]\.\s*){0,3}[A-Z][a-zA-Z'\u00C0-\u00FF\-]{2,}(?:\s+(?:De[ilr]?|Da[il]?|Dal|Di|Della|Von|Al|El)\s+[A-Z][a-zA-Z'\u00C0-\u00FF]+|\s+(?![Dd]ott\.?|[Dd]r\.?|[Pp]rof\.?)[A-Z][a-zA-Z'\u00C0-\u00FF\-]+)*/g,
      label: '[OPERATORE]', type: 'name' },
    // "[NOME]NomeCognome" or "LUCACognome" — patient name glued to label "Cognome"
    { pattern: /[A-Za-z\u00C0-\u00FF]+(?=Cognome\b)/g,
      label: '[PAZIENTE]', type: 'name' },
    // "1/2LUCA MAZZOCCA" footer lines in verbale operatorio
    { pattern: /\b\d+\/\d+[A-Z][a-zA-Z\u00C0-\u00FF]+(?:\s+[A-Z][a-zA-Z\u00C0-\u00FF]+)*/g,
      label: '[PAGINA]', type: 'boiler' },
    // Standalone "Cognome Nome" CamelCase pair on its own line
    { pattern: /^([A-Z][a-z\u00C0-\u00FF]{2,})\s+([A-Z][a-z\u00C0-\u00FF]{2,})\s*$/gm,
      replace: function(m, w1, w2) {
        if (shouldSkipName([w1, w2])) return m;
        return '[OPERATORE]';
      },
      label: '[OPERATORE]', type: 'name' },
    // ── Apostrophe surname patterns (D'Amore, D'Errico, O'Brien etc.) ──
    // "Giovanni\nD'amore\n" — Name on one line, D'surname on next (diary entries)
    { pattern: /^([A-Z][a-z\u00C0-\u00FF]{2,})\r?\n([A-Z]'[a-zA-Z\u00C0-\u00FF]{2,})\s*$/gm,
      label: '[OPERATORE]', type: 'name' },
    // "Giovanni\nD'amore\nI..." — Name, D'surname, then role code on next line
    { pattern: /([A-Z][a-z\u00C0-\u00FF]{2,})\r?\n([A-Z]'[a-zA-Z\u00C0-\u00FF]{2,})\r?\n(?=[MIFRO][A-Z])/gm,
      label: '[OPERATORE]\n', type: 'name' },
    // "D'amore Giovanni" or "Giovanni D'amore" — apostrophe surname pair anywhere
    { pattern: /\b([A-Z]'[a-zA-Z\u00C0-\u00FF]{2,})\s+([A-Z][a-z\u00C0-\u00FF]{2,})\b/g,
      label: '[OPERATORE]', type: 'name' },
    { pattern: /\b([A-Z][a-z\u00C0-\u00FF]{2,})\s+([A-Z]'[a-zA-Z\u00C0-\u00FF]{2,})\b/g,
      label: '[OPERATORE]', type: 'name' },
    // "(D'amore Giovanni)" or "(Giovanni D'amore)" — parenthesized apostrophe names
    { pattern: /\(([A-Z]'[a-zA-Z\u00C0-\u00FF]{2,})\s+([A-Z][a-z\u00C0-\u00FF]{2,})\)/g,
      label: '([OPERATORE])', type: 'name' },
    { pattern: /\(([A-Z][a-z\u00C0-\u00FF]{2,})\s+([A-Z]'[a-zA-Z\u00C0-\u00FF]{2,})\)/g,
      label: '([OPERATORE])', type: 'name' },
    // Single-word CamelCase surname on its own line, after [OPERATORE] context lines
    { pattern: /(?<=\[OPERATORE\]\r?\n)([A-Z][a-z\u00C0-\u00FF]{3,})(?=\r?\n)/gm,
      replace: function(m, name) {
        return TRAILING_SKIP.has(name.toLowerCase()) ? name : '[OPERATORE]';
      },
      label: '[OPERATORE]', type: 'name' },
    // Single-word CamelCase surname immediately before role-code line (M/I/F/R + text)
    { pattern: /^([A-Z][a-z\u00C0-\u00FF]{3,})\r?\n(?=[MIFR][A-Z])/gm,
      replace: function(m, name) {
        return TRAILING_SKIP.has(name.toLowerCase()) ? m : '[OPERATORE]\n';
      },
      label: '[OPERATORE]', type: 'name' },
    // ": COGNOME NOME" ALL-CAPS after colon on own line
    { pattern: /^\s*:\s*[A-Z]{3,}(?:\s+[A-Z]{3,})+\s*$/gm,
      label: ': [OPERATORE]', type: 'name' },
    // "con [OPERATORE] e Cognome" — trailing surname in giro visite notes
    { pattern: /(\[OPERATORE\][^\n]*?\se\s)([A-Z][a-z\u00C0-\u00FF]{3,})/g,
      replace: (m,pre,name) => pre+'[OPERATORE]', label: 'e [OPERATORE]', type: 'name' },
    // ─────────────────────────────────────────────────────────────────────────
    { pattern: /\bla\s+[Ss]ig\.?(?:nora)?(?:ra)?\.?\s+([A-Z][a-zA-Z\u00C0-\u00FF]+(?:\s+[A-Z][a-zA-Z\u00C0-\u00FF]+){0,2})/g,
      label: 'la sig.ra [PAZIENTE]', type: 'name' },
    { pattern: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
      label: '[EMAIL]', type: 'id' },
    { pattern: /(?:Tel(?:efono)?\s*\d*|Fax)\.?\s*:?\s*\+?\d[\d\s\.\-]{5,}\d/gi,
      label: '[TELEFONO]', type: 'id' },
    { pattern: /\b3\d{2}[\s\-]?\d{3,4}[\s\-]?\d{3,4}\b/g,
      label: '[TELEFONO]', type: 'id' },
    { pattern: /(?:Telefono\s*\d*\s*:)\s*\d{5,9}\b/gi,
      label: '[TELEFONO]', type: 'id' },
    { pattern: /\bSSN\s*:?\s*\d{6,12}\b/gi,
      label: '[SSN]', type: 'id' },
    { pattern: /Indirizzo\s+(?:domicilio|residenza)\s*:?\s*[^\n\r]+/gi,
      label: '[INDIRIZZO_PAZIENTE]', type: 'boiler' },
    { pattern: /\b(?:VIA|VIALE|CORSO|PIAZZA|PIAZZALE|PIAZZETTA|LARGO|VICOLO|STRADA|BORGATA|CONTRADA|LOCALIT[AÀ]|FRAZIONE)\s+[A-Z][A-Z\s,\u00C0-\u00FF]+[,\s]\d+(?:\s*[-\/]\s*[A-Z0-9]+)?/gi,
      label: '[INDIRIZZO_PAZIENTE]', type: 'boiler' },
    // "domicilio: <address>" or "residenza: <address>" after label
    { pattern: /(?:domicilio|residenza)\s*:\s*[^\n\r]{5,}/gi,
      label: '[INDIRIZZO_PAZIENTE]', type: 'boiler' },
    // ALL CAPS patient name before Paziente: keyword
    { pattern: /(?:Paziente|Intestatario|Nominativo)\s*:\s*[A-Z]{2,}(?:\s+[A-Z]{2,})?/g,
      label: '[PAZIENTE]', type: 'name' },
    { pattern: /\(?(?:Nato\s+il|nato\s+in\s+data|nato\/a?\s+il|n\.\s*|n\s+\.\s*|Data\s+di\s+nascita|D\.?N\.?)\s*:?\s*\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\)?/gi,
      label: '[DATA_NASCITA]', type: 'date' },
    { pattern: /Nosologico\s*:?\s*[\w\-\/]*/gi,
      label: '[NOSOLOGICO]', type: 'boiler' },
    { pattern: /\bRIC_AO_\d+\b/g,
      label: '[ID_RICOVERO]', type: 'id' },
    { pattern: /(?:MMG|PLS)(?:\s*\/\s*(?:MMG|PLS))?\s*:?\s*[A-Z][A-Za-z\u00C0-\u00FF']+(?:\s+[A-Z][A-Za-z\u00C0-\u00FF']+)?(?=\s{2,}|\s*[\r\n]|\s+(?:Data|Telefono|Indirizzo|Nosologico|Anamnesi|Reparto|Ricovero|[A-Z][a-z]))/g,
      label: 'MMG/PLS: [OPERATORE]', type: 'name' },
    { pattern: /\b[A-Z][a-z\u00C0-\u00FF]+\s+[A-Z][a-z\u00C0-\u00FF]+(?=\s+\(\d{2}\/\d{2}\/\d{4})/g,
      label: '[OPERATORE]', type: 'name' },
    // Apostrophe surname + name before date: "D'amore Giovanni (15/02/2026..."
    { pattern: /\b[A-Z]'[a-zA-Z\u00C0-\u00FF]{2,}\s+[A-Z][a-z\u00C0-\u00FF]+(?=\s+\(\d{2}\/\d{2}\/\d{4})/g,
      label: '[OPERATORE]', type: 'name' },
    { pattern: /\b[A-Z][a-z\u00C0-\u00FF]+\s+[A-Z]'[a-zA-Z\u00C0-\u00FF]{2,}(?=\s+\(\d{2}\/\d{2}\/\d{4})/g,
      label: '[OPERATORE]', type: 'name' },
    { pattern: /\b([A-Z][a-z\u00C0-\u00FF]+(?:\s+[A-Z][a-z\u00C0-\u00FF]+){1,2})(?=[MIFRO](?:[A-Za-z0-9]|\s|$)|\s+[MIFRO]\s+[A-Za-z]|\s*[MIFRO](?:[A-Za-z0-9]|\s|$))/g,
      replace: function(m, words, offset, full) {
        // Check if role code is glued (no space) — definitely a name+role
        const after = full.charAt(offset + m.length);
        const glued = /[MIFRO]/.test(after) && !/\s/.test(m.charAt(m.length - 1));
        if (glued) return '[OPERATORE]';
        const ws = words.trim().split(/\s+/);
        if (shouldSkipName(ws)) return m;
        return '[OPERATORE]';
      },
      label: '[OPERATORE]', type: 'name' },
    { pattern: /\b[A-Za-z\u00C0-\u00FF][a-zA-Z\u00C0-\u00FF]{1,}(?:\s+[A-Za-z\u00C0-\u00FF][a-zA-Z\u00C0-\u00FF]{1,}){0,2}(?=\s+(?:Coniuge|Figlio|Figlia|Fratello|Sorella|Genitore|Amico|Convivente|Nipote))/g,
      label: '[CONTATTO]', type: 'name' },
    { pattern: /Rete\s+sociale[\s\S]*?Stampato\s+da\s*:\s*[^\n]+/gim,
      label: '[RETE_SOCIALE]', type: 'boiler' },
    { pattern: /(?:Coniuge|Figlio|Figlia|Fratello|Sorella|Genitore|Convivente|Nipote)\s+Sconosciuto[^\n]*/gi,
      label: '[RELAZIONE_FAMILIARE]', type: 'boiler' },
    { pattern: /(?:Certificato\s+n\.|SGQ\s+UNI.*?Certiquality)[^\n]*/gi,
      label: '[CERTIFICAZIONE]', type: 'boiler' },
    { pattern: /(?:ID\s+paziente|ID\s+Persona)\s*:?\s*\d+/gi,
      label: '[ID_PAZIENTE]', type: 'id' },
    { pattern: /(?:Documento|Referto|Lettera di dimissione)\s+[Ff]irmato\s+digitalmente\s+(?:da|il)[^\n]*/g,
      label: '[FIRMA_DIGITALE]', type: 'boiler' },
    { pattern: /[Ff]irmatario\s*:\s*\S+\s+\S+\s+Codice\s+Fiscale\s*:[^\n]*/g,
      label: '[FIRMA_DIGITALE]', type: 'boiler' },
    { pattern: /Firmato\s+il[:\s]+[\d\/]+\s+Ora[:\s]+[\d:\.]+[^\n]*/g,
      label: '[FIRMA_DIGITALE]', type: 'boiler' },
    // Firma digitale con nome del medico firmatario, vari formati:
    // "Firmato il: 13/04/2026 10:38:33 da Giovanni Muciaccia"
    { pattern: /Firmat[oa]\s+il\s*:?\s*\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4}(?:\s+\d{1,2}[:\.]\d{2}(?:[:\.]\d{2})?)?\s+da\s+[A-ZÀ-Ü][a-zà-ü'\-]+(?:\s+[A-ZÀ-Ü][a-zà-ü'\-]+)+/g,
      label: 'Firmato da [OPERATORE]', type: 'name' },
    // "Firmato da Giovanni Muciaccia il 13/04/2026"
    { pattern: /Firmat[oa]\s+da\s+[A-ZÀ-Ü][a-zà-ü'\-]+(?:\s+[A-ZÀ-Ü][a-zà-ü'\-]+)+\s+il\s*:?\s*\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4}[^\n]*/g,
      label: 'Firmato da [OPERATORE]', type: 'name' },
    // "Sottoscritto/Validato/Refertato da NOME COGNOME"
    { pattern: /(?:Sottoscritto|Validato|Refertato|Redatto|Compilato)\s+(?:digitalmente\s+)?da\s+[A-ZÀ-Ü][a-zà-ü'\-]+(?:\s+[A-ZÀ-Ü][a-zà-ü'\-]+)+/g,
      label: '[OPERATORE]', type: 'name' },
    // "... HH:MM(:SS) da NOME COGNOME" — nome dopo orario+"da" (metadati documento).
    // Sostituisce solo "da NOME COGNOME" lasciando intatto l'orario che precede.
    { pattern: /\bda\s+[A-ZÀ-Ü][a-zà-ü'\-]+\s+[A-ZÀ-Ü][a-zà-ü'\-]+(?=\s*$|\s*\n)/gm,
      replace: (m) => 'da [OPERATORE]', label: 'da [OPERATORE]', type: 'name' },
    // "... HH:MM:SS NOME COGNOME[da]" — nome SUBITO dopo l'orario, senza "da" davanti.
    // Il suffisso "da" attaccato (es. "Michelada") è un artefatto PDF.js (frammento di "Data").
    { pattern: /(\d{1,2}[:\.]\d{2}[:\.]\d{2})\s+[A-ZÀ-Ü][a-zà-ü'\-]+\s+[A-ZÀ-Ü][a-zà-ü'\-]+(?:da)?(?=\s*$|\s*\n)/gm,
      replace: (m, ora) => ora + ' [OPERATORE]', label: '[OPERATORE]', type: 'name' },
    { pattern: /Il\s+referto\s+è\s+conservato\s+secondo\s+la\s+normativa[^\n]*/gi,
      label: '[CONSERVAZIONE]', type: 'boiler' },
    { pattern: /Copia\s+di\s+(?:documento|referto)\s+firmato\s+e\s+conservato[^\n]*/gi,
      label: '[CONSERVAZIONE]', type: 'boiler' },
    { pattern: /Rappresentazione\s+di\s+un\s+referto\s+firmato\s+elettronicamente[^\n]*/gi,
      label: '[CONSERVAZIONE]', type: 'boiler' },
    // Metadati documento: "Data creazione/ultima modifica DD/MM/YYYY HH:MM:SS [NOME|da OPERATORE]"
    { pattern: /Data\s+(?:di\s+)?(?:creazione|(?:ultima\s+)?modifica)\s+\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4}(?:\s+\d{1,2}[:\.]\d{2}(?:[:\.]\d{2})?)?(?:\s+(?:da\s+)?\[OPERATORE\])?/gi,
      label: '[METADATO]', type: 'boiler' },
    { pattern: /Pag(?:ina)?\.?\s*\d+\s*(?:di|\/)\s*\d+/gi,
      label: '[PAGINA]', type: 'boiler' },
    { pattern: /Data\s+stampa\s*:\s*[\d\/]+\s+[\d:]+/gi,
      label: '[DATA_STAMPA]', type: 'boiler' },
    { pattern: /Versione\s+Referto\s*:\s*\d+/gi, label: '[VERSIONE]', type: 'boiler' },
    { pattern: /Versione\s+\d+\s+CC\s*:\s*[NY]/gi, label: '[VERSIONE]', type: 'boiler' },
    { pattern: /(?:Num\.\s*(?:interno|esterno)|Documento\s+Numero)\s*:?\s*[\d\-\/]+/gi,
      label: '[NUM_DOCUMENTO]', type: 'boiler' },
    { pattern: /INFORMAZIONE\s+AI\s+SENSI\s+DELLA\s+DELIBERAZIONE[^\n]*/gi,
      label: '[INFO_DELIBERAZIONE]', type: 'boiler' },
    { pattern: /Gentile\s+signore\/signora\s+desideriamo[^\n]*/gi,
      label: '[INFO_COSTO]', type: 'boiler' },
    { pattern: /un\s+impiego\s+di\s+risorse\s+economiche[^\n]*/gi,
      label: '[INFO_COSTO]', type: 'boiler' },
    { pattern: /pari\s+ad\s+euro\s+[\d\.,]+/gi, label: '[COSTO_SSR]', type: 'boiler' },
    { pattern: /(?:Prelievo\s+del|Ricevuto\s+il|Riferimento)\s*:\s*[\d\/\s:]+/gi,
      label: '[DATI_PRELIEVO]', type: 'boiler' },
    { pattern: /Ric\/Ref\s*:\s*[\d\/\-\w]+/gi, label: '[RIC_REF]', type: 'boiler' },
    { pattern: /SARANNO\s+DISPONIBILI\s+ULTERIORI\s+REFERTI[^\n]*/gi,
      label: '[NOTA_REFERTO]', type: 'boiler' },
    { pattern: /Note\s+dal\s+richiedente\s*:\s*RICHIESTA\s+URGENTE/gi,
      label: '[RICHIESTA_URGENTE]', type: 'boiler' },
    { pattern: /Al\s+Medico\s+Curante\s*:\s*\S+\s+\S+/gi,
      label: 'Al Medico Curante: [PAZIENTE]', type: 'name' },
    { pattern: /Provenienza\s*:\s*[^\n]+/gi, label: '[PROVENIENZA]', type: 'boiler' },
    { pattern: /Medico\s+[Rr]ichiedente\s*:[ \t]*(?:\[(?:NOME|PAZIENTE|OPERATORE)\]|[A-Z][a-z\u00C0-\u00FF][a-zA-Z\u00C0-\u00FF]*|[A-Z]{2,})(?:[ \t]+(?:\[(?:NOME|PAZIENTE|OPERATORE)\]|[A-Z][a-zA-Z\u00C0-\u00FF]+|[A-Z]{2,})){0,2}/g,
      label: 'Medico richiedente: [OPERATORE]', type: 'name' },
    { pattern: /Medico\s+[Rr]efertante\s*:[ \t]*[A-Z][a-z\u00C0-\u00FF][a-zA-Z\u00C0-\u00FF]*(?:[ \t]+[A-Z][a-zA-Z\u00C0-\u00FF]+){0,2}/g,
      label: 'Medico refertante: [OPERATORE]', type: 'name' },
    { pattern: /Refertato\s+da\s*:\s*(?:(?:[Dd][Oo][Tt]{2}\.(?:[Ss][Ss][Aa]\.?)?|[Dd][Rr]\.(?:[Ss][Ss][Aa]\.?)?)\s+)?[A-Z][a-z\u00C0-\u00FF][a-zA-Z\u00C0-\u00FF]*(?:\s+[A-Z][a-zA-Z\u00C0-\u00FF]+)*/g,
      label: 'Refertato da: [OPERATORE]', type: 'name' },
    { pattern: /Responsabile(?:\s+[A-Za-z]+)?\s*:\s*(?:(?:[Dd][Rr]\.?(?:[Ss][Ss][Aa]\.?)?|[Pp][Rr][Oo][Ff]\.?(?:[Ss][Ss][Aa]\.?)?)\s*)?[A-Z][a-zA-Z\u00C0-\u00FF]+(?:\s+[A-Z][a-zA-Z\u00C0-\u00FF]+)*/gi,
      label: 'Responsabile: [OPERATORE]', type: 'name' },
    { pattern: /Operatore\s*:\s*[A-Z][a-z\u00C0-\u00FF][a-zA-Z\u00C0-\u00FF]*(?:\s+[A-Z][a-zA-Z\u00C0-\u00FF]+)*/g,
      label: 'Operatore: [OPERATORE]', type: 'name' },
    { pattern: /Richiesta\s+in\s+data\s*:\s*[\d\/\s:]+(?:per\s+il[\d\/\s:]+)?/gi,
      label: 'Richiesta in data: [DATA]', type: 'boiler' },
    { pattern: /Azienda\s+Ospedale\s*-\s*Universit\u00e0\s+Padova\s*:\s*Via[^\n]+/gi,
      label: '[INDIRIZZO_AZ]', type: 'boiler' },
    { pattern: /Via\s+[A-Z][a-z]+\s+[A-Z][a-z]+(?:ini)?\s+\d+[^\n]*/gi,
      label: '[INDIRIZZO]', type: 'boiler' },
    { pattern: /C\.F\.\s+P\.IVA\s+\d{11}/gi, label: '[CF_PIVA_AZ]', type: 'boiler' },
    // ── LAB HEADER — protect "Costituente Risultato Unita'" line ──────────
    { pattern: /^Costituente\s+Risultato\s+Unit[^\n]*/gm,
      label: '[INTESTAZIONE_LAB]', type: 'boiler' },
    // ── LAB NOTES — preserve clinical comments in lab blocks ───────────────
    // ECG metadata
    { pattern: /\b[A-Z]{2,}(?:\s+[A-Z]{2,})+(?=\s+(?:Età|Sesso|Nome|Cognome)\s*:)/g,
      label: '[PAZIENTE]', type: 'name' },
    { pattern: /\d{4}\s+[A-Z]{2,}(?:\s+[A-Z]{2,})+(?=\s+(?:Età|Sesso|Nome|Cognome))/g,
      label: '[DATA_NASCITA] [PAZIENTE]', type: 'name' },
    { pattern: /(?:Nome|Cognome)\s*:\s*[A-Z][A-Za-z\u00C0-\u00FF]+/g,
      label: '[PAZIENTE]', type: 'name' },
    { pattern: /\b[A-Z]{2,}(?:\s+[A-Z]{2,})+(?=\s+Et[àa]\s*:)/g,
      label: '[PAZIENTE]', type: 'name' },
    { pattern: /\b\d{2}[\/\.]\d{2}[\/\.]\d{4}(?=\s+(?:Maschio|Femmina|M\b|F\b))/g,
      label: '[DATA_NASCITA]', type: 'date' },
    // ALL CAPS full name on own line — excludes clinical locations, exam section labels, and lab terms
    { pattern: /^(?!(?:STROKE\s+UNIT|PRONTO\s+SOCCORSO|CLINICA\s+NEUROLOGICA|CLINICA\s+NEUROLOG|UNITA\s+STROKE|STROKE\s+UNIT\s+[-–]|ESAME\s+NEUROLOGICO|ESAME\s+OBIETTIVO|ESAME\s+OBBIETTIVO|ANAMNESI\s+PATOLOGICA|ANAMNESI\s+FISIOLOGICA|DECORSO\s+CLINICO|TERAPIA\s+DOMICILIARE|TERAPIA\s+ALLA|MOTIVO\s+DEL\s+RICOVERO|ACCERTAMENTI\s+STRUMENTALI|VALUTAZIONI\s+SPECIALISTICHE|ESAMI\s+DI\s+LABORATORIO|FOLLOW[\s\-]UP|EMOGLOBINA\s+GLICATA|PROFILO\s+LIPIDICO|PROFILO\s+METABOLICO|PROFILO\s+PROTEICO|PROFILO\s+ERITROCITARIO|PROFILO\s+COAGULATIVO|FUNZIONALITA\s+RENALE|FUNZIONALITA\s+EPATICA|FUNZIONALITA\s+TIROIDEA|ENZIMI\s+MUSCOLARI|METABOLITI\s+SPECIALI|FORMULA\s+LEUCOCITARIA|INDICI\s+DI\s+FLOGOSI|ESAME\s+URINE|ESAMI\s+MICROBIOLOGICI|EMATOLOGIA\s+E|COSTITUENTI\s+BIOCHIMICI|MICROSCOPIA\s+CLINICA|ORMONI|APTOGLOBINA|COMPLEMENTO))[A-Z]{2,}(?:\s+[A-Z]{2,})+$/gm,
      label: '[OPERATORE]', type: 'name' },
    // ALL CAPS single word — expanded exclusion list
    { pattern: /^(?!(?:STROKE|UNIT|URGENTE|ORDINARIO|AMBULATORIALE|DIAGNOSI|REPARTO|COGNOME|NOME|SESSO|DATA|INTERVENT|PRIMO|SECONDO|ANESTESI|INFERMIER|TECNICO|CHIRURGO|OPERATORE|PROFILO|ESAME|CONTEGGIO|ZONA|INDAGINE|FORMULA|CITOMETRIA|EMATOLOGICO|EMATOLOGICI|EMATOLOGICA|BIOCHIMICI|BIOCHIMICHE|COAGULAZIONE|SIEROLOGIA|IMMUNOLOGIA|MICROSCOPIA|ORMONI|METABOLITI|COSTITUENTI|SPECIALI|LIPIDICO|LIPIDICA|PROTEICO|PROTEICA|ERITROCITARIO|ERITROCITARIA|MICROBIOLOGICI|MICROBIOLOGICA|DIFFERENZIALE|ALBUMINICA|CHIMICO|FISICA|FISICO|URINARIO|URINARIA|CLINICA|AZIENDA|REGIONE|DIPARTIMENTO|AMBULATORIO|INDICAZIONI|CONCLUSIONI|RISULTATI|TECNICA|DESCRIZIONE|INTERVENTO|SALA|FARMACI|BISOGNO|RENALE|EPATICA|TIROIDEA|ORMONALE|SIEROIMMUNOLOGICA|BATTERIOLOGICA|SORVEGLIANZA|COLTURALE|REFERTO|DIMISSIONE|STAMPA|INDICI|DI|FLOGOSI|COMMENTO|ANTICORPI|TREPONEMA|PALLIDUM|LABORATORIO|GERMI|HBSAG|UNKNOWN|EPATITI|METABOLISMO|EMOCROMO|LEUCOCITARIA|LEUCOCITI|ETF|CRIO)\b)[A-Z][A-Z\-]{1,}(?:\s+(?!(?:STROKE|UNIT|URGENTE|ORDINARIO|AMBULATORIALE|DIAGNOSI|REPARTO|COGNOME|NOME|SESSO|DATA|INTERVENT|PRIMO|SECONDO|ANESTESI|INFERMIER|TECNICO|CHIRURGO|OPERATORE|PROFILO|ESAME|CONTEGGIO|ZONA|INDAGINE|FORMULA|CITOMETRIA|EMATOLOGICO|EMATOLOGICI|EMATOLOGICA|BIOCHIMICI|BIOCHIMICHE|COAGULAZIONE|SIEROLOGIA|IMMUNOLOGIA|MICROSCOPIA|ORMONI|METABOLITI|COSTITUENTI|SPECIALI|LIPIDICO|LIPIDICA|PROTEICO|PROTEICA|ERITROCITARIO|ERITROCITARIA|MICROBIOLOGICI|MICROBIOLOGICA|DIFFERENZIALE|ALBUMINICA|CHIMICO|FISICA|FISICO|URINARIO|URINARIA|CLINICA|AZIENDA|REGIONE|DIPARTIMENTO|AMBULATORIO|INDICAZIONI|CONCLUSIONI|RISULTATI|TECNICA|DESCRIZIONE|INTERVENTO|SALA|FARMACI|BISOGNO|RENALE|EPATICA|TIROIDEA|ORMONALE|SIEROIMMUNOLOGICA|BATTERIOLOGICA|SORVEGLIANZA|COLTURALE|REFERTO|DIMISSIONE|STAMPA|INDICI|DI|FLOGOSI|COMMENTO|ANTICORPI|TREPONEMA|PALLIDUM|LABORATORIO|GERMI|HBSAG|UNKNOWN|EPATITI|METABOLISMO|EMOCROMO|LEUCOCITARIA|LEUCOCITI|ETF|CRIO)\b)[A-Z][A-Z\-']{1,})+\s*$/gm,
      label: '[PAZIENTE]', type: 'name' },
    // ALL CAPS name + date or parenthesis — exclude lab section headers
    { pattern: /\b(?!(?:ESAMI\s+DI\s+LABORATORIO|DI\s+LABORATORIO|ESAMI\s+DI|EMOGLOBINA\s+GLICATA|PROFILO\s+LIPIDICO|PROFILO\s+METABOLICO|PROFILO\s+PROTEICO|PROFILO\s+ERITROCITARIO|PROFILO\s+COAGULATIVO|FUNZIONALITA\s+RENALE|FUNZIONALITA\s+EPATICA|FUNZIONALITA\s+TIROIDEA|ENZIMI\s+MUSCOLARI|METABOLITI\s+SPECIALI|FORMULA\s+LEUCOCITARIA|INDICI\s+DI\s+FLOGOSI|DI\s+FLOGOSI|ESAME\s+URINE|ESAMI\s+MICROBIOLOGICI|COSTITUENTI\s+BIOCHIMICI|ORMONI|HBA1C|HBAIC))[A-Z]{2,}(?:\s+[A-Z]{2,})+(?=\s+(?:\d{2}[\/\.]\d{2}[\/\.]\d{4}|\())/g,
      label: '[PAZIENTE]', type: 'name' },
    // ALL CAPS name immediately concatenated with CamelCase keyword
    { pattern: /(?<=[a-z]\s)[A-Z][A-Z\-]{1,}(?:\s+[A-Z][A-Z\-']{1,})+(?=\s+[a-z])/g,
      label: '[OPERATORE]', type: 'name' },
    // ALL-CAPS name at line start followed by role label on next line
    { pattern: /^[A-Z][A-Z\-]{1,}(?:\s+[A-Z][A-Z\-']{1,})+(?=\r?\n(?:1°|2°|PRIMO|SECONDO|INFERMIERE|TECNICO|CHIRURGO))/gm,
      label: '[OPERATORE]', type: 'name' },
    { pattern: /\b(?!(?:STROKE|ESAMI|PROFILO|ANAMNESI|DECORSO|TERAPIA|MOTIVO|REGIONE|AZIENDA|MARCATORI|EMATOLOGIA|COSTITUENTI|UNITA|DI|DEL|DELLA|DEGLI|DELLE|AI|AL)\b)[A-Z]{2,}(?:\s+(?!(?:STROKE|ESAMI|PROFILO|ANAMNESI|DECORSO|TERAPIA|MOTIVO|REGIONE|AZIENDA|MARCATORI|EMATOLOGIA|COSTITUENTI|UNITA|UNIT|DI|DEL|DELLA|DEGLI|DELLE|LAB|LABORATORIO|FISIOLOGICA|PATOLOGICA|CLINICO|LIPIDICO|PROTEICO|ERITROCITARIO|COAGULATIVO|RENALE|EPATICA|TIROIDEA|MUSCOLARI|SPECIALI|LEUCOCITARIA|FLOGOSI|URINE|MICROBIOLOGICI|BIOCHIMICI)\b)[A-Z]{2,})+(?=[A-Z][a-z])/g,
      label: '[PAZIENTE]', type: 'name' },
    // Signature blocks — flexible title (dott/dr/prof with or without dot, any case)
    { pattern: /(?:[Dd]ott\.?(?:ssa\.?)?|[Dd]r\.?(?:ssa\.?)?|[Pp]r?of\.?(?:ssa\.?)?|[Pp]orf\.?|[Mm]ed\.?)\s*(?:[A-Z]\.\s*){0,4}[A-Z][a-zA-Z'\u00C0-\u00FF]+(?:\s+(?![Dd]ott\.?|[Dd]r\.?|[Pp]rof\.?)[A-Z][a-zA-Z'\u00C0-\u00FF]+)*/g,
      label: '[OPERATORE]', type: 'name' },
    { pattern: /\bD\.\s+[A-Z][a-zA-Z\u00C0-\u00FF]{2,}(?:\s+[A-Z][a-zA-Z\u00C0-\u00FF]+)+/g,
      label: '[OPERATORE]', type: 'name' },
    { pattern: /firm(?:ata?|ato)(?:\s+digitalmente)?\s+da:?\s+[A-Z][a-zA-Z\u00C0-\u00FF]+(?:\s+[A-Z][a-zA-Z\u00C0-\u00FF]+)+/gi,
      label: 'firmata da [OPERATORE]', type: 'name' },
    { pattern: /Lettera\s+di\s+dimissione\s+firm(?:ata?|ato)[^\n]*/gi,
      label: '[FIRMA_DIMISSIONE]', type: 'boiler' },
    { pattern: /\d{5}\s+Padova\s*-\s*Ospedale[^\n]*/gi,
      label: '[INTESTAZIONE_AZ]', type: 'boiler' },
    { pattern: /Data\s+nota\s+Nota\s+P\s+OperatoreData\s+ins\.?/gi,
      label: '[INTESTAZIONE_COLONNE]', type: 'boiler' },
    { pattern: /049\.821\.\d{4}(?:[^\n]*Prenotazioni[^\n]*)?/g,
      label: '[TELEFONO_AZ]', type: 'boiler' },
    { pattern: /^Pag\.\s+\d{3}$/gim,
      label: '[PAGINA_LAB]', type: 'boiler' },
    { pattern: /\d+Page\s+\d+\s+of\s+\d+/gi,
      label: '[PAGINA]', type: 'boiler' },
    { pattern: /FINE\s+DOCUMENTO\s*[-–]\s*PAGINA\s+FINALE/gi,
      label: '[FINE_DOCUMENTO]', type: 'boiler' },
    // ALLCAPS surname + CamelCase firstname on its own line (e.g. "MAZZOCCA Luca" in lab headers)
    { pattern: /^(?!(?:STROKE|PRONTO|CLINICA|UNITA|REPARTO|ESAME|ANAMNESI|DECORSO|TERAPIA|MOTIVO|AZIENDA|REGIONE|DIPARTIMENTO|AMBULATORIO|INFERMIERE|MEDICO|TECNICO|PAZIENTE|DOTT|PROF)\b)[A-Z]{2,}\s+[A-Z][a-z\u00C0-\u00FF]{2,}\s*$/gm,
      label: '[PAZIENTE]', type: 'name' },
    // Cap pair before date — exclude clinical locations and exam labels
    { pattern: /\b(?!(?:Stroke\s+Unit|Pronto\s+Soccorso|Clinica\s+Neurologica|Esame\s+Neurologico|Esame\s+Obiettivo|Esame\s+Obbiettivo|Anamnesi\s+Patologica|Anamnesi\s+Fisiologica|Decorso\s+Clinico|Reparto\s+Neurologia|Unita\s+Stroke|Pronto\s+Soc)\b)[A-Z][a-z\u00C0-\u00FF]+\s+[A-Z][a-z\u00C0-\u00FF]+(?=\s+\(\d{2}\/\d{2}\/\d{4})/g,
      label: '[OPERATORE]', type: 'name' },
    { pattern: /\[NOME\]\s*\(\d{2}\/\d{2}\/\d{4}\s+[\d:]+\)/g,
      label: '[OPERATORE_FARMACO]', type: 'boiler' },
    { pattern: /^\(S\)\s+[A-Z][A-Z\s\d\.\*]+$/gim,
      label: '[PRESCRIZIONE_FARMACO]', type: 'boiler' },
    { pattern: /(?:anni\s+\d{1,3}|Sesso:\s*[MF]|C\.F\.:|nato\s+il)[^\n]{0,15}(\d{2}[\/\.]\d{2}[\/\.]\d{2,4})/gi,
      label: '[DATI_PAZIENTE]', type: 'date' },
    { pattern: /Frequenza\s+campionamento[^\n]*/gi,
      label: '[METADATI_ECG]', type: 'boiler' },
    { pattern: /Device:\s*[A-Za-z]+[^\n]*/gi,
      label: '[METADATI_ECG]', type: 'boiler' },
    { pattern: /\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/g,
      label: '[CODICE_FISCALE]', type: 'id' },
    { pattern: /C\.?F\.?\s*:\s*[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]/g,
      label: '[CODICE_FISCALE]', type: 'id' },
    { pattern: /\([A-Z][a-z\u00C0-\u00FF]+(?:\s+[A-Z][a-z\u00C0-\u00FF]+){1,2}\)/g,
      label: '([OPERATORE])', type: 'name' },
    // Name after date in lab stamp headers
    // Name after date in lab stamp headers — checked against TRAILING_SKIP at runtime
    { pattern: /(?<=\d{2}\/\d{2}\/\d{4}\s+)([A-Z][a-z\u00C0-\u00FF]{3,})(?=\s*$)/gm,
      replace: function(m, name) {
        return TRAILING_SKIP.has(name.toLowerCase()) ? m : '[NOME]';
      },
      label: '[NOME]', type: 'name' },
    // ── Registro Operatorio patterns ──────────────────────────────
    // DOTT./DOTT.SSA NOME COGNOME with comma-separated multiple names
    { pattern: /DOTT\.?\s*(?:SSA\.?)?\s+[A-Z][A-Z\u00C0-\u00FF]+\s+[A-Z][A-Z\u00C0-\u00FF]+/gi,
      label: '[OPERATORE]', type: 'name' },
    // Names after surgical roles (Chirurgo, Anestesisti, Infermieri)
    { pattern: /(?:Chirurgh?[oi]|Anestesist[aei]|Infermier[aei]\s+(?:di\s+)?(?:sala|Anestesia))\s+([A-Z][A-Z\u00C0-\u00FF\s']+)$/gim,
      replace: function(m, name) { return m.replace(name, '[OPERATORE]'); },
      label: '[OPERATORE]', type: 'name' },
    // Standalone CamelCase name pair or triple on its own line (e.g. "Francesca Chiapperini", "Lo Menzo Sara")
    { pattern: /^([A-Z][a-z\u00C0-\u00FF]+)((?:\s+[A-Z][a-z\u00C0-\u00FF]+){1,2})\s*$/gm,
      replace: function(m, w1, rest) {
        // Check each word against TRAILING_SKIP
        const words = (w1 + rest).trim().split(/\s+/);
        if (shouldSkipName(words)) return m;
        return '[OPERATORE]';
      },
      label: '[OPERATORE]', type: 'name' },
    // Utente(ID): pattern
    { pattern: /Utente\([A-Z0-9]+\)\s*:/gi,
      label: '[ID_OPERATORE]:', type: 'id' },
    // Cognome: NOME Nome: NOME pattern in registro
    { pattern: /Cognome\s*:\s*[A-Z][A-Za-z\u00C0-\u00FF]+/gi,
      label: 'Cognome: [PAZIENTE]', type: 'name' },
    { pattern: /(?<=Cognome\s*:\s*\[PAZIENTE\]\s*)Nome\s*:\s*[A-Z][A-Za-z\u00C0-\u00FF]+/gi,
      label: 'Nome: [PAZIENTE]', type: 'name' },
    // ── MFS / Equipe / signature lists ──────────────────────────────
    // MFS followed by comma-separated names (e.g. "MFS Mietto, Tarchiari")
    { pattern: /MFS\s+[A-Z][a-zA-Z\u00C0-\u00FF']+(?:(?:\s*,\s*|\s+e\s+|\s+)[A-Z][a-zA-Z\u00C0-\u00FF']+)*/g,
      label: 'MFS [OPERATORE]', type: 'name' },
    // MFS with initial.surname list (e.g. "MFS I. Shevchuck, L.Fontanel")
    { pattern: /MFS\s+(?:[A-Z]\.?\s*[A-Z][a-zA-Z\u00C0-\u00FF']+(?:\s*,\s*)?)+/g,
      label: 'MFS [OPERATORE]', type: 'name' },
    // Equipe: followed by names on same or next line
    { pattern: /Equipe\s*:\s*[A-Z][a-zA-Z\u00C0-\u00FF']+(?:\s+[A-Z][a-zA-Z\u00C0-\u00FF']+)*/g,
      label: 'Equipe: [OPERATORE]', type: 'name' },
    // Dr. ssa / Dr.ssa with space before ssa (e.g. "Dr. ssa M. Zandonà")
    { pattern: /[Dd]r\.?\s+ssa\.?\s+(?:[A-Z]\.\s*)?[A-Z][a-zA-Z\u00C0-\u00FF']+/g,
      label: '[OPERATORE]', type: 'name' },
    // CamelCase name concatenated with 2-letter initials (e.g. "ChiapperiniFC", "FranchiniBF")
    { pattern: /[A-Z][a-z\u00C0-\u00FF]{3,}[A-Z]{2,3}(?=\s|$)/gm,
      label: '[OPERATORE]', type: 'name' },
    // CamelCase name pair after colon at end of line (e.g. "...: Tiziana Bettella")
    { pattern: /(?<=:\s*)([A-Z][a-z\u00C0-\u00FF]{2,})\s+([A-Z][a-z\u00C0-\u00FF]{2,})(?=\s*$)/gm,
      replace: function(m, w1, w2) {
        if (shouldSkipName([w1, w2])) return m;
        return '[OPERATORE]';
      },
      label: '[OPERATORE]', type: 'name' },
    // ALLCAPS NOME COGNOME followed by colon (e.g. "FORNASIER TOMMASO:")
    { pattern: /(?:^|\n)\s*([A-Z]{2,})\s+([A-Z]{2,})\s*:/gm,
      replace: function(m, w1, w2) {
        if (shouldSkipName([w1, w2])) return m;
        return '[OPERATORE]:';
      },
      label: '[OPERATORE]:', type: 'name' },
    // ── Cleanup pass: residual names adjacent to placeholders ──────
    // These run AFTER all other patterns have created [OPERATORE]/[PAZIENTE] placeholders
    // [OPERATORE] followed by Initial. Surname (e.g. "[OPERATORE] G. Bellon")
    { pattern: /(?<=\[OPERATORE\]\s*)([A-Z]\.?\s+[A-Z][a-z\u00C0-\u00FF]{2,})/g,
      label: '[OPERATORE]', type: 'name' },
    // Role abbreviations (CTSRM, TSRM, TdR, IP, OSS, etc.) + Initial. Surname
    { pattern: /\b(?:CTSRM|TSRM|TdR|IP|OSS|AFD|CPS)\s+(?:[A-Z]\.?\s+)?[A-Z][a-z\u00C0-\u00FF]{2,}/g,
      label: '[OPERATORE]', type: 'name' },
    // ALLCAPS single surname after surgical role labels
    // "INTERVENTO:  COGO" or "1° OPERATORE  ROSSI" or "Chirurgo:  BIANCHI"
    { pattern: /(?:INTERVENTO|OPERATORE|CHIRURGO|ANESTESISTA|FERRISTA|STRUMENTISTA|INFERMIERE)\s*:?\s+([A-Z]{3,})(?=\s{2,}|\s+[A-Z][a-z]|\s*$)/gm,
      replace: function(m, name) {
        if (TRAILING_SKIP.has(name.toLowerCase())) return m;
        return m.replace(name, '[OPERATORE]');
      },
      label: '[OPERATORE]', type: 'name' },
    // "1° COGNOME" / "2° COGNOME" — numbered operator in surgical report
    { pattern: /[12345]°\s+([A-Z]{3,})(?=\s|$)/gm,
      replace: function(m, name) {
        if (TRAILING_SKIP.has(name.toLowerCase())) return m;
        return m.replace(name, '[OPERATORE]');
      },
      label: '[OPERATORE]', type: 'name' },
    // Trailing first name after placeholder — contextual: only match if followed by
    // EOL, closing bracket, or another placeholder (= signature context).
    // Skip if followed by lowercase word, colon, number, etc. (= clinical context).
    { pattern: /(?<=\[(?:OPERATORE|PAZIENTE)\][^\S\n]+)([A-Z][a-z\u00C0-\u00FF]{3,})([^\n]*)/g,
      replace: function(m, name, afterCtx) {
        // Always skip if word is in TRAILING_SKIP (safety net)
        if (TRAILING_SKIP.has(name.toLowerCase())) return m;
        // Contextual check: what follows the candidate word?
        const s = afterCtx.trimStart();
        const isNameCtx =
          s === '' ||                                    // end of line
          /^[)\]]/.test(s) ||                            // closing bracket
          /^\[(?:OPERATORE|PAZIENTE|NOME)\]/.test(s) ||  // another placeholder
          /^,\s*(?:$|\[)/.test(s);                       // comma then EOL or placeholder
        if (!isNameCtx) return m;  // clinical context → don't replace
        return '[NOME]' + afterCtx;
      },
      label: '[NOME]', type: 'name' },
    // Leading first name before placeholder (e.g. "19:46Francesca [OPERATORE]")
    { pattern: /([A-Z][a-z\u00C0-\u00FF]{3,})\s+\[(?:OPERATORE|NOME)\]/g,
      replace: function(m, name) {
        return TRAILING_SKIP.has(name.toLowerCase()) ? m : '[OPERATORE] [OPERATORE]';
      },
      label: '[OPERATORE]', type: 'name' },
  ],

  nameDict_fallback: [],

  boilerplateLinePatterns: [
    /^Regione\s+(?:del\s+)?[Vv]eneto\s*$/,
    /^REGIONE\s+(?:DEL\s+)?VENETO\s*$/,
    /^AZIENDA\s+OSPEDALE[^\n]*PADOVA\s*$/i,
    /^Didas?\s+Medicina\s+dei\s+Sistemi\s*$/i,
    /^U\.O\.[SC]\.?[DS]?\.\s+\w[\w\s]*/i,
    /^U\.O\.C\b/i,
    /^U\.O\.S\b/i,
    /^Direttore\s*:?\s*/i,
    /^Dr\.?\s*(?:ssa\s*)?[A-Z][\w\s]+$/,
    /^Prof\.?\s*(?:ssa\s*)?[A-Z][\w\s]+$/,
    /^Dirigenti\s+Medici\s*:/i,
    /^Responsabile\s+(?:Laboratorio\s*)?:?\s*Dr/i,
    /^Coordinatore\s*$/i,
    /^Segreteria\s+(?:interni\s*)?:/i,
    /^Lab\.\s+Neurosonologia\s*:/i,
    /^Radiologia\s+Pediatrica\s*:/i,
    /^Piastra\s+Ambulatoriale\s*$/i,
    /^Dipartimento\s+di\s+Scienze\s+Card/i,
    /^Dip\.\s+Didattico[^\n]*/i,
    /^Servizi\s+di\s+Diagnostica\s+Integrata/i,
    /^PARAMETRI\s+VITALI\s*$/i,
    /^PRESCRIZIONE\s+SOMMINISTRAZIONE\s*$/i,
    /^TERAPIA\s+FARMACOLOGICA\s*$/i,
    /^ALLERGIE\s*$/i,
    /^CONSULENZA\s+SPECIALISTICA\s*$/,
    /^FINE\s+DOCUMENTO\s*$/i,
    /^PAGINA\s+FINALE\s*$/i,
    /^Diario\s+clinico\s*$/i,
    /^L'ORARIO\s+DELLE\s+SOMMINISTRAZIONI[^\n]*/i,
    /^QUELLO\s+PRESCRITTO\s+DAL\s+MEDICO\s*$/i,
    /^Legenda\s+vie\s*:/i,
    /^\(P\)\s+Profilo[^\n]*/i,
    /^per\s+il\s+ricovero\s+\d/i,
    /^Padova,?\s+\d{2}\/\d{2}\/\d{4}\s*$/i,
    /^Alla\s+(?:cortese\s+attenzione|[Cc]ortese\s+[Aa]ttenzione)\s+del\s+Medico\s+Curante\s*$/i,
    /^Egregio\s+[Cc]ollega\s*,?\s*$/i,
    /^I\s+risultati\s+di\s+questo\s+referto[^\n]*/i,
    /^parte\s+del\s+(?:Medico\s+)?[Rr]eportage[^\n]*/i,
    /^\*\*\*\s+Referto\s+Finale\s+\*\*\*/i,
    /^Il\s+[Dd]irettore\s*$/i,
    /^Validato\s+da\s*:/i,
    /^Medico\s*:\s*(?:Prof\.|Dr(?:\.ssa)?)?\s*[A-Z]/i,
    /^T\.S\.R\.M\.\s+/i,
    /^Equipe\s*:\s*$/i,
    // FIX: removed /^Il\s+[Mm]edico\s+[Rr]adiologo\s*$/i — "Il Medico Radiologo" is a valid
    // role label in radiology report Equipe: blocks and should NOT be stripped as boilerplate.
    /^Il\s+[Mm]edico\s+[Ss]trutturato\s+Dott\./i,
    /^MFS\s+Dott\.sse?\s+/i,
    /^Ringraziando\s+per\s+la\s+cortese\s+collaborazione[^\n]*/i,
    /^rimaniamo\s+ad?\s+disposizione[^\n]*/i,
    /^Dott\.?\s*(?:ssa\.?)?\s+[A-Z]\.\s+[A-Z][a-z]+\s*$/,
    /^\(Medici\s+in\s+formazione\s+specialistica\)\s*$/i,
    /^\(Dirigenti\s+medici\)\s*$/i,
    /^Cordiali\s+saluti\s*,?\s*$/i,
    // ── Institutional / address boilerplate ──────────────────────────────
    // City standalone or with date
    /^Padova\s*$/i,
    /^PADOVA\s*$/,
    // Street addresses — Via/Viale/Corso/Piazza + anything, but NOT "Via orale/endovenosa/etc" (drug routes)
    /^Via\s+(?!orale|endovenosa|ev\b|im\b|sc\b|subcut|intramuscol|transdermica|inalatoria|nasale|oftalmica|auricolare|rettale)[A-Z][^\n]{3,}$/i,
    /^Viale\s+[A-Z][^\n]{3,}$/i,
    /^Corso\s+[A-Z][^\n]{3,}$/i,
    /^Piazza\s+[A-Z][^\n]{3,}$/i,
    /^Largo\s+[A-Z][^\n]{3,}$/i,
    /^Vicolo\s+[A-Z][^\n]{3,}$/i,
    // ZIP + city lines (e.g. "35128 PADOVA", "35128 Padova (PD)")
    /^\d{5}\s+[A-Z][A-Za-z\s]+(?:\([A-Z]{2}\))?\s*$/,
    // Phone / fax / email lines
    /^(?:Tel\.?|Telefono|Fax|Tel\/Fax)\s*[:\.\-]?\s*[\d\s\.\-\+\/]+$/i,
    /^(?:Tel\.?|Telefono|Fax)\s*[:\.\-]?\s*0\d[\d\s\.\-]+$/i,
    /^[^\s@]+@[^\s@]+\.[^\s@]+\s*$/,
    // Website
    /^(?:www\.|https?:\/\/)[^\s]+\s*$/i,
    // P.IVA / Codice Fiscale azienda
    /^(?:P\.?\s*IVA|Partita\s+IVA|C\.?F\.?|Cod(?:ice)?\s+Fiscale)\s*[:\-]?\s*[\d\w]+\s*$/i,
    /^C\.?F\.?\s+P\.?\s*IVA\s+\d+\s*$/i,
    // Azienda / Ospedale / Università header lines
    /^Azienda\s+Ospedalier[ao][^\n]*/i,
    /^Azienda\s+Ospedale[^\n]*/i,
    /^Registro\s+Operatorio\s*$/i,
    /^Azienda\s+ULSS[^\n]*/i,
    /^Ospedale\s+[A-Z][^\n]*/i,
    /^Universit[àa]\s+(?:degli\s+Studi\s+)?di\s+[A-Z][^\n]*/i,
    /^Policlinico\s+[A-Z][^\n]*/i,
    // Specific Padova hospital header fragments
    /^Azienda\s+Ospedale\s*-\s*Universit[àa]\s+Padova\s*$/i,
    /^Via\s+Giustiniani[^\n]*/i,
    /^Via\s+A(?:ndrea)?\.\s*Giustiniani[^\n]*/i,
    // Generic institutional suffix lines
    /^U\.O\.(?:C\.?|S\.?|D\.?)?\s*(?:di\s+)?[A-Z][^\n]{2,}$/i,
    /^S\.C\.\s+[A-Z][^\n]*/i,
    /^S\.S\.\s+[A-Z][^\n]*/i,
    /^Struttura\s+(?:Complessa|Semplice)\s+[A-Z][^\n]*/i,
    /^Dipartimento\s+[A-Z][^\n]*/i,
    /^Dipartimento\s+di\s+[A-Z][^\n]*/i,
    /^Dip\.\s+[A-Z][^\n]*/i,
    // ── Firma digitale / conservazione / metadati referto (riduzione token) ──
    // Intestazione di pagina: "PAGINA 1 - RICOVERO 12345678" (il nome paziente che segue
    // viene gestito separatamente dall'estrazione del frontespizio)
    /^PAGINA\s+\d+\s*[-–]\s*RICOVERO\s+\d+[^\n]*$/i,
    /^\[?PAGINA\]?\s*[-–]\s*RICOVERO\s+[^\n]*$/i,
    // Disclaimer di firma digitale e conservazione sostitutiva
    /^Referto\s+firmat[oa]\s+digitalmente[^\n]*/i,
    // "Rappresentazione di un referto firmato elettronicamente, conservato..."
    /^Rappresentazione\s+di\s+un\s+referto\s+firmato[^\n]*$/i,
    /^(?:Copia|Stampa)\s+di\s+(?:un\s+)?(?:documento|referto)\s+firmat[oa][^\n]*$/i,
    // "Referto firmato/firmata da [OPERATORE] DATA ORA" (firma con data, dopo anonimizzazione nome)
    /^Referto\s+firmat[oa]\s+da\s+[^\n]*\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4}[^\n]*$/i,
    /^(?:Documento|Referto)\s+(?:informatico\s+)?(?:firmat[oa]|sottoscritto)\s+(?:digitalmente|elettronicamente)[^\n]*/i,
    /^(?:Il\s+presente\s+)?(?:documento|referto)\s+(?:è\s+)?conservat[oa][^\n]*/i,
    /^Conservazione\s+(?:sostitutiva|a\s+norma)[^\n]*/i,
    /^Versione\s+\d+\s*,?\s*(?:Conservazione)?[^\n]*$/i,
    /^vigente\.\s*$/i,
    // Riga di firma finale: "Firmato il: DATA ORA da NOME COGNOME" / "Firmato da NOME il DATA"
    /^(?:vigente\.\s*)?Firmat[oa]\s+(?:il)?\s*:?\s*\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4}[^\n]*\bda\b[^\n]*$/i,
    /^(?:vigente\.\s*)?Firmat[oa]\s+da\s+[A-Z][^\n]*\bil\b\s*:?\s*\d{1,2}[\/\.-]\d{1,2}[^\n]*$/i,
    // Telefono/fax con prefisso "T." o "T.+" (formato intestazione AOPD)
    /^T\.?\s*\+?\s*39\s+0?\d[\d\s\.\-]+$/i,
    /^T\.?\s*\+?\s*\d[\d\s\.\-]{6,}$/,
    /^(?:Tel|Fax|T|F)\.?\s*[:\.\-]?\s*\+?\s*\d{2,4}[\d\s\.\-\/]{5,}$/i,
    // Cod.Fisc./P.IVA aziendale su riga (con numero sulla stessa riga)
    /^Cod\.?\s*Fisc\.?\s*\/?\s*P\.?\s*IVA\s+\d[\d\s]*$/i,
    /^P\.?\s*IVA\s*\/?\s*Cod\.?\s*Fisc\.?\s+\d[\d\s]*$/i,
    // Numero referto / protocollo: "Referto: 131038253-1", "Protocollo: ..."
    /^Referto\s*:\s*\d[\d\-\/]*\s*$/i,
    /^(?:Protocollo|Prot\.?|N\.?\s*Referto|Nr\.?\s*Referto|ID\s+Referto)\s*[:\.]?\s*[\d\-\/]+\s*$/i,
    // Dominio web senza www/http (es. "Aopd.veneto.it")
    /^[A-Za-z][A-Za-z0-9\-]*(?:\.[A-Za-z0-9\-]+)+\.(?:it|com|org|net|eu|gov\.it)\s*$/i,
    // Riga "e-mail [qualcosa]" o "PEC: ..."
    /^(?:e-?mail|posta\s+elettronica|PEC)\s*[:\.]?\s*[^\n]*$/i,
    // ── Righe amministrative aggiuntive (rimozione aggressiva) ──
    // Codici/numeri amministrativi: Nosografico, SDO, Episodio, Accettazione, Pratica, Matricola
    /^(?:Nr\.?|N\.?|Numero|Cod(?:ice)?\.?)\s*(?:Nosografic[oa]|SDO|Episodi[oa]|Accettazione|Pratica|Matricola|Cartella|Paziente|Assistito)\s*[:\.]?\s*[\w\d\-\/]+\s*$/i,
    /^(?:Nosografico|SDO|Episodio|Accettazione|Matricola|N\.?\s*Cartella)\s*[:\.]?\s*[\w\d\-\/]+\s*$/i,
    // Tessera sanitaria / STP / ENI / numeri tessera
    /^(?:Tessera\s+Sanitaria|TEAM|STP|ENI)\s*[:\.]?\s*[\w\d\-\/]+\s*$/i,
    // Riga "Stampato/Prodotto/Generato il ... da ..." (metadati di stampa)
    /^(?:Stampat[oa]|Prodott[oa]|Generat[oa]|Estratt[oa])\s+(?:il\s+|in\s+data\s+)?[^\n]*$/i,
    /^(?:Data\s+e\s+ora\s+(?:di\s+)?stampa|Data\/ora\s+stampa)\s*[:\.]?\s*[^\n]*$/i,
    // Riga di solo numero di pagina o "Pagina N" / "Pag. N di M"
    /^Pag(?:ina)?\.?\s*\d+(?:\s*(?:di|\/)\s*\d+)?\s*$/i,
    /^\d+\s*\/\s*\d+\s*$/,
    // Codice a barre / identificativi alfanumerici lunghi isolati
    /^[A-Z0-9]{10,}\s*$/,
    /^Codice\s+(?:a\s+)?barr[ae]\s*[:\.]?\s*[^\n]*$/i,
    // Orari di apertura / ricevimento / segreteria
    /^(?:Orari[oe]\s+(?:di\s+)?(?:apertura|ricevimento|visita)|Ricevimento)\s*[:\.]?\s*[^\n]*$/i,
    // Riga "Distretto / ASL / AULSS / Regione di residenza" amministrativa
    /^(?:Distretto|ASL|AULSS|ULSS|Azienda\s+Sanitaria)\s+(?:di\s+)?[^\n]*$/i,
    // Disclaimer privacy / trattamento dati (GDPR)
    /^(?:Informativa\s+(?:sulla\s+)?privacy|Trattamento\s+dei\s+dati|Ai\s+sensi\s+(?:dell'art|del\s+(?:Reg|D\.?Lgs)))[^\n]*$/i,
    /^(?:I\s+dati\s+(?:personali\s+)?(?:sono|saranno|verranno)\s+trattati)[^\n]*$/i,
    // Riga di disclaimer "documento privo di valore" o "non sostituisce"
    /^(?:Il\s+presente\s+documento|Questo\s+documento|Tale\s+documento)\s+[^\n]*(?:valore\s+legale|originale|sostituisce|priv[oa])[^\n]*$/i,
    // Riga "Allegati: ..." amministrativa
    /^Allegati?\s*[:\.]?\s*\d+\s*$/i,
    // ── Referti strumentali (ECG/EEG): righe amministrative residue ──
    // Numero referto con suffisso -ADT/-RX ecc., eventualmente seguito da tag
    /^Referto\s*:\s*[\d\-]+(?:-[A-Z]{2,4})\b[^\n]*$/i,
    /^N\.?\s*Richiesta\s*:\s*[\d\-]+(?:-[A-Z]{2,4})?\s*$/i,
    /^Versione\s+Referto\s*:?\s*\d*\s*$/i,
    // "CC: N" / "CC: S" (flag amministrativo copia conoscenza)
    /^CC\s*:\s*[A-Z]\s*$/i,
    // "ID Persona:" / "ID Paziente:" seguito da numeri sparsi
    /^ID\s+(?:Persona|Paziente|Interno)\s*:?\s*[\d\s]*$/i,
    /^\[ID_[A-Z]+\]\s*[\d\s]*$/,
    // Numero pratica isolato seguito da "Data Esame"
    /^\d{6,}\s+Data\s+Esame\s*:?[^\n]*$/i,
    // Riga "Refertato/Firmato da NOME, Data: ... Ora: ..." (testo grezzo pre-anon)
    /^Refertat[oa]\s+da\s*:\s*[^\n]*\bData\s*:[^\n]*Ora\s*:[^\n]*$/i,
    /^(?:Dott\.?(?:ssa)?\s+)?[A-Z][a-zà-ü]+\s+[A-Z][a-zà-ü]+\s+Firmat[oa]\s+il\s*:[^\n]*$/i,
    // Sesso scritto per esteso su riga isolata
    /^(?:Femmina|Maschio)\s*$/i,
    // Etichette demografiche isolate (residuo layout a colonne PDF)
    /^(?:Et[àa]|Nato\s+il|Nata\s+il|Nome|Cognome|Sesso|Nominativo|Anni)\s*:?\s*$/i,
    // "COGNOME NOME Età:" — riga col nome paziente seguito da etichetta (layout colonne)
    /^[A-ZÀÈÉÌÒÙ][A-Za-zÀ-ü'\-]+\s+[A-ZÀÈÉÌÒÙ][A-Za-zÀ-ü'\-]+\s+(?:Et[àa]|Anni)\s*:?\s*$/,
    // Singole derivazioni ECG su riga isolata (I, II, III, aVR, aVL, aVF, V1–V6)
    /^(?:I{1,3}|aV[RLF]|V[1-6])\s*$/,
    // Device / frequenza campionamento / provenienza tecnica
    /^Frequenza\s+campionamento\s*:[^\n]*$/i,
    /^Device\s*:[^\n]*$/i,
    /^[^\n]*\bDevice\s*:\s*[A-Z][^\n]*$/i,
    /^Provenienza\s+(?:Az\.?\s*Osp\.?|Azienda)[^\n]*$/i,
    // ── Frontespizio infermieristico / rete sociale (dati di terzi, poco utili) ──
    /^FRONTESPIZIO\s+INFERMIERISTICO\s*$/i,
    /^Rete\s+sociale\s*$/i,
    /^Cognome\/Nome\s+Relazione\s+Tipo\s+Ruolo[^\n]*$/i,   // intestazione tabella contatti
    /^Accompagnat[oa]\s*:[^\n]*$/i,
    /^Vive\s+(?:solo|presso|con)\s*:[^\n]*$/i,
    /^(?:Care\s*giver|Caregiver|Persona\s+di\s+riferimento|Riferimento\s+familiare)\s*:[^\n]*$/i,
    /^(?:Stato\s+civile|Scolarit[àa]|Professione|Occupazione|Condizione\s+abitativa)\s*:[^\n]*$/i,
    // Righe della tabella rete sociale: "cognome nome  Relazione  Tipo  Ruolo  [tel]"
    // Relazione = Padre/Madre/Figlio/Figlia/Coniuge/Fratello/Sorella/Marito/Moglie/Tutore...
    /^[a-zà-ü'\-]+\s+[a-zà-ü'\-]+\s+(?:Padre|Madre|Figli[oa]|Coniuge|Fratell[oa]|Sorella|Marit[oa]|Mogli[e]|Convivente|Tutore|Nipote|Zi[oa]|Cugin[oa]|Genitore|Parente|Amic[oa]|Vicin[oa]|Assistente)\b[^\n]*$/i,
    // Stessa riga ma con nome in maiuscolo
    /^[A-ZÀ-Ü][a-zà-ü'\-]+\s+[A-ZÀ-Ü][a-zà-ü'\-]+\s+(?:Padre|Madre|Figli[oa]|Coniuge|Fratell[oa]|Sorella|Marit[oa]|Mogli[e]|Convivente|Tutore|Nipote|Genitore|Parente)\b[^\n]*$/,
    // Riga di solo "principale" / "secondario" (residuo colonna Ruolo)
    /^(?:principale|secondari[oa]|riferimento)\s*$/i,
    // Riga anagrafica del frontespizio (testo grezzo): nome + "Paziente:" + segni inequivocabili
    // (Nato il / RIC_AO / Nosologico). NON scatta su frasi cliniche con "Paziente:" generico.
    /^[A-ZÀ-Ü][A-Za-zÀ-ü'\- ]*Paziente\s*:\s*(?=.*(?:Nato\/?a?\s+il|RIC[_\s]AO|Nosologic|Nosografic))[^\n]*$/i,
    /^\[(?:PAZIENTE|NOME)\]\s*Paziente\s*:\s*(?=.*(?:Nato\/?a?\s+il|DATA_NASCITA|ID_RICOVERO|NOSOLOGICO))[^\n]*$/i,
    // Etichette anagrafiche del frontespizio infermieristico
    /^MMG\/PLS\s*:[^\n]*$/i,
    /^(?:Nosologic[oa]|Nosografic[oa])\s*:[^\n]*$/i,
    /^(?:Indirizzo\s+(?:domicilio|residenza)|Domicilio|Residenza)\s*:[^\n]*$/i,
    /^Telefono\s*\d*\s*:[^\n]*$/i,
    /^Data\s+di\s+ingresso\s*:[^\n]*$/i,
    /^SSN\s*:\s*\d+\s*$/i,
    // Riga "Codice fiscale: XXX SSN: YYY" del frontespizio (solo identificatori)
    /^Codice\s+fiscale\s*:\s*[A-Z0-9]{6,}\s*(?:SSN\s*:\s*\d+)?\s*$/i,
    /^Direttore\s*:\s*(?:Prof|Dott)[^\n]*$/i,
  ],
}

class BKTree {
  constructor(){this.root=null;}
  add(word){
    if(!this.root){this.root={word,children:{}};return;}
    let node=this.root;
    while(true){
      const d=levenshtein(word,node.word);
      if(d===0)return;
      if(node.children[d]){node=node.children[d];}
      else{node.children[d]={word,children:{}};return;}
    }
  }
  search(query,maxDist){
    if(!this.root)return[];
    const results=[],stack=[this.root];
    while(stack.length){
      const node=stack.pop();
      const d=levenshtein(query,node.word);
      if(d<=maxDist)results.push({word:node.word,dist:d});
      for(let k=d-maxDist;k<=d+maxDist;k++)
        if(k>0&&node.children[k])stack.push(node.children[k]);
    }
    return results;
  }
}

function applyRegex(text) {
  const reps = [];
  let result = text;
  const rules = [...ANON_CONFIG.regexRules];
  for (const rule of rules) {
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    if (re.global) re.lastIndex = 0;
    if (typeof rule.replace === 'function') {
      result = result.replace(re, (...args) => {
        const fullMatch = args[0].trim();
        const replaced = rule.replace(...args);
        // Only register in reps if the replace actually changed the text
        if (replaced !== args[0] && fullMatch.length > 1 && !reps.find(r => r.orig === fullMatch))
          reps.push({ orig: fullMatch, repl: rule.label,
            type: rule.type === 'id'   ? 'ID/Codice'
                : rule.type === 'date' ? 'Data sensibile'
                : rule.type === 'name' ? 'Nome'
                : 'Boilerplate' });
        return replaced;
      });
    } else {
      result = result.replace(re, (match) => {
        const m = match.trim();
        if (m.length > 1 && !reps.find(r => r.orig === m))
          reps.push({ orig: m, repl: rule.label,
            type: rule.type === 'id'   ? 'ID/Codice'
                : rule.type === 'date' ? 'Data sensibile'
                : rule.type === 'name' ? 'Nome'
                : 'Boilerplate' });
        return rule.label;
      });
    }
  }
  return { text: result, reps };
}

function freezeLabLines(text) {
  const placeholders = [];
  let idx = 0;
  let frozen = text;

  frozen = frozen.replace(/^[ \t]*[PBUCSE]-[A-Z].*/gm, (match) => {
    const key = '\x00LAB' + (idx++) + '\x00';
    placeholders.push({ key, value: match });
    return key;
  });

  frozen = frozen.replace(/^(?:[A-Z] ){4,}[A-Z]\s*$/gm, (match) => {
    const key = '\x00LAB' + (idx++) + '\x00';
    placeholders.push({ key, value: match });
    return key;
  });

  frozen = frozen.replace(/^Costituente\s+Risultato\s+Unit[^\n]*/gm, (match) => {
    const key = '\x00LAB' + (idx++) + '\x00';
    placeholders.push({ key, value: match });
    return key;
  });

  frozen = frozen.replace(/^[ \t]*[A-Z][A-Z\s\-\/\(\)]{3,}\*?\s+[\d,]+\s+\S+.*$/gm, (match) => {
    if (/\d/.test(match)) {
      const key = '\x00LAB' + (idx++) + '\x00';
      placeholders.push({ key, value: match });
      return key;
    }
    return match;
  });

  (function() {
    const lines2 = frozen.split('\n');
    const labZone = new Array(lines2.length).fill(false);
    const isAnalyte = (l) => /^[PBUSE]-[A-Z]/.test(l.trim()) || /^\x00LAB/.test(l.trim());

    for (let i = 0; i < lines2.length; i++) {
      if (isAnalyte(lines2[i])) {
        for (let j = Math.max(0,i-8); j < Math.min(lines2.length,i+8); j++) labZone[j] = true;
      }
    }
    let inBlock = false;
    for (let i = 0; i < lines2.length; i++) {
      if (/^Al Medico Curante\s*:/m.test(lines2[i]) || /^##\s+ESAMI DI LABORATORIO/.test(lines2[i])) inBlock = true;
      if (inBlock) {
        labZone[i] = true;
        if (/^_{10,}/.test(lines2[i]) || /^Copia di documento/.test(lines2[i])) inBlock = false;
      }
    }
    frozen = lines2.map((line, i) => {
      if (!labZone[i]) return line;
      const t = line.trim();
      if (t.length > 3 && /^[A-Z][A-Z\s\-\/\(\)']{3,}$/.test(t)) {
        const key = '\x00LAB' + (idx++) + '\x00';
        placeholders.push({ key, value: line });
        return key;
      }
      return line;
    }).join('\n');
  })();

  const restore = (s) => {
    let out = s;
    for (const { key, value } of placeholders) {
      out = out.split(key).join(value);
    }
    return out;
  };

  return { frozen, restore };
}

// Termini clinici/strutturali che NON vanno trattati come nomi (falsi positivi anonimizzazione).
const TRAILING_SKIP = new Set([
  // Preposizioni / articoli
  'alla','alle','allo','agli','della','delle','dello','degli',
  'nella','nelle','nello','negli','sulla','sulle','sullo','sugli',
  'dalla','dalle','dallo','dagli',
  // Header di sezione clinica / parole cliniche comuni
  'fisico','obiettivo','generale','neurologico','neurologica',
  'patologica','remota','prossima','fisiologica','familiare',
  'clinico','diagnostico','intervento','motivo','esame','esami',
  'nota','noto','noti','note','verso','decorso','durante',
  'anamnesi','terapia','allergie','allergia','paziente','pazienti',
  'stampa','stampato','rappresentazione','numero','numeri',
  'ingresso','uscita','reparto','reparti','ricovero','dimissione',
  'medico','medici','clinica','cliniche','diagnosi',
  // Termini clinici che sembrano nomi
  'lieve','paresi','plegia','grave','segni','respiro','vigile',
  'presenza','stazionario','stazionaria','prosegue','presenta',
  'presentano','somministrata','somministrato','rilevati','rilevato',
  'monitorata','monitorato','posturato','posturata','diuresi',
  'apiretico','apiretica','addome','obiettività',
  'esiti','resto','presso','previo','classe','giorno',
  'nessuna','nessuno','sostanzialmente','attualmente',
  'corretta','corretto','integra','integro','valida','valido',
  'spontanea','spontaneo','continua','continuo','libera','libero',
  'profonda','profondo','precedente','precedenti',
  'risposta','procedura','osservazioni','condizioni',
  'quesito','multifibre','sostituto',
  // Prodotti nutrizionali / farmaci brand
  'nutrison','peptamen','isolyte','ensure','fresubin','cubitan',
  'fortimel','prosure','abound','resource','glucerna',
  // Nomi stranieri che compaiono in contesti clinici
  'mercedes',
  // Parole strutturali del documento
  'data','tipo','pagina','page','fine','inizio','sezione',
  // Header sezione lab/radiologia (per pattern ALLCAPS)
  'stroke','pronto','soccorso','azienda','regione',
  'profilo','urinario','formula','conteggio','microscopia','metaboliti',
  'ematologia','costituenti','marcatori','coagulazione',
  // Aggettivi clinici dopo i due punti
  'ridotto','ridotta','modesto','modesta','discreto','discretamente',
  'sottile','sottili','crescita','alcuni','alcune','comparsa',
  'bradicardia','reperti','screening','positivo','negativo',
  // Header di sezione / termini strutturali (falsi positivi ALLCAPS)
  'emorragia','cerebrale','intraparenchimale','cranio','encefalo',
  'emisoma','progetto','riabilitativo','indagine','frontespizio',
  'infermieristico','neuro','energy','medica','batteriologica',
  'sieroimmunologica','descrizione','multifibre',
]);

// Preposizioni di cognomi composti italiani: in una coppia CamelCase, se l'altra parola
// NON è in TRAILING_SKIP, trattala come nome (es. "Alice Dalle" → nome). Blocca
// l'anonimizzazione solo se TUTTE le parole non-preposizione sono in TRAILING_SKIP.
const SURNAME_PREPS = new Set([
  'dal','dalla','dalle','dallo','del','della','delle','dello',
  'dei','degli','di','de','la','lo','li','le',
]);

function shouldSkipName(words) {
  // words: array of strings from a matched CamelCase group
  // Returns true if this should NOT be treated as a name
  const nonPrep = words.filter(w => !SURNAME_PREPS.has(w.toLowerCase()));
  if (nonPrep.length === 0) return true; // all prepositions → skip
  // If ANY non-preposition word is in TRAILING_SKIP → skip (clinical term)
  return nonPrep.some(w => TRAILING_SKIP.has(w.toLowerCase()));
}

// Soglia di distanza di edit per il fuzzy matching dei nomi: parole corte → match esatto.
function fuzzyThreshold(word){return word.length<=5?1:2;}
function levenshtein(a,b) {
  const m=a.length,n=b.length;
  if(Math.abs(m-n)>2)return 99;
  if(m===0)return n; if(n===0)return m;
  let prev=Array.from({length:n+1},(_,i)=>i);
  for(let i=1;i<=m;i++){
    const curr=[i];
    for(let j=1;j<=n;j++){
      const cost=a[i-1]===b[j-1]?0:1;
      curr[j]=Math.min(curr[j-1]+1,prev[j]+1,prev[j-1]+cost);
    }
    prev=curr;
  }
  return prev[n];
}

function isFuzzyName(token,bkTree,maxDist){
  if(token.length<3)return false;
  return bkTree.search(token.toLowerCase(),maxDist).length>0;
}

function applyNameDict(text) {
  if(!NAMES_DB.loaded)return{text,reps:[]};
  const reps=[];
  let result=text;
  const addRep=(orig,type)=>{if(!reps.find(r=>r.orig===orig))reps.push({orig,repl:'[NOME]',type});};

  const exactSurnameSet=new Set(NAMES_DB.surnames);
  const exactFirstSet=new Set(NAMES_DB.firstNames);

  function tokenise(str){
    const tokens=[];
    const re=/\S+/g; let m;
    while((m=re.exec(str))!==null){
      const t=m[0];
      const isCapWord=/^[A-ZÀÈÉÌÒÙ][a-zàèéìòùA-ZÀÈÉÌÒÙ'-]+$/.test(t)||/^[A-ZÀÈÉÌÒÙ]{2,}$/.test(t);
      tokens.push({text:t,start:m.index,end:m.index+t.length,isCapWord});
    }
    return tokens;
  }

  function applySpans(str,spans,type){
    spans.sort((a,b)=>a.start-b.start);
    let out='',prev=0;
    for(const s of spans){out+=str.slice(prev,s.start)+'[NOME]';addRep(s.orig,type);prev=s.end;}
    return out+str.slice(prev);
  }

  // Pass 1: exact pairs
  const pass1Spans=[];
  const tokens=tokenise(result);
  for(let i=0;i<tokens.length-1;i++){
    const t1=tokens[i],t2=tokens[i+1];
    if(!t1.isCapWord||!t2.isCapWord)continue;
    const w1=t1.text.replace(/[.,;:!?]$/,'').toLowerCase();
    const w2=t2.text.replace(/[.,;:!?]$/,'').toLowerCase();
    const isPair=(exactSurnameSet.has(w1)&&exactFirstSet.has(w2))||
                 (exactFirstSet.has(w1)&&exactSurnameSet.has(w2))||
                 (exactSurnameSet.has(w1)&&exactSurnameSet.has(w2));
    if(isPair){pass1Spans.push({start:t1.start,end:t2.end,orig:t1.text+' '+t2.text});i++;continue;}
    if(/^[A-Z]\.$/.test(t1.text)&&exactSurnameSet.has(w2)){
      pass1Spans.push({start:t1.start,end:t2.end,orig:t1.text+' '+t2.text});i++;
    }
  }
  result=applySpans(result,pass1Spans,'Nome+Cognome (coppia esatta)');

  // Pass 2: fuzzy pairs
  const tokens2=tokenise(result);
  const pass2Spans=[];
  const SKIP2=new Set([
    'nascita','cognome','nome','sesso','reparto','diagnosi','anamnesi',
    'terapia','esame','referto','paziente','medico','infermiere',
    'ambulatorio','ricovero','dimissione','urgente','ordinario',
    'stroke','unita','scala','valore','misura','dato','nota',
    'stato','grado','tipo','data','ora','firma','timbro',
    'mese','anno','giorno','settimana',
    'setto','atrio','mitrale','aortica','ventricolo','valvola',
    'glucosio','urea','creatinina','sodio','potassio','cloro',
    'calcio','fosfato','albumina','bilirubina','totale','coniugata',
    'inorganico','inorganica','urico','acido','ratio','tempo',
    'protrombina','trombina','fibrinogeno','ferritina','transferrina',
    'colesterolo','trigliceridi','emoglobina','ematocrito','piastrine',
    'leucociti','eritrociti','basofili','eosinofili','neutrofili',
    'linfociti','monociti','reticolociti','glicemia','insulina',
    'cortisolo','troponina','mioglobina','procalcitonina','sideremia',
    'proteinuria','microalbuminuria','cistatina','osmolalita','clearance',
    'bicarbonato','magnesio','zinco','fosforo','transaminasi','lipasi',
    'amilasi','fosfatasi','creatinchinasi','lattato','deidrogenasi',
    'costituente','risultato','riferimento','precedente',
    'intervallo','metodo','campione','commento','obiettivo',
    'terapeutico','normalizzato','alterata','digiuno',
    'gravidanza','emolizzato','sovrastima','reattiva',
    'mmol','umol','nmol','litro','litri',
    'neurologica','neurologico','neurologici','neurologia',
    'obiettivo','obbiettivo','generale','ingresso',
    'soccorso','pronto','clinica','unita','unit',
    'fisiatrica','fisiatrico','fisiatria',
    'cardiologica','cardiologia','radiologia',
    'nefrologia','pneumologia','ortopedia',
    'geriatria','medicina','chirurgia','riabilitazione',
    'decorso','clinico','farmacologica','motivo',
    'patologica','remota','fisiologica','familiare',
    'accertamenti','strumentali','laboratorio','specialistiche',
    'valutazioni','obiettivi',
    'curante','attenzione','cortese','collega','egregio',
    'dimettiamo','odierna','assistita','assistito',
    'ricoverata','ricoverato','degenza',
    'glicata','glicato','glicosata','glicosato',
    'metaboliti','speciali','lipidico','lipidica',
    'coagulativo','coagulativa','tiroideo','tiroidea',
    'eritrocitario','eritrocitaria','sierologico','microscopico',
    'ormonale','aptoglobina',
    // ── Nutritional products / brand drugs ──
    'nutrison','peptamen','isolyte','ensure','fresubin','cubitan',
    'fortimel','prosure','abound','resource','glucerna','multifibre',
    // ── Clinical terms that look like names ──
    'quesito','sostituto','primario',
  ]);
  for(let i=0;i<tokens2.length-1;i++){
    const t1=tokens2[i],t2=tokens2[i+1];
    if(!t1.isCapWord||!t2.isCapWord)continue;
    if(t1.text==='[NOME]'||t2.text==='[NOME]')continue;
    const w1=t1.text.replace(/[.,;:!?]$/,'').toLowerCase();
    const w2=t2.text.replace(/[.,;:!?]$/,'').toLowerCase();
    if(w1.length<4||w2.length<4)continue;
    if(SKIP2.has(w1)||SKIP2.has(w2))continue;
    const th1=fuzzyThreshold(w1),th2=fuzzyThreshold(w2);
    const isFuzzyPair=(isFuzzyName(w1,bkSurnames,th1)&&isFuzzyName(w2,bkFirstNames,th2))||
                      (isFuzzyName(w1,bkFirstNames,th1)&&isFuzzyName(w2,bkSurnames,th2));
    if(isFuzzyPair){pass2Spans.push({start:t1.start,end:t2.end,orig:t1.text+' '+t2.text});i++;}
  }
  pass2Spans.sort((a,b)=>a.start-b.start);
  let out2='',prev2=0;
  for(const s of pass2Spans){out2+=result.slice(prev2,s.start)+'[NOME]';addRep(s.orig,'Nome+Cognome (coppia fuzzy ~2 lettere)');prev2=s.end;}
  result=out2+result.slice(prev2);

  // Pass 3: exact individual surnames
  const allSurnames=[...exactSurnameSet];
  allSurnames.sort((a,b)=>b.length-a.length);
  const CLINICAL_KEYWORDS=new Set([
    'nascita','cognome','nome','sesso','reparto','diagnosi','anamnesi',
    'terapia','esame','referto','paziente','medico','infermiere',
    'ambulatorio','ricovero','dimissione','urgente','ordinario',
    'stroke','unita','scala','valore','valori','misura','dato','nota',
    'stato','grado','tipo','data','ora','firma','timbro',
    'mese','anno','giorno','giorni','settimana',
    'setto','atrio','mitrale','aortica','ventricolo','valvola',
    'glucosio','urea','creatinina','sodio','potassio','cloro',
    'calcio','fosfato','albumina','bilirubina','totale','coniugata',
    'inorganico','inorganica','urico','acido','ratio','tempo',
    'protrombina','trombina','fibrinogeno','ferritina','transferrina',
    'colesterolo','trigliceridi','emoglobina','ematocrito','piastrine',
    'leucociti','eritrociti','basofili','eosinofili','neutrofili',
    'linfociti','monociti','reticolociti','glicemia','insulina',
    'cortisolo','troponina','mioglobina','procalcitonina','sideremia',
    'proteinuria','microalbuminuria','cistatina','osmolalita','clearance',
    'bicarbonato','magnesio','zinco','fosforo','transaminasi','lipasi',
    'amilasi','fosfatasi','creatinchinasi','lattato','deidrogenasi',
    'costituente','risultato','riferimento','precedente',
    'intervallo','metodo','campione','commento','obiettivo',
    'terapeutico','normalizzato','alterata','digiuno',
    'gravidanza','emolizzato','sovrastima','reattiva',
    'mmol','umol','nmol','litro','litri',
    'neurologica','neurologico','neurologici','neurologia',
    'obiettivo','obbiettivo','generale','ingresso',
    'soccorso','pronto','clinica','fisiatrica','fisiatrico','fisiatria',
    'cardiologica','cardiologia','radiologia','nefrologia',
    'pneumologia','ortopedia','geriatria','medicina','chirurgia',
    'riabilitazione','decorso','clinico','farmacologica','motivo',
    'patologica','remota','fisiologica','familiare',
    'accertamenti','strumentali','laboratorio','specialistiche',
    'valutazioni','obiettivi','unita',
    'curante','attenzione','cortese','collega','egregio',
    'dimettiamo','odierna','assistita','assistito',
    'ricoverata','ricoverato','degenza',
    'glicata','glicato','glicosata','glicosato',
    'metaboliti','speciali','lipidico','lipidica',
    'coagulativo','coagulativa','tiroideo','tiroidea',
    'eritrocitario','eritrocitaria','sierologico','microscopico',
    'ormonale','aptoglobina',
    // ── Termini clinici/anatomici che sono anche cognomi italiani ──
    'gentili','franca','franco','corso','corsi',
    'vigile','vigili','semplici','semplice',
    'alla','alle','allo','agli',
    'esami','motivi','pazienti',
    'capo','piano','piani','presente','presenti',
    'durante','bianco','bianchi','bianca','bianche',
    'rosso','rossi','rossa','rosse',
    'ferro','noto','nota','noti','note',
    'falda','falde','quadro','quadri',
    'stabile','stabili','modesto','modesta','modesti',
    'minuto','minuti','minuta','massa','masse',
    'modica','modico','modici','modiche',
    'luce','recupero','campo','campi',
    'consiglio','consigli','massimo','massima',
    'minimi','minimo','minima','minime',
    'febbraio','gennaio','marzo','aprile','maggio','giugno',
    'luglio','agosto','settembre','ottobre','novembre','dicembre',
    'prossimi','prossimo','prossima','prossime',
    'secondo','seconda','secondi','seconde',
    'lettera','lettere','parziale','parziali',
    'venoso','venosa','venosi','venose',
    'assenza','toni','tono',
    'sala','sale','volta','volte',
    'busta','buste','medici',
    'compatto','compatta','compatti',
    'terzo','terza','terzi','terze',
    'inferiore','inferiori','superiore','superiori',
    'sensitivo','sensitiva','sensitivi',
    'orario','orari','corporeo','corporea',
    'fini','fine','destro','destra','destri','destre',
    'sinistro','sinistra','sinistri','sinistre',
    'sottile','sottili','corno','corni',
    'laterale','laterali','mediana','mediane','mediano',
    'basale','basali','frontale','frontali',
    'parietale','parietali','temporale','temporali',
    'occipitale','occipitali',
    'dorsale','dorsali','cervicale','cervicali',
    'torace','addome','polmonare','polmonari',
    'pleurica','pleuriche','pleurico',
    'asse','assiale','lungo','lunga','lunghi','lunghe',
    'breve','brevi','acuta','acuto','acuti','acute',
    'grave','gravi','lieve','lievi',
    'chetoni','chetone',
    'trasferiamo','trasferimento','trasferito','trasferita',
    'invasione','evoluzione','riduzione','estensione',
    'perfusione','diffusione','infusione','conclusione',
    'formazione','pressione','depressione','impressione',
    'stria','strie','areola','areole',
    'continua','continuo','continui','continue',
    'corretta','corretto','corretti','corrette',
    'integra','integro','integri','integre',
    'libera','libero','liberi','libere',
    'valida','valido','validi','valide',
    'costante','costanti','completa','completo',
    'flaccida','flaccido','rigida','rigido',
    'spontanea','spontaneo','spontanei','spontanee',
    'profonda','profondo','profondi','profonde',
    'bene','beni','male','mali',
    'positivo','positiva','positivi','positive',
    'negativo','negativa','negativi','negative',
    'assente','assenti','normale','normali',
    'raro','rara','rari','rare',
    'naso','nasale','nasali','orale','orali',
    'corto','corta','corti','corte',
    'alto','alta','alti','alte',
    'basso','bassa','bassi','basse',
    'medio','media','medi','medie',
    'grosso','grossa','grossi','grosse',
    'piccolo','piccola','piccoli','piccole',
    'chiaro','chiara','chiari','chiare',
    'paresi','uscita','numero','numeri',
    'presenza','stazionario','stazionaria',
    'prosegue','somministrata','somministrato',
    'rilevati','rilevato','rilevata',
    'monitorata','monitorato','posturato','posturata',
    'presenta','presentano','diuresi',
    'apiretico','apiretica',
    'verso','allergie','allergia',
    // ── Prodotti nutrizionali / brand farmaceutici spesso in cartella ──
    'nutrison','peptamen','isolyte','ensure','fresubin','cubitan',
    'fortimel','prosure','abound','resource','glucerna',
    'quesito','multifibre','sostituto',
  ]);
  for(const name of allSurnames){
    if(name.length<4)continue;
    if(CLINICAL_KEYWORDS.has(name.toLowerCase()))continue;
    const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const re=new RegExp(`(?<![\\w\\u00C0-\\u024F])${escaped}(?![\\w\\u00C0-\\u024F])`,'gi');
    if(re.test(result))result=result.replace(re,(m)=>{addRep(m,'Cognome (esatto)');return'[NOME]';});
  }
  return{text:result,reps};
}

/* ── Stato dizionario nomi (fuzzy, opzionale) ── */
// ── Dizionario nomi: DISATTIVATO ──
// nameDict_fallback è vuoto e il dizionario esterno non viene caricato.
// L'anonimizzazione NON dipende dal dizionario: si affida interamente ai
// pattern regex strutturali + Stage 0.5 (nome paziente dal frontespizio) +
// GLOBAL SWEEP (nomi paziente e medici). applyNameDict/BKTree restano nel
// codice come infrastruttura inerte (riattivabile) ma non vengono mai eseguiti.
const NAMES_DB = { firstNames:[], surnames:[], loaded:false };
let bkSurnames = new BKTree(), bkFirstNames = new BKTree();
function loadNameDictionaryLocal(){
  const fb = ANON_CONFIG.nameDict_fallback || [];
  if (!fb.length) { NAMES_DB.loaded = false; return; }   // ← caso attuale: esce subito
  fb.forEach(n => { bkSurnames.add(n.toLowerCase()); bkFirstNames.add(n.toLowerCase()); });
  NAMES_DB.surnames = fb.map(n => n.toLowerCase());
  NAMES_DB.firstNames = fb.map(n => n.toLowerCase());
  NAMES_DB.loaded = true;
}

// ═══════════════════════════════════════════════════
// STRIP BOILERPLATE (verbatim da standalone)
// ═══════════════════════════════════════════════════
function stripBoilerplate(text) {
  const stripped = [];
  const lines = text.split('\n');
  const cleaned = lines.filter(line => {
    for (const pat of ANON_CONFIG.boilerplateLinePatterns) {
      if (pat.test(line.trim())) {
        const t = line.trim();
        if (t.length > 2 && !stripped.find(b => b.text === t))
          stripped.push({ text: t, tag: 'Boilerplate' });
        return false;
      }
    }
    return true;
  });
  return {
    clean: cleaned.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    strippedBlocks: stripped,
  };
}

// ═══════════════════════════════════════════════════
// PATIENT DATA EXTRACTION (verbatim da standalone)
// Estrae nome/cognome/data di nascita dal frontespizio PRIMA dell'anonimizzazione.
// ═══════════════════════════════════════════════════
function extractPatientData(rawText) {
  const pd = { nome: '', cognome: '', dataNascita: '' };
  const lines = rawText.split('\n');

  // Helper: expand 2-digit year to 4-digit
  function expandYear(d) {
    return d.replace(/(\d{2}[\/\-]\d{2}[\/\-])(\d{2})$/, (m,pre,yy) => {
      const y = parseInt(yy);
      return pre + (y > 30 ? '19' : '20') + yy;
    });
  }

  // ── Pattern 0.0 (MAX PRIORITY) — "COGNOME NOMEPaziente: ... Nato il: DD/MM/YYYY" ──
  // Frontespizio dove il nome precede l'etichetta "Paziente:" e la data segue "Nato il:"
  // Es: "CANETTI MARIAPaziente: Nato il: 20/03/1920 RIC_AO_..."
  {
    const m = rawText.match(/([A-ZÀÈÉÌÒÙ][A-ZÀÈÉÌÒÙ'\- ]{2,40}?)\s*Paziente\s*:\s*(?:Nato\/?a?\s+il\s*:?\s*)?(\d{2}[\/\-]\d{2}[\/\-]\d{2,4})?/);
    if (m) {
      const words = m[1].trim().split(/\s+/).filter(w => w.length >= 2);
      if (words.length >= 2) {
        pd.nome = words.pop();
        pd.cognome = words.join(' ');
        if (m[2]) pd.dataNascita = expandYear(m[2].replace(/-/g,'/'));
      }
    }
  }

  // ── Pattern 0.05 — "DD/MM/YYYY COGNOME NOME NatoPaziente" (data prima del nome) ──
  // Frontespizio dove la data di nascita precede il nome, seguito da "Nato"/"Paziente"
  if (!pd.cognome || !pd.nome) {
    const m = rawText.match(/(\d{2}[\/\-]\d{2}[\/\-]\d{2,4})\s+([A-ZÀÈÉÌÒÙ]{2,}(?:\s+[A-ZÀÈÉÌÒÙ]{2,})+)\s*(?:Nato|Paziente)/);
    if (m) {
      const words = m[2].trim().split(/\s+/).filter(w => w.length >= 2);
      if (words.length >= 2) {
        pd.nome = words.pop();
        pd.cognome = words.join(' ');
        if (!pd.dataNascita) pd.dataNascita = expandYear(m[1].replace(/-/g,'/'));
      }
    }
  }

  // ── Pattern 0 (HIGHEST PRIORITY) — Frontespizio ────────────────────────
  // "COGNOME NOMEPaziente: DD/MM/YYYY" (glued) or with whitespace/newline
  // This is the most reliable source: the demographic header at the top of the PDF
  {
    // Try glued format first: "COGNOME NOMEPaziente:" (PDF.js often concatenates)
    const fpGlued = rawText.match(/([A-ZÀÈÉÌÒÙ][A-ZÀÈÉÌÒÙ'\- ]+?)(?:\s*)Paziente\s*:\s*(\d{2}\/\d{2}\/\d{2,4})/);
    if (fpGlued) {
      const namePart = fpGlued[1].trim();
      const words = namePart.split(/\s+/).filter(w => w.length >= 2);
      if (words.length >= 2) {
        // Last word is nome, everything before is cognome (handles "DE ROSSI MARIO")
        pd.nome = words.pop();
        pd.cognome = words.join(' ');
        pd.dataNascita = expandYear(fpGlued[2]);
      }
    }
    // Also try: name on line before "Paziente: DD/MM/YYYY"
    if (!pd.cognome || !pd.nome) {
      for (let i = 0; i < lines.length; i++) {
        const pzM = lines[i].match(/^\s*Paziente\s*:\s*(\d{2}\/\d{2}\/\d{2,4})/);
        if (pzM && i > 0) {
          const prev = lines[i-1].trim();
          const words = prev.split(/\s+/).filter(w => /^[A-ZÀÈÉÌÒÙ]/.test(w) && w.length >= 2);
          if (words.length >= 2) {
            pd.nome = words.pop();
            pd.cognome = words.join(' ');
            pd.dataNascita = expandYear(pzM[1]);
            break;
          }
        }
      }
    }
  }

  // ── Pattern 0.1 — "Nominativo: CANETTI MARIA" (referti ambulatoriali/ECG) ──
  // Spesso seguito da "Anni:" / "Data Nascita:" / "Sesso:"
  if (!pd.cognome || !pd.nome) {
    const nomM = rawText.match(/Nominativo\s*:\s*([A-ZÀÈÉÌÒÙ][A-Za-zÀ-ü'\-]+(?:\s+[A-ZÀÈÉÌÒÙ][A-Za-zÀ-ü'\-]+)+?)(?:\s+(?:Anni|Et[àa]|Data\s*[Nn]ascita|Sesso|C\.?F\.?|N\.?\s*Richiesta|Nato)\b|\s*$|\s{2,})/);
    if (nomM) {
      const words = nomM[1].trim().split(/\s+/).filter(w => w.length >= 2);
      if (words.length >= 2) {
        // Convenzione referti: "COGNOME NOME" → primo = cognome, resto = nome
        pd.cognome = words.shift();
        pd.nome = words.join(' ');
      }
    }
  }

  // ── Pattern 0.2 — "Nome:" e "Cognome:" su righe/segmenti separati ──
  // Es. ECG in fondo: "... Nome: \n Cognome:" preceduti da "MARIA CANETTI"
  // oppure "Nome: MARIA" e "Cognome: CANETTI" esplicite
  if (!pd.nome) {
    const nm = rawText.match(/(?<![A-Za-z])Nome\s*:\s*([A-ZÀÈÉÌÒÙ][A-Za-zÀ-ü'\-]{1,30})(?:\s|$|,)/);
    if (nm && !/^complet/i.test(nm[1])) pd.nome = nm[1].trim();
  }
  if (!pd.cognome) {
    const cm = rawText.match(/Cognome\s*:\s*([A-ZÀÈÉÌÒÙ][A-Za-zÀ-ü'\-]{1,30})(?:\s|$|,)/);
    if (cm) pd.cognome = cm[1].trim();
  }

  // Pattern 1 — "Cognome: ROSSI  Nome: MARIO  Data nascita: 01/01/1940"
  // Only fill fields not already found by Pattern 0 (frontespizio)
  for (const line of lines) {
    // Guard: skip lines containing "NOME COMPLETO" (it's a label, not a name)
    if (/NOME\s+COMPLETO/i.test(line)) continue;
    if (!pd.cognome) {
      const cogM = line.match(/Cognome\s*[:\s]+([A-ZÀ-Ü][A-Za-zÀ-ü\s'\-]{1,40}?)(?:\s{2,}|\t|$)/i);
      if (cogM) pd.cognome = cogM[1].trim();
    }
    if (!pd.nome) {
      const nomM = line.match(/(?<!\w)Nome\s*[:\s]+([A-ZÀ-Ü][A-Za-zÀ-ü\s'\-]{1,40}?)(?:\s{2,}|\t|$)/i);
      if (nomM) pd.nome = nomM[1].trim();
    }
    if (!pd.dataNascita) {
      const dnM = line.match(/[Nn]ato(?:\/a)?\s+il\s*:?\s*(\d{2}[\/\-]\d{2}[\/\-]\d{2,4})|[Dd]ata\s+(?:di\s+)?[Nn]ascita\s*[:\s]+(\d{2}[\/\-]\d{2}[\/\-]\d{2,4})/);
      if (dnM) pd.dataNascita = expandYear((dnM[1]||dnM[2]).replace(/-/g,'/'));
    }
  }

  // Pattern 2 — "Episodio RIC_AO_XXXXX ROSSI MARIO nato/a il 01/01/1940"
  if (!pd.cognome || !pd.nome) {
    const epM = rawText.match(/Episodio\s+\S+\s+([A-ZÀÈÉÌÒÙ][A-ZÀÈÉÌÒÙ\s]{1,25}?)\s+([A-ZÀÈÉÌÒÙ][A-ZÀÈÉÌÒÙ\s]{1,25}?)\s+nato\/a\s+il\s+(\d{2}[\/\-]\d{2}[\/\-]\d{2,4})/);
    if (epM) {
      if (!pd.cognome) pd.cognome = epM[1].trim();
      if (!pd.nome)    pd.nome    = epM[2].trim();
      if (!pd.dataNascita) pd.dataNascita = expandYear(epM[3].replace(/-/g,'/'));
    }
  }

  // Pattern 3 — "il sig./la sig.ra COGNOME NOME (d.n. DD/MM/YYYY)" or "(DD/MM/YY)"
  if (!pd.cognome || !pd.nome) {
    const sigM = rawText.match(/(?:il\s+sig(?:nor)?\.?|la\s+sig(?:nora)?\.?(?:ra)?\.?|il\s+paziente)\s+([A-ZÀ-Ü][a-zA-ZÀ-ü'\-]+)\s+([A-ZÀ-Ü][a-zA-ZÀ-ü'\-]+)/i);
    if (sigM) {
      if (!pd.cognome) pd.cognome = sigM[1].trim();
      if (!pd.nome)    pd.nome    = sigM[2].trim();
    }
  }

  // Pattern 4 — "d.n. DD/MM/YYYY" or "d.n. DD/MM/YY" or "(d. n. DD/MM/YY)"
  if (!pd.dataNascita) {
    const dnM = rawText.match(/d\.?\s*n\.?\s+(\d{2}[\/\-]\d{2}[\/\-]\d{2,4})/i);
    if (dnM) {
      pd.dataNascita = expandYear(dnM[1].replace(/-/g,'/'));
    }
  }

  // Pattern 5 — "COGNOME NOME\nPaziente:" or ALLCAPS name on line before "Paziente:"
  if (!pd.cognome || !pd.nome) {
    for (let i = 0; i < lines.length; i++) {
      if (/^Paziente\s*:/i.test(lines[i]) && i > 0) {
        const prev = lines[i-1].trim();
        const nameM = prev.match(/^([A-ZÀÈÉÌÒÙ]{2,})\s+([A-ZÀÈÉÌÒÙ]{2,})$/);
        if (nameM) {
          if (!pd.cognome) pd.cognome = nameM[1].trim();
          if (!pd.nome)    pd.nome    = nameM[2].trim();
          break;
        }
      }
    }
  }

  // Pattern 6 — "COGNOME NOME  DD/MM/YYYY  XXXXXXXX" demographic header
  if (!pd.cognome || !pd.nome) {
    const hdrM = rawText.match(/\b([A-ZÀÈÉÌÒÙ]{2,})\s+([A-ZÀÈÉÌÒÙ]{2,})\s+(\d{2}\/\d{2}\/\d{4})\s+\d+/);
    if (hdrM) {
      const yr = parseInt(hdrM[3].slice(6));
      if (yr >= 1900 && yr <= 2010) {
        if (!pd.cognome) pd.cognome = hdrM[1].trim();
        if (!pd.nome)    pd.nome    = hdrM[2].trim();
        if (!pd.dataNascita) pd.dataNascita = hdrM[3];
      }
    }
  }

  // Pattern 7 (fallback) — first plausible birthdate in document
  if (!pd.dataNascita) {
    const dnM2 = rawText.match(/\b(\d{2}\/\d{2}\/\d{4})\b/);
    if (dnM2) {
      const yr = parseInt(dnM2[1].slice(6));
      if (yr >= 1900 && yr <= 2010) pd.dataNascita = dnM2[1];
    }
  }

  // Capitalize properly: "ROSSI" → "Rossi", "MARIO" → "Mario"
  function cap(s){ return s.replace(/\b\w+/g, w => w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()); }
  if (pd.cognome) pd.cognome = cap(pd.cognome);
  if (pd.nome)    pd.nome    = cap(pd.nome);

  return pd;
}

// ═══════════════════════════════════════════════════
// REINSERIMENTO DATI PAZIENTE NELLA LETTERA (verbatim da standalone)
// Sostituisce i placeholder [PAZIENTE_NOME] e [DATA_NASCITA] con i dati reali
// estratti dalla cartella, in fase di finalizzazione/esportazione.
// ═══════════════════════════════════════════════════
function applyPatientData(text, pd) {
  if (!pd) return text;
  let out = text;
  // Full name placeholder
  const fullName = [pd.cognome, pd.nome].filter(Boolean).join(' ');
  if (fullName) out = out.replace(/\[PAZIENTE_NOME\]/g, fullName);
  // Date of birth
  if (pd.dataNascita) out = out.replace(/\[DATA_NASCITA\]/g, pd.dataNascita);
  return out;
}

// Finalizza la lettera: reinserisce i dati paziente reali + [CITTA]/[REPARTO],
// replica esattamente la funzione finalizzaLettera dello standalone.
function finalizeLetter(w){
  if(!w || !w.outputLetter) return '';
  let letter = w.outputLetter;
  // Reinserisce nome paziente e data di nascita estratti dalla cartella grezza
  letter = applyPatientData(letter, w.patientData);
  // [CITTA] → Padova, [REPARTO] → reparto attivo
  const ward = (w.ward || '').trim();
  letter = letter.replace(/\[CITTA\]/g, 'Padova');
  letter = letter.replace(/\[REPARTO\]/g, ward || 'reparto');
  // Pulizia righe vuote in eccesso
  letter = letter.replace(/\n{3,}/g, '\n\n').trim();
  return letter;
}

function anonymizeText(rawText){
  if (!rawText || !rawText.trim()) return { text:'', substitutions:[], strippedBlocks:[], patientData:{nome:'',cognome:'',dataNascita:''} };
  loadNameDictionaryLocal();

  // Stage 0 — estrai i dati del paziente dal testo grezzo PRIMA dell'anonimizzazione
  const patientData = extractPatientData(rawText);

  // Stage 1 — rimozione righe boilerplate istituzionali
  const { clean: cleanRaw, strippedBlocks } = stripBoilerplate(rawText);

  // ── Stage 0.5 — Pre-anonimizza nome paziente & data nascita dal frontespizio ──
  // Sostituisce TUTTE le occorrenze del nome del paziente e della DOB in tutto il
  // documento prima dei pattern regex. È il passaggio più affidabile perché il
  // frontespizio è la fonte autorevole dell'identità del paziente.
  let clean = cleanRaw;
  const pdReps = [];
  const pd = patientData;
  if (pd.cognome || pd.nome) {
    const cog = pd.cognome, nom = pd.nome;
    const variants = [];
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (cog && nom) {
      const cogU = cog.toUpperCase(), nomU = nom.toUpperCase();
      variants.push({ pat: esc(cogU) + '\\s+' + esc(nomU), label: '[PAZIENTE]' });
      variants.push({ pat: esc(nomU) + '\\s+' + esc(cogU), label: '[PAZIENTE]' });
      variants.push({ pat: esc(cog) + '\\s+' + esc(nom), label: '[PAZIENTE]' });
      variants.push({ pat: esc(nom) + '\\s+' + esc(cog), label: '[PAZIENTE]' });
      variants.push({ pat: esc(cogU) + '\\s+' + esc(nom), label: '[PAZIENTE]' });
      variants.push({ pat: esc(cog) + '\\s+' + esc(nomU), label: '[PAZIENTE]' });
      variants.push({ pat: esc(nomU) + '\\s+' + esc(cog), label: '[PAZIENTE]' });
      variants.push({ pat: esc(nom) + '\\s+' + esc(cogU), label: '[PAZIENTE]' });
    }
    if (cog && cog.length >= 3) {
      variants.push({ pat: '\\b' + esc(cog.toUpperCase()) + '\\b', label: '[PAZIENTE]' });
      variants.push({ pat: '\\b' + esc(cog) + '\\b', label: '[PAZIENTE]' });
    }
    if (nom && nom.length >= 3) {
      variants.push({ pat: '\\b' + esc(nom.toUpperCase()) + '\\b', label: '[NOME]' });
      variants.push({ pat: '\\b' + esc(nom) + '\\b', label: '[NOME]' });
    }
    variants.sort((a,b) => b.pat.length - a.pat.length);
    for (const v of variants) {
      try {
        const re = new RegExp(v.pat, 'g');
        const before = clean;
        clean = clean.replace(re, v.label);
        if (clean !== before) {
          pdReps.push({ orig: v.pat.replace(/\\[bsS+*?^${}()|[\]\\]/g,'').replace(/\\\s\+/g,' '), repl: v.label, type: 'Nome' });
        }
      } catch(e) {}
    }
  }
  if (pd.dataNascita) {
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
      const re = new RegExp(esc(pd.dataNascita), 'g');
      clean = clean.replace(re, '[DATA_NASCITA]');
    } catch(e) {}
    const short2 = pd.dataNascita.replace(/(\d{2}\/\d{2}\/)(?:19|20)(\d{2})$/, '$1$2');
    if (short2 !== pd.dataNascita) {
      try {
        const re2 = new RegExp(esc(short2), 'g');
        clean = clean.replace(re2, '[DATA_NASCITA]');
      } catch(e) {}
    }
    pdReps.push({ orig: pd.dataNascita, repl: '[DATA_NASCITA]', type: 'Data sensibile' });
  }

  // Stage 1 (regex strutturale) + Stage 2 (dizionario) con freeze/restore delle righe lab
  const { frozen, restore } = freezeLabLines(clean);
  let finalText = clean, reps = [...pdReps];
  const res = applyRegex(frozen);

  if (!NAMES_DB.loaded) {
    finalText = restore(res.text);
    reps = [...pdReps, ...res.reps];
  } else {
    const res2 = applyNameDict(res.text);
    finalText = restore(res2.text);
    reps = [...pdReps, ...res.reps, ...res2.reps];
  }

  // ── GLOBAL SWEEP (sempre attivo, anche senza dizionario nomi) ──
  // Ogni nome rilevato viene sostituito in TUTTE le sue occorrenze per coerenza.
  // Salta parole cliniche comuni che potrebbero essere finite in un match più ampio.
  {
    const SWEEP_SKIP = new Set([
      'alla','alle','allo','agli','della','delle','dello','degli',
      'nella','nelle','nello','negli','sulla','sulle','sullo','sugli',
      'dalla','dalle','dallo','dagli',
      'esame','esami','motivo','motivi','paziente','pazienti',
      'data','date','nome','cognome','firma','tipo',
      'obiettivo','obiettivi','generale','generali',
      'ingresso','uscita','reparto','reparti',
      'clinica','clinico','clinici','cliniche',
      'decorso','terapia','diagnosi','anamnesi',
      'dimissione','ricovero','medico','medici',
      'luce','nota','noto','noti','note',
      'stampa','stampato','rappresentazione',
      'lieve','paresi','plegia','grave','segni',
      'respiro','vigile','presenza','stazionario',
      'verso','durante','allergie','numero',
      'fisico','diagnostico','intervento',
      'addome','diuresi','apiretico',
      'prosegue','somministrata','rilevati',
      'monitorata','posturato','presenta',
      'nutrison','peptamen','isolyte','ensure','fresubin',
      'cubitan','fortimel','prosure','abound','resource','glucerna',
      'forte','bianca','bianchi','sereno','sereni','rossa','rosso',
      'destra','sinistra','marcia','sordita','sordo','sorda',
    ]);
    const sweepReps = [...reps].sort((a,b) => b.orig.length - a.orig.length);
    for (const r of sweepReps) {
      if (!r.orig || r.orig.length < 2) continue;
      if (!r.orig.includes(' ') && SWEEP_SKIP.has(r.orig.toLowerCase())) continue;
      try {
        const esc = r.orig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        finalText = finalText.replace(new RegExp(esc, 'g'), r.repl);
      } catch(e) {}
    }

    // ── SWEEP FINALE NOMI MEDICI/OPERATORI (nome + cognome) ──
    // Per ogni nome identificato come [OPERATORE], estrae le singole parole-nome
    // (sia il NOME di battesimo sia il COGNOME) e le rimuove in tutto il testo,
    // per catturare ricomparse dello stesso medico senza titolo
    // (es. "Loteno" o "Marco" da soli dopo "Dott. Marco Loteno").
    // Veloce: opera su poche decine di nomi già raccolti, replace su testo di pochi KB.
    const operatorNames = new Set();
    for (const r of reps) {
      if (r.type !== 'Nome') continue;
      if (!/OPERATORE/.test(r.repl)) continue;
      // Estraggo le parole-nome dall'originale (scarto titoli, "da", date, label, parole funzionali)
      const cleaned = r.orig
        .replace(/\b(?:[Dd]ott?\.?(?:\.?ss?a\.?)?|[Dd]r\.?(?:\.?ss?a\.?)?|[Dd]\.?ss?a\.?|[Oo]tt\.?(?:\.?ss?a\.?)?|[Pp]r?of\.?(?:ss?a\.?)?|[Pp]orf\.?|[Mm]ed\.?)\b/g, ' ')
        .replace(/\b(?:da|il|la|lo|di|del|dei|e|ed)\b/gi, ' ')
        .replace(/\b(?:Firmat[oa]|Refertat[oa]|Sottoscritto|Validato|Redatto|Compilato|Ora|Data|Medico|richiedente|refertante)\b/gi, ' ')
        .replace(/\d|[:\.\/\-]/g, ' ')
        .replace(/\[[^\]]*\]/g, ' ');
      cleaned.split(/\s+/).forEach(w => {
        const word = w.trim();
        // Parole alfabetiche di almeno 3 lettere. Per il sweep medici uso un filtro
        // RIDOTTO (solo parole funzionali/strutturali), NON l'intero SWEEP_SKIP: i
        // cognomi che coincidono con termini clinici (Bianchi, Forte) sono comunque
        // protetti perché lo sweep è case-sensitive sulla maiuscola (vedi sotto).
        const FUNC_SKIP = new Set(['del','dei','della','delle','dello','degli','con','per','tra','fra','sul','sui','non','che','più','già','ore','data','nome','firma','medico','medici','reparto','clinica','paziente']);
        if (word.length >= 3 && /^[A-Za-zÀ-ü'\-]+$/.test(word) && !FUNC_SKIP.has(word.toLowerCase()))
          operatorNames.add(word);
      });
    }
    // Spazzo i nomi degli operatori. PRUDENZA: case-sensitive sull'iniziale maiuscola.
    // I nomi/cognomi dei medici compaiono con la maiuscola; i termini clinici che
    // potrebbero coincidere compaiono minuscoli nel testo e NON vengono toccati.
    for (const name of operatorNames) {
      try {
        const cap = name.charAt(0).toUpperCase() + name.slice(1);
        const capEsc = cap.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        finalText = finalText.replace(new RegExp('\\b' + capEsc + '\\b', 'g'), '[OPERATORE]');
        // Versione tutta maiuscola (frontespizi): COGNOME / NOME
        if (name.length >= 3) {
          const upEsc = name.toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          if (upEsc !== capEsc) finalText = finalText.replace(new RegExp('\\b' + upEsc + '\\b', 'g'), '[OPERATORE]');
        }
      } catch(e) {}
    }
    // Compatta eventuali "[OPERATORE] [OPERATORE]" consecutivi nati dal sweep
    finalText = finalText.replace(/(?:\[OPERATORE\]\s*){2,}/g, '[OPERATORE] ');
  }

  return { text: finalText, substitutions: reps, strippedBlocks, patientData };
}
function detectResidualPII(text){
  const flags = [];
  const checks = [
    { re: /\b[A-Z]{6}\d{2}[A-EHLMPRST]\d{2}[A-Z]\d{3}[A-Z]\b/g, label:'Codice fiscale' },
    { re: /\b\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4}\b/g, label:'Data completa (gg/mm/aaaa)' },
    { re: /\b(?:\+39\s?)?3\d{2}[\s\.\-]?\d{6,7}\b/g, label:'Numero di telefono' },
    { re: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g, label:'Email' },
    { re: /\bRIC_AO_\d{6,12}\b/g, label:'ID episodio AOPD' },
  ];
  for (const c of checks){ const m = text.match(c.re); if (m && m.length) flags.push({ label:c.label, count:m.length, sample:m[0] }); }
  return flags;
}

/* ═══════════════════════════════════════════════════════════════════════════
   LOGICA DI DOMINIO (verbatim da standalone): fingerprint V3, template,
   override, preferenze, parser XLS, costruzione prompt.
   ═══════════════════════════════════════════════════════════════════════════ */
// ── isAbnormal ──
function isAbnormal(value,refRange){
  if(!refRange||!value)return false;
  if(/\d{1,2}\/\d{1,2}/.test(refRange))return false;
  const numVal=parseFloat(value.replace(',','.'));
  if(isNaN(numVal))return false;
  const m=refRange.match(/([\d.,]+)\s*[-–]\s*([\d.,]+)/);
  if(!m)return false;
  const lo=parseFloat(m[1].replace(',','.')),hi=parseFloat(m[2].replace(',','.'));
  if(isNaN(lo)||isNaN(hi))return false;
  return numVal<lo||numVal>hi;
}


// ── extractDischargeLetter ──
function extractDischargeLetter(anonText) {
  const lines = anonText.split('\n');

  // ── Phase 1: find "dimettiamo/trasferiamo" lines as letter anchors ──────
  // These words appear only in discharge/transfer letters, not in diary notes
  const ANCHOR_RE = /(?:dimettiamo|trasferiamo)\s+in\s+data\s+odierna/i;

  // Ward headers that precede a letter (within ~15 lines above the anchor)
  const WARD_HEADER_RE = /^\s*(?:CLINICA\s+NEUROLOGICA|STROKE\s+UNIT|NEUROLOGIA|U\.O\.)/i;

  // ── Phase 2: once a letter zone is found, trim its start to the greeting ─
  const GREETING_RE = [
    /^\s*Alla?\s+C\.\s*A\.\s+de[li]/i,
    /^\s*Al\s+Medico\s+Curante/i,
    /^\s*Ai\s+Colleghi\s+del/i,
    /^\s*Egregi\s+Colleghi/i,
    /^\s*Gentili\s+Colleghi/i,
    /^\s*Gentile\s+Collega/i,
    /^\s*Alla\s+cortese\s+attenzione/i,
    /^\s*All['\u2019]attenzione\s+de[li]/i,
    /^\s*All['\u2019]att\.?ne\s+de[li]/i,
  ];

  const END_RE = [
    /^\s*\(Medici\s+in\s+formazione\s+specialistica\)/i,
    /^\s*\(Dirigenti\s+medici\)\s*$/i,
  ];
  const HARD_STOP_RE = [
    /^\s*\[INFO_DELIBERAZIONE\]/,
    /^\s*\[FIRMA_DIMISSIONE\]/,
    /^\s*\[INFO_COSTO\]/,
  ];

  function parseFirmaDate(block) {
    const m = block.match(/firmata\s+da\s+.+?\s+il\s+(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2})\.(\d{2})\.(\d{2})/i);
    if (!m) return null;
    const [,dd,mo,yy,hh,mm,ss] = m;
    return new Date(+yy, +mo-1, +dd, +hh, +mm, +ss);
  }

  // ── Phase 1: find all anchor positions ──────────────────────────────────
  const anchors = [];
  for (let i = 0; i < lines.length; i++) {
    if (ANCHOR_RE.test(lines[i])) {
      // Verify there's a ward header OR a greeting line within 15 lines above
      let hasContext = false;
      for (let j = Math.max(0, i - 15); j < i; j++) {
        if (WARD_HEADER_RE.test(lines[j]) || GREETING_RE.some(re => re.test(lines[j]))) {
          hasContext = true; break;
        }
      }
      if (hasContext && (!anchors.length || i - anchors[anchors.length-1] > 10)) {
        anchors.push(i);
      }
    }
  }
  if (!anchors.length) return { letter: null, blocks: [] };

  // ── Phase 2: for each anchor, scan up for greeting, scan down for end ──
  const blocks = [];
  for (const anchorIdx of anchors) {
    // Scan UP from anchor to find the greeting line (max 15 lines)
    let greetingIdx = anchorIdx; // fallback: start at anchor itself
    for (let j = anchorIdx - 1; j >= Math.max(0, anchorIdx - 15); j--) {
      if (GREETING_RE.some(re => re.test(lines[j]))) { greetingIdx = j; break; }
    }

    // Also include up to 2 lines before the greeting (header context like "CLINICA NEUROLOGICA")
    const captureFrom = Math.max(0, greetingIdx - 2);

    // Scan DOWN from anchor to find end
    let endIdx = lines.length - 1;
    for (let i = anchorIdx; i < lines.length; i++) {
      if (HARD_STOP_RE.some(re => re.test(lines[i]))) { endIdx = i - 1; break; }
      if (END_RE.some(re => re.test(lines[i])))        { endIdx = i;     break; }
    }

    const raw = lines.slice(captureFrom, endIdx + 1).join('\n');

    // Clean: remove boilerplate placeholders between pages, trim start to greeting
    let cleaned = raw
      .replace(/^\s*(\[(?:INTESTAZIONE|PAGINA|DATA_STAMPA|TELEFONO|NUM_DOCUMENTO|INDIRIZZO)[^\]]*\]\s*\n)+/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // Final trim: ensure text starts from the greeting, not from header
    const cleanedLines = cleaned.split('\n');
    let greetStart = 0;
    for (let k = 0; k < Math.min(cleanedLines.length, 10); k++) {
      if (GREETING_RE.some(re => re.test(cleanedLines[k]))) { greetStart = k; break; }
    }
    if (greetStart > 0) cleaned = cleanedLines.slice(greetStart).join('\n').trim();

    blocks.push({ from: captureFrom, to: endIdx, text: cleaned, date: parseFirmaDate(raw) });
  }

  // ── Pick the block with the latest signature date ───────────────────────
  let best = blocks[blocks.length - 1];
  for (const b of blocks) {
    if (b.date && (!best.date || b.date > best.date)) best = b;
  }

  return {
    letter: best.text || null,
    blocks: blocks.map(b => ({ from: b.from, to: b.to })),
  };
}

// ── stripLetterBlocks ──
function stripLetterBlocks(anonText, blocks) {
  if (!blocks.length) return anonText;
  const lines = anonText.split('\n');
  // Build a set of line indices to remove
  const remove = new Set();
  for (const { from, to } of blocks) {
    for (let i = from; i <= to; i++) remove.add(i);
  }
  const kept = lines.filter((_, i) => !remove.has(i));
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ── xlsToRawText ──
function xlsToRawText(rows, filename){
  function clean(v){ return String(v==null?'':v).replace(/\n+/g,' ').trim(); }
  function anonHeader(s){
    return s.replace(/\bRIC_AO_\d+\b\s*/gi,'').replace(/\s+/g,' ').trim();
  }

  if(!rows || rows.length === 0) return {text:'', preview:'', rowCount:0};

  const lines = [];
  let dataRowCount = 0;

  for(let i = 0; i < rows.length; i++){
    const row = rows[i];
    if(!row || row.every(c => !clean(c))) continue; // skip empty rows

    const cells = row.map((c,ci) => {
      const s = clean(c);
      // Anonymise only the header row (row 0), only the date columns (col 3+)
      if(i === 0 && ci >= 3) return anonHeader(s);
      return s;
    });

    lines.push(cells.join('\t'));
    if(i > 0) dataRowCount++;
  }

  const text = `## ESAMI DI LABORATORIO\n`
    + `(Formato: Metodo | Unità | Range | data1 | data2 | ... — colonne data più recenti a sinistra)\n\n`
    + lines.join('\n');

  // Preview: first 30 lines with tab → spaces for readability
  const preview = lines.slice(0, 30)
    .map(l => l.replace(/\t/g, '   '))
    .join('\n')
    + (lines.length > 30 ? `\n... e altre ${lines.length-30} righe` : '');

  return {text, preview, rowCount: dataRowCount};
}

// ── formatLabRows ──
function formatLabRows(rows){
  // ── Anonimizzazione: rimuove solo ID ricovero e codice fiscale
  // NON tocca date, valori, unità, range
  function anonHeader(s){
    return s
      .replace(/\bRIC_AO_\d+\b/gi,'[ID_RICOVERO]')
      .replace(/\b\d{7,12}[-/]\d{0,6}\b/g,'[ID_RICOVERO]')
      .replace(/\b(?:CF|C\.F\.)\s*:?\s*[A-Z0-9]{16}\b/gi,'[CODICE_FISCALE]')
      .replace(/\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/g,'[CODICE_FISCALE]');
  }

  // Pulisce una singola cella
  function clean(v){return String(v==null?'':v).trim();}

  if(!rows||rows.length===0) return{text:'',preview:'',examCount:0};

  // ── Rilevamento formato: cerca la riga di intestazione ──
  // Formato AOPD: row[0] = ['Metodo','Unità','Intervallo', 'RIC_AO_XXX\ndata1', 'RIC_AO_XXX\ndata2', ...]
  // Formato generico: row[0] = qualsiasi altra struttura
  const headerRow = rows[0].map(c => clean(c).toLowerCase());
  const isAOPD = (
    headerRow[0].includes('metodo') &&
    (headerRow[1].includes('unit') || headerRow[1].includes('unità')) &&
    (headerRow[2].includes('interval') || headerRow[2].includes('rifer'))
  );

  if(isAOPD){
    return formatLabRowsAOPD(rows);
  } else {
    return formatLabRowsGeneric(rows);
  }
}

// ── formatLabRowsAOPD ──
function formatLabRowsAOPD(rows){
  function clean(v){ return String(v==null?'':v).replace(/nan/gi,'').trim(); }
  function anonHeader(s){
    return s.replace(/\bRIC_AO_\d+\b/gi,'').replace(/\n+/g,' ').replace(/\s+/g,' ').trim();
  }
  function isAbn(val, ref){
    if(!ref||!val) return false;
    const n = parseFloat(val.replace(',','.'));
    if(isNaN(n)) return false;
    const m = ref.match(/([\d.,]+)\s*[-–]\s*([\d.,]+)/);
    if(!m) return false;
    return n < parseFloat(m[1].replace(',','.')) || n > parseFloat(m[2].replace(',','.'));
  }
  // Known acronyms/siglas that must stay ALL CAPS — used only for section toCamel
  const ACRONYMS = new Set(['WBC','RBC','MCV','MCH','MCHC','RDW','CRP','PCR','INR','APTT','GFR',
    'ALT','AST','ALP','CPK','TSH','FT3','FT4','LDL','HDL','VES','LAD','TNI',
    'NSE','CEA','HBSAG','HCV','HBV','HAV','MDR','ETF','PEC','GGT','EU','CKD','EPI','PH']);

  function isAcronym(word){
    return ACRONYMS.has(word.toUpperCase()) || (word.length >= 2 && /^[A-Z][A-Z0-9]+$/.test(word));
  }

  function toCamel(s){
    // Title case for section names only, preserving known acronyms
    return s.replace(/\s+/g,' ').trim().replace(/[_\-]/g,' ')
      .split(' ')
      .map(w => {
        if(!w) return '';
        if(isAcronym(w)) return w.toUpperCase();
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      })
      .join(' ');
  }

  function cleanName(s){
    // Strip AOPD prefixes (B-, P-, S-, U-) then preserve original capitalisation exactly
    return s.replace(/^[BPSU]-(?=[A-Za-z])/,'').replace(/\s*\(.*?\)\s*/g,'').trim();
  }

  const headerRow = rows[0];

  // ── Date columns (col 3+): file order = most-recent first
  const dateCols = [];
  for(let c = 3; c < headerRow.length; c++){
    const raw = clean(headerRow[c]);
    if(!raw) continue;
    const label = anonHeader(raw);
    dateCols.push({colIdx: c, label: label||`Prelievo ${c-2}`});
  }
  if(!dateCols.length) return formatLabRowsGeneric(rows);

  // ── Always-show-exact exams ──
  const ALWAYS_EXACT = /colesterol|hdl|ldl|trigliceridi|hba1c|emoglobina glicata|creatinina\b|tsh\b|urea\b/i;

  // ── Section remapping for orphan rows ──
  const REMAP = [
    [/albumina.*eu|eritrociti.*eu|leucociti.*eu|batteri.*eu|ph.*eu|densit|glucosio.*eu|proteine.*eu|hb.*eu|chetoni|osmolal|eritrociti$|leucociti$|batteri$/i, 'Esame urine'],
    [/aptt|d.dim|fibrinogen/i, 'Coagulazione'],
    [/tsh|ft3|ft4/i, 'Funzionalità tiroidea'],
    [/procalcitonin/i, 'Indici di flogosi'],
    [/gfr/i, 'Funzionalità renale'],
    [/sodio\b|potassio\b|cloro\b|calcio\b|magnesio\b|fosforo\b/i, 'Funzionalità renale'],
    [/hbsag|anti.hb|anti.hcv|anti.hav|epatite|sorveglianza.*mdr|colturale|batteriuria|screening/i, 'Esami microbiologici'],
    [/eta.*anni|coombs|tonicita|osmolalita.*calc|creatinina.*gfr|calcolo.*gfr/i, null], // skip
  ];
  function remapSection(name){
    for(const [pat,sec] of REMAP) if(pat.test(name)) return sec;
    return undefined; // keep current
  }

  // ── Pass 1: collect all rows into sections, merging duplicates by name+unit ──
  const sections = []; // [{name, items:[{name,unit,ref,cells:{colIdx->val}}]}]
  let curSection = null;

  for(let i = 1; i < rows.length; i++){
    const row = rows[i].map(c => clean(c));
    const name = row[0]; if(!name) continue;
    const unit = row[1], ref = row[2];
    const allVals = dateCols.map(d => clean(row[d.colIdx]||''));
    const hasNum = allVals.some(v => v && !isNaN(parseFloat(v.replace(',','.'))));
    const hasText = allVals.some(v => v && isNaN(parseFloat(v.replace(',','.'))));
    const hasAny = hasNum || hasText;

    // Section header row
    if(!hasAny && name.length <= 60 && !/commento/i.test(name)){
      const remap = remapSection(name);
      if(remap === null) continue; // skip meta sections
      curSection = {name: toCamel(name), items:[]};
      sections.push(curSection);
      continue;
    }

    // Determine effective section
    const remap = remapSection(name);
    if(remap === null) continue; // skip meta rows (età, tonicità, ecc.)

    let targetSection = curSection;
    if(remap !== undefined){
      // Find or create remapped section
      targetSection = sections.find(s => s.name.toLowerCase() === remap.toLowerCase());
      if(!targetSection){ targetSection={name:remap,items:[]}; sections.push(targetSection); }
    }
    if(!targetSection){ targetSection={name:'Altro',items:[]}; sections.push(targetSection); }

    // Comment row
    if(/commento/i.test(name) || (!hasNum && hasText)){
      const notReceived = allVals.some(v => /campione non pervenuto|esame annullato/i.test(v));
      const commentText = notReceived ? 'campione non pervenuto'
        : allVals.find(v => v && !/campione|annullato/i.test(v)) || '';
      if(commentText) targetSection.items.push({type:'comment', name, text:commentText});
      continue;
    }

    // Build cells map: colIdx → value
    const cells = {};
    dateCols.forEach(d => {
      const v = clean(row[d.colIdx]||'');
      if(v) cells[d.colIdx] = v;
    });

    // ── Merge with existing item of same name+unit (different dates) ──
    const key = name.toLowerCase().replace(/[^a-z0-9]/g,'');
    const existing = targetSection.items.find(it => it.type==='exam' &&
      it.key === key);
    if(existing){
      // Merge: fill in missing date columns
      Object.entries(cells).forEach(([ci, v]) => {
        if(!existing.cells[ci]) existing.cells[ci] = v;
      });
      // Use ref from whichever row has it
      if(!existing.ref && ref) existing.ref = ref;
      if(!existing.unit && unit) existing.unit = unit;
    } else {
      targetSection.items.push({type:'exam', key, name, unit, ref, cells});
    }
  }

  // ── Pass 2: format each section as inline string ──
  const outputLines = [];
  let examCount = 0;

  for(const section of sections){
    if(!section.items.length) continue;

    const parts = []; // inline exam strings for this section

    for(const item of section.items){
      if(item.type === 'comment'){
        parts.push(`${cleanName(item.name)}: ${item.text}`);
        examCount++;
        continue;
      }

      // exam item
      const {name, unit, ref, cells} = item;
      const cName = cleanName(name);

      // Build chronological values (file=recent→old, so reverse colIdx order for chrono)
      const chronoVals = [...dateCols].reverse()
        .map(d => ({colIdx: d.colIdx, val: cells[d.colIdx]||''}))
        .filter(x => x.val && !isNaN(parseFloat(x.val.replace(',','.'))));

      if(!chronoVals.length) continue;
      examCount++;

      const lastVal = chronoVals[chronoVals.length-1].val;
      const firstVal = chronoVals[0].val;
      const firstAbn = isAbn(firstVal, ref);
      const someAbn = chronoVals.some(x => isAbn(x.val, ref));
      const mandatory = ALWAYS_EXACT.test(name);

      const unitStr = (unit && !(name.endsWith('%') && unit==='%')) ? ` ${unit}` : '';
      const refStr = ref ? ` (${ref})` : '';

      // Skip % rows that are all normal (redundant with absolute)
      if(/\s%$/.test(name) && !someAbn) continue;

      let display;
      if(!someAbn){
        if(mandatory){
          display = `${cName} ${lastVal}${unitStr}${refStr}`;
        } else {
          display = null; // will go into "nella norma" list
        }
      } else {
        // Build trend
        // Find peak index
        let peakIdx = chronoVals.length-1, peakSev = 0;
        const m = ref?.match(/([\d.,]+)\s*[-–]\s*([\d.,]+)/);
        if(m){
          const lo = parseFloat(m[1].replace(',','.')), hi = parseFloat(m[2].replace(',','.'));
          chronoVals.forEach((x,j) => {
            const v = parseFloat(x.val.replace(',','.'));
            const sev = Math.max(v-hi, lo-v);
            if(sev > peakSev){ peakSev=sev; peakIdx=j; }
          });
        }

        let trendIndices;
        if(firstAbn){
          // Started abnormal: just last
          trendIndices = [chronoVals.length-1];
        } else {
          // Started normal, became abnormal: first → [peak if distinct] → last
          trendIndices = [0];
          if(peakIdx !== 0 && peakIdx !== chronoVals.length-1) trendIndices.push(peakIdx);
          if(chronoVals.length > 1) trendIndices.push(chronoVals.length-1);
        }
        trendIndices = [...new Set(trendIndices)].sort((a,b)=>a-b);

        const trendParts = trendIndices.map(j => {
          const v = chronoVals[j].val;
          return isAbn(v,ref) ? `**${v}**` : v;
        });

        display = `${cName} ${trendParts.join(' → ')}${unitStr}${refStr}`;
      }

      if(display !== null) parts.push(display);
      else parts.push(`${cName} nella norma`);
    }

    if(parts.length){
      // Separate "nella norma" items from specific values
      // Group: specific values first, then compress all "nella norma" into one item
      const specific = parts.filter(p => !p.endsWith('nella norma'));
      const normali = parts.filter(p => p.endsWith('nella norma'))
        .map(p => p.replace(' nella norma','').trim());
      const finalParts = [...specific];
      if(normali.length === 1){
        finalParts.push(`${normali[0]} nella norma`);
      } else if(normali.length > 1){
        finalParts.push(`${normali.join(', ')} nella norma`);
      }
      outputLines.push(`– ${section.name}: ${finalParts.join('; ')}.`);
    }
  }

  const text = `## ESAMI DI LABORATORIO\n` + outputLines.join('\n');
  const preview = outputLines.join('\n');
  return {text, preview, examCount};
}

// ── formatLabRowsGeneric ──
function formatLabRowsGeneric(rows){
  function clean(v){return String(v==null?'':v).trim();}
  function anonAll(s){
    return s
      .replace(/\bRIC_AO_\d+\b/gi,'[ID_RICOVERO]')
      .replace(/\b\d{7,12}[-/]\d{0,6}\b/g,'[ID_RICOVERO]')
      .replace(/\b(?:CF|C\.F\.)\s*:?\s*[A-Z0-9]{16}\b/gi,'[CODICE_FISCALE]')
      .replace(/\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/g,'[CODICE_FISCALE]');
  }

  let dataStart = 0;
  for(let i = 0; i < Math.min(rows.length, 15); i++){
    const r = rows[i].map(c => clean(c).toLowerCase());
    if(r.some(c => c.includes('metodo') || c.includes('unit') || c.includes('intervallo') || c.includes('riferimento'))){
      dataStart = i + 1;
      break;
    }
  }

  const lines = [];
  let examCount = 0;
  for(let i = dataStart; i < rows.length; i++){
    const row = rows[i].map(c => anonAll(clean(c)));
    const [name, unit, refRange, ...vals] = row;
    if(!name) continue;
    const hasAnyValue = vals.some(v => v && v !== '');
    const isLongComment = !hasAnyValue && name.length > 40;
    const isSection = !hasAnyValue && !isLongComment;
    if(isLongComment){lines.push(`  ※ ${name}`);continue;}
    if(isSection){lines.push('');lines.push(`[${name.toUpperCase()}]`);continue;}
    if(hasAnyValue){
      examCount++;
      const v = vals.find(x => x && x !== '') || '';
      let line = `  ${name}: ${v}`;
      if(unit) line += ` ${unit}`;
      if(refRange) line += ` (rif: ${refRange})`;
      if(isAbnormal(v, refRange)) line += ' ⚠';
      lines.push(line);
    }
  }
  const text = `## ESAMI DI LABORATORIO (da file: ${S_XLS.filename||'referto.xls'})\n` + lines.join('\n');
  const preview = lines.slice(0, 40).join('\n') + (lines.length > 40 ? `\n  ... e altre ${lines.length - 40} righe` : '');
  return {text, preview, examCount};
}

// ── extractLabSectionsFromText ──
function extractLabSectionsFromText(text){
  if(!text) return null;
  // Look for common lab section markers
  const labMarkers = [
    /esami\s+(?:ematochimici|di\s+laboratorio|emato)/i,
    /durante\s+la\s+degenza.*?(?:esami|accertamenti)/i,
    /emocromo/i,
    /profilo\s+(?:metabolico|coagulativo|lipidico|carenziale)/i,
    /indici\s+di\s+flogosi/i,
  ];
  const lines = text.split('\n');
  let inLabSection = false;
  const labLines = [];
  let consecutiveNonLab = 0;
  for(const line of lines){
    const isLabLine = labMarkers.some(r => r.test(line)) ||
      /(?:WBC|RBC|Hb|Ht|MCV|MCH|MCHC|PLT|GB|GR|Piastrine|PCR|VES|INR|APTT|Fibrinogeno|D-dimero|Glucosio|Colesterolo|HDL|LDL|Trigliceridi|Creatinina|Urea|Na|K|Cl|Ca|AST|ALT|GGT|ALP|Bilirubina|CPK|LAD|TnI|TSH|FT3|FT4|HbA1c|Ferritina|Vitamina|Folati|Albumina|Proteine\s+totali)/i.test(line) ||
      /(?:nella\s+norma|v\.n\.|v\.r\.|rif\.:|\(0,00-|\(4,40-|\(140-|\(150-)/i.test(line);
    if(isLabLine){ inLabSection = true; consecutiveNonLab = 0; labLines.push(line); }
    else if(inLabSection){
      consecutiveNonLab++;
      if(consecutiveNonLab <= 3) labLines.push(line); // allow a few blank/header lines
      else if(consecutiveNonLab > 8){ inLabSection = false; consecutiveNonLab = 0; }
      else labLines.push(line);
    }
  }
  const result = labLines.join('\n').trim();
  // Only return extracted version if it's significantly shorter than full text
  return (result.length > 200 && result.length < text.length * 0.8) ? result : null;
}

// ── parseFpJson ──
function parseFpJson(fpStr){
  if(!fpStr) return null;
  try{
    const obj=JSON.parse(fpStr);
    // V3 detection: patologia + decorso_esempio are mandatory in new schema
    if(obj.patologia && obj.decorso_esempio){
      obj._schema = 'v3';
      return obj;
    }
    // V2 legacy detection
    if(obj.lettera_modello){
      obj._schema = 'v2';
      return obj;
    }
    return null;
  }catch(e){ return null; }
}

// ── buildFpSystemAddendum ──
function buildFpSystemAddendum(fpObj){
  if(!fpObj) return '';

  // V3 schema (new structured pathology fingerprint)
  if(fpObj._schema === 'v3' || fpObj.patologia){
    let out='\n\n---\n\n## DECORSO PATOLOGIA-SPECIFICO (FINGERPRINT)\n';
    out+=`\n**Patologia:** ${fpObj.patologia||''}`;
    if(fpObj.diagnosi_pattern)
      out+=`\n\n**Pattern diagnostico:**\n${fpObj.diagnosi_pattern}`;
    if(fpObj.logica_diagnostica)
      out+=`\n\n**Logica diagnostica (criteri positivi e differenziali):**\n${fpObj.logica_diagnostica}`;
    if(Array.isArray(fpObj.checklist_decorso) && fpObj.checklist_decorso.length){
      out+='\n\n**Checklist decorso (step da coprire):**';
      fpObj.checklist_decorso.forEach(s=>{ out+=`\n- ${s}`; });
    }
    if(Array.isArray(fpObj.esami_aggiuntivi) && fpObj.esami_aggiuntivi.length){
      out+='\n\n**Esami aggiuntivi tipici:**';
      fpObj.esami_aggiuntivi.forEach(s=>{ out+=`\n- ${s}`; });
    }
    if(Array.isArray(fpObj.diari_da_monitorare) && fpObj.diari_da_monitorare.length){
      out+='\n\n**Quadri da cercare nelle note di diario:**';
      fpObj.diari_da_monitorare.forEach(s=>{ out+=`\n- ${s}`; });
    }
    if(Array.isArray(fpObj.raccomandazioni_specifiche) && fpObj.raccomandazioni_specifiche.length){
      out+='\n\n**Raccomandazioni alla dimissione tipiche:**';
      fpObj.raccomandazioni_specifiche.forEach(s=>{ out+=`\n- ${s}`; });
    }
    if(fpObj.terapia_pattern)
      out+=`\n\n**Pattern terapia alla dimissione:**\n${fpObj.terapia_pattern}`;
    if(fpObj.note)
      out+=`\n\n**Note speciali:**\n${fpObj.note}`;
    if(fpObj.decorso_esempio){
      out+=`\n\n**Decorso esempio (da una lettera reale — usa SOLO come guida stilistica, NON copiare dati specifici):**\n${fpObj.decorso_esempio}`;
    }
    return out;
  }

  // V2 schema (legacy backward compatibility)
  let out='\n\n---\n\n## MODELLO DI RAGIONAMENTO CLINICO (fingerprint di riferimento)\n';
  const r=fpObj.ragionamento||{};
  if(r.criteri_selezione)      out+=`\n**Criteri di selezione:** ${r.criteri_selezione}`;
  if(r.struttura_logica)       out+=`\n**Struttura logica:** ${r.struttura_logica}`;
  if(r.gestione_incertezza)    out+=`\n**Gestione incertezza:** ${r.gestione_incertezza}`;
  if(r.calibrazione_dettaglio) out+=`\n**Calibrazione dettaglio:** ${r.calibrazione_dettaglio}`;
  if(fpObj.note_stilistiche)   out+=`\n\n## REGISTRO STILISTICO\n${fpObj.note_stilistiche}`;
  const fk=fpObj.frasi_chiave||{};
  if(Object.keys(fk).length){
    out+='\n\n## FRASI E CONNETTORI CARATTERISTICI\n';
    if(fk.apertura?.length)   out+=`- Apertura: "${fk.apertura.join('" / "')}"\n`;
    if(fk.connettori?.length) out+=`- Connettori: ${fk.connettori.join(' | ')}\n`;
    if(fk.incertezza?.length) out+=`- Incertezza: "${fk.incertezza.join('" / "')}"\n`;
    if(fk.terapia_intro)      out+=`- Terapia intro: "${fk.terapia_intro}"\n`;
    if(fk.chiusura?.length)   out+=`- Chiusura: "${fk.chiusura.join('" / "')}"\n`;
  }
  const st=fpObj.struttura_terapia||{};
  if(st.note_speciali) out+=`\n**Farmaci nuovi vs continuativi:** ${st.note_speciali}`;
  // EON schema — top-level field (moved from override_rules); backward compat with old fingerprints
  const eonSchema = fpObj.eon_schema || fpObj.override_rules?.eon_schema || '';
  if (eonSchema.trim()) {
    out+=`\n\n## SCHEMA EON DI NORMALITÀ REPARTO\n${eonSchema}`;
  }
  return out;
}

// ── buildWardFpSystemAddendum ──
function buildWardFpSystemAddendum(fpObj){
  return '';
}

// ── getEffectiveTemplate ──
function getEffectiveTemplate(){
  let base = null;
  if(_userTemplateData && _userTemplateData.base_template_id){
    base = _templates.find(t => t.id === _userTemplateData.base_template_id);
  }
  if(!base) base = _templates.find(t => t.id === 'default') || _templates[0] || DEFAULT_TEMPLATE_EMBEDDED;

  // Deep copy to avoid mutating library
  const eff = JSON.parse(JSON.stringify(base));

  // Apply user overrides if present
  if(_userTemplateData && _userTemplateData.overrides){
    const ov = _userTemplateData.overrides;
    Object.keys(ov).forEach(k => { eff[k] = ov[k]; });
  }
  return eff;
}

// ── renderTemplateForPrompt ──
function renderTemplateForPrompt(tpl){
  const sections = (tpl.ordine_sezioni||[]).map(id => {
    const s = TEMPLATE_SECTIONS_AVAILABLE.find(x => x.id === id);
    return s ? `${id}: ${s.label}` : id;
  });
  let out = '\n\n═══════════════════════════════════════════════════════════════\n';
  out += 'TEMPLATE DELLA LETTERA — STRUTTURA SCELTA\n';
  out += '═══════════════════════════════════════════════════════════════\n\n';
  out += `INTESTAZIONE:\n${tpl.intestazione || ''}\n\n`;
  out += `SALUTO:\n${tpl.saluto || ''}\n\n`;
  out += `APERTURA (dopo il saluto, segue la diagnosi tra virgolette):\n${tpl.apertura || ''}\n\n`;
  out += `ORDINE SEZIONI (segui esattamente questo ordine):\n`;
  sections.forEach((s,i) => { out += `${i+1}. ${s}\n`; });
  out += `\nCHIUSURA:\n${tpl.chiusura || ''}\n\n`;
  out += `FIRMA (due colonne):\n`;
  out += `Sinistra: ${tpl.firma_specializzando_label || '[NOME_SPECIALIZZANDO]'}\n`;
  out += `         (${tpl.firma_ruolo_sx || 'Medico in formazione specialistica'})\n`;
  out += `Destra:  ${tpl.firma_dirigente_label || '[NOME_DIRIGENTE]'}\n`;
  out += `         (${tpl.firma_ruolo_dx || 'Dirigente medico'})\n`;
  return out;
}

// ── renderUserOverrideForPrompt ──
function renderUserOverrideForPrompt(){
  if(!_userOverride || !_userOverride.trim()) return '';
  return '\n\n═══════════════════════════════════════════════════════════════\n' +
         'AGGIUNTE PERSONALI DELL\'UTENTE (override additivo)\n' +
         '═══════════════════════════════════════════════════════════════\n\n' +
         _userOverride.trim();
}

// ── getEffectiveSystemPrompt ──
function getEffectiveSystemPrompt(){
  let out = DEFAULT_SYS;
  out += renderUserOverrideForPrompt();
  out += renderTemplateForPrompt(getEffectiveTemplate());
  return out;
}

// ── buildPreferencesPromptBlock ──
function buildPreferencesPromptBlock(){
  const prefs = S.tempPrefs || S.userPrefs;
  if(!prefs) return '';
  const blocks = [];
  // Only add preference if different from default
  if(prefs.lab !== DEFAULT_USER_PREFS.lab){
    if(prefs.lab === 'altered') blocks.push('- ESAMI DI LABORATORIO: riporta SOLO i valori alterati (fuori range) e i 6 obbligatori (Colesterolo totale, HDL, LDL, Trigliceridi, HbA1c, Creatinina). Per ogni categoria, se tutti nella norma scrivi solo "[Categoria]: nella norma" senza elencare i singoli esami.');
    else blocks.push('- ESAMI DI LABORATORIO: riporta tutti i valori disponibili con range di normalità.');
  }
  if(prefs.acc !== DEFAULT_USER_PREFS.acc){
    if(prefs.acc === 'extended') blocks.push('- ACCERTAMENTI STRUMENTALI: riporta conclusioni estese con tutti i dettagli clinicamente rilevanti del referto.');
    else blocks.push('- ACCERTAMENTI STRUMENTALI: riporta conclusioni sintetiche in 1-2 frasi per ogni accertamento.');
  }
  if(prefs.dec !== DEFAULT_USER_PREFS.dec){
    if(prefs.dec === 'short') blocks.push('- DECORSO CLINICO: sintesi concisa 150-250 parole, solo eventi principali e decisioni terapeutiche.');
    else if(prefs.dec === 'long') blocks.push('- DECORSO CLINICO: racconto dettagliato 400-600 parole con eventi intermedi e ragionamento clinico.');
  }
  if(prefs.an !== DEFAULT_USER_PREFS.an){
    if(prefs.an === 'essential') blocks.push('- ANAMNESI: essenziale, riporta TUTTE le patologie del paziente ma in forma più sintetica (frasi brevi, senza dettagli su decorsi pregressi o terapie ormai concluse, mantenendo solo le informazioni cliniche rilevanti per il quadro attuale).');
  }
  if(prefs.rac !== DEFAULT_USER_PREFS.rac){
    if(prefs.rac === 'main') blocks.push('- RACCOMANDAZIONI: solo le principali (terapia, follow-up clinico).');
  }
  if(prefs.ter !== DEFAULT_USER_PREFS.ter){
    if(prefs.ter === 'lastPlusHome') blocks.push('- TERAPIA ALLA DIMISSIONE: nella tabella della terapia alla dimissione, oltre agli ultimi farmaci prescritti durante il ricovero, includi anche i farmaci della terapia domiciliare che erano stati sospesi solo per esigenze organizzative del ricovero (es. farmaci non disponibili in reparto, sostituiti temporaneamente con equivalenti) e che il paziente dovrà riprendere dopo la dimissione.');
  }
  if(prefs.custom && prefs.custom.trim()){
    blocks.push('- ALTRE PREFERENZE: ' + prefs.custom.trim());
  }
  return blocks.length ? '\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nPREFERENZE UTENTE — applicare SEMPRE\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n' + blocks.join('\n') : '';
}

// ── buildLetterTemplate ──
function buildLetterTemplate(){
  const diagnosi='[DIAGNOSI_PRINCIPALE]';
  const today=new Date().toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit',year:'numeric'});
  const tipo=getLetterTemplateType();
  const ward=(document.getElementById('transferWard')?.value||'altro reparto').trim();

  if(tipo==='trasferimento'){
    return `## TEMPLATE LETTERA — TRASFERIMENTO PRESSO ALTRA STRUTTURA

Genera la lettera seguendo ESATTAMENTE questa struttura. Il paziente NON viene dimesso a domicilio ma trasferito presso ${ward}. Per dati assenti: "Non documentato." — MAI inventare.

---
Padova, ${today}

Egregi Colleghi,
        trasferiamo in data odierna il Sig. **[PAZIENTE_NOME]**, di anni [ETA'] (nato il [DATA_NASCITA]), ricoverato presso il nostro Reparto in data [DD/MM] u.s., presso ${ward} con diagnosi di:

"${diagnosi}"

**In anamnesi:** [APR dall'input — prosa continua]

mRS pre-evento = [valore se presente — solo per stroke/TIA, altrimenti ometti].

**Terapia domiciliare:** [farmaci pre-ricovero dall'input]

[farmacoallergie se documentate, altrimenti: Non farmacoallergie note.]

**Motivo del ricovero:**
[esordio sintomatologico dall'input — passato prossimo — MAI passato remoto]

Presso il Pronto Soccorso AOUP è stato sottoposto a:
– **Esami ematochimici:** [dall'input]
– **TC encefalo:** [dall'input]
– **AngioTC dei vasi intracranici:** [se eseguita — altrimenti ometti]
– **Valutazione neurologica:** [EON verbatim — NIHSS — dall'input]

**Esame obiettivo neurologico all'ingresso in [REPARTO]:**
[EON verbatim dall'input — NIHSS X]

**Esame obiettivo generale all'ingresso in [REPARTO]:**
[dall'input]

Durante la degenza il paziente è stato sottoposto ai seguenti **esami ematochimici:**
- **Emocromo con formula:** [valori o "nella norma"]
- **Profilo coagulativo:** [dall'input]
- **Indici di flogosi:** [dall'input]
- **Funzionalità epatica:** [dall'input]
- **Funzionalità renale con ionemia:** [dall'input]
- **Profilo metabolico:** [dall'input]
- **Profilo proteico:** [dall'input]
- **Enzimi muscolari:** [dall'input]
- **Albumina:** [dall'input]
- **Profilo carenziale:** [dall'input]
- **Funzionalità tiroidea:** [dall'input]
- **ntBNP:** [dall'input]
- **Esame urine:** [dall'input]
- **Microbiologia:** [dall'input]

e alle seguenti **indagini diagnostico-strumentali e valutazioni specialistiche:**
- **ECG (DD/MM):** [dall'input]
- **Rx torace (DD/MM):** [dall'input]
- **TC encefalo (DD/MM):** [dall'input]
- **Valutazione fisiatrica (DD/MM):** [se eseguita]
- [altri accertamenti se presenti nell'input]

**Decorso Clinico:**
[Prosa clinica unica 150-300 parole, passato prossimo, MAI passato remoto, NESSUNA riga vuota interna — sintesi decisioni terapeutiche e andamento. Includere il motivo del trasferimento presso ${ward}.]

**L'obiettività al trasferimento mostra:**
[condizioni neurologiche e generali al trasferimento. NIHSS: XX. mRS: XX. (solo per stroke/TIA — omettere entrambi per altre patologie)]

**Terapia al trasferimento:**

| Farmaco | Posologia | Orario | Note |
|---------|-----------|--------|------|
[Una riga per farmaco — nome+dosaggio | n cp per os | 8.00 o 8.00-20.00 | terapia domiciliare / nuova terapia / nuova terapia fino a rivalutazione]

Si raccomanda:
– [raccomandazione 1]
– [raccomandazione 2]
– [raccomandazione N — una per riga, con trattino lungo (–), basate sull'input]

Rimaniamo a disposizione e porgiamo cordiali saluti.

[FIRMA_MEDICO_FORMAZIONE]                     [FIRMA_DIRIGENTE]
(medici in formazione specialistica)            (Dirigente medico)

---`;
  }

  // Default: DIMISSIONE DIRETTA
  return `## TEMPLATE LETTERA — DIMISSIONE DIRETTA DA [REPARTO]

Genera la lettera seguendo ESATTAMENTE questa struttura. Per dati assenti: "Non documentato." — MAI inventare.

---
Padova, ${today}

Egregi Colleghi,
        dimettiamo in data odierna il Sig. **[PAZIENTE_NOME]**, di anni [ETA'] (nato il [DATA_NASCITA]), ricoverato presso il nostro Reparto in data [DD/MM] u.s. con diagnosi di:

"${diagnosi}"

**In anamnesi:** [APR dall'input — prosa continua]

mRS pre-evento = [valore se presente — solo per stroke/TIA, altrimenti ometti].

**Terapia domiciliare:** [farmaci pre-ricovero dall'input]

[farmacoallergie se documentate, altrimenti: Non farmacoallergie note.]

**Motivo del ricovero:**
[esordio sintomatologico dall'input — passato prossimo — MAI passato remoto]

Presso il Pronto Soccorso AOUP è stato sottoposto a:
– **Esami ematochimici:** [dall'input]
– **TC encefalo:** [dall'input]
– **AngioTC dei vasi intracranici:** [se eseguita — altrimenti ometti]
– **Valutazione neurologica:** [EON verbatim — NIHSS — dall'input]

**Esame obiettivo neurologico all'ingresso in [REPARTO]:**
[EON verbatim dall'input — NIHSS X]

**Esame obiettivo generale all'ingresso in [REPARTO]:**
[dall'input]

Durante la degenza il paziente è stato sottoposto ai seguenti **esami ematochimici:**
- **Emocromo con formula:** [valori o "nella norma"]
- **Profilo coagulativo:** [dall'input]
- **Indici di flogosi:** [dall'input]
- **Funzionalità epatica:** [dall'input]
- **Funzionalità renale con ionemia:** [dall'input]
- **Profilo metabolico:** [dall'input]
- **Profilo proteico:** [dall'input]
- **Enzimi muscolari:** [dall'input]
- **Albumina:** [dall'input]
- **Profilo carenziale:** [dall'input]
- **Funzionalità tiroidea:** [dall'input]
- **ntBNP:** [dall'input]
- **Esame urine:** [dall'input]
- **Microbiologia:** [dall'input]

e alle seguenti **indagini diagnostico-strumentali e valutazioni specialistiche:**
- **ECG (DD/MM):** [dall'input]
- **Rx torace (DD/MM):** [dall'input]
- **TC encefalo (DD/MM):** [dall'input]
- **Valutazione fisiatrica (DD/MM):** [se eseguita]
- [altri accertamenti se presenti nell'input]

**Decorso Clinico:**
[Prosa clinica unica 150-300 parole, passato prossimo, MAI passato remoto, NESSUNA riga vuota interna — sintesi decisioni terapeutiche e andamento]

**L'obiettività alla dimissione mostra:**
[condizioni neurologiche e generali alla dimissione. NIHSS: XX. mRS: XX. (solo per stroke/TIA — omettere entrambi per altre patologie)]

**Terapia alla dimissione:**

| Farmaco | Posologia | Orario | Note |
|---------|-----------|--------|------|
[Una riga per farmaco — nome+dosaggio | n cp per os | 8.00 o 8.00-20.00 | terapia domiciliare / nuova terapia / nuova terapia fino a rivalutazione]

Il paziente è atteso in regime di post-degenza per eseguire **visita neurologica ed ecocolordoppler dei tronchi sovraortici e transcranico** di controllo in data **[DD/MM/YYYY]** alle ore **[HH:MM]** per l'Ambulatorio di Malattie Cerebrovascolari, al piano terra della Palazzina di Neuroscienze.

Si raccomanda:
– [raccomandazione 1]
– [raccomandazione 2]
– [raccomandazione N — una per riga, con trattino lungo (–), basate sull'input]

Rimaniamo a disposizione e porgiamo cordiali saluti.

[FIRMA_MEDICO_FORMAZIONE]                     [FIRMA_DIRIGENTE]
(medici in formazione specialistica)            (Dirigente medico)

---`;
}

// ── buildUserPromptStr ──
function buildUserPromptStr(){
  const{wardFpObj}=getActiveFpObjects();
  const refCase=getRefCase();
  const injectMode=refCase?getRefInjectMode():'none';
  const refFpObj=(injectMode==='fingerprint'||injectMode==='both')?parseFpJson(refCase?.fingerprint||''):null;
  let p='';

  const userFpObj=refFpObj||(!refCase&&wardFpObj?wardFpObj:null);
  if(userFpObj?.lettera_modello){
    const label=(!refCase&&wardFpObj)?'LETTERA-MODELLO REPARTO':'LETTERA-MODELLO DI RIFERIMENTO';
    p+=`## ${label}\n\nQuesta lettera sintetica (con annotazioni →) mostra struttura, ragionamento e stile. Usala come guida strutturale — NON copiare i placeholder, adatta ogni sezione al caso corrente.\n\n${userFpObj.lettera_modello}\n\n---\n\n`;
  }

  if(refCase&&(injectMode==='full'||injectMode==='both')){
    p+=`## ESEMPIO DI RIFERIMENTO — ${refCase.name}\n\nUsa per stile e struttura. NON copiare dati clinici.\n\n`;
    if(refCase.folder) p+=`### Cartella clinica anonimizzata\n\n${refCase.folder}\n\n`;
    if(refCase.letter) p+=`### Lettera di dimissione corrispondente\n\n${refCase.letter}\n\n`;
    p+='---\n\n';
  }

  p+=`## DATI CLINICI ANONIMIZZATI\n\n<clinical_input>\n${S.anonText}\n</clinical_input>\n\n---\n\n`;
  p+=buildLetterTemplate();
  return p;
}

// ── Stato preferenze "Esami Lab" (modello esami_lab) ──
let _eLabMode = 'all';   // 'all' | 'altered'
let _eLabCustom = '';
function getELabCustomText(){ return (_eLabCustom||'').trim(); }

// ── buildEsamiLabPrefsBlock ──
function buildEsamiLabPrefsBlock(){
  const parts = [];
  if(_eLabMode === 'altered'){
    parts.push('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nPREFERENZE UTENTE\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    parts.push('- Riporta SOLO i valori alterati (fuori range) e i 6 obbligatori (Colesterolo totale, HDL, LDL, Trigliceridi, HbA1c, Creatinina). Per ogni categoria con tutti i valori nella norma scrivi "[Categoria]: nella norma".');
  }
  const custom = getELabCustomText();
  if(custom){
    if(!parts.length) parts.push('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nPREFERENZE UTENTE\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    parts.push('- ALTRE PREFERENZE: ' + custom);
  }
  return parts.join('\n');
}

// ── buildEsamiLabUserPrompt ──
function buildEsamiLabUserPrompt(){
  let out = '## ESAMI DI LABORATORIO\n\n';
  if(S_XLS && S_XLS.rawRows && S_XLS.rawRows.length){
    // Use the full formatter for lab-only mode (AI gets structured data)
    const fmt = formatLabRows(S_XLS.rawRows);
    out += fmt.text + '\n\n';
  } else if(S_XLS && S_XLS.text){
    out += S_XLS.text + '\n\n';
  }
  if(S.anonText){
    const labSections = extractLabSectionsFromText(S.anonText);
    if(labSections){
      out += '## ESAMI DALLA CARTELLA CLINICA ANONIMIZZATA\n\n' + labSections + '\n\n';
    } else {
      out += '## CARTELLA CLINICA ANONIMIZZATA\n\n' + S.anonText + '\n\n';
    }
  }
  out += 'Genera SOLO la sezione degli esami ematochimici formattata per la lettera di dimissione, seguendo le regole del prompt di sistema.';
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
   STORAGE — repo GitHub via gh wrapper di CollinettaAI
   ═══════════════════════════════════════════════════════════════════════════ */
function parseFrontmatter(content){
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { fm:{}, body: content };
  let fm = {};
  try { fm = yamlLib().load(m[1]) || {}; } catch(e){ fm = {}; }
  return { fm, body: m[2] || '' };
}
function buildFileContent(fm, body){
  const y = yamlLib().dump(fm, { indent:2, lineWidth:120, noRefs:true });
  return `---\n${y}---\n${body || ''}`;
}

async function ghGet(path){ try { return await ghHost().getFile(path); } catch(e){ return null; } }
async function ghList(path){ try { const r = await ghHost().listDir(path); return Array.isArray(r)?r:[]; } catch(e){ return []; } }

/* ── Storage libreria casi: file unico cases.json (array di casi + reparti) ──
   Replica il design dello standalone: un solo JSON contiene sia i casi
   (oggetti con letter/fingerprint) sia i reparti (oggetti con type:'ward').
   Vantaggio vs cartella di .md: una sola chiamata API per leggere tutto. */
async function loadCasesFile(){
  const f = await ghGet(PATHS.casesFile);
  if (!f || !f.content || !f.content.trim()){ L._casesSha = null; return []; }
  L._casesSha = f.sha;
  try {
    const arr = JSON.parse(f.content);
    return Array.isArray(arr) ? arr : [];
  } catch(e){ console.warn('[LetteraAI] cases.json non valido', e); return []; }
}
async function saveCasesFile(arr){
  const content = JSON.stringify(arr, null, 2);
  const res = await ghHost().putFile(
    PATHS.casesFile, content, L._casesSha || null,
    `LetteraAI — aggiorna libreria casi (by ${username()})`
  );
  // putFile ritorna i metadati col nuovo sha
  if (res && res.content && res.content.sha) L._casesSha = res.content.sha;
  else { const f = await ghGet(PATHS.casesFile); L._casesSha = f ? f.sha : null; }
  return res;
}

/* Bootstrap prompt da repo (identico nello spirito allo standalone) */
async function bootstrapPrompts(){
  for (const [varName, path] of Object.entries(PROMPT_PATHS)){
    const f = await ghGet(path);
    if (f && f.content && f.content.trim()){
      if (varName === 'DEFAULT_SYS') DEFAULT_SYS = f.content;
      else if (varName === 'FINGERPRINT_PROMPT_V3'){ FINGERPRINT_PROMPT_V3 = f.content; FINGERPRINT_PROMPT_V2 = f.content; }
      else if (varName === 'VERIFICA_SYSTEM') VERIFICA_SYSTEM = f.content;
      else if (varName === 'ESAMI_LAB_SYS') ESAMI_LAB_SYS = f.content;
      L.systemPromptSha[varName] = f.sha;
    }
  }
}

/* Bootstrap template library (identico allo standalone: legge templates/*.json) */
async function bootstrapTemplatesRepo(){
  _templates = [DEFAULT_TEMPLATE_EMBEDDED];
  const entries = await ghList(PATHS.templatesDir);
  for (const e of entries){
    if (e.type !== 'file' || !e.name.endsWith('.json')) continue;
    const f = await ghGet(e.path);
    if (!f) continue;
    try { const tpl = JSON.parse(f.content); tpl._sha = f.sha; _templates.push(tpl); } catch(err){}
  }
  L.templates = _templates;
}

/* Carica override + template dell'utente corrente (identico allo standalone) */
async function loadUserOverrideRepo(){
  const path = PATHS.userOverrides + username() + '.md';
  const f = await ghGet(path);
  if (f){ _userOverride = f.content; L.userOverride = f.content; L.userOverrideSha = f.sha; }
  else { _userOverride = ''; L.userOverride = ''; L.userOverrideSha = null; }
}
async function loadUserTemplateRepo(){
  const path = PATHS.userTemplates + username() + '.json';
  const f = await ghGet(path);
  if (f){ try { _userTemplateData = JSON.parse(f.content); L.userTemplateData = _userTemplateData; L.userTemplateSha = f.sha; } catch(e){ _userTemplateData = null; } }
  else { _userTemplateData = null; L.userTemplateData = null; L.userTemplateSha = null; }
}

/* Entry: carica tutto. Chiamato da buildIndex hook + on-demand dalle viste. */
async function loadLibrary(){
  if (!ghHost()) { L.loaded = false; return; }
  await bootstrapPrompts();
  await bootstrapTemplatesRepo();
  await loadUserOverrideRepo();
  await loadUserTemplateRepo();
  // cases.json: separo casi (con lettera) dai reparti (type:'ward')
  const all = await loadCasesFile();
  L.allItems = all;
  L.casi  = all.filter(x => x.type !== 'ward');
  L.wards = all.filter(x => x.type === 'ward');
  L.loaded = true;
  try { stateHost().index.lettere = { casi: L.casi, wards: L.wards }; } catch(e){}
}

/* Aggiunge un nuovo caso all'array e ripusha cases.json */
async function saveCaso(caso){
  const all = await loadCasesFile();
  const id = caso.id || ('tpl_' + Date.now());
  const item = {
    id,
    name: caso.name || caso.diagnosi || id,
    folder: caso.folder || caso.ward || '',
    letter: caso.lettera || caso.letter || '',
    cartella: caso.cartella || '',
    fingerprint: caso.fingerprint || '',
    ward: caso.ward || '',
    diagnosi: caso.diagnosi || '',
    tipo: caso.tipo || 'dimissione',
    wardId: caso.wardId || undefined,
    autore: username(),
    createdAt: new Date().toISOString(),
  };
  // Se è un update (id esistente), sostituisco; altrimenti append
  const idx = all.findIndex(x => x.id === id);
  if (idx >= 0) all[idx] = Object.assign({}, all[idx], item);
  else all.push(item);
  await saveCasesFile(all);
  await loadLibrary();
  return item;
}

/* Elimina un caso dall'array (hard delete: lo standalone non aveva cestino per i casi) */
async function softDeleteCaso(item){
  const all = await loadCasesFile();
  const filtered = all.filter(x => x.id !== item.id);
  await saveCasesFile(filtered);
  await loadLibrary();
}

/* ── Gestione reparti (ward): salvati nello stesso cases.json con type:'ward' ── */
async function createWardRepo(name){
  if (!name || !name.trim()) throw new Error('Nome reparto mancante');
  const all = await loadCasesFile();
  if (all.find(x => x.type === 'ward' && (x.name||'').toLowerCase() === name.trim().toLowerCase()))
    throw new Error('Esiste già un reparto con questo nome');
  all.push({
    id: 'ward_' + Date.now(), type: 'ward', name: name.trim(),
    fingerprint: '', sourceCount: 0, createdAt: new Date().toISOString(),
  });
  await saveCasesFile(all);
  await loadLibrary();
}
async function deleteWardRepo(id){
  const all = await loadCasesFile();
  await saveCasesFile(all.filter(x => x.id !== id));
  await loadLibrary();
}

/* ── Segnalazioni errori (reports.json) ── */
async function loadReportsFile(){
  const f = await ghGet(PATHS.reportsFile);
  if (!f || !f.content || !f.content.trim()){ L._reportsSha = null; return []; }
  L._reportsSha = f.sha;
  try { const arr = JSON.parse(f.content); return Array.isArray(arr) ? arr : []; }
  catch(e){ return []; }
}
async function sendReportRepo(report){
  const existing = await loadReportsFile();
  existing.unshift(report); // più recenti in cima
  const content = JSON.stringify(existing, null, 2);
  const res = await ghHost().putFile(
    PATHS.reportsFile, content, L._reportsSha || null,
    `LetteraAI — segnalazione da ${report.username} [${report.category}]`
  );
  if (res && res.content && res.content.sha) L._reportsSha = res.content.sha;
  return res;
}
async function deleteReportRepo(id){
  const existing = await loadReportsFile();
  const filtered = existing.filter(r => r.id !== id);
  const content = JSON.stringify(filtered, null, 2);
  const res = await ghHost().putFile(
    PATHS.reportsFile, content, L._reportsSha || null,
    `LetteraAI — elimina segnalazione ${id} (by ${username()})`
  );
  if (res && res.content && res.content.sha) L._reportsSha = res.content.sha;
  return res;
}

/* ── Export/Import libreria JSON (backup/ripristino di cases.json) ──
   Export: scarica l'intero array (casi + reparti) come file .json.
   Import: fa merge col contenuto attuale ignorando i duplicati per id, poi ripusha. */
function exportLibraryJson(){
  const arr = L.allItems && L.allItems.length ? L.allItems : [...(L.casi||[]), ...(L.wards||[])];
  if (!arr.length){ toast('Libreria vuota — nulla da esportare.','error'); return; }
  const blob = new Blob([JSON.stringify(arr, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `letteraai_libreria_${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  toast(`Esportati ${arr.length} elementi.`,'success');
}
async function importLibraryJson(file){
  if (!file) return;
  const text = await file.text();
  let imported;
  try { imported = JSON.parse(text); } catch(e){ throw new Error('File JSON non valido: '+e.message); }
  if (!Array.isArray(imported)) throw new Error('Il file non contiene un array JSON valido.');
  const existing = await loadCasesFile();
  const existingIds = new Set(existing.map(x => x.id));
  const newItems = imported.filter(x => x && x.id && !existingIds.has(x.id));
  const merged = [...existing, ...newItems];
  await saveCasesFile(merged);
  await loadLibrary();
  return { imported: imported.length, added: newItems.length, duplicates: imported.length - newItems.length, total: merged.length };
}

async function savePromptToRepo(varName, newText){
  const path = PROMPT_PATHS[varName];
  const res = await ghHost().putFile(path, newText, L.systemPromptSha[varName]||null,
    `Aggiorna ${varName} (by ${username()})`);
  if (varName === 'DEFAULT_SYS') DEFAULT_SYS = newText;
  else if (varName === 'FINGERPRINT_PROMPT_V3'){ FINGERPRINT_PROMPT_V3 = newText; FINGERPRINT_PROMPT_V2 = newText; }
  else if (varName === 'VERIFICA_SYSTEM') VERIFICA_SYSTEM = newText;
  else if (varName === 'ESAMI_LAB_SYS') ESAMI_LAB_SYS = newText;
  if (res.content) L.systemPromptSha[varName] = res.content.sha;
  return res;
}
async function saveUserOverrideToRepo(newText){
  const path = PATHS.userOverrides + username() + '.md';
  const res = await ghHost().putFile(path, newText, L.userOverrideSha||null,
    `Override personale ${username()}`);
  _userOverride = newText; L.userOverride = newText;
  if (res.content) L.userOverrideSha = res.content.sha;
  return res;
}

/* ── Editor template di libreria (admin): push/elimina su templates/<id>.json ── */
async function saveLibraryTemplateRepo(tpl){
  if (!canEdit()) throw new Error('Solo gli amministratori possono modificare i template');
  if (!tpl.id) throw new Error('Template senza id');
  const path = PATHS.templatesDir + tpl.id + '.json';
  // Trova lo sha attuale (se il file esiste già)
  const existing = _templates.find(t => t.id === tpl.id);
  let sha = existing && existing._sha ? existing._sha : null;
  if (!sha){ const f = await ghGet(path); sha = f ? f.sha : null; }
  const clean = Object.assign({}, tpl); delete clean._sha;
  const res = await ghHost().putFile(path, JSON.stringify(clean, null, 2), sha,
    `LetteraAI — salva template ${tpl.id} (by ${username()})`);
  if (res && res.content && res.content.sha) tpl._sha = res.content.sha;
  // Aggiorna copia locale
  const idx = _templates.findIndex(t => t.id === tpl.id);
  if (idx >= 0) _templates[idx] = tpl; else _templates.push(tpl);
  L.templates = _templates;
  return res;
}
async function deleteLibraryTemplateRepo(templateId){
  if (!canEdit()) throw new Error('Solo gli amministratori possono eliminare i template');
  if (templateId === 'default') throw new Error('Il template di default non può essere eliminato');
  const path = PATHS.templatesDir + templateId + '.json';
  const f = await ghGet(path);
  if (!f) throw new Error('Template non trovato sul repository');
  await ghHost().deleteFile(path, f.sha, `LetteraAI — elimina template ${templateId} (by ${username()})`);
  _templates = _templates.filter(t => t.id !== templateId);
  L.templates = _templates;
}

async function saveUserTemplateToRepo(data){
  const path = PATHS.userTemplates + username() + '.json';
  const res = await ghHost().putFile(path, JSON.stringify(data, null, 2), L.userTemplateSha||null,
    `Template personale ${username()}`);
  _userTemplateData = data; L.userTemplateData = data;
  if (res.content) L.userTemplateSha = res.content.sha;
  return res;
}

/* ═══════════════════════════════════════════════════════════════════════════
   RAG — selezione casi simili
   ═══════════════════════════════════════════════════════════════════════════ */
function jaccardKeywords(a, b){
  const ta = new Set(String(a||'').toLowerCase().split(/\W+/).filter(w => w.length>3));
  const tb = new Set(String(b||'').toLowerCase().split(/\W+/).filter(w => w.length>3));
  if (!ta.size || !tb.size) return 0;
  let inter = 0; ta.forEach(w => { if (tb.has(w)) inter++; });
  return inter / (ta.size + tb.size - inter);
}
function selectRAGExamples(ward, diagnosi, tipo, k){
  k = k || 3;
  const scored = L.casi.map(c => ({ caso:c,
    score: ((c.ward||c.folder)===ward?3:0) + jaccardKeywords(c.diagnosi||c.name, diagnosi)*2 + (c.tipo===tipo?1:0) }));
  scored.sort((a,b)=>b.score-a.score);
  return scored.filter(s=>s.score>0).slice(0,k).map(s=>s.caso);
}

/* ═══════════════════════════════════════════════════════════════════════════
   COSTRUZIONE PROMPT FINALE (copia-incolla) — usa la logica di dominio verbatim
   ═══════════════════════════════════════════════════════════════════════════ */
function buildCopyPrompt(wiz){
  // Sincronizza lo shim S con lo stato del wizard
  syncTransferWardDom();
  S.anonText = wiz.anonText;
  S.tempPrefs = wiz.prefs || null;
  S.userPrefs = L.userTemplateData && L.userTemplateData.prefs ? L.userTemplateData.prefs : DEFAULT_USER_PREFS;
  S_XLS.text = wiz.xlsText || '';
  S_XLS.rawRows = wiz.xlsRows || null;
  // Rispetta la modalità di selezione del caso scelta dall'utente:
  // - 'auto' (default): primo esempio RAG
  // - 'manual': mantiene _refCaseId scelto a mano
  // - 'none': nessun caso
  const refMode = (L && L._refMode) || 'auto';
  if (refMode === 'auto'){
    _refCaseId = (wiz.ragExamples && wiz.ragExamples[0]) ? wiz.ragExamples[0].id : null;
    if (_refInjectMode === 'none') _refInjectMode = _refCaseId ? 'fingerprint' : 'none';
  } else if (refMode === 'none'){
    _refCaseId = null; _refInjectMode = 'none';
  }
  // in 'manual' lasciamo _refCaseId e _refInjectMode come impostati dall'utente

  const isLab = wiz.tipo === 'esami_lab';
  let fullSystem, userPrompt;
  if (isLab){
    fullSystem = ESAMI_LAB_SYS + buildEsamiLabPrefsBlock();
    userPrompt = buildEsamiLabUserPrompt();
  } else {
    fullSystem = (wiz.sysPromptOverride!==undefined && wiz.sysPromptOverride!==null && wiz.sysPromptOverride!=='')
      ? wiz.sysPromptOverride : getEffectiveSystemPrompt();
    const { wardFpObj } = getActiveFpObjects();
    const refCase = getRefCase();
    const refFpObj = (_refInjectMode==='fingerprint'||_refInjectMode==='both') ? parseFpJson(refCase?.fingerprint||'') : null;
    // gli addendum si applicano solo se non si sta usando un override manuale completo
    if (!(wiz.sysPromptOverride)){
      if (wardFpObj) fullSystem += buildWardFpSystemAddendum(wardFpObj);
      if (refFpObj)  fullSystem += buildFpSystemAddendum(refFpObj);
      fullSystem += buildPreferencesPromptBlock();
    }
    userPrompt = buildUserPromptStr();
  }
  // Salvo le parti separate per i tab Completo/Istruzioni/Caso Clinico
  wiz._lastSystem = fullSystem;
  wiz._lastUser = userPrompt;
  return fullSystem + '\n\n══════════════════════════════════════\nDATI DEL PAZIENTE\n══════════════════════════════════════\n\n' + userPrompt;
}
// Testo da mostrare nel box prompt secondo il tab selezionato
function _promptViewText(wiz, tab){
  const sys = wiz._lastSystem || '';
  const usr = wiz._lastUser || '';
  if (tab === 'system') return sys;
  if (tab === 'user')   return usr;
  return wiz.builtPrompt || (sys + '\n\n══════════════════════════════════════\nDATI DEL PAZIENTE\n══════════════════════════════════════\n\n' + usr);
}

/* ── Verifica anti-allucinazioni: prompt copia-incolla ──
   Costruisce un prompt che chiede a un'AI esterna di confrontare la lettera con la
   cartella anonimizzata e restituire un array JSON di flag (contraddizioni/assenze/inferenze). */
function buildVerificaPrompt(cartella, lettera){
  const t3 = '```';
  // Usa VERIFICA_SYSTEM (editabile da repo) come istruzione, poi inietta i due testi.
  return `${VERIFICA_SYSTEM}

CARTELLA CLINICA ANONIMIZZATA:
${t3}
${cartella}
${t3}

LETTERA DI DIMISSIONE:
${t3}
${lettera}
${t3}`;
}

/* ── Export/Print lettera ──
   renderLetterPrintHtml: testo → HTML stampabile (paragrafi + interlinea).
   Versione semplificata rispetto allo standalone (niente parsing firma complesso):
   preserva il testo con <pre> per mantenere allineamenti e tabelle testuali. */
function renderLetterPrintHtml(text){
  const escaped = (window.escapeHtml ? window.escapeHtml(text) : String(text||''));
  return `<pre style="white-space:pre-wrap;font-family:'Times New Roman',serif;font-size:12pt;line-height:1.7;margin:0;">${escaped}</pre>`;
}
function printLetter(text){
  if(!text || !text.trim()){ toast('Nessuna lettera da stampare.','error'); return; }
  const w = window.open('', '_blank');
  if(!w){ toast('Popup bloccato dal browser.','error'); return; }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Lettera di dimissione</title>
    <style>body{font-family:'Times New Roman',serif;font-size:12pt;line-height:1.7;margin:2.5cm;color:#000}
    pre{white-space:pre-wrap;font-family:inherit;margin:0}</style></head>
    <body>${renderLetterPrintHtml(text)}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(()=>{ try{ w.print(); }catch(e){} }, 250);
}
/* Export Word via HTML-.doc: genera un file .doc (HTML con MIME Word) che Word apre
   mantenendo font/interlinea. Robusto e senza dipendenze (no RTF della tabella). */
function exportWordDoc(text, filename){
  if(!text || !text.trim()){ toast('Nessuna lettera da esportare.','error'); return; }
  const escaped = (window.escapeHtml ? window.escapeHtml(text) : String(text||''));
  const html = `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office"
    xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="UTF-8"><title>Lettera</title>
    <style>@page{margin:2.5cm}body{font-family:'Times New Roman',serif;font-size:12pt;line-height:1.7}
    pre{white-space:pre-wrap;font-family:inherit;margin:0}</style></head>
    <body><pre>${escaped}</pre></body></html>`;
  const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (filename || 'lettera_dimissione') + '.doc';
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

/* ── Fingerprint: prompt di estrazione + editor strutturato V3 ── */
function buildFingerprintPrompt(cartella, lettera){
  let p = FINGERPRINT_PROMPT_V3;
  if (cartella) p = p.replace('[INCOLLA QUI LA CARTELLA CLINICA ANONIMIZZATA]', cartella);
  if (lettera)  p = p.replace('[INCOLLA QUI LA LETTERA DI DIMISSIONE]', lettera);
  return p;
}
/* I 10 campi del fingerprint V3 (schema patologia-specifico) */
const FP_V3_FIELDS = [
  { k:'patologia',                  label:'Patologia',                       type:'text' },
  { k:'diagnosi_pattern',           label:'Diagnosi pattern',                type:'area', rows:2 },
  { k:'logica_diagnostica',         label:'Logica diagnostica',              type:'area', rows:4 },
  { k:'decorso_esempio',            label:'Decorso esempio (narrativo)',     type:'area', rows:8 },
  { k:'checklist_decorso',          label:'Checklist decorso',               type:'list' },
  { k:'esami_aggiuntivi',           label:'Esami aggiuntivi',                type:'list' },
  { k:'diari_da_monitorare',        label:'Diari da monitorare',             type:'list' },
  { k:'raccomandazioni_specifiche', label:'Raccomandazioni specifiche',      type:'list' },
  { k:'terapia_pattern',            label:'Terapia pattern',                 type:'area', rows:3 },
  { k:'note',                       label:'Note (vincoli speciali)',         type:'area', rows:3 },
];
/* Rende un editor a campi per il fingerprint V3 dentro un container.
   Restituisce l'HTML; la lettura avviene con readFpV3Editor(prefix). */
function renderFpV3EditorHtml(fpObj, prefix){
  fpObj = fpObj || {};
  return FP_V3_FIELDS.map(f=>{
    const id = prefix + '_' + f.k;
    const val = fpObj[f.k];
    if (f.type === 'text')
      return `<div class="field"><label>${f.label}</label><input type="text" id="${id}" value="${escapeHtml(val||'')}"></div>`;
    if (f.type === 'list'){
      const txt = Array.isArray(val) ? val.join('\n') : '';
      return `<div class="field"><label>${f.label} (uno per riga)</label><textarea id="${id}" rows="4" class="mono-input">${escapeHtml(txt)}</textarea></div>`;
    }
    return `<div class="field"><label>${f.label}</label><textarea id="${id}" rows="${f.rows||3}" class="mono-input">${escapeHtml(val||'')}</textarea></div>`;
  }).join('');
}
function readFpV3Editor(prefix){
  const get = (k)=>{ const el=document.getElementById(prefix+'_'+k); return el?el.value:''; };
  const lines = (k)=> get(k).split('\n').map(s=>s.trim()).filter(Boolean);
  const out = {};
  FP_V3_FIELDS.forEach(f=>{
    if (f.type==='list') out[f.k] = lines(f.k);
    else out[f.k] = get(f.k);
  });
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
   PARSING PDF / XLS (lazy-load)
   ═══════════════════════════════════════════════════════════════════════════ */
async function extractPdfText(file){
  // Riusa pdf.js se index.html (CollinettaAI) l'ha già caricato; altrimenti caricalo.
  if (!window.pdfjsLib) await loadScriptOnce(CDN.pdfjs);
  if (!window.pdfjsLib) throw new Error('pdf.js non disponibile dopo il caricamento.');
  // Configura il worker solo se non già impostato (index.html lo configura al load)
  if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) window.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfworker;
  const buf = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
  let full = '';
  for (let i=1;i<=pdf.numPages;i++){
    const page = await pdf.getPage(i);
    const ct = await page.getTextContent();
    // Ricostruisce i ritorni a capo (come l'app originale): nuova riga quando la
    // coordinata Y (transform[5]) cambia di oltre 5px, più i fine-riga espliciti (hasEOL).
    let pt='', ly=null;
    for (const it of ct.items){
      if ('str' in it){
        if (ly!==null && Math.abs(it.transform[5]-ly)>5) pt+='\n';
        pt += it.str;
        if (it.hasEOL) pt+='\n';
        ly = it.transform[5];
      }
    }
    full += pt.trim() + '\n\n';
  }
  return full.replace(/\n{3,}/g,'\n\n').trim();
}
async function extractXlsRows(file){
  if (!window.XLSX) await loadScriptOnce(CDN.sheetjs);
  const XLS = window.XLSX;
  if (!XLS) throw new Error('SheetJS (xlsx) non disponibile dopo il caricamento.');
  const buf = await file.arrayBuffer();
  const wb = XLS.read(buf, { type:'array', cellText:true, cellDates:true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLS.utils.sheet_to_json(ws, { header:1, defval:'', raw:false });
}

/* ═══════════════════════════════════════════════════════════════════════════
   VIEWS — render in #main-content
   ═══════════════════════════════════════════════════════════════════════════ */
function mc(){ return document.getElementById('main-content'); }
function pageHead(title, eyebrow, actionsHtml){
  return `<div class="page-head"><div>
    ${eyebrow?`<div class="page-eyebrow">${escapeHtml(eyebrow)}</div>`:''}
    <div class="page-title">${escapeHtml(title)}</div></div>
    ${actionsHtml?`<div class="page-head-actions">${actionsHtml}</div>`:''}</div>`;
}
function newWizard(seed){
  return Object.assign({
    step:1, rawText:'', anonText:'', substitutions:[], patientData:{nome:'',cognome:'',dataNascita:''}, strippedBlocks:[], ward:'', diagnosi:'', tipo:'dimissione',
    prefs: JSON.parse(JSON.stringify(L.userTemplateData&&L.userTemplateData.prefs?L.userTemplateData.prefs:DEFAULT_USER_PREFS)),
    xlsText:'', xlsRows:null, ragExamples:[], builtPrompt:'', outputLetter:'', fingerprint:'',
  }, seed||{});
}

function renderLettereHome(){
  if (!L.loaded){
    if (L._homeLoadAttempted){
      // loadLibrary è già stata tentata ma L.loaded resta false (es. gh non disponibile):
      // mostro un errore invece di riciclare all'infinito (causava il freeze di Chrome).
      mc().innerHTML = pageHead('LetteraAI','Generatore lettere di dimissione') +
        `<div class="lt-note" style="border-left-color:var(--danger);color:var(--danger);">
          Impossibile caricare la libreria. Verifica di aver effettuato l'accesso e che la
          connessione a GitHub sia attiva. Ricarica la pagina e riprova.</div>`;
      return;
    }
    L._homeLoadAttempted = true;
    mc().innerHTML = `<div class="loading"><span class="spinner"></span> Caricamento libreria lettere...</div>`;
    loadLibrary().then(renderLettereHome).catch(e => {
      console.error('[LetteraAI] loadLibrary', e);
      renderLettereHome();
    });
    return;
  }
  L._homeLoadAttempted = false;
  const adminItems = canEdit() ? `
    <div class="lt-home-row" onclick="navigate('lettere-segnalazioni-admin')">
      <span class="lt-home-ic">📋</span><div><div class="lt-home-t">Segnalazioni</div><div class="lt-home-d">Segnalazioni ricevute dagli utenti (admin).</div></div></div>
    <div class="lt-home-row" onclick="navigate('lettere-config')">
      <span class="lt-home-ic">📝</span><div><div class="lt-home-t">Editor Prompt</div><div class="lt-home-d">Prompt di sistema e libreria template (admin).</div></div></div>` : '';
  mc().innerHTML = pageHead('LetteraAI','Generatore lettere di dimissione',
    `<button class="btn" onclick="window.Lettere.nuova()">Nuova lettera</button>`) + `
    <div class="lt-home-group">Flusso di generazione</div>
    <div class="lt-home-list">
      <div class="lt-home-row" onclick="navigate('lettere-carica')">
        <span class="lt-home-n">1</span><div><div class="lt-home-t">Carica cartella</div><div class="lt-home-d">Incolla o carica la cartella clinica (testo, PDF, esami XLS).</div></div></div>
      <div class="lt-home-row" onclick="navigate('lettere-anonimizza')">
        <span class="lt-home-n">2</span><div><div class="lt-home-t">Anonimizza dati</div><div class="lt-home-d">Rimuove i dati identificativi del paziente. Rivedi le sostituzioni.</div></div></div>
      <div class="lt-home-row" onclick="navigate('lettere-genera')">
        <span class="lt-home-n">3</span><div><div class="lt-home-t">Genera lettera</div><div class="lt-home-d">Opzioni (reparto, tipo, preferenze) e prompt da copiare nell'AI esterna.</div></div></div>
      <div class="lt-home-row" onclick="navigate('lettere-verifica')">
        <span class="lt-home-n">4</span><div><div class="lt-home-t">Verifica</div><div class="lt-home-d">Controllo anti-allucinazioni: confronta cartella e lettera.</div></div></div>
      <div class="lt-home-row" onclick="navigate('lettere-esporta')">
        <span class="lt-home-n">5</span><div><div class="lt-home-t">Esporta</div><div class="lt-home-d">Stampa o esporta in Word, salva il caso in libreria.</div></div></div>
    </div>
    <div class="lt-home-group">Strumenti</div>
    <div class="lt-home-list">
      <div class="lt-home-row" onclick="navigate('lettere-libreria')">
        <span class="lt-home-ic">📚</span><div><div class="lt-home-t">Libreria Casi <span class="lt-badge">${L.casi.length}</span></div><div class="lt-home-d">Esempi anonimizzati con fingerprint di stile, e gestione reparti.</div></div></div>
      <div class="lt-home-row" onclick="navigate('lettere-impostazioni')">
        <span class="lt-home-ic">⚙</span><div><div class="lt-home-t">Impostazioni</div><div class="lt-home-d">Preferenze di default per la generazione delle lettere.</div></div></div>
      <div class="lt-home-row" onclick="navigate('lettere-personalizzazioni')">
        <span class="lt-home-ic">✦</span><div><div class="lt-home-t">Mie personalizzazioni</div><div class="lt-home-d">Template personale e regole aggiuntive.</div></div></div>
      <div class="lt-home-row" onclick="navigate('lettere-segnalazioni')">
        <span class="lt-home-ic">⚠</span><div><div class="lt-home-t">Segnala Errori</div><div class="lt-home-d">Segnala errori o suggerimenti.</div></div></div>
      ${adminItems}
    </div>`;
}

/* ── Wizard ── */
function renderWizard(){
  if (!L.wiz) L.wiz = newWizard();
  const w = L.wiz;
  const steps = ['Input','Anonimizza','Opzioni','Prompt'];
  const stepNav = steps.map((s,i)=>{const n=i+1;const cls=n===w.step?'active':(n<w.step?'done':'');
    return `<div class="lt-step ${cls}" onclick="window.Lettere.goStep(${n})"><span class="lt-step-n">${n}</span><span class="lt-step-l">${s}</span></div>`;
  }).join('<span class="lt-step-sep"></span>');
  let body = w.step===1?wizStep1():w.step===2?wizStep2():w.step===3?wizStep3():wizStep4();
  mc().innerHTML = pageHead('Nuova lettera','Generatore lettere',
    `<button class="btn ghost" onclick="navigate('lettere')">Chiudi</button>`) +
    `<div class="lt-steps">${stepNav}</div><div class="lt-wizbody">${body}</div>`;
  if (w.step===1){ const t=document.getElementById('lt-raw'); if(t) t.value=w.rawText; }
  if (w.step===2){ const t=document.getElementById('lt-anon'); if(t) t.value=w.anonText; }
  if (w.step===4){ const t=document.getElementById('lt-out'); if(t) t.value=w.outputLetter; }
}

function wizStep1(){
  const w=L.wiz||{};
  const xlsLoaded = w.xlsText && w.xlsText.trim();
  return `
    <div class="lt-card-static">
      <div class="lt-side-title">Carica PDF cartella clinica completa</div>
      <div class="lt-dropzone" onclick="document.getElementById('lt-pdf').click()"
        ondragover="event.preventDefault();this.classList.add('drag')"
        ondragleave="this.classList.remove('drag')"
        ondrop="event.preventDefault();this.classList.remove('drag');window.Lettere._onPdf(event.dataTransfer.files[0])">
        <input type="file" id="lt-pdf" accept="application/pdf" multiple style="display:none" onchange="window.Lettere._onPdf(this.files[0])">
        <div class="lt-dz-ic">📁</div>
        <div class="lt-dz-txt"><strong>Clicca o trascina uno o più PDF</strong></div>
      </div>
      <div id="lt-pdf-status" class="lt-dz-status" style="display:none"><span id="lt-pdf-status-txt"></span></div>
    </div>

    <div class="lt-card-static">
      <div class="lt-side-title">Carica tabella esami di laboratorio — opzionale</div>
      <div class="lt-dropzone" onclick="document.getElementById('lt-xls').click()"
        ondragover="event.preventDefault();this.classList.add('drag')"
        ondragleave="this.classList.remove('drag')"
        ondrop="event.preventDefault();this.classList.remove('drag');window.Lettere._onXls(event.dataTransfer.files[0])">
        <input type="file" id="lt-xls" accept=".xls,.xlsx,.csv" style="display:none" onchange="window.Lettere._onXls(this.files[0])">
        <div class="lt-dz-ic">🧪</div>
        <div class="lt-dz-txt"><strong>Clicca o trascina XLS</strong></div>
      </div>
      <div id="lt-xls-status" class="lt-dz-status" style="display:none"><span id="lt-xls-status-txt"></span></div>
      ${xlsLoaded?`<div class="lt-xls-preview">
        <div class="lt-xls-preview-h">Anteprima valori estratti</div>
        <div class="lt-xls-preview-c">${escapeHtml(w.xlsText.slice(0,2000))}</div>
        <div class="lt-row" style="margin-top:8px"><button class="btn ghost sm" onclick="window.Lettere._clearXls()">✕ Rimuovi</button></div>
      </div>`:''}
    </div>

    <div class="field"><label>Testo cartella clinica completa</label>
      <textarea id="lt-raw" rows="12" class="mono-input" placeholder="Incolla qui il testo copiato dal PDF della cartella clinica"
        oninput="window.Lettere._set('rawText', this.value)"></textarea></div>
    <div class="lt-wiz-actions">
      <button class="btn ghost" onclick="window.Lettere._clearAll()">✕ Reset</button>
      <button class="btn" onclick="window.Lettere._caricaNext()">Avanti → Anonimizza</button></div>`;
}
function wizStep2(){
  const w=L.wiz;
  const subsList=(w.substitutions||[]).slice(0,200).map(s=>`<div class="lt-sub"><code>${escapeHtml((s.orig||'').slice(0,50))}</code> → <span>${escapeHtml(s.repl||'')}</span>${s.type?`<span class="lt-sub-type">${escapeHtml(s.type)}</span>`:''}</div>`).join('')||'<div class="lt-sub-empty">Nessuna sostituzione.</div>';
  const nSub=(w.substitutions||[]).length;
  const open = L._anonSubsOpen ? ' open' : '';
  // Sezione "Blocchi rimossi" (righe amministrative/boilerplate eliminate per ridurre i token)
  const blocks=(w.strippedBlocks||[]);
  const nBlk=blocks.length;
  const blkOpen = L._strippedOpen ? ' open' : '';
  const blkList=blocks.slice(0,300).map(b=>`<div class="lt-sub"><span class="lt-sub-type">✂ ${escapeHtml(b.tag||'Boilerplate')}</span> <code>${escapeHtml((b.text||'').slice(0,90))}</code></div>`).join('')||'<div class="lt-sub-empty">Nessun blocco rimosso.</div>';
  const blkSection = nBlk ? `
    <div class="lt-collapsible${blkOpen}" id="lt-stripped">
      <button class="lt-collapsible-toggle" onclick="window.Lettere._toggleStripped()">
        <span class="lt-ct-icon">▶</span>
        <span class="lt-ct-label">✂ Blocchi rimossi (righe amministrative)</span>
        <span class="lt-ct-count">${nBlk}</span>
      </button>
      <div class="lt-collapsible-body"><div class="lt-subs">${blkList}</div></div>
    </div>` : '';
  return `
    <div class="lt-collapsible${open}" id="lt-anon-subs">
      <button class="lt-collapsible-toggle" onclick="window.Lettere._toggleAnonSubs()">
        <span class="lt-ct-icon">▶</span>
        <span class="lt-ct-label">🛡 Anonimizzazioni applicate</span>
        <span class="lt-ct-count">${nSub}</span>
      </button>
      <div class="lt-collapsible-body"><div class="lt-subs">${subsList}</div></div>
    </div>
    ${blkSection}
    <div class="lt-diff-grid">
      <div class="lt-diff-col">
        <div class="lt-dlabel">Testo cartella clinica completa da anonimizzare</div>
        <div class="lt-diff-scroll"><div class="lt-dtext" id="lt-orig">${escapeHtml(w.rawText||'—')}</div></div>
      </div>
      <div class="lt-diff-col">
        <div class="lt-dlabel">Testo anonimizzato <span class="lt-edit-hint">✏ modificabile</span></div>
        <div class="lt-diff-scroll"><textarea id="lt-anon" class="lt-dtext" oninput="window.Lettere._set('anonText', this.value)"></textarea></div>
      </div>
    </div>
    <div class="lt-note" style="border-left-color:var(--danger);color:var(--danger)">⚠ Verifica il testo a destra. Correggi manualmente qualsiasi dato rimasto prima di procedere.</div>
    <div class="lt-wiz-actions"><button class="btn ghost" onclick="navigate('lettere-carica')">← Indietro</button>
      <button class="btn" onclick="navigate('lettere-genera')">Avanti → Genera</button></div>`;
}
function wizStep3(){
  const w=L.wiz, p=w.prefs;
  const wardOpts=WARDS.map(x=>`<option${x===w.ward?' selected':''}>${escapeHtml(x)}</option>`).join('');
  const tipoOpts=TIPI.map(t=>`<option value="${t.id}"${t.id===w.tipo?' selected':''}>${escapeHtml(t.label)}</option>`).join('');
  const rag=(w.ragExamples||[]).map(c=>`<div class="lt-rag"><strong>${escapeHtml(c.diagnosi||c.name||c.id)}</strong><span>${escapeHtml(c.ward||c.folder||'')} · ${escapeHtml(c.tipo||'')}</span></div>`).join('')||'<div class="lt-sub-empty">Nessun esempio simile in libreria.</div>';
  const seg=(key,opts)=>opts.map(o=>`<button class="lt-seg${p[key]===o.v?' on':''}" onclick="window.Lettere._setPref('${key}','${o.v}')">${o.l}</button>`).join('');
  return `<div class="lt-row">
      <div class="field" style="flex:1"><label>Reparto</label><select onchange="window.Lettere._setWard(this.value)">${wardOpts}</select></div>
      <div class="field" style="flex:1"><label>Tipo lettera</label><select onchange="window.Lettere._setTipo(this.value)">${tipoOpts}</select></div>
    </div>
    <div class="field"><label>Diagnosi principale</label><input type="text" value="${escapeHtml(w.diagnosi)}" oninput="window.Lettere._setDiag(this.value)" placeholder="es. ictus ischemico territorio MCA dx"></div>
    <div class="lt-prefs">
      <div class="lt-pref-row"><label>Esami laboratorio</label><div class="lt-segs">${seg('lab',[{v:'all',l:'Tutti'},{v:'altered',l:'Solo patologici'}])}</div></div>
      <div class="lt-pref-row"><label>Accertamenti strumentali</label><div class="lt-segs">${seg('acc',[{v:'brief',l:'Sintetici'},{v:'extended',l:'Estesi'}])}</div></div>
      <div class="lt-pref-row"><label>Decorso clinico</label><div class="lt-segs">${seg('dec',[{v:'short',l:'Breve'},{v:'standard',l:'Standard'},{v:'long',l:'Esteso'}])}</div></div>
      <div class="lt-pref-row"><label>Anamnesi</label><div class="lt-segs">${seg('an',[{v:'essential',l:'Essenziale'},{v:'complete',l:'Completa'}])}</div></div>
      <div class="lt-pref-row"><label>Raccomandazioni</label><div class="lt-segs">${seg('rac',[{v:'main',l:'Principali'},{v:'all',l:'Tutte'}])}</div></div>
      <div class="lt-pref-row"><label>Terapia dimissione</label><div class="lt-segs">${seg('ter',[{v:'last',l:'Ultima'},{v:'lastPlusHome',l:'+ domiciliare'}])}</div></div>
      <div class="field"><label>Altre preferenze (testo libero)</label><textarea rows="2" oninput="window.Lettere._setPref('custom', this.value)">${escapeHtml(p.custom||'')}</textarea></div>
      <div class="lt-row" style="justify-content:flex-end"><button class="btn ghost sm" onclick="window.Lettere._resetPrefs()" title="Ripristina le preferenze salvate">↺ Ripristina preferenze</button></div>
    </div>
    <div class="lt-side-title">Esempi simili (fingerprint usato come riferimento)</div><div class="lt-rags">${rag}</div>`;
}
// wizStep3Combined: pagina "Genera" con disposizione a card identica all'originale (panel2).
function wizStep3Combined(){
  const w=L.wiz, p=w.prefs;
  // ── Card 1: Modello di lettera (tile selezionabili) ──
  const tile=(id,icon,label)=>`<label class="lt-tile${w.tipo===id?' on':''}" onclick="window.Lettere._setTipo('${id}')">
    <span class="lt-tile-l">${icon} ${label}</span></label>`;
  const transferRow = w.tipo==='trasferimento' ? `
    <div class="field" style="margin-top:10px"><label>Struttura / reparto di destinazione</label>
      <input type="text" value="${escapeHtml(w.transferWard||'')}" placeholder="es. Riabilitazione Neurologica, Ospedale di Vicenza" oninput="window.Lettere._set('transferWard', this.value)"></div>` : '';
  const cardModello=`<div class="lt-card-static">
    <div class="lt-side-title">Modello di lettera</div>
    <div class="lt-tiles">${tile('dimissione','🏠','Dimissione')}${tile('trasferimento','🏥','Trasferimento')}${tile('esami_lab','🧪','Esami Lab')}</div>
    ${transferRow}</div>`;
  const isLab = w.tipo==='esami_lab';

  // ── Card 2: Caso di riferimento (tab auto/manuale/nessuno + inject) ──
  const refMode = L._refMode || 'auto';
  const refTab=(m,label,title)=>`<button class="lt-tab${refMode===m?' on':''}" title="${title}" onclick="window.Lettere._setRefMode('${m}')">${label}</button>`;
  // Dropdown manuale
  let manualRow='';
  if(refMode==='manual'){
    const wardNames=[...new Set(L.casi.map(c=>c.ward||c.folder).filter(Boolean))];
    const wardFilterOpts=`<option value="__all__">Tutti i reparti</option>`+wardNames.map(n=>`<option value="${escapeHtml(n)}"${L._refWardFilter===n?' selected':''}>${escapeHtml(n)}</option>`).join('');
    const filtered=L.casi.filter(c=>!L._refWardFilter||L._refWardFilter==='__all__'||(c.ward||c.folder)===L._refWardFilter);
    const caseOpts=`<option value="">— Seleziona un caso —</option>`+filtered.map(c=>`<option value="${escapeHtml(c.id)}"${_refCaseId===c.id?' selected':''}>${escapeHtml(c.diagnosi||c.name||c.id)} — ${escapeHtml(c.ward||c.folder||'')}</option>`).join('');
    manualRow=`<div style="margin-bottom:10px">
      <div class="lt-row" style="align-items:center;gap:8px;margin-bottom:8px"><label style="margin:0;white-space:nowrap;font-size:11px">🏥 Reparto</label>
        <select onchange="window.Lettere._setRefWardFilter(this.value)" style="flex:1">${wardFilterOpts}</select></div>
      <select onchange="window.Lettere._setRefCase(this.value)" style="width:100%">${caseOpts}</select></div>`;
  }
  // Auto info
  let autoInfo='';
  if(refMode==='auto'){
    const auto=(w.ragExamples&&w.ragExamples[0]);
    autoInfo=`<div class="lt-status" style="margin-bottom:10px">${auto?`Caso selezionato automaticamente: <strong>${escapeHtml(auto.diagnosi||auto.name||auto.id)}</strong> (${escapeHtml(auto.ward||auto.folder||'')})`:'Nessun caso simile trovato in libreria.'}</div>`;
  }
  // Inject mode (nascosto se Nessuno)
  const injMode=_refInjectMode==='none'?'fingerprint':_refInjectMode;
  const injRow = refMode!=='none' ? `
    <div style="margin-top:8px;padding-top:10px;border-top:1px solid var(--rule-soft)">
      <div class="lt-side-title" style="margin-bottom:8px">Cosa iniettare nel prompt</div>
      <div class="lt-tabs">
        <button class="lt-tab${injMode==='fingerprint'?' on':''}" title="Solo il decorso (ragionamento + lettera-modello sintetica) — pochi token" onclick="window.Lettere._setRefInject('fingerprint')">Solo decorso</button>
        <button class="lt-tab${injMode==='full'?' on':''}" title="Cartella e lettera complete del caso — più token, più contestuale" onclick="window.Lettere._setRefInject('full')">Cartella + Lettera</button>
      </div></div>` : '';
  const cardRef=`<div class="lt-card-static">
    <div class="lt-side-title">Caso di riferimento</div>
    <div class="lt-tabs" style="margin-bottom:10px">${refTab('auto','Automatico','Caso più simile dalla libreria')}${refTab('manual','Manuale','Scegli un caso')}${refTab('none','Nessuno','Solo system prompt e template')}</div>
    ${autoInfo}${manualRow}${injRow}</div>`;

  // ── Card 3: Preferenze lettera (collassabile) ──
  const seg=(key,opts)=>opts.map(o=>`<button class="lt-tab${p[key]===o.v?' on':''}" onclick="window.Lettere._setPref('${key}','${o.v}')">${o.l}</button>`).join('');
  const prefOpen=L._prefsOpen?' open':'';
  const cardPrefs=`<div class="lt-collapsible${prefOpen}" id="lt-prefs-coll">
    <button class="lt-collapsible-toggle" onclick="window.Lettere._togglePrefs()">
      <span class="lt-ct-icon">▶</span><span class="lt-ct-label">Preferenze lettera</span></button>
    <div class="lt-collapsible-body">
      <div class="lt-prefblock"><label>Esami di laboratorio</label><div class="lt-tabs">${seg('lab',[{v:'all',l:'Tutti i valori'},{v:'altered',l:'Solo patologici'}])}</div></div>
      <div class="lt-prefblock"><label>Accertamenti strumentali</label><div class="lt-tabs">${seg('acc',[{v:'brief',l:'Sintetici'},{v:'extended',l:'Estesi'}])}</div></div>
      <div class="lt-prefblock"><label>Decorso clinico</label><div class="lt-tabs">${seg('dec',[{v:'short',l:'Conciso'},{v:'standard',l:'Standard'},{v:'long',l:'Dettagliato'}])}</div></div>
      <div class="lt-prefblock"><label>Anamnesi</label><div class="lt-tabs">${seg('an',[{v:'essential',l:'Essenziale'},{v:'complete',l:'Completa'}])}</div></div>
      <div class="lt-prefblock"><label>Raccomandazioni</label><div class="lt-tabs">${seg('rac',[{v:'main',l:'Principali'},{v:'all',l:'Tutte'}])}</div></div>
      <div class="lt-prefblock"><label>Terapia alla dimissione</label><div class="lt-tabs">${seg('ter',[{v:'last',l:'Ultima terapia'},{v:'lastPlusHome',l:'Ultima terapia + domiciliare'}])}</div></div>
      <div class="lt-prefblock"><label>Altre preferenze</label><textarea rows="3" placeholder="Aggiungi preferenze..." oninput="window.Lettere._setPref('custom', this.value)">${escapeHtml(p.custom||'')}</textarea></div>
      <div class="lt-row" style="margin-top:6px"><button class="btn ghost sm" onclick="window.Lettere._resetPrefs()" title="Ripristina le preferenze salvate">↺ Ripristina salvate</button></div>
    </div></div>`;

  // ── Card preferenze Esami di Laboratorio (mostrata solo in modalità esami_lab) ──
  const elabSeg=(v,l,title)=>`<button class="lt-tab${_eLabMode===v?' on':''}" title="${title}" onclick="window.Lettere._setELab('${v}')">${l}</button>`;
  const cardELab=`<div class="lt-card-static">
    <div class="lt-side-title">Preferenze esami di laboratorio</div>
    <div class="lt-prefblock"><label>Valori da includere</label>
      <div class="lt-tabs">${elabSeg('all','Tutti i valori','Tutti i valori con unità e range')}${elabSeg('altered','Solo patologici','Solo i valori alterati + i 6 obbligatori')}</div></div>
    <div class="lt-prefblock"><label>Altre preferenze</label>
      <textarea rows="2" placeholder="Aggiungi istruzioni specifiche per questa sezione..." oninput="window.Lettere._setELabCustom(this.value)">${escapeHtml(_eLabCustom||'')}</textarea></div>
  </div>`;

  // ── Diagnosi (campo necessario al RAG, non c'era come card a sé nell'originale ma serve) ──
  const cardDiag=`<div class="field"><label>Diagnosi principale</label>
    <input type="text" value="${escapeHtml(w.diagnosi||'')}" oninput="window.Lettere._setDiag(this.value)" placeholder="es. ictus ischemico territorio MCA dx"></div>`;

  // ── Card "Istruzioni generali" (system prompt modificabile inline, collassabile) ──
  const sysOpen=L._sysPromptOpen?' open':'';
  const sysVal = (w.sysPromptOverride!==undefined && w.sysPromptOverride!==null) ? w.sysPromptOverride : getEffectiveSystemPrompt();
  const cardSys = isLab ? '' : `<div class="lt-collapsible${sysOpen}" id="lt-sys-coll">
    <button class="lt-collapsible-toggle" onclick="window.Lettere._toggleSysPrompt()">
      <span class="lt-ct-icon">▶</span><span class="lt-ct-label">Istruzioni generali — modificabili</span></button>
    <div class="lt-collapsible-body">
      <textarea id="lt-sysprompt" rows="10" class="mono-input" oninput="window.Lettere._setSysPrompt(this.value)">${escapeHtml(sysVal)}</textarea>
      <div class="lt-row" style="margin-top:8px"><button class="btn ghost sm" onclick="window.Lettere._resetSysPrompt()">⟲ Ripristina istruzioni di default</button></div>
    </div></div>`;

  // ── Card 4: Prompt completo (con tab Completo/Istruzioni/Caso Clinico) ──
  const ptab = L._promptTab || 'full';
  const ptabBtn=(k,l)=>`<button class="lt-tab${ptab===k?' on':''}" onclick="window.Lettere._setPromptTab('${k}')">${l}</button>`;
  const cardPrompt=`<div class="lt-card-static">
    <div class="lt-side-title">Prompt completo</div>
    <div class="lt-tabs" style="margin-bottom:10px">${ptabBtn('full','Completo')}${ptabBtn('system','Istruzioni')}${ptabBtn('user','Caso clinico')}</div>
    <textarea id="lt-prompt" rows="12" class="mono-input" readonly>${escapeHtml(_promptViewText(w, ptab))}</textarea>
    <div class="lt-row" style="margin-top:8px">
      <button class="btn sm" onclick="window.Lettere._copyPrompt()">⎘ Copia prompt per AI esterna</button>
      <button class="btn ghost sm" onclick="window.Lettere._rebuildPrompt()">↻ Ricostruisci</button></div></div>`;

  // ── Card lettera generata (incolla risposta AI) ──
  const cardOut=`<div class="lt-card-static">
    <div class="lt-side-title">Lettera generata (incolla la risposta dell'AI)</div>
    <textarea id="lt-out" rows="12" placeholder="Incolla qui la lettera prodotta..." oninput="window.Lettere._set('outputLetter', this.value)">${escapeHtml(w.outputLetter||'')}</textarea>
    <div class="lt-row" style="margin-top:6px"><button class="btn ghost sm" onclick="window.Lettere._pasteInto('lt-out')">📋 Incolla dagli appunti</button>
      <button class="btn ghost sm" onclick="window.Lettere._formatPasted()">✨ Pulisci formattazione</button>
      <button class="btn ghost sm" onclick="window.Lettere._copyLetter()">Copia testo lettera</button></div></div>`;

  return cardModello + (isLab
      ? cardELab
      : (cardDiag + cardRef + cardPrefs + cardSys))
    + cardPrompt + cardOut +
    flowNav('lettere-anonimizza','lettere-verifica','Avanti → Verifica');
}
function wizStep4(){
  const w=L.wiz;
  return `<div class="field"><label>Prompt da copiare nell'AI esterna</label>
      <textarea id="lt-prompt" rows="10" class="mono-input" readonly>${escapeHtml(w.builtPrompt)}</textarea>
      <div class="lt-row" style="margin-top:8px"><button class="btn sm" onclick="window.Lettere._copyPrompt()">Copia prompt</button>
        <span class="lt-status">Incolla in Claude/ChatGPT, poi riporta sotto la lettera.</span></div></div>
    <div class="field"><label>Lettera generata (incolla la risposta dell'AI)</label>
      <textarea id="lt-out" rows="14" placeholder="Incolla qui la lettera prodotta..." oninput="window.Lettere._set('outputLetter', this.value)">${escapeHtml(w.outputLetter||'')}</textarea></div>
    <div class="lt-row" style="margin-bottom:6px;flex-wrap:wrap;gap:8px">
      <button class="btn ghost sm" onclick="window.Lettere._copyVerifica()">Verifica anti-allucinazioni</button>
      <button class="btn ghost sm" onclick="window.Lettere._printLetter()">Stampa</button>
      <button class="btn ghost sm" onclick="window.Lettere._exportWord()">Esporta Word</button>
    </div>
    <div id="lt-verifica-box"></div>
    <div class="field"><label>Fingerprint stilistico (JSON opzionale, per la libreria)</label>
      <div class="lt-row" style="margin-bottom:6px"><button class="btn ghost sm" onclick="window.Lettere._copyFpPromptWiz()">Copia prompt per estrarre fingerprint</button>
        <span class="lt-status">Estrai il "fingerprint" di stile dalla lettera per arricchire la libreria.</span></div>
      <textarea id="lt-fp" rows="3" class="mono-input" placeholder='{"patologia":"...","decorso_esempio":"..."}' oninput="window.Lettere._set('fingerprint', this.value)">${escapeHtml(w.fingerprint||'')}</textarea></div>
    <div class="lt-wiz-actions"><button class="btn ghost" onclick="window.Lettere.goStep(3)">← Indietro</button>
      <div class="lt-row"><button class="btn" onclick="window.Lettere._addToLibrary()">Aggiungi a libreria</button></div></div>`;
}

/* ── Pagine separate del flusso (navigabili da sidebar/home come l'originale) ──
   Condividono lo stato L.wiz. Ogni pagina ha la barra di flusso in alto e i pulsanti
   avanti/indietro che navigano tra le route (non goStep). */
function ensureWiz(){ if(!L.wiz) L.wiz = newWizard(); return L.wiz; }
const LT_FLOW = [
  { route:'lettere-carica',     label:'Carica' },
  { route:'lettere-anonimizza', label:'Anonimizza' },
  { route:'lettere-genera',     label:'Genera' },
  { route:'lettere-verifica',   label:'Verifica' },
  { route:'lettere-esporta',    label:'Esporta' },
];
function flowBar(activeRoute){
  return '<div class="lt-flowbar">' + LT_FLOW.map((f,i)=>{
    const active = f.route===activeRoute;
    return `<button class="lt-flowstep${active?' active':''}" onclick="navigate('${f.route}')"><span class="lt-flown">${i+1}</span>${f.label}</button>`;
  }).join('<span class="lt-flowsep"></span>') + '</div>';
}
function flowNav(prevRoute, nextRoute, nextLabel){
  const prev = prevRoute ? `<button class="btn ghost" onclick="navigate('${prevRoute}')">← Indietro</button>` : '<span></span>';
  const next = nextRoute ? `<button class="btn" onclick="navigate('${nextRoute}')">${nextLabel||'Avanti →'}</button>` : '<span></span>';
  return `<div class="lt-wiz-actions">${prev}${next}</div>`;
}
function flowPageShell(activeRoute, title, bodyHtml){
  mc().innerHTML = pageHead(title, 'LetteraAI',
    `<button class="btn ghost" onclick="navigate('lettere')">← LetteraAI</button>`) +
    flowBar(activeRoute) + `<div class="lt-wizbody">${bodyHtml}</div>`;
}

function renderCarica(){
  if(!L.loaded){ mc().innerHTML=`<div class="loading"><span class="spinner"></span> Caricamento...</div>`; loadLibrary().then(renderCarica); return; }
  const w=ensureWiz();
  flowPageShell('lettere-carica','Carica cartella', wizStep1());
  const t=document.getElementById('lt-raw'); if(t) t.value=w.rawText||'';
}
function renderAnonimizza(){
  if(!L.loaded){ mc().innerHTML=`<div class="loading"><span class="spinner"></span> Caricamento...</div>`; loadLibrary().then(renderAnonimizza); return; }
  const w=ensureWiz();
  // Se non ho ancora anonimizzato ma ho del testo grezzo, anonimizzo ora
  if(!w.anonText && w.rawText && w.rawText.trim()){
    try{ const res=anonymizeText(w.rawText); w.anonText=res.text; w.substitutions=res.substitutions; w.patientData=res.patientData; w.strippedBlocks=res.strippedBlocks; }catch(e){}
  }
  flowPageShell('lettere-anonimizza','Anonimizza dati', wizStep2());
  const t=document.getElementById('lt-anon'); if(t) t.value=w.anonText||'';
}
function renderGenera(){
  if(!L.loaded){ mc().innerHTML=`<div class="loading"><span class="spinner"></span> Caricamento...</div>`; loadLibrary().then(renderGenera); return; }
  const w=ensureWiz();
  if(L._refMode===undefined) L._refMode='auto';
  // Aggiorno gli esempi RAG e (in modalità auto) seleziono il caso di riferimento
  w.ragExamples = selectRAGExamples(w.ward, w.diagnosi, w.tipo);
  _autoSelectRefCase();
  // Costruisco/aggiorno il prompt con le opzioni correnti
  w.builtPrompt = buildCopyPrompt(w);
  flowPageShell('lettere-genera','Genera lettera', wizStep3Combined());
  const t=document.getElementById('lt-prompt'); if(t) t.value=_promptViewText(w, L._promptTab||'full');
  const o=document.getElementById('lt-out'); if(o) o.value=w.outputLetter||'';
}
function renderVerifica(){
  if(!L.loaded){ mc().innerHTML=`<div class="loading"><span class="spinner"></span> Caricamento...</div>`; loadLibrary().then(renderVerifica); return; }
  const w=ensureWiz();
  const flags=L._verifFlags||[];
  // Vista evidenziata a destra
  const highlightHtml = flags.length
    ? _renderVerifHighlight(w.outputLetter||'', flags)
    : '<span class="lt-status">Qui viene visualizzato il testo verificato dall\'AI.</span>';
  const rightLabel = flags.length ? `${flags.length} segnalazion${flags.length===1?'e':'i'}` : 'in attesa di verifica';
  // Dettaglio segnalazioni
  const sevLabel={contraddizione:'Contraddice la cartella',assente:'Assente dalla cartella',inferenza:'Inferenza non esplicita'};
  const sevClass={contraddizione:'lt-sev-red',assente:'lt-sev-orange',inferenza:'lt-sev-yellow'};
  const flagsDetail = flags.length ? `
    <div style="margin-top:18px">
      <div class="lt-side-title">Dettaglio segnalazioni — ${flags.length}</div>
      ${flags.map((f,idx)=>`<div class="lt-flag ${sevClass[f.severity]||''}" onclick="window.Lettere._activateFlag(${idx})" style="cursor:pointer" title="Clicca per evidenziare nel testo">
        <div class="lt-flag-q">"${escapeHtml(f.quote||'')}"</div>
        <div class="lt-flag-r"><strong>${escapeHtml(sevLabel[f.severity]||f.severity||'')}:</strong> ${escapeHtml(f.reason||'')}</div>
      </div>`).join('')}
    </div>` : '';
  const body=`
    <div class="lt-note" style="border-left-color:var(--accent)">
      Modifica la lettera nel pannello sinistro. Il pannello destro mostra le frasi evidenziate dopo la verifica:
      <span class="lt-leg lt-sev-red">rosso = contraddice la cartella</span>
      <span class="lt-leg lt-sev-orange">arancio = assente dalla cartella</span>
      <span class="lt-leg lt-sev-yellow">giallo = inferenza non esplicita</span>
    </div>
    <div class="lt-row" style="gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <button class="btn" onclick="window.Lettere._copyVerifica()">⎘ Copia prompt di verifica per AI esterna</button>
      <button class="btn ghost" onclick="window.Lettere._togglePasteVerifica()">📋 Incolla risultato verifica AI esterna</button>
    </div>
    <div id="lt-paste-verif" style="display:${L._pasteVerifOpen?'block':'none'};margin-bottom:12px">
      <div class="lt-card-static" style="border-color:var(--accent)">
        <div class="lt-side-title">Incolla il risultato della verifica dall'AI esterna</div>
        <textarea id="lt-verif-json" rows="6" class="mono-input" placeholder="Incolla qui il JSON generato dall'AI esterna (array di oggetti con quote, severity, reason)..."></textarea>
        <div class="lt-row" style="margin-top:8px">
          <button class="btn sm" onclick="window.Lettere._applyVerif()">Applica evidenziazione</button>
          <button class="btn ghost sm" onclick="window.Lettere._pasteInto('lt-verif-json')">📋 Incolla dagli appunti</button>
          <button class="btn ghost sm" onclick="window.Lettere._togglePasteVerifica()">✗ Annulla</button>
        </div>
      </div>
    </div>
    <div class="lt-verif-grid">
      <div class="lt-diff-col">
        <div class="lt-dlabel">Lettera <span class="lt-edit-hint">✏ modificabile</span></div>
        <textarea id="lt-vout" class="lt-dtext" placeholder="Verifica con AI o incolla qui il testo generato dall'AI esterna" oninput="window.Lettere._set('outputLetter', this.value)">${escapeHtml(w.outputLetter||'')}</textarea>
      </div>
      <div class="lt-diff-col">
        <div class="lt-dlabel">Analisi — ${rightLabel}</div>
        <div class="lt-dtext lt-paper" id="lt-verif-hl">${highlightHtml}</div>
      </div>
    </div>
    ${flagsDetail}
    <div class="lt-wiz-actions"><button class="btn ghost" onclick="navigate('lettere-genera')">← Indietro</button>
      <button class="btn" onclick="window.Lettere._finalizzaEsporta()">✓ Finalizza → Esporta</button></div>`;
  flowPageShell('lettere-verifica','Verifica', body);
}
// Evidenzia nel testo le frasi segnalate dalla verifica
function _renderVerifHighlight(text, flags){
  if(!text) return '<span class="lt-status">Nessuna lettera da analizzare.</span>';
  let html = escapeHtml(text);
  const sevClass={contraddizione:'lt-hl-red',assente:'lt-hl-orange',inferenza:'lt-hl-yellow'};
  // Sostituisco ogni quote con una versione evidenziata (match su testo escaped)
  flags.forEach((f,idx)=>{
    if(!f.quote) return;
    const q=escapeHtml(f.quote.trim());
    if(!q) return;
    const cls=sevClass[f.severity]||'lt-hl-yellow';
    // sostituzione semplice della prima occorrenza
    const i=html.indexOf(q);
    if(i>=0){ html = html.slice(0,i) + `<mark id="lt-vmark${idx}" class="${cls}">${q}</mark>` + html.slice(i+q.length); }
  });
  return html;
}
function renderEsporta(){
  if(!L.loaded){ mc().innerHTML=`<div class="loading"><span class="spinner"></span> Caricamento...</div>`; loadLibrary().then(renderEsporta); return; }
  const w=ensureWiz();
  // Sicurezza: se la lettera contiene ancora placeholder non sostituiti
  // (es. l'utente è arrivato qui senza passare dal pulsante "Finalizza"),
  // reinserisce automaticamente i dati paziente reali.
  if(w.outputLetter && /\[(?:PAZIENTE_NOME|DATA_NASCITA|CITTA|REPARTO)\]/.test(w.outputLetter)){
    w.outputLetter = finalizeLetter(w);
  }
  const hasLetter = w.outputLetter && w.outputLetter.trim();
  const preview = hasLetter
    ? `<div class="lt-dtext lt-paper" id="lt-letter-out" style="min-height:500px">${escapeHtml(w.outputLetter)}</div>`
    : `<div class="lt-dtext lt-paper" style="min-height:200px"><span class="lt-status">Nessuna lettera. Generala nello step Genera o incollala qui sotto.</span></div>
       <div class="field" style="margin-top:10px"><textarea id="lt-eout" rows="8" class="mono-input" placeholder="Incolla qui la lettera finale..." oninput="window.Lettere._set('outputLetter', this.value)"></textarea>
         <div class="lt-row" style="margin-top:6px"><button class="btn ghost sm" onclick="window.Lettere._pasteInto('lt-eout')">📋 Incolla dagli appunti</button></div></div>`;
  const body=`
    ${preview}
    <div class="lt-row" style="margin-top:18px;gap:8px;flex-wrap:wrap">
      <button class="btn" onclick="window.Lettere._exportWord()">⬇ Esporta Word</button>
      <button class="btn ghost" onclick="window.Lettere._copyLetter()">⎘ Copia testo</button>
      <button class="btn ghost" onclick="window.Lettere._printLetter()">⎙ Stampa / PDF</button>
      <button class="btn ghost" onclick="navigate('lettere-verifica')">← Indietro</button>
      <button class="btn ghost" onclick="window.Lettere._newLetter()">↺ Nuova lettera</button>
    </div>
    <div class="lt-card-static" style="margin-top:20px">
      <div class="lt-side-title">Salva in libreria</div>
      <div class="field"><label>Fingerprint stilistico (JSON opzionale)</label>
        <div class="lt-row" style="margin-bottom:6px"><button class="btn ghost sm" onclick="window.Lettere._copyFpPromptWiz()">Copia prompt per estrarre fingerprint</button>
          <span class="lt-status">Estrai il "fingerprint" di stile dalla lettera per arricchire la libreria.</span></div>
        <textarea id="lt-fp" rows="3" class="mono-input" placeholder='{"patologia":"...","decorso_esempio":"..."}' oninput="window.Lettere._set('fingerprint', this.value)">${escapeHtml(w.fingerprint||'')}</textarea></div>
      <div class="lt-row" style="justify-content:flex-end"><button class="btn" onclick="window.Lettere._addToLibrary()">✓ Aggiungi a libreria</button></div>
    </div>`;
  flowPageShell('lettere-esporta','Esporta', body);
}

function renderLibreria(){
  if(!L.loaded){ mc().innerHTML=`<div class="loading"><span class="spinner"></span> Caricamento...</div>`; loadLibrary().then(renderLibreria); return; }
  const admin=canEdit();
  // Filtro per reparto (come l'originale): __all__ tutti, __none__ senza reparto, oppure nome reparto
  const wardFilter = L._libWardFilter || '__all__';
  const wardNames = (L.wards||[]).map(w=>w.name).filter(Boolean);
  const filterOpts = `<option value="__all__"${wardFilter==='__all__'?' selected':''}>Tutti i reparti</option>` +
    `<option value="__none__"${wardFilter==='__none__'?' selected':''}>— Senza reparto</option>` +
    wardNames.map(n=>`<option value="${escapeHtml(n)}"${wardFilter===n?' selected':''}>${escapeHtml(n)}</option>`).join('');
  // Casi filtrati
  const casiFiltrati = L.casi.filter(c=>{
    if(wardFilter==='__all__') return true;
    const w=c.ward||c.folder||'';
    if(wardFilter==='__none__') return !w;
    return w===wardFilter;
  });
  const rows=casiFiltrati.map(c=>`<tr onclick="navigate('lettere-caso',{id:'${c.id}'})" style="cursor:pointer">
    <td>${escapeHtml((c.createdAt||'').slice(0,10))}</td><td>${escapeHtml(c.ward||c.folder||'')}</td><td>${escapeHtml(c.diagnosi||c.name||'')}</td>
    <td>${escapeHtml((TIPI.find(t=>t.id===c.tipo)||{}).label||c.tipo||'')}</td><td>${escapeHtml(c.autore||'')}</td></tr>`).join('')||'<tr><td colspan="5" class="lt-sub-empty">Nessun caso.</td></tr>';
  // Barra backup/ripristino (solo admin)
  const backupBar = admin ? `
    <div class="lt-row" style="margin-bottom:12px;gap:8px;flex-wrap:wrap">
      <button class="btn ghost sm" onclick="window.Lettere._exportLib()">⬇ Esporta libreria (JSON)</button>
      <button class="btn ghost sm" onclick="document.getElementById('lt-import-file').click()">⬆ Importa libreria (JSON)</button>
      <input type="file" id="lt-import-file" accept="application/json,.json" style="display:none" onchange="window.Lettere._importLib(this)">
    </div>` : '';
  // Card gestione Reparti (solo admin), come nell'originale dentro Libreria Casi
  const repartiRows=(L.wards||[]).map(w=>`
    <tr><td>${escapeHtml(w.name||'')}</td><td>${escapeHtml((w.createdAt||'').slice(0,10))}</td>
      <td style="text-align:right"><button class="btn ghost sm" onclick="window.Lettere._delWard('${escapeHtml(w.id)}')">✕ Elimina</button></td></tr>`
  ).join('')||'<tr><td colspan="3" class="lt-sub-empty">Nessun reparto.</td></tr>';
  const repartiCard = admin ? `
    <div class="lt-card-static" style="margin-top:20px">
      <div class="lt-row" style="justify-content:space-between;align-items:center;margin-bottom:10px">
        <div class="lt-side-title" style="margin:0">Reparti</div>
        <div class="lt-row"><input type="text" id="lt-ward-name" placeholder="Nome nuovo reparto" style="width:200px">
          <button class="btn sm" onclick="window.Lettere._addWard()">+ Nuovo Reparto</button></div>
      </div>
      <table class="lt-table"><thead><tr><th>Reparto</th><th>Creato</th><th></th></tr></thead><tbody>${repartiRows}</tbody></table>
    </div>` : '';
  mc().innerHTML=pageHead('Libreria Casi','LetteraAI',`<button class="btn ghost" onclick="navigate('lettere')">← LetteraAI</button>`)+
    backupBar + `
    <div class="lt-card-static">
      <div class="lt-row" style="justify-content:space-between;align-items:center;margin-bottom:12px">
        <span class="lt-status">${casiFiltrati.length} cas${casiFiltrati.length===1?'o':'i'}${wardFilter!=='__all__'?' (filtrati)':''} · ${(L.wards||[]).length} repart${(L.wards||[]).length===1?'o':'i'}</span>
        <div class="lt-row" style="align-items:center;gap:8px"><label style="margin:0;white-space:nowrap">🏥 Reparto</label>
          <select onchange="window.Lettere._setLibWardFilter(this.value)" style="min-width:160px">${filterOpts}</select></div>
      </div>
      <table class="lt-table"><thead><tr><th>Data</th><th>Reparto</th><th>Diagnosi</th><th>Tipo</th><th>Autore</th></tr></thead><tbody>${rows}</tbody></table>
    </div>` +
    repartiCard;
}
// renderReparti rimane come alias di Libreria (la gestione reparti è integrata lì)
function renderReparti(){ navigate('lettere-libreria'); }
function renderCaso(id){
  if(!L.loaded){ mc().innerHTML=`<div class="loading"><span class="spinner"></span> Caricamento...</div>`; loadLibrary().then(()=>renderCaso(id)); return; }
  const c=L.casi.find(x=>x.id===id);
  if(!c){ mc().innerHTML=pageHead('Caso non trovato','LetteraAI')+'<p>Non disponibile.</p>'; return; }
  const del=canEdit()?`<button class="btn ghost sm" onclick="window.Lettere._delCaso('${id}')">Elimina</button>`:'';
  const edit=canEdit()?`<button class="btn ghost sm" onclick="window.Lettere._editCaso('${escapeHtml(id)}')">Modifica</button>`:'';
  const expBtns=(c.letter&&c.letter.trim())?`
    <div class="lt-row" style="margin:10px 0;gap:8px">
      <button class="btn ghost sm" onclick="window.Lettere._printCaso('${escapeHtml(id)}')">Stampa</button>
      <button class="btn ghost sm" onclick="window.Lettere._exportCaso('${escapeHtml(id)}')">Esporta Word</button>
    </div>`:'';
  mc().innerHTML=pageHead(c.diagnosi||c.name||c.id,`${c.ward||c.folder||''} · ${(c.createdAt||'').slice(0,10)}`,
    `<button class="btn ghost" onclick="navigate('lettere-libreria')">← Libreria</button>${edit}${del}`)+`
    ${c.cartella?`<details class="lt-det"><summary>Cartella anonimizzata</summary><pre class="lt-pre">${escapeHtml(c.cartella)}</pre></details>`:''}
    <div class="lt-side-title" style="margin-top:18px">Lettera</div><pre class="lt-pre">${escapeHtml(c.letter||'(vuota)')}</pre>
    ${expBtns}
    ${c.fingerprint?`<details class="lt-det"><summary>Fingerprint stilistico</summary><pre class="lt-pre">${escapeHtml(typeof c.fingerprint==='string'?c.fingerprint:JSON.stringify(c.fingerprint,null,2))}</pre></details>`:''}`;
}

/* ── Mie personalizzazioni (tutti gli utenti) ── */
function renderPersonalizzazioni(){
  if(!L.loaded){ mc().innerHTML=`<div class="loading"><span class="spinner"></span> Caricamento...</div>`; loadLibrary().then(renderPersonalizzazioni); return; }
  const tplOpts=_templates.map(t=>`<option value="${escapeHtml(t.id)}"${(_userTemplateData&&_userTemplateData.base_template_id===t.id)?' selected':''}>${escapeHtml(t.name||t.id)}</option>`).join('');
  // Valori effettivi del template personale (base + overrides)
  const ov = (_userTemplateData && _userTemplateData.overrides) || {};
  const baseTpl = _templates.find(t=>t.id===(_userTemplateData&&_userTemplateData.base_template_id)) || _templates[0] || {};
  const v=(k,def)=> (ov[k]!==undefined ? ov[k] : (baseTpl[k]!==undefined ? baseTpl[k] : (def||'')));
  const ordine = (ov.ordine_sezioni && ov.ordine_sezioni.length) ? ov.ordine_sezioni : (baseTpl.ordine_sezioni||[]);
  mc().innerHTML=pageHead('Mie personalizzazioni','LetteraAI',`<button class="btn ghost" onclick="navigate('lettere')">← LetteraAI</button>`)+`
    <div class="lt-card-static">
      <div class="lt-side-title">Aggiunte personali alle regole (override additivo)</div>
      <p class="lt-status" style="margin:0 0 10px">Regole aggiuntive applicate sempre, in coda al system prompt. Salvate in <code>${PATHS.userOverrides}${escapeHtml(username())}.md</code></p>
      <textarea id="lt-uoverride" rows="10" class="mono-input" placeholder="AGGIUNTE PERSONALI:&#10;- Per FA cronica includere sempre HAS-BLED nel decorso&#10;- ...">${escapeHtml(_userOverride||'')}</textarea>
      <div class="lt-row" style="margin-top:10px">
        <button class="btn" onclick="window.Lettere._saveOverride()">Salva</button>
        <button class="btn ghost" onclick="window.Lettere._discardOverride()">✕ Scarta modifiche</button></div>
    </div>

    <div class="lt-card-static">
      <div class="lt-side-title">Mio template di lettera</div>
      <div class="field"><label>Template di base</label><select id="lt-utpl-base" onchange="window.Lettere._onUserTplBase(this.value)">${tplOpts}</select></div>
      <div class="field"><label>Intestazione (a chi è indirizzata la lettera)</label>
        <input type="text" id="utpl-intestazione" value="${escapeHtml(v('intestazione'))}" placeholder="Alla cortese attenzione del Medico Curante"></div>
      <div class="field"><label>Saluto (riga prima dell'apertura)</label>
        <input type="text" id="utpl-saluto" value="${escapeHtml(v('saluto'))}" placeholder="Egregi Colleghi,"></div>
      <div class="field"><label>Apertura (testo dopo il saluto, prima della diagnosi)</label>
        <textarea id="utpl-apertura" rows="3">${escapeHtml(v('apertura'))}</textarea></div>
      <div class="field"><label>Chiusura</label>
        <input type="text" id="utpl-chiusura" value="${escapeHtml(v('chiusura'))}" placeholder="Rimaniamo a disposizione e porgiamo cordiali saluti."></div>
      <div class="lt-row">
        <div class="field" style="flex:1"><label>Firma — colonna sinistra (placeholder)</label>
          <input type="text" id="utpl-firma-sx" value="${escapeHtml(v('firma_specializzando_label'))}" placeholder="[NOME_SPECIALIZZANDO]">
          <label style="font-size:9px;color:var(--ink-faint);margin-top:6px">Ruolo colonna sinistra</label>
          <input type="text" id="utpl-ruolo-sx" value="${escapeHtml(v('firma_ruolo_sx'))}" placeholder="Medico in formazione specialistica"></div>
        <div class="field" style="flex:1"><label>Firma — colonna destra (placeholder)</label>
          <input type="text" id="utpl-firma-dx" value="${escapeHtml(v('firma_dirigente_label'))}" placeholder="[NOME_DIRIGENTE]">
          <label style="font-size:9px;color:var(--ink-faint);margin-top:6px">Ruolo colonna destra</label>
          <input type="text" id="utpl-ruolo-dx" value="${escapeHtml(v('firma_ruolo_dx'))}" placeholder="Dirigente medico"></div>
      </div>
      <div class="field"><label>Ordine delle sezioni della lettera (trascina per riordinare)</label>
        <div id="utpl-sections"></div></div>
      <div class="lt-row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" onclick="window.Lettere._resetMyTpl()">↺ Ripristina default</button>
        <button class="btn" onclick="window.Lettere._saveMyTpl()">Salva template</button></div>
    </div>`;
  // Renderizzo l'editor di riordino sezioni (riusa l'helper esistente)
  setTimeout(()=>renderSectionsEditor('utpl-sections', ordine), 50);
}

/* ── Impostazioni: preferenze di default per la generazione (panel5 originale) ──
   Sono le preferenze salvate nel template utente, applicate come default a ogni nuova lettera. */
function renderImpostazioni(){
  if(!L.loaded){ mc().innerHTML=`<div class="loading"><span class="spinner"></span> Caricamento...</div>`; loadLibrary().then(renderImpostazioni); return; }
  const p = (L.userTemplateData && L.userTemplateData.prefs) ? L.userTemplateData.prefs : DEFAULT_USER_PREFS;
  const seg=(key,opts)=>opts.map(o=>`<button class="lt-seg${p[key]===o.v?' on':''}" onclick="window.Lettere._setDefPref('${key}','${o.v}')">${o.l}</button>`).join('');
  mc().innerHTML=pageHead('Impostazioni','LetteraAI',`<button class="btn ghost" onclick="navigate('lettere')">← LetteraAI</button>`)+`
    <div class="lt-card-static">
      <div class="lt-side-title">Preferenze generazione lettera (default)</div>
      <div class="lt-prefs">
        <div class="lt-pref-row"><label>Esami laboratorio</label><div class="lt-segs">${seg('lab',[{v:'all',l:'Tutti i valori'},{v:'altered',l:'Solo patologici'}])}</div></div>
        <div class="lt-pref-row"><label>Accertamenti strumentali</label><div class="lt-segs">${seg('acc',[{v:'brief',l:'Sintetici'},{v:'extended',l:'Estesi'}])}</div></div>
        <div class="lt-pref-row"><label>Decorso clinico</label><div class="lt-segs">${seg('dec',[{v:'short',l:'Conciso'},{v:'standard',l:'Standard'},{v:'long',l:'Dettagliato'}])}</div></div>
        <div class="lt-pref-row"><label>Anamnesi</label><div class="lt-segs">${seg('an',[{v:'essential',l:'Essenziale'},{v:'complete',l:'Completa'}])}</div></div>
        <div class="lt-pref-row"><label>Raccomandazioni</label><div class="lt-segs">${seg('rac',[{v:'main',l:'Principali'},{v:'all',l:'Tutte'}])}</div></div>
        <div class="lt-pref-row"><label>Terapia dimissione</label><div class="lt-segs">${seg('ter',[{v:'last',l:'Ultima terapia'},{v:'lastPlusHome',l:'+ domiciliare'}])}</div></div>
      </div>
      <div class="lt-wiz-actions"><button class="btn ghost sm" onclick="window.Lettere._resetDefPrefs()">↺ Reset</button>
        <button class="btn" onclick="window.Lettere._saveDefPrefs()">✓ Salva Preferenze</button></div>
    </div>`;
}

/* ── Segnala errori (tutti possono inviare) — solo il form ── */
const REPORT_CATEGORIES = [
  ['errore_lettera', 'Errore nella lettera generata'],
  ['errore_anonimizzazione', "Errore nell'anonimizzazione"],
  ['bug_ui', 'Bug interfaccia'],
  ['suggerimento', 'Suggerimento / miglioramento'],
  ['altro', 'Altro'],
];
function renderSegnalazioni(){
  if(!L.loaded){ mc().innerHTML=`<div class="loading"><span class="spinner"></span> Caricamento...</div>`; loadLibrary().then(renderSegnalazioni); return; }
  const catOpts = REPORT_CATEGORIES.map(([v,l])=>`<option value="${v}">${escapeHtml(l)}</option>`).join('');
  mc().innerHTML = pageHead('Segnala Errori','LetteraAI',`<button class="btn ghost" onclick="navigate('lettere')">← LetteraAI</button>`) + `
    <div class="lt-card-static">
      <div class="lt-side-title">Nuova segnalazione</div>
      <div class="field"><label>Categoria</label><select id="rep-cat">${catOpts}</select></div>
      <div class="field"><label>Descrizione del problema</label>
        <textarea id="rep-desc" rows="5" placeholder="Descrivi il problema con quanti più dettagli possibili..."></textarea></div>
      <div class="field"><label>Prompt utilizzato <span class="lt-status">(opzionale)</span></label>
        <textarea id="rep-prompt" rows="3" class="mono-input" placeholder="Incolla qui il prompt, se rilevante"></textarea></div>
      <div class="field"><label>Lettera prodotta <span class="lt-status">(opzionale)</span></label>
        <textarea id="rep-letter" rows="3" class="mono-input" placeholder="Incolla qui la lettera, se rilevante"></textarea></div>
      <div class="lt-wiz-actions"><button class="btn ghost sm" onclick="window.Lettere._resetReport()">↺ Reset</button>
        <button class="btn" onclick="window.Lettere._sendReport()">Invia segnalazione</button></div>
    </div>`;
}
/* ── Segnalazioni (admin) — solo la lista delle segnalazioni ricevute ── */
function renderSegnalazioniAdmin(){
  if(!canEdit()){ mc().innerHTML=pageHead('Segnalazioni','LetteraAI')+'<p>Riservato agli amministratori.</p>'; return; }
  if(!L.loaded){ mc().innerHTML=`<div class="loading"><span class="spinner"></span> Caricamento...</div>`; loadLibrary().then(renderSegnalazioniAdmin); return; }
  mc().innerHTML = pageHead('Segnalazioni','LetteraAI',`<button class="btn ghost" onclick="navigate('lettere')">← LetteraAI</button>`) +
    `<div id="rep-list"><div class="loading"><span class="spinner"></span> Caricamento segnalazioni...</div></div>`;
  _refreshReportsList();
}
async function _refreshReportsList(){
  const box = document.getElementById('rep-list');
  if(!box) return;
  const reports = await loadReportsFile();
  if(!reports.length){ box.innerHTML = '<div class="lt-sub-empty">Nessuna segnalazione.</div>'; return; }
  const catLabel = (v) => (REPORT_CATEGORIES.find(c=>c[0]===v)||[null,v])[1];
  box.innerHTML = reports.map(r=>`
    <div class="lt-card-static" style="margin-bottom:10px">
      <div class="lt-row" style="justify-content:space-between">
        <strong>${escapeHtml(catLabel(r.category))}</strong>
        <span class="lt-status">${escapeHtml((r.timestamp||'').slice(0,16).replace('T',' '))} · ${escapeHtml(r.username||'')}</span>
      </div>
      <p style="margin:8px 0;white-space:pre-wrap">${escapeHtml(r.description||'')}</p>
      ${r.prompt?`<details class="lt-det"><summary>Prompt</summary><pre class="lt-pre">${escapeHtml(r.prompt)}</pre></details>`:''}
      ${r.letter?`<details class="lt-det"><summary>Lettera</summary><pre class="lt-pre">${escapeHtml(r.letter)}</pre></details>`:''}
      <div class="lt-row" style="margin-top:8px"><button class="btn ghost sm" onclick="window.Lettere._delReport('${escapeHtml(r.id)}')">🗑 Elimina</button></div>
    </div>`).join('');
}

/* ── Configurazione (admin): prompt + libreria template ── */
function renderConfig(){
  if(!canEdit()){ mc().innerHTML=pageHead('Editor Prompt','LetteraAI')+'<p>Riservato agli amministratori.</p>'; return; }
  if(!L.loaded){ mc().innerHTML=`<div class="loading"><span class="spinner"></span> Caricamento...</div>`; loadLibrary().then(renderConfig); return; }
  // Tab prompt con le etichette dell'originale
  const tabs=[['DEFAULT_SYS','Prompt di sistema'],['FINGERPRINT_PROMPT_V3','Prompt estrazione decorso'],['VERIFICA_SYSTEM','Prompt verifica'],['ESAMI_LAB_SYS','Prompt esami lab']];
  const cur=L._cfgTab||'DEFAULT_SYS';
  const curVal={DEFAULT_SYS,FINGERPRINT_PROMPT_V3,VERIFICA_SYSTEM,ESAMI_LAB_SYS}[cur];
  const tabBtns=tabs.map(([k,l])=>`<button class="lt-tab${cur===k?' on':''}" onclick="window.Lettere._cfgTab('${k}')">${l}</button>`).join('');
  // Lista template di libreria
  const tplRows=(_templates||[]).map(t=>{
    const sectCount=(t.ordine_sezioni||[]).length;
    const isDefault=t.id==='default';
    const del=isDefault?'':`<button class="btn ghost sm" onclick="window.Lettere._delTpl('${escapeHtml(t.id)}')">Elimina</button>`;
    return `<tr>
      <td>${escapeHtml(t.name||t.id)}</td>
      <td><code>${escapeHtml(t.id)}</code></td>
      <td>${sectCount} sezioni</td>
      <td style="text-align:right"><button class="btn ghost sm" onclick="window.Lettere._editTpl('${escapeHtml(t.id)}')">Modifica</button>${del}</td>
    </tr>`;
  }).join('')||'<tr><td colspan="4" class="lt-sub-empty">Nessun template.</td></tr>';
  mc().innerHTML=pageHead('Editor Prompt + Template','LetteraAI',`<button class="btn ghost" onclick="navigate('lettere')">← LetteraAI</button>`)+`
    <div class="lt-card-static">
      <div class="lt-side-title">Prompt globali</div>
      <div class="lt-tabs" style="margin-bottom:12px">${tabBtns}</div>
      <div class="lt-status" style="margin-bottom:6px">Salvato in <code>${escapeHtml(PROMPT_PATHS[cur]||'')}</code></div>
      <textarea id="lt-cfgtext" rows="20" class="mono-input">${escapeHtml(curVal)}</textarea>
      <div class="lt-row" style="margin-top:10px;gap:8px;flex-wrap:wrap">
        <button class="btn" onclick="window.Lettere._saveCfg('${cur}')">Salva</button>
        <button class="btn ghost" onclick="window.Lettere._resetCfgEmbedded('${cur}')" title="Resetta al fallback embedded (non salva)">⟲ Resetta a default embedded</button>
        <button class="btn ghost" onclick="window.Lettere._discardCfg()" title="Scarta le modifiche">✕ Scarta modifiche</button>
      </div>
    </div>

    <div class="lt-card-static">
      <div class="lt-row" style="justify-content:space-between;align-items:center;margin-bottom:10px">
        <div class="lt-side-title" style="margin:0">Libreria template lettera</div>
        <button class="btn sm" onclick="window.Lettere._editTpl('__new__')">+ Nuovo template</button>
      </div>
      <table class="lt-table"><thead><tr><th>Nome</th><th>ID</th><th>Sezioni</th><th></th></tr></thead><tbody>${tplRows}</tbody></table>
    </div>`;
}

/* Editor template (modale): crea o modifica un template, con riordino sezioni drag&drop */
function renderTemplateEditor(tplId){
  const isNew = tplId === '__new__';
  const tpl = isNew
    ? { id:'', name:'', scenario:'dimissione_domicilio', intestazione:'', saluto:'', apertura:'',
        chiusura:'', firma_specializzando_label:'[NOME_SPECIALIZZANDO]', firma_ruolo_sx:'Medico in formazione specialistica',
        firma_dirigente_label:'[NOME_DIRIGENTE]', firma_ruolo_dx:'Dirigente medico',
        ordine_sezioni:(DEFAULT_TEMPLATE_EMBEDDED.ordine_sezioni||[]).slice() }
    : (_templates.find(t=>t.id===tplId) || null);
  if (!tpl){ toast('Template non trovato','error'); return; }
  const fld=(id,label,val,rows)=> rows
    ? `<div class="field"><label>${label}</label><textarea id="tpl-${id}" rows="${rows}">${escapeHtml(val||'')}</textarea></div>`
    : `<div class="field"><label>${label}</label><input type="text" id="tpl-${id}" value="${escapeHtml(val||'')}"></div>`;
  const body=`
    <div class="lt-row">
      ${fld('id','ID (lettere minuscole, numeri, underscore)',tpl.id)}
      ${fld('name','Nome visualizzato',tpl.name)}
    </div>
    ${isNew?'':'<input type="hidden" id="tpl-id" value="'+escapeHtml(tpl.id)+'">'}
    ${fld('scenario','Scenario',tpl.scenario)}
    ${fld('intestazione','Intestazione',tpl.intestazione,2)}
    ${fld('saluto','Saluto',tpl.saluto)}
    ${fld('apertura','Apertura',tpl.apertura,3)}
    ${fld('chiusura','Chiusura',tpl.chiusura,2)}
    <div class="lt-row">
      ${fld('firma_specializzando_label','Firma sx (label)',tpl.firma_specializzando_label)}
      ${fld('firma_ruolo_sx','Ruolo sx',tpl.firma_ruolo_sx)}
    </div>
    <div class="lt-row">
      ${fld('firma_dirigente_label','Firma dx (label)',tpl.firma_dirigente_label)}
      ${fld('firma_ruolo_dx','Ruolo dx',tpl.firma_ruolo_dx)}
    </div>
    <div class="field"><label>Sezioni (trascina per riordinare, spunta per includere)</label>
      <div id="tpl-sections" class="lt-sections-editor"></div></div>`;
  showModal({
    title: isNew ? 'Nuovo template' : 'Modifica template',
    subtitle: isNew ? 'Crea un nuovo template di lettera' : escapeHtml(tpl.name||tpl.id),
    body,
    actions: [
      { label:'Annulla', variant:'ghost', onClick:()=>closeModal() },
      { label:'Salva template', onClick:()=>window.Lettere._saveTpl(isNew, tplId) }
    ]
  });
  // Popola l'editor delle sezioni (drag&drop + checkbox)
  setTimeout(()=>renderSectionsEditor('tpl-sections', tpl.ordine_sezioni||[]), 50);
}

/* Editor sezioni con riordino drag&drop. Replica la logica dello standalone. */
function renderSectionsEditor(containerId, currentOrder){
  const container=document.getElementById(containerId);
  if(!container) return;
  const orderedIds=(currentOrder||[]).filter(id=>TEMPLATE_SECTIONS_AVAILABLE.find(s=>s.id===id));
  const orderedSet=new Set(orderedIds);
  const remaining=TEMPLATE_SECTIONS_AVAILABLE.filter(s=>!orderedSet.has(s.id)).map(s=>s.id);
  const finalOrder=[...orderedIds,...remaining];
  container.innerHTML=finalOrder.map(id=>{
    const meta=TEMPLATE_SECTIONS_AVAILABLE.find(s=>s.id===id);
    if(!meta) return '';
    const enabled=orderedSet.has(id);
    return `<div class="lt-section-row" draggable="true" data-section-id="${escapeHtml(id)}">
      <span class="lt-drag-handle">⠿</span>
      <input type="checkbox" ${enabled?'checked':''} data-section-cb="${escapeHtml(id)}">
      <span class="lt-section-label">${escapeHtml(meta.label)}</span>
      <span class="lt-section-id">${escapeHtml(id)}</span>
    </div>`;
  }).join('');
  attachSectionDrag(container);
}
function attachSectionDrag(container){
  let dragged=null;
  container.querySelectorAll('.lt-section-row').forEach(row=>{
    row.addEventListener('dragstart',()=>{ dragged=row; row.style.opacity='0.4'; });
    row.addEventListener('dragend',()=>{ if(dragged)dragged.style.opacity='1'; dragged=null; });
    row.addEventListener('dragover',(e)=>{ e.preventDefault();
      const rect=row.getBoundingClientRect();
      const after=(e.clientY-rect.top)>rect.height/2;
      if(dragged&&dragged!==row){
        if(after) row.parentNode.insertBefore(dragged,row.nextSibling);
        else row.parentNode.insertBefore(dragged,row);
      }});
    row.addEventListener('drop',(e)=>e.preventDefault());
  });
}
function getSectionOrder(containerId){
  const container=document.getElementById(containerId);
  if(!container) return [];
  const out=[];
  container.querySelectorAll('.lt-section-row').forEach(row=>{
    const id=row.getAttribute('data-section-id');
    const cb=row.querySelector('input[type="checkbox"]');
    if(cb&&cb.checked) out.push(id);
  });
  return out;
}

/* ── Editor caso esistente (modale): modifica name/folder/letter/fingerprint ──
   Il fingerprint può essere modificato in tre modi:
   1) editor strutturato a campi (se è un V3 valido con patologia)
   2) JSON grezzo in textarea
   3) re-importato incollando il prompt di estrazione in un'AI esterna */
function renderCaseEditor(id){
  const c = L.casi.find(x => x.id === id);
  if (!c){ toast('Caso non trovato','error'); return; }
  const fpStr = typeof c.fingerprint === 'string' ? c.fingerprint : (c.fingerprint ? JSON.stringify(c.fingerprint) : '');
  const fpObj = parseFpJson(fpStr);
  const isV3 = fpObj && fpObj.patologia;
  // Editor fingerprint: strutturato se V3, altrimenti textarea JSON grezzo
  const fpEditor = isV3
    ? `<div class="lt-side-title" style="margin-top:6px">Fingerprint (editor strutturato V3)</div>
       <div id="ce-fp-v3">${renderFpV3EditorHtml(fpObj, 'ce-fpv3')}</div>`
    : `<div class="field"><label>Fingerprint (JSON grezzo)</label>
        <textarea id="ce-fp-raw" rows="6" class="mono-input" placeholder='{"patologia":"...","decorso_esempio":"..."}'>${escapeHtml(fpStr)}</textarea></div>`;
  const body = `
    <div class="field"><label>Nome / Diagnosi</label><input type="text" id="ce-name" value="${escapeHtml(c.diagnosi||c.name||'')}"></div>
    <div class="lt-row">
      <div class="field" style="flex:1"><label>Reparto</label><input type="text" id="ce-folder" value="${escapeHtml(c.ward||c.folder||'')}"></div>
      <div class="field" style="flex:1"><label>Tipo</label><input type="text" id="ce-tipo" value="${escapeHtml(c.tipo||'dimissione')}"></div>
    </div>
    <div class="field"><label>Cartella anonimizzata</label><textarea id="ce-cartella" rows="5" class="mono-input">${escapeHtml(c.cartella||'')}</textarea></div>
    <div class="field"><label>Lettera</label><textarea id="ce-letter" rows="8" class="mono-input">${escapeHtml(c.letter||'')}</textarea></div>
    ${fpEditor}
    <details class="lt-det" style="margin-top:10px"><summary>Ri-estrai fingerprint da un'AI esterna</summary>
      <p class="lt-status" style="margin:8px 0">Copia il prompt di estrazione, incollalo in Claude/ChatGPT con cartella e lettera, poi incolla qui sotto il JSON risultante e premi "Importa".</p>
      <div class="lt-row" style="margin-bottom:8px"><button class="btn ghost sm" onclick="window.Lettere._copyFpPrompt('${escapeHtml(id)}')">Copia prompt fingerprint</button></div>
      <textarea id="ce-fp-import" rows="4" class="mono-input" placeholder="Incolla qui il JSON del fingerprint estratto..."></textarea>
      <div class="lt-row" style="margin-top:8px"><button class="btn ghost sm" onclick="window.Lettere._importFp('${escapeHtml(id)}')">Importa fingerprint</button></div>
    </details>`;
  showModal({
    title: 'Modifica caso',
    subtitle: escapeHtml(c.diagnosi || c.name || id),
    body,
    actions: [
      { label:'Annulla', variant:'ghost', onClick:()=>closeModal() },
      { label:'Salva modifiche', onClick:()=>window.Lettere._saveEditedCase(id) }
    ]
  });
}



/* ═══════════════════════════════════════════════════════════════════════════
   API PUBBLICA — window.Lettere
   ═══════════════════════════════════════════════════════════════════════════ */
window.Lettere = {
  loadLibrary,
  renderHome: renderLettereHome, renderWizard, renderLibreria,
  renderCarica, renderAnonimizza, renderGenera, renderVerifica, renderEsporta,
  renderCaso, renderPersonalizzazioni, renderConfig,
  renderSegnalazioni, renderReparti,
  renderImpostazioni, renderSegnalazioniAdmin,
  isReady: () => L.loaded,

  nuova(){ L.wiz = newWizard(); navigate('lettere-carica'); },
  goStep(n){ if(L.wiz){ L.wiz.step=n; renderWizard(); } },
  _set(k,v){ if(L.wiz) L.wiz[k]=v; },
  _setPref(k,v){ const w=ensureWiz(); if(!w.prefs) w.prefs={}; w.prefs[k]=v; w.builtPrompt=buildCopyPrompt(w); renderGenera(); },
  _setWard(v){ const w=ensureWiz(); w.ward=v; w.ragExamples=selectRAGExamples(v,w.diagnosi,w.tipo); _autoSelectRefCase(); },
  _setTipo(v){ const w=ensureWiz(); w.tipo=v; w.ragExamples=selectRAGExamples(w.ward,w.diagnosi,v); _autoSelectRefCase(); renderGenera(); },
  _setDiag(v){ const w=ensureWiz(); w.diagnosi=v; w.ragExamples=selectRAGExamples(w.ward,v,w.tipo); _autoSelectRefCase(); },
  // Caso di riferimento (modalità auto/manual/none + inject)
  _setRefMode(m){ L._refMode=m;
    if(m==='auto'){ _autoSelectRefCase(); }
    else if(m==='none'){ _refCaseId=null; }
    renderGenera(); },
  _setRefWardFilter(v){ L._refWardFilter=v; renderGenera(); },
  _setRefCase(id){ _refCaseId=id||null; const w=ensureWiz(); w.builtPrompt=buildCopyPrompt(w); renderGenera(); },
  _setRefInject(mode){ _refInjectMode=mode; const w=ensureWiz(); w.builtPrompt=buildCopyPrompt(w); renderGenera(); },
  _togglePrefs(){ L._prefsOpen=!L._prefsOpen; const el=document.getElementById('lt-prefs-coll'); if(el) el.classList.toggle('open', L._prefsOpen); },
  // Preferenze modello Esami Lab
  _setELab(mode){ _eLabMode=mode; const w=ensureWiz(); w.builtPrompt=buildCopyPrompt(w); renderGenera(); },
  _setELabCustom(v){ _eLabCustom=v; const w=ensureWiz(); w.builtPrompt=buildCopyPrompt(w); const ta=document.getElementById('lt-prompt'); if(ta) ta.value=w.builtPrompt; },
  // System prompt modificabile inline (card "Istruzioni generali")
  _toggleSysPrompt(){ L._sysPromptOpen=!L._sysPromptOpen; const el=document.getElementById('lt-sys-coll'); if(el) el.classList.toggle('open', L._sysPromptOpen); },
  _setSysPrompt(v){ const w=ensureWiz(); w.sysPromptOverride=v; w.builtPrompt=buildCopyPrompt(w); const ta=document.getElementById('lt-prompt'); if(ta) ta.value=_promptViewText(w, L._promptTab||'full'); },
  _resetSysPrompt(){ const w=ensureWiz(); w.sysPromptOverride=null; w.builtPrompt=buildCopyPrompt(w); renderGenera(); toast('Istruzioni ripristinate.','info'); },
  _setPromptTab(t){ L._promptTab=t; renderGenera(); },
  // Pulisce la formattazione della lettera incollata (righe vuote in eccesso, placeholder noti)
  _formatPasted(){ const w=ensureWiz(); let txt=(w.outputLetter||'').replace(/\n{3,}/g,'\n\n').trim();
    txt=txt.replace(/\[CITTA\]/g,'Padova').replace(/\[REPARTO\]/g, w.ward||'reparto');
    w.outputLetter=txt; const ta=document.getElementById('lt-out'); if(ta) ta.value=txt; toast('Formattazione ripulita.','success'); },

  async _onPdf(file){ if(!file)return; const w=ensureWiz();
    const box=document.getElementById('lt-pdf-status'); const txt=document.getElementById('lt-pdf-status-txt');
    if(box) box.style.display='block'; if(txt) txt.textContent='Lettura PDF…';
    try{ const t=await extractPdfText(file); w.rawText=(w.rawText?w.rawText+'\n\n':'')+t;
      const ta=document.getElementById('lt-raw'); if(ta)ta.value=w.rawText;
      if(txt) txt.textContent='✓ PDF aggiunto al testo.'; }
    catch(e){ if(txt) txt.textContent='Errore PDF: '+e.message; } },
  async _onXls(file){ if(!file)return; const w=ensureWiz();
    const box=document.getElementById('lt-xls-status'); const txt=document.getElementById('lt-xls-status-txt');
    if(box) box.style.display='block'; if(txt) txt.textContent='Lettura esami XLS…';
    try{ const rows=await extractXlsRows(file); w.xlsRows=rows; w.xlsText=xlsToRawText(rows, '').text;
      w.rawText=(w.rawText?w.rawText+'\n\n':'')+w.xlsText;
      // Ri-renderizzo la pagina per mostrare l'anteprima dei valori estratti, poi ripristino il testo
      renderCarica();
      const ta=document.getElementById('lt-raw'); if(ta)ta.value=w.rawText;
      toast('Esami aggiunti.','success'); }
    catch(e){ if(txt) txt.textContent='Errore XLS: '+e.message; } },

  _step1Next(){ if(!L.wiz.rawText.trim()){ toast('Inserisci il testo clinico.','error'); return; }
    const r=anonymizeText(L.wiz.rawText); L.wiz.anonText=r.text; L.wiz.substitutions=r.substitutions; L.wiz.patientData=r.patientData; L.wiz.strippedBlocks=r.strippedBlocks; L.wiz.step=2; renderWizard(); },
  _step2Next(){ const flags=detectResidualPII(L.wiz.anonText);
    const go=()=>{ L.wiz.step=3; L.wiz.ragExamples=selectRAGExamples(L.wiz.ward,L.wiz.diagnosi,L.wiz.tipo); renderWizard(); };
    if(flags.length){ Modals().confirm({ title:'Possibili dati residui',
      message:'Rilevati pattern che potrebbero essere dati personali ('+flags.map(f=>f.label).join(', ')+'). Procedere?',
      confirmLabel:'Procedi', danger:true, onConfirm:go }); return; }
    go(); },
  _buildPrompt(){ L.wiz.builtPrompt=buildCopyPrompt(L.wiz); L.wiz.step=4; renderWizard(); },
  // Flusso a pagine separate: anonimizza il testo grezzo e naviga alla pagina Anonimizza
  _caricaNext(){ const w=ensureWiz(); if(!w.rawText||!w.rawText.trim()){ toast('Inserisci il testo clinico.','error'); return; }
    try{ const r=anonymizeText(w.rawText); w.anonText=r.text; w.substitutions=r.substitutions; w.patientData=r.patientData; w.strippedBlocks=r.strippedBlocks; }catch(e){ toast('Errore anonimizzazione: '+e.message,'error'); return; }
    navigate('lettere-anonimizza'); },
  // Ricostruisce il prompt nella pagina Genera con le opzioni correnti + aggiorna gli esempi RAG
  _rebuildPrompt(){ const w=ensureWiz(); w.ragExamples=selectRAGExamples(w.ward,w.diagnosi,w.tipo); w.builtPrompt=buildCopyPrompt(w);
    const ta=document.getElementById('lt-prompt'); if(ta) ta.value=w.builtPrompt; toast('Prompt aggiornato.','success'); },
  // Finalizza la lettera (reinserisce nome/cognome/data nascita reali + [CITTA]/[REPARTO]) e va all'Esporta
  _finalizzaEsporta(){ const w=ensureWiz();
    // Prima salva eventuali modifiche fatte nel pannello sinistro della Verifica
    const ed=document.getElementById('lt-vout'); if(ed && ed.value.trim()) w.outputLetter=ed.value;
    if(!w.outputLetter || !w.outputLetter.trim()){ toast('Genera o incolla prima la lettera.','error'); return; }
    w.outputLetter = finalizeLetter(w);   // reinserisce i dati paziente reali
    navigate('lettere-esporta'); },

  // ── Reset / clear / copia / incolla (parità con l'originale) ──
  _clearAll(){ Modals().confirm({ title:'Svuotare la cartella?', message:'Il testo caricato e gli esami verranno cancellati.', confirmLabel:'Svuota', danger:true,
    onConfirm:()=>{ const w=ensureWiz(); w.rawText=''; w.anonText=''; w.substitutions=[]; w.xlsText=''; w.xlsRows=null;
      const t=document.getElementById('lt-raw'); if(t) t.value=''; const st=document.getElementById('lt-parse-status'); if(st) st.textContent='';
      toast('Cartella svuotata.','success'); } }); },
  _clearXls(){ const w=ensureWiz(); if(!w.xlsText){ toast('Nessun file esami da rimuovere.','info'); return; }
    // Rimuovo il blocco esami dal testo grezzo
    if(w.xlsText && w.rawText) w.rawText=w.rawText.replace(w.xlsText,'').trim();
    w.xlsText=''; w.xlsRows=null;
    const t=document.getElementById('lt-raw'); if(t) t.value=w.rawText||'';
    const st=document.getElementById('lt-parse-status'); if(st) st.textContent='Esami rimossi.';
    toast('Esami rimossi.','success'); },
  _newLetter(){ Modals().confirm({ title:'Nuova lettera?', message:'I dati correnti andranno persi.', confirmLabel:'Nuova lettera', danger:true,
    onConfirm:()=>{ L.wiz=newWizard(); navigate('lettere-carica'); toast('Nuova lettera avviata.','success'); } }); },
  _resetPrefs(){ const w=ensureWiz();
    w.prefs=JSON.parse(JSON.stringify(L.userTemplateData&&L.userTemplateData.prefs?L.userTemplateData.prefs:DEFAULT_USER_PREFS));
    renderGenera(); toast('Preferenze ripristinate.','success'); },
  _copyLetter(){ const w=ensureWiz(); const txt=w.outputLetter||'';
    if(!txt.trim()){ toast('Nessuna lettera da copiare.','error'); return; }
    if(navigator.clipboard) navigator.clipboard.writeText(txt).then(()=>toast('Lettera copiata.','success')).catch(()=>toast('Copia non riuscita.','error'));
    else toast('Copia non supportata.','error'); },
  async _pasteInto(elId){ try{ const txt=await navigator.clipboard.readText();
      const el=document.getElementById(elId); if(el){ el.value=txt; el.dispatchEvent(new Event('input',{bubbles:true})); toast('Incollato dagli appunti.','success'); } }
    catch(e){ toast('Lettura appunti non riuscita (permesso negato?).','error'); } },
  _copyPrompt(){ const ta=document.getElementById('lt-prompt'); if(ta){ ta.select();
    const txt=ta.value||(L.wiz&&L.wiz.builtPrompt)||'';
    try{document.execCommand('copy');}catch(e){} if(navigator.clipboard) navigator.clipboard.writeText(txt).catch(()=>{});
    toast('Prompt copiato.','success'); } },
  async _addToLibrary(){ if(!L.wiz.outputLetter.trim()){ toast('Incolla prima la lettera generata.','error'); return; }
    // Privacy: la libreria è un modello per il RAG e non deve contenere dati reali.
    // Se la lettera è stata finalizzata (nome/cognome/data reali reinseriti),
    // li riconverto in placeholder prima di salvare.
    let letteraDaSalvare = L.wiz.outputLetter;
    const pd = L.wiz.patientData;
    if(pd && (pd.nome || pd.cognome)){
      const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const full = [pd.cognome, pd.nome].filter(Boolean).join(' ');
      if(full){ try{ letteraDaSalvare = letteraDaSalvare.replace(new RegExp(esc(full),'g'),'[PAZIENTE_NOME]'); }catch(e){} }
      if(pd.cognome && pd.cognome.length>=3){ try{ letteraDaSalvare = letteraDaSalvare.replace(new RegExp('\\b'+esc(pd.cognome)+'\\b','g'),'[PAZIENTE_NOME]'); }catch(e){} }
      if(pd.nome && pd.nome.length>=3){ try{ letteraDaSalvare = letteraDaSalvare.replace(new RegExp('\\b'+esc(pd.nome)+'\\b','g'),'[PAZIENTE_NOME]'); }catch(e){} }
      if(pd.dataNascita){ try{ letteraDaSalvare = letteraDaSalvare.replace(new RegExp(esc(pd.dataNascita),'g'),'[DATA_NASCITA]'); }catch(e){} }
    }
    const flags=detectResidualPII(letteraDaSalvare);
    const doSave=async()=>{ try{ await saveCaso({ ward:L.wiz.ward, diagnosi:L.wiz.diagnosi, tipo:L.wiz.tipo,
        cartella:L.wiz.anonText, lettera:letteraDaSalvare, fingerprint:(L.wiz.fingerprint||'').trim() });
      toast('Caso aggiunto.','success'); navigate('lettere-libreria'); }catch(e){ toast('Errore: '+e.message,'error'); } };
    if(flags.length){ Modals().confirm({ title:'Possibili dati residui nella lettera',
      message:'La lettera contiene pattern che potrebbero essere dati personali ('+flags.map(f=>f.label).join(', ')+'). Salvare comunque?',
      confirmLabel:'Salva', danger:true, onConfirm:doSave }); } else doSave(); },

  // ── Verifica anti-allucinazioni / export / stampa ──
  async _copyVerifica(){
    const w=ensureWiz();
    const lettera=(w.outputLetter||'').trim();
    const cartella=(w.anonText||'').trim();
    if(!cartella){ toast('Manca la cartella anonimizzata (step Anonimizza).','error'); return; }
    if(!lettera){ toast('Incolla prima la lettera generata.','error'); return; }
    const prompt=buildVerificaPrompt(cartella, lettera);
    try{ await navigator.clipboard.writeText(prompt); toast('Prompt di verifica copiato. Incollalo in un\'AI esterna, poi incolla qui il risultato.','success'); }
    catch(e){ toast('Copia non riuscita.','error'); }
  },
  _togglePasteVerifica(){ L._pasteVerifOpen=!L._pasteVerifOpen; const el=document.getElementById('lt-paste-verif'); if(el) el.style.display=L._pasteVerifOpen?'block':'none'; },
  // Click su una segnalazione → evidenzia e scrolla al mark corrispondente
  _activateFlag(idx){
    document.querySelectorAll('mark.lt-flag-active').forEach(m=>m.classList.remove('lt-flag-active'));
    const mark=document.getElementById('lt-vmark'+idx);
    if(mark){ mark.classList.add('lt-flag-active'); mark.scrollIntoView({behavior:'smooth',block:'center'}); }
  },
  _applyVerif(){
    const ta=document.getElementById('lt-verif-json'); if(!ta) return;
    const raw=(ta.value||'').replace(/```json[\s\S]*?```|```/g,'').trim();
    if(!raw){ toast('Incolla il JSON del risultato verifica.','error'); return; }
    let parsed;
    try{ parsed=JSON.parse(raw); }catch(e){ toast('JSON non valido: '+e.message,'error'); return; }
    if(!Array.isArray(parsed)){ toast('Il risultato deve essere un array di segnalazioni.','error'); return; }
    // Normalizzo le severity (rosso/arancio/giallo → contraddizione/assente/inferenza)
    const map={rosso:'contraddizione',red:'contraddizione',arancio:'assente',orange:'assente',giallo:'inferenza',yellow:'inferenza',
      contraddizione:'contraddizione',assente:'assente',inferenza:'inferenza'};
    L._verifFlags = parsed.map(f=>({ quote:f.quote||f.frase||'', severity:map[(f.severity||f.tipo||'').toLowerCase()]||'inferenza', reason:f.reason||f.motivo||'' })).filter(f=>f.quote);
    L._pasteVerifOpen=false;
    toast(`${L._verifFlags.length} segnalazioni applicate.`,'success');
    renderVerifica();
  },
  _printLetter(){ printLetter((L.wiz&&L.wiz.outputLetter)||''); },
  _exportWord(){ const w=L.wiz||{}; const fn=('lettera_'+(w.ward||'dimissione')+'_'+(w.diagnosi||'')).replace(/[^a-z0-9_]+/gi,'_').toLowerCase(); exportWordDoc(w.outputLetter||'', fn); },
  async _copyFpPromptWiz(){
    const cartella=(L.wiz&&L.wiz.anonText||'').trim();
    const lettera=(L.wiz&&L.wiz.outputLetter||'').trim();
    if(!lettera){ toast('Incolla prima la lettera generata.','error'); return; }
    const prompt=buildFingerprintPrompt(cartella, lettera);
    try{ await navigator.clipboard.writeText(prompt); toast('Prompt fingerprint copiato. Incollalo in un\'AI esterna.','success'); }
    catch(e){ toast('Copia non riuscita.','error'); }
  },
  _printCaso(id){ const c=L.casi.find(x=>x.id===id); if(c) printLetter(c.letter||''); },
  _exportCaso(id){ const c=L.casi.find(x=>x.id===id); if(!c)return; const fn=('lettera_'+(c.ward||c.folder||'')+'_'+(c.diagnosi||c.name||'')).replace(/[^a-z0-9_]+/gi,'_').toLowerCase(); exportWordDoc(c.letter||'', fn); },

  // ── Edit caso esistente + fingerprint ──
  _editCaso(id){ renderCaseEditor(id); },
  async _saveEditedCase(id){
    const c=L.casi.find(x=>x.id===id); if(!c){ toast('Caso non trovato','error'); return; }
    const get=(eid)=>{ const el=document.getElementById(eid); return el?el.value:''; };
    const name=get('ce-name').trim();
    if(!name){ toast('Inserisci un nome/diagnosi.','error'); return; }
    // Fingerprint: dall'editor V3 strutturato (se presente) o dal JSON grezzo
    let fingerprint;
    if(document.getElementById('ce-fpv3_patologia')){
      fingerprint = JSON.stringify(readFpV3Editor('ce-fpv3'));
    } else {
      fingerprint = get('ce-fp-raw').trim();
    }
    const updated={
      id, name, diagnosi:name,
      ward:get('ce-folder').trim(), folder:get('ce-folder').trim(),
      tipo:get('ce-tipo').trim()||'dimissione',
      cartella:get('ce-cartella'), letter:get('ce-letter'),
      fingerprint,
      wardId:c.wardId, autore:c.autore||username(), createdAt:c.createdAt,
    };
    try{ await saveCaso(updated); toast('Modifiche salvate.','success'); closeModal(); renderCaso(id); }
    catch(e){ toast('Errore: '+e.message,'error'); }
  },
  async _copyFpPrompt(id){
    const c=L.casi.find(x=>x.id===id); if(!c)return;
    // Usa i valori attuali nei campi dell'editor (se aperti) o quelli del caso
    const cartella=(document.getElementById('ce-cartella')||{}).value || c.cartella || '';
    const lettera=(document.getElementById('ce-letter')||{}).value || c.letter || '';
    const prompt=buildFingerprintPrompt(cartella, lettera);
    try{ await navigator.clipboard.writeText(prompt); toast('Prompt fingerprint copiato.','success'); }
    catch(e){ toast('Copia non riuscita.','error'); }
  },
  _importFp(id){
    const ta=document.getElementById('ce-fp-import'); if(!ta)return;
    const raw=(ta.value||'').replace(/```json[\s\S]*?```|```/g,'').trim();
    if(!raw){ toast('Incolla il JSON del fingerprint.','error'); return; }
    let parsed;
    try{ parsed=JSON.parse(raw); }catch(e){ toast('JSON non valido: '+e.message,'error'); return; }
    // Normalizzo: V3 (patologia+decorso_esempio), V2 (lettera_modello), legacy 4-field
    let fpObj;
    if(parsed.patologia && parsed.decorso_esempio){ fpObj=parsed; }
    else if(parsed.lettera_modello){ fpObj=parsed; }
    else if(parsed.apertura||parsed.decorso||parsed.terapia||parsed.chiusura){ fpObj=parsed; }
    else { toast('Schema fingerprint non riconosciuto.','error'); return; }
    // Aggiorno il caso col nuovo fingerprint e riapro l'editor per review
    const c=L.casi.find(x=>x.id===id); if(!c)return;
    c.fingerprint=JSON.stringify(fpObj);
    toast('Fingerprint importato. Rivedi e salva.','success');
    renderCaseEditor(id);
  },
  _delCaso(id){ const c=L.casi.find(x=>x.id===id); if(!c)return;
    Modals().confirm({ title:'Eliminare il caso?', subtitle:`<strong>${escapeHtml(c.diagnosi||c.name||id)}</strong> sarà rimosso dalla libreria.`,
      confirmLabel:'Elimina', danger:true, onConfirm:async()=>{ try{ await softDeleteCaso(c); toast('Caso eliminato.','success'); navigate('lettere-libreria'); }catch(e){ toast('Errore: '+e.message,'error'); } } }); },

  // ── Backup/ripristino libreria JSON ──
  _exportLib(){ exportLibraryJson(); },
  async _importLib(input){
    const file = input && input.files && input.files[0];
    input.value = ''; // reset così re-importare lo stesso file ri-triggera l'onchange
    if(!file) return;
    try{
      const r = await importLibraryJson(file);
      toast(`Importati ${r.added} nuovi (${r.duplicates} duplicati ignorati). Totale: ${r.total}.`,'success');
      renderLibreria();
    }catch(e){ toast('Errore import: '+e.message,'error'); }
  },

  // ── Segnalazioni ──
  async _sendReport(){
    const desc=(document.getElementById('rep-desc').value||'').trim();
    if(!desc){ toast('Inserisci una descrizione.','error'); return; }
    const report={
      id:'rep_'+Date.now()+'_'+Math.random().toString(36).slice(2,8),
      username:username(), timestamp:new Date().toISOString(),
      category:document.getElementById('rep-cat').value,
      description:desc,
      prompt:(document.getElementById('rep-prompt').value||'').trim()||null,
      letter:(document.getElementById('rep-letter').value||'').trim()||null,
    };
    try{ await sendReportRepo(report); toast('Segnalazione inviata. Grazie!','success'); navigate('lettere'); }
    catch(e){ toast('Errore invio: '+e.message,'error'); }
  },
  _delReport(id){
    Modals().confirm({ title:'Eliminare la segnalazione?', confirmLabel:'Elimina', danger:true,
      onConfirm:async()=>{ try{ await deleteReportRepo(id); toast('Segnalazione eliminata.','success'); _refreshReportsList(); }catch(e){ toast('Errore: '+e.message,'error'); } } });
  },

  // ── Reparti ──
  async _addWard(){
    const el=document.getElementById('lt-ward-name'); const name=(el&&el.value||'').trim();
    if(!name){ toast('Inserisci un nome reparto.','error'); return; }
    try{ await createWardRepo(name); toast('Reparto aggiunto.','success'); renderLibreria(); }
    catch(e){ toast('Errore: '+e.message,'error'); }
  },
  _delWard(id){
    const w=(L.wards||[]).find(x=>x.id===id); if(!w)return;
    Modals().confirm({ title:'Eliminare il reparto?', subtitle:`<strong>${escapeHtml(w.name||'')}</strong>`, confirmLabel:'Elimina', danger:true,
      onConfirm:async()=>{ try{ await deleteWardRepo(id); toast('Reparto eliminato.','success'); renderLibreria(); }catch(e){ toast('Errore: '+e.message,'error'); } } });
  },
  _setLibWardFilter(v){ L._libWardFilter=v; renderLibreria(); },
  _toggleAnonSubs(){ L._anonSubsOpen=!L._anonSubsOpen; const el=document.getElementById('lt-anon-subs'); if(el) el.classList.toggle('open', L._anonSubsOpen); },
  _toggleStripped(){ L._strippedOpen=!L._strippedOpen; const el=document.getElementById('lt-stripped'); if(el) el.classList.toggle('open', L._strippedOpen); },

  // ── Impostazioni: preferenze di default (salvate nel template utente) ──
  _setDefPref(key,val){
    if(!L.userTemplateData) L.userTemplateData={};
    if(!L.userTemplateData.prefs) L.userTemplateData.prefs=JSON.parse(JSON.stringify(DEFAULT_USER_PREFS));
    L.userTemplateData.prefs[key]=val; renderImpostazioni();
  },
  _resetDefPrefs(){
    if(!L.userTemplateData) L.userTemplateData={};
    L.userTemplateData.prefs=JSON.parse(JSON.stringify(DEFAULT_USER_PREFS));
    renderImpostazioni(); toast('Preferenze ripristinate ai default.','info');
  },
  async _saveDefPrefs(){
    const data = L.userTemplateData || {};
    if(!data.prefs) data.prefs=JSON.parse(JSON.stringify(DEFAULT_USER_PREFS));
    try{ await saveUserTemplateToRepo(data); toast('Preferenze salvate.','success'); }
    catch(e){ toast('Errore: '+e.message,'error'); }
  },
  _resetReport(){ ['rep-desc','rep-prompt','rep-letter'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
    const cat=document.getElementById('rep-cat'); if(cat) cat.selectedIndex=0; toast('Modulo segnalazione svuotato.','info'); },

  // ── Mie personalizzazioni ──
  async _saveOverride(){
    const el=document.getElementById('lt-uoverride'); const override=el?el.value:'';
    try{ await saveUserOverrideToRepo(override); _userOverride=override; toast('Aggiunte personali salvate.','success'); }
    catch(e){ toast('Errore: '+e.message,'error'); }
  },
  _discardOverride(){ const el=document.getElementById('lt-uoverride'); if(el) el.value=_userOverride||''; toast('Modifiche scartate.','info'); },
  _onUserTplBase(id){
    if(!_userTemplateData) _userTemplateData={};
    _userTemplateData.base_template_id=id;
    L.userTemplateData=_userTemplateData;
    renderPersonalizzazioni();
  },
  async _saveMyTpl(){
    const get=(id)=>{ const el=document.getElementById(id); return el?el.value:''; };
    const data=_userTemplateData||{};
    data.base_template_id=get('lt-utpl-base')||data.base_template_id;
    data.overrides=Object.assign({}, data.overrides, {
      intestazione:get('utpl-intestazione'),
      saluto:get('utpl-saluto'),
      apertura:get('utpl-apertura'),
      chiusura:get('utpl-chiusura'),
      firma_specializzando_label:get('utpl-firma-sx'),
      firma_ruolo_sx:get('utpl-ruolo-sx'),
      firma_dirigente_label:get('utpl-firma-dx'),
      firma_ruolo_dx:get('utpl-ruolo-dx'),
      ordine_sezioni:getSectionOrder('utpl-sections'),
    });
    data.updatedAt=new Date().toISOString();
    try{ await saveUserTemplateToRepo(data); toast('Template personale salvato.','success'); }
    catch(e){ toast('Errore: '+e.message,'error'); }
  },
  _resetMyTpl(){
    Modals().confirm({ title:'Ripristinare il template al default?', message:'Cancellerà le tue personalizzazioni del template (intestazione, firme, ordine sezioni).', confirmLabel:'Ripristina', danger:true,
      onConfirm:async()=>{
        const data={ base_template_id:(_templates[0]&&_templates[0].id)||'default', overrides:{}, updatedAt:new Date().toISOString() };
        try{ await saveUserTemplateToRepo(data); toast('Template ripristinato al default.','success'); renderPersonalizzazioni(); }
        catch(e){ toast('Errore: '+e.message,'error'); }
      } });
  },
  _cfgTab(k){ L._cfgTab=k; renderConfig(); },
  async _saveCfg(varName){ const ta=document.getElementById('lt-cfgtext'); if(!ta)return;
    try{ await savePromptToRepo(varName, ta.value); toast('Prompt salvato.','success'); }catch(e){ toast('Errore: '+e.message,'error'); } },
  _resetCfgEmbedded(varName){ const ta=document.getElementById('lt-cfgtext'); if(!ta)return;
    const fb=PROMPT_EMBEDDED_FALLBACKS[varName]; if(fb!==undefined){ ta.value=fb; toast('Ripristinato al default embedded (non ancora salvato).','info'); } },
  _discardCfg(){ const cur=L._cfgTab||'DEFAULT_SYS'; const ta=document.getElementById('lt-cfgtext');
    const cv={DEFAULT_SYS,FINGERPRINT_PROMPT_V3,VERIFICA_SYSTEM,ESAMI_LAB_SYS}[cur]; if(ta){ ta.value=cv; toast('Modifiche scartate.','info'); } },

  // ── Editor template di libreria ──
  _editTpl(id){ renderTemplateEditor(id); },
  async _saveTpl(isNew, origId){
    const get=(k)=>{ const el=document.getElementById('tpl-'+k); return el?el.value:''; };
    const id=(get('id')||'').trim();
    if(!id || !/^[a-z0-9_]+$/.test(id)){ toast('ID non valido: usa solo lettere minuscole, numeri e underscore.','error'); return; }
    const tpl={
      id,
      name: get('name').trim() || id,
      scenario: get('scenario'),
      intestazione: get('intestazione'),
      saluto: get('saluto'),
      apertura: get('apertura'),
      chiusura: get('chiusura'),
      firma_specializzando_label: get('firma_specializzando_label'),
      firma_ruolo_sx: get('firma_ruolo_sx'),
      firma_dirigente_label: get('firma_dirigente_label'),
      firma_ruolo_dx: get('firma_ruolo_dx'),
      ordine_sezioni: getSectionOrder('tpl-sections'),
      updatedAt: new Date().toISOString(),
    };
    // Preserva lo _sha se è un update dello stesso id
    if(!isNew){ const ex=_templates.find(t=>t.id===id); if(ex&&ex._sha) tpl._sha=ex._sha; }
    try{
      await saveLibraryTemplateRepo(tpl);
      // Se ho rinominato l'id di un template esistente, elimino il vecchio file
      if(!isNew && origId && origId!=='__new__' && origId!==id && origId!=='default'){
        try{ await deleteLibraryTemplateRepo(origId); }catch(e){}
      }
      toast('Template salvato.','success'); closeModal(); renderConfig();
    }catch(e){ toast('Errore: '+e.message,'error'); }
  },
  _delTpl(id){
    Modals().confirm({ title:'Eliminare il template?', subtitle:`<code>${escapeHtml(id)}</code>`, confirmLabel:'Elimina', danger:true,
      onConfirm:async()=>{ try{ await deleteLibraryTemplateRepo(id); toast('Template eliminato.','success'); renderConfig(); }catch(e){ toast('Errore: '+e.message,'error'); } } });
  },
};

/* ── CSS (usa solo le CSS variables di CollinettaAI) ── */
(function injectCss(){
  if (document.getElementById('lettere-css')) return;
  const css = `
  .lt-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;margin:20px 0}
  .lt-card{background:var(--bg-paper);border:1px solid var(--rule);border-radius:2px;padding:20px;cursor:pointer;transition:border-color .15s,box-shadow .15s}
  .lt-card:hover{border-color:var(--accent);box-shadow:var(--shadow-raised)}
  .lt-card-title{font-family:var(--serif);font-size:19px;color:var(--ink);margin-bottom:6px;display:flex;align-items:center;gap:8px}
  .lt-card-desc{font-size:13px;color:var(--ink-muted);line-height:1.5}
  .lt-badge{font-family:var(--mono);font-size:11px;background:var(--accent-soft);color:var(--accent);padding:1px 7px;border-radius:10px}
  .lt-note{margin-top:24px;padding:14px 16px;background:var(--bg-sink);border-left:3px solid var(--accent-muted);border-radius:2px;font-size:13px;color:var(--ink-soft);line-height:1.55}
  .lt-steps{display:flex;align-items:center;gap:4px;margin:16px 0 24px;flex-wrap:wrap}
  .lt-step{display:flex;align-items:center;gap:7px;padding:6px 12px;border-radius:2px;cursor:pointer;color:var(--ink-faint);font-family:var(--mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase}
  .lt-step.active{color:var(--accent);background:var(--accent-soft)}
  .lt-step.done{color:var(--success)}
  .lt-step-n{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;border:1.5px solid currentColor;font-size:10px}
  .lt-step-sep{flex:0 0 16px;height:1px;background:var(--rule)}
  .lt-wizbody{max-width:920px}
  .lt-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  .lt-status{font-size:12px;color:var(--ink-muted)}
  .lt-wiz-actions{display:flex;justify-content:space-between;align-items:center;margin-top:22px;gap:10px;flex-wrap:wrap}
  .lt-two-col{display:grid;grid-template-columns:2fr 1fr;gap:18px}
  @media(max-width:700px){.lt-two-col{grid-template-columns:1fr}}
  .lt-side-title{font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-muted);margin-bottom:10px}
  .lt-card-static{background:var(--bg-paper);border:1px solid var(--rule);border-radius:2px;padding:16px 18px;margin-bottom:14px}
  /* Dropzone upload (replica panel0 originale) */
  .lt-dropzone{border:2px dashed var(--rule);border-radius:4px;padding:24px 20px;text-align:center;cursor:pointer;background:var(--bg-sink);transition:border-color .15s}
  .lt-dropzone:hover,.lt-dropzone.drag{border-color:var(--accent)}
  .lt-dz-ic{font-size:24px;margin-bottom:6px;opacity:.7}
  .lt-dz-txt{font-family:var(--mono);font-size:11px;color:var(--ink-muted)}
  .lt-dz-txt strong{color:var(--ink)}
  .lt-dz-status{margin-top:10px;font-family:var(--mono);font-size:11px;color:var(--ink-soft)}
  .lt-xls-preview{margin-top:10px}
  .lt-xls-preview-h{font-family:var(--mono);font-size:9px;color:var(--ink-faint);text-transform:uppercase;letter-spacing:.1em;margin-bottom:5px}
  .lt-xls-preview-c{background:var(--bg-sink);border:1px solid var(--rule);border-radius:3px;padding:10px 12px;font-family:var(--mono);font-size:10px;color:var(--ink-soft);max-height:200px;overflow-y:auto;white-space:pre-wrap}
  /* Sezione collassabile (replica .collapsible-section originale) */
  .lt-collapsible{border:1px solid var(--rule);border-radius:3px;margin-bottom:12px;overflow:hidden}
  .lt-collapsible-toggle{display:flex;align-items:center;gap:8px;width:100%;padding:10px 14px;background:var(--bg-paper);border:none;cursor:pointer;font-size:13px;color:var(--ink);text-align:left}
  .lt-collapsible-toggle:hover{background:var(--bg-raised)}
  .lt-ct-icon{font-size:9px;color:var(--ink-muted);transition:transform .15s}
  .lt-collapsible.open .lt-ct-icon{transform:rotate(90deg)}
  .lt-ct-label{flex:1}
  .lt-ct-count{font-family:var(--mono);font-size:11px;color:var(--accent);background:var(--accent-soft);border-radius:10px;padding:1px 9px}
  .lt-collapsible-body{display:none;padding:10px 14px;border-top:1px solid var(--rule-soft);max-height:300px;overflow-y:auto}
  .lt-collapsible.open .lt-collapsible-body{display:block}
  /* Diff a due colonne (replica .diff-grid originale) */
  .lt-diff-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}
  .lt-diff-col{display:flex;flex-direction:column;min-width:0}
  .lt-dlabel{font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-muted);margin-bottom:6px}
  .lt-edit-hint{color:var(--accent);text-transform:none;letter-spacing:0}
  .lt-diff-scroll{border:1px solid var(--rule);border-radius:3px;overflow:hidden}
  .lt-dtext{width:100%;height:calc(60vh - 2px);box-sizing:border-box;padding:12px 14px;font-family:var(--mono);font-size:11px;line-height:1.6;color:var(--ink);background:var(--bg-sink);overflow-y:auto;white-space:pre-wrap;border:none;resize:none;display:block}
  textarea.lt-dtext{background:var(--bg-paper)}
  @media (max-width:760px){ .lt-diff-grid{grid-template-columns:1fr} .lt-dtext{height:34vh} }
  /* Tile modello lettera (replica letterTemplateGrid) */
  .lt-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}
  .lt-tile{cursor:pointer;border:2px solid var(--rule);border-radius:4px;padding:12px 14px;background:var(--bg-sink);display:flex;align-items:center;justify-content:center;text-align:center;transition:border-color .12s,background .12s}
  .lt-tile:hover{border-color:var(--accent)}
  .lt-tile.on{border-color:var(--accent);background:var(--accent-soft)}
  .lt-tile-l{font-family:var(--mono);font-size:11px;font-weight:600;color:var(--ink-soft)}
  .lt-tile.on .lt-tile-l{color:var(--accent)}
  /* Tab (replica .tabs/.tab dell'originale) */
  .lt-tabs{display:flex;gap:6px;flex-wrap:wrap}
  .lt-tab{padding:6px 14px;border:1px solid var(--rule);border-radius:20px;background:transparent;font-size:12px;color:var(--ink-soft);cursor:pointer;transition:all .12s}
  .lt-tab:hover{border-color:var(--accent);color:var(--ink)}
  .lt-tab.on{background:var(--accent);border-color:var(--accent);color:#fff}
  /* Blocco preferenza (label sopra, tab sotto) */
  .lt-prefblock{margin-bottom:14px}
  .lt-prefblock label{display:block;margin-bottom:6px;font-size:12px;color:var(--ink)}
  .lt-prefblock textarea{width:100%}
  /* Verifica (replica panel3) */
  .lt-verif-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:12px}
  .lt-paper{background:var(--bg-paper);font-family:'Times New Roman',serif;font-size:13px;line-height:1.7}
  textarea.lt-dtext[id="lt-vout"]{font-family:'Times New Roman',serif;font-size:13px;line-height:1.7}
  .lt-leg{display:inline-block;border-radius:3px;padding:0 6px;margin:0 3px;font-size:11px}
  .lt-sev-red,.lt-hl-red{background:rgba(220,53,53,.22)}
  .lt-sev-orange,.lt-hl-orange{background:rgba(220,140,30,.22)}
  .lt-sev-yellow,.lt-hl-yellow{background:rgba(210,190,0,.28)}
  mark.lt-hl-red,mark.lt-hl-orange,mark.lt-hl-yellow{color:var(--ink);border-radius:2px;padding:0 2px}
  mark.lt-flag-active{outline:2px solid var(--accent);outline-offset:1px;font-weight:600}
  .lt-flag{border-left:3px solid var(--rule);padding:8px 12px;margin-bottom:8px;background:var(--bg-paper);border-radius:0 3px 3px 0}
  .lt-flag.lt-sev-red{border-left-color:var(--danger);background:rgba(220,53,53,.06)}
  .lt-flag.lt-sev-orange{border-left-color:#dc8c1e;background:rgba(220,140,30,.06)}
  .lt-flag.lt-sev-yellow{border-left-color:#d2be00;background:rgba(210,190,0,.06)}
  .lt-flag-q{font-family:'Times New Roman',serif;font-size:13px;font-style:italic;margin-bottom:4px}
  .lt-flag-r{font-size:12px;color:var(--ink-soft)}
  @media (max-width:760px){ .lt-verif-grid{grid-template-columns:1fr} }
  /* Home a lista (sezioni una sotto l'altra come categorie Procedure) */
  .lt-home-group{font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-muted);margin:18px 0 8px}
  .lt-home-list{display:flex;flex-direction:column;gap:6px;margin-bottom:8px}
  .lt-home-row{display:flex;align-items:center;gap:14px;padding:14px 16px;background:var(--bg-paper);border:1px solid var(--rule);border-radius:3px;cursor:pointer;transition:border-color .12s,background .12s}
  .lt-home-row:hover{border-color:var(--accent);background:var(--bg-raised)}
  .lt-home-n{flex:0 0 26px;height:26px;border-radius:50%;background:var(--accent-soft);color:var(--accent);font-family:var(--mono);font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center}
  .lt-home-ic{flex:0 0 26px;text-align:center;font-size:16px}
  .lt-home-t{font-size:14px;font-weight:600;color:var(--ink)}
  .lt-home-d{font-size:12px;color:var(--ink-muted);margin-top:2px}
  /* Barra di flusso in cima alle pagine del wizard */
  .lt-flowbar{display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid var(--rule-soft)}
  .lt-flowstep{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;background:transparent;border:1px solid var(--rule);border-radius:20px;font-size:12px;color:var(--ink-soft);cursor:pointer}
  .lt-flowstep:hover{border-color:var(--accent);color:var(--ink)}
  .lt-flowstep.active{background:var(--accent);border-color:var(--accent);color:#fff}
  .lt-flowstep.active .lt-flown{background:rgba(255,255,255,.25);color:#fff}
  .lt-flown{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:var(--accent-soft);color:var(--accent);font-family:var(--mono);font-size:10px;font-weight:700}
  .lt-flowsep{flex:0 0 6px}
  .lt-sections-editor{display:flex;flex-direction:column;gap:4px;max-height:340px;overflow:auto;border:1px solid var(--rule-soft);border-radius:2px;padding:8px;background:var(--bg-sink)}
  .lt-section-row{display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--bg-paper);border:1px solid var(--rule);border-radius:3px;cursor:move}
  .lt-section-row:hover{border-color:var(--accent)}
  .lt-drag-handle{color:var(--ink-faint);font-family:var(--mono);font-size:11px;cursor:grab}
  .lt-section-label{flex:1;font-size:13px;color:var(--ink)}
  .lt-section-id{font-family:var(--mono);font-size:9px;color:var(--ink-faint)}
  .lt-subs{max-height:380px;overflow:auto;display:flex;flex-direction:column;gap:5px}
  .lt-sub{font-size:12px;padding:5px 8px;background:var(--bg-paper);border:1px solid var(--rule-soft);border-radius:2px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
  .lt-sub code{font-size:11px;background:var(--bg-sink);padding:1px 5px}
  .lt-sub span{color:var(--accent);font-family:var(--mono);font-size:11px}
  .lt-sub-type{margin-left:auto;color:var(--ink-faint);font-size:10px;text-transform:uppercase}
  .lt-sub-empty{font-size:13px;color:var(--ink-faint);font-style:italic;padding:10px}
  .lt-prefs{background:var(--bg-paper);border:1px solid var(--rule-soft);border-radius:2px;padding:14px 16px;margin:14px 0}
  .lt-pref-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid var(--rule-soft)}
  .lt-pref-row label{margin:0}
  .lt-segs{display:inline-flex;gap:4px;flex-wrap:wrap}
  .lt-seg{font-family:var(--mono);font-size:11px;padding:5px 11px;border:1px solid var(--rule);background:var(--bg-raised);color:var(--ink-muted);border-radius:2px;cursor:pointer;transition:all .12s}
  .lt-seg.on{background:var(--accent-soft);border-color:var(--accent);color:var(--accent);font-weight:500}
  .lt-rags{display:flex;flex-direction:column;gap:6px;margin-bottom:8px}
  .lt-rag{padding:8px 12px;background:var(--bg-paper);border:1px solid var(--rule-soft);border-radius:2px;font-size:13px;display:flex;justify-content:space-between;gap:10px}
  .lt-rag span{color:var(--ink-muted);font-size:12px}
  .lt-table{width:100%;border-collapse:collapse;margin-top:8px;font-size:14px}
  .lt-table th{text-align:left;font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-muted);padding:8px 10px;border-bottom:1px solid var(--rule)}
  .lt-table td{padding:9px 10px;border-bottom:1px solid var(--rule-soft);color:var(--ink-soft)}
  .lt-table tbody tr:hover{background:var(--rule-soft)}
  .lt-pre{background:var(--bg-paper);border:1px solid var(--rule-soft);border-radius:2px;padding:14px;font-family:var(--mono);font-size:12px;line-height:1.55;white-space:pre-wrap;overflow-x:auto;color:var(--ink-soft)}
  .lt-det{margin:14px 0}
  .lt-det summary{cursor:pointer;font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-muted);padding:6px 0}
  .lt-pii{margin:12px 0;padding:10px 14px;background:var(--warning-soft);border-left:3px solid var(--warning);border-radius:2px;font-size:13px;color:var(--warning)}
  .page-head-actions{display:flex;gap:8px;align-items:center}
  `;
  const style=document.createElement('style'); style.id='lettere-css'; style.textContent=css; document.head.appendChild(style);
})();

})(); // ── fine modulo Lettere ──
