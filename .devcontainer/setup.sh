#!/usr/bin/env bash
# Installs the extra CLIs the sandbox needs beyond the base image, so every new
# devcontainer has them without a manual step, and wires git to push through the
# GitHub CLI. The script is idempotent and safe to re-run.
#
# gh itself is not installed here. It is baked into the image by the official
# github-cli devcontainer feature (see devcontainer.json), so it is always
# present on a system path that every shell finds. This script only installs
# turso and wires git to authenticate through gh.
#
# Login is not baked into the image. You authenticate once with "gh auth login"
# (and "turso auth login" if the project has a backend). The gh and turso configs
# each live on a named volume mounted at ~/.config/gh and ~/.config/turso (see
# devcontainer.json), so those logins persist across rebuilds and across every
# recipe project on this machine. You log in once, not once per container.

set -uo pipefail

mkdir -p "$HOME/.claude" "$HOME/.local/bin" "$HOME/.config/gh" "$HOME/.config/turso"

# Put the user-local bin on PATH for future interactive shells.
if ! grep -qs 'HOME/.local/bin' "$HOME/.bashrc" 2>/dev/null; then
  echo 'export PATH="$HOME/.local/bin:$PATH"' >>"$HOME/.bashrc"
fi
export PATH="$HOME/.local/bin:$PATH"

# Turso CLI. The official installer drops the binary in ~/.turso. We also symlink
# it into ~/.local/bin, which is already on PATH (see above), so every shell finds
# turso without relying on the installer's own .bashrc edit taking effect. The
# login token persists on a named volume at ~/.config/turso (see devcontainer.json),
# so a single "turso auth login" survives rebuilds, the same as gh.
install_turso() {
  if [ ! -x "$HOME/.turso/turso" ] && ! command -v turso >/dev/null 2>&1; then
    echo "Installing turso."
    if ! curl -sSfL https://get.tur.so/install.sh | bash; then
      echo "turso install failed, skipping turso." >&2
      return 0
    fi
  else
    echo "turso already installed, skipping install."
  fi
  if [ -x "$HOME/.turso/turso" ] && [ ! -e "$HOME/.local/bin/turso" ]; then
    ln -sf "$HOME/.turso/turso" "$HOME/.local/bin/turso"
    echo "Linked turso into ~/.local/bin."
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

install_turso
wire_git_to_gh

echo "Sandbox setup done. If gh is not logged in yet, run: gh auth login"
