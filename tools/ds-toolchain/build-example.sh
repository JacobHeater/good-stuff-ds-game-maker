#!/bin/bash
# Runs INSIDE MSYS2. Builds one of libnds's bundled 3D examples into a .nds, to prove the
# toolchain works end to end. Output: /tmp/hello3d/hello3d.nds  (= C:\msys64\tmp\hello3d\hello3d.nds)
#
# Note what this has to do by hand, because the compiler build driver will have to as well:
# devkit-env.sh sets DEVKITPRO/DEVKITARM but does not put the compilers on PATH, so we do.
set -e
export DEVKITPRO=/opt/devkitpro
export DEVKITARM=/opt/devkitpro/devkitARM
export PATH="$DEVKITARM/bin:$DEVKITPRO/tools/bin:$PATH"

arm-none-eabi-gcc --version | head -1
make --version | head -1

rm -rf /tmp/hello3d && mkdir -p /tmp/hello3d
cp -r "$DEVKITPRO/examples/nds/Graphics/3D/Simple_Tri/." /tmp/hello3d/
cd /tmp/hello3d
make 2>&1 | tail -20
ls -l /tmp/hello3d/*.nds
