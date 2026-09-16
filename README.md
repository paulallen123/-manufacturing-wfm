# Manufacturing WFM browser-test transport

This repository is being used to transport the verified WFM candidate into the existing Railway test environment for hosted browser verification. The application runtime is stored as a compressed exact-source bundle. The launch harness only changes the server listen address from loopback to 0.0.0.0 so the non-production Railway proxy can reach it. This is not a production release or a replacement application.
