# SlipCut Local — Analisi del codice e piano di conversione in Rust

> Documento di pianificazione. Nessuna riga di codice applicativo è stata modificata:
> l'unico codice aggiunto è lo spike di verifica in [`docs/rust-port-spike/`](./rust-port-spike/),
> che serve a dimostrare — non ad assumere — che lo stack di dipendenze scelto funziona.

---

## 1. Sintesi e raccomandazione

La conversione è **fattibile senza rinunciare a nulla**, e senza introdurre dipendenze C/C++
o binari precompilati. Ogni dipendenza attuale ha una corrispondenza in Rust puro, con **una
sola eccezione** (la generazione del service worker PWA), che è banale da reimplementare a mano.

**Raccomandazione: mantenere il target browser (WASM)**, non passare a un binario nativo.
La promessa di prodotto — «i file restano nel browser, 0 cookie, 0 upload» — *è* il prodotto.
Un port nativo la manterrebbe tecnicamente ma perderebbe la distribuzione a costo zero
(URL + PWA installabile, nessuna installazione, nessuna firma del codice, nessun aggiornamento).

Lo stack proposto:

| Livello | Scelta |
|---|---|
| Logica di dominio | crate Rust puri, testabili con `cargo test` sull'host |
| PDF | `pdf-extract` (testo + geometria) + `lopdf` (split) + `zip` |
| UI | Leptos 0.8 (CSR) + `web-sys`, build con Trunk 0.21 |
| Deploy | invariato: build statica servita da nginx nell'immagine Docker |

Il beneficio più concreto non è la performance (già accettabile): è che **oggi il progetto non
ha nemmeno un test runner**, e la logica più delicata — estrazione geometrica del netto,
checksum del Codice Fiscale, generazione PAIN.001 — non è coperta da alcun test. La struttura
a workspace proposta rende quella logica testabile con `cargo test`, senza browser e senza
headless runner. Questo è il vero motivo per cui vale la pena farlo.

**Nota di prudenza importante**, prima di tutto il resto: il rischio non è nelle dipendenze
(verificate, vedi §4) ma nella **parità di comportamento sull'estrazione**. `pdfjs` e
`pdf-extract` non spezzano il testo negli stessi frammenti, e le euristiche in
`payslip.ts` sono tarate su quei frammenti. Vedi §6.1 e la Fase 0 in §8: **non iniziare il
port senza aver prima costruito una rete di golden test sull'implementazione TS attuale.**

---

## 2. Inventario del codice attuale

2.987 righe TypeScript in totale, di cui ~1.100 di sola UI imperativa.

| File | LOC | Ruolo | Destinazione |
|---|---:|---|---|
| `src/main.ts` | 1109 | UI, stato, localStorage, download, modali | `slipcut-web` (riscrittura Leptos) |
| `src/core/extraction/payslip.ts` | 354 | layout, nome, netto geometrico, confidence | `slipcut-core` — **parte critica** |
| `src/core/payment-export/pain001.ts` | 244 | 3 profili XML (PAIN.001 v3/v9, CBI) | `slipcut-core` (quick-xml) |
| `src/core/payment-export/exportTemplates.ts` | 207 | config CSV runtime + validazione | `slipcut-core` (serde) |
| `src/core/payment-export/csv.ts` | 188 | parsing/scrittura CSV, righe pagamento | `slipcut-core` |
| `src/workers/pdfWorker.ts` | 153 | pdfjs → testo+geometria, split, ZIP | `slipcut-pdf` + worker |
| `src/core/extraction/codiceFiscale.ts` | 126 | regex CF, checksum, match nome↔CF | `slipcut-core` |
| `src/core/types.ts` | 56 | tipi condivisi | `slipcut-core` |
| `src/core/extraction/periods.ts` | 36 | periodo (mese/anno) | `slipcut-core` |
| `src/core/extraction/number.ts` | 25 | decimali italiani, formattazione | `slipcut-core` |
| `src/core/validation/iban.ts` | 15 | IBAN mod-97 | `slipcut-core` |
| `src/ui/download.ts` | 14 | Blob → download | `slipcut-web` |
| `src/style.css` | — | stile | **invariato** |
| `public/**`, `nginx.conf` | — | asset, serving | **invariati** |

### Codice morto da non portare

Verificato con ricerca dei riferimenti su tutto il sorgente e su `index.html`:

- **`src/counter.ts`** — nessun import. Residuo del template Vite.
- **`src/core/payment-export/paymentRows.ts`** (57 LOC) — nessun import. Contiene una
  `buildPaymentRows` **duplicata e divergente** rispetto a quella realmente usata in
  `csv.ts` (tipo `PaymentRow` diverso: `remittance` invece di `remittanceInformation`,
  nessun `recipientType`/`email`). L'unico match testuale su `paymentRows` è l'id
  dell'elemento DOM in `main.ts`. **Da eliminare, non da portare.**
- **`src/assets/hero.png`, `typescript.svg`, `vite.svg`** — nessun riferimento.
- **`src/core/extraction/sampleExpectations.ts`** — nessun import: sono 12 aspettative
  scritte a mano che *nessun test consuma*. Da promuovere a fixture reale nella Fase 0
  (è già il seme della rete di sicurezza).

Risultato: ~80 righe da cancellare invece di tradurre, e un duplicato divergente eliminato.

---

## 3. Mappatura delle dipendenze

### 3.1 Dipendenze npm dichiarate

| npm | Uso concreto | Crate Rust | Stato |
|---|---|---|---|
| `pdfjs-dist` ^6.1 | `getTextContent()` → `str` + `transform[4..5]` + `width`/`height` per item | **`pdf-extract` 0.12** con `OutputDev` custom | ✅ verificato (§4) |
| `pdf-lib` ^1.17 | `load`, `getPageCount`, `create`, `copyPages`, `save` | **`lopdf` 0.42** | ✅ verificato (§4) |
| `jszip` ^3.10 | `zip.file()`, `generateAsync('arraybuffer')` | **`zip` 8.6** (`default-features = false`, `features = ["deflate"]`) | ✅ verificato |
| `typescript` | — | `rustc` | — |
| `vite` ^8 | dev server, build, hashing asset, worker bundling | **Trunk 0.21** | ✅ equivalente |
| `vite-plugin-pwa` ^1.3 | manifest + service worker Workbox | ⚠️ **nessun equivalente** → SW scritto a mano | vedi §3.3 |

`pdf-extract` merita una nota: dichiara `lopdf` con `default-features = false, features = ["wasm_js"]`
e ri-esporta `pub use lopdf::*`. È quindi **già progettato per WASM**, e permette di usare *un solo*
`lopdf::Document` sia per l'estrazione testo sia per lo split — un parse invece di due
(oggi `pdfWorker.ts` fa `PDFDocument.load()` **e** `pdfjsLib.getDocument()` sullo stesso buffer).
Le sue dipendenze transitive sono tutte Rust puro: `adobe-cmap-parser`, `cff-parser`,
`encoding_rs`, `euclid`, `postscript`, `type1-encoding-parser`, `unicode-normalization`.

### 3.2 Web API usate (la parte che una tabella `package.json` non mostra)

| Web API | Dove | Sostituto Rust | Stato |
|---|---|---|---|
| `XMLDocument` + `createElementNS` + `XMLSerializer` | `pain001.ts` | **`quick-xml` 0.41** (writer) | ✅ verificato |
| `RegExp` (`matchAll`, `split`, `replace`) | tutto `core/` | **`regex` 1.13** | ✅ verificato, incl. la regex CF |
| `String.normalize('NFD')` + strip diacritici | `codiceFiscale.ts` | **`unicode-normalization` 0.1** | ✅ verificato |
| `JSON.parse/stringify` | template, settings | **`serde_json`** + `serde` | ✅ verificato |
| `new URL()` (validazione link) | `exportTemplates.ts` | `url` 2.5 **oppure** check manuale `https?://` | ✅ (vedi §9: `url` costa ~500 KB) |
| `Date` / `toISOString()` | `messageId`, `CreDtTm` | `chrono` (feature `wasmbind`) o `js_sys::Date` | ✅ verificato |
| `Number.toLocaleString('it-IT')` | `formatEuro`, `formatItalianDecimal` | formattatore a mano (~15 righe) | ✅ verificato, vedi §7.3 |
| `String.localeCompare` | ordinamento mappature | confronto semplice o `icu_collator` 2.1 | banale |
| `Web Worker` + transferable `ArrayBuffer` | `main.ts` ↔ `pdfWorker.ts` | `gloo-worker` 0.6 o `web_sys::Worker` | vedi §6.3 |
| `localStorage` | settings, mappature IBAN, template | `web_sys::Storage` | banale |
| `fetch` (config JSON) | `exportTemplates.ts` | `gloo-net` o `web_sys::fetch` | banale |
| `Blob` + `URL.createObjectURL` + `<a download>` | `download.ts` | `web-sys` (stessa sequenza) | banale |
| `File.arrayBuffer()` / `.text()`, drag&drop | `main.ts` | `web-sys` / `gloo-file` | banale |
| `escapeHtml()` fatto a mano | `main.ts` (9 punti) | **non serve**: Leptos fa escaping automatico | miglioramento |
| DOM imperativo (`innerHTML`, `dataset`, `classList`) | `main.ts` | Leptos (dichiarativo) | vedi §6.4 |

### 3.3 L'unico vero buco: la PWA

`vite-plugin-pwa` genera `manifest.webmanifest` + `sw.js` + runtime Workbox (nella build
attuale: 25 entry di precache, 3.238 KiB). In ecosistema Rust **non esiste un equivalente**.

Non è un problema, perché l'app non usa nulla di Workbox oltre al precache puro:
`cleanupOutdatedCaches` + `globPatterns` + `registerType: 'autoUpdate'`. Si sostituisce con:

1. `manifest.json` statico scritto a mano (i valori sono già tutti in `vite.config.ts:9-32`);
2. un service worker cache-first di ~50 righe di JS, con la lista degli asset iniettata a
   build time (Trunk produce nomi con hash, quindi la lista va generata: uno script di build
   di poche righe, oppure `cache.addAll` su un manifest emesso da Trunk).

Costo stimato: mezza giornata. È l'unico punto in cui resta un file `.js` scritto a mano —
inevitabile, perché un service worker *deve* essere JavaScript.

---

## 4. Verifica sperimentale (non assunzioni)

Ho compilato ed eseguito realmente lo stack proposto. Lo spike riproducibile è in
[`docs/rust-port-spike/`](./rust-port-spike/) (`cargo test`, `cargo check --target wasm32-unknown-unknown`).

**Ambiente:** cargo 1.94.1, target `wasm32-unknown-unknown` installato.

### 4.1 Compilazione WASM dell'intero stack

```
cargo check --target wasm32-unknown-unknown
    Finished `dev` profile [optimized] target(s) in 20.37s
```

Compilano senza errori e **senza una singola dipendenza C**: `pdf-extract`, `lopdf`, `zip`,
`quick-xml`, `regex`, `serde_json`, `chrono`, `unicode-normalization`, `url`, `csv`, `euclid`.
Questo è il risultato che risponde direttamente alla domanda «tutte le dipendenze hanno una
libreria corrispondente?»: sì, e nessuna richiede un blob precompilato.

### 4.2 La geometria di pdf.js è riproducibile

`pdf-extract` espone:

```rust
fn output_character(&mut self, trm: &Transform, width: f64, spacing: f64, font_size: f64, char: &str)
```

`trm.m31`/`trm.m32` **senza** applicare il flip verticale corrispondono esattamente a
`transform[4]`/`transform[5]` di pdf.js (spazio PDF, y crescente verso l'alto) — e questo è
essenziale, perché `extractNetAmountFromNettoBox` assume y-up (`const below = label.y - amount.y`,
ordinamento `b[0] - a[0]` in `reconstructLines`). L'ampiezza si ottiene con
`width * sqrt(|v.x * v.y|)` dove `v = trm.transform_vector(vec2(font_size, font_size))`.

Su un PDF sintetico a 2 pagine che imita il layout busta paga (generato da
[`mkpdf.py`](./rust-port-spike/mkpdf.py), con etichetta `NETTO` in basso a destra e due
importi-esca più in alto), l'aggregazione carattere→run produce:

```
x=  60.00 y= 760.00 w=217.85 h=10.00 "RED YARD RESEARCH SRL  CF: 01234567890"
x=  60.00 y= 730.00 w=157.81 h=10.00 "COD. FISC. FRMFRC91P22D086S"
x=  60.00 y= 710.00 w=100.56 h=10.00 "FORMICA FEDERICO"
x=  60.00 y= 690.00 w= 65.58 h=10.00 "GIUGNO 2026"
x=  60.00 y= 400.00 w=127.02 h= 9.00 "1 RETRIBUZIONE ORDINARIA"
x= 300.00 y= 400.00 w= 35.03 h= 9.00 "3.000,00"      <- esca (lordo)
x=  60.00 y= 200.00 w= 51.52 h= 9.00 "IMPONIBILE"
x= 300.00 y= 200.00 w= 35.03 h= 9.00 "2.500,00"      <- esca (imponibile)
x= 380.00 y= 100.00 w= 33.89 h=10.00 "NETTO"
x= 445.00 y= 100.00 w= 38.92 h=10.00 "2.056,00"      <- netto corretto
```

Applicando lo scoring attuale di `extractNetAmountFromNettoBox`: `dx = 445 − (380 + 33.89) = 31.11`,
dentro la finestra `isRightOfLabel` (−4…220), `dy = 0` → `horizontalScore = 90 − |31.11 − 45| = 76.1`,
`verticalScore = 80`, più i bonus. Le esche stanno 300 punti più in alto e vengono escluse dal
vincolo verticale. **L'algoritmo geometrico esistente funziona invariato su queste coordinate.**

### 4.3 La regex del Codice Fiscale compila e matcha

La `CODICE_FISCALE_PATTERN` di `codiceFiscale.ts:2` non usa lookahead/lookbehind/backreference,
quindi è accettata dal crate `regex` così com'è (aggiungendo `(?i)`). Test su **tutti e 13** i
codici fiscali reali presenti in `sampleExpectations.ts` + `RSSMRA80A01H501U`: regex e checksum
li accettano tutti, con estrazione corretta dal contesto.

### 4.4 Pipeline completa end-to-end

```
running 3 tests
test geometry_extraction_reproduces_pdfjs_coordinates ... ok
test page_two_collaborator_layout ... ok
test full_pipeline_splits_and_zips ... ok
```

`full_pipeline_splits_and_zips` fa il giro completo — `lopdf::Document::load_mem` → estrazione
geometrica per pagina → split → ZIP deflate → **riapertura di ogni PDF splittato per verificare
che sia valido e contenga esattamente 1 pagina**.

### 4.5 PDF cifrati: miglioramento, non regressione

`lopdf` 0.42 espone `decrypt()`, `authenticate_owner_password()`, `authenticate_user_password()`;
`pdf-extract` ha gli entry point `*_encrypted`. I PDF di paghe generati dai gestionali sono
spesso protetti con owner password (stampa/copia disabilitate): oggi `pdf-lib` fallisce se non
gli si passa `ignoreEncryption`, che il codice attuale **non** passa. Il port può gestirli
esplicitamente. Vale la pena verificarlo su file reali in Fase 0.

---

## 5. Architettura proposta

```
Cargo.toml                     # workspace
crates/
  slipcut-core/                # Rust puro, ZERO dipendenze wasm/browser
    src/
      types.rs
      money.rs                 # NUOVO: Money(i64 centesimi) — vedi §7.1
      extraction/{number,periods,codice_fiscale,payslip}.rs
      validation/iban.rs
      payment_export/{csv,export_templates,payment_xml,payment_rows}.rs
    tests/
      fixtures.rs              # sampleExpectations.ts promosso a test reale
      golden/                  # CSV e XML attesi, byte per byte
  slipcut-pdf/                 # Rust puro: pdf-extract + lopdf + zip
    src/{geometry.rs,split.rs,lib.rs}
  slipcut-web/                 # unico crate che tocca il browser
    src/{main.rs,worker.rs,storage.rs,download.rs,components/*.rs}
    index.html, sw.js, manifest.json
  slipcut-cli/                 # opzionale, ~100 LOC, riusa core+pdf
```

Il punto chiave del layout: `slipcut-core` e `slipcut-pdf` **non dipendono da `wasm-bindgen`**.
Si testano con `cargo test` normale, su host, senza browser né headless runner — cioè la logica
oggi non testata diventa testabile nel modo più economico possibile. `slipcut-cli` diventa quasi
gratuito (utile per validare batch di PDF reali in CI senza dati personali nel browser).

---

## 6. Rischi, in ordine di gravità

### 6.1 🔴 Segmentazione del testo diversa da pdf.js — *il rischio principale*

pdf.js restituisce un item per operatore di show-text; `pdf-extract` richiama
`output_character` **per carattere**, con hook `begin_word`/`end_word`/`end_line`. L'aggregazione
in run è quindi una scelta *nostra*, e influenza a valle:

- `reconstructLines()` (bucket `Math.round(y/3)*3`, join con spazio) → cambia `rawText`, e
  quindi **tutte** le regex testuali di `payslip.ts`;
- `collectNearbyText(items, anchor, xWindow)` → i bonus `exactNettoBonus`/`collaboratorBonus`
  dipendono da come le etichette sono spezzate;
- il filtro `/^-?\d{1,3}(?:\.\d{3})*,\d{2}$/.test(entry.item.str.trim())`: se un importo viene
  spezzato in due run («2.056» + «,00»), **nessun candidato passa** e si cade nei fallback testuali.

Mitigazione, in ordine:
1. Fase 0: golden corpus generato dall'implementazione TS attuale (§8).
2. Soglie di merge dei run configurabili e tarate contro il golden, non indovinate.
3. Rendere il filtro sull'importo tollerante alla frammentazione (concatenare run adiacenti
   sulla stessa baseline prima di testarlo) — è un irrobustimento utile *anche* alla versione TS.
4. Metrica di accettazione esplicita: la Fase 2 non si chiude se anche un solo campo di una
   pagina del corpus regredisce.

### 6.2 🟠 Fedeltà dello split PDF su file reali

`pdf-lib.copyPages()` ricostruisce l'albero degli oggetti della pagina. Il mio spike usa
`clone` + `delete_pages` + `prune_objects`, che **ha prodotto PDF a 1 pagina validi**, ma su un
PDF sintetico semplice. Su file reali dei gestionali paghe (risorse ereditate dal nodo `Pages`,
XObject condivisi, font sottoinsiemizzati, PDF taggati) serve verifica su file reali.

Inoltre, nota di performance: `doc.clone()` per pagina è O(n²) in memoria. Con `MAX_PAGES = 250`
va sostituito con la costruzione di un `Document` nuovo e la copia del solo sottoalbero della
pagina (equivalente di `copyPages`), oppure clonando una volta e riusando.

Fallback se `lopdf` non regge su PDF reali: `mupdf` (bindings C, ma **AGPL-3.0** — compatibile
con la licenza di questo progetto) o `pdfium-render` (richiede un blob WASM di PDFium
precompilato: da evitare, tradirebbe il «tutto Rust puro»).

### 6.3 🟠 Web Worker in WASM

Oggi il worker è una seconda entry Vite (`new Worker(new URL('./workers/pdfWorker.ts', ...))`)
con `ArrayBuffer` trasferito. In Rust/WASM serve un **secondo binario** compilato a wasm e
registrato in Trunk (`data-bin`), con `gloo-worker` per il protocollo tipizzato. È più
cerimoniale del `postMessage` attuale.

Alternativa da valutare in Fase 4: dato che il PDF nativo compilato è molto più veloce del
JS, si potrebbe restare sul main thread con yield periodici — ma su 250 pagine il rischio di
bloccare la UI resta, quindi il worker è la scelta di default.

### 6.4 🟡 Riscrittura di `main.ts` (1.109 righe)

Non è un rischio tecnico ma è **il 37% del codice** e la voce di costo maggiore. È anche l'unica
parte che *non* si traduce riga per riga: 9 chiamate a `escapeHtml` + `innerHTML` + 60 `getElement`
diventano componenti reattivi. Il codice risultante sarà più corto e strutturalmente immune a
XSS, ma la revisione va fatta a occhio sul comportamento, non sul diff.

### 6.5 🟡 Nessuna rete di sicurezza attuale

`package.json` non ha né test runner né script `test`. Le 12 aspettative in
`sampleExpectations.ts` non sono consumate da nulla. Il commento nel file dice che il PDF
originale non è committabile perché contiene dati personali — quindi la Fase 0 deve produrre
fixture *sintetiche* (come `mkpdf.py` nello spike) più, in locale sulla macchina di chi porta,
una validazione su PDF reali non committati.

---

## 7. Differenze di comportamento da gestire esplicitamente

Queste sono trappole verificate, non ipotetiche. Ognuna merita un test di regressione.

### 7.1 `toFixed(2)` ≠ `format!("{:.2}")` — rischio di scarto di un centesimo

Misurato:

| valore | JS `toFixed(2)` | Rust `{:.2}` |
|---|---|---|
| `0.125` | `0.13` | **`0.12`** |
| `1.005` | `1.00` | `1.00` |
| `2.675` | `2.67` | `2.67` |
| `1234.565` | `1234.57` | `1234.57` |

JS arrotonda half-away-from-zero sulla rappresentazione decimale, Rust half-to-even sul valore
binario. Divergono sui valori esattamente rappresentabili a metà. Nel codice attuale questo
tocca `eur()` in `pain001.ts:52` — usato sia per `InstdAmt` sia per **`CtrlSum`**, che è la somma
di float (`payments.reduce(...)`). Una banca che ricalcola `CtrlSum` e trova un centesimo di
differenza **rifiuta il file**.

**Raccomandazione: introdurre un tipo `Money(i64)` in centesimi** in `slipcut-core`, con parsing
da decimale italiano e formattazione esatta. Elimina la classe di bug alla radice, invece di
replicare il comportamento in virgola mobile di JS. È un miglioramento, non solo una parità.

### 7.2 `\b` in Rust è Unicode-aware, in JS è ASCII

Verificato con test: su `"PERÒNETTO"`, `\bNETTO\b` **non** matcha in Rust (Ò è word char)
ma matcha in JS. Le regex interessate includono `/\bNETTO\b/`, `/\b1352\s+COMPENSO\s+LORDO\b/`,
`/\b(CS|CZ|RC|PG|...)\b$/`, `/\b(RED|YARD|RESEARCH|SRL|VIA|...)\b/`, `/\b\d+\b/`.

Fix meccanico: usare `(?-u:\b)` per replicare la semantica JS. Analogamente `(?i)` in Rust
applica il case-folding Unicode (`K` Kelvin, `ſ`): dove l'intento è ASCII, usare `(?i-u:...)`.
Da applicare **a tutte** le regex portate, con una checklist file per file.

### 7.3 Formattazione locale

Nel browser, `(1234.56).toLocaleString('it-IT', {style:'currency',currency:'EUR'})` produce
`1.234,56` + **U+00A0** (spazio non separabile) + `€`. Il formattatore a mano (verificato:
`1.234,56`, `1.234.567,50`, `-1.234,56`, `999,00`) deve riprodurre raggruppamento, virgola
decimale e, se si vuole parità visiva esatta, l'NBSP prima di `€`. È solo display
(`formatEuro` è usata nella tabella e nel riepilogo), quindi non è critico — ma va deciso
consapevolmente, non scoperto in review.

### 7.4 Serializzazione XML

`XMLSerializer` del browser non indenta e non emette newline finale; `quick-xml` con
`new_with_indent` indenta. L'XML resta **semanticamente** equivalente (verificato:
`<InstdAmt Ccy="EUR">2056.00</InstdAmt>`, namespace sul root ereditato dai figli, come fa oggi
`createElementNS`). Conseguenza pratica: i golden file XML vanno **rigenerati**, non confrontati
byte a byte con l'output attuale. Da decidere se indentare (più leggibile per il debug con la
banca) o restare compatto.

### 7.5 Parsing CSV

`splitCsvLine()` in `csv.ts:11` ha semantica non standard: sniffing del separatore
(`;` solo se presente e non c'è `,`), `trim()` di ogni campo, gestione delle quote non
conforme a RFC 4180. Il crate `csv` **non** riproduce questo comportamento. Raccomandazione:
**portare a mano il parser esistente** (30 righe) per garantire che i CSV già in uso dai clienti
continuino a essere letti identicamente, e non introdurre `csv` come dipendenza (risparmia
anche peso, §9).

---

## 8. Piano di migrazione a fasi

Ogni fase ha un **gate** verificabile. Stime per uno sviluppatore, in giorni-uomo.

### Fase 0 — Rete di sicurezza *(prerequisito assoluto)* — 2-3 g

Da fare **in TypeScript, prima di scrivere Rust applicativo**:

1. Aggiungere Vitest e uno script `npm test`.
2. Promuovere `sampleExpectations.ts` a test reale.
3. Generatore di PDF sintetici (adattare [`mkpdf.py`](./rust-port-spike/mkpdf.py)) che copre
   entrambi i layout (`employee`, `collaborator`), i casi `netto-box-position` e ciascun
   fallback, e le pagine che devono essere scartate.
4. Dump golden dall'implementazione attuale: `extraction_rows.json`, `extraction_summary.csv`,
   CSV per tutti e 3 i template di `export-templates.default.json`, XML per tutti e 3 i profili.
5. Verifica su PDF reali (in locale, non committati) che `lopdf` splitti correttamente e gestisca
   eventuale cifratura — **gate go/no-go per la §6.2**.

**Gate:** golden corpus committato + `npm test` verde. *Questa fase ha valore anche se il port
viene rinviato*: chiude il buco della §6.5 sul codice in produzione oggi.

### Fase 1 — `slipcut-core`, parti deterministiche — 2-3 g
`money.rs` (§7.1), `number.rs`, `iban.rs`, `periods.rs`, `codice_fiscale.rs`.
Tutto già verificato nello spike; nessuna incognita.
**Gate:** i 13 CF delle fixture passano; IBAN mod-97 e decimali italiani con test di proprietà.

### Fase 2 — `slipcut-pdf` + `payslip.rs` — 4-6 g ⚠️ *fase a rischio*
`OutputDev` con aggregazione in run, `reconstructLines`, split, ZIP; poi il port di
`payslip.ts` con la checklist regex della §7.2.
**Gate:** zero regressioni campo-per-campo sul golden della Fase 0. Se non si raggiunge,
si taratura le soglie di merge — non si allentano le aspettative.

### Fase 3 — Export — 2-3 g
`payment_rows.rs`, `csv.rs` (parser portato a mano, §7.5), `export_templates.rs` (serde con
messaggi d'errore equivalenti — sono mostrati in UI), `payment_xml.rs` (quick-xml, 3 profili).
**Gate:** CSV identici byte a byte al golden; XML equivalenti semanticamente, validati contro
gli XSD `pain.001.001.03` e `.09`.

### Fase 4 — `slipcut-web` — 5-8 g
Leptos CSR; worker `gloo-worker`; `storage.rs`; `download.rs`; componenti: upload/drag&drop,
tabella estrazione, modale mappatura IBAN, tab CSV/XML, editor template, modale celebrazione.
`style.css` invariata: le classi CSS vanno riprodotte fedelmente nel markup.
**Gate:** walkthrough manuale di tutti i flussi + confronto visivo con la versione attuale.

### Fase 5 — Build e deploy — 1-2 g
`Trunk.toml`; `manifest.json` + service worker a mano (§3.3); Dockerfile multi-stage
(`rust:alpine` + `trunk build --release` → `nginx:alpine`); `nginx.conf` invariato salvo
verifica del MIME `application/wasm` (**già presente**, `nginx.conf:22`); README aggiornato.
**Gate:** `docker build` + `docker run` funzionanti; PWA installabile; Lighthouse ≥ attuale.

### Fase 6 — Validazione e cutover — 2-3 g
Esecuzione parallela su PDF reali (vecchia e nuova versione a confronto), `wasm-opt -Oz`,
misura del bundle, aggiornamento versione e `Version history` nel README.

**Totale: ~18-28 giorni-uomo**, di cui ~5 di sola UI e ~5 nella fase a rischio.

Percorso a rischio ridotto, se si vuole valore prima: fermarsi dopo la Fase 3 e spedire
`slipcut-cli` (batch di PDF da terminale) **mantenendo l'app TS in produzione**. Si ottiene
un core Rust testato e utile, e la decisione sulla Fase 4 (la più costosa) resta aperta.

---

## 9. Dimensione del bundle e performance

Misurato in questo ambiente (nessun `wasm-opt` disponibile, quindi i numeri Rust sono un
limite superiore).

**Build JS attuale** (`npm run build`, precache totale 3.238 KiB):

| file | raw | gzip |
|---|---:|---:|
| `pdf.worker-*.mjs` | 2.154 KB | 455 KB |
| `pdfWorker-*.js` | 931 KB | 324 KB |
| `index-*.js` | 41 KB | 12 KB |
| **totale JS** | **3.126 KB** | **792 KB** |

**Spike Rust** (`opt-level="z"`, `lto`, `panic=abort`, `strip`):

| variante | raw | gzip |
|---|---:|---:|
| stack completo | 2.579 KB | 981 KB |
| senza `url` + `csv` + `chrono` | **2.061 KB** | **833 KB** |

Lettura onesta: **è un pareggio**. Raw ~34% più piccolo, gzip ~5% più grande (il WASM comprime
peggio del JS). Con `wasm-opt -Oz` (tipicamente −10…20%) e senza `url`/`csv`/`chrono` si va
sotto il JS attuale anche gzipped; a questo si aggiungono ~100-200 KB di glue Leptos +
`wasm-bindgen`. **Nessuna regressione attesa, ma non aspettarsi un miglioramento
significativo**: il peso non è un argomento a favore della conversione.

Note di ottimizzazione emerse dalla misura:
- `url` + `csv` + `chrono` costano **518 KB raw / 148 KB gzip** in tre. Tutti evitabili:
  `url` serve solo a validare `http(s)` in `exportTemplates.ts:57`; il parser CSV va portato
  a mano comunque (§7.5); per le date basta `js_sys::Date`.
- `regex` è il blocco singolo più pesante che resta. Se il peso diventasse critico, valutare
  `regex-lite` (nessuna tabella Unicode) — i pattern usano range espliciti (`À-Ö`) che
  potrebbero funzionare, ma va verificato pattern per pattern.

Sulla performance: nessuna misura, quindi nessuna promessa. Ci si può ragionevolmente
aspettare un'estrazione più rapida (parsing nativo, un solo parse del documento invece di
due), ma **non è questo il motivo per convertire** — il motivo è la testabilità (§1).

---

## 10. Licenze

Il progetto è **AGPL-3.0-or-later**. Tutti i crate proposti sono permissivi e compatibili:
`pdf-extract` MIT, `lopdf` MIT, `zip` MIT, `quick-xml` MIT, `regex` MIT/Apache-2.0,
`serde`/`serde_json` MIT/Apache-2.0, `unicode-normalization` MIT/Apache-2.0, `leptos` MIT,
`euclid` MIT/Apache-2.0, `encoding_rs` (Apache-2.0/MIT/BSD-3).

Nessun crate copyleft entra nel grafo. Il fallback `mupdf` della §6.2 è AGPL-3.0: compatibile
con questo progetto, ma va una scelta consapevole (e resta una dipendenza C).

---

## 11. Decisioni aperte

Assunzioni con cui è scritto questo piano — da confermare o correggere:

1. **Target browser/WASM** (raccomandato, §1) e non nativo. Se invece l'obiettivo prioritario
   fosse l'uso batch interno, conviene invertire l'ordine: Fasi 0-3 + `slipcut-cli`, e Fase 4
   solo dopo.
2. **`Money` in centesimi** (§7.1) — cambia le firme pubbliche del core rispetto al TS
   (`f64` → `Money`). Lo raccomando: elimina il rischio di rifiuto bancario su `CtrlSum`.
3. **Indentazione dell'XML** (§7.4): compatta come oggi, o indentata (più leggibile nei
   confronti con la banca)?
4. **Parità visiva esatta** di `formatEuro` (§7.3), NBSP incluso, o formattazione semplificata?
5. **Doppia manutenzione**: se il port procede a fasi, l'app TS resta in produzione fino alla
   Fase 6. Se in quel periodo arrivano modifiche funzionali, vanno applicate due volte —
   oppure si congelano le feature durante il port.

---

## Appendice — Riprodurre le verifiche

```bash
cd docs/rust-port-spike
python3 mkpdf.py sample.pdf          # PDF sintetico stile busta paga
cargo test                           # 8 test: regex CF, checksum, money, \b, XML, pipeline PDF
cargo check --target wasm32-unknown-unknown   # compilazione WASM dell'intero stack
cargo build --release --target wasm32-unknown-unknown && \
  ls -l target/wasm32-unknown-unknown/release/*.wasm   # misura del peso
```

Lo spike è **codice usa-e-getta a scopo di prova**: non è il port, non va mantenuto, e va
cancellato quando `crates/` esiste. Serve a rendere le affermazioni di questo documento
verificabili invece che credute.
