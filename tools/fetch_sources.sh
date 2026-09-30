#!/usr/bin/env bash
# Download the raw FlyWire inputs used by tools/build_mushroom_body.py (~200 MB, not redistributed here).
set -euo pipefail
mkdir -p sources && cd sources
[ -d Drosophila_brain_model ] || git clone --depth 1 https://github.com/philshiu/Drosophila_brain_model
[ -d flywire_annotations ] || git clone --depth 1 https://github.com/flyconnectome/flywire_annotations
echo "sources ready; now run: python3 tools/build_mushroom_body.py"
