#!/bin/zsh
set -eu

SCRIPT_PATH="${0:A}"

API_URL="https://iris-secure-access.taylor-667.chatgpt.site/api/agent/check-in"
AGENT_DIR="$HOME/Library/Application Support/IRIS Agent"
AGENT_PATH="$AGENT_DIR/iris-agent.sh"
TOKEN_PATH="$AGENT_DIR/agent-token"
KEYCHAIN_SERVICE="com.iris.security-agent"
KEYCHAIN_ACCOUNT="agent-token"
LOG_PATH="$AGENT_DIR/agent.log"
PLIST_PATH="$HOME/Library/LaunchAgents/com.iris.security-agent.plist"

json_escape() { printf '%s' "$1" | /usr/bin/sed 's/\\/\\\\/g; s/"/\\"/g'; }

telemetry_json() {
  local hostname os_version architecture disk_used total_pages used_pages memory_used firewall gatekeeper filevault sip auto_updates app_count app_hash risky_json xprotect mrt xprotect_version persistence_count persistence_hash unsigned_persistence_json
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
  local xprotect_path="/Library/Apple/System/Library/CoreServices/XProtect.bundle"
  [ -e "$xprotect_path" ] || xprotect_path="/Library/Apple/System/Library/CoreServices/XProtect.app"
  if [ -e "$xprotect_path" ]; then xprotect=true; else xprotect=false; fi
  if [ -e "/Library/Apple/System/Library/CoreServices/MRT.app" ]; then mrt=true; else mrt=false; fi
  xprotect_version="$(/usr/bin/defaults read "$xprotect_path/Contents/Info" CFBundleShortVersionString 2>/dev/null || /usr/bin/defaults read "$xprotect_path/Contents/Info" CFBundleVersion 2>/dev/null || echo unknown)"
  local persistence_list
  persistence_list="$(/usr/bin/find "$HOME/Library/LaunchAgents" /Library/LaunchAgents /Library/LaunchDaemons -maxdepth 1 -type f -name '*.plist' -print 2>/dev/null | /usr/bin/sort)"
  persistence_count="$(printf '%s\n' "$persistence_list" | /usr/bin/awk 'NF {count++} END {print count+0}')"
  persistence_hash="$(printf '%s\n' "$persistence_list" | /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}')"
  unsigned_persistence_json="["
  local persistence_separator="" plist executable item_name persistence_checked=0
  while IFS= read -r plist && [ "$persistence_checked" -lt 100 ]; do
    [ -n "$plist" ] || continue
    persistence_checked=$((persistence_checked + 1))
    executable="$(/usr/bin/plutil -extract Program raw -o - "$plist" 2>/dev/null || /usr/bin/plutil -extract ProgramArguments.0 raw -o - "$plist" 2>/dev/null || true)"
    if [ -n "$executable" ] && [ -f "$executable" ] && /usr/bin/file "$executable" 2>/dev/null | /usr/bin/grep -q 'Mach-O' && ! /usr/bin/codesign --verify --strict "$executable" >/dev/null 2>&1; then
      item_name="${plist:t:r}"
      unsigned_persistence_json="${unsigned_persistence_json}${persistence_separator}\"$(json_escape "$item_name")\""
      persistence_separator=","
    fi
  done <<< "$persistence_list"
  unsigned_persistence_json="${unsigned_persistence_json}]"
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
  printf '{"hostname":"%s","osVersion":"macOS %s","architecture":"%s","diskUsedPercent":%s,"memoryUsedPercent":%s,"firewallEnabled":%s,"gatekeeperEnabled":%s,"fileVaultEnabled":%s,"sipEnabled":%s,"automaticUpdatesEnabled":%s,"installedApplicationCount":%s,"applicationInventoryHash":"%s","riskyApplications":%s,"xProtectPresent":%s,"xProtectVersion":"%s","malwareRemovalToolPresent":%s,"persistenceItemCount":%s,"persistenceInventoryHash":"%s","unsignedPersistenceItems":%s}' "$(json_escape "$hostname")" "$(json_escape "$os_version")" "$(json_escape "$architecture")" "$disk_used" "$memory_used" "$firewall" "$gatekeeper" "$filevault" "$sip" "$auto_updates" "$app_count" "$app_hash" "$risky_json" "$xprotect" "$(json_escape "$xprotect_version")" "$mrt" "$persistence_count" "$persistence_hash" "$unsigned_persistence_json"
}

check_in() {
  /usr/bin/security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$KEYCHAIN_ACCOUNT" -w >/dev/null 2>&1 || { echo "IRIS Agent is not enrolled."; exit 1; }
  local token payload request_body response_file timestamp nonce signature signing_input
  token="$(/usr/bin/security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$KEYCHAIN_ACCOUNT" -w)"
  payload="$(telemetry_json)"
  request_body="{\"telemetry\":$payload}"
  timestamp="$(/bin/date +%s)"
  nonce="$(/usr/bin/uuidgen | /usr/bin/tr -d '-' | /usr/bin/tr '[:upper:]' '[:lower:]')"
  signing_input="${timestamp}.${nonce}.${request_body}"
  signature="$(printf '%s' "$signing_input" | /usr/bin/openssl dgst -sha256 -hmac "$token" | /usr/bin/awk '{print $NF}')"
  response_file="$(/usr/bin/mktemp -t iris-agent)"
  if /usr/bin/curl --fail --silent --show-error --retry 2 --retry-delay 5 --connect-timeout 15 --max-time 45 -H "Authorization: Bearer $token" -H "X-IRIS-Timestamp: $timestamp" -H "X-IRIS-Nonce: $nonce" -H "X-IRIS-Signature: $signature" -H "Content-Type: application/json" --data-binary "$request_body" "$API_URL" > "$response_file"; then
    echo "$(/bin/date -u +%FT%TZ) check-in succeeded" >> "$LOG_PATH"
  else
    echo "$(/bin/date -u +%FT%TZ) check-in failed" >> "$LOG_PATH"
  fi
  /bin/rm -f "$response_file"
  if [ -f "$LOG_PATH" ] && [ "$(/usr/bin/wc -c < "$LOG_PATH")" -gt 1048576 ]; then /usr/bin/tail -n 1000 "$LOG_PATH" > "$LOG_PATH.tmp" && /bin/mv "$LOG_PATH.tmp" "$LOG_PATH"; fi
}

install_agent() {
  echo "IRIS Agent for macOS"
  echo "This read-only agent reports security controls, XProtect, startup persistence, system health, and application signature results."
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
  /usr/bin/security delete-generic-password -s "$KEYCHAIN_SERVICE" -a "$KEYCHAIN_ACCOUNT" >/dev/null 2>&1 || true
  /usr/bin/security add-generic-password -U -s "$KEYCHAIN_SERVICE" -a "$KEYCHAIN_ACCOUNT" -w "$token" >/dev/null
  /bin/rm -f "$TOKEN_PATH"
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
  /usr/bin/security delete-generic-password -s "$KEYCHAIN_SERVICE" -a "$KEYCHAIN_ACCOUNT" >/dev/null 2>&1 || true
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
