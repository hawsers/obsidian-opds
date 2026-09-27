#!/bin/bash
set -e

CLI="/opt/homebrew/bin/obsidian"
PASS=0
FAIL=0

run_test() {
  local name="$1"
  local code="$2"
  result=$(timeout 5 $CLI eval code="$code" 2>&1)
  if echo "$result" | grep -qi "error\|TypeError\|ReferenceError\|not defined\|is not\|timed out"; then
    echo "FAIL: $name"
    echo "  $result"
    FAIL=$((FAIL + 1))
  else
    echo "PASS: $name -> $result"
    PASS=$((PASS + 1))
  fi
}

echo "=== Obsidian Integration Tests ==="
echo ""

run_test "Plugin loaded" "app.plugins.plugins['opds-client'] ? 'loaded' : 'NOT LOADED'"
run_test "Settings accessible" "typeof app.plugins.plugins['opds-client'].settings === 'object' ? 'yes' : 'no'"
run_test "Servers array" "Array.isArray(app.plugins.plugins['opds-client'].settings.servers) ? 'yes: ' + app.plugins.plugins['opds-client'].settings.servers.length : 'no'"
run_test "Download path default" "app.plugins.plugins['opds-client'].settings.downloadPath === 'Books' ? 'OK' : 'WRONG'"
run_test "createConfiguredClient exists" "typeof app.plugins.plugins['opds-client'].createConfiguredClient === 'function' ? 'yes' : 'no'"
run_test "testConnection exists" "typeof app.plugins.plugins['opds-client'].testConnection === 'function' ? 'yes' : 'no'"
run_test "downloadBookToVault exists" "typeof app.plugins.plugins['opds-client'].downloadBookToVault === 'function' ? 'yes' : 'no'"
run_test "requestUrl available" "typeof requestUrl === 'function' ? 'yes' : 'no'"
run_test "Notice available" "typeof Notice === 'function' ? 'yes' : 'no'"
run_test "Vault API" "typeof app.vault.createFolder === 'function' ? 'yes' : 'no'"
run_test "View type registered" "app.workspace.getLeavesOfType('opds-library-view') !== undefined ? 'yes' : 'no'"
run_test "Ribbon icon registered" "app.workspace.leftRibbon ? 'yes' : 'no'"
run_test "Settings tab registered" "app.setting.pluginTabs.some(t => t.id === 'opds-client') ? 'yes' : 'ERROR: settings tab not registered'"
run_test "Commands registered" "app.commands.commands['opds-client:open-opds-library'] ? 'yes' : 'ERROR: command not registered'"

echo ""
echo "=== Results ==="
echo "Passed: $PASS"
echo "Failed: $FAIL"
echo "Total:  $((PASS + FAIL))"

if [ $FAIL -gt 0 ]; then
  exit 1
fi
