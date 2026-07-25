#!/usr/bin/env python3
"""Build a minimal uncompressed 2-page PDF that mimics payslip layout/geometry."""
import sys

PAGES = [
    [  # (x, y, size, text)
        (60, 760, 10, "RED YARD RESEARCH SRL  CF: 01234567890"),
        (60, 730, 10, "COD. FISC. FRMFRC91P22D086S"),
        (60, 710, 10, "FORMICA FEDERICO"),
        (60, 690, 10, "GIUGNO 2026"),
        (60, 400, 9, "1 RETRIBUZIONE ORDINARIA"),
        (300, 400, 9, "3.000,00"),
        (60, 200, 9, "IMPONIBILE"),
        (300, 200, 9, "2.500,00"),
        (380, 100, 10, "NETTO"),
        (445, 100, 10, "2.056,00"),
    ],
    [
        (60, 760, 10, "RED YARD RESEARCH SRL  CF: 01234567890"),
        (60, 730, 10, "PERCIPIENTE PERIODO COMPENSO"),
        (60, 710, 10, "MAURO MARCO ANTONIO"),
        (60, 690, 10, "COD. FISC. MRAMCN90E04D086C"),
        (60, 670, 10, "GIUGNO 2026"),
        (60, 400, 9, "1352 COMPENSO LORDO"),
        (300, 400, 9, "2.400,00"),
        (330, 100, 10, "NETTO CORRISPOSTO"),
        (460, 100, 10, "1.851,00"),
    ],
]


def esc(s):
    return s.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def content(items):
    out = ["BT"]
    for x, y, size, text in items:
        out.append(f"/F1 {size} Tf 1 0 0 1 {x} {y} Tm ({esc(text)}) Tj")
    out.append("ET")
    return "\n".join(out).encode("latin-1")


objs = {}
n_pages = len(PAGES)
kids = " ".join(f"{4 + 2 * i} 0 R" for i in range(n_pages))
objs[1] = b"<< /Type /Catalog /Pages 2 0 R >>"
objs[2] = f"<< /Type /Pages /Kids [{kids}] /Count {n_pages} >>".encode()
objs[3] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
for i, items in enumerate(PAGES):
    page_id, stream_id = 4 + 2 * i, 5 + 2 * i
    objs[page_id] = (
        f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
        f"/Resources << /Font << /F1 3 0 R >> >> /Contents {stream_id} 0 R >>"
    ).encode()
    data = content(items)
    objs[stream_id] = b"<< /Length %d >>\nstream\n" % len(data) + data + b"\nendstream"

buf = bytearray(b"%PDF-1.4\n")
offsets = {}
for num in sorted(objs):
    offsets[num] = len(buf)
    buf += b"%d 0 obj\n" % num + objs[num] + b"\nendobj\n"

xref_at = len(buf)
maxnum = max(objs)
buf += b"xref\n0 %d\n" % (maxnum + 1)
buf += b"0000000000 65535 f \n"
for num in range(1, maxnum + 1):
    buf += b"%010d 00000 n \n" % offsets.get(num, 0)
buf += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (maxnum + 1, xref_at)

open(sys.argv[1], "wb").write(bytes(buf))
print(f"wrote {sys.argv[1]} ({len(buf)} bytes, {n_pages} pages)")
