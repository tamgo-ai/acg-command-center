"""Download Twilio recordings to disk for fast playback"""
import sqlite3, os, json, urllib.request, base64

db = sqlite3.connect('/root/acg-command-center/dev.db')
sids = [row[0] for row in db.execute("""
SELECT c.call_sid FROM calls c
JOIN number_registry nr ON c.to_number = nr.twilio_number AND nr.channel IN ('google_ads', 'lsa')
WHERE c.direction = 'inbound' AND c.occurred_at > datetime('now', '-90 days')
  AND c.status = 'completed' AND c.duration_sec > 300
ORDER BY c.duration_sec DESC LIMIT 15
""").fetchall()]

env = {}
for line in open('/root/acg-command-center/.env'):
    if '=' in line and not line.startswith('#'):
        k,v = line.strip().split('=',1)
        env[k] = v

sid = env['TWILIO_ACCOUNT_SID']
token = env['TWILIO_AUTH_TOKEN']
dest = '/var/www/acg-command-center/recordings'
os.makedirs(dest, exist_ok=True)

for call_sid in sids:
    path = os.path.join(dest, f'{call_sid}.mp3')
    if os.path.exists(path):
        print(f'✅ {call_sid[:20]}... ya existe')
        continue

    auth = base64.b64encode(f'{sid}:{token}'.encode()).decode()

    # 1. Get parent call
    call_url = f'https://api.twilio.com/2010-04-01/Accounts/{sid}/Calls/{call_sid}.json'
    req = urllib.request.Request(call_url, headers={'Authorization': f'Basic {auth}'})
    call_data = json.loads(urllib.request.urlopen(req).read())
    parent = call_data.get('parent_call_sid') or call_sid

    # 2. Get recordings
    rec_url = f'https://api.twilio.com/2010-04-01/Accounts/{sid}/Calls/{parent}/Recordings.json'
    req2 = urllib.request.Request(rec_url, headers={'Authorization': f'Basic {auth}'})
    rec_data = json.loads(urllib.request.urlopen(req2).read())

    if rec_data.get('recordings'):
        best = sorted(rec_data['recordings'], key=lambda r: int(r.get('duration','0')))[-1]
        rec_sid = best['sid']
        mp3_url = f'https://api.twilio.com/2010-04-01/Accounts/{sid}/Recordings/{rec_sid}.mp3'

        print(f'⬇️ {call_sid[:20]}... {best.get("duration","?")}s')
        req3 = urllib.request.Request(mp3_url, headers={'Authorization': f'Basic {auth}'})
        with open(path, 'wb') as f:
            f.write(urllib.request.urlopen(req3).read())
        size = os.path.getsize(path)
        print(f'   ✅ {size//1024}KB')
    else:
        print(f'❌ {call_sid[:20]}... sin grabacion')
