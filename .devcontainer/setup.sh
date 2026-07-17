#!/usr/bin/env bash
# Installs the extra CLIs the sandbox needs beyond the base image, so every new
# devcontainer has them without a manual step. The script is idempotent and safe
# to re-run. Authentication is not part of this. Log in once per container with
# "gh auth login" and "turso auth login", since credentials are never baked into
# the image.

set -uo pipefail

mkdir -p "$HOME/.claude" "$HOME/.local/bin"

# Put the user-local bin on PATH for future interactive shells.
if ! grep -qs 'HOME/.local/bin' "$HOME/.bashrc" 2>/dev/null; then
  echo 'export PATH="$HOME/.local/bin:$PATH"' >>"$HOME/.bashrc"
fi
export PATH="$HOME/.local/bin:$PATH"

# GitHub CLI. Installed as a user-local binary so no sudo or apt repository is
# needed. A download failure warns and continues rather than failing the whole
# container build.
install_gh() {
  if command -v gh >/dev/null 2>&1; then
    echo "gh already installed, skipping."
    return 0
  fi
  echo "Installing gh."
  local arch ver tmp
  arch="$(dpkg --print-architecture)"
  ver="$(curl -sSL https://api.github.com/repos/cli/cli/releases/latest | grep -oP '"tag_name":\s*"v\K[^"]+' | head -1)"
  if [ -z "$ver" ]; then
    echo "Could not resolve the latest gh version, skipping gh." >&2
    return 0
  fi
  tmp="$(mktemp -d)"
  if curl -sSL -o "$tmp/gh.tar.gz" "https://github.com/cli/cli/releases/download/v${ver}/gh_${ver}_linux_${arch}.tar.gz" &&
    tar -xzf "$tmp/gh.tar.gz" -C "$tmp"; then
    cp "$tmp/gh_${ver}_linux_${arch}/bin/gh" "$HOME/.local/bin/gh"
    echo "Installed $(gh --version | head -1)."
  else
    echo "gh download failed, skipping gh." >&2
  fi
  rm -rf "$tmp"
}

# Turso CLI. The official installer drops the binary in ~/.turso and adds it to
# PATH through .bashrc.
install_turso() {
  if command -v turso >/dev/null 2>&1 || [ -x "$HOME/.turso/turso" ]; then
    echo "turso already installed, skipping."
    return 0
  fi
  echo "Installing turso."
  if ! curl -sSfL https://get.tur.so/install.sh | bash; then
    echo "turso install failed, skipping turso." >&2
  fi
}

install_gh
install_turso

echo "Sandbox setup done. Authenticate once with gh auth login and turso auth login."
