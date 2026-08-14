#!/usr/bin/env python3
"""
Robô Caixa (iComanda) — traz a CONFERÊNCIA DO DINHEIRO e os MOVIMENTOS
(pagamentos/sangrias) de cada caixa para o Supabase, alimentando a tela
de Conciliação do Dinheiro. Idempotente; roda todo dia sem duplicar.

Por dia: descobre os caixas, consulta cada um (detalhamento.php?caixa_ids=<id>)
e grava:
  - caixa_dia_conf  (esperado × contado × diferença do Dinheiro, por caixa/loja)
  - caixa_movimentos (pagamentos e sangrias em dinheiro, com a loja/unidade)

Variáveis de ambiente (GitHub Actions secrets) — iguais ao robô do PDV:
  ICOMANDA_API_URL, ICOMANDA_API_KEY, ICOMANDA_START_DATE, ICOMANDA_DAYS_BACK (opcionais)
  SUPABASE_URL, SUPABASE_SERVICE_KEY (obrigatórios)
"""
import os, re, sys, json, urllib.request, urllib.parse
from datetime import datetime, timezone, timedelta


def env(nome, default=None, obrigatorio=False):
    v = (os.environ.get(nome) or '').strip()
    if not v:
        if obrigatorio:
            sys.exit(f'ERRO: variável {nome} não definida (configure o secret no GitHub).')
        return default
    return v


API_URL   = env('ICOMANDA_API_URL', 'https://cloud.icomanda.com/tdb/apidashboard').rstrip('/')
API_KEY   = env('ICOMANDA_API_KEY', 'apidash_249_aB3xY7zQ9Wm2KpV5')
START_DAT = env('ICOMANDA_CAIXA_START_DATE', '2026-08-06')  # manual do caixa foi feito até 05/08
DAYS_BACK = int(env('ICOMANDA_DAYS_BACK', '4'))
SB_URL    = env('SUPABASE_URL', obrigatorio=True).rstrip('/')
SB_KEY    = env('SUPABASE_SERVICE_KEY', obrigatorio=True)
BASE      = f'{SB_URL}/rest/v1'
HDR       = {'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY}

# Loja no PDV → unidade_id no financeiro (confirmado com o usuário)
UNIDADES = {
    'Tambaqui de Banda Loja Centro': 'e031eced-0652-4af0-ad2a-13b65a29f814',  # Tambaqui de Banda Teatro
    'Tdb - Parque 10':               '6696a0dc-71f9-4a98-bdb4-42d9dd989cb1',  # Delivery P10
}


# ---------- iComanda API ----------
def _get(params):
    qs = urllib.parse.urlencode(params)
    url = f'{API_URL}/detalhamento.php?{qs}'
    req = urllib.request.Request(url, headers={'Accept': 'application/json', 'User-Agent': 'tdb-robo-caixa/1.0'})
    with urllib.request.urlopen(req, timeout=120) as r:
        d = json.load(r)
    if d.get('status') != 'ok':
        raise RuntimeError(f'API status {d.get("status")}: {d.get("mensagem")}')
    return d


def caixas_do_dia(data):
    d = _get({'api_key': API_KEY, 'data_inicial': data, 'data_final': data, 'blocos': 'servicos_descontos'})
    return d.get('cabecalho', {}).get('caixas_selecionados') or []


def _dinheiro(fc):
    for f in (fc or {}).get('formas', []) or []:
        if 'inheiro' in (f.get('forma') or ''):
            return f
    return {}


def dados_caixa(data, caixa_ext):
    d = _get({'api_key': API_KEY, 'data_inicial': data, 'data_final': data,
              'caixa_ids': str(caixa_ext), 'blocos': 'servicos_descontos'})
    cab = d.get('cabecalho', {})
    unidade_nome = (cab.get('unidades') or [None])[0]
    unidade_id = UNIDADES.get(unidade_nome)
    fc = d.get('fechamento_caixa', {})
    din = _dinheiro(fc)
    # Faturado em dinheiro (bruto) = vendas em dinheiro; vira o recebimento no Caixa.
    vendas_din = 0.0
    for x in d.get('resumo_financeiro', []) or []:
        nome = x.get('nome') or ''
        if 'Faturado' in nome and 'inheiro' in nome:
            vendas_din = round(float(x.get('valor') or 0), 2)
            break
    conf = {
        'data': data, 'caixa_ext': caixa_ext,
        'unidade_nome': unidade_nome, 'unidade_id': unidade_id,
        'esperado': round(float(din.get('computado') or 0), 2),
        'contado_api': round(float(din.get('conferido') or 0), 2),
        'vendas_dinheiro': vendas_din,
    }
    mv = d.get('movimentacoes')
    arr = mv if isinstance(mv, list) else ((mv or {}).get('movimentacoes') if isinstance(mv, dict) else [])
    movs = []
    for m in (arr or []):
        tipo = m.get('tipo')
        if tipo not in ('pagamento', 'retirada_suprimento', 'sangria', 'suprimento'):
            continue
        valor = abs(float(m.get('valor_conferido') or m.get('valor_digitado') or 0))
        if valor <= 0.005:        # retiradas de suprimento vêm com valor 0 na API — descarta
            continue
        hora = ''
        mm = re.search(r'(\d{2}):(\d{2})', m.get('data') or '')
        if mm:
            hora = mm.group(0)
        movs.append({
            'movimentacao_ext': m.get('id'),
            'data': data, 'caixa_ext': caixa_ext,
            'unidade_nome': unidade_nome, 'unidade_id': unidade_id,
            'tipo': tipo, 'descricao': (m.get('descricao') or '').strip(),
            'valor': round(valor, 2), 'usuario': m.get('usuario'), 'hora': hora,
        })
    return conf, movs


# ---------- Supabase ----------
def _post(path, rows, conflict, merge=False):
    # merge=True atualiza as colunas enviadas (mantém contado_ajuste/confirmado/recebimento,
    # que não vão no payload); ignore = não mexe em linha já existente.
    resol = 'merge-duplicates' if merge else 'ignore-duplicates'
    for i in range(0, len(rows), 500):
        data = json.dumps(rows[i:i + 500]).encode()
        req = urllib.request.Request(
            f'{BASE}/{path}?on_conflict={conflict}', data=data, method='POST',
            headers={**HDR, 'Content-Type': 'application/json',
                     'Prefer': 'return=minimal,resolution=' + resol})
        urllib.request.urlopen(req, timeout=90)


def _conf_vazia():
    # Primeira carga (tabela vazia) → backfill completo desde START_DAT.
    try:
        req = urllib.request.Request(f'{BASE}/caixa_dia_conf?select=data&limit=1', headers={**HDR, 'Range': '0-0'})
        with urllib.request.urlopen(req, timeout=30) as r:
            return len(json.load(r)) == 0
    except Exception:
        return True


def datas_janela():
    hoje = datetime.now(timezone.utc).astimezone(timezone(timedelta(hours=-4))).date()
    piso = datetime.fromisoformat(START_DAT).date()
    if _conf_vazia():
        ini = piso
        print(f'Primeira carga: backfill desde {piso}.', flush=True)
    else:
        ini = hoje - timedelta(days=DAYS_BACK)
        if ini < piso:
            ini = piso
    out, d = [], ini
    while d <= hoje:
        out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def main():
    dias = datas_janela()
    if not dias:
        print('Nada a puxar (janela vazia).', flush=True)
        return
    print(f'Janela: {dias[0]} a {dias[-1]} ({len(dias)} dia(s)).', flush=True)
    tot_conf = tot_mov = 0
    for data in dias:
        try:
            caixas = caixas_do_dia(data)
        except Exception as e:
            print(f'  {data}: FALHA ao listar caixas ({type(e).__name__}: {e}) — pulando.', flush=True)
            continue
        confs, movs = [], []
        for cx in caixas:
            try:
                conf, ms = dados_caixa(data, cx)
            except Exception as e:
                print(f'    caixa {cx}: FALHA ({type(e).__name__}: {e}) — pulando.', flush=True)
                continue
            confs.append(conf)
            movs.extend(ms)
        if confs:
            _post('caixa_dia_conf', confs, 'data,caixa_ext', merge=True)
        movs = [m for m in movs if m.get('movimentacao_ext') is not None]
        if movs:
            _post('caixa_movimentos', movs, 'movimentacao_ext')
        tot_conf += len(confs); tot_mov += len(movs)
        pags = sum(1 for m in movs if m['tipo'] == 'pagamento')
        print(f'  {data}: {len(caixas)} caixas → {len(confs)} conferências, {len(movs)} movimentos ({pags} pagamentos).', flush=True)
    print(f'✅ Concluído: {tot_conf} conferências, {tot_mov} movimentos (idempotente).', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(f'ERRO: {type(e).__name__}: {e}', file=sys.stderr, flush=True)
        sys.exit(1)
