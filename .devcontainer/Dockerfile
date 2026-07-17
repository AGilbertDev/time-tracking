FROM docker.io/library/node:22-bookworm

USER root

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        git \
        curl \
        sudo && \
    npm install -g @anthropic-ai/claude-code bun && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Make sure the node user owns the workspace and the gh config dir. Creating
# ~/.config/gh here, owned by node, means the named volume mounted there (see
# devcontainer.json) is initialised with node ownership on first use, so the
# persisted gh login is writable without any runtime chown.
RUN mkdir -p /workspaces /home/node/.config/gh && \
    chown -R node:node /workspaces /home/node/.config

USER node

WORKDIR /workspaces
