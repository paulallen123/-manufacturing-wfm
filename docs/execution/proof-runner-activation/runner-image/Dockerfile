# Dedicated browser-proof runner image; product Dockerfile remains owner-controlled.
# The existing Railway image start command must still explicitly invoke Tini.
FROM --platform=linux/amd64 mcr.microsoft.com/playwright@sha256:bc6ab0d6d44ff4826e4cb8c1e6d801e185bfc42bb0753f8e2a30efc70db054c7

USER root

ADD --checksum=sha256:91119fce795e668bb4db2c94d1416127688242e1856f2fcf8cf2112dde8da57d https://archive.ubuntu.com/ubuntu/pool/universe/t/tini/tini_0.19.0-1_amd64.deb /tmp/vector-tini.deb

RUN set -eu; \
    test "$(dpkg --print-architecture)" = amd64; \
    printf '%s\n' '91119fce795e668bb4db2c94d1416127688242e1856f2fcf8cf2112dde8da57d  /tmp/vector-tini.deb' | sha256sum --check --strict -; \
    test "$(dpkg-deb --field /tmp/vector-tini.deb Package)" = tini; \
    test "$(dpkg-deb --field /tmp/vector-tini.deb Version)" = 0.19.0-1; \
    test "$(dpkg-deb --field /tmp/vector-tini.deb Architecture)" = amd64; \
    dpkg --install /tmp/vector-tini.deb; \
    printf '%s\n' '274f2bed211788a4fcb52d14f93ab6e7c44528493b56af5812a1cfe8ae1d2064  /usr/bin/tini' | sha256sum --check --strict -; \
    test "$(stat --format='%u:%g:%a' /usr/bin/tini)" = 0:0:755; \
    /usr/bin/tini --version; \
    rm /tmp/vector-tini.deb

ENTRYPOINT ["/usr/bin/tini", "-s", "--"]
