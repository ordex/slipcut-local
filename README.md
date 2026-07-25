# SlipCut Local

A payroll system hands you one PDF with every payslip for the month, one page per
person. SlipCut Local turns it into an archive with a file per employee, filed by
tax code and period, and prepares the payment files to hand to the bank.

Everything happens in the page. No upload, no cookies, no tracking, no account.

Plain ES modules: **no build step, no Node, no npm** to run it or to serve it.

## Run it

Any static file server will do.

```sh
./tools/fetch-vendor.sh     # once: downloads pdf.js and pdf-lib
python3 -m http.server 8000
```

Then open <http://127.0.0.1:8000/>. There is nothing to compile and nothing to
watch.

Two caveats: the page must be served over `http://` or `https://` rather than
opened as a `file://` URL, because ES modules and workers are subject to the same
origin policy; and offline support needs `https://` or `localhost`.

## What it does

1. **Read.** A PDF is dropped in, and each page is read for the employee's Codice
   Fiscale, their name, the pay period and the net amount payable.
2. **Check.** Every page is listed with what was found and how confident the
   result is. This step exists to be read before anybody is paid.
3. **Pay.** Tax codes are matched to IBANs from an address book you fill in once,
   and the result is exported as a bank CSV or as an ISO 20022 `pain.001` file.

Two details are worth knowing, because they are where the value is:

**The net amount is found geometrically.** A payslip prints gross, taxable,
withholdings, roundings and year-to-date totals — and the order text appears in a
PDF has nothing to do with where it sits on the page. So the app locates the
`NETTO` label and takes the amount that belongs to it: beside it on the same
baseline, or below it when the label is a heading over its figure. Never above,
because the line above a `NETTO DEL MESE` heading is the withholdings total.
When the geometry does not resolve, the app falls back to reading the text and
says so in the table and in the summary, since a fallback amount is the one most
likely to be wrong.

**The name is verified, not guessed.** Every stretch of text that could be a name
is a candidate, and a candidate is accepted only if the six-character name code
derived from it matches the tax code printed on the page. An employer name, a
street or a job title simply fails the check, so no list of
words-that-are-not-names is needed.

## Tests

```sh
node test/run.mjs                 # no packages required
```

…or open `test/index.html` in a browser, which is the runner the project actually
requires — Node is a convenience.

The suite builds its own payslip-shaped PDF (`test/fixture-pdf.js`): real payslips
carry personal data and cannot live in a repository.

An optional type check reads the JSDoc annotations:

```sh
./tools/typecheck.sh              # the one place npm is used; installs nothing here
```

## Payment CSV layouts

Every bank wants different columns, so the layouts are configuration rather than
code. Load order:

1. what this browser has saved, from the editor in the app;
2. `config/export-templates.json`, if this installation ships one;
3. `config/export-templates.default.json`.

A column takes its value from a `source`, or is a constant:

```json
{ "header": "Importo", "source": "amount", "format": "decimal-comma" }
{ "header": "Salary", "fixed": "TRUE" }
```

Sources: `beneficiaryName`, `recipientType`, `email`, `codiceFiscale`, `iban`,
`recipientBankCountry`, `currency`, `amount`, `period`, `remittanceInformation`,
`sourcePage`. Amount formats: `decimal-dot` (`1234.56`), `decimal-comma`
(`1234,56`), `italian` (`1.234,56`), `integer` (`1235`).

An unrecognised source is rejected when the configuration loads, rather than
rendered as an empty column: a CSV that imports cleanly and pays the wrong thing
is worse than one that fails.

## Payment XML

Three profiles: `pain.001.001.03`, `pain.001.001.09`, and a CBI-flavoured `.09`
for Italian portals that ask for a CUC or an ABI. Payments are marked as salary
(`CtgyPurp/Cd` = `SALA`) and each creditor carries their Codice Fiscale.

**Validate the generated file against your bank before using it in production.**
Portals apply rules beyond the published schema, and this project cannot know
them.

Amounts are held as integer cents from the moment they are read off the page, so
a control sum can never disagree with the transactions it covers by a rounding
error.

## What is stored, and where

Nothing leaves the browser, and nothing is stored unless you ask:

| Data | Stored when | Where |
| --- | --- | --- |
| IBAN address book | you press *Salva nel browser* | `localStorage`, as the same CSV you can export |
| Ordering party details | you press *Salva impostazioni* | `localStorage` |
| Custom CSV layouts | you press *Salva* in the editor | `localStorage` |

The PDF itself is never stored. Each of the three can be cleared from the
interface.

## Docker

```sh
docker build -t slipcut-local .
docker run --rm -p 8080:80 slipcut-local
```

The first build stage only downloads the vendored libraries — there is nothing to
compile, so no Node reaches the image. To override the CSV layouts for a whole
installation, mount a file:

```sh
docker run --rm -p 8080:80 \
  -v ./my-layouts.json:/usr/share/nginx/html/config/export-templates.json:ro \
  slipcut-local
```

## Layout

```
index.html, style.css, sw.js   the page itself
src/core/                      the rules: no DOM, no PDF, no browser
src/pdf/                       the only modules that know pdf.js and pdf-lib
src/ui/                        views and wiring
src/worker.js                  the document pipeline, off the UI thread
src/zip.js                     ZIP writing, on the platform's deflate
config/                        CSV layouts
tools/                         vendoring and the optional type check
test/                          the suite and its PDF fixture generator
vendor/                        downloaded, not committed
```

`src/core/` has no browser dependencies at all, which is why most of the suite
runs under Node in a few milliseconds.

## Dependencies

Two, vendored by `tools/fetch-vendor.sh` and pinned by version and SHA-256:

- [pdf.js](https://mozilla.github.io/pdf.js/) (Apache-2.0) — reading text and its
  position on the page;
- [pdf-lib](https://pdf-lib.js.org/) (MIT) — writing the split pages.

Everything else is the platform: `CompressionStream` for ZIP deflate, and no
library at all for CSV, XML, IBAN validation or the tax code arithmetic.

## Releasing

There is no bundler, so no filename carries a content hash and `CACHE_NAME` in
`sw.js` is the only thing distinguishing one deployment from the next. **Bump it
on every release**, or visitors keep the version they already have.

## Known limits

- 10 MB and 250 pages per document. Beyond that the run is truncated, and says so.
- Payslip layouts vary by payroll vendor. The rules assume the payable amount is
  labelled with the word `NETTO` and printed either beside that label or directly
  under it. They have been checked against a Zucchetti payslip and the fixtures in
  `test/`; check the extraction table against your own files before trusting a run.
- A password-protected PDF is reported rather than read.
- A scanned payslip has no text to extract, so nothing is found. There is no OCR.

## Licence

GNU Affero General Public License v3.0 or later. See `LICENSE.md`.
