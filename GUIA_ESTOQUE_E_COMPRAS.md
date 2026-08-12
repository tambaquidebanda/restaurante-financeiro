# GUIA COMPLETO — Sistema de Estoque e Compras
## Tambaqui de Banda

---

## VISÃO GERAL

Vamos criar um **novo sistema** (Estoque + Compras) que se comunica com o **sistema financeiro** que já existe.

```
┌─────────────────────┐        ┌──────────────────────────┐
│  FINANCEIRO         │        │  ESTOQUE & COMPRAS       │
│  (já existe)        │◄──────►│  (novo projeto)          │
│                     │        │                          │
│  Lançamentos        │        │  Inventário              │
│  Bancos             │        │  Compras                 │
│  Contas a Pagar     │        │  Ficha Técnica           │
│  Relatórios         │        │  Baixa de Vendas         │
└─────────────────────┘        └──────────────────────────┘
         │                                  │
         └──────────── SUPABASE ────────────┘
                   (mesmo projeto)
```

**Por que usar o mesmo Supabase?**
Para que os dois sistemas conversem automaticamente. Por exemplo:
- Uma compra de insumo no sistema de estoque → gera automaticamente uma Conta a Pagar no financeiro
- Uma venda baixada no estoque → gera uma receita no financeiro

---

## PARTE 1 — GITHUB (Novo Repositório)

### Passo 1 — Wagner cria o repositório novo

1. Acesse [github.com](https://github.com) e faça login
2. Clique no botão verde **"New"** (canto superior esquerdo)
3. Preencha:
   - **Repository name:** `estoque-compras-restaurante`
   - **Description:** Sistema de estoque e compras - Tambaqui de Banda
   - Marque: **Public** (ou Private, sua escolha)
   - Marque: ✅ **Add a README file**
4. Clique em **"Create repository"**

---

### Passo 2 — Adicionar o desenvolvedor como colaborador

1. Dentro do repositório novo, clique em **Settings**
2. No menu lateral, clique em **Collaborators**
3. Clique em **"Add people"**
4. Digite o nome de usuário do GitHub do desenvolvedor
5. Clique em **"Add [nome] to this repository"**
6. O desenvolvedor receberá um e-mail de convite — ele precisa **aceitar**

---

### Passo 3 — Cada um baixa o projeto no computador

**Wagner (você):**
1. Na página do repositório, clique no botão verde **"Code"**
2. Clique em **"Download ZIP"**
3. Extraia a pasta no seu computador
4. Trabalhe nos arquivos normalmente

**Desenvolvedor:**
Como ele tem mais experiência, vai usar o comando `git clone` no terminal.
Passe o link do repositório para ele.

---

### Como enviar alterações ao GitHub (os dois fazem igual)

Sempre que terminar uma parte:
1. Abra o repositório no GitHub pelo navegador
2. Arraste os arquivos alterados para a página (ou use o botão de upload)
3. Escreva uma mensagem descrevendo o que fez (ex: "Adicionei módulo de ficha técnica")
4. Clique em **"Commit changes"**

**Regra importante:** Antes de começar a trabalhar, avise o desenvolvedor.
Antes de enviar, baixe a versão mais recente do GitHub.

---

## PARTE 2 — SUPABASE (Mesmo Projeto)

### Importante: NÃO criar um projeto novo

O sistema de estoque usará o **mesmo projeto Supabase** do financeiro.
Assim os dados se comunicam automaticamente.

**URL e Chave:** As mesmas do sistema financeiro.

---

### Convenção de nomes das tabelas

Para organizar e evitar confusão, cada sistema usa um prefixo:

| Sistema | Prefixo | Exemplo |
|---------|---------|---------|
| Financeiro (existente) | *(sem prefixo)* | `lancamentos`, `bancos` |
| Estoque | `est_` | `est_produtos`, `est_movimentacoes` |
| Compras | `cmp_` | `cmp_pedidos`, `cmp_itens` |

---

### Tabelas compartilhadas (já existem no financeiro)

O sistema de estoque pode usar diretamente:

| Tabela | O que é |
|--------|---------|
| `fornecedores` | Cadastro de fornecedores |
| `unidades` | Unidades do restaurante |
| `perfis` | Usuários do sistema |
| `plano_contas` | Plano de contas financeiro |
| `bancos` | Bancos cadastrados |
| `lancamentos` | Lançamentos financeiros |

---

### SQL — Criar as tabelas novas no Supabase

Acesse o Supabase → SQL Editor → Cole e execute cada bloco abaixo:

---

#### ETAPA 1 — Tabelas de Estoque (responsável: Desenvolvedor)

```sql
-- Produtos / Insumos
CREATE TABLE IF NOT EXISTS est_produtos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text NOT NULL,
  unidade_medida text NOT NULL,
  categoria text,
  estoque_atual decimal(10,3) DEFAULT 0,
  estoque_minimo decimal(10,3) DEFAULT 0,
  custo_unitario decimal(10,2) DEFAULT 0,
  ativo boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Movimentações de estoque (entradas e saídas)
CREATE TABLE IF NOT EXISTS est_movimentacoes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  produto_id uuid REFERENCES est_produtos(id),
  tipo text NOT NULL CHECK (tipo IN ('entrada','saida','ajuste')),
  quantidade decimal(10,3) NOT NULL,
  custo_unitario decimal(10,2),
  motivo text,
  lancamento_id uuid REFERENCES lancamentos(id),
  data_movimentacao date NOT NULL DEFAULT CURRENT_DATE,
  usuario_id uuid REFERENCES perfis(id),
  created_at timestamptz DEFAULT now()
);

-- Habilitar segurança
ALTER TABLE est_produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE est_movimentacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Acesso autenticado" ON est_produtos FOR ALL TO authenticated USING (true);
CREATE POLICY "Acesso autenticado" ON est_movimentacoes FOR ALL TO authenticated USING (true);
```

---

#### ETAPA 2 — Tabelas de Compras (responsável: Desenvolvedor)

```sql
-- Pedidos de compra
CREATE TABLE IF NOT EXISTS cmp_pedidos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  fornecedor_id uuid REFERENCES fornecedores(id),
  numero_pedido text,
  data_pedido date NOT NULL DEFAULT CURRENT_DATE,
  data_entrega_prevista date,
  data_entrega_real date,
  status text DEFAULT 'pendente' CHECK (status IN ('pendente','recebido','cancelado')),
  total decimal(10,2) DEFAULT 0,
  observacoes text,
  lancamento_id uuid REFERENCES lancamentos(id),
  created_at timestamptz DEFAULT now()
);

-- Itens dos pedidos
CREATE TABLE IF NOT EXISTS cmp_itens (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  pedido_id uuid REFERENCES cmp_pedidos(id) ON DELETE CASCADE,
  produto_id uuid REFERENCES est_produtos(id),
  quantidade decimal(10,3) NOT NULL,
  custo_unitario decimal(10,2) NOT NULL,
  total decimal(10,2) GENERATED ALWAYS AS (quantidade * custo_unitario) STORED,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE cmp_pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE cmp_itens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Acesso autenticado" ON cmp_pedidos FOR ALL TO authenticated USING (true);
CREATE POLICY "Acesso autenticado" ON cmp_itens FOR ALL TO authenticated USING (true);
```

---

#### ETAPA 3 — Tabelas de Ficha Técnica e Vendas (responsável: Wagner)

```sql
-- Fichas técnicas (receitas dos pratos)
CREATE TABLE IF NOT EXISTS est_fichas_tecnicas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text NOT NULL,
  categoria text,
  rendimento decimal(10,3) DEFAULT 1,
  unidade_rendimento text DEFAULT 'porção',
  custo_total decimal(10,2) DEFAULT 0,
  preco_venda decimal(10,2),
  ativo boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Ingredientes de cada ficha técnica
CREATE TABLE IF NOT EXISTS est_ficha_ingredientes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  ficha_id uuid REFERENCES est_fichas_tecnicas(id) ON DELETE CASCADE,
  produto_id uuid REFERENCES est_produtos(id),
  quantidade decimal(10,4) NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Registro de vendas (baixa automática do estoque)
CREATE TABLE IF NOT EXISTS est_vendas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  data_venda date NOT NULL DEFAULT CURRENT_DATE,
  origem text DEFAULT 'manual' CHECK (origem IN ('manual','importacao')),
  total_vendas decimal(10,2) DEFAULT 0,
  observacoes text,
  lancamento_id uuid REFERENCES lancamentos(id),
  created_at timestamptz DEFAULT now()
);

-- Itens vendidos por ficha técnica
CREATE TABLE IF NOT EXISTS est_venda_itens (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  venda_id uuid REFERENCES est_vendas(id) ON DELETE CASCADE,
  ficha_id uuid REFERENCES est_fichas_tecnicas(id),
  quantidade decimal(10,3) NOT NULL,
  total decimal(10,2),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE est_fichas_tecnicas ENABLE ROW LEVEL SECURITY;
ALTER TABLE est_ficha_ingredientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE est_vendas ENABLE ROW LEVEL SECURITY;
ALTER TABLE est_venda_itens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Acesso autenticado" ON est_fichas_tecnicas FOR ALL TO authenticated USING (true);
CREATE POLICY "Acesso autenticado" ON est_ficha_ingredientes FOR ALL TO authenticated USING (true);
CREATE POLICY "Acesso autenticado" ON est_vendas FOR ALL TO authenticated USING (true);
CREATE POLICY "Acesso autenticado" ON est_venda_itens FOR ALL TO authenticated USING (true);
```

---

## PARTE 3 — DIVISÃO DO TRABALHO

### O que cada um desenvolve

| Módulo | Responsável | Arquivos |
|--------|-------------|---------|
| Cadastro de Produtos/Insumos | Desenvolvedor | `produtos.html`, `produtos.js` |
| Inventário / Movimentações | Desenvolvedor | `inventario.html`, `inventario.js` |
| Pedidos de Compra | Desenvolvedor | `compras.html`, `compras.js` |
| Ficha Técnica | Wagner + Claude | `ficha-tecnica.html`, `ficha-tecnica.js` |
| Baixa de Vendas | Wagner + Claude | `vendas.html`, `vendas.js` |
| Tela principal / menu | Desenvolvedor | `index.html`, `style.css` |

---

## PARTE 4 — COMO OS SISTEMAS SE COMUNICAM

### Comunicação automática Estoque ↔ Financeiro

| Ação no Estoque | O que acontece no Financeiro |
|----------------|------------------------------|
| Pedido de compra recebido | Cria automaticamente uma Conta a Pagar |
| Venda registrada | Cria automaticamente uma Receita |

Isso é feito via código: quando uma compra é confirmada, o sistema cria um registro na tabela `lancamentos` do financeiro automaticamente.

### Dados compartilhados

- **Fornecedores:** cadastrados uma vez no financeiro, usados em ambos
- **Usuários:** o mesmo login serve para os dois sistemas
- **Unidades:** as mesmas do financeiro

---

## PARTE 5 — FLUXO DE TRABALHO EM EQUIPE

### Regras para trabalhar sem conflito

1. **Antes de começar:** avise no WhatsApp que vai começar a mexer em qual parte
2. **Ao terminar:** envie para o GitHub e avise que terminou
3. **Antes de começar uma sessão nova:** baixe a versão mais recente do GitHub
4. **Nunca mexa no mesmo arquivo ao mesmo tempo**

### Sugestão de divisão de dias

| Dia | Wagner | Desenvolvedor |
|-----|--------|---------------|
| Início | Ficha Técnica | Cadastro de Produtos |
| Meio | Baixa de Vendas | Inventário + Compras |
| Fim | Testes | Testes |
| Final | Combinar no GitHub | Combinar no GitHub |

---

## RESUMO — CHECKLIST DE INÍCIO

**Wagner faz:**
- [ ] Criar repositório no GitHub (`estoque-compras-restaurante`)
- [ ] Adicionar desenvolvedor como colaborador
- [ ] Rodar SQL ETAPA 1, 2 e 3 no Supabase
- [ ] Compartilhar este guia com o desenvolvedor

**Desenvolvedor faz:**
- [ ] Aceitar convite do GitHub
- [ ] Clonar o repositório
- [ ] Confirmar que o SQL foi rodado corretamente
- [ ] Iniciar os módulos dele (Produtos, Inventário, Compras)

**Wagner (com Claude):**
- [ ] Iniciar módulo de Ficha Técnica
- [ ] Iniciar módulo de Baixa de Vendas

---

*Gerado para o projeto Tambaqui de Banda — 2026-06-01*
