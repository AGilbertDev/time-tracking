FROM docker.io/library/node:22-bookworm

USER root

# git, curl and sudo are the universal baseline. sqlite3 is project specific: this
# project uses a SQLite/Turso database, so its CLI is installed here in the
# project's own devcontainer rather than in the shared recipe template, since not
# every project needs a database client.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        git \
        curl \
        sudo \
        sqlite3 && \
    npm install -g @anthropic-ai/claude-code bun && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Make sure the node user owns the workspace and the gh and turso config dirs.
# Creating ~/.config/gh and ~/.config/turso here, owned by node, means the named
# volumes mounted there (see devcontainer.json) are initialised with node
# ownership on first use, so the persisted gh and turso logins are writable
# without any runtime chown.
RUN mkdir -p /workspaces /home/node/.config/gh /home/node/.config/turso && \
    chown -R node:node /workspaces /home/node/.config

USER node

WORKDIR /workspaces
