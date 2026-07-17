#!/usr/bin/env bash
# Installs the extra CLIs the sandbox needs beyond the base image, so every new
# devcontainer has them without a manual step, and wires git to push through the
# GitHub CLI. The script is idempotent and safe to re-run.
#
# Login is not baked into the image. You authenticate once with "gh auth login"
# (and "turso auth login" if the project has a backend). The gh config lives on
# a named volume mounted at ~/.config/gh (see devcontainer.json), so that one
# login persists across rebuilds and across every recipe project on this
# machine. You log in once, not once per container.

set -uo pipefail

mkdir -p "$HOME/.claude" "$HOME/.local/bin" "$HOME/.config/gh"

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

# Make git authenticate github.com through the GitHub CLI, so pushes use the
# account you logged into with gh rather than any credential the host forwards
# into the container. The empty value first drops an inherited generic helper
# for github.com only (the dev container credential forwarder sets one), then
# gh is added as the sole helper for that host. This is also why a work account
# forwarded by the host never ends up pushing to a personal repo. Idempotent:
# the replace-all resets any prior values before the add.
wire_git_to_gh() {
  if ! command -v gh >/dev/null 2>&1; then
    return 0
  fi
  git config --global --replace-all "credential.https://github.com.helper" "" 2>/dev/null || true
  git config --global --add "credential.https://github.com.helper" "!gh auth git-credential"
  echo "git will authenticate github.com through gh."
}

install_gh
install_turso
wire_git_to_gh

echo "Sandbox setup done. If gh is not logged in yet, run: gh auth login"
