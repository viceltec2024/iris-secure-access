#!/bin/zsh
set -eu

API_URL="https://iris-secure-access.taylor-667.chatgpt.site/api/agent/check-in"
AGENT_DIR="$HOME/Library/Application Support/IRIS Agent"
AGENT_PATH="$AGENT_DIR/iris-agent.sh"
TOKEN_PATH="$AGENT_DIR/agent-token"
LOG_PATH="$AGENT_DIR/agent.log"
PLIST_PATH="$HOME/Library/LaunchAgents/com.iris.security-agent.plist"

json_escape() { printf '%s' "$1" | /usr/bin/sed 's/\\/\\\\/g; s/"/\\"/g'; }

telemetry_json() {
  local hostname os_version architecture disk_used total_pages used_pages memory_used firewall
  hostname="$(/bin/hostname -s)"
  os_version="$(/usr/bin/sw_vers -productVersion)"
  architecture="$(/usr/bin/uname -m)"
  disk_used="$(/bin/df -k / | /usr/bin/awk 'NR==2 {gsub("%", "", $5); print $5}')"
  total_pages="$(/usr/sbin/sysctl -n hw.memsize | /usr/bin/awk '{print int($1/4096)}')"
  used_pages="$(/usr/bin/vm_stat | /usr/bin/awk '/Pages active|Pages wired down|Pages occupied by compressor/ {gsub("\\.", "", $NF); sum += $NF} END {print sum+0}')"
  memory_used="$(/usr/bin/awk -v used="$used_pages" -v total="$total_pages" 'BEGIN {if(total>0) printf "%d", (used/total)*100; else print 0}')"
  if /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate 2>/dev/null | /usr/bin/grep -q "enabled"; then firewall=true; else firewall=false; fi
  printf '{"hostname":"%s","osVersion":"macOS %s","architecture":"%s","diskUsedPercent":%s,"memoryUsedPercent":%s,"firewallEnabled":%s}' "$(json_escape "$hostname")" "$(json_escape "$os_version")" "$(json_escape "$architecture")" "$disk_used" "$memory_used" "$firewall"
}

check_in() {
  [ -f "$TOKEN_PATH" ] || { echo "IRIS Agent is not enrolled."; exit 1; }
  local token payload response_file
  token="$(/bin/cat "$TOKEN_PATH")"
  payload="$(telemetry_json)"
  response_file="$(/usr/bin/mktemp -t iris-agent)"
  if /usr/bin/curl --fail --silent --show-error --connect-timeout 15 --max-time 30 -H "Authorization: Bearer $token" -H "Content-Type: application/json" --data "{\"telemetry\":$payload}" "$API_URL" > "$response_file"; then
    echo "$(/bin/date -u +%FT%TZ) check-in succeeded" >> "$LOG_PATH"
  else
    echo "$(/bin/date -u +%FT%TZ) check-in failed" >> "$LOG_PATH"
  fi
  /bin/rm -f "$response_file"
}

install_agent() {
  echo "IRIS Agent for macOS"
  echo "This read-only agent reports macOS version, architecture, disk/memory usage, and firewall status."
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
  /bin/cp "$0" "$AGENT_PATH"
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
