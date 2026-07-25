#!/usr/bin/env python3
"""
Reference oracle for payslip extraction — see ../NON_WASM_ALTERNATIVE.md §8.

This is NOT part of the app and never ships to the browser. It is an
independent second implementation used to validate what the app extracts,
because pdfplumber resolves the geometry question with primitives instead of
hand-rolled scoring: `extract_words()` gives x0/x1/top/bottom per word, and
`crop()` reads a rectangular region directly.

Use it in Fase 0 to build the golden corpus, and afterwards to check the app
against real payslips offline (real PDFs contain personal data — keep them out
of the repository).

    python3 -m venv .venv && .venv/bin/pip install pdfplumber pypdf
    .venv/bin/python oracle.py ../rust-port-spike/sample.pdf
"""

import json
import sys

import pdfplumber

# Same windows as extractNetAmountFromNettoBox in src/core/extraction/payslip.ts.
RIGHT_OF_LABEL_MIN = -4
RIGHT_OF_LABEL_MAX = 220
SAME_BOX_VERTICAL = 26


def net_amount_candidates(page):
    """Amounts sharing a visual box with a NETTO label, geometrically."""
    words = page.extract_words()
    labels = [w for w in words if "NETTO" in w["text"].upper()]
    out = []
    for label in labels:
        # pdfplumber crops a region in one call; the TS version scores every
        # (label, amount) pair by hand to approximate the same thing.
        box = (
            label["x0"],
            max(label["top"] - 4, 0),
            min(label["x1"] + RIGHT_OF_LABEL_MAX, page.width),
            min(label["bottom"] + 4, page.height),
        )
        text = page.crop(box).extract_text() or ""
        for amount in words:
            dx = amount["x0"] - label["x1"]
            dy = abs(amount["bottom"] - label["bottom"])
            if RIGHT_OF_LABEL_MIN <= dx <= RIGHT_OF_LABEL_MAX and dy <= SAME_BOX_VERTICAL:
                if amount["text"] != label["text"]:
                    out.append(
                        {
                            "label": label["text"],
                            "amount": amount["text"],
                            "dx": round(dx, 2),
                            "dy": round(dy, 2),
                            "box_text": text,
                        }
                    )
    return out


def main(path):
    report = []
    with pdfplumber.open(path) as pdf:
        for number, page in enumerate(pdf.pages, start=1):
            report.append(
                {
                    "page": number,
                    "words": len(page.extract_words()),
                    "chars": len(page.chars),
                    "net_candidates": net_amount_candidates(page),
                }
            )
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "sample.pdf")
