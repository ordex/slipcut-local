// Port of src/core/extraction/codiceFiscale.ts.
// The regex is the SAME string as the TypeScript source: ReScript's RegExp is
// the platform RegExp, so there is no pattern-dialect translation at all.

let pattern =
  "(?:[A-Z][AEIOU][AEIOUX]|[AEIOU]X{2}|[B-DF-HJ-NP-TV-Z]{2}[A-Z]){2}(?:[0-9LMNP-V]{2}(?:[A-EHLMPR-T](?:[04LQ][1-9MNP-V]|[15MR][0-9LMNP-V]|[26NS][0-8LMNP-U])|[DHPS][37PT][0L]|[ACELMRT][37PT][01LM]|[AC-EHLMPR-T][26NS][9V])|(?:[02468LNQSU][048LQU]|[13579MPRTV][26NS])B[26NS][9V])(?:[A-MZ][1-9MNP-V][0-9LMNP-V]{2}|[A-M][0L](?:[1-9MNP-V][0-9LMNP-V]|[0L][1-9MNP-V]))[A-Z]"

let odd = Dict.fromArray([
  ("0", 1), ("1", 0), ("2", 5), ("3", 7), ("4", 9), ("5", 13), ("6", 15), ("7", 17), ("8", 19),
  ("9", 21), ("A", 1), ("B", 0), ("C", 5), ("D", 7), ("E", 9), ("F", 13), ("G", 15), ("H", 17),
  ("I", 19), ("J", 21), ("K", 2), ("L", 4), ("M", 18), ("N", 20), ("O", 11), ("P", 3), ("Q", 6),
  ("R", 8), ("S", 12), ("T", 14), ("U", 16), ("V", 10), ("W", 22), ("X", 25), ("Y", 24), ("Z", 23),
])

let evenValue = (c: string): option<int> => {
  let code = c->String.charCodeAt(0)->Option.getOr(0)
  if code >= 48 && code <= 57 {
    Some(code - 48)
  } else if code >= 65 && code <= 90 {
    Some(code - 65)
  } else {
    None
  }
}

let normalize = (input: string): string =>
  input->String.replaceRegExp(RegExp.fromString("[^A-Z0-9]", ~flags="gi"), "")->String.toUpperCase

let isValidChecksum = (input: string): bool => {
  let cf = normalize(input)
  if String.length(cf) != 16 {
    false
  } else {
    // `String.get` returns option<string>: an out-of-range index cannot silently
    // become `undefined` the way `cf[i]` does in TypeScript.
    let sum = ref(0)
    let ok = ref(true)
    for i in 0 to 14 {
      switch cf->String.get(i) {
      | None => ok := false
      | Some(ch) =>
        let value = mod(i + 1, 2) == 1 ? odd->Dict.get(ch) : evenValue(ch)
        switch value {
        | None => ok := false
        | Some(v) => sum := sum.contents + v
        }
      }
    }
    if !ok.contents {
      false
    } else {
      let expected = String.fromCharCode(65 + mod(sum.contents, 26))
      cf->String.get(15) == Some(expected)
    }
  }
}

let extractAll = (text: string): array<string> => {
  let normalizedText =
    text->String.replaceRegExp(RegExp.fromString("\\s+", ~flags="g"), " ")->String.toUpperCase
  let re = RegExp.fromString(pattern, ~flags="gi")
  let seen = Set.make()
  let out = []
  let continue = ref(true)
  while continue.contents {
    switch re->RegExp.exec(normalizedText) {
    | None => continue := false
    | Some(result) =>
      let cf = normalize(result->RegExp.Result.fullMatch)
      if isValidChecksum(cf) && !(seen->Set.has(cf)) {
        seen->Set.add(cf)
        out->Array.push(cf)
      }
    }
  }
  out
}

let extractPrimary = (text: string): option<string> => extractAll(text)->Array.get(0)
