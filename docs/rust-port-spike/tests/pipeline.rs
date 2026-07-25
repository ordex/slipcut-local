use slipcut_port_spike::*;

fn sample() -> Vec<u8> {
    std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/sample.pdf")).expect("sample.pdf")
}

#[test]
fn geometry_extraction_reproduces_pdfjs_coordinates() {
    let doc = lopdf::Document::load_mem(&sample()).unwrap();
    assert_eq!(doc.get_pages().len(), 2);

    let mut out = GeometryOutput::default();
    pdf_extract::output_doc_page(&doc, &mut out, 1).unwrap();

    for it in &out.items {
        println!("x={:7.2} y={:7.2} w={:6.2} h={:5.2} {:?}", it.x, it.y, it.width, it.height, it.text);
    }

    let joined: Vec<&str> = out.items.iter().map(|i| i.text.as_str()).collect();
    assert!(joined.iter().any(|t| t.contains("FRMFRC91P22D086S")), "CF text item missing: {joined:?}");

    // The NETTO label and its amount must land on the same baseline (y-up space),
    // with the amount to the right — exactly what extractNetAmountFromNettoBox needs.
    let netto = out.items.iter().find(|i| i.text.trim() == "NETTO").expect("NETTO label");
    let amount = out.items.iter().find(|i| i.text.trim() == "2.056,00").expect("net amount");
    assert!((netto.y - amount.y).abs() < 1.0, "baseline mismatch: {} vs {}", netto.y, amount.y);
    let dx = amount.x - (netto.x + netto.width);
    assert!(dx >= -4.0 && dx <= 220.0, "dx out of the isRightOfLabel window: {dx}");
    assert!(netto.y < 200.0, "NETTO should be near the page bottom in y-up space: {}", netto.y);

    // Decoys sit far above the label, so the geometric scoring can reject them.
    let gross = out.items.iter().find(|i| i.text.trim() == "3.000,00").expect("gross");
    assert!(gross.y > netto.y + 100.0);
}

#[test]
fn full_pipeline_splits_and_zips() {
    let zip_bytes = probe_pipeline(&sample()).expect("pipeline");
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(&zip_bytes)).unwrap();
    let names: Vec<String> = archive.file_names().map(|s| s.to_string()).collect();
    println!("zip entries: {names:?} ({} bytes)", zip_bytes.len());
    assert!(names.contains(&"page_1.pdf".to_string()));
    assert!(names.contains(&"page_2.pdf".to_string()));

    // Each split file must be a valid single-page PDF.
    for name in ["page_1.pdf", "page_2.pdf"] {
        use std::io::Read;
        let mut f = archive.by_name(name).unwrap();
        let mut buf = Vec::new();
        f.read_to_end(&mut buf).unwrap();
        let split = lopdf::Document::load_mem(&buf).unwrap();
        assert_eq!(split.get_pages().len(), 1, "{name} should have exactly 1 page");
    }
}

#[test]
fn page_two_collaborator_layout() {
    let doc = lopdf::Document::load_mem(&sample()).unwrap();
    let mut out = GeometryOutput::default();
    pdf_extract::output_doc_page(&doc, &mut out, 2).unwrap();
    let text: String = out.items.iter().map(|i| i.text.as_str()).collect::<Vec<_>>().join(" ");
    println!("page2: {text}");
    assert!(text.contains("PERCIPIENTE PERIODO COMPENSO"), "{text}");
    assert_eq!(extract_codici_fiscali(&text), vec!["MRAMCN90E04D086C".to_string()]);
}
