#!/bin/sh
# Vendor the two libraries with curl and tar. No npm, no Node.
#
# Run once; commit the result (or keep it out of git and run this in CI).
# Both ship native ES modules, so no bundler is involved at any point.
set -eu

PDFJS_VERSION=6.1.200
PDFLIB_VERSION=1.17.1

cd "$(dirname "$0")"
mkdir -p vendor
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "pdfjs-dist $PDFJS_VERSION (Apache-2.0)"
curl -sSL "https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-$PDFJS_VERSION.tgz" \
  | tar xz -C "$tmp"
cp "$tmp/package/build/pdf.min.mjs" "$tmp/package/build/pdf.worker.min.mjs" vendor/
cp "$tmp/package/LICENSE" vendor/LICENSE.pdfjs-dist
# Needed only for PDFs with CID/CJK fonts (1.7 MB) or non-embedded standard
# fonts (804 KB). Uncomment if real payslips need them — check against your
# own files, since text extraction usually does not.
# cp -r "$tmp/package/cmaps" "$tmp/package/standard_fonts" vendor/

echo "pdf-lib $PDFLIB_VERSION (MIT)"
rm -rf "$tmp/package"
curl -sSL "https://registry.npmjs.org/pdf-lib/-/pdf-lib-$PDFLIB_VERSION.tgz" \
  | tar xz -C "$tmp"
cp "$tmp/package/dist/pdf-lib.esm.min.js" vendor/
cp "$tmp/package/LICENSE.md" vendor/LICENSE.pdf-lib

echo
echo "jszip: not vendored — replaced by zip.js using CompressionStream('deflate-raw')"
echo
ls -l vendor
