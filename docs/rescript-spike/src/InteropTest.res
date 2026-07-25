// Runtime proof that the externals in PdfLibs.res are real calls into the
// existing npm libraries — the same pipeline the Rust spike had to rebuild from
// scratch, here running against pdf-lib and jszip unchanged.

@get external byteLength: Uint8Array.t => int = "length"
@module("node:fs") external readFileSync: string => Uint8Array.t = "readFileSync"
@val @scope("process") external exitWith: int => unit = "exit"

let splitOnePage = async (source, pageIndex) => {
  let out = await PdfLibs.PdfDocument.create()
  let copied = await out->PdfLibs.PdfDocument.copyPages(source, [pageIndex])
  switch copied->Array.get(0) {
  | Some(page) => out->PdfLibs.PdfDocument.addPage(page)
  | None => ()
  }
  await out->PdfLibs.PdfDocument.save
}

let run = async () => {
  let bytes = readFileSync("sample.pdf")
  let source = await PdfLibs.PdfDocument.load(bytes)
  let pageCount = source->PdfLibs.PdfDocument.getPageCount
  Console.log("pdf-lib page count: " ++ Int.toString(pageCount))

  let zip = PdfLibs.JsZip.make()
  let allSingle = ref(true)
  for pageIndex in 0 to pageCount - 1 {
    let saved = await splitOnePage(source, pageIndex)
    zip->PdfLibs.JsZip.file("page_" ++ Int.toString(pageIndex + 1) ++ ".pdf", saved)

    // Reopen and assert it is genuinely a single-page PDF, exactly as the Rust
    // spike's full_pipeline_splits_and_zips does.
    let reopened = await PdfLibs.PdfDocument.load(saved)
    if reopened->PdfLibs.PdfDocument.getPageCount != 1 {
      allSingle := false
    }
  }

  let archive = await zip->PdfLibs.JsZip.generateAsync({type_: "uint8array"})
  Console.log("zip bytes: " ++ Int.toString(archive->byteLength))
  Console.log(
    allSingle.contents ? "ok   every split file is a valid 1-page PDF" : "FAIL split file invalid",
  )

  if pageCount == 2 && archive->byteLength > 0 && allSingle.contents {
    Console.log("interop: pdf-lib + jszip driven from ReScript, all good")
  } else {
    Console.log("interop FAILED")
    exitWith(1)
  }
}

run()->Promise.done
