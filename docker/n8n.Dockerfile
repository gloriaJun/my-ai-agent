FROM docker:cli AS docker-cli

FROM n8nio/n8n:latest
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
