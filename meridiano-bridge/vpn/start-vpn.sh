#!/bin/sh
set -eu
export OPENVPN_USER="$(cat /run/secrets/surfshark_user)"
export OPENVPN_PASSWORD="$(cat /run/secrets/surfshark_password)"
exec /gluetun-entrypoint
