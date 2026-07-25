// Entry point so the wasm linker produces a measurable artifact.
fn main() { unsafe { run(std::ptr::null(), 0) }; }

#[unsafe(no_mangle)]
pub unsafe extern "C" fn run(ptr: *const u8, len: usize) -> usize {
    if ptr.is_null() { return 0; }
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
    let zip = slipcut_port_spike::probe_pipeline(bytes).map(|z| z.len()).unwrap_or(0);
    let cf = slipcut_port_spike::extract_codici_fiscali("COD. FISC. FRMFRC91P22D086S").len();
    let m = slipcut_port_spike::parse_italian_decimal("1.234,56").unwrap_or(0.0) as usize;
    let x = slipcut_port_spike::probe_pain001("urn:x", 1.0, "IT60").map(|s| s.len()).unwrap_or(0);
    let j = slipcut_port_spike::probe_json("{}").map(|s| s.len()).unwrap_or(0);
    let c = slipcut_port_spike::probe_csv("a,b").len();
    let (_, s, t) = slipcut_port_spike::probe_misc("https://x.com");
    zip + cf + m + x + j + c + s.len() + t.len()
}
