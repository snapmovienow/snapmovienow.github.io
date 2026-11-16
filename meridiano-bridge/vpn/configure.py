#!/usr/bin/env python3
"""Run interactively on the relay server; never put account secrets in chat or Git."""
import base64
import getpass
import os
from pathlib import Path
import re

root = Path(__file__).resolve().parent
if (root / 'secrets').exists() or (root / '.env').exists():
    raise SystemExit('Configuration already exists; no credentials were replaced.')
host = input('Relay DNS hostname: ').strip().lower()
if not re.fullmatch(r'(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}', host):
    raise SystemExit('A DNS hostname is required.')
username = getpass.getpass('Surfshark manual OpenVPN username (hidden): ').strip()
password = getpass.getpass('Surfshark manual OpenVPN password (hidden): ').strip()
if not username or not password or any(c in username + password for c in '\r\n\x00'):
    raise SystemExit('Invalid service credentials.')
os.umask(0o077)
(root / 'secrets').mkdir(mode=0o700)
for name, value in [('surfshark_user', username), ('surfshark_password', password),
                    ('relay_token', base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip('='))]:
    with (root / 'secrets' / name).open('x') as f:
        f.write(value + '\n')
with (root / '.env').open('x') as f:
    f.write('MERIDIANO_RELAY_HOST=' + host + '\n')
    f.write('EDGE_ORIGIN=https://snaptvnow-meridiano-bridge.juancanta89.workers.dev\n')
print('Private configuration saved. No credential values were printed.')
