# ReScript spike — throwaway verification code

Companion to [`../NON_WASM_ALTERNATIVE.md`](../NON_WASM_ALTERNATIVE.md), held to the same
standard as [`../rust-port-spike/`](../rust-port-spike/): every claim in that document is
reproducible here. Not the port, not maintained — delete once a decision is made.

## Run

```bash
npm install
python3 ../rust-port-spike/mkpdf.py sample.pdf   # same synthetic PDF as the Rust spike
npm test
```

`npm test` builds and runs both suites: `Test.res` (37 checks, no browser needed) and
`InteropTest.res` (drives the real `pdf-lib` and `jszip` from ReScript).

## What it proves

| File | Claim verified |
|---|---|
| `CodiceFiscale.res` | the regex from `codiceFiscale.ts` is reused **as the same string** — ReScript's `RegExp` is the platform `RegExp`, so there is no pattern dialect to translate and no `\b` semantics to fix. All 13 fixtures from `sampleExpectations.ts` pass |
| `Domain.res` | `iban.ts` + `number.ts` ported; `toFixed`/`toLocaleString` are the platform functions, so the rounding and locale divergences documented in the Rust plan (§7.1, §7.3) cannot occur |
| `Domain.res` — `valueForColumn` | the `default: return { value: '', numeric: false }` silent fallback in `exportTemplates.ts:199` becomes a compile error: delete any branch and the build fails |
| `Domain.res` — `decodeSettings` | replaces `JSON.parse(raw) as PaymentSettings` (`main.ts:1076`) with real decoding — there is no `as` escape hatch in the language |
| `PdfLibs.res` | typed bindings to `pdfjs-dist`, `pdf-lib` and `jszip`: the libraries are kept, not replaced |
| `InteropTest.res` | **runtime** proof — loads the PDF with `pdf-lib`, splits every page, zips with `jszip`, and reopens each entry asserting it is a valid 1-page PDF |
| `consumer.ts` + `Domain.gen.ts` | a still-TypeScript module consumes a converted ReScript module and typechecks under `--strict`; `option<float>` crosses the boundary as `number \| undefined` |

## The migration property this demonstrates

`genType` emits real `.d.ts` for annotated functions:

```ts
export const parseItalianDecimal: (value: string) => (undefined | number)
```

so `src/core/` can move to ReScript **one file at a time** while `main.ts` stays TypeScript,
with the compiler checking the seam in both directions. One ambient shim is needed
(`src/rescript-shims.d.ts`).
