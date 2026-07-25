# JS puro senza Node né npm — nessun build step

> Terzo scenario valutato, dopo [Rust/WASM](./RUST_PORT_PLAN.md) e
> [ReScript](./NON_WASM_ALTERNATIVE.md). Prototipo funzionante e verificato in Chromium:
> [`docs/no-build-spike/`](./no-build-spike/). Nessun codice applicativo modificato.

---

## 1. Risposta breve

**Sì, e di tutte le opzioni discusse è la più realistica** — perché non è una conversione:
è una *rimozione*.

Prima però va sciolta un'ambiguità: **a runtime Node e npm non ci sono già oggi.** L'app è
JavaScript che gira nel browser; Node serve solo in fase di build (`tsc && vite build`) e npm
solo a scaricare le dipendenze. Nessuna riga di Node finisce nel `dist/`.

Quindi la domanda vera è: *si può togliere anche il build step?* Sì, e serve una sola cosa
non banale — decidere cosa fare delle tre librerie:

| Libreria | Sorte |
|---|---|
| `pdfjs-dist` | **vendorata**: spedisce già `build/pdf.min.mjs` + `pdf.worker.min.mjs`, ESM nativo importabile senza bundler |
| `pdf-lib` | **vendorata**: spedisce `dist/pdf-lib.esm.min.js`, ESM nativo |
| `jszip` | **eliminata**: sostituita da ~90 righe di JS che usano `CompressionStream('deflate-raw')` del browser |

Il codice dell'applicazione diventa JS a moduli ES caricati direttamente dal browser. Nessun
bundler, nessun transpiler, nessun `node_modules`, nessun lockfile.

---

## 2. Verifica sperimentale

Stesso standard degli altri due documenti: eseguito, non ipotizzato. Il prototipo in
[`no-build-spike/`](./no-build-spike/) è stato **caricato in Chromium** (servito da
`python3 -m http.server`) e ha completato la pipeline reale.

### 2.1 Import ESM nativi, zero bundler

```js
import * as pdfjsLib from './vendor/pdf.min.mjs';
import { PDFDocument } from './vendor/pdf-lib.esm.min.js';
import { ZipWriter } from './zip.js';
```

Percorsi relativi risolti dal browser. Output nel browser:

```
pdf.js 6.1.200 loaded as a native ES module (no bundler)
pages: 2
x=  60.00 y= 730.00 w=157.81 "COD. FISC. FRMFRC91P22D086S"
x= 380.00 y= 100.00 w= 33.89 "NETTO"
x= 445.00 y= 100.00 w= 38.92 "2.056,00"

NETTO -> amount dx = 31.11 (same baseline: true)
zip: 1997 bytes, entries written with CompressionStream('deflate-raw')
every split file is a valid 1-page PDF: true
OK — pipeline complete with no build step
```

`dx = 31.11`: **lo stesso numero** ottenuto dallo spike Rust, dall'oracolo Python e
dall'implementazione attuale. Quattro strade diverse, stessa geometria.

### 2.2 jszip è davvero eliminabile

`zip.js` (90 righe: CRC32, local file header, central directory, EOCD) usa il deflate della
piattaforma. L'archivio prodotto **dal browser** è stato validato da strumenti esterni:

```
$ unzip -t out.zip
    testing: page_1.pdf               OK
    testing: page_2.pdf               OK
    testing: extraction_rows.json     OK
No errors detected in compressed data of out.zip.
```

```
python zipfile — testzip(): None
  page_1.pdf            deflate   816/ 1185 bytes  crc=e0f78935  utf8flag=True
  page_2.pdf            deflate   835/ 1172 bytes  crc=0d5633d7  utf8flag=True
  extraction_rows.json  store      16/   16 bytes  crc=cbe412c5  utf8flag=True
```

Nota `extraction_rows.json`: 16 byte, salvato **store** e non deflate — la guardia
«non comprimere se il risultato cresce» funziona. `CompressionStream` è disponibile in tutti
i browser evergreen; è la stessa API usata dalle Fetch/Streams.

### 2.3 La conversione TS → JS è meccanica

`tsconfig.json:20` ha già **`erasableSyntaxOnly: true`**, che vieta enum, namespace e
parameter properties: cioè garantisce per costruzione che i tipi siano *solo* annotazioni da
cancellare. Verificato emettendo JS con `tsc`:

| file | `.ts` | `.js` emesso |
|---|---:|---:|
| `core/validation/iban` | 15 | 16 |
| `core/extraction/payslip` | 354 | 289 |
| `core/payment-export/pain001` | 244 | 183 |
| `main` | 1109 | 1051 |

Il diff su `iban.ts` mostra **solo** riformattazione (indentazione a 4 spazi, corpo degli `if`
a capo) e rimozione delle annotazioni: nessuna differenza di logica. La riduzione di righe
viene interamente da interfacce e type alias che scompaiono — `core/types.ts` diventa un
modulo vuoto da cancellare.

Quindi la conversione la fa il compilatore stesso, una volta, e poi si formatta l'output.
Non è lavoro manuale a rischio di errore.

### 2.4 Vendoring senza npm

[`fetch-vendor.sh`](./no-build-spike/fetch-vendor.sh) scarica i due pacchetti con `curl` e
`tar` dal registry, estrae i soli file ESM e **copia le rispettive licenze**. Eseguito e
verificato:

```
vendor/pdf.worker.min.mjs      1226 KB   (Apache-2.0)
vendor/pdf-lib.esm.min.js       511 KB   (MIT)
vendor/pdf.min.mjs              442 KB   (Apache-2.0)
vendor/LICENSE.pdfjs-dist, vendor/LICENSE.pdf-lib
```

Totale **2,2 MB** da committare (o da rigenerare in CI). Da confrontare col JS prodotto oggi
dalla build: 3,05 MB — perché la build attuale include anche jszip e non fa tree-shaking di
pdf.js.

Un dettaglio da decidere con i cedolini reali: `cmaps/` (1,7 MB) e `standard_fonts/`
(804 KB) di pdf.js servono solo per font CID/CJK o standard non incorporati. Lo script li
lascia commentati; sui PDF di test non sono necessari, ma va confermato sui file veri.

---

## 3. Cosa si guadagna

- **Il Dockerfile perde lo stage di build.** Da `node:22-alpine` + `npm ci` + `npm run build`
  a un solo `COPY . /usr/share/nginx/html`. Immagine più piccola, build istantanea,
  nessun Node in fase di produzione della release.
- **Supply chain azzerata.** Oggi `package-lock.json` è 231 KB e `npm ci` installa l'intero
  albero transitivo di Vite; qui restano due file scaricati una volta e verificabili a mano.
  Per un'applicazione che tocca IBAN e cedolini è un argomento serio, non estetico.
- **Longevità.** Fra dieci anni si apre `index.html` e funziona. Nessuna toolchain da
  resuscitare, nessun `vite@8` da aggiornare, nessun lockfile che non si installa più.
- **Debug diretto.** Il file nel browser è il file sul disco: nessuna source map, nessun
  bundle da srotolare.

---

## 4. Cosa si perde — la parte che conta

Qui va usata onestà, perché una di queste voci è pesante.

**Il type checker, che oggi è l'unico controllo automatico esistente.** Misurato:
`npx tsc --noEmit --strict` → **0 errori**. Non ci sono test. Quindi `tsc` *è*, di fatto, la
suite di test del progetto — ed è quella che si butta via. Su un'app che genera flussi di
pagamento non è un dettaglio.

Mitigazione praticabile: `// @ts-check` in testa ai file + tipi in JSDoc. TypeScript controlla
JS annotato in JSDoc quasi come TS, e il codice resta JS eseguibile senza build. Ma per *far
girare* il controllo serve `tsc`, cioè npm — quindi diventa un controllo opzionale (in CI, o
sulla macchina di chi sviluppa), non una garanzia del progetto. Va accettato consapevolmente.

Le altre voci sono gestibili:

| Cosa si perde | Rimedio |
|---|---|
| hashing degli asset (cache busting) | rinominare a mano, o `?v=0.1.2` negli import; **`nginx.conf:9-14` va cambiato**: oggi cachea `/assets/` come `immutable` per 1 anno, cosa che senza hash diventa una trappola |
| minificazione e tree-shaking del codice proprio | trascurabile: il codice dell'app è ~40 KB su 2,2 MB di vendor già minificato |
| `vite-plugin-pwa` (manifest + service worker) | manifest scritto a mano (i valori sono in `vite.config.ts:9-32`) e service worker cache-first di ~50 righe — **lo stesso lavoro già previsto dal piano Rust §3.3** |
| dev server con HMR | qualsiasi file server statico (`python3 -m http.server`); si perde l'hot reload, resta il reload |
| `import ... from 'pdfjs-dist'` per nome | percorsi relativi, oppure un `importmap` in `index.html` per mantenere i nomi |

Un'ultima nota di igiene del repository: committare 2,2 MB di JS minificato in un progetto
AGPL è un po' sgraziato (il minificato non è «sorgente»). Le librerie restano opere separate
sotto le loro licenze — che `fetch-vendor.sh` copia — ma l'alternativa più pulita è non
committare `vendor/` e rigenerarlo in CI con lo script.

---

## 5. Piano

Ordine di grandezza: **3-5 giorni**, il più basso di tutti gli scenari valutati, e senza
alcun rischio sull'algoritmo di estrazione (non si tocca: resta pdf.js).

1. **Fase 0 — rete di sicurezza (2-3 g).** Come negli altri due piani. Qui è *ancora più*
   importante, perché si sta per rinunciare al type checker: i test diventano l'unica rete.
   Farla **prima**, con Vitest e npm, finché ci sono.
2. **Emissione (0,5 g).** `tsc` emette il JS una volta (§2.3), si formatta l'output, si
   cancellano `core/types.ts` e il codice morto già individuato (`counter.ts`,
   `paymentRows.ts`).
3. **Vendoring (0,5 g).** `fetch-vendor.sh`, import relativi o `importmap`.
4. **jszip → `zip.js` (0,5 g).** Già scritto e validato in questo spike.
5. **PWA e deploy (1 g).** Manifest e service worker a mano; Dockerfile ridotto a un `COPY`;
   `nginx.conf` rivisto sul caching.
6. **`// @ts-check` + JSDoc (opzionale, 1-2 g).** Recupera parte del controllo perduto.

---

## 6. Verdetto

Le tre strade rispondono a obiettivi diversi, e conviene scegliere per obiettivo:

| Obiettivo | Strada |
|---|---|
| Meno dipendenze, meno toolchain, massima longevità e semplicità di deploy | **questa** — 3-5 g, nessun rischio sull'estrazione |
| Rendere impossibili per costruzione le classi di bug su union e confini dati | **ReScript** — 9-13 g, incrementale |
| Performance o peso del bundle | **nessuna**: i numeri non giustificano Rust/WASM (§9 di quel piano) |
| Ridurre il rischio adesso, al minimo costo | **Fase 0 + `"strict": true`** in TypeScript, 2-3 g |

Nota che questa strada e ReScript sono **incompatibili in spirito**: la prima rinuncia al
compilatore, la seconda ne aggiunge uno più severo. Vanno decise in alternativa, non in
sequenza.

E in tutti e quattro i casi la prima riga del piano è la stessa: **Fase 0**. Che è anche il
motivo per cui la consiglierei comunque, prima di scegliere.
