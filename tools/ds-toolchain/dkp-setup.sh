#!/bin/bash
# Runs INSIDE MSYS2. Adds devkitPro's pacman repositories and installs the Nintendo DS toolset.
# Follows https://devkitpro.org/wiki/devkitPro_pacman ("Customising Existing MSYS2 Installations").
# Idempotent: safe to run again.
set -e

echo "== MSYS2 keyring"
pacman-key --init
pacman-key --populate msys2

echo "== devkitPro signing key"
pacman-key --recv BC26F752D25B92CE272E0F44F7FD5492264BB9D0 --keyserver keyserver.ubuntu.com
pacman-key --lsign BC26F752D25B92CE272E0F44F7FD5492264BB9D0
pacman -U --noconfirm --needed https://pkg.devkitpro.org/devkitpro-keyring.pkg.tar.xz

echo "== devkitPro repositories"
if ! grep -q '^\[dkp-libs\]' /etc/pacman.conf; then
  {
    echo ""
    echo "[dkp-libs]"
    echo "Server = https://pkg.devkitpro.org/packages"
    echo ""
    echo "[dkp-windows]"
    echo 'Server = https://pkg.devkitpro.org/packages/windows/$arch/'
  } >> /etc/pacman.conf
fi

echo "== sync"
pacman -Sy --noconfirm

echo "== install nds-dev (devkitARM, libnds, ndstool, grit, ...) and make"
# `make` is not part of MSYS2's base install, and the devkitPro build system needs it.
pacman -S --needed --noconfirm nds-dev make
echo "== done"
