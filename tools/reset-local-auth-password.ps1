param([string]$Username = '022443')
$ErrorActionPreference = 'Stop'
if ($Username -notmatch '^[A-Za-z0-9._-]{3,64}$') { throw 'Invalid username format.' }
$first = Read-Host 'Enter the new 8-digit password (hidden)' -AsSecureString
$second = Read-Host 'Enter it again (hidden)' -AsSecureString
$bstr1 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($first)
$bstr2 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($second)
try { $plain1 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr1); $plain2 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr2) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr1); [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr2) }
if ($plain1 -ne $plain2 -or $plain1 -notmatch '^\d{8}$') { throw 'Password must be the same 8 digits both times.' }
$payload = @{ username = $Username; password = $plain1 } | ConvertTo-Json -Compress
$plain1 = $null; $plain2 = $null
$result = $payload | & wsl.exe -d Ubuntu -- bash -lc @'
set -euo pipefail
payload=$(cat)
username=$(printf '%s' "$payload" | python3 -c 'import json,sys; print(json.load(sys.stdin)["username"])')
password=$(printf '%s' "$payload" | python3 -c 'import json,sys; print(json.load(sys.stdin)["password"])')
cd /opt/inspection/supabase
service_key=$(sed -n 's/^SERVICE_ROLE_KEY=//p' .env | head -n 1)
user_id=$(docker exec supabase-db psql -U postgres -d postgres -Atc "select auth_id from public.users where username='$username' and status='active' limit 1" | tr -d '\r' | head -n 1)
if [ -z "$user_id" ]; then echo 'Active username not found.' >&2; exit 4; fi
body=$(printf '%s' "$password" | python3 -c 'import json,sys; print(json.dumps({"password":sys.stdin.read()}))')
status=$(curl -sS -o /tmp/reset-password-response.json -w '%{http_code}' -X PUT "http://127.0.0.1:8000/auth/v1/admin/users/$user_id" -H "Authorization: Bearer $service_key" -H "apikey: $service_key" -H 'Content-Type: application/json' --data "$body")
if [ "$status" != '200' ]; then echo "Password reset failed (service status $status)." >&2; exit 5; fi
echo 'Password reset completed. Sign in with the new password.'
'@
if ($LASTEXITCODE -ne 0) { throw 'Password reset failed; the password was not written to output or disk.' }
$result
