# Alternative senza WASM — ReScript (raccomandato), e Python

> Companion di [`RUST_PORT_PLAN.md`](./RUST_PORT_PLAN.md). Verifiche riproducibili in
> [`docs/rescript-spike/`](./rescript-spike/). Nessun codice applicativo modificato.

---

## 1. Risposta breve

**ReScript.** Compila in JavaScript ESM leggibile, quindi non c'è nessun WASM, nessun
`wasm-bindgen`, nessun payload binario e nessun cambio di toolchain: Vite, `vite-plugin-pwa`,
nginx e il Dockerfile restano identici.

Il punto decisivo non è la sintassi: è che **`pdfjs-dist`, `pdf-lib` e `jszip` restano al loro
posto**. Nel piano Rust ho dovuto trovare un sostituto per ognuno e poi dimostrare che la
geometria di pdf.js fosse riproducibile. Qui non c'è niente da sostituire — si scrivono
binding tipizzati e si chiamano le stesse librerie.

Conseguenza diretta: **quasi tutti i rischi e le trappole di parità del piano Rust svaniscono.**
Non vengono mitigati: cessano di esistere, perché il runtime è lo stesso.

| Rischio / trappola del piano Rust | Con ReScript |
|---|---|
| §6.1 🔴 segmentazione testo diversa da pdf.js — *il rischio principale* | **eliminato**: è pdf.js |
| §6.2 🟠 fedeltà dello split PDF su file reali | **eliminato**: è `pdf-lib.copyPages()` |
| §6.3 🟠 Web Worker in WASM (secondo binario, `gloo-worker`) | **eliminato**: stesso `new Worker(...)` |
| §7.1 `toFixed(2)` ≠ `format!("{:.2}")` (rischio `CtrlSum`) | **eliminato**: è `Number.prototype.toFixed` |
| §7.2 `\b` Unicode in Rust vs ASCII in JS | **eliminato**: è `RegExp` nativa, stessa stringa di pattern |
| §7.3 `toLocaleString('it-IT')` da riscrivere | **eliminato**: è `toLocaleString` |
| §7.4 `XMLSerializer` → `quick-xml`, golden XML da rigenerare | **eliminato**: `XMLSerializer` è disponibile |
| §3.3 ⚠️ PWA: service worker a mano | **eliminato**: `vite-plugin-pwa` continua a funzionare |
| §9 bundle: +833 KB gzip di WASM | **eliminato**: i moduli portati pesano **2,1 KB gzip** |
| §6.4 🟡 riscrittura di `main.ts` (1.109 righe) | **non necessaria**: `main.ts` può restare TypeScript |
| §6.5 🟡 nessuna rete di sicurezza | **resta**: va costruita comunque (vedi §6) |

E resta il beneficio che nel piano Rust ho individuato come *unica* motivazione reale: la logica
di dominio diventa testabile con `node`, senza browser né headless runner.

---

## 2. Verifica sperimentale

Stesso standard usato per Rust: compilato ed eseguito, non ipotizzato.
ReScript 12.3.0. Riproducibile con `npm test` in [`docs/rescript-spike/`](./rescript-spike/).

### 2.1 La regex del Codice Fiscale è *la stessa stringa*

`CodiceFiscale.res` riusa il pattern di `codiceFiscale.ts:2` letteralmente — nessuna
traduzione di dialetto, perché `RegExp.fromString` costruisce una `RegExp` del runtime:

```rescript
@new external fromString: (string, ~flags: string=?) => t = "RegExp"
@send external test: (t, string) => bool = "test"
```

Tutti e 13 i codici fiscali reali di `sampleExpectations.ts` passano checksum ed estrazione,
più i casi negativi (CF manomesso, testo senza CF, due CF con ordine preservato).

### 2.2 Interop a runtime con le librerie esistenti

`InteropTest.res` non si limita a compilare i binding: li **esegue**.

```
pdf-lib page count: 2
zip bytes: 2571
ok   every split file is a valid 1-page PDF
interop: pdf-lib + jszip driven from ReScript, all good
```

È esattamente la pipeline che nello spike Rust ho dovuto ricostruire con `lopdf` + `zip`,
qui ottenuta guidando `pdf-lib` e `jszip` invariati.

### 2.3 Le due classi di bug che il compilatore chiude

**Fallback silenzioso sulle union.** `exportTemplates.ts:187-200` fa `switch` su
`CsvTemplateSource` e chiude con `default: return { value: '', numeric: false }`: aggiungere una
sorgente CSV produce **colonne vuote in silenzio**, non un errore. Come variante ReScript la
compilazione fallisce se manca un caso. Il JS generato resta banale:

```js
function valueForColumn(payment, source) {
  switch (source) {
    case "BeneficiaryName" : return payment.beneficiaryName;
    case "RecipientBankCountry" : return payment.iban.slice(0, 2).toUpperCase();
    case "Amount" : return payment.amount.toFixed(2);
    ...
```

**Asserzioni non verificate al confine.** `main.ts:1076` fa `JSON.parse(raw) as PaymentSettings`,
che il compilatore accetta senza controllare nulla; stessa cosa in `parseIbanMappingCsv`
(`values as [string, string, string, RecipientType, string]`). In `main.ts:682` c'è già
`isWorkerDoneMessage()` scritto a mano *proprio perché* TypeScript non può aiutare lì.
ReScript **non ha `as`**: `decodeSettings` nello spike deve dimostrare la forma partendo da
`JSON.t`, e i test verificano che rifiuti forma sbagliata e JSON malformato.

Bonus dalla stdlib: `String.get` restituisce `option<string>` e `String.charCodeAt`
restituisce `option<int>`, quindi l'indicizzazione fuori range non può diventare `undefined`
silenziosamente come in `cf[i]` (`codiceFiscale.ts:27`).

### 2.4 Migrazione incrementale, verificata nei due sensi

Questa è la proprietà che rende l'operazione reversibile. `genType` emette `.d.ts` reali:

```ts
export const parseItalianDecimal: (value: string) => (undefined | number)
export const isValidIban: (input: string) => boolean
```

`option<float>` attraversa il confine come `number | undefined`. Un modulo ancora TypeScript
(`src/consumer.ts` nello spike) lo consuma e **tipa correttamente sotto `--strict`**: ho
inserito un errore deliberato (`const broken: number = isValidIban('IT60')`) e `tsc` lo ha
rilevato (`TS2322: Type 'boolean' is not assignable to type 'number'`); rimosso l'errore, il
check passa pulito. Serve una sola riga di shim ambientale (`declare module "*.res.mjs";`).

Quindi: si converte **un file alla volta**, con il compilatore che presidia la cucitura, e in
qualsiasi momento si può fermarsi lasciando il resto in TypeScript. Con Rust/WASM questo non
è possibile: ogni confine diventa marshalling attraverso `wasm-bindgen`.

### 2.5 Peso

I due moduli di dominio portati, bundlati e minificati con esbuild (stdlib inclusa,
tree-shaken): **4.914 byte minificati, 2.125 byte gzip**.

Da confrontare con il piano Rust §9: 833 KB gzip di WASM a fronte di 792 KB di JS attuale.
Qui il delta di bundle è **rumore di fondo**: il peso resta dominato da `pdfjs-dist`, che
non cambia.

---

## 3. Perché ReScript e non gli altri candidati

Tutti compilano in JS, quindi tutti soddisfano il vincolo «niente WASM». Il criterio
discriminante per *questa* applicazione è l'interoperabilità con tre librerie JS pesanti.

| Candidato | Verdetto |
|---|---|
| **ReScript 12.3** | **Scelto.** FFI diretta a costo zero (`external` → chiamata JS), output ESM leggibile, tipi sound senza `any`, `genType` per la migrazione graduale, toolchain di un solo pacchetto npm |
| **Elm 0.19.1** | Scartato. FFI **solo tramite ports** (messaggi asincroni): pdfjs/pdf-lib/jszip resterebbero in JS, cioè la parte più complessa non verrebbe convertita. Inoltre di fatto congelato (0.19.1 dal 2019; su npm solo la prerelease 0.19.2-0) |
| **PureScript 0.15.16** | Tecnicamente valido, FFI buona, ma ecosistema più piccolo e curva Haskell più ripida per un'app di 3k righe |
| **F#/Fable, Kotlin/JS, Scala.js** | Scartati per peso della toolchain: introdurre .NET o JVM in un frontend di 3k righe non si ripaga |
| **Dart/Flutter web** | Scartato: rendering su canvas — butterebbe via `style.css` e l'HTML accessibile esistente (form, `role="tablist"`, `aria-*`) |
| **ClojureScript** | Scartato: tipizzazione dinamica, perde la motivazione principale |
| **Gleam** | Interessante (target JS, FFI semplice), ma ecosistema giovane; per codice che genera flussi di pagamento preferisco maturità |
| **TypeScript (restare)** | Da considerare seriamente — vedi §6 |

---

## 4. Cosa convertire, e cosa lasciare in TypeScript

Qui sta la differenza pratica più grossa rispetto al piano Rust.

| Parte | LOC | Azione |
|---|---:|---|
| `src/core/**` (estrazione, validazione, export) | 1.251 | **→ ReScript.** È la logica di valore, quella con i bug costosi e zero test |
| `src/workers/pdfWorker.ts` | 153 | **→ ReScript**, con i binding di `PdfLibs.res` |
| `src/main.ts` (UI, DOM, localStorage, modali) | 1.109 | **resta TypeScript.** Nessun beneficio a riscriverla; è la parte che il piano Rust costringeva a rifare da zero |
| `src/ui/download.ts`, `style.css`, `public/**` | — | invariati |
| `counter.ts`, `paymentRows.ts`, 3 asset | ~80 | **cancellare** (codice morto, vedi piano Rust §2) |

Se in futuro si volesse anche la UI dichiarativa, `rescript-react` è la strada — ma è una
decisione separata e successiva, non un prerequisito.

---

## 5. Piano a fasi

Incrementale per costruzione: ogni fase lascia l'app funzionante e spedibile.

**Fase 0 — rete di sicurezza (2-3 g).** Identica alla Fase 0 del piano Rust e *già necessaria
oggi*: Vitest, `sampleExpectations.ts` promosso a test reale, generatore di PDF sintetici,
golden per CSV/XML. Con ReScript però questi golden restano validi **per sempre**, perché
l'XML non viene rigenerato da un serializzatore diverso.

**Fase 1 — setup (0,5 g).** `rescript` in devDependencies, `rescript.json`, `gentypeconfig`,
lo shim `*.res.mjs`, script npm. Vite consuma i `.res.mjs` senza plugin.

**Fase 2 — foglie del core (1-2 g).** `iban.ts`, `number.ts`, `periods.ts`, `codiceFiscale.ts`
(≈200 LOC). Già portati nello spike: nessuna incognita. `main.ts` continua a importarli via
`genType`.

**Fase 3 — `payslip.ts` (2-3 g).** Il pezzo delicato — ma le euristiche geometriche restano
valide alla lettera, perché gli item continuano ad arrivare da `getTextContent()`. È una
traduzione di sintassi, non una re-derivazione di algoritmo.

**Fase 4 — export (2-3 g).** `csv.ts`, `exportTemplates.ts` (validazione come decoder,
mantenendo i messaggi d'errore mostrati in UI), `pain001.ts` (con `XMLSerializer` invariato →
golden XML byte-identici).

**Fase 5 — worker (1 g).** `pdfWorker.ts` con i binding già scritti in `PdfLibs.res`.

**Fase 6 — pulizia (0,5 g).** `"strict": true` in `tsconfig.json` (verificato: **zero errori
oggi**, quindi è gratis), cancellazione del codice morto, README.

**Totale: ~9-13 giorni-uomo**, contro **18-28** del piano Rust, senza big bang e con la
possibilità di fermarsi a qualsiasi fase.

---

## 6. L'opzione da non ignorare: restare in TypeScript

Il piano Rust concludeva che la motivazione reale non era né la performance né il peso, ma la
**testabilità**. E la testabilità non dipende dal linguaggio.

Due misure fatte adesso su questo repository:

- `npx tsc --noEmit --strict` → **0 errori**. Il codice è già strict-clean: `strict` non è
  attivo in `tsconfig.json`, ma attivarlo non rompe nulla. Una riga, effetto immediato come
  guardrail per il futuro (non scopre bug latenti: il codice è scritto con cura).
- Non esiste né test runner né script `test`. **Questo è il vero buco.**

Quindi la Fase 0 + `"strict": true` — **2-3 giorni, in TypeScript** — catturano la maggior
parte del valore. Sarebbe disonesto presentare il cambio di linguaggio come il modo di ottenere
quel risultato.

Cosa aggiunge ReScript sopra quella base: l'eliminazione strutturale di due classi di bug che
TypeScript non può chiudere nemmeno in `strict` (§2.3) — union con fallback silenzioso e
asserzioni `as` non verificate al confine — in un'app che **genera flussi di pagamento
bancari**, dove una colonna CSV vuota o un `CtrlSum` sbagliato costano una distinta rifiutata.

Criterio di decisione:

- Se l'obiettivo è **ridurre il rischio ora, al minimo costo** → Fase 0 + `strict`, restando
  in TypeScript. Fine.
- Se l'obiettivo è **rendere impossibili quelle classi di bug** e si accetta di introdurre un
  linguaggio in più → Fase 0 + ReScript su `src/core/`, incrementale e reversibile.
- Se l'obiettivo era **Rust** per performance o peso → i numeri del piano non lo giustificano
  (§9 di quel documento: il bundle è un pareggio).

Raccomandazione: **Fase 0 subito in TypeScript**, indipendentemente dalla decisione sul
linguaggio; poi ReScript su `src/core/` se si vuole la garanzia strutturale.

---

## 7. Punti che restano aperti, e che nessun linguaggio risolve da solo

1. **Money in virgola mobile.** ReScript elimina la *divergenza* di `toFixed` vista in Rust,
   ma non il fatto che `CtrlSum` sia una `reduce` di `float`. La raccomandazione del piano
   Rust (§7.1) resta valida: rappresentare gli importi in centesimi interi, o almeno un tipo
   nominale `Money`. ReScript lo esprime bene con un modulo a tipo astratto.
2. **Il parser CSV non conforme a RFC** (`csv.ts:11`: sniffing del separatore, `trim()` dei
   campi) va mantenuto così com'è per non rompere i CSV già in uso dai clienti. Portarlo
   letteralmente, non sostituirlo.
3. **Curva di apprendimento e bus factor.** ReScript è un linguaggio in meno di persone che lo
   conoscono rispetto a TypeScript. Mitigazione: l'output è JS leggibile e il confine è
   tipizzato, quindi un rientro a TypeScript è sempre possibile file per file — cosa che con
   WASM non sarebbe vera.
4. **Come sopra per Rust:** doppia manutenzione durante la transizione. Qui però è molto meno
   grave, perché la migrazione è per file e non esiste una finestra in cui coesistono due app.

---

## 8. E Python?

Verificato con misure, non a intuito (script: [`python-oracle/oracle.py`](./python-oracle/oracle.py)).

**Come linguaggio dell'applicazione: no.** Ma per un motivo diverso da quello che si
aspetterebbe, e con un'eccezione che vale la pena cogliere.

### 8.1 Nel browser, Python *è* WASM — e nella variante peggiore

Python nel browser significa Pyodide (CPython compilato a WASM) o PyScript. Quindi non
soddisfa il vincolo «niente WASM»: lo soddisfa meno di tutti.

- Pacchetto npm `pyodide` 314.0.3: **6,2 MB**, prima di qualunque libreria PDF. Confronto col
  piano Rust §9: 2,0 MB raw / 833 KB gzip per l'intero stack, e 792 KB per il JS attuale.
- **La libreria buona trascina tre estensioni native.** `pdfplumber` dipende da
  `pdfminer.six` (→ `cryptography`, estensione Rust: `_rust.abi3.so`), `Pillow` (C) e
  `pypdfium2` — cioè **PDFium**, lo stesso blob C++ che nel piano Rust §6.2 avevo scartato
  per non tradire il «tutto puro». In Pyodide vanno risolti come wheel native precompilate,
  legandosi al set di pacchetti che Pyodide distribuisce.
- **Il ripiego puro-Python non funziona.** `pypdf` è puro Python (`cryptography` è solo un
  extra opzionale), ma la sua geometria è inservibile per questo algoritmo. Il visitor
  restituisce la matrice all'inizio del gruppo di testo, non per frammento:

  ```
  x= 380.00 y= 100.00 size= 10.0 'NETTO'
  x= 380.00 y= 100.00 size= 10.0 '2.056,00'     <- x reale: 445
  x=  60.00 y= 400.00 size=  9.0 '3.000,00'     <- x reale: 300
  ```

  Con queste coordinate `dx = 380 − 413.89 = −33.89`, fuori dalla finestra `dx >= -4` di
  `extractNetAmountFromNettoBox`: l'importo verrebbe **scartato** e si cadrebbe nei fallback
  testuali. Cioè si perderebbe esattamente la funzione più importante dell'app.

### 8.2 Lato server: non è un port, è un altro prodotto

Un backend Python (FastAPI/Flask) risolverebbe tutto tecnicamente e distruggerebbe il
prodotto: cedolini e IBAN verrebbero **caricati su un server**, in contraddizione diretta con
`🔒 I file restano nel browser · 0 cookie` nella pagina, col footer, col README e col testo
della modale. In più farebbe scattare obblighi che oggi l'architettura evita *per costruzione*
— responsabile del trattamento, DPA, retention, notifica di violazione su dati retributivi.
Non è un compromesso di ingegneria: è la fine della ragione per cui l'app esiste.

Un desktop app (PyQt + PyInstaller) manterrebbe l'elaborazione locale ma perderebbe la
distribuzione a costo zero (niente URL, niente PWA, firma del codice per piattaforma,
aggiornamenti da gestire).

### 8.3 Dove Python è invece la scelta migliore di tutte

**L'ecosistema PDF di Python è il più forte tra tutti quelli esaminati** — semplicemente non
serve nel browser. `pdfplumber` risolve con primitive ciò che `payslip.ts` approssima con ~50
righe di scoring a mano: `extract_words()` dà `x0/x1/top/bottom` per parola, e `crop()` legge
direttamente una regione rettangolare. Sul PDF sintetico dello spike:

```json
{ "label": "NETTO", "amount": "2.056,00", "dx": 31.11, "dy": 0.0, "box_text": "NETTO 2.056,00" }
```

`dx = 31.11`, identico a quello calcolato dallo spike Rust e a quello che l'euristica JS
attuale si aspetta. Il layout `collaborator` viene riconosciuto con
`box_text: "NETTO CORRISPOSTO 1.851,00"`.

Quindi la raccomandazione utile è: **Python come oracolo di test, non come applicazione.**

Nella Fase 0 (§5 — la fase che serve comunque, in qualunque scenario) serve un riferimento
indipendente per costruire il corpus golden e per validare l'estrazione su cedolini reali
offline. Una seconda implementazione, scritta con una libreria diversa, è molto più
convincente di aspettative scritte a mano: se `pdfplumber` e l'app concordano sul netto di
ogni pagina, il numero è giusto; se divergono, c'è un caso da guardare.

Nota: Python **è già in questo repository in quel ruolo** — `rust-port-spike/mkpdf.py` genera
le fixture PDF sintetiche. `python-oracle/oracle.py` estende lo stesso ruolo alla verifica.
Nessuno dei due finisce nel bundle.
