FROM docker:29.7.2-cli AS docker-cli

FROM n8nio/n8n:2.37.10
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
