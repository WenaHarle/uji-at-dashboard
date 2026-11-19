#!/bin/sh
set -e
: "${MQTT_INTERNAL_USER:?MQTT_INTERNAL_USER belum diisi}"
: "${MQTT_INTERNAL_PASS:?MQTT_INTERNAL_PASS belum diisi}"

DS=/mosquitto/data/dynamic-security.json
rm -f /mosquitto/data/passwd
if [ ! -f "$DS" ]; then
  # Akun admin (dipakai app) dibuat sekali; akun ESP dibuat app lewat $CONTROL
  mosquitto_ctrl dynsec init "$DS" "$MQTT_INTERNAL_USER" "$MQTT_INTERNAL_PASS"
fi
chown -R mosquitto:mosquitto /mosquitto/data
chmod 0700 "$DS"

exec /usr/sbin/mosquitto -c /mosquitto/config/mosquitto.conf
