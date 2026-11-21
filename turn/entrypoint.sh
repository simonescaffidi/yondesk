#!/bin/sh
# Avvia coturn come relay "chiuso": inoltra traffico solo tra due client collegati a questo stesso relay.
# TURN_SECRET (obbligatorio): segreto condiviso con il server Yondesk, che genera credenziali temporanee.
set -e
[ -n "$TURN_SECRET" ] || { echo "TURN_SECRET mancante"; exit 1; }
PORT="${TURN_PORT:-3478}"
IP="${TURN_RELAY_IP:-$(hostname -i 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.' | head -1)}"
[ -n "$IP" ] || IP=127.0.0.1
echo "coturn: porta TCP $PORT, relay su $IP"
exec turnserver -n \
  --log-file=stdout --no-cli --no-tls --no-dtls --no-udp \
  --listening-port="$PORT" --listening-ip=0.0.0.0 --relay-ip="$IP" \
  --min-port=49160 --max-port=49400 \
  --fingerprint --realm="${TURN_REALM:-yondesk.com}" \
  --use-auth-secret --static-auth-secret="$TURN_SECRET" \
  --no-multicast-peers --stale-nonce=600 \
  --total-quota=200 --user-quota=12 --max-bps=3000000 \
  --denied-peer-ip=0.0.0.0-255.255.255.255 --allowed-peer-ip="$IP" \
  --denied-peer-ip=::-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
