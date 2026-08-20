#!/usr/bin/env python3
"""
Robô PDV (iComanda) — puxa os pagamentos por transação da API do PDV
(detalhamento.php, bloco `comandas`) e grava em `pdv_vendas` no Supabase.
Substitui o import manual do "Relatório do PDV" — roda sozinho, sem clicar.

Idempotente: cada pagamento vira uma linha com id estável
(apipdv|<data>|c<comanda>|p<idx>); rodar de novo não duplica.

Cada pagamento sai marcado com o CAIXA que o registrou (caixa_ext, quem operou
e a loja). A comanda não traz isso; descobrimos filtrando por caixa_ids, uma
chamada por caixa (~4/dia), como o pull_caixa.py já fazia. É o que permite a
tela de Conciliação PDV mostrar as divergências separadas por caixa.

Fonte por transação validada = mesma granularidade da planilha manual
(forma + valor + hora por pagamento). A API não traz a bandeira por
transação (só "Crédito POS"/"Débito POS"); o motor de match cruza por
VALOR + janela de data, então a bandeira é só desempate — sem perda.

Variáveis de ambiente (GitHub Actions secrets):
  ICOMANDA_API_URL   (opcional; default abaixo)
  ICOMANDA_API_KEY   (opcional; default abaixo — a mesma chave read-only do dashboard)
  ICOMANDA_START_DATE(opcional; não puxa nada antes dessa data — evita colidir
                      com dias já importados na mão; default 2026-08-15)
  ICOMANDA_DAYS_BACK (opcional; janela retroativa que revisita dias já fechados; default 4)
  SUPABASE_URL, SUPABASE_SERVICE_KEY  (já usados pelo robô da Getnet)
Nunca coloque a service_key neste arquivo.
"""
import os, re, sys, json, urllib.request, urllib.parse
from datetime import datetime, timezone, timedelta

def env(nome, default=None, obrigatorio=False):
    # No GitHub Actions, um secret inexistente vira "" (não ausente) — trate vazio como default.
    v = (os.environ.get(nome) or '').strip()
    if not v:
        if obrigatorio:
            sys.exit(f'ERRO: variável {nome} não definida (configure o secret no GitHub).')
        return default
    return v

API_URL   = env('ICOMANDA_API_URL', 'https://cloud.icomanda.com/tdb/apidashboard').rstrip('/')
API_KEY   = env('ICOMANDA_API_KEY', 'apidash_249_aB3xY7zQ9Wm2KpV5')
START_DAT = env('ICOMANDA_START_DATE', '2026-08-14')
DAYS_BACK = int(env('ICOMANDA_DAYS_BACK', '4'))
SB_URL    = env('SUPABASE_URL', obrigatorio=True).rstrip('/')
SB_KEY    = env('SUPABASE_SERVICE_KEY', obrigatorio=True)
BASE      = f'{SB_URL}/rest/v1'
HDR       = {'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY}
MANAUS    = timezone(timedelta(hours=-4))

# Mesma tabela do pull_caixa.py — "filial" da API → unidade do financeiro.
UNIDADES = {
    'Tambaqui de Banda Loja Centro': 'e031eced-0652-4af0-ad2a-13b65a29f814',  # Tambaqui de Banda Teatro
    'Tdb - Parque 10':               '6696a0dc-71f9-4a98-bdb4-42d9dd989cb1',  # Delivery P10
}


# ---------- classificação de forma (mesma lógica do app: classificarFormaPDV) ----------
def classificar(forma):
    low = (forma or '').lower()
    def band():
        for k, v in (('master', 'Master'), ('visa', 'Visa'), ('elo', 'Elo'),
                     ('amex', 'Amex'), ('hiper', 'Hipercard'), ('diners', 'Diners')):
            if k in low:
                return v
        return None
    cred = 'crédito' in low or 'credito' in low
    deb  = 'débito'  in low or 'debito'  in low
    if (cred or deb) and ('cartão' in low or 'cartao' in low or 'pos' in low):
        return dict(grupo='cartao', modalidade='debito' if deb else 'credito', bandeira=band() or 'Outro')
    if low.strip().startswith('pix'):     return dict(grupo='pix', modalidade=None, bandeira=None)
    if 'ifood' in low:                    return dict(grupo='ifood', modalidade=None, bandeira=None)
    if 'dinheiro' in low:                 return dict(grupo='dinheiro', modalidade=None, bandeira=None)
    if 'cortesia' in low:                 return dict(grupo='cortesia', modalidade=None, bandeira=None)
    if 'conta assinada' in low:           return dict(grupo='conta_assinada', modalidade=None, bandeira=None)
    if re.search(r'alelo|sodexo|\bvr\b|ticket|voucher|vale', low):
        return dict(grupo='voucher', modalidade=None, bandeira=band())
    return dict(grupo='outro', modalidade=None, bandeira=None)


# ---------- iComanda API ----------
def _api(**extra):
    qs = urllib.parse.urlencode({'api_key': API_KEY, 'blocos': 'comandas', **extra})
    url = f'{API_URL}/detalhamento.php?{qs}'
    req = urllib.request.Request(url, headers={'Accept': 'application/json',
                                               'User-Agent': 'tdb-robo-pdv/1.0'})
    with urllib.request.urlopen(req, timeout=120) as r:
        d = json.load(r)
    if d.get('status') != 'ok':
        raise RuntimeError(f'API retornou status {d.get("status")}: {d.get("mensagem")}')
    return d


def buscar_dia(data):
    """Comandas do dia inteiro + a lista de caixas abertos nesse dia."""
    d = _api(data_inicial=data, data_final=data)
    comandas = (d.get('comandas') or {}).get('comandas') or []
    caixas = d.get('caixas') or []
    if not caixas:   # fallback: o cabeçalho traz ao menos os ids
        caixas = [{'caixa_id': c} for c in (d.get('cabecalho') or {}).get('caixas_selecionados') or []]
    return comandas, caixas


def mapa_caixa(data, caixas):
    """comanda_id → (caixa_id, usuário, filial). Uma chamada por caixa.

    A comanda não traz o caixa; o jeito de saber é filtrar por caixa_ids, como
    o pull_caixa.py já faz. Conferido em 20/08/2026: os caixas particionam o dia
    exatamente (272 comandas, união 272, nenhuma repetida em dois caixas).
    """
    mapa = {}
    for cx in caixas:
        cid = cx.get('caixa_id')
        if not cid:
            continue
        try:
            d = _api(data_inicial=data, data_final=data, caixa_ids=str(cid))
        except Exception as e:
            print(f'    caixa {cid}: FALHA ({type(e).__name__}) — vendas ficam sem caixa.', flush=True)
            continue
        for c in (d.get('comandas') or {}).get('comandas') or []:
            mapa.setdefault(c.get('comanda_id'), (cid, cx.get('usuario'), cx.get('filial')))
    return mapa


def montar_linhas(data, comandas, mapa=None):
    mapa = mapa or {}
    rows = []
    for c in comandas:
        if c.get('cancelada'):
            continue
        cid = c.get('comanda_id')
        caixa_ext, caixa_usuario, filial = mapa.get(cid, (None, None, None))
        for idx, p in enumerate(c.get('pagamentos') or []):
            valor = round(float(p.get('valor') or 0), 2)
            if valor <= 0:
                continue
            hora = (p.get('hora') or '').strip()          # "HH:MM"
            if not re.fullmatch(r'\d{2}:\d{2}', hora):
                hora = '00:00'
            cls = classificar(p.get('forma'))
            dh_local = f'{data}T{hora}:00'
            dt = datetime.fromisoformat(dh_local).replace(tzinfo=MANAUS)
            rows.append({
                'id_venda_externa': f'apipdv|{data}|c{cid}|p{idx}',
                'data_hora_local': f'{dh_local}-04:00',
                'data_hora_utc': dt.astimezone(timezone.utc).isoformat(),
                'valor_bruto': valor,
                'forma_pagamento': cls['grupo'],           # 'cartao' cruza com a Getnet
                'bandeira': cls['bandeira'],
                'status_conciliacao': 'pendente',
                'fonte': 'api_pdv',
                'caixa_ext': caixa_ext,
                'caixa_usuario': caixa_usuario,
                'unidade_nome': filial,
                'unidade_id': UNIDADES.get(filial),
                'raw': {'forma': p.get('forma'), 'modalidade': cls['modalidade'],
                        'hora': hora, 'comanda_id': cid},
            })
    return rows


# ---------- Supabase (upsert idempotente por id_venda_externa) ----------
def gravar(rows):
    if not rows:
        return
    for i in range(0, len(rows), 500):
        data = json.dumps(rows[i:i + 500]).encode()
        req = urllib.request.Request(
            f'{BASE}/pdv_vendas?on_conflict=id_venda_externa', data=data, method='POST',
            headers={**HDR, 'Content-Type': 'application/json',
                     'Prefer': 'return=minimal,resolution=ignore-duplicates'})
        urllib.request.urlopen(req, timeout=90)


def atualizar_caixa(rows):
    """Grava caixa/loja nas linhas que já existiam.

    O insert usa resolution=ignore-duplicates (não sobrescreve nada), então uma
    linha gravada antes desta mudança nunca receberia o caixa. Este PATCH toca
    SÓ as colunas de caixa/unidade — não encosta em valor, forma ou
    status_conciliacao.
    """
    grupos = {}
    for r in rows:
        if r.get('caixa_ext') is None:
            continue
        k = (r['caixa_ext'], r.get('caixa_usuario'), r.get('unidade_nome'), r.get('unidade_id'))
        grupos.setdefault(k, []).append(r['id_venda_externa'])
    tocadas = 0
    for (cx, usuario, uni_nome, uni_id), ids in grupos.items():
        corpo = json.dumps({'caixa_ext': cx, 'caixa_usuario': usuario,
                            'unidade_nome': uni_nome, 'unidade_id': uni_id}).encode()
        for i in range(0, len(ids), 150):
            lote = ids[i:i + 150]
            filtro = urllib.parse.urlencode({
                'id_venda_externa': 'in.(' + ','.join('"' + x + '"' for x in lote) + ')'})
            req = urllib.request.Request(
                f'{BASE}/pdv_vendas?{filtro}', data=corpo, method='PATCH',
                headers={**HDR, 'Content-Type': 'application/json', 'Prefer': 'return=minimal'})
            urllib.request.urlopen(req, timeout=90)
            tocadas += len(lote)
    return tocadas


def datas_janela():
    hoje = datetime.now(timezone.utc).astimezone(MANAUS).date()
    ini = hoje - timedelta(days=DAYS_BACK)
    piso = datetime.fromisoformat(START_DAT).date()
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
        print('Nada a puxar (janela vazia — antes de ICOMANDA_START_DATE).', flush=True)
        return
    print(f'Janela: {dias[0]} a {dias[-1]} ({len(dias)} dia(s)).', flush=True)
    total = 0
    for data in dias:
        try:
            comandas, caixas = buscar_dia(data)
        except Exception as e:
            print(f'  {data}: FALHA na API ({type(e).__name__}: {e}) — pulando.', flush=True)
            continue
        mapa = mapa_caixa(data, caixas)
        rows = montar_linhas(data, comandas, mapa)
        gravar(rows)
        atualizar_caixa(rows)
        total += len(rows)
        sem = sum(1 for r in rows if r.get('caixa_ext') is None)
        aviso = f' ⚠️ {sem} sem caixa' if sem else ''
        print(f'  {data}: {len(comandas)} comandas em {len(caixas)} caixa(s) → '
              f'{len(rows)} pagamentos.{aviso}', flush=True)
    print(f'✅ Concluído: {total} pagamentos processados (idempotente, sem duplicar).', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(f'ERRO: {type(e).__name__}: {e}', file=sys.stderr, flush=True)
        sys.exit(1)
