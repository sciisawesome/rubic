#!/bin/sh
# Wraps index.html in the same skeleton the artifact host adds, for local testing.
cd "$(dirname "$0")"
{ printf '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%%}[hidden]{display:none!important}</style></head><body>'; cat index.html; printf '</body></html>'; } > dev.html
