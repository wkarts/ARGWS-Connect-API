FROM neilpang/acme.sh:3.1.1
RUN apk add --no-cache ca-certificates coreutils
COPY infrastructure/acme/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
