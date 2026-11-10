#!/bin/bash
# Passionaris check harness: builds and runs the game in isolation so checks never touch the player's own
# %APPDATA%/Passionaris (settings and saves go to <A>/userdata). Several sessions can run it at once: each one
# passes its OWN folder A (any empty folder outside the repo, e.g. a temp/scratchpad dir).
#   scripts/harness.sh build <A>                                  build the pages into <A>/dist
#   scripts/harness.sh cap   <A> <name> "<query>" [W H] [eval.js] one frame of game.html?shot=1&<query> → <A>/<name>.png + .jpg
#   scripts/harness.sh capl  <A> <name> [W H] [eval.js]           the launcher page → <A>/<name>.png + .jpg
#   scripts/harness.sh acap  <A> <name> "<query>" [W H] [eval.js] one frame of the graphics album, album.html?shot=1&<query>
#   scripts/harness.sh smoke <A> [eval.js]                        launcher → Play → map, fps probes, optional script in the game
#   scripts/harness.sh test  [pattern]                            node --test on tests/*<pattern>*.test.mjs, one file at a time
# Useful query keys: lat lon alt tilt date=YYYY-MM-DD mode=<id> ui=0 clean=1 fxdemo=<s> fxkind= fxlevel= fxvei= fxair=1
#   ashdemo=lat,lon[,vei[,days]] smokedemo= dustdemo= msaa=N uiscale= palette= shaders= packs=
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# node_modules and tools/node may live in the main checkout when this is a git worktree (scripts/worktree-setup.mjs)
MAIN="$(git -C "$ROOT" worktree list --porcelain | sed -n '1s/^worktree //p')"
MAIN="$(cygpath -u "$MAIN" 2>/dev/null || echo "$MAIN")"
for d in "$ROOT/tools/node" "$MAIN/tools/node"; do
  if [ -x "$d/node.exe" ] || [ -x "$d/node" ]; then export PATH="$d:$PATH"; break; fi
done
command -v node >/dev/null || { echo "harness: no node (expected tools/node in the main checkout)"; exit 1; }
ELECTRON="$ROOT/node_modules/electron/dist/electron.exe"
cmd="$1"; shift || true
abs() { cygpath -m "$1" 2>/dev/null || echo "$1"; }
evjson() { node -e 'process.stdout.write(JSON.stringify(require("fs").readFileSync(process.argv[1],"utf8")))' "$1"; }
jpg() { node -e "require('sharp')(process.argv[1]).resize(1000).jpeg({quality:84}).toFile(process.argv[2]).then(()=>console.log('jpg', process.argv[2]))" "$1" "$2"; }
case "$cmd" in
  build)
    A="$1"; mkdir -p "$A"
    node node_modules/vite/bin/vite.js build --outDir "$(abs "$A")/dist" --emptyOutDir --logLevel error && echo "build ok → $A/dist" ;;
  cap)
    A="$1"; NAME="$2"; Q="$3"; W="${4:-1600}"; H="${5:-900}"; EV="$6"
    mkdir -p "$A/userdata"; OUT="$(abs "$A/$NAME.png")"
    EVJ=""; [ -n "$EV" ] && EVJ=",\"evaluate\":$(evjson "$EV")"
    PASSIONARIS_USERDATA="$(abs "$A/userdata")" PASSIONARIS_DIST="$(abs "$A/dist")" PASSIONARIS_CAPTURE="{\"query\":\"$Q\",\"width\":$W,\"height\":$H,\"out\":\"$OUT\"$EVJ}" \
      timeout 180 "$ELECTRON" . --disable-gpu-sandbox --passionaris-safe-gpu 2>&1 | grep -E "^\[capture\]" | tail -8
    jpg "$OUT" "$(abs "$A/$NAME.jpg")" ;;
  capl)
    A="$1"; NAME="$2"; W="${3:-1240}"; H="${4:-740}"; EV="$5"
    mkdir -p "$A/userdata"; OUT="$(abs "$A/$NAME.png")"
    EVJ=""; [ -n "$EV" ] && EVJ=",\"evaluate\":$(evjson "$EV")"
    PASSIONARIS_USERDATA="$(abs "$A/userdata")" PASSIONARIS_DIST="$(abs "$A/dist")" PASSIONARIS_CAPTURE="{\"page\":\"index.html\",\"query\":\"\",\"width\":$W,\"height\":$H,\"out\":\"$OUT\"$EVJ}" \
      timeout 120 "$ELECTRON" . --disable-gpu-sandbox --passionaris-safe-gpu 2>&1 | grep -E "^\[capture\]" | tail -8
    jpg "$OUT" "$(abs "$A/$NAME.jpg")" ;;
  acap)
    A="$1"; NAME="$2"; Q="$3"; W="${4:-1600}"; H="${5:-900}"; EV="$6"
    mkdir -p "$A/userdata"; OUT="$(abs "$A/$NAME.png")"
    EVJ=""; [ -n "$EV" ] && EVJ=",\"evaluate\":$(evjson "$EV")"
    PASSIONARIS_USERDATA="$(abs "$A/userdata")" PASSIONARIS_DIST="$(abs "$A/dist")" PASSIONARIS_CAPTURE="{\"page\":\"album.html\",\"query\":\"shot=1&$Q\",\"width\":$W,\"height\":$H,\"out\":\"$OUT\"$EVJ}" \
      timeout 240 "$ELECTRON" . --disable-gpu-sandbox --passionaris-safe-gpu 2>&1 | grep -E "^\[capture\]" | tail -12
    jpg "$OUT" "$(abs "$A/$NAME.jpg")" ;;
  smoke)
    A="$1"; EV="$2"; mkdir -p "$A/userdata" "$A/smoke"
    EVP=""; [ -n "$EV" ] && EVP="$(abs "$EV")"
    PASSIONARIS_USERDATA="$(abs "$A/userdata")" PASSIONARIS_DIST="$(abs "$A/dist")" PASSIONARIS_SMOKE="$(abs "$A/smoke")" PASSIONARIS_EVAL="$EVP" \
      timeout 300 "$ELECTRON" . --disable-gpu-sandbox --passionaris-safe-gpu 2>&1 | grep -E "^\[smoke\]" | grep -v "game console" | tail -20 ;;
  test)
    # one file at a time: the weather timing benchmark is flaky when everything runs in parallel
    node --test --test-concurrency=1 tests/*${1}*.test.mjs 2>&1 | tail -12 ;;
  *) echo "usage: scripts/harness.sh build|cap|capl|smoke|test …"; exit 1 ;;
esac
