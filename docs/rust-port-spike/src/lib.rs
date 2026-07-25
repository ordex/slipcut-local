//! Probe: verify the candidate Rust dependency stack for the SlipCut Local port
//! compiles for wasm32-unknown-unknown and that the tricky logic ports work.

use pdf_extract::{output_doc, ColorSpace, MediaBox, OutputDev, OutputError, Path, Transform};
use regex::Regex;
use std::io::{Cursor, Write};

/// Mirror of pdf.js `getTextContent()` items: x/y in PDF user space (y up).
#[derive(Debug, Clone)]
pub struct PositionedTextItem {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Aggregates per-character callbacks into pdf.js-like text runs.
#[derive(Default)]
pub struct GeometryOutput {
    pub items: Vec<PositionedTextItem>,
    cur: Option<PositionedTextItem>,
    last_end: f64,
}

impl GeometryOutput {
    fn flush(&mut self) {
        if let Some(item) = self.cur.take() {
            if !item.text.trim().is_empty() {
                self.items.push(item);
            }
        }
    }
}

impl OutputDev for GeometryOutput {
    fn begin_page(
        &mut self,
        _page_num: u32,
        _media_box: &MediaBox,
        _art_box: Option<(f64, f64, f64, f64)>,
    ) -> Result<(), OutputError> {
        Ok(())
    }

    fn end_page(&mut self) -> Result<(), OutputError> {
        self.flush();
        Ok(())
    }

    fn output_character(
        &mut self,
        trm: &Transform,
        width: f64,
        _spacing: f64,
        font_size: f64,
        ch: &str,
    ) -> Result<(), OutputError> {
        // NOTE: raw trm (no flip) keeps y-up PDF space, matching pdf.js transform[4]/[5].
        let (x, y) = (trm.m31, trm.m32);
        let v = trm.transform_vector(euclid::vec2(font_size, font_size));
        let scale = (v.x * v.y).abs().sqrt();
        let advance = width * scale;

        let same_run = match &self.cur {
            Some(cur) => (cur.y - y).abs() < 0.1 && (x - self.last_end).abs() < scale * 0.3,
            None => false,
        };

        if same_run {
            let cur = self.cur.as_mut().unwrap();
            cur.text.push_str(ch);
            cur.width = x + advance - cur.x;
        } else {
            self.flush();
            self.cur = Some(PositionedTextItem {
                text: ch.to_string(),
                x,
                y,
                width: advance,
                height: scale,
            });
        }
        self.last_end = x + advance;
        Ok(())
    }

    fn begin_word(&mut self) -> Result<(), OutputError> {
        Ok(())
    }
    fn end_word(&mut self) -> Result<(), OutputError> {
        Ok(())
    }
    fn end_line(&mut self) -> Result<(), OutputError> {
        self.flush();
        Ok(())
    }
    fn stroke(
        &mut self,
        _c: &Transform,
        _cs: &ColorSpace,
        _col: &[f64],
        _p: &Path,
    ) -> Result<(), OutputError> {
        Ok(())
    }
}

/// Full pipeline shape: parse once, extract geometry per page, split pages, zip.
pub fn probe_pipeline(bytes: &[u8]) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let doc = lopdf::Document::load_mem(bytes)?;
    let page_count = doc.get_pages().len() as u32;

    let mut all_items = Vec::new();
    for page in 1..=page_count {
        let mut out = GeometryOutput::default();
        pdf_extract::output_doc_page(&doc, &mut out, page)?;
        all_items.push(out.items);
    }
    // also prove the whole-doc entry point links
    let mut whole = GeometryOutput::default();
    let _ = output_doc(&doc, &mut whole);

    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let opts: zip::write::FileOptions<'_, ()> =
        zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    for page in 1..=page_count {
        // Single-page PDF via lopdf: keep only this page, prune the rest.
        let mut single = doc.clone();
        let victims: Vec<u32> = single.get_pages().keys().copied().filter(|p| *p != page).collect();
        single.delete_pages(&victims);
        single.prune_objects();
        single.compress();
        let mut buf = Vec::new();
        single.save_to(&mut buf)?;

        zip.start_file(format!("page_{page}.pdf"), opts.clone())?;
        zip.write_all(&buf)?;
    }

    zip.start_file("items.json", opts)?;
    let total: usize = all_items.iter().map(|p| p.len()).sum();
    zip.write_all(total.to_string().as_bytes())?;
    Ok(zip.finish()?.into_inner())
}

// ---- Codice Fiscale: does the JS regex port compile in the `regex` crate? ----

pub const CF_PATTERN: &str = r"(?i)(?:[A-Z][AEIOU][AEIOUX]|[AEIOU]X{2}|[B-DF-HJ-NP-TV-Z]{2}[A-Z]){2}(?:[0-9LMNP-V]{2}(?:[A-EHLMPR-T](?:[04LQ][1-9MNP-V]|[15MR][0-9LMNP-V]|[26NS][0-8LMNP-U])|[DHPS][37PT][0L]|[ACELMRT][37PT][01LM]|[AC-EHLMPR-T][26NS][9V])|(?:[02468LNQSU][048LQU]|[13579MPRTV][26NS])B[26NS][9V])(?:[A-MZ][1-9MNP-V][0-9LMNP-V]{2}|[A-M][0L](?:[1-9MNP-V][0-9LMNP-V]|[0L][1-9MNP-V]))[A-Z]";

const ODD: [(char, u32); 36] = [
    ('0', 1), ('1', 0), ('2', 5), ('3', 7), ('4', 9), ('5', 13), ('6', 15), ('7', 17), ('8', 19),
    ('9', 21), ('A', 1), ('B', 0), ('C', 5), ('D', 7), ('E', 9), ('F', 13), ('G', 15), ('H', 17),
    ('I', 19), ('J', 21), ('K', 2), ('L', 4), ('M', 18), ('N', 20), ('O', 11), ('P', 3), ('Q', 6),
    ('R', 8), ('S', 12), ('T', 14), ('U', 16), ('V', 10), ('W', 22), ('X', 25), ('Y', 24), ('Z', 23),
];

fn even(c: char) -> Option<u32> {
    match c {
        '0'..='9' => Some(c as u32 - '0' as u32),
        'A'..='Z' => Some(c as u32 - 'A' as u32),
        _ => None,
    }
}

pub fn is_valid_cf_checksum(input: &str) -> bool {
    let cf: String = input
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_uppercase())
        .collect();
    if cf.len() != 16 {
        return false;
    }
    let mut sum = 0u32;
    for (i, c) in cf.chars().take(15).enumerate() {
        let v = if (i + 1) % 2 == 1 {
            ODD.iter().find(|(k, _)| *k == c).map(|(_, v)| *v)
        } else {
            even(c)
        };
        match v {
            Some(v) => sum += v,
            None => return false,
        }
    }
    let expected = (b'A' + (sum % 26) as u8) as char;
    cf.chars().nth(15) == Some(expected)
}

pub fn extract_codici_fiscali(text: &str) -> Vec<String> {
    let re = Regex::new(CF_PATTERN).expect("CF pattern must compile");
    let normalized = Regex::new(r"\s+").unwrap().replace_all(text, " ").to_uppercase();
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for m in re.find_iter(&normalized) {
        let cf = m.as_str().to_string();
        if is_valid_cf_checksum(&cf) && seen.insert(cf.clone()) {
            out.push(cf);
        }
    }
    out
}

// ---- Italian money parsing / formatting without ICU ----

pub fn parse_italian_decimal(value: &str) -> Option<f64> {
    let cleaned: String = value.chars().filter(|c| !c.is_whitespace() && *c != '€').collect();
    let re = Regex::new(r"^(?:-?\d{1,3}(?:\.\d{3})*(?:,\d+)?|-?\d+(?:,\d+)?)$").unwrap();
    if !re.is_match(&cleaned) {
        return None;
    }
    cleaned.replace('.', "").replace(',', ".").parse::<f64>().ok().filter(|v| v.is_finite())
}

pub fn format_italian_decimal(value: f64, decimals: usize) -> String {
    let s = format!("{:.*}", decimals, value.abs());
    let (int_part, frac) = s.split_once('.').unwrap_or((s.as_str(), ""));
    let mut grouped = String::new();
    for (i, c) in int_part.chars().enumerate() {
        if i > 0 && (int_part.len() - i) % 3 == 0 {
            grouped.push('.');
        }
        grouped.push(c);
    }
    let sign = if value < 0.0 { "-" } else { "" };
    if decimals == 0 {
        format!("{sign}{grouped}")
    } else {
        format!("{sign}{grouped},{frac}")
    }
}

// ---- XML generation via quick-xml instead of DOM XMLSerializer ----

pub fn probe_pain001(ns: &str, amount: f64, iban: &str) -> Result<String, quick_xml::Error> {
    use quick_xml::events::{BytesEnd, BytesStart, BytesText, Event};
    use quick_xml::Writer;

    let mut w = Writer::new_with_indent(Cursor::new(Vec::new()), b' ', 2);
    let mut root = BytesStart::new("Document");
    root.push_attribute(("xmlns", ns));
    w.write_event(Event::Start(root))?;
    w.write_event(Event::Start(BytesStart::new("Amt")))?;
    let mut instd = BytesStart::new("InstdAmt");
    instd.push_attribute(("Ccy", "EUR"));
    w.write_event(Event::Start(instd))?;
    w.write_event(Event::Text(BytesText::new(&format!("{amount:.2}"))))?;
    w.write_event(Event::End(BytesEnd::new("InstdAmt")))?;
    w.write_event(Event::End(BytesEnd::new("Amt")))?;
    w.write_event(Event::Start(BytesStart::new("IBAN")))?;
    w.write_event(Event::Text(BytesText::new(iban)))?;
    w.write_event(Event::End(BytesEnd::new("IBAN")))?;
    w.write_event(Event::End(BytesEnd::new("Document")))?;
    Ok(String::from_utf8(w.into_inner().into_inner()).unwrap())
}

// ---- misc dependency link checks ----

pub fn probe_misc(candidate_url: &str) -> (bool, String, String) {
    let url_ok = url::Url::parse(candidate_url).map(|u| u.scheme() == "https").unwrap_or(false);
    let nfd = {
        use unicode_normalization::UnicodeNormalization;
        "Nicolò Àngelo"
            .nfd()
            .filter(|c| !unicode_normalization::char::is_combining_mark(*c))
            .collect::<String>()
    };
    let now = chrono::Utc::now().format("%Y%m%d%H%M%S").to_string();
    (url_ok, nfd, now)
}

pub fn probe_json(s: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(s).ok()?;
    Some(v["templates"][0]["id"].as_str()?.to_string())
}

pub fn probe_csv(line: &str) -> Vec<String> {
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .from_reader(line.as_bytes());
    rdr.records()
        .filter_map(|r| r.ok())
        .flat_map(|r| r.iter().map(|f| f.to_string()).collect::<Vec<_>>())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cf_regex_and_checksum_match_fixtures() {
        // From src/core/extraction/sampleExpectations.ts
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
        ];
        for cf in fixtures {
            assert!(is_valid_cf_checksum(cf), "checksum failed for {cf}");
            let text = format!("COD. FISC. {cf} RETRIBUZIONE");
            assert_eq!(
                extract_codici_fiscali(&text),
                vec![cf.to_string()],
                "regex failed for {cf}"
            );
        }
    }

    #[test]
    fn money_roundtrip() {
        assert_eq!(parse_italian_decimal("1.234,56"), Some(1234.56));
        assert_eq!(parse_italian_decimal("-2.056,00"), Some(-2056.0));
        assert_eq!(parse_italian_decimal("2056,00"), Some(2056.0));
        assert_eq!(parse_italian_decimal("abc"), None);
        assert_eq!(format_italian_decimal(1234.56, 2), "1.234,56");
        assert_eq!(format_italian_decimal(1234567.5, 2), "1.234.567,50");
        assert_eq!(format_italian_decimal(-1234.56, 2), "-1.234,56");
        assert_eq!(format_italian_decimal(999.0, 2), "999,00");
    }

    #[test]
    fn word_boundary_semantics_differ_from_js() {
        // JS \b is ASCII-only; Rust regex \b is Unicode-aware by default.
        let unicode_b = Regex::new(r"\bNETTO\b").unwrap();
        let ascii_b = Regex::new(r"(?-u:\b)NETTO(?-u:\b)").unwrap();
        let hay = "PERÒNETTO";
        assert!(!unicode_b.is_match(hay), "unicode \\b treats Ò as a word char");
        assert!(ascii_b.is_match(hay), "ascii \\b matches like JS");
    }

    #[test]
    fn xml_writer_works() {
        let xml = probe_pain001(
            "urn:iso:std:iso:20022:tech:xsd:pain.001.001.03",
            2056.0,
            "IT60X0542811101000000123456",
        )
        .unwrap();
        assert!(xml.contains(r#"<InstdAmt Ccy="EUR">2056.00</InstdAmt>"#), "{xml}");
    }

    #[test]
    fn misc_deps_link() {
        let (url_ok, nfd, now) = probe_misc("https://example.com");
        assert!(url_ok);
        assert_eq!(nfd, "Nicolo Angelo");
        assert_eq!(now.len(), 14);
        assert_eq!(
            probe_json(r#"{"schemaVersion":1,"templates":[{"id":"generic"}]}"#).as_deref(),
            Some("generic")
        );
        assert_eq!(probe_csv("a,\"b,c\",d"), vec!["a", "b,c", "d"]);
    }
}
