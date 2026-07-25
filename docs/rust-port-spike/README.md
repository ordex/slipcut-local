# Rust port spike — throwaway verification code

This is **not** the port and **not** meant to be maintained. It exists so the claims in
[`../RUST_PORT_PLAN.md`](../RUST_PORT_PLAN.md) can be reproduced instead of trusted.
Delete it once `crates/` exists.

What it proves:

| Test | Claim verified |
|---|---|
| `cargo check --target wasm32-unknown-unknown` | the whole candidate stack compiles to WASM, with zero C dependencies |
| `cf_regex_and_checksum_match_fixtures` | `CODICE_FISCALE_PATTERN` from `codiceFiscale.ts` compiles in the `regex` crate and matches all 13 fixtures in `sampleExpectations.ts` |
| `geometry_extraction_reproduces_pdfjs_coordinates` | `pdf-extract`'s `OutputDev` yields the same x/y/width/height (y-up) that `extractNetAmountFromNettoBox` needs |
| `full_pipeline_splits_and_zips` | load → per-page geometry → split → ZIP, with every split file reopened and asserted to be a valid 1-page PDF |
| `page_two_collaborator_layout` | the `collaborator` layout path works too |
| `money_roundtrip` | Italian decimal parse/format without ICU |
| `word_boundary_semantics_differ_from_js` | Rust `\b` is Unicode-aware while JS `\b` is ASCII — the trap described in plan §7.2 |
| `xml_writer_works` | `quick-xml` replaces `XMLSerializer` for PAIN.001 |

## Run

```bash
python3 mkpdf.py sample.pdf      # synthetic payslip-shaped PDF (not committed)
cargo test
cargo check --target wasm32-unknown-unknown
```

Measure the WASM payload (plan §9):

```bash
cargo build --release --target wasm32-unknown-unknown
ls -l target/wasm32-unknown-unknown/release/slipcut-port-spike.wasm
gzip -9c target/wasm32-unknown-unknown/release/slipcut-port-spike.wasm | wc -c
```

`src/main.rs` exists only to give the WASM linker an entry point so the artifact is
measurable; it is not a real program.
