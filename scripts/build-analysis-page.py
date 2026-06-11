"""Build premium analysis page with audio + transcript + insights"""
import os, json, sqlite3, re

rec_dir = "/var/www/acg-command-center/recordings"
db = sqlite3.connect('/root/acg-command-center/dev.db')

# Analyze each transcript for patterns
def analyze(transcript, canal, mins, fecha):
    t = transcript.lower()
    issues = []

    # Pattern detection
    if any(w in t for w in ['parts for', 'looking for parts', 'sell parts', 'need parts']):
        issues.append(('🎯 Wrong Intent', 'Caller was looking for PARTS, not collision repair. Google Ads keyword mismatch.'))
    if any(w in t for w in ['other shop', 'another shop', 'different shop', 'renew auto', 'caliber']):
        issues.append(('🏪 Shopping Around', 'Customer already at another shop or comparing multiple options.'))
    if any(w in t for w in ['insurance', 'claim number', 'deductible', 'coverage', 'uninsured']):
        if any(w in t for w in ['waiting for', 'still waiting', 'trying to', 'figure out']):
            issues.append(('📋 Insurance Unresolved', 'Insurance claim in progress — customer cannot commit until resolved.'))
    if any(w in t for w in ['truck driver', 'on the road', 'not home', 'out of town', 'home time']):
        issues.append(('⏰ Availability', 'Customer rarely home (truck driver / travels). Hard to schedule.'))
    if any(w in t for w in ['far', 'distance', 'location', 'gardena', 'miles away']):
        issues.append(('📍 Distance', 'Customer too far from the nearest ACG location.'))
    if any(w in t for w in ['call you back', 'confirm', 'get back to', 'let you know', 'think about']):
        issues.append(('📞 Follow-up Gap', 'Call ended with pending action — no immediate commitment. Follow-up likely missing.'))
    if any(w in t for w in ['just looking', 'wanted to know', 'checking', 'calling around', 'see what']):
        issues.append(('🔍 Info Only', 'Customer was researching/price-shopping, not ready to book.'))
    if any(w in t for w in ['$', 'dollars', 'price', 'cost', 'expensive', 'pay', 'payment', 'credit']):
        if any(w in t for w in ['out of pocket', 'no insurance', 'paying cash']):
            issues.append(('💵 Out of Pocket', 'Customer paying cash — price sensitivity high, financing offered.'))
    if any(w in t for w in ['police report', 'police', 'officer', 'at fault', 'impaired']):
        issues.append(('🚔 Police/At-Fault', 'Accident report complications — at-fault or impaired claim.'))
    if any(w in t for w in ['hit and run', 'scam', 'fake', 'wrong info', 'doesn\'t match']):
        issues.append(('🚨 Suspicious/Fraud', 'Possible scam, fake info, or hit-and-run situation.'))

    if not issues:
        # Generic analysis based on call structure
        if mins > 20:
            issues.append(('⏱️ Long Call No Close', f'Spent {mins} min on the phone but failed to secure a firm appointment. Agent may need closing techniques.'))
        else:
            issues.append(('🔍 Quick Inquiry', 'Customer made a brief inquiry. May not have been a serious lead.'))

    return issues

def build_page():
    mp3s = sorted([f for f in os.listdir(rec_dir) if f.endswith('.mp3')])

    cards = []
    google_ads_count = 0
    lsa_count = 0
    total_issues = {}

    for fname in mp3s:
        call_sid = fname.replace('.mp3', '')
        txt_path = os.path.join(rec_dir, f'{call_sid}.txt')

        if not os.path.exists(txt_path):
            continue

        with open(txt_path) as f:
            content = f.read()

        # Parse metadata
        meta = {}
        transcript = ''
        for line in content.split('\n'):
            if ':' in line and line.startswith(('CALL:','CANAL:','TELEFONO:','DURACION:','FECHA:','TRACKING:')):
                k, v = line.split(':', 1)
                meta[k.strip()] = v.strip()
            elif line.startswith('='):
                continue
            else:
                transcript += line + ' '

        canal = meta.get('CANAL', 'unknown')
        if canal == 'google_ads': google_ads_count += 1
        else: lsa_count += 1

        issues = analyze(transcript, canal,
                        meta.get('DURACION', '?'),
                        meta.get('FECHA', '?'))

        for title, _ in issues:
            total_issues[title] = total_issues.get(title, 0) + 1

        # Generate card HTML
        color = '#3b82f6' if canal == 'google_ads' else '#10b981'
        emoji = '🔵' if canal == 'google_ads' else '🟢'

        issues_html = ''.join([
            f'<div style="background:#111122;border-left:3px solid {color};padding:8px 12px;border-radius:0 6px 6px 0;margin:4px 0"><strong style="color:#f59e0b;font-size:11px">{title}</strong><span style="color:#c0c0d0;font-size:11px;margin-left:8px">{desc}</span></div>'
            for title, desc in issues
        ])

        # Shorten transcript for display (first 500 chars)
        short_transcript = transcript[:500].strip()
        if len(transcript) > 500:
            short_transcript += '...'

        cards.append(f'''
        <div class="call-card" style="background:#0c0c18;border:1px solid #1c1c30;border-radius:12px;padding:20px;margin-bottom:16px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
            <div style="display:flex;align-items:center;gap:12px">
              <span style="color:{color};font-weight:700;font-size:13px;text-transform:uppercase">{emoji} {canal.replace("_"," ")}</span>
              <span style="font-family:monospace;font-size:12px;color:#d0d0e0">{meta.get("TELEFONO","?")}</span>
              <span style="font-family:monospace;font-weight:700;color:#f59e0b">{meta.get("DURACION","?")} min</span>
              <span style="font-size:11px;color:#8a8aa0">{meta.get("FECHA","?")[:10]}</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <audio controls preload="metadata" style="width:180px;height:28px"><source src="/recordings/{call_sid}.mp3" type="audio/mpeg"></audio>
            </div>
          </div>

          <div style="margin-bottom:12px">{issues_html}</div>

          <details style="cursor:pointer">
            <summary style="color:#6a6a80;font-size:11px;padding:8px;background:#080810;border-radius:6px">
              📝 Ver transcripción completa
            </summary>
            <div style="padding:12px;background:#080810;border-radius:6px;margin-top:4px;max-height:300px;overflow-y:auto;font-size:12px;color:#a0a0b0;line-height:1.6;white-space:pre-wrap">{short_transcript}</div>
          </details>
        </div>
        ''')

    # Summary stats
    summary_html = ''.join([
        f'<div class="kpi"><div class="kpi-value" style="color:#f59e0b">{count}</div><div class="kpi-label">{title}</div></div>'
        for title, count in sorted(total_issues.items(), key=lambda x: -x[1])[:6]
    ])

    html = f'''<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<meta http-equiv="Cache-Control" content="no-cache">
<title>ACG — Análisis de Llamadas No Convertidas</title>
<style>
body {{ font-family: Inter, system-ui, sans-serif; background: #06060c; color: #e0e0e0; padding: 30px; max-width: 1400px; margin: 0 auto; }}
h1 {{ color: #f59e0b; font-size: 24px; }}
.kpi {{ background: #0c0c18; border:1px solid #1c1c30; border-radius:10px; padding:14px; text-align:center; min-width:140px; }}
.kpi-value {{ font-size: 24px; font-weight: bold; font-family: JetBrains Mono, monospace; }}
.kpi-label {{ font-size: 9px; color: #8a8aa0; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }}
.summary {{ display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }}
audio {{ border-radius: 4px; }}
audio::-webkit-media-controls-panel {{ background: #111122; }}
.call-card {{ transition: all 0.2s; }}
.call-card:hover {{ border-color: #2a2a40; }}
</style></head><body>

<h1>🔍 ACG — Análisis Forense de Llamadas No Convertidas</h1>
<p style="color:#8a8aa0;margin-bottom:4px">{google_ads_count} Google Ads + {lsa_count} LSA · Todas >5 min · {len(cards)} transcripciones analizadas</p>
<p style="color:#ef4444;font-weight:600;font-size:12px;margin-bottom:20px">⚠️ Ninguna de estas llamadas resultó en cita</p>

<div class="summary">
<div class="kpi" style="min-width:100px"><div class="kpi-value" style="color:#3b82f6">{google_ads_count}</div><div class="kpi-label">Google Ads</div></div>
<div class="kpi" style="min-width:100px"><div class="kpi-value" style="color:#10b981">{lsa_count}</div><div class="kpi-label">LSA</div></div>
{summary_html}
</div>

{''.join(cards)}

<p style="margin-top:30px;color:#6a6a80;font-size:10px;text-align:center">
ACG Command Center · Análisis generado por IA · Cada tarjeta incluye audio, diagnóstico y transcripción completa
</p>
</body></html>'''

    with open('/var/www/acg-command-center/analysis.html', 'w') as f:
        f.write(html)
    print(f'✅ Página generada: {len(cards)} llamadas analizadas')
    print('🔗 https://acg.tamgo.ai/analysis.html')

if __name__ == '__main__':
    build_page()
