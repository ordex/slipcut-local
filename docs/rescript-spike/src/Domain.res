// Port of iban.ts + number.ts, plus the two type-safety demonstrations that
// matter for this codebase: exhaustive variants and decoded (not asserted) JSON.

// ---------- IBAN (src/core/validation/iban.ts) ----------

let normaliseIban = (iban: string): string =>
  iban->String.replaceRegExp(RegExp.fromString("\\s+", ~flags="g"), "")->String.toUpperCase

@genType
let isValidIban = (input: string): bool => {
  let iban = normaliseIban(input)
  if !(RegExp.fromString("^[A-Z]{2}\\d{2}[A-Z0-9]{11,30}$")->RegExp.test(iban)) {
    false
  } else {
    let rearranged = iban->String.slice(~start=4) ++ iban->String.slice(~start=0, ~end=4)
    let remainder = ref(0)
    let letterRe = RegExp.fromString("[A-Z]")
    rearranged
    ->String.split("")
    ->Array.forEach(ch => {
      let expanded = letterRe->RegExp.test(ch)
        ? Int.toString(ch->String.charCodeAt(0)->Option.getOr(0) - 55)
        : ch
      expanded
      ->String.split("")
      ->Array.forEach(digit => {
        let d = digit->Int.fromString->Option.getOr(0)
        remainder := mod(remainder.contents * 10 + d, 97)
      })
    })
    remainder.contents == 1
  }
}

// ---------- Italian numbers (src/core/extraction/number.ts) ----------

// Identical semantics to the current app: these ARE the JS runtime functions,
// so `toFixed` rounding and `toLocaleString('it-IT')` output cannot drift.
@send
external toLocaleStringWithOptions: (float, string, {..}) => string = "toLocaleString"

@genType
let parseItalianDecimal = (value: string): option<float> => {
  let cleaned =
    value
    ->String.trim
    ->String.replaceRegExp(RegExp.fromString("\\s+", ~flags="g"), "")
    ->String.replaceRegExp(RegExp.fromString("[€]", ~flags="g"), "")
  let shape = RegExp.fromString("^-?\\d{1,3}(?:\\.\\d{3})*(?:,\\d+)?$|^-?\\d+(?:,\\d+)?$")
  if !(shape->RegExp.test(cleaned)) {
    None
  } else {
    cleaned
    ->String.replaceRegExp(RegExp.fromString("\\.", ~flags="g"), "")
    ->String.replace(",", ".")
    ->Float.fromString
    ->Option.filter(Float.isFinite)
  }
}

let formatEuro = (value: float): string =>
  value->toLocaleStringWithOptions("it-IT", {"style": "currency", "currency": "EUR"})

let formatItalianDecimal = (value: float, ~decimals: int=2): string =>
  value->toLocaleStringWithOptions(
    "it-IT",
    {"minimumFractionDigits": decimals, "maximumFractionDigits": decimals},
  )

// ---------- Exhaustiveness: the silent-fallback bug class, made impossible ----------

// In exportTemplates.ts:187-200 the switch over CsvTemplateSource ends with
//   default: return { value: '', numeric: false }
// so adding a new source silently emits an empty column. As a variant, the
// compiler refuses to build unless every case is handled. Remove any branch
// below and `rescript build` fails instead of shipping blank CSV cells.
type csvSource =
  | BeneficiaryName
  | RecipientType
  | Email
  | CodiceFiscale
  | Iban
  | RecipientBankCountry
  | Currency
  | Amount
  | Period
  | RemittanceInformation
  | SourcePage

type paymentRow = {
  codiceFiscale: string,
  beneficiaryName: string,
  iban: string,
  email: string,
  amount: float,
  period: string,
  remittanceInformation: string,
  sourcePage: int,
}

let valueForColumn = (payment: paymentRow, source: csvSource): string =>
  switch source {
  | BeneficiaryName => payment.beneficiaryName
  | RecipientType => "INDIVIDUAL"
  | Email => payment.email
  | CodiceFiscale => payment.codiceFiscale
  | Iban => payment.iban
  | RecipientBankCountry => payment.iban->String.slice(~start=0, ~end=2)->String.toUpperCase
  | Currency => "EUR"
  | Amount => payment.amount->Float.toFixed(~digits=2)
  | Period => payment.period
  | RemittanceInformation => payment.remittanceInformation
  | SourcePage => Int.toString(payment.sourcePage)
  }

// ---------- Boundary decoding: no `as` escape hatch ----------

// main.ts:1076 does `JSON.parse(raw) as PaymentSettings` — an unchecked claim.
// Here the shape must be proven from JSON.t before it can be used.
type paymentSettings = {debtorName: string, debtorIban: string, remittanceTemplate: string}

let decodeSettings = (raw: string): option<paymentSettings> =>
  switch JSON.parseOrThrow(raw) {
  | JSON.Object(fields) =>
    switch (
      fields->Dict.get("debtorName"),
      fields->Dict.get("debtorIban"),
      fields->Dict.get("remittanceTemplate"),
    ) {
    | (Some(JSON.String(name)), Some(JSON.String(iban)), Some(JSON.String(tpl))) =>
      Some({debtorName: name, debtorIban: iban, remittanceTemplate: tpl})
    | _ => None
    }
  | _ => None
  | exception _ => None
  }
