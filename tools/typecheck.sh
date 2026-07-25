#!/bin/sh
# Optional type check.
#
# The project ships plain JavaScript with types in JSDoc, so it runs with no
# toolchain at all. TypeScript can still read those annotations and check them,
# which is worth doing before a release even though nothing depends on it.
#
# This is the one place the project touches npm, it installs nothing into the
# repository, and no output of it is served.
#
#   ./tools/typecheck.sh
#
# vendor/ is excluded: minified upstream bundles are not ours to check, and
# checking them produces thousands of meaningless errors. @types/node is
# installed only because the Node test runner refers to `process`.
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

echo "installing typescript in $work"
cd "$work"
npm init -y >/dev/null 2>&1
npm install --silent --no-fund --no-audit typescript@5 @types/node@22 >/dev/null

cd "$repo_root"
"$work/node_modules/.bin/tsc" \
	--noEmit --allowJs --checkJs --strict \
	--target es2023 --module esnext --moduleResolution bundler \
	--lib es2023,dom,dom.iterable,webworker \
	--types node --typeRoots "$work/node_modules/@types" \
	--skipLibCheck \
	src/app.js src/worker.js test/all.js 2>&1 |
	grep -v '^vendor/' |
	grep -v '^  ' |
	{ grep . || true; } >"$work/errors"

if [ -s "$work/errors" ]; then
	cat "$work/errors"
	echo
	echo "$(wc -l <"$work/errors" | tr -d ' ') type errors"
	exit 1
fi

echo "no type errors"
