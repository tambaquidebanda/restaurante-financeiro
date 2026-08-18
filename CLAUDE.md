# Sistema Financeiro — Tambaqui de Banda

App web (HTML/CSS/JS puro) + Supabase + GitHub Pages.
Arquivos principais: `index.html`, `app.js`, `style.css`, `supabase.js`.
Robôs em `scripts/*.py`, agendados por `.github/workflows/*.yml`.

---

## ⚠️ ATENÇÃO: Supabase compartilhado com o sistema de Estoque/Compras

Este projeto e o repositório **`tambaquidebanda/estoque-compras`**
(`~/Documents/GitHub/estoque-compras`) usam **o MESMO projeto Supabase**
(`pwmpqdaaogrrdlqxcqev`), com a mesma URL e a mesma chave anon.

Não existe separação por schema nem por RLS — todas as tabelas ficam em `public`
e a política é `FOR ALL USING (true)`. **A fronteira entre os dois sistemas é
apenas convenção de nome.** Antes de criar, renomear ou dropar qualquer tabela,
confira as listas abaixo.

Regra geral de nomes (decidida em 2026-05-29):
- Tabelas antigas do financeiro **não têm prefixo** e **não serão renomeadas**
  (há centenas de `.from('lancamentos')` etc. no `app.js`).
- Sistemas novos usam prefixo desde o início: `cmp_` (compras), `est_` (estoque),
  `inv_` (inventário/config), `rh_` (RH, futuro).
- Tabelas realmente comuns (`unidades`, `perfis`) ficam sem prefixo.

---

## 1. Tabelas EXCLUSIVAS do financeiro

Nenhuma delas é lida ou escrita pelo estoque-compras (verificado por grep no
repositório do estoque — zero ocorrências).

**Cadastros e núcleo**
- `bancos` — contas bancárias
- `orcamentos` — orçamento por conta/mês
- `centros_custo`
- `formas_pagamento`
- `pagamentos` — baixas/pagamentos parciais de um lançamento
- `classificacao_historica` — memória de auto-classificação do importador

**Conciliação bancária / OFX**
- `conc_conciliacoes`

**Conciliação de cartão (Getnet)**
- `card_transacoes` — vendas transacionais da Getnet
- `card_lotes_pagamento` — lotes de liquidação
- `card_taxas` — taxas por modalidade

**PDV / Caixa (iComanda)**
- `pdv_vendas` — vendas importadas do PDV
- `caixa_fechamentos` — fechamento por caixa
- `caixa_movimentos` — pagamentos e sangrias em dinheiro
- `caixa_dia_conf` — conferência esperado × contado do dinheiro

> ⚠️ Não confundir `pdv_vendas` (financeiro) com `pdv_map` (estoque — mapeamento
> de produto do PDV para baixa de estoque). São tabelas diferentes.

**Quem escreve nelas além do app:** os robôs em `scripts/` usam
`SUPABASE_SERVICE_KEY` (secret do GitHub Actions) e gravam em:
- `pull_pdv.py` → `pdv_vendas`
- `pull_caixa.py` → `caixa_dia_conf`, `caixa_movimentos`
- `pull_getnet.py` → `card_transacoes`, `card_lotes_pagamento`

---

## 2. Tabelas EXCLUSIVAS do estoque-compras

**Não mexer daqui.** Só toque nelas pelos pontos de integração da seção 4.

- `cmp_faturamento`, `cmp_categorias`, `cmp_tipos_produto`, `cmp_compradores`,
  `cmp_setores`, `cmp_devolucoes`, `cmp_devolucao_itens`
- `est_produtos`, `est_grupos_produto`, `est_saldo_local`, `est_movimentacoes`
- `est_fichas_tecnicas`, `est_ficha_ingredientes`
- `est_inventarios`, `est_inventario_itens`,
  `est_inventario_valorado`, `est_inventario_valorado_itens`
- `inv_configuracoes`
- `pedidos_internos`, `pedidos_internos_itens`
- `pdv_map`

---

## 3. Tabelas COMPARTILHADAS (os dois sistemas escrevem)

Alterar coluna aqui quebra o outro sistema. Sempre use
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — nunca renomeie nem remova coluna
sem checar o `app.js` do estoque.

| Tabela | Financeiro | Estoque-compras |
|---|---|---|
| `lancamentos` | **dono** — CRUD completo, é o coração do sistema | insert / update / select / delete (gera conta a pagar do pedido, corrige valor pela NF) |
| `rateio_itens` | **dono** — CRUD (ON DELETE CASCADE de `lancamentos`) | insert (rateio do pedido de compra) |
| `fornecedores` | **dono** — CRUD completo | select + insert (cadastra fornecedor novo na compra) |
| `plano_contas` | **dono** — CRUD (campo `is_cmv`) | somente leitura |
| `unidades` | **dono** — CRUD | somente leitura |
| `centros_custo`, `formas_pagamento` | **dono** — CRUD | não usa |
| `transferencias` | **dono** — CRUD | insert (converte lançamento em transferência) |
| `perfis` | leitura (controle de acesso) | não usa |
| `lancamentos_rascunho` | select + delete (aprovar/rejeitar) | insert + select + delete (Modo Teste) |
| `rascunho_rateio_itens` | select | insert |

### Campos de `lancamentos` que o estoque preenche
`descricao`, `valor`, `vencimento`, `tipo`, `status`, `fornecedor_id`,
`plano_conta_id`, `numero_pedido`, `observacoes`, `acrescimo`, `desconto`,
`tem_rateio`, `unidade_id`.

O vínculo pedido ↔ lançamento é feito por **`lancamentos.numero_pedido` =
`cmp_compras.pedido_num`** (e, como fallback, pela descrição `Pedido #XXXXX`).
Se você mexer em `numero_pedido` ou no formato da descrição, quebra as travas
anti-duplicata do estoque (`app.js` do estoque, ~linhas 5451, 8384).

---

## 4. Pontos de integração (fluxos que atravessam a fronteira)

### 4.1 Estoque → Financeiro: rascunhos ("Integrações Pendentes")
Tabelas: `lancamentos_rascunho` + `rascunho_rateio_itens`.

1. No estoque, ao gerar a conta a pagar em **Modo Teste**, ele insere em
   `lancamentos_rascunho` (espelho de `lancamentos`, com `pedido_num` e
   `conta_id` → `cmp_contas_pagar`).
2. Aqui no financeiro, a tela **Integrações Pendentes** lê esses rascunhos
   (`carregarIntegracoes()`, `app.js:9408+`; badge `#badge-integracoes`).
3. Ao aprovar, o financeiro cria o `lancamentos` real, grava `rateio_itens`,
   escreve `lancamento_id` de volta em `cmp_contas_pagar` e **deleta o rascunho**.
4. Ao rejeitar, só deleta o rascunho.

Em **modo produção** o estoque pula o rascunho e insere direto em `lancamentos`.

### 4.2 Financeiro → Estoque: escritas de volta em tabelas `cmp_`
O `app.js` daqui grava nestas tabelas do estoque (só nestes casos):

- `cmp_contas_pagar` — `update` de `lancamento_id` e
  `adiantamento_lancamento_id` (marca "já enviado ao financeiro", o que bloqueia
  segunda geração lá); `delete` ao desfazer um pedido.
- `cmp_compras` — `select` e `update` de `status_receb` (volta para `'pendente'`
  quando o pedido é desfeito).
- `cmp_recebimentos` / `cmp_recebimento_itens` — `select` e `delete` no
  desfazimento do pedido.

Referências: `app.js:7360`, `9451`, `9688`, `9823–9956`.

### 4.3 Contrato de colunas criadas pelo estoque
Definidas em `SQL_INTEGRACAO_FINANCEIRO.sql` e `SQL_RASCUNHO_FINANCEIRO.sql`
(no repositório do estoque):
- `cmp_contas_pagar.lancamento_id`, `.adiantamento_lancamento_id`, `.nf_numero`
- `lancamentos_rascunho` (tabela inteira)

---

## 5. Checklist antes de mexer no banco

1. A tabela está na seção 2 (só do estoque)? → **não mexa aqui**; peça na sessão
   do estoque-compras.
2. A tabela está na seção 3 (compartilhada)? → só `ADD COLUMN IF NOT EXISTS`.
   Se precisar remover/renomear, avise a outra sessão antes.
3. Vai criar tabela nova para o financeiro? → sem prefixo se for do núcleo, ou
   com prefixo temático coerente (`card_`, `caixa_`, `conc_`, `pdv_`).
4. RLS: todas as tabelas usam `FOR ALL USING (true)` para `authenticated`/anon.
   Manter o padrão para não quebrar o outro sistema.

---

## 6. Armadilhas conhecidas (não reintroduzir)

- Use `supabaseClient`, **nunca** `supabase` — conflita com `window.supabase` do CDN.
- Validação de chave aceita `eyJ...` **e** `sb_publishable_...`.
- SQL entregue ao usuário não pode ter marcadores markdown (` ```sql `).
- Sessão: `visibilitychange` e `garantirSessao()` já foram corrigidos para não
  derrubar a sessão à toa (fix de 2026-06-01). Não reverter.
- `supabase.js` contém `SB_SERVICE_KEY` (service_role) **em arquivo público no
  GitHub Pages** — usado em `app.js:7445, 7525, 7567` para operações de admin de
  usuários. Isso dá acesso total ao banco a quem abrir o site. Pendência de
  segurança conhecida; não espalhar o uso dessa chave para mais lugares.

---

## 7. Convenções do projeto

- Usuário é leigo em programação: explicar em linguagem simples, passo a passo.
- **Sempre listar quais arquivos serão alterados antes de mexer.**
- Deploy: GitHub Desktop → push na `main` → GitHub Pages publica sozinho.
- `.gitignore` exclui `*.xlsx`, `*.xls`, `*.pdf`, `*.ofx`, `*.json`, `*.sql` e
  `*.py` (exceto `scripts/pull_*.py`) — planilhas e SQL de diagnóstico ficam só
  na máquina.
