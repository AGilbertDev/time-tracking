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

# Make sure the node user owns the workspace
RUN mkdir -p /workspaces && \
    chown -R node:node /workspaces

USER node

WORKDIR /workspaces
