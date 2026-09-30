#!/usr/bin/env bash
# Rebuild src/vendor/three.js: a tree-shaken, minified three.js with only what src/board3d.js and
# src/brain3d.js import.   npm i --no-save esbuild three@0.186.1 && bash tools/build_three.sh
set -euo pipefail
names=$(cat $(ls src/board3d.js src/brain3d.js 2>/dev/null) | tr '\n' ' ' | grep -o "import {[^}]*} from './vendor/three.js'" | sed "s/import {//; s/} from.*//" | tr ',' '\n' | tr -d ' ' | grep -v '^$' | sort -u)
core=$(echo "$names" | grep -v '^OrbitControls$' | paste -sd, -)
printf "export { %s } from 'three';\nexport { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';\n" "$core" > three-entry.mjs
npx esbuild three-entry.mjs --bundle --format=esm --minify --legal-comments=eof --outfile=src/vendor/three.js
rm three-entry.mjs
