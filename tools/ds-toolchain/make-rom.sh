#!/bin/bash
# Runs INSIDE MSYS2. Builds the DS runtime in the directory given as $1 (an MSYS path such as
# /c/Users/you/AppData/Local/Temp/gsds-build-1234) and leaves gsgame.nds there.
#
# This is the exact environment the compiler's build driver sets up; see this folder's README.
set -e
export DEVKITPRO=/opt/devkitpro
export DEVKITARM=/opt/devkitpro/devkitARM
export PATH="$DEVKITARM/bin:$DEVKITPRO/tools/bin:$PATH"
cd "$1"
make
