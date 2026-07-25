// Plain node test runner — no browser, no headless harness.
@val @scope("process") external exitWith: int => unit = "exit"

let failures = ref(0)

let check = (name: string, condition: bool) =>
  if condition {
    Console.log("ok   " ++ name)
  } else {
    failures := failures.contents + 1
    Console.log("FAIL " ++ name)
  }

let checkEq = (name: string, actual: string, expected: string) =>
  check(name ++ " (got " ++ actual ++ ", want " ++ expected ++ ")", actual == expected)

// The 13 real fixtures from src/core/extraction/sampleExpectations.ts
let fixtures = [
  "FRMFRC91P22D086S",
  "MRAMCN90E04D086C",
  "CNGVCN87D10C352W",
  "RNLDTL96B41F915U",
  "CNGRRT82H17D976X",
  "VCCLNZ00R24F839L",
  "PSQDNL94B18H769B",
  "CLCSRA94H67C978F",
  "SRGPQL94P07D086S",
  "MPRMCL93S28A512P",
  "CNDPLA95M03D086S",
  "PNAVCN92P20C352A",
  "RSSMRA80A01H501U",
]

fixtures->Array.forEach(cf => {
  check("checksum " ++ cf, CodiceFiscale.isValidChecksum(cf))
  let text = "COD. FISC. " ++ cf ++ " RETRIBUZIONE ORDINARIA"
  check("extract " ++ cf, CodiceFiscale.extractPrimary(text) == Some(cf))
})

check("checksum rejects tampered CF", !CodiceFiscale.isValidChecksum("FRMFRC91P22D086X"))
check("no CF in plain text", CodiceFiscale.extractPrimary("NESSUN CODICE QUI") == None)

// Two CFs on one page: employer + employee ordering must be preserved.
let twoCf = CodiceFiscale.extractAll("RSSMRA80A01H501U ... FRMFRC91P22D086S")
check("multiple CFs, order preserved", twoCf == ["RSSMRA80A01H501U", "FRMFRC91P22D086S"])

// IBAN
check("valid IBAN", Domain.isValidIban("IT60X0542811101000000123456"))
check("valid IBAN with spaces", Domain.isValidIban("IT60 X054 2811 1010 0000 0123 456"))
check("invalid IBAN checksum", !Domain.isValidIban("IT61X0542811101000000123456"))
check("garbage IBAN", !Domain.isValidIban("NOTANIBAN"))

// Italian decimals — same runtime as today, so results are identical by construction
check("parse 1.234,56", Domain.parseItalianDecimal("1.234,56") == Some(1234.56))
check("parse -2.056,00", Domain.parseItalianDecimal("-2.056,00") == Some(-2056.0))
check("parse 2056,00", Domain.parseItalianDecimal("2056,00") == Some(2056.0))
check("reject abc", Domain.parseItalianDecimal("abc") == None)
check("parse with euro sign", Domain.parseItalianDecimal("€ 1.234,56") == Some(1234.56))

// toFixed is the platform one: the 0.125 divergence that WASM/Rust introduces
// (JS 0.13 vs Rust 0.12) cannot happen here.
checkEq("toFixed(0.125) matches JS", (0.125)->Float.toFixed(~digits=2), "0.13")

// Exhaustive variant switch
let row: Domain.paymentRow = {
  codiceFiscale: "FRMFRC91P22D086S",
  beneficiaryName: "FORMICA FEDERICO",
  iban: "IT60X0542811101000000123456",
  email: "",
  amount: 2056.0,
  period: "202606",
  remittanceInformation: "Stipendio 202606",
  sourcePage: 1,
}
checkEq("column amount", Domain.valueForColumn(row, Amount), "2056.00")
checkEq("column bank country", Domain.valueForColumn(row, RecipientBankCountry), "IT")

// JSON decoded, not asserted
check(
  "settings decode",
  Domain.decodeSettings(
    `{"debtorName":"Red Yard","debtorIban":"IT60X","remittanceTemplate":"Stipendio {period}"}`,
  )->Option.isSome,
)
check("settings reject wrong shape", Domain.decodeSettings(`{"debtorName":42}`) == None)
check("settings reject malformed json", Domain.decodeSettings("{not json") == None)

// Geometry helper reuses the real pdf.js item shape
let items = [
  {PdfLibs.str: "NETTO", x: 380.0, y: 100.0, width: 33.89, height: 10.0},
  {PdfLibs.str: "2.056,00", x: 445.0, y: 100.0, width: 38.92, height: 10.0},
  {PdfLibs.str: "GIUGNO 2026", x: 60.0, y: 690.0, width: 65.58, height: 10.0},
]
checkEq(
  "reconstructLines orders top-down then left-right",
  PdfLibs.reconstructLines(items),
  "GIUGNO 2026\nNETTO 2.056,00",
)

Console.log("")
if failures.contents == 0 {
  Console.log("all checks passed")
} else {
  Console.log(Int.toString(failures.contents) ++ " FAILURES")
  exitWith(1)
}
