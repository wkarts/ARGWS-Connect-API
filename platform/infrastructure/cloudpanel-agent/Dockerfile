FROM alpine:3.22
RUN apk add --no-cache bash coreutils findutils grep python3 util-linux
COPY infrastructure/cloudpanel-agent/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
