#!/bin/sh
# Fetch the two vendored libraries. Needs only curl, tar and sha256sum.
#
# There is no package manager in this project: the libraries are pinned by
# version *and* by checksum here, downloaded once, and served as they are. Both
# publish native ES modules, so nothing is bundled or transpiled.
#
#   ./tools/fetch-vendor.sh
#
# Run it after cloning, and again when a version below changes. vendor/ is not
# committed.
set -eu

PDFJS_VERSION=6.1.200
PDFJS_SHA256=2e46aa56491f6576ec95b9f87bcf5ae52e97e3f09652ed2181f12405c3f0d30a

PDFLIB_VERSION=1.17.1
PDFLIB_SHA256=a7cc1eaf12e41e612a7be581162a63b18118aefc01e90f6a1f35347b1f324a1c

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
vendor="$repo_root/vendor"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# fetch <url> <expected sha256> <destination>
fetch() {
	url=$1
	expected=$2
	destination=$3

	curl -fsSL -o "$destination" "$url"
	actual=$(sha256sum "$destination" | cut -d' ' -f1)
	if [ "$actual" != "$expected" ]; then
		echo "checksum mismatch for $url" >&2
		echo "  expected $expected" >&2
		echo "  actual   $actual" >&2
		exit 1
	fi
}

mkdir -p "$vendor"

echo "pdfjs-dist $PDFJS_VERSION (Apache-2.0)"
fetch "https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-$PDFJS_VERSION.tgz" \
	"$PDFJS_SHA256" "$work/pdfjs.tgz"
tar xzf "$work/pdfjs.tgz" -C "$work"
cp "$work/package/build/pdf.min.mjs" "$vendor/pdf.js"
cp "$work/package/build/pdf.worker.min.mjs" "$vendor/pdf.worker.js"
cp "$work/package/LICENSE" "$vendor/LICENSE.pdfjs-dist"
rm -rf "$work/package"

# cmaps/ and standard_fonts/ are only needed for PDFs using CID fonts or
# non-embedded standard fonts. They add 2.5 MB, so they stay out until a real
# payslip turns out to need them; text extraction usually does not.

echo "pdf-lib $PDFLIB_VERSION (MIT)"
fetch "https://registry.npmjs.org/pdf-lib/-/pdf-lib-$PDFLIB_VERSION.tgz" \
	"$PDFLIB_SHA256" "$work/pdf-lib.tgz"
tar xzf "$work/pdf-lib.tgz" -C "$work"
cp "$work/package/dist/pdf-lib.esm.min.js" "$vendor/pdf-lib.js"
cp "$work/package/LICENSE.md" "$vendor/LICENSE.pdf-lib"

cat >"$vendor/README.md" <<'NOTE'
# vendor/

Downloaded by `tools/fetch-vendor.sh`, not committed and not edited.

| File | Upstream | Licence |
| --- | --- | --- |
| `pdf.js`, `pdf.worker.js` | pdfjs-dist | Apache-2.0, `LICENSE.pdfjs-dist` |
| `pdf-lib.js` | pdf-lib | MIT, `LICENSE.pdf-lib` |

Both are the upstream ES module builds, renamed to `.js` and otherwise
untouched: `.mjs` is missing from the default MIME map of more than one static
host, and a module served as the wrong type is refused by the browser.
NOTE

echo
echo "vendor/ ready:"
ls -1 "$vendor"
