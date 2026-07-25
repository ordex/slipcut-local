// The whole point of a JS-targeting language: pdfjs-dist, pdf-lib and jszip are
// kept AS THEY ARE. These are typed bindings, not reimplementations — there is
// no PDF engine to replace and no geometry algorithm to re-derive.

// ---------- pdf-lib ----------

module PdfDocument = {
  type t
  type page

  @module("pdf-lib") @scope("PDFDocument") @val
  external load: Uint8Array.t => promise<t> = "load"

  @module("pdf-lib") @scope("PDFDocument") @val
  external create: unit => promise<t> = "create"

  @send external getPageCount: t => int = "getPageCount"
  @send external copyPages: (t, t, array<int>) => promise<array<page>> = "copyPages"
  @send external addPage: (t, page) => unit = "addPage"
  @send external save: t => promise<Uint8Array.t> = "save"
}

// ---------- jszip ----------

module JsZip = {
  type t

  @module("jszip") @new external make: unit => t = "default"
  @send external file: (t, string, Uint8Array.t) => unit = "file"
  @send external fileText: (t, string, string) => unit = "file"

  type generateOptions = {@as("type") type_: string}
  @send external generateAsync: (t, generateOptions) => promise<Uint8Array.t> = "generateAsync"
}

// ---------- pdfjs-dist ----------

// The geometry contract that payslip.ts depends on, expressed as a type instead
// of the `TextItemLike` duck-typing + `Number(transform[4] ?? 0)` coercions in
// pdfWorker.ts:41-67. `str` and `transform` become required and typed.
module PdfJs = {
  type document
  type page
  type textContent

  type textItem = {
    str: string,
    transform: array<float>,
    width: float,
    height: float,
  }

  @module("pdfjs-dist") @val
  external getDocument: {..} => {"promise": promise<document>} = "getDocument"

  @send external getPage: (document, int) => promise<page> = "getPage"
  @send external getTextContent: page => promise<textContent> = "getTextContent"
  @get external items: textContent => array<textItem> = "items"
  @get external numPages: document => int = "numPages"
}

// A positioned item, same shape as PositionedTextItem in payslip.ts.
type positionedTextItem = {
  str: string,
  x: float,
  y: float,
  width: float,
  height: float,
}

let toPositioned = (item: PdfJs.textItem): option<positionedTextItem> => {
  let str = item.str->String.trim
  if String.length(str) == 0 {
    None
  } else {
    Some({
      str,
      x: item.transform->Array.get(4)->Option.getOr(0.0),
      y: item.transform->Array.get(5)->Option.getOr(0.0),
      width: item.width,
      height: item.height,
    })
  }
}

// reconstructLines from pdfWorker.ts:69-82, y-bucketed exactly as today.
let reconstructLines = (items: array<positionedTextItem>): string => {
  let buckets = Map.make()
  items->Array.forEach(item => {
    let bucket = Math.round(item.y /. 3.0) *. 3.0
    let line = buckets->Map.get(bucket)->Option.getOr([])
    line->Array.push(item)
    buckets->Map.set(bucket, line)
  })
  buckets
  ->Map.entries
  ->Array.fromIterator
  ->Array.toSorted(((a, _), (b, _)) => b -. a)
  ->Array.map(((_, line)) =>
    line
    ->Array.toSorted((a, b) => a.x -. b.x)
    ->Array.map(item => item.str)
    ->Array.join(" ")
  )
  ->Array.join("\n")
}
