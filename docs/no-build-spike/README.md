# No-build spike — throwaway verification code

Companion to [`../NO_BUILD_STEP.md`](../NO_BUILD_STEP.md). Verified by loading it in Chromium,
not by reasoning about it. Not the port, not maintained.

## Run

```sh
./fetch-vendor.sh                                   # curl + tar, no npm
python3 ../rust-port-spike/mkpdf.py sample.pdf      # same synthetic PDF as the other spikes
python3 -m http.server 8137
```

Open <http://127.0.0.1:8137/> — the page runs the pipeline and prints the result.
`window.slipcutResults` holds the outcome (and the ZIP as base64) for automation.

## What it proves

| File | Claim verified |
|---|---|
| `app.js` | `pdfjs-dist` and `pdf-lib` import as **native ES modules by relative path** — no bundler, no `node_modules`, no transpiler. Text extraction returns the same geometry as the real app (`dx = 31.11` between the `NETTO` label and its amount) |
| `zip.js` | jszip is replaceable in ~90 lines using `CompressionStream('deflate-raw')`. The archive the browser produced passes `unzip -t` ("No errors detected") and Python's `zipfile.testzip()`; entries carry correct CRCs, the UTF-8 flag, and fall back to *store* when deflate would grow the entry |
| `fetch-vendor.sh` | vendoring needs only `curl` and `tar`, and copies both upstream licenses |
| `index.html` | one `<script type="module">`, nothing else |

`app.js` reuses `toPositionedTextItems` and `reconstructLines` from `src/workers/pdfWorker.ts`
verbatim (minus type annotations) to show the extraction logic is unaffected by dropping the
build step.

## Not included

The UI. This spike verifies the plumbing — the part where dropping npm could have failed. The
`main.ts` conversion is mechanical (`tsc` emits it; see `../NO_BUILD_STEP.md` §2.3), so there
was nothing to discover by redoing it here.
