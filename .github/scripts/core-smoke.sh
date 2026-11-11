#!/bin/sh
# Smoke test of an ekorn-core binary on the machine it runs on: it starts,
# packs a long log, fetches lines back, and checks a receipt against the log.
# usage: core-smoke.sh <path of ekorn-core>
set -eu

core=$1
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
export EKORN_STORE="$work/store"

fail() { echo "FAIL: $1" >&2; exit 1; }

echo "== starts"
"$core" --version

echo "== packs a 6000-line log"
error="../../src/net/session_pool.cc:118:27: error: use of undeclared identifier 'kMaxIdleSessions'"
awk -v error="$error" 'BEGIN {
  for (i = 1; i <= 6000; i++) print (i == 4217 ? error : "[" i "/6000] CXX obj/module_" i ".o")
  print "ninja: build stopped: subcommand failed."
}' > "$work/build.log"
"$core" pack --stdin --label build < "$work/build.log" > "$work/summary.txt"
head -3 "$work/summary.txt"
grep -q '^\[ekorn-pack\]' "$work/summary.txt" || fail "no pack summary"
id=$(sed -n 's/^id: //p' "$work/summary.txt")
test -n "$id" || fail "the summary names no id"
test $(wc -c < "$work/summary.txt") -lt 20000 || fail "the summary is not smaller than the log"

echo "== fetches lines back"
"$core" recall "$id" --grep kMaxIdleSessions > "$work/grep.txt"
cat "$work/grep.txt"
grep -qF "4217: $error" "$work/grep.txt" || fail "recall --grep did not return line 4217"
"$core" recall "$id" --lines 6001-6001 | grep -qF 'ninja: build stopped' || fail "recall --lines did not return the last line"

echo "== accepts a receipt whose quotes are in the log"
cat > "$work/good.json" <<JSON
{"status":"failure","uncertain":false,"evidence":[
  {"kind":"fatal","quote":"session_pool.cc:118:27: error: use of undeclared identifier 'kMaxIdleSessions'"},
  {"kind":"summary","quote":"ninja: build stopped: subcommand failed."}]}
JSON
"$core" verify --source "$work/build.log" --receipt "$work/good.json" > "$work/receipt.txt"
cat "$work/receipt.txt"
head -1 "$work/receipt.txt" | grep -q '^ekorn_evidence_receipt_v1' || fail "verify did not print a receipt"
grep -q 'kind=fatal line=4217 ' "$work/receipt.txt" || fail "the receipt does not place the error on line 4217"

echo "== rejects a receipt with a quote that is not in the log"
printf '%s' '{"status":"failure","uncertain":false,"evidence":[{"kind":"fatal","quote":"no such text in the log"}]}' > "$work/bad.json"
if "$core" verify --source "$work/build.log" --receipt "$work/bad.json" > "$work/rejected.txt" 2>&1; then
  fail "verify accepted a quote that is not in the log"
fi
grep -q '^REJECTED' "$work/rejected.txt" || fail "verify failed without saying REJECTED"

echo "OK"
