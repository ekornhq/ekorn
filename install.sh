#!/bin/sh
# ekorn installer: download the ekorn-core binary for this machine from
# GitHub Releases, verify its SHA-256, and put it in $EKORN_HOME/bin.
#
#   curl -fsSL https://raw.githubusercontent.com/ekornhq/ekorn/main/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/ekornhq/ekorn/main/install.sh | sh -s -- --setup
#
# Options:
#   --setup          also run `ekorn-core setup claude` (Route B in the README;
#                    do not combine with the Claude Code plugin)
#   --version vX.Y.Z install that release instead of the latest
#   -h, --help       show this text
#
# Environment: EKORN_HOME (default ~/.ekorn), EKORN_VERSION (same as --version).
set -eu

REPO="ekornhq/ekorn"
home="${EKORN_HOME:-$HOME/.ekorn}"
version="${EKORN_VERSION:-latest}"
setup=0

die() { echo "ekorn install: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
    case "$1" in
        --setup) setup=1 ;;
        --version) [ $# -ge 2 ] || die "--version needs a value, e.g. v0.1.0"; version="$2"; shift ;;
        --version=*) version="${1#--version=}" ;;
        -h|--help) sed -n '2,14p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) die "unknown option: $1" ;;
    esac
    shift
done

case "$(uname -s)" in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    *) die "unsupported OS $(uname -s). On Windows, download ekorn-core_windows_amd64.exe from https://github.com/$REPO/releases and save it as %USERPROFILE%\\.ekorn\\bin\\ekorn-core.exe" ;;
esac
case "$(uname -m)" in
    x86_64|amd64) arch=amd64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) die "unsupported architecture $(uname -m)" ;;
esac

if command -v sha256sum >/dev/null 2>&1; then
    sha256() { sha256sum "$1" | awk '{print $1}'; }
elif command -v shasum >/dev/null 2>&1; then
    sha256() { shasum -a 256 "$1" | awk '{print $1}'; }
else
    die "need sha256sum or shasum to verify the download"
fi
command -v curl >/dev/null 2>&1 || die "need curl"

asset="ekorn-core_${os}_${arch}"
if [ "$version" = latest ]; then
    base="https://github.com/$REPO/releases/latest/download"
else
    base="https://github.com/$REPO/releases/download/$version"
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM

echo "Downloading $asset ($version) ..."
curl -fsSL -o "$tmp/$asset" "$base/$asset" || die "download failed: $base/$asset"
curl -fsSL -o "$tmp/sha256sums.txt" "$base/sha256sums.txt" || die "download failed: $base/sha256sums.txt"

want=$(awk -v f="$asset" '{n=$2; sub(/^\*/, "", n); if (n == f) print $1}' "$tmp/sha256sums.txt")
[ -n "$want" ] || die "$asset is not listed in sha256sums.txt"
got=$(sha256 "$tmp/$asset")
[ "$want" = "$got" ] || die "SHA-256 mismatch for $asset (expected $want, got $got); nothing was installed"
echo "SHA-256 OK"

mkdir -p "$home/bin"
chmod +x "$tmp/$asset"
mv -f "$tmp/$asset" "$home/bin/ekorn-core"
echo "Installed $("$home/bin/ekorn-core" --version) -> $home/bin/ekorn-core"

if [ "$setup" = 1 ]; then
    "$home/bin/ekorn-core" setup claude
else
    cat <<EOF

Next, wire it into your agent. Pick ONE route:
  Claude Code plugin:  /plugin marketplace add $REPO   then   /plugin install ekorn@ekorn
  Claude Code manual:  $home/bin/ekorn-core setup claude
  Codex CLI:           codex plugin marketplace add $REPO
Details: https://github.com/$REPO#install
EOF
fi
