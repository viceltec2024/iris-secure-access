#!/bin/zsh
set -eu

SCRIPT_PATH="${0:A}"

API_URL="https://iris-secure-access.taylor-667.chatgpt.site/api/agent/check-in"
AGENT_DIR="$HOME/Library/Application Support/IRIS Agent"
AGENT_PATH="$AGENT_DIR/iris-agent.sh"
TOKEN_PATH="$AGENT_DIR/agent-token"
LOG_PATH="$AGENT_DIR/agent.log"
PLIST_PATH="$HOME/Library/LaunchAgents/com.iris.security-agent.plist"

json_escape() { printf '%s' "$1" | /usr/bin/sed 's/\\/\\\\/g; s/"/\\"/g'; }

telemetry_json() {
  local hostname os_version architecture disk_used total_pages used_pages memory_used firewall gatekeeper filevault sip auto_updates app_count app_hash risky_json
  hostname="$(/bin/hostname -s)"
  os_version="$(/usr/bin/sw_vers -productVersion)"
  architecture="$(/usr/bin/uname -m)"
  disk_used="$(/bin/df -k / | /usr/bin/awk 'NR==2 {gsub("%", "", $5); print $5}')"
  total_pages="$(/usr/sbin/sysctl -n hw.memsize | /usr/bin/awk '{print int($1/4096)}')"
  used_pages="$(/usr/bin/vm_stat | /usr/bin/awk '/Pages active|Pages wired down|Pages occupied by compressor/ {gsub("\\.", "", $NF); sum += $NF} END {print sum+0}')"
  memory_used="$(/usr/bin/awk -v used="$used_pages" -v total="$total_pages" 'BEGIN {if(total>0) printf "%d", (used/total)*100; else print 0}')"
  if /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate 2>/dev/null | /usr/bin/grep -q "enabled"; then firewall=true; else firewall=false; fi
  if /usr/sbin/spctl --status 2>/dev/null | /usr/bin/grep -qi "assessments enabled"; then gatekeeper=true; else gatekeeper=false; fi
  if /usr/bin/fdesetup status 2>/dev/null | /usr/bin/grep -q "FileVault is On"; then filevault=true; else filevault=false; fi
  if /usr/bin/csrutil status 2>/dev/null | /usr/bin/grep -qi "enabled"; then sip=true; else sip=false; fi
  if /usr/sbin/softwareupdate --schedule 2>/dev/null | /usr/bin/grep -qi "on"; then auto_updates=true; else auto_updates=false; fi
  app_count="$(/usr/bin/find /Applications -maxdepth 1 -type d -name '*.app' 2>/dev/null | /usr/bin/wc -l | /usr/bin/tr -d ' ')"
  app_hash="$(/usr/bin/find /Applications -maxdepth 1 -type d -name '*.app' -print 2>/dev/null | /usr/bin/sort | /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}')"
  risky_json="["
  local separator="" app app_name checked=0
  while IFS= read -r app && [ "$checked" -lt 80 ]; do
    checked=$((checked + 1))
    if ! /usr/bin/codesign --verify --deep --strict "$app" >/dev/null 2>&1; then
      app_name="${app:t:r}"
      risky_json="${risky_json}${separator}\"$(json_escape "$app_name")\""
      separator=","
    fi
  done < <(/usr/bin/find /Applications -maxdepth 1 -type d -name '*.app' -print 2>/dev/null | /usr/bin/sort)
  risky_json="${risky_json}]"
  printf '{"hostname":"%s","osVersion":"macOS %s","architecture":"%s","diskUsedPercent":%s,"memoryUsedPercent":%s,"firewallEnabled":%s,"gatekeeperEnabled":%s,"fileVaultEnabled":%s,"sipEnabled":%s,"automaticUpdatesEnabled":%s,"installedApplicationCount":%s,"applicationInventoryHash":"%s","riskyApplications":%s}' "$(json_escape "$hostname")" "$(json_escape "$os_version")" "$(json_escape "$architecture")" "$disk_used" "$memory_used" "$firewall" "$gatekeeper" "$filevault" "$sip" "$auto_updates" "$app_count" "$app_hash" "$risky_json"
}

check_in() {
  [ -f "$TOKEN_PATH" ] || { echo "IRIS Agent is not enrolled."; exit 1; }
  local token payload response_file
  token="$(/bin/cat "$TOKEN_PATH")"
  payload="$(telemetry_json)"
  response_file="$(/usr/bin/mktemp -t iris-agent)"
  if /usr/bin/curl --fail --silent --show-error --retry 2 --retry-delay 5 --connect-timeout 15 --max-time 45 -H "Authorization: Bearer $token" -H "Content-Type: application/json" --data "{\"telemetry\":$payload}" "$API_URL" > "$response_file"; then
    echo "$(/bin/date -u +%FT%TZ) check-in succeeded" >> "$LOG_PATH"
  else
    echo "$(/bin/date -u +%FT%TZ) check-in failed" >> "$LOG_PATH"
  fi
  /bin/rm -f "$response_file"
  if [ -f "$LOG_PATH" ] && [ "$(/usr/bin/wc -c < "$LOG_PATH")" -gt 1048576 ]; then /usr/bin/tail -n 1000 "$LOG_PATH" > "$LOG_PATH.tmp" && /bin/mv "$LOG_PATH.tmp" "$LOG_PATH"; fi
}

install_agent() {
  echo "IRIS Agent for macOS"
  echo "This read-only agent reports security controls, system health, and application signature results."
  printf "Enter a NEW IRIS enrollment code: "
  read -r enrollment_code
  enrollment_code="$(printf '%s' "$enrollment_code" | /usr/bin/tr '[:lower:]' '[:upper:]' | /usr/bin/tr -d '[:space:]')"
  [ "${#enrollment_code}" -eq 16 ] || { echo "The enrollment code must contain 16 characters."; exit 1; }
  /bin/mkdir -p "$AGENT_DIR" "$HOME/Library/LaunchAgents"
  /bin/chmod 700 "$AGENT_DIR"
  local payload response_file token
  payload="$(telemetry_json)"
  response_file="$(/usr/bin/mktemp -t iris-enroll)"
  /usr/bin/curl --fail --silent --show-error --connect-timeout 15 --max-time 30 -H "Content-Type: application/json" --data "{\"enrollmentCode\":\"$(json_escape "$enrollment_code")\",\"telemetry\":$payload}" "$API_URL" > "$response_file" || { /bin/rm -f "$response_file"; echo "Enrollment failed. Generate a new code in IRIS and try again."; exit 1; }
  token="$(/usr/bin/plutil -extract agentToken raw -o - "$response_file" 2>/dev/null || true)"
  /bin/rm -f "$response_file"
  [ -n "$token" ] || { echo "IRIS did not return an agent token."; exit 1; }
  /bin/cp "$SCRIPT_PATH" "$AGENT_PATH"
  /bin/chmod 700 "$AGENT_PATH"
  printf '%s' "$token" > "$TOKEN_PATH"
  /bin/chmod 600 "$TOKEN_PATH"
  /bin/cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.iris.security-agent</string>
  <key>ProgramArguments</key><array><string>$AGENT_PATH</string><string>run</string></array>
  <key>StartInterval</key><integer>120</integer>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>NetworkState</key><true/></dict>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$LOG_PATH</string>
  <key>StandardErrorPath</key><string>$LOG_PATH</string>
</dict></plist>
PLIST
  /bin/launchctl bootout "gui/$(/usr/bin/id -u)/com.iris.security-agent" 2>/dev/null || true
  /bin/launchctl bootstrap "gui/$(/usr/bin/id -u)" "$PLIST_PATH"
  echo "IRIS Agent installed. Your device should show ONLINE within two minutes."
}

uninstall_agent() {
  /bin/launchctl bootout "gui/$(/usr/bin/id -u)/com.iris.security-agent" 2>/dev/null || true
  /bin/rm -f "$PLIST_PATH"
  /bin/rm -rf "$AGENT_DIR"
  echo "IRIS Agent removed from this Mac."
}

case "${1:-install}" in
  install) install_agent ;;
  run) check_in ;;
  status) /bin/launchctl print "gui/$(/usr/bin/id -u)/com.iris.security-agent" >/dev/null 2>&1 && echo "IRIS Agent is running." || echo "IRIS Agent is not running." ;;
  uninstall) uninstall_agent ;;
  *) echo "Usage: $0 [install|run|status|uninstall]"; exit 2 ;;
esac
