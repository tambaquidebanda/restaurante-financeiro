#!/usr/bin/env python3
"""
Robô Getnet — baixa os extratos do SFTP da Getnet, lê o EDI (400 bytes v10.1)
e grava vendas + liquidações financeiras no Supabase. Idempotente (dedup global),
pode rodar todo dia sem duplicar.

Credenciais vêm de variáveis de ambiente (GitHub Actions secrets):
  GETNET_SFTP_HOST, GETNET_SFTP_USER, GETNET_SFTP_PASS,
  SUPABASE_URL, SUPABASE_SERVICE_KEY
Nunca coloque senha/chave neste arquivo.
"""
import os, re, sys, json, time, urllib.request, urllib.error
from datetime import datetime, timezone, timedelta
import paramiko

HOST = os.environ['GETNET_SFTP_HOST']
USER = os.environ['GETNET_SFTP_USER']
PASS = os.environ['GETNET_SFTP_PASS']
SB_URL = os.environ['SUPABASE_URL'].rstrip('/')
SB_KEY = os.environ['SUPABASE_SERVICE_KEY']
REMOTE_DIR = os.environ.get('GETNET_SFTP_DIR', '/publico')
BASE = f'{SB_URL}/rest/v1'
HDR = {'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY}

# ---------- parser EDI (mesmos offsets validados no app) ----------
def money(s):
    s = s.strip()
    return int(s) / 100 if s.isdigit() else 0
def dbr(s):
    return f'{s[4:8]}-{s[2:4]}-{s[0:2]}' if re.fullmatch(r'\d{8}', s or '') else None
def hbr(s):
    return f'{s[0:2]}:{s[2:4]}:{s[4:6]}' if re.fullmatch(r'\d{6}', s or '') else None
def bandeira(card):
    b = re.sub(r'\D', '', card or '')[:6]
    if b[:1] == '4': return 'Visa'
    if b[:1] == '2' or b[:2] in ('51','52','53','54','55'): return 'Master'
    if b[:2] in ('37','34'): return 'Amex'
    if b[:6] == '606282': return 'Hipercard'
    if b[:1] == '6' or b[:2] == '50': return 'Elo'
    return 'BIN ' + b if b else None
def utc(d, h):
    if not d: return None
    return datetime.fromisoformat(f'{d}T{h or "00:00:00"}').replace(
        tzinfo=timezone(timedelta(hours=-3))).astimezone(timezone.utc).isoformat()

def parse(txt, arquivo):
    vendas, fin = [], []
    for l in txt.split('\n'):
        l = l.rstrip('\r')
        if len(l) < 400: continue
        t = l[0]
        if t == '2':
            dv = dbr(l[37:45]); nsu = l[25:37].strip().lstrip('0') or None
            bruto = money(l[70:82]); taxa = money(l[175:187])
            parc = int(l[106:108]) if l[106:108].isdigit() else 1
            pct = round(taxa/bruto*100, 2) if bruto else 0
            mod = 'credito_parcelado' if parc > 1 else ('debito' if pct <= 1.8 else 'credito_avista')
            vendas.append(dict(nsu=nsu, codigo_autorizacao=l[130:140].strip() or None,
                bandeira=bandeira(l[51:70]), modalidade=mod,
                parcelas=parc if parc > 1 else None, cartao_mascarado=l[51:70].strip() or None,
                terminal=l[159:167].strip() or None, data_venda=dv, hora_venda=hbr(l[45:51]),
                data_hora_utc=utc(dv, hbr(l[45:51])), data_pagamento_prevista=dbr(l[122:130]),
                valor_bruto=bruto, valor_taxa=taxa, valor_liquido=round(bruto-taxa, 2),
                tipo_registro='venda', origem='sftp_edi', arquivo_origem=arquivo))
        elif t == '6':
            op = l[44:46]
            # CS (Cessão) e AC (Antecipação) = crédito antecipado [86:98]; PG (Agenda Livre) = débito.
            if op in ('CS', 'AC'): modalidade, cents = 'antecipacao', l[86:98]
            elif op == 'PG':       modalidade, cents = 'debito', l[110:122]
            else: continue
            v = money(cents)
            if v > 0:
                fin.append(dict(data_pagamento=dbr(l[16:24]), modalidade=modalidade,
                    valor_liquido_esperado=round(v, 2), arquivo_origem='getnet_edi', status='pendente'))
    return vendas, fin

# ---------- Supabase REST ----------
def sb_get(path):
    out, fr = [], 0
    while True:
        req = urllib.request.Request(BASE + path, headers={**HDR, 'Range': f'{fr}-{fr+999}'})
        with urllib.request.urlopen(req, timeout=60) as r:
            c = json.load(r)
        out += c
        if len(c) < 1000: break
        fr += 1000
    return out
def _post_lote(path, rows):
    data = json.dumps(rows).encode()
    req = urllib.request.Request(BASE + path, data=data, method='POST',
        headers={**HDR, 'Content-Type': 'application/json', 'Prefer': 'return=minimal'})
    try:
        urllib.request.urlopen(req, timeout=90)
        return len(rows), 0
    except urllib.error.HTTPError as e:
        corpo = e.read().decode('utf-8', 'replace')[:400]
        if e.code != 409:
            raise RuntimeError(f'HTTP {e.code} em {path}: {corpo}')
        # 409 = o banco recusou uma linha repetida. Em vez de perder o lote
        # inteiro, parte no meio ate isolar a culpada e segue com o resto.
        if len(rows) == 1:
            print(f'   PULADA (ja existe): {json.dumps(rows[0], ensure_ascii=False)[:200]}', flush=True)
            print(f'        motivo: {corpo}', flush=True)
            return 0, 1
        m = len(rows) // 2
        a1, p1 = _post_lote(path, rows[:m])
        a2, p2 = _post_lote(path, rows[m:])
        return a1 + a2, p1 + p2

def sb_post(path, rows):
    grav = pul = 0
    for i in range(0, len(rows), 500):
        g, p = _post_lote(path, rows[i:i+500])
        grav += g; pul += p
    return grav, pul

# ---------- SFTP ----------
def baixar_arquivos():
    print(f'Conectando no SFTP {HOST} …', flush=True)
    t = paramiko.Transport((HOST, 22))
    t.connect(username=USER, password=PASS)
    sftp = paramiko.SFTPClient.from_transport(t)
    nomes = [n for n in sftp.listdir(REMOTE_DIR) if re.match(r'getnetextr_\d{8}_.*\.txt$', n)]
    print(f'{len(nomes)} arquivos no diretório.', flush=True)
    arquivos = {}
    for n in sorted(nomes):
        with sftp.open(f'{REMOTE_DIR}/{n}', 'r') as f:
            arquivos[n] = f.read().decode('latin-1')
    sftp.close(); t.close()
    return arquivos

# Mesma chave do indice unico do banco (ux_card_transacoes_nat):
# COALESCE(nsu,''), data_venda, valor_bruto, tipo_registro.
def chave_venda(v):
    return (v.get('nsu') or '', v['data_venda'], round(float(v['valor_bruto']), 2))

def main():
    arquivos = baixar_arquivos()
    vendas, fin = {}, {}
    for nome, txt in arquivos.items():
        vs, fs = parse(txt, nome)
        for v in vs:
            if not v['data_venda']: continue   # sem data nao da para deduplicar nem conciliar
            vendas[chave_venda(v)] = v
        for x in fs:
            if not x['data_pagamento']: continue
            fin[(x['data_pagamento'], x['modalidade'], x['valor_liquido_esperado'])] = x
    vendas = list(vendas.values()); fin = list(fin.values())
    print(f'Parse: {len(vendas)} vendas, {len(fin)} liquidações (deduplicadas).', flush=True)

    # dedup contra o que já existe no Supabase
    dsV = sorted({v['data_venda'] for v in vendas if v['data_venda']})
    exV = set()
    if dsV:
        q = f"/card_transacoes?select=nsu,data_venda,valor_bruto&tipo_registro=eq.venda&data_venda=in.({','.join(dsV)})"
        for r in sb_get(q):
            exV.add((r['nsu'] or '', r['data_venda'], round(float(r['valor_bruto']), 2)))
    novasV = [v for v in vendas if chave_venda(v) not in exV]

    dsL = sorted({x['data_pagamento'] for x in fin if x['data_pagamento']})
    exL = set()
    if dsL:
        q = f"/card_lotes_pagamento?select=data_pagamento,modalidade,valor_liquido_esperado&data_pagamento=in.({','.join(dsL)})"
        for r in sb_get(q):
            exL.add((r['data_pagamento'], r['modalidade'], round(float(r['valor_liquido_esperado']), 2)))
    novasL = [x for x in fin if (x['data_pagamento'], x['modalidade'], x['valor_liquido_esperado']) not in exL]

    gv = pv = gl = pl = 0
    if novasV: gv, pv = sb_post('/card_transacoes', novasV)
    if novasL: gl, pl = sb_post('/card_lotes_pagamento', novasL)
    print(f'✅ Vendas: {gv} gravadas, {pv} puladas. '
          f'Liquidações: {gl} gravadas, {pl} puladas.', flush=True)

if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(f'ERRO: {type(e).__name__}: {e}', file=sys.stderr, flush=True)
        sys.exit(1)
