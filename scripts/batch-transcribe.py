"""Batch transcribe all recordings and save with metadata"""
import os, json, sqlite3, requests, time, sys

OPENAI_KEY = os.environ.get("OPENAI_API_KEY", "")
rec_dir = "/var/www/acg-command-center/recordings"
db = sqlite3.connect('/root/acg-command-center/dev.db')

mp3s = sorted([f for f in os.listdir(rec_dir) if f.endswith('.mp3')])

for fname in mp3s:
    call_sid = fname.replace('.mp3', '')
    txt_path = os.path.join(rec_dir, f'{call_sid}.txt')

    if os.path.exists(txt_path):
        print(f'✅ {call_sid[:16]}... ya transcrito')
        continue

    path = os.path.join(rec_dir, fname)

    info = db.execute("""
        SELECT c.from_number, ROUND(c.duration_sec/60.0,1), datetime(c.occurred_at),
               nr.channel, nr.display_name
        FROM calls c JOIN number_registry nr ON c.to_number = nr.twilio_number
        WHERE c.call_sid = ?
    """, (call_sid,)).fetchone()

    if not info:
        print(f'❌ {call_sid[:16]}... no info in DB')
        continue

    phone, mins, fecha, canal, tracking = info
    size_mb = os.path.getsize(path) / (1024*1024)
    print(f'🎤 {call_sid[:16]}... {canal} | {mins}min | {size_mb:.1f}MB | {fecha[:10]}')

    # Send to whisper
    try:
        with open(path, 'rb') as f:
            resp = requests.post(
                "https://api.openai.com/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {OPENAI_KEY}"},
                files={"file": (fname, f, "audio/mpeg")},
                data={"model": "whisper-1", "language": "en", "response_format": "text"},
                timeout=300
            )
        if resp.status_code == 200:
            transcript = resp.text.strip()
            with open(txt_path, 'w') as f:
                f.write(f"CALL: {call_sid}\nCANAL: {canal}\nTELEFONO: {phone}\nDURACION: {mins} min\nFECHA: {fecha}\nTRACKING: {tracking}\n{'='*60}\n\n{transcript}")
            print(f'   ✅ {len(transcript)} chars')
        else:
            print(f'   ❌ Whisper {resp.status_code}: {resp.text[:150]}')
    except Exception as e:
        print(f'   ❌ Error: {e}')

    time.sleep(1)  # rate limit

print('\n✅ All transcriptions complete')
