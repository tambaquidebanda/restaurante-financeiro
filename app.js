// =========================================================
// SISTEMA FINANCEIRO DO RESTAURANTE v3
// =========================================================

let _appInicializado  = false; // guard: impede que onAuthStateChange recarregue o app durante uso
let unidades          = [];
let planoContas       = [];
let bancosCadastrados = [];
let fornecedores      = [];
let centrosCusto      = [];
let formasPagamento   = [];
let idParaExcluir     = null;
let fnExcluirAtual    = null;
let transacoesOFX          = [];
let lancamentosPendentes   = [];
let tabPlanoAtiva     = 'pagar';
let planoGrupoIdModal = null;
let rateioAtualPagar  = [];

let classificacaoHistorica = new Map(); // descricao_norm → plano_conta_id
let _hpCtx = { lancamentoId: null, tipo: null }; // contexto do modal Histórico de Pagamentos

let graficoCategoriasInst          = null;
let graficoMensalInst              = null;

// Dados e estado de ordenação das tabelas
let dadosLancamentos = { pagar: [], receber: [] };
let sortEstado = {
  pagar:   { col: 'vencimento', dir: 'asc' },
  receber: { col: 'vencimento', dir: 'asc' }
};
let graficoRelatorioMensalInst     = null;
let graficoRelatorioCategoriasInst = null;
let graficoRelatorioReceitasInst   = null;

let biPeriodoAtual      = 'mes';
let biChartMensal       = null;
let biChartFluxo        = null;
let biChartFornecedores = null;
let biChartOrcado       = null;

// =========================================================
// UTILITÁRIO DE PAGINAÇÃO SUPABASE
// Busca todos os registros em blocos de 1.000 para contornar
// o limite padrão de linhas do PostgREST/Supabase.
// Uso: const dados = await fetchTodosPag((de, ate) =>
//        db.from('tabela').select('...').filtros().range(de, ate));
// =========================================================
async function fetchTodosPag(queryFn) {
  const PAGE = 1000;
  let todos = [], pagina = 0;
  while (true) {
    const { data: lote, error } = await queryFn(pagina * PAGE, (pagina + 1) * PAGE - 1);
    if (error || !lote || lote.length === 0) break;
    todos = todos.concat(lote);
    if (lote.length < PAGE) break;
    pagina++;
  }
  return todos;
}

// =========================================================
// MÁSCARA DE MOEDA
// =========================================================
function mascaraMoedaRealtime(el) {
  let digits = el.value.replace(/\D/g, '');
  if (!digits) { el.value = ''; return; }
  digits = digits.replace(/^0+/, '') || '0';
  while (digits.length < 3) digits = '0' + digits;
  const cents   = digits.slice(-2);
  const intPart = digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  el.value = `${intPart},${cents}`;
}

function mascaraMoeda(el) {
  const num = parseMoeda(el.value);
  el.value = num > 0
    ? num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '';
}

function focarInputMoeda(el) {
  setTimeout(() => el.select(), 0);
}

function parseMoeda(str) {
  if (!str && str !== 0) return 0;
  return parseFloat(String(str).replace(/\./g, '').replace(',', '.')) || 0;
}

function setValorMoeda(id, valor) {
  const el = document.getElementById(id);
  if (!el) return;
  const num = Number(valor) || 0;
  el.value = num > 0
    ? num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '';
}

document.addEventListener('input', e => { if (e.target.classList.contains('input-moeda')) mascaraMoedaRealtime(e.target); }, true);
document.addEventListener('blur',  e => { if (e.target.classList.contains('input-moeda')) mascaraMoeda(e.target); },  true);
document.addEventListener('focus', e => { if (e.target.classList.contains('input-moeda')) focarInputMoeda(e.target); }, true);
document.addEventListener('click', e => {
  if (!e.target.closest('.filtro-banco-wrapper')) {
    document.querySelectorAll('.filtro-banco-dropdown').forEach(d => d.style.display = 'none');
  }
  if (!e.target.closest('.dropdown-multi')) {
    document.querySelectorAll('[id^="concil-drop-"]').forEach(d => d.classList.add('hidden'));
    document.getElementById('dre-drop-unidades')?.classList.add('hidden');
  }
  if (!e.target.closest('#integ-forn-wrapper')) {
    const drop = document.getElementById('integ-forn-dropdown');
    if (drop) drop.style.display = 'none';
  }
});

// Verifica se o erro é de sessão expirada e redireciona para login
function tratarErro(error, contexto) {
  if (!error) return false;
  const msg = (error.message || '').toLowerCase();
  const isAuth = msg.includes('jwt') || msg.includes('expired') || msg.includes('invalid claim')
    || msg.includes('unauthorized') || error.code === 'PGRST301';
  if (isAuth) {
    mostrarToast('Sessão expirada. Faça login novamente.', 'erro');
    setTimeout(() => mostrarTela('login'), 1500);
  } else {
    mostrarToast((contexto || 'Erro') + ': ' + error.message, 'erro');
  }
  return true;
}

// =========================================================
// INICIALIZAÇÃO
// =========================================================
window.addEventListener('DOMContentLoaded', async () => {
  try {
    inicializarSupabase(SB_URL, SB_KEY);
  } catch (e) {
    console.error('Erro ao inicializar Supabase:', e);
    mostrarTela('login');
    return;
  }

  try {
    const sessao = await obterSessao();
    if (sessao) {
      await iniciarApp(sessao.user);
    } else {
      mostrarTela('login');
    }
  } catch (e) {
    console.error('Erro ao verificar sessão:', e);
    mostrarTela('login');
  }

  const db = obterSupabase();
  if (db) {
    db.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESH_FAILED') {
        _appInicializado = false;
        mostrarToast('Sessão encerrada. Faça login novamente.', 'erro');
        setTimeout(() => mostrarTela('login'), 1500);
      } else if (event === 'SIGNED_IN' && session && !_appInicializado) {
        await iniciarApp(session.user);
      }
    });
  }

  // Ao voltar para a aba/app, verifica sessão sem forçar refresh desnecessário
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    if (document.getElementById('app')?.classList.contains('hidden')) return;
    try {
      const { data: { session } } = await obterSupabase().auth.getSession();
      if (!session) {
        mostrarToast('Sessão expirada. Faça login novamente.', 'erro');
        setTimeout(() => mostrarTela('login'), 1500);
        return;
      }
      // Só renova se o token já expirou — o SDK cuida do refresh automático
      const agora = Math.floor(Date.now() / 1000);
      if (session.expires_at < agora) {
        const { data: { session: s2 } } = await obterSupabase().auth.refreshSession();
        if (!s2) {
          mostrarToast('Sessão expirada. Faça login novamente.', 'erro');
          setTimeout(() => mostrarTela('login'), 1500);
        }
      }
    } catch (e) {}
  });

  // Renova o token a cada 15 minutos para não expirar durante o uso
  setInterval(async () => {
    if (document.getElementById('app')?.classList.contains('hidden')) return;
    try { await obterSupabase().auth.refreshSession(); } catch (e) {}
  }, 15 * 60 * 1000);
});

function mostrarTela(tela) {
  document.getElementById('tela-config').classList.add('hidden');
  document.getElementById('tela-login').classList.add('hidden');
  document.getElementById('app').classList.add('hidden');
  if (tela === 'config') document.getElementById('tela-config').classList.remove('hidden');
  if (tela === 'login')  document.getElementById('tela-login').classList.remove('hidden');
  if (tela === 'app')    document.getElementById('app').classList.remove('hidden');
}

function q(promise, ms = 15000) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('Tempo esgotado. Verifique sua conexão e tente novamente.')), ms))
  ]);
}

async function garantirSessao() {
  const db = obterSupabase();
  try {
    const timeout8s = ms => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));
    const { data: { session } } = await Promise.race([db.auth.getSession(), timeout8s(8000)]);
    if (session) {
      const agora = Math.floor(Date.now() / 1000);
      // Token ainda válido — SDK renova automaticamente em background
      if (session.expires_at > agora) return true;
      // Token já expirou — tenta renovar agora
      const { data: { session: s2 } } = await Promise.race([db.auth.refreshSession(), timeout8s(8000)]);
      if (s2) return true;
    }
  } catch (e) {}
  mostrarToast('Sua sessão expirou. Faça login novamente.', 'erro');
  setTimeout(() => mostrarTela('login'), 1500);
  return false;
}

async function iniciarApp(usuario) {
  _appInicializado = true;
  // Verifica permissão — bloqueia se sistemas estiver definido e não incluir 'financeiro'
  const sistemas = usuario.user_metadata?.sistemas;
  if (sistemas && !sistemas.includes('financeiro')) {
    _appInicializado = false;
    await fazerLogout();
    mostrarToast('Você não tem acesso ao sistema Financeiro.', 'erro');
    setTimeout(() => mostrarTela('login'), 1500);
    return;
  }

  mostrarTela('app');
  verificarIntegracoesPendentes();
  const nome = usuario.user_metadata?.nome || usuario.email.split('@')[0];
  document.getElementById('nome-usuario-sidebar').textContent = nome;

  await carregarUnidades();
  await carregarPlanoContas();
  await carregarBancosCadastrados();
  await carregarFornecedores();
  await carregarClassificacaoHistorica();
  await carregarCentrosCusto();
  await carregarFormasPagamento();
  preencherFiltrosMes();
  preencherFiltrosAno();
  preencherFiltrosAnoOrcamento();
  preencherMesOrcamentoAtual();
  preencherFiltrosMesTransferencias();

  const paginasValidas = ['inicio','dashboard','pagar','receber','plano-contas','unidades','bancos',
    'fornecedores','centros-custo','formas-pagamento','transferencias','orcamento',
    'relatorios','dre','usuarios','importar','configuracoes','conciliacao'];
  const hashPagina = window.location.hash.replace('#', '');
  const paginaInicial = paginasValidas.includes(hashPagina) ? hashPagina : 'inicio';
  irPara(paginaInicial);

  // Renova a sessão automaticamente a cada 4 minutos para evitar expiração por inatividade
  setInterval(async () => {
    const sessao = await obterSessao();
    if (!sessao) {
      mostrarToast('Sessão encerrada. Faça login novamente.', 'erro');
      setTimeout(() => mostrarTela('login'), 1500);
    }
  }, 4 * 60 * 1000);

}

// =========================================================
// MÚLTIPLAS NFs — Contas a Pagar
// =========================================================
function adicionarCampoNF() {
  const container = document.getElementById('pagar-nfs-container');
  if (!container) return;
  const linha = document.createElement('div');
  linha.className = 'nf-linha';
  linha.innerHTML = `<input type="text" class="pagar-nf-input" placeholder="Ex: NF 00124" />
    <button type="button" class="btn-nf-rem" onclick="removerCampoNF(this)" title="Remover NF">
      <i class="fas fa-times"></i>
    </button>`;
  container.appendChild(linha);
  linha.querySelector('input').focus();
}

function removerCampoNF(btn) {
  btn.closest('.nf-linha').remove();
}

function obterNFsPagar() {
  return [...document.querySelectorAll('#pagar-nfs-container .pagar-nf-input')]
    .map(i => i.value.trim()).filter(v => v).join(', ');
}

function preencherNFsPagar(valor) {
  const container = document.getElementById('pagar-nfs-container');
  if (!container) return;
  // Remove linhas extras (mantém só a primeira)
  [...container.querySelectorAll('.nf-linha')].slice(1).forEach(l => l.remove());
  const primeiro = document.getElementById('pagar-numero-pedido');
  if (!valor) { if (primeiro) primeiro.value = ''; return; }
  const nfs = valor.split(',').map(v => v.trim()).filter(v => v);
  if (primeiro) primeiro.value = nfs[0] || '';
  nfs.slice(1).forEach(nf => {
    adicionarCampoNF();
    const inputs = container.querySelectorAll('.pagar-nf-input');
    inputs[inputs.length - 1].value = nf;
  });
}

// =========================================================
// AUTO-REFRESH — Contas a Pagar / Receber
// Atualiza automaticamente a cada 30s, mas NUNCA interrompe
// o usuário se houver modal aberto, campo em foco ou
// interação recente (últimos 60s) ou página de importação.
// =========================================================

// =========================================================
// CONFIGURAÇÃO
// =========================================================
async function salvarConfig() {
  const url = document.getElementById('config-url').value.trim();
  const key = document.getElementById('config-key').value.trim();
  if (!url || !key) { mostrarToast('Preencha a URL e a Chave!', 'erro'); return; }

  if (!url.includes('supabase') || (!key.startsWith('eyJ') && !key.startsWith('sb_'))) {
    mostrarToast('URL ou Chave parecem inválidos. Verifique e tente novamente.', 'erro');
    return;
  }

  localStorage.setItem('sb_url', url);
  localStorage.setItem('sb_key', key);
  inicializarSupabase(url, key);
  mostrarTela('login');
}

function resetarConfig() {
  if (confirm('Isso vai desconectar do sistema. Deseja continuar?')) {
    localStorage.removeItem('sb_url');
    localStorage.removeItem('sb_key');
    location.reload();
  }
}

// =========================================================
// AUTENTICAÇÃO
// =========================================================
async function entrar() {
  const email = document.getElementById('login-email').value.trim();
  const senha = document.getElementById('login-senha').value;
  if (!email || !senha) { mostrarToast('Informe o e-mail e a senha!', 'erro'); return; }

  const btn = document.getElementById('btn-entrar');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Entrando...';

  const { error } = await fazerLogin(email, senha);

  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Entrar';

  tratarErro(error, 'Erro ao carregar');
}

async function sair() {
  if (confirm('Deseja sair do sistema?')) await fazerLogout();
}

// =========================================================
// NAVEGAÇÃO
// =========================================================
function irPara(pagina, elemento) {
  document.querySelectorAll('.pagina').forEach(p => p.classList.remove('ativa'));
  document.getElementById('pagina-' + pagina).classList.add('ativa');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('ativo'));
  if (elemento) elemento.classList.add('ativo');
  else {
    const link = document.querySelector(`.nav-item[onclick*="'${pagina}'"]`);
    if (link) link.classList.add('ativo');
  }
  document.querySelector('.sidebar').classList.remove('aberta');
  history.replaceState(null, '', '#' + pagina);

  if (pagina === 'inicio')            carregarInicio();
  if (pagina === 'dashboard')         carregarDashboard();
  if (pagina === 'pagar')            { preencherFiltrosLancamentos('pagar');   carregarLancamentos('pagar'); }
  if (pagina === 'receber')          { preencherFiltrosLancamentos('receber'); carregarLancamentos('receber'); }
  if (pagina === 'plano-contas')     renderizarPlanoContas();
  if (pagina === 'unidades')         renderizarUnidades();
  if (pagina === 'bancos')           renderizarBancos();
  if (pagina === 'fornecedores')     renderizarFornecedores();
  if (pagina === 'centros-custo')    renderizarCentrosCusto();
  if (pagina === 'formas-pagamento') renderizarFormasPagamento();
  if (pagina === 'taxas-cartao')     carregarTaxasCartao();
  if (pagina === 'transferencias')   carregarTransferencias();
  if (pagina === 'orcamento')        carregarOrcamentoModo();
  if (pagina === 'relatorios')       carregarRelatorio();
  if (pagina === 'dre')              carregarDre();
  if (pagina === 'ponte-caixa')      carregarPonteCaixa();
  if (pagina === 'usuarios')         carregarUsuarios();
  if (pagina === 'importar')         { preencherSelectBancoImportar(); carregarLancamentosPendentes(); }
  if (pagina === 'importar-getnet')  carregarImportarGetnet();
  if (pagina === 'importar-pdv')     carregarImportarPDV();
  if (pagina === 'conciliacao-cartao') carregarConciliacaoCartao();
  if (pagina === 'conciliacao')      { preencherFiltrosConciliacao(); carregarConciliacao(); }
  if (pagina === 'integracoes')      carregarIntegracoes();

  // Auto-expandir o grupo accordion correto
  const grupoNavPorPagina = {
    'pagar': 'gestao', 'receber': 'gestao', 'importar': 'gestao',
    'conciliacao': 'gestao', 'transferencias': 'gestao', 'orcamento': 'gestao', 'integracoes': 'gestao', 'importar-getnet': 'gestao', 'importar-pdv': 'gestao', 'conciliacao-cartao': 'gestao',
    'plano-contas': 'cadastros', 'unidades': 'cadastros', 'bancos': 'cadastros',
    'fornecedores': 'cadastros', 'centros-custo': 'cadastros', 'formas-pagamento': 'cadastros', 'taxas-cartao': 'cadastros',
    'dre': 'relatorios', 'ponte-caixa': 'relatorios', 'relatorios': 'relatorios',
    'usuarios': 'configuracoes', 'configuracoes': 'configuracoes'
  };
  if (grupoNavPorPagina[pagina]) expandirNavGrupo(grupoNavPorPagina[pagina]);

  return false;
}

function toggleSidebar() {
  document.querySelector('.sidebar').classList.toggle('aberta');
}

function toggleNavGrupo(id) {
  const grupo = document.getElementById(`grupo-${id}`);
  const itens = document.getElementById(`grupo-${id}-itens`);
  if (!grupo || !itens) return;
  const ativo = grupo.classList.toggle('ativo');
  itens.style.maxHeight = ativo ? itens.scrollHeight + 'px' : '0';
}

function expandirNavGrupo(id) {
  const grupo = document.getElementById(`grupo-${id}`);
  const itens = document.getElementById(`grupo-${id}-itens`);
  if (!grupo || !itens || grupo.classList.contains('ativo')) return;
  grupo.classList.add('ativo');
  itens.style.maxHeight = itens.scrollHeight + 'px';
}

// =========================================================
// CARREGAR DADOS BASE
// =========================================================
async function carregarUnidades() {
  const db = obterSupabase();
  const { data } = await q(db.from('unidades').select('*').order('nome'));
  unidades = data || [];

  ['filtro-unidade-dashboard','filtro-unidade-relatorio','filtro-unidade-orcamento'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '<option value="">Todas as unidades</option>' +
      unidades.map(u => `<option value="${u.id}">${u.nome}</option>`).join('');
  });

  renderizarUnidades();
  preencherSelectUnidadesPagar();
}

async function carregarPlanoContas() {
  const db = obterSupabase();
  const { data, error } = await q(db.from('plano_contas').select('*')
    .order('ordem', { ascending: true, nullsFirst: false })
    .order('nome'));
  if (error) { mostrarToast('Erro ao carregar plano de contas.', 'erro'); return; }
  planoContas = data || [];
  preencherSelectPlanoContas('pagar-plano-conta', 'pagar');
  preencherSelectPlanoContas('receber-plano-conta', 'receber');
  preencherSelectPlanoContas('modal-fornecedor-plano-conta', 'pagar');
}

async function carregarBancosCadastrados() {
  const db = obterSupabase();
  const { data, error } = await q(db.from('bancos').select('*').order('nome'));
  if (error) { mostrarToast('Erro ao carregar bancos.', 'erro'); return; }
  bancosCadastrados = data || [];
  preencherSelectBancos();
  preencherSelectBancosTransferencia();
}

async function carregarFornecedores() {
  const db = obterSupabase();
  const { data } = await q(db.from('fornecedores').select('*, plano_contas(nome)').order('nome'));
  fornecedores = data || [];
  preencherSelectFornecedores();
}

async function carregarClassificacaoHistorica() {
  const db = obterSupabase();
  const { data } = await q(db.from('classificacao_historica').select('descricao_norm,plano_conta_id'));
  classificacaoHistorica.clear();
  (data || []).forEach(r => classificacaoHistorica.set(r.descricao_norm, r.plano_conta_id));
}

async function carregarCentrosCusto() {
  const db = obterSupabase();
  const { data } = await q(db.from('centros_custo').select('*').order('nome'));
  centrosCusto = data || [];
  preencherSelectCentrosCusto();
}

async function carregarFormasPagamento() {
  const db = obterSupabase();
  const { data } = await q(db.from('formas_pagamento').select('*').order('nome'));
  formasPagamento = data || [];
  preencherSelectFormasPagamento();
}

function preencherSelectPlanoContas(idSelect, tipo) {
  const el = document.getElementById(idSelect);
  if (!el) return;
  const grupos  = planoContas.filter(p => p.tipo === tipo && !p.grupo_id);
  const subcats = planoContas.filter(p => p.tipo === tipo && p.grupo_id);
  el.innerHTML = '<option value="">Selecione a categoria...</option>';
  grupos.forEach(g => {
    const subs = subcats.filter(s => s.grupo_id === g.id);
    if (!subs.length) return;
    const og = document.createElement('optgroup');
    og.label = g.nome;
    subs.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id; opt.textContent = s.nome;
      og.appendChild(opt);
    });
    el.appendChild(og);
  });
}

function preencherSelectBancos() {
  ['pagar-banco','receber-banco'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '<option value="">Nenhum banco específico</option>' +
      bancosCadastrados.map(b => `<option value="${b.id}">${b.nome}${b.conta ? ' (' + b.conta + ')' : ''}</option>`).join('');
  });
  const selConcil = document.getElementById('rel-concil-banco');
  if (selConcil) {
    selConcil.innerHTML = '<option value="">Todos os bancos</option>' +
      bancosCadastrados.map(b => `<option value="${b.id}">${b.nome}${b.conta ? ' (' + b.conta + ')' : ''}</option>`).join('');
  }
}

function preencherSelectBancosTransferencia() {
  ['modal-transf-origem','modal-transf-destino'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '<option value="">Selecione...</option>' +
      bancosCadastrados.map(b => `<option value="${b.id}">${b.nome}${b.conta ? ' (' + b.conta + ')' : ''}</option>`).join('');
  });
  ['filtro-banco-origem-transf','filtro-banco-destino-transf'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const atual = el.value;
    el.innerHTML = '<option value="">Todos</option>' +
      bancosCadastrados.map(b => `<option value="${b.id}" ${b.id === atual ? 'selected' : ''}>${b.nome}</option>`).join('');
  });
}

function preencherSelectBancoImportar() {
  const el = document.getElementById('banco-importar');
  if (!el) return;
  el.innerHTML = '<option value="">Selecione o banco...</option>' +
    bancosCadastrados.map(b => `<option value="${b.id}">${b.nome}${b.conta ? ' (' + b.conta + ')' : ''}</option>`).join('');
}

async function carregarLancamentosPendentes() {
  try { await obterSupabase().auth.refreshSession(); } catch (e) {}
  const db = obterSupabase();
  // Busca paginada — PostgREST corta em 1.000 linhas por resposta.
  // Sem isso, contas pendentes recentes ficavam de fora da conciliação
  // (auto-match não achava e o dropdown não listava) → gerava duplicata.
  const PAGE = 1000;
  let todos = [], pagina = 0;
  try {
    while (true) {
      const resultado = await Promise.race([
        db.from('lancamentos')
          .select('id, descricao, valor, valor_pago, vencimento, tipo, fornecedores(nome)')
          .eq('status', 'pendente')
          .order('vencimento', { ascending: true })
          .range(pagina * PAGE, (pagina + 1) * PAGE - 1),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000))
      ]);
      const lote = resultado.data || [];
      todos = todos.concat(lote);
      if (lote.length < PAGE) break;
      pagina++;
    }
  } catch (e) {
    mostrarToast('Conexão lenta ao carregar lançamentos pendentes. Tente novamente.', 'erro');
    return;
  }
  lancamentosPendentes = todos;
}

function preencherSelectFornecedores() {
  const el = document.getElementById('pagar-fornecedor');
  if (!el) return;
  el.innerHTML = '<option value="">Nenhum</option>' +
    fornecedores.map(f => `<option value="${f.id}">${f.nome}</option>`).join('');
}

function preencherSelectUnidadesPagar() {
  ['pagar-unidade', 'receber-unidade'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '<option value="">Nenhuma</option>' +
      unidades.map(u => `<option value="${u.id}">${u.nome}</option>`).join('');
  });
}

function preencherSelectCentrosCusto() {
  ['pagar-centro-custo','receber-centro-custo'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '<option value="">Nenhum</option>' +
      centrosCusto.map(c => `<option value="${c.id}">${c.nome}</option>`).join('');
  });
}

function preencherSelectFormasPagamento() {
  ['pagar-forma-pagamento','receber-forma-pagamento'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '<option value="">Nenhuma</option>' +
      formasPagamento.map(f => `<option value="${f.id}">${f.nome}</option>`).join('');
  });
}

// =========================================================
// FILTROS DE MÊS E ANO
// =========================================================
function preencherFiltrosMes() {
  const hoje   = new Date();
  const ano    = hoje.getFullYear();
  const mes    = String(hoje.getMonth() + 1).padStart(2, '0');
  const ultimo = new Date(ano, hoje.getMonth() + 1, 0).toISOString().split('T')[0];
  const inicio = `${ano}-${mes}-01`;

  ['pagar', 'receber'].forEach(tipo => {
    const elDe  = document.getElementById(`filtro-de-${tipo}`);
    const elAte = document.getElementById(`filtro-ate-${tipo}`);
    if (elDe  && !elDe.value)  elDe.value  = inicio;
    if (elAte && !elAte.value) elAte.value = ultimo;
  });
}

function preencherFiltrosMesTransferencias() {
  const hoje = new Date();
  const ano  = hoje.getFullYear();
  const mes  = String(hoje.getMonth() + 1).padStart(2, '0');
  const ultimo = new Date(ano, hoje.getMonth() + 1, 0).getDate();
  const elDe  = document.getElementById('filtro-de-transferencias');
  const elAte = document.getElementById('filtro-ate-transferencias');
  if (elDe  && !elDe.value)  elDe.value  = `${ano}-${mes}-01`;
  if (elAte && !elAte.value) elAte.value = `${ano}-${mes}-${String(ultimo).padStart(2,'0')}`;
}

function limparFiltroTransferencias() {
  ['filtro-de-transferencias','filtro-ate-transferencias',
   'filtro-banco-origem-transf','filtro-banco-destino-transf'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  carregarTransferencias();
}

function preencherFiltrosAno() {
  const anoAtual = new Date().getFullYear();
  const el = document.getElementById('filtro-ano-relatorio');
  if (!el) return;
  el.innerHTML = [anoAtual-1, anoAtual, anoAtual+1].map(a =>
    `<option value="${a}" ${a === anoAtual ? 'selected' : ''}>${a}</option>`
  ).join('');
}

function preencherFiltrosAnoOrcamento() {
  const anoAtual = new Date().getFullYear();
  const el = document.getElementById('filtro-ano-orcamento');
  if (!el) return;
  el.innerHTML = [anoAtual-1, anoAtual, anoAtual+1].map(a =>
    `<option value="${a}" ${a === anoAtual ? 'selected' : ''}>${a}</option>`
  ).join('');
}

function preencherMesOrcamentoAtual() {
  const el = document.getElementById('filtro-mes-orcamento');
  if (!el) return;
  el.value = String(new Date().getMonth() + 1);
}

// =========================================================
// DASHBOARD
// =========================================================
function initBIPeriodo() {
  const ini = document.getElementById('bi-data-ini');
  const fim = document.getElementById('bi-data-fim');
  if (!ini || !fim || ini.value) return;
  const hoje = new Date();
  ini.value = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}-01`;
  fim.value = new Date(hoje.getFullYear(), hoje.getMonth()+1, 0).toISOString().split('T')[0];
}

function setBIPeriodo(periodo, btn) {
  biPeriodoAtual = periodo;
  document.querySelectorAll('.bi-btn-periodo').forEach(b => b.classList.remove('ativo'));
  if (btn) btn.classList.add('ativo');

  const datasEl = document.getElementById('bi-periodo-datas');
  if (periodo === 'personalizado') {
    datasEl.style.display = 'flex';
    return;
  }
  datasEl.style.display = 'none';

  const hoje = new Date();
  let ini, fim;
  if (periodo === 'mes') {
    ini = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}-01`;
    fim = new Date(hoje.getFullYear(), hoje.getMonth()+1, 0).toISOString().split('T')[0];
  } else if (periodo === 'trimestre') {
    const d = new Date(hoje.getFullYear(), hoje.getMonth()-2, 1);
    ini = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
    fim = new Date(hoje.getFullYear(), hoje.getMonth()+1, 0).toISOString().split('T')[0];
  } else if (periodo === 'ano') {
    ini = `${hoje.getFullYear()}-01-01`;
    fim = `${hoje.getFullYear()}-12-31`;
  }
  document.getElementById('bi-data-ini').value = ini;
  document.getElementById('bi-data-fim').value = fim;
  carregarDashboard();
}

async function carregarInicio() {
  if (!(await garantirSessao())) return;
  const db   = obterSupabase();
  const hoje = new Date().toISOString().split('T')[0];
  const set    = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = formatarMoeda(val); };
  const setEl  = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const soma   = lista => (lista||[]).reduce((s,l) => s + Number(l.valor), 0);

  // ── Linha 1: Saldos ───────────────────────────────────────────────────────
  const [lancRec, lancPag, r3] = await Promise.all([
    fetchTodosPag((de,ate) => db.from('lancamentos').select('banco_id, valor').eq('tipo','receber').eq('status','pago').not('banco_id','is',null).range(de,ate)),
    fetchTodosPag((de,ate) => db.from('lancamentos').select('banco_id, valor').eq('tipo','pagar').eq('status','pago').not('banco_id','is',null).range(de,ate)),
    q(db.from('transferencias').select('banco_origem_id, banco_destino_id, valor'))
  ]);
  const saldos = {};
  bancosCadastrados.forEach(b => { saldos[b.id] = Number(b.saldo_inicial) || 0; });
  lancRec.forEach(l => { if (l.banco_id) saldos[l.banco_id] = (saldos[l.banco_id]||0) + Number(l.valor); });
  lancPag.forEach(l => { if (l.banco_id) saldos[l.banco_id] = (saldos[l.banco_id]||0) - Number(l.valor); });
  (r3.data||[]).forEach(t => {
    if (t.banco_origem_id)  saldos[t.banco_origem_id]  = (saldos[t.banco_origem_id]||0)  - Number(t.valor);
    if (t.banco_destino_id) saldos[t.banco_destino_id] = (saldos[t.banco_destino_id]||0) + Number(t.valor);
  });

  const bancSant = bancosCadastrados.find(b => b.nome.toLowerCase().includes('santander'));
  const bancCaix = bancosCadastrados.find(b => b.nome.toLowerCase().includes('caixa') || b.nome.toLowerCase().includes('dinheiro'));
  const bancSantId = bancSant?.id;
  const bancCaixId = bancCaix?.id;
  const idsExcluir = [bancSantId, bancCaixId].filter(Boolean);

  // Santander
  const valSant = bancSant ? (saldos[bancSant.id] || 0) : 0;
  const elSant = document.getElementById('inicio-saldo-santander');
  if (elSant) { elSant.textContent = formatarMoeda(valSant); elSant.style.color = valSant >= 0 ? '#27ae60' : '#e74c3c'; }

  // Caixa/Dinheiro
  const valCaix = bancCaix ? (saldos[bancCaix.id] || 0) : 0;
  const elCaix = document.getElementById('inicio-saldo-caixa');
  if (elCaix) { elCaix.textContent = formatarMoeda(valCaix); elCaix.style.color = valCaix >= 0 ? '#27ae60' : '#e74c3c'; }

  // Outros bancos: soma + tooltip
  const outrosBancos = bancosCadastrados.filter(b => !idsExcluir.includes(b.id));
  const valOutros = outrosBancos.reduce((s, b) => s + (saldos[b.id] || 0), 0);
  const elOutros = document.getElementById('inicio-saldo-outros');
  if (elOutros) { elOutros.textContent = formatarMoeda(valOutros); elOutros.style.color = valOutros >= 0 ? '#27ae60' : '#e74c3c'; }
  const tooltip = document.getElementById('inicio-tooltip-outros');
  if (tooltip) {
    tooltip.innerHTML = outrosBancos.length
      ? outrosBancos.map(b => {
          const v = saldos[b.id] || 0;
          return `<div class="bi-tooltip-banco-item">
            <span>${b.nome}${b.conta ? ' — ' + b.conta : ''}</span>
            <span style="color:${v >= 0 ? '#27ae60' : '#e74c3c'};font-weight:600">${formatarMoeda(v)}</span>
          </div>`;
        }).join('')
      : '<div class="bi-tooltip-banco-item"><span>Nenhum outro banco</span></div>';
  }

  // ── Linha 2: Receita do dia (Santander) ──────────────────────────────────
  const agora = new Date();
  const toStr = d => d.toISOString().split('T')[0];
  const diaSemHoje = agora.getDay();

  const rDiaSant = bancSantId
    ? await q(db.from('lancamentos').select('valor').eq('tipo','receber').eq('status','pago').eq('data_pagamento', hoje).eq('banco_id', bancSantId))
    : { data: [] };
  set('inicio-rec-real-santander', soma(rDiaSant.data));

  // ── Linha 2: Contas a Pagar Hoje ─────────────────────────────────────────
  const datasHoje = [hoje];
  if (diaSemHoje === 1) {
    const sab = new Date(agora); sab.setDate(agora.getDate() - 2);
    const dom = new Date(agora); dom.setDate(agora.getDate() - 1);
    datasHoje.push(toStr(sab), toStr(dom));
  }
  const { data: pagarHoje } = await q(db.from('lancamentos').select('vencimento, valor')
    .eq('tipo','pagar').eq('status','pendente').in('vencimento', datasHoje));
  const efHoje  = proximoDiaUtil(hoje);
  const listaHoje = (pagarHoje||[]).filter(l => proximoDiaUtil(l.vencimento) === efHoje);
  set('inicio-pagar-hoje', soma(listaHoje));
  setEl('inicio-pagar-hoje-qtd', `${listaHoje.length} conta${listaHoje.length !== 1 ? 's' : ''}`);

  // ── Linha 2: Contas em Atraso ─────────────────────────────────────────────
  const { data: atrasados } = await q(db.from('lancamentos').select('valor')
    .eq('tipo','pagar').eq('status','pendente').lt('vencimento', hoje));
  set('inicio-atraso-valor', soma(atrasados));
  setEl('inicio-atraso-qtd', `${(atrasados||[]).length} conta${(atrasados||[]).length !== 1 ? 's' : ''}`);

  // ── Linha 3: Previsão Semanal ─────────────────────────────────────────────
  const ultimoDomingo = new Date(agora);
  ultimoDomingo.setDate(agora.getDate() - (diaSemHoje === 0 ? 7 : diaSemHoje));
  const inicioSemanas = new Date(ultimoDomingo);
  inicioSemanas.setDate(ultimoDomingo.getDate() - 27);

  const fetchRec = async (bancoId) => {
    if (!bancoId) return [];
    const { data } = await q(db.from('lancamentos').select('valor')
      .eq('tipo','receber').eq('status','pago').eq('banco_id', bancoId)
      .gte('vencimento', toStr(inicioSemanas)).lte('vencimento', toStr(ultimoDomingo)));
    return data || [];
  };
  const [recSant, recCaix] = await Promise.all([fetchRec(bancSantId), fetchRec(bancCaixId)]);
  set('inicio-prev-santander', soma(recSant) / 4);
  set('inicio-prev-caixa',     soma(recCaix) / 4);

  const seg = new Date(agora); seg.setDate(agora.getDate() - ((diaSemHoje + 6) % 7));
  const domSem = new Date(seg); domSem.setDate(seg.getDate() + 6);
  const { data: pagarSem } = await q(db.from('lancamentos').select('vencimento, valor')
    .eq('tipo','pagar').eq('status','pendente')
    .gte('vencimento', toStr(seg)).lte('vencimento', toStr(domSem)));
  const listaSem = (pagarSem||[]).filter(l => {
    const ef = proximoDiaUtil(l.vencimento);
    return ef >= toStr(seg) && ef <= toStr(domSem);
  });
  set('inicio-pagar-semana', soma(listaSem));
  setEl('inicio-pagar-semana-qtd', `${listaSem.length} conta${listaSem.length !== 1 ? 's' : ''}`);

  // ── Linha 4: Receita por Unidade (mês atual) ──────────────────────────────
  const mesIni = `${agora.getFullYear()}-${String(agora.getMonth()+1).padStart(2,'0')}-01`;
  const mesFim = new Date(agora.getFullYear(), agora.getMonth()+1, 0).toISOString().split('T')[0];
  const mesesPt = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const nomeMes = `${mesesPt[agora.getMonth()]} ${agora.getFullYear()}`;
  const elMes = document.getElementById('inicio-unidade-mes');
  if (elMes) elMes.textContent = nomeMes;

  const { data: recUnidades } = await q(db.from('lancamentos')
    .select('unidade_id, valor')
    .eq('tipo','receber').eq('status','pago')
    .gte('data_pagamento', mesIni).lte('data_pagamento', mesFim));

  const totaisPorUnidade = {};
  (recUnidades||[]).forEach(l => {
    const uid = l.unidade_id || '__sem_unidade__';
    totaisPorUnidade[uid] = (totaisPorUnidade[uid] || 0) + Number(l.valor);
  });

  const container = document.getElementById('inicio-receita-unidades');
  if (container) {
    const unidadesVisiveis = unidades.filter(u =>
      u.nome.toLowerCase().includes('teatro') || u.nome.toLowerCase().includes('p10')
    );
    const cards = unidadesVisiveis.map(u => {
      const val = totaisPorUnidade[u.id] || 0;
      return `<div class="bi-kpi bi-kpi-receita">
        <div class="bi-kpi-icone"><i class="fas fa-store"></i></div>
        <div class="bi-kpi-info">
          <span class="bi-kpi-label">${u.nome}</span>
          <span class="bi-kpi-valor" style="color:${val > 0 ? '#27ae60' : '#888'}">${formatarMoeda(val)}</span>
        </div>
      </div>`;
    });

    const semUnidade = totaisPorUnidade['__sem_unidade__'] || 0;
    if (semUnidade > 0) {
      cards.push(`<div class="bi-kpi bi-kpi-banco">
        <div class="bi-kpi-icone"><i class="fas fa-question-circle"></i></div>
        <div class="bi-kpi-info">
          <span class="bi-kpi-label">Sem unidade</span>
          <span class="bi-kpi-valor" style="color:#e67e22">${formatarMoeda(semUnidade)}</span>
        </div>
      </div>`);
    }

    container.innerHTML = cards.length
      ? cards.join('')
      : '<p class="sem-dados" style="padding:12px;">Nenhuma receita registrada neste mês.</p>';
  }
}

// =========================================================
// DASHBOARD BI — Interativo, filtros client-side
// =========================================================
const _BI_MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
let _biCache    = { ano: null, lancamentos: [], orcamentos: [] };
let _biFiltros  = { meses: new Set([1,2,3,4,5,6,7,8,9,10,11,12]), excUnidades: new Set(), excGrupos: new Set() };
let _biCharts   = {};
let _biDebTimer = null;
let _biFiltrosIniciados = false;

async function carregarDashboard() {
  if (!(await garantirSessao())) return;
  _biMontarFiltros();
  const anoChip = document.querySelector('#bi-f-anos .bi-chip.ativo');
  const ano = anoChip ? parseInt(anoChip.dataset.ano) : new Date().getFullYear();
  if (_biCache.ano !== ano) await _biCarregarDados(ano);
  _biRenderizar();
}

function _biMontarFiltros() {
  if (_biFiltrosIniciados) return;
  _biFiltrosIniciados = true;

  function criarChip(texto, idDado, fnToggle, ativo = true) {
    const btn = document.createElement('button');
    btn.className = 'bi-chip' + (ativo ? ' ativo' : '');
    btn.textContent = texto;
    btn.dataset.id = idDado;
    btn.onclick = () => fnToggle(idDado, btn);
    return btn;
  }

  // Meses
  const gM = document.getElementById('bi-f-meses');
  if (gM) _BI_MESES.forEach((nome, i) => {
    const btn = criarChip(nome, i + 1, biToggleMes);
    btn.dataset.mes = i + 1;
    btn.onclick = () => biToggleMes(i + 1, btn);
    gM.appendChild(btn);
  });

  // Unidades — chips
  const gU = document.getElementById('bi-f-unidades');
  if (gU) unidades.forEach(u => gU.appendChild(criarChip(u.nome, u.id, biToggleUnidade)));

  // Grupos — chips
  const gG = document.getElementById('bi-f-grupos');
  if (gG) planoContas.filter(p => !p.grupo_id).forEach(g => gG.appendChild(criarChip(g.nome, g.id, biToggleGrupo)));

  // Inicializa labels dos dropdowns
  _biAtualizarLabelPeriodo();
  _biAtualizarLabelUnidade();
  _biAtualizarLabelCategoria();
}

async function _biCarregarDados(ano) {
  const db = obterSupabase();
  const ind = document.getElementById('bi-loading-ind');
  if (ind) ind.style.display = 'flex';
  const [lanc, orc] = await Promise.all([
    fetchTodosPag((de,ate) => db.from('lancamentos')
      .select('tipo,plano_conta_id,valor,data_pagamento,unidade_id,fornecedor_id')
      .eq('status','pago').gte('data_pagamento',`${ano}-01-01`).lte('data_pagamento',`${ano}-12-31`)
      .range(de,ate)),
    fetchTodosPag((de,ate) => db.from('orcamentos')
      .select('plano_conta_id,mes,valor,unidade_id')
      .eq('ano',ano).range(de,ate))
  ]);
  _biCache = { ano, lancamentos: lanc, orcamentos: orc };
  if (ind) ind.style.display = 'none';
}

function biMudarAno() { _biCache.ano = null; carregarDashboard(); }
function biTogglePainelFiltros() {}

// ── Dropdowns de filtro ──
function biToggleDropdown(id) {
  const dd = document.getElementById(id);
  const aberto = dd.classList.contains('aberto');
  // Fecha todos
  document.querySelectorAll('.bi-dd.aberto').forEach(el => el.classList.remove('aberto'));
  if (!aberto) dd.classList.add('aberto');
}
// Fecha dropdown ao clicar fora
document.addEventListener('click', e => {
  if (!e.target.closest('.bi-dd')) {
    document.querySelectorAll('.bi-dd.aberto').forEach(el => el.classList.remove('aberto'));
  }
});

const _BI_MESES_ABREV = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

function _biAtualizarLabelPeriodo() {
  const el = document.getElementById('bi-dd-periodo-val');
  if (!el) return;
  if (_biFiltros.meses.size === 0)  { el.textContent = 'Nenhum'; return; }
  if (_biFiltros.meses.size === 12) { el.textContent = 'Todos os meses'; return; }
  const nomes = [..._biFiltros.meses].sort((a,b)=>a-b).map(m => _BI_MESES_ABREV[m-1]);
  el.textContent = nomes.length <= 3 ? nomes.join(', ') : nomes.slice(0,3).join(', ') + ` +${nomes.length-3}`;
}
function _biAtualizarLabelUnidade() {
  const el = document.getElementById('bi-dd-unidade-val');
  if (!el) return;
  const total = document.querySelectorAll('#bi-f-unidades .bi-chip').length;
  const exc = _biFiltros.excUnidades.size;
  el.textContent = exc === 0 ? 'Todas' : `${total - exc} de ${total}`;
}
function _biAtualizarLabelCategoria() {
  const el = document.getElementById('bi-dd-categoria-val');
  if (!el) return;
  const total = document.querySelectorAll('#bi-f-grupos .bi-chip').length;
  const exc = _biFiltros.excGrupos.size;
  el.textContent = exc === 0 ? 'Todas' : `${total - exc} de ${total}`;
}

function biSelecionarAno(ano, btn) {
  document.querySelectorAll('#bi-f-anos .bi-chip').forEach(b => b.classList.remove('ativo'));
  btn.classList.add('ativo');
  const el = document.getElementById('bi-dd-ano-val');
  if (el) el.textContent = ano;
  document.getElementById('bi-dd-ano')?.classList.remove('aberto');
  _biCache.ano = null;
  carregarDashboard();
}

function biToggleMes(mes, btn) {
  if (_biFiltros.meses.has(mes)) {
    if (_biFiltros.meses.size <= 1) return;
    _biFiltros.meses.delete(mes); btn.classList.remove('ativo');
  } else {
    _biFiltros.meses.add(mes); btn.classList.add('ativo');
  }
  _biAtualizarLabelPeriodo();
  _biDebounce();
}
function biToggleTodosMeses() {
  const temTodos = _biFiltros.meses.size === 12;
  _biFiltros.meses = temTodos ? new Set([new Date().getMonth()+1]) : new Set([1,2,3,4,5,6,7,8,9,10,11,12]);
  document.querySelectorAll('#bi-f-meses .bi-chip').forEach(b => b.classList.toggle('ativo', _biFiltros.meses.has(parseInt(b.dataset.mes))));
  _biAtualizarLabelPeriodo();
  _biDebounce();
}
function biToggleUnidade(id, btn) {
  if (_biFiltros.excUnidades.has(id)) { _biFiltros.excUnidades.delete(id); btn.classList.add('ativo'); }
  else { _biFiltros.excUnidades.add(id); btn.classList.remove('ativo'); }
  _biAtualizarLabelUnidade();
  _biDebounce();
}
function biToggleTodasUnidades() {
  _biFiltros.excUnidades.clear();
  document.querySelectorAll('#bi-f-unidades .bi-chip').forEach(b => b.classList.add('ativo'));
  _biAtualizarLabelUnidade();
  _biDebounce();
}
function biToggleGrupo(id, btn) {
  if (_biFiltros.excGrupos.has(id)) { _biFiltros.excGrupos.delete(id); btn.classList.add('ativo'); }
  else { _biFiltros.excGrupos.add(id); btn.classList.remove('ativo'); }
  _biAtualizarLabelCategoria();
  _biDebounce();
}
function biToggleTodasCategorias() {
  _biFiltros.excGrupos.clear();
  document.querySelectorAll('#bi-f-grupos .bi-chip').forEach(b => b.classList.add('ativo'));
  _biAtualizarLabelCategoria();
  _biDebounce();
}
function biLimparMeses() {
  _biFiltros.meses.clear();
  document.querySelectorAll('#bi-f-meses .bi-chip').forEach(b => b.classList.remove('ativo'));
  _biAtualizarLabelPeriodo();
  _biDebounce();
}
function biLimparUnidades() {
  const todos = [...document.querySelectorAll('#bi-f-unidades .bi-chip')].map(b => b.dataset.id);
  _biFiltros.excUnidades = new Set(todos);
  document.querySelectorAll('#bi-f-unidades .bi-chip').forEach(b => b.classList.remove('ativo'));
  _biAtualizarLabelUnidade();
  _biDebounce();
}
function biLimparCategorias() {
  const todos = [...document.querySelectorAll('#bi-f-grupos .bi-chip')].map(b => b.dataset.id);
  _biFiltros.excGrupos = new Set(todos);
  document.querySelectorAll('#bi-f-grupos .bi-chip').forEach(b => b.classList.remove('ativo'));
  _biAtualizarLabelCategoria();
  _biDebounce();
}
function _biDebounce() { clearTimeout(_biDebTimer); _biDebTimer = setTimeout(_biRenderizar, 280); }

function _biRenderizar() {
  const dados = _biCache.lancamentos.filter(l => {
    const mes = parseInt(l.data_pagamento?.slice(5,7));
    if (!_biFiltros.meses.has(mes)) return false;
    if (_biFiltros.excUnidades.size && _biFiltros.excUnidades.has(l.unidade_id)) return false;
    if (_biFiltros.excGrupos.size) {
      const pc  = planoContas.find(p => p.id === l.plano_conta_id);
      const gid = pc?.grupo_id || pc?.id;
      if (_biFiltros.excGrupos.has(gid)) return false;
    }
    return true;
  });
  const m = _biComputar(dados);
  _biRenderizarKPIs(m);
  _biRenderizarGraficos(m);
  _biAtualizarLabel();
}

function _biComputar(dados) {
  const recM=Array(12).fill(0), despM=Array(12).fill(0), cmvM=Array(12).fill(0);
  const catMap={}, fornMap={};
  dados.forEach(l => {
    const mi = parseInt(l.data_pagamento?.slice(5,7))-1;
    if (mi<0||mi>11) return;
    const val = Number(l.valor);
    const pc  = planoContas.find(p => p.id===l.plano_conta_id);
    const gid = pc?.grupo_id || l.plano_conta_id;
    const grp = planoContas.find(p => p.id===gid);
    if (l.tipo==='receber') { recM[mi]+=val; }
    else {
      despM[mi]+=val;
      if (grp?.is_cmv) cmvM[mi]+=val;
      if (gid) catMap[gid]=(catMap[gid]||0)+val;
      if (l.fornecedor_id) fornMap[l.fornecedor_id]=(fornMap[l.fornecedor_id]||0)+val;
    }
  });
  const totalRec=recM.reduce((a,b)=>a+b,0), totalDesp=despM.reduce((a,b)=>a+b,0), totalCMV=cmvM.reduce((a,b)=>a+b,0);
  const resultado=totalRec-totalDesp;
  return { recM, despM, cmvM, totalRec, totalDesp, totalCMV, resultado, catMap, fornMap,
    margemBruta:  totalRec>0?(totalRec-totalCMV)/totalRec*100:0,
    margemOp:     totalRec>0?resultado/totalRec*100:0,
    cmvPct:       totalRec>0?totalCMV/totalRec*100:0 };
}

function _biRenderizarKPIs(m) {
  const el = document.getElementById('bi-kpi-novo-row'); if (!el) return;
  const kpi = (label,val,sub,cor,bord) => `<div class="bi-kpi-novo" style="border-left-color:${bord};">
    <div class="bi-kpi-novo-label">${label}</div>
    <div class="bi-kpi-novo-valor" style="color:${typeof val==='number'&&val<0?'#e74c3c':cor};">${typeof val==='number'?formatarMoeda(val):val}</div>
    ${sub?`<div class="bi-kpi-novo-sub">${sub}</div>`:''}
  </div>`;
  el.innerHTML =
    kpi('Receita Total',       m.totalRec,                  null,                                 '#1a7a3c','#1a7a3c')+
    kpi('Despesa Total',       m.totalDesp,                 null,                                 '#e74c3c','#e74c3c')+
    kpi('Resultado',           m.resultado,                 m.margemOp.toFixed(1)+'% da receita', m.resultado>=0?'#1a3a7a':'#e74c3c',m.resultado>=0?'#1a3a7a':'#e74c3c')+
    kpi('CMV',                 m.totalCMV,                  m.cmvPct.toFixed(1)+'% da receita',   '#e67e22','#e67e22')+
    kpi('Lucro Bruto',         m.totalRec-m.totalCMV,       m.margemBruta.toFixed(1)+'% da receita','#27ae60','#27ae60')+
    kpi('Margem Operacional',  m.margemOp.toFixed(1)+'%',   null,                                 m.margemOp>=0?'#1a3a7a':'#e74c3c','#9b59b6');
}

function _biRenderizarGraficos(m) {
  // 1. Receitas × Despesas
  _biG('bg-recdesp','bar',{
    labels:_BI_MESES,
    datasets:[
      {label:'Receitas',data:m.recM, backgroundColor:'rgba(26,122,60,.75)',borderRadius:4},
      {label:'Despesas',data:m.despM,backgroundColor:'rgba(192,57,43,.75)', borderRadius:4}
    ]
  },{interaction:{mode:'index'},scales:{y:{ticks:{callback:v=>'R$'+(v/1000).toFixed(0)+'k'}}}});

  // 2. Resultado Mensal
  const resM = m.recM.map((r,i)=>r-m.despM[i]);
  _biG('bg-resultado','bar',{
    labels:_BI_MESES,
    datasets:[{label:'Resultado',data:resM,
      backgroundColor:resM.map(v=>v>=0?'rgba(26,122,60,.8)':'rgba(192,57,43,.8)'),borderRadius:4}]
  },{scales:{y:{ticks:{callback:v=>'R$'+(v/1000).toFixed(0)+'k'}}}});

  // 3. Resultado Acumulado
  let ac=0; const acM=resM.map(v=>{ac+=v;return ac;});
  _biG('bg-acumulado','line',{
    labels:_BI_MESES,
    datasets:[{label:'Acumulado',data:acM,borderColor:'#1a3a7a',
      backgroundColor:'rgba(26,58,122,.08)',fill:true,tension:0.4,
      pointRadius:4,pointBackgroundColor:'#1a3a7a',borderWidth:2.5}]
  },{scales:{y:{ticks:{callback:v=>'R$'+(v/1000).toFixed(0)+'k'}}}});

  // 4. Gastos por Categoria (top 10 horizontal)
  const cats=Object.entries(m.catMap)
    .map(([id,v])=>({nome:(planoContas.find(p=>p.id===id)?.nome||'Outros').slice(0,28),v}))
    .sort((a,b)=>b.v-a.v).slice(0,10);
  _biG('bg-categorias','bar',{
    labels:cats.map(c=>c.nome),
    datasets:[{label:'Gasto',data:cats.map(c=>c.v),backgroundColor:'rgba(230,126,34,.8)',borderRadius:4}]
  },{indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{ticks:{callback:v=>'R$'+(v/1000).toFixed(0)+'k'}}}});

  // 5. Top Fornecedores (top 10 horizontal)
  const forns=Object.entries(m.fornMap)
    .map(([id,v])=>({nome:(fornecedores.find(f=>f.id===id)?.nome||'Outros').slice(0,28),v}))
    .sort((a,b)=>b.v-a.v).slice(0,10);
  _biG('bg-fornecedores','bar',{
    labels:forns.map(f=>f.nome),
    datasets:[{label:'Total',data:forns.map(f=>f.v),backgroundColor:'rgba(155,89,182,.8)',borderRadius:4}]
  },{indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{ticks:{callback:v=>'R$'+(v/1000).toFixed(0)+'k'}}}});

  // 6. Orçado × Realizado
  _biGraficoOrcadoRealizado(m);
}

function _biGraficoOrcadoRealizado(m) {
  const unidFiltro = [..._biFiltros.excUnidades.size===0 ? [] : [null]]; // unused; just filter from cache
  const orcMap = {};
  _biCache.orcamentos.forEach(o => {
    const mes = o.mes;
    if (!_biFiltros.meses.has(mes)) return;
    const pc  = planoContas.find(p=>p.id===o.plano_conta_id);
    const gid = pc?.grupo_id || o.plano_conta_id;
    if (_biFiltros.excGrupos.has(gid)) return;
    orcMap[gid]=(orcMap[gid]||0)+Number(o.valor);
  });
  const grupos = planoContas.filter(p=>!p.grupo_id&&p.tipo==='pagar');
  const labels=[],orcados=[],realizados=[];
  grupos.forEach(g => {
    const orc  = orcMap[g.id]||0;
    const real = m.catMap[g.id]||0;
    if (orc===0&&real===0) return;
    labels.push(g.nome.slice(0,24));
    orcados.push(orc); realizados.push(real);
  });
  _biG('bg-orcado','bar',{
    labels,
    datasets:[
      {label:'Orçado',   data:orcados,    backgroundColor:'rgba(52,152,219,.6)', borderRadius:4},
      {label:'Realizado',data:realizados, backgroundColor:'rgba(192,57,43,.75)', borderRadius:4}
    ]
  },{indexAxis:'y',interaction:{mode:'index'},scales:{x:{ticks:{callback:v=>'R$'+(v/1000).toFixed(0)+'k'}}}});
}

function _biG(id, tipo, data, extra={}) {
  const ctx=document.getElementById(id); if(!ctx) return;
  if(_biCharts[id]) _biCharts[id].destroy();
  const gridColor = 'rgba(0,0,0,.06)';
  const tickColor = '#999';
  const lightScale = (cb) => ({ ticks:{ color:tickColor, callback:cb }, grid:{ color:gridColor } });
  const cbY = extra?.scales?.y?.ticks?.callback;
  const cbX = extra?.scales?.x?.ticks?.callback;
  const scales = extra.indexAxis === 'y'
    ? { x:{ ...lightScale(cbX) }, y:{ ...lightScale(cbY), ticks:{ color:tickColor } } }
    : { x:{ ...lightScale(cbX) }, y:{ ...lightScale(cbY) } };
  const { scales:_, ...extraRest } = extra;
  _biCharts[id]=new Chart(ctx,{type:tipo,data,options:{
    responsive:true, animation:{duration:250},
    plugins:{
      legend:{ position:'top', labels:{ color:'#444', font:{size:11} } },
      tooltip:{ callbacks:{ label:c=>` ${formatarMoeda(c.raw)}` } }
    },
    scales,
    ...extraRest
  }});
}

function _biAtualizarLabel() {
  const el=document.getElementById('bi-periodo-label'); if(!el) return;
  const arr=[..._biFiltros.meses].sort((a,b)=>a-b);
  const ano=_biCache.ano||'';
  if(arr.length===12) { el.textContent=`— Ano todo ${ano}`; return; }
  if(arr.length===1)  { el.textContent=`— ${_BI_MESES[arr[0]-1]} ${ano}`; return; }
  el.textContent=`— ${arr.map(m=>_BI_MESES[m-1]).join(', ')} (${ano})`;
}

// =========================================================
// (LEGADO — mantido para compatibilidade interna)
// =========================================================
function initBIPeriodo() {}
function setBIPeriodo() {}
function renderizarKPIsPrevisao() {}

async function _carregarDashboardLegado_naoUsar() {
  if (!(await garantirSessao())) return;
  const db = obterSupabase();
  const unidadeId = document.getElementById('filtro-unidade-dashboard')?.value;
  const dataIni   = document.getElementById('bi-data-ini')?.value;
  const dataFim   = document.getElementById('bi-data-fim')?.value;
  if (!dataIni || !dataFim) return;

  renderizarKPIsPrevisao();

  const hoje = new Date().toISOString().split('T')[0];
  const mesIniAtual = `${hoje.slice(0,7)}-01`;
  const mesFimAtual = new Date(new Date().getFullYear(), new Date().getMonth()+1, 0).toISOString().split('T')[0];

  // ── KPI 1: Saldo em Bancos (com tooltip por banco) ──────────────────────
  const totalSaldoBancos = await renderizarSaldosBancos();

  // ── KPI Linha 2: Receita real do dia (Santander e Caixa) ─────────────────
  const bancSantId = bancosCadastrados.find(b => b.nome.toLowerCase().includes('santander'))?.id;
  const bancCaixId = bancosCadastrados.find(b => b.nome.toLowerCase().includes('caixa') || b.nome.toLowerCase().includes('dinheiro'))?.id;
  const [rDiaSant, rDiaCaix] = await Promise.all([
    bancSantId ? db.from('lancamentos').select('valor').eq('tipo','receber').eq('status','pago').eq('data_pagamento', hoje).eq('banco_id', bancSantId) : { data: [] },
    bancCaixId ? db.from('lancamentos').select('valor').eq('tipo','receber').eq('status','pago').eq('data_pagamento', hoje).eq('banco_id', bancCaixId) : { data: [] }
  ]);
  const setV = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = formatarMoeda(val); };
  setV('bi-rec-real-santander', (rDiaSant.data||[]).reduce((s,l) => s+Number(l.valor), 0));
  setV('bi-rec-real-caixa',     (rDiaCaix.data||[]).reduce((s,l) => s+Number(l.valor), 0));

  // ── Gráficos (usam período do filtro) ────────────────────────────────────
  let qry = db.from('lancamentos')
    .select('*, plano_contas(nome, is_cmv, grupo_id), fornecedores(nome)')
    .gte('vencimento', dataIni).lte('vencimento', dataFim);
  if (unidadeId) qry = qry.eq('unidade_id', unidadeId);
  const { data } = await q(qry);
  const lancamentos = data || [];

  const mesesPt = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const [anoIni, mesIni] = dataIni.split('-').map(Number);
  const [anoFim, mesFim] = dataFim.split('-').map(Number);
  const meses = [];
  let a = anoIni, m = mesIni;
  while (a < anoFim || (a === anoFim && m <= mesFim)) {
    meses.push({ ano: a, mes: m });
    m++; if (m > 12) { m = 1; a++; }
  }
  const labelsM = meses.map(({ano, mes}) => `${mesesPt[mes-1]}/${String(ano).slice(-2)}`);

  const dadosR = meses.map(({ano, mes}) => {
    const ini = `${ano}-${String(mes).padStart(2,'0')}-01`;
    const fim = new Date(ano, mes, 0).toISOString().split('T')[0];
    return lancamentos.filter(l => l.tipo==='receber' && l.vencimento >= ini && l.vencimento <= fim)
      .reduce((s,l) => s+Number(l.valor), 0);
  });
  const dadosD = meses.map(({ano, mes}) => {
    const ini = `${ano}-${String(mes).padStart(2,'0')}-01`;
    const fim = new Date(ano, mes, 0).toISOString().split('T')[0];
    return lancamentos.filter(l => l.tipo==='pagar' && l.vencimento >= ini && l.vencimento <= fim)
      .reduce((s,l) => s+Number(l.valor), 0);
  });

  // Gráfico 1: Orçado x Realizado (largura total)
  await renderizarOrcadoRealizado(dataIni, dataFim, unidadeId, lancamentos, meses);

  // Gráfico 2: Receita vs Despesa (barras)
  if (biChartMensal) biChartMensal.destroy();
  biChartMensal = new Chart(document.getElementById('bi-chart-mensal'), {
    type: 'bar',
    data: {
      labels: labelsM,
      datasets: [
        { label: 'Receita', data: dadosR, backgroundColor: 'rgba(39,174,96,0.75)', borderRadius: 5 },
        { label: 'Despesa', data: dadosD, backgroundColor: 'rgba(231,76,60,0.75)',  borderRadius: 5 }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'top' },
        title: { display: true, text: 'Receita vs Despesa' },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${formatarMoeda(ctx.raw)}` } }
      },
      scales: { y: { beginAtZero: true, ticks: { callback: v => 'R$ ' + Number(v).toLocaleString('pt-BR') } } }
    }
  });

  // Gráfico 3: Fluxo de Caixa Acumulado (linha)
  let acum = 0;
  const dadosFluxo = dadosR.map((r, i) => { acum += r - dadosD[i]; return acum; });
  if (biChartFluxo) biChartFluxo.destroy();
  biChartFluxo = new Chart(document.getElementById('bi-chart-fluxo'), {
    type: 'line',
    data: {
      labels: labelsM,
      datasets: [{
        label: 'Fluxo Acumulado',
        data: dadosFluxo,
        borderColor: '#3498db',
        backgroundColor: 'rgba(52,152,219,0.12)',
        borderWidth: 2.5,
        pointRadius: 4,
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        title: { display: true, text: 'Fluxo de Caixa Acumulado' },
        tooltip: { callbacks: { label: ctx => ` Acumulado: ${formatarMoeda(ctx.raw)}` } }
      },
      scales: { y: { ticks: { callback: v => 'R$ ' + Number(v).toLocaleString('pt-BR') } } }
    }
  });

  // Gráfico 4: Top 10 Fornecedores (largura total)
  const porFornec = {};
  lancamentos.filter(l => l.tipo === 'pagar' && l.fornecedores?.nome).forEach(l => {
    porFornec[l.fornecedores.nome] = (porFornec[l.fornecedores.nome] || 0) + Number(l.valor);
  });
  const sortedFornec = Object.entries(porFornec).sort((a,b) => b[1]-a[1]).slice(0, 10);
  if (biChartFornecedores) biChartFornecedores.destroy();
  const coresF = ['#c0392b','#e74c3c','#e67e22','#f39c12','#f1c40f',
                  '#27ae60','#1abc9c','#3498db','#2980b9','#9b59b6'];
  biChartFornecedores = new Chart(document.getElementById('bi-chart-fornecedores'), {
    type: 'bar',
    data: {
      labels: sortedFornec.map(([n]) => n.length > 24 ? n.slice(0,22) + '…' : n),
      datasets: [{
        label: 'Total (R$)',
        data: sortedFornec.map(([,v]) => v),
        backgroundColor: sortedFornec.map((_, i) => coresF[i % coresF.length]),
        borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: {
        legend: { display: false },
        title: { display: true, text: 'Top 10 Fornecedores (Despesas)' },
        tooltip: { callbacks: { label: ctx => ` ${formatarMoeda(ctx.raw)}` } }
      },
      scales: { x: { beginAtZero: true, ticks: { callback: v => 'R$ ' + Number(v).toLocaleString('pt-BR') } } }
    }
  });
}

function proximoDiaUtil(dataStr) {
  const [y, m, d] = dataStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getDay() === 6) dt.setDate(dt.getDate() + 2); // Sábado → Segunda
  if (dt.getDay() === 0) dt.setDate(dt.getDate() + 1); // Domingo → Segunda
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
}

async function renderizarKPIsPrevisao() {
  const db = obterSupabase();
  const agora = new Date();
  const toStr = dt => `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
  const hojeStr = toStr(agora);

  // Segunda-feira desta semana
  const diaSemHoje = agora.getDay();
  const segunda = new Date(agora);
  segunda.setDate(agora.getDate() - (diaSemHoje === 0 ? 6 : diaSemHoje - 1));
  segunda.setHours(0, 0, 0, 0);
  const sexta     = new Date(segunda); sexta.setDate(segunda.getDate() + 4);
  const domingo   = new Date(segunda); domingo.setDate(segunda.getDate() + 6);
  const sabPassado = new Date(segunda); sabPassado.setDate(segunda.getDate() - 2);

  const segundaStr   = toStr(segunda);
  const sextaStr     = toStr(sexta);
  const domingoStr   = toStr(domingo);
  const sabPassadoStr = toStr(sabPassado);

  // Últimas 4 semanas COMPLETAS (Segunda a Domingo)
  // Último domingo = domingo da semana passada (semana atual não entra pois pode estar incompleta)
  const ultimoDomingo = new Date(agora);
  ultimoDomingo.setDate(agora.getDate() - (diaSemHoje === 0 ? 7 : diaSemHoje));
  ultimoDomingo.setHours(0, 0, 0, 0);
  const inicioSemanas = new Date(ultimoDomingo);
  inicioSemanas.setDate(ultimoDomingo.getDate() - 27); // 4 semanas = 28 dias; -27 chega na segunda de 4 semanas atrás

  const inicioSemanasStr  = toStr(inicioSemanas);
  const ultimoDomingoStr  = toStr(ultimoDomingo);

  // Bancos: Santander e Caixa/Dinheiro
  const { data: bancos } = await q(db.from('bancos').select('id, nome'));
  const bancSantander = (bancos||[]).find(b => b.nome.toLowerCase().includes('santander'));
  const bancCaixa     = (bancos||[]).find(b =>
    b.nome.toLowerCase().includes('caixa') || b.nome.toLowerCase().includes('dinheiro'));

  const fetchRec = async (bancoId) => {
    if (!bancoId) return [];
    const { data } = await q(db.from('lancamentos').select('vencimento, valor')
      .eq('tipo', 'receber').eq('status', 'pago')
      .eq('banco_id', bancoId)
      .gte('vencimento', inicioSemanasStr).lte('vencimento', ultimoDomingoStr));
    return data || [];
  };

  const [recSantander, recCaixa] = await Promise.all([
    fetchRec(bancSantander?.id),
    fetchRec(bancCaixa?.id)
  ]);

  const set    = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = formatarMoeda(val); };
  const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const soma   = lista => lista.reduce((s, l) => s + Number(l.valor), 0);

  // KPIs Semanais: total 4 semanas / 4
  set('bi-prev-semana-santander', soma(recSantander) / 4);
  set('bi-prev-semana-caixa',     soma(recCaixa) / 4);

  // KPIs Diários: mesmo dia da semana nas últimas 4 semanas / 4
  const mediaDia = lista => soma(
    lista.filter(l => {
      const [y, m, d] = l.vencimento.split('-').map(Number);
      return new Date(y, m - 1, d).getDay() === diaSemHoje;
    })
  ) / 4;
  set('bi-prev-dia-santander', mediaDia(recSantander));
  set('bi-prev-dia-caixa',     mediaDia(recCaixa));

  // Contas a Pagar Semana: effective date dentro de Segunda–Sexta desta semana
  const { data: pagarSem } = await q(db.from('lancamentos').select('vencimento, valor')
    .eq('tipo', 'pagar').eq('status', 'pendente')
    .gte('vencimento', sabPassadoStr).lte('vencimento', domingoStr));

  const listaSem = (pagarSem||[]).filter(l => {
    const ef = proximoDiaUtil(l.vencimento);
    return ef >= segundaStr && ef <= sextaStr;
  });
  set('bi-pagar-semana', soma(listaSem));
  setTxt('bi-pagar-semana-qtd', `${listaSem.length} conta${listaSem.length !== 1 ? 's' : ''}`);

  // Contas a Pagar Hoje: effective date = hoje (com ajuste de fim de semana)
  const efetivHoje = proximoDiaUtil(hojeStr);
  const datasHoje  = [hojeStr];
  if (agora.getDay() === 1) { // Segunda: busca também sáb e dom anteriores
    const sab = new Date(agora); sab.setDate(agora.getDate() - 2);
    const dom = new Date(agora); dom.setDate(agora.getDate() - 1);
    datasHoje.push(toStr(sab), toStr(dom));
  }
  if (agora.getDay() === 6) { // Sábado: busca também domingo
    const dom = new Date(agora); dom.setDate(agora.getDate() + 1);
    datasHoje.push(toStr(dom));
  }

  const { data: pagarHojeDet } = await q(db.from('lancamentos').select('vencimento, valor')
    .eq('tipo', 'pagar').eq('status', 'pendente')
    .in('vencimento', datasHoje));

  const listaHoje = (pagarHojeDet||[]).filter(l => proximoDiaUtil(l.vencimento) === efetivHoje);
  set('bi-pagar-hoje-det', soma(listaHoje));
  setTxt('bi-pagar-hoje-det-qtd', `${listaHoje.length} conta${listaHoje.length !== 1 ? 's' : ''}`);
}

async function renderizarOrcadoRealizado(dataIni, dataFim, unidadeId, lancamentos, meses) {
  const db = obterSupabase();
  const anos = [...new Set(meses.map(p => p.ano))];
  const mesesPorAno = {};
  meses.forEach(p => {
    if (!mesesPorAno[p.ano]) mesesPorAno[p.ano] = [];
    mesesPorAno[p.ano].push(p.mes);
  });

  const orcTodos = [];
  for (const ano of anos) {
    const { data } = await q(db.from('orcamentos').select('*').eq('ano', ano).in('mes', mesesPorAno[ano]));
    (data || []).forEach(o => orcTodos.push(o));
  }

  // Somar orçado por grupo
  const orcadoPorGrupo = {};
  orcTodos.forEach(o => {
    const cat = planoContas.find(p => p.id === o.plano_conta_id);
    const grupoId = cat?.grupo_id || o.plano_conta_id;
    orcadoPorGrupo[grupoId] = (orcadoPorGrupo[grupoId] || 0) + Number(o.valor);
  });

  // Somar realizado por grupo (despesas do período)
  const realizadoPorGrupo = {};
  lancamentos.filter(l => l.tipo === 'pagar').forEach(l => {
    const cat = planoContas.find(p => p.id === l.plano_conta_id);
    const grupoId = cat?.grupo_id || l.plano_conta_id;
    if (!grupoId) return;
    realizadoPorGrupo[grupoId] = (realizadoPorGrupo[grupoId] || 0) + Number(l.valor);
  });

  const todosIds = [...new Set([...Object.keys(orcadoPorGrupo), ...Object.keys(realizadoPorGrupo)])];
  const grupos = todosIds
    .map(id => ({ id, nome: planoContas.find(p => p.id === id)?.nome || '?' }))
    .filter(g => (orcadoPorGrupo[g.id] || 0) > 0 || (realizadoPorGrupo[g.id] || 0) > 0)
    .sort((a, b) => (realizadoPorGrupo[b.id] || 0) - (realizadoPorGrupo[a.id] || 0))
    .slice(0, 10);

  if (biChartOrcado) biChartOrcado.destroy();
  if (!grupos.length) {
    const ctx = document.getElementById('bi-chart-orcado')?.getContext('2d');
    if (ctx) { ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height); }
    return;
  }

  biChartOrcado = new Chart(document.getElementById('bi-chart-orcado'), {
    type: 'bar',
    data: {
      labels: grupos.map(g => g.nome.length > 20 ? g.nome.slice(0,18) + '…' : g.nome),
      datasets: [
        { label: 'Orçado',    data: grupos.map(g => orcadoPorGrupo[g.id]    || 0), backgroundColor: 'rgba(52,152,219,0.7)',  borderRadius: 4 },
        { label: 'Realizado', data: grupos.map(g => realizadoPorGrupo[g.id] || 0), backgroundColor: 'rgba(231,76,60,0.7)',   borderRadius: 4 }
      ]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: {
        legend: { position: 'top' },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${formatarMoeda(ctx.raw)}` } }
      },
      scales: { x: { beginAtZero: true, ticks: { callback: v => 'R$ ' + Number(v).toLocaleString('pt-BR') } } }
    }
  });
}

async function renderizarSaldosBancos() {
  if (!bancosCadastrados.length) {
    const totalSaldoEl = document.getElementById('total-saldo-bancos');
    if (totalSaldoEl) { totalSaldoEl.textContent = 'R$ 0,00'; totalSaldoEl.style.color = '#888'; }
    const tooltipEl = document.getElementById('bi-tooltip-bancos');
    if (tooltipEl) tooltipEl.innerHTML = '<div class="bi-tooltip-banco-item"><span>Nenhum banco cadastrado</span></div>';
    return 0;
  }

  const db = obterSupabase();
  const [lancRec2, lancPag2, r3] = await Promise.all([
    fetchTodosPag((de,ate) => db.from('lancamentos').select('banco_id, valor').eq('tipo','receber').eq('status','pago').not('banco_id','is',null).range(de,ate)),
    fetchTodosPag((de,ate) => db.from('lancamentos').select('banco_id, valor').eq('tipo','pagar').eq('status','pago').not('banco_id','is',null).range(de,ate)),
    q(db.from('transferencias').select('banco_origem_id, banco_destino_id, valor'))
  ]);

  const saldos = {};
  bancosCadastrados.forEach(b => { saldos[b.id] = Number(b.saldo_inicial) || 0; });

  lancRec2.forEach(l => { if (l.banco_id) saldos[l.banco_id] = (saldos[l.banco_id]||0) + Number(l.valor); });
  lancPag2.forEach(l => { if (l.banco_id) saldos[l.banco_id] = (saldos[l.banco_id]||0) - Number(l.valor); });
  (r3.data || []).forEach(t => {
    if (t.banco_origem_id)  saldos[t.banco_origem_id]  = (saldos[t.banco_origem_id]||0)  - Number(t.valor);
    if (t.banco_destino_id) saldos[t.banco_destino_id] = (saldos[t.banco_destino_id]||0) + Number(t.valor);
  });

  const totalSaldo = Object.values(saldos).reduce((s,v) => s+v, 0);

  const totalSaldoEl = document.getElementById('total-saldo-bancos');
  if (totalSaldoEl) {
    totalSaldoEl.textContent = formatarMoeda(totalSaldo);
    totalSaldoEl.style.color = totalSaldo >= 0 ? '#27ae60' : '#e74c3c';
  }

  // Tooltip com saldo por banco (hover)
  const tooltipEl = document.getElementById('bi-tooltip-bancos');
  if (tooltipEl) {
    tooltipEl.innerHTML = bancosCadastrados.map(b => {
      const saldo = saldos[b.id] || 0;
      return `<div class="bi-tooltip-banco-item">
        <span>${b.nome}${b.conta ? ' — ' + b.conta : ''}</span>
        <span style="color:${saldo >= 0 ? '#27ae60' : '#e74c3c'};font-weight:600">${formatarMoeda(saldo)}</span>
      </div>`;
    }).join('');
  }

  // KPIs individuais por banco (Linha 1 do dashboard)
  const setSaldoBanco = (elId, nomes) => {
    const el = document.getElementById(elId);
    if (!el) return;
    const banco = bancosCadastrados.find(b => nomes.some(n => b.nome.toLowerCase().includes(n)));
    const val = banco ? (saldos[banco.id] || 0) : null;
    el.textContent = val !== null ? formatarMoeda(val) : '—';
    el.style.color  = val !== null ? (val >= 0 ? '#27ae60' : '#e74c3c') : '#888';
  };
  setSaldoBanco('bi-saldo-santander', ['santander']);
  setSaldoBanco('bi-saldo-nubank',    ['nubank']);
  setSaldoBanco('bi-saldo-caixa',     ['caixa', 'dinheiro']);

  // Container legado (oculto no HTML, mantido por compatibilidade)
  const container = document.getElementById('saldos-por-conta');
  if (container) {
    container.innerHTML = bancosCadastrados.map(b => {
      const saldo = saldos[b.id] || 0;
      return `<div class="saldo-conta-item">
        <div class="saldo-conta-info"><i class="fas fa-university"></i>
          <span class="saldo-conta-nome">${b.nome}${b.conta ? ' — ' + b.conta : ''}</span>
        </div>
        <span class="saldo-conta-valor" style="color:${saldo >= 0 ? '#27ae60' : '#e74c3c'}">${formatarMoeda(saldo)}</span>
      </div>`;
    }).join('');
  }

  return totalSaldo;
}

// =========================================================
// LANÇAMENTOS
// =========================================================
function preencherFiltrosLancamentos(tipo) {
  // Status dropdown
  const elStatusDropdown = document.getElementById(`filtro-status-dropdown-${tipo}`);
  if (elStatusDropdown && !elStatusDropdown.innerHTML) {
    const statusOpcoes = tipo === 'receber'
      ? [{ value: 'pendente', label: 'Pendente' }, { value: 'pago', label: 'Recebido' }, { value: 'vencido', label: 'Vencido' }]
      : [{ value: 'pendente', label: 'Pendente' }, { value: 'pago', label: 'Pago'     }, { value: 'vencido', label: 'Vencido' }];
    elStatusDropdown.innerHTML = statusOpcoes.map(s =>
      `<label><input type="checkbox" value="${s.value}" onchange="atualizarLabelStatus('${tipo}')"> ${s.label}</label>`
    ).join('');
  }

  // Fornecedor dropdown
  const elFornDropdown = document.getElementById(`filtro-fornecedor-dropdown-${tipo}`);
  if (elFornDropdown) {
    const marcados = obterSelecionadosMulti(tipo, 'fornecedor');
    elFornDropdown.innerHTML = fornecedores.map(f =>
      `<label><input type="checkbox" value="${f.id}" onchange="atualizarLabelFornecedor('${tipo}')"${marcados.includes(f.id) ? ' checked' : ''}> ${f.nome}</label>`
    ).join('');
  }

  // Grupo dropdown
  const elGrupoDropdown = document.getElementById(`filtro-grupo-dropdown-${tipo}`);
  if (elGrupoDropdown) {
    const marcados = obterSelecionadosMulti(tipo, 'grupo');
    const grupos = planoContas.filter(p => !p.grupo_id && p.tipo === tipo);
    elGrupoDropdown.innerHTML = grupos.map(g =>
      `<label><input type="checkbox" value="${g.id}" onchange="atualizarLabelGrupo('${tipo}')"${marcados.includes(g.id) ? ' checked' : ''}> ${g.nome}</label>`
    ).join('');
  }

  // Banco dropdown
  const elDropdown = document.getElementById(`filtro-banco-dropdown-${tipo}`);
  if (elDropdown && bancosCadastrados.length) {
    const marcados = obterBancosSelecionados(tipo);
    elDropdown.innerHTML = bancosCadastrados.map(b =>
      `<label><input type="checkbox" value="${b.id}" onchange="atualizarLabelBancos('${tipo}')"${marcados.includes(b.id) ? ' checked' : ''}> ${b.nome}${b.conta ? ' (' + b.conta + ')' : ''}</label>`
    ).join('');
  }
}

function toggleFiltrosBancos(tipo) {
  const dropdown = document.getElementById(`filtro-banco-dropdown-${tipo}`);
  if (!dropdown) return;
  const aberto = dropdown.style.display !== 'none';
  document.querySelectorAll('.filtro-banco-dropdown').forEach(d => d.style.display = 'none');
  if (!aberto) dropdown.style.display = 'block';
}

function toggleFiltroMulti(tipo, campo) {
  const dropdown = document.getElementById(`filtro-${campo}-dropdown-${tipo}`);
  if (!dropdown) return;
  const aberto = dropdown.style.display !== 'none';
  document.querySelectorAll('.filtro-banco-dropdown').forEach(d => d.style.display = 'none');
  if (!aberto) dropdown.style.display = 'block';
}

function obterSelecionadosMulti(tipo, campo) {
  const dropdown = document.getElementById(`filtro-${campo}-dropdown-${tipo}`);
  if (!dropdown) return [];
  return Array.from(dropdown.querySelectorAll('input[type=checkbox]:checked')).map(cb => cb.value);
}

function atualizarLabelStatus(tipo) {
  const selecionados = obterSelecionadosMulti(tipo, 'status');
  const label = document.getElementById(`filtro-status-label-${tipo}`);
  const btn   = document.getElementById(`filtro-status-btn-${tipo}`);
  if (!label || !btn) return;
  const nomes = tipo === 'receber'
    ? { pendente: 'Pendente', pago: 'Recebido', vencido: 'Vencido' }
    : { pendente: 'Pendente', pago: 'Pago',     vencido: 'Vencido' };
  if (!selecionados.length) { label.textContent = 'Todos os status'; btn.classList.remove('ativo'); }
  else if (selecionados.length === 1) { label.textContent = nomes[selecionados[0]] || selecionados[0]; btn.classList.add('ativo'); }
  else { label.textContent = `${selecionados.length} status`; btn.classList.add('ativo'); }
}

function atualizarLabelFornecedor(tipo) {
  const selecionados = obterSelecionadosMulti(tipo, 'fornecedor');
  const label = document.getElementById(`filtro-fornecedor-label-${tipo}`);
  const btn   = document.getElementById(`filtro-fornecedor-btn-${tipo}`);
  if (!label || !btn) return;
  if (!selecionados.length) { label.textContent = 'Todos os fornecedores'; btn.classList.remove('ativo'); }
  else if (selecionados.length === 1) {
    const f = fornecedores.find(x => x.id === selecionados[0]);
    label.textContent = f ? f.nome : '1 fornecedor';
    btn.classList.add('ativo');
  } else { label.textContent = `${selecionados.length} fornecedores`; btn.classList.add('ativo'); }
}

function atualizarLabelGrupo(tipo) {
  const selecionados = obterSelecionadosMulti(tipo, 'grupo');
  const label = document.getElementById(`filtro-grupo-label-${tipo}`);
  const btn   = document.getElementById(`filtro-grupo-btn-${tipo}`);
  if (!label || !btn) return;
  const grupos = planoContas.filter(p => !p.grupo_id);
  if (!selecionados.length) { label.textContent = 'Todos os grupos'; btn.classList.remove('ativo'); }
  else if (selecionados.length === 1) {
    const g = grupos.find(x => x.id === selecionados[0]);
    label.textContent = g ? g.nome : '1 grupo';
    btn.classList.add('ativo');
  } else { label.textContent = `${selecionados.length} grupos`; btn.classList.add('ativo'); }
}

function obterBancosSelecionados(tipo) {
  const dropdown = document.getElementById(`filtro-banco-dropdown-${tipo}`);
  if (!dropdown) return [];
  return Array.from(dropdown.querySelectorAll('input[type=checkbox]:checked')).map(cb => cb.value);
}

function atualizarLabelBancos(tipo) {
  const selecionados = obterBancosSelecionados(tipo);
  const label = document.getElementById(`filtro-banco-label-${tipo}`);
  const btn   = document.getElementById(`filtro-banco-btn-${tipo}`);
  if (!label || !btn) return;
  if (selecionados.length === 0) {
    label.textContent = 'Todos os bancos';
    btn.classList.remove('ativo');
  } else if (selecionados.length === 1) {
    const b = bancosCadastrados.find(x => x.id === selecionados[0]);
    label.textContent = b ? b.nome : '1 banco';
    btn.classList.add('ativo');
  } else {
    label.textContent = `${selecionados.length} bancos`;
    btn.classList.add('ativo');
  }
}


function limparFiltros(tipo) {
  // Limpa todos os dropdowns multi-seleção
  ['status', 'fornecedor', 'grupo', 'banco'].forEach(campo => {
    const dropdown = document.getElementById(`filtro-${campo}-dropdown-${tipo}`);
    if (dropdown) dropdown.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false);
  });
  atualizarLabelStatus(tipo);
  atualizarLabelFornecedor(tipo);
  atualizarLabelGrupo(tipo);
  atualizarLabelBancos(tipo);

  const hoje   = new Date();
  const ano    = hoje.getFullYear();
  const mes    = String(hoje.getMonth() + 1).padStart(2, '0');
  const ultimo = new Date(ano, hoje.getMonth() + 1, 0).toISOString().split('T')[0];
  const elDe  = document.getElementById(`filtro-de-${tipo}`);
  const elAte = document.getElementById(`filtro-ate-${tipo}`);
  if (elDe)  elDe.value  = `${ano}-${mes}-01`;
  if (elAte) elAte.value = ultimo;
  const elTipoData = document.getElementById(`filtro-tipo-data-${tipo}`);
  if (elTipoData) elTipoData.value = 'vencimento';
  const elPedido = document.getElementById(`filtro-pedido-${tipo}`);
  if (elPedido) elPedido.value = '';
  carregarLancamentos(tipo);
}

// Lê os filtros da tela de Pagar/Receber. Usado pela listagem e pela exportação
// para Excel, para que as duas leiam exatamente os mesmos critérios.
function lerFiltrosLancamentos(tipo) {
  return {
    tipo,
    status:       obterSelecionadosMulti(tipo, 'status'),
    de:           document.getElementById(`filtro-de-${tipo}`)?.value || '',
    ate:          document.getElementById(`filtro-ate-${tipo}`)?.value || '',
    campoData:    document.getElementById(`filtro-tipo-data-${tipo}`)?.value || 'vencimento',
    fornecedores: obterSelecionadosMulti(tipo, 'fornecedor'),
    grupos:       obterSelecionadosMulti(tipo, 'grupo'),
    bancos:       obterBancosSelecionados(tipo),
    pedido:       document.getElementById(`filtro-pedido-${tipo}`)?.value?.trim() || '',
  };
}

// Aplica esses filtros numa query do Supabase.
function aplicarFiltrosLancamentos(query, f) {
  query = query.eq('tipo', f.tipo);
  if (f.status.length)       query = query.in('status', f.status);
  if (f.de)                  query = query.gte(f.campoData, f.de);
  if (f.ate)                 query = query.lte(f.campoData, f.ate);
  if (f.fornecedores.length) query = query.in('fornecedor_id', f.fornecedores);
  if (f.pedido)              query = query.ilike('descricao', `%Pedido%${f.pedido}%`);
  if (f.grupos.length) {
    const subcatIds = planoContas.filter(p => f.grupos.includes(p.grupo_id)).map(p => p.id);
    query = subcatIds.length ? query.in('plano_conta_id', subcatIds)
                             : query.eq('plano_conta_id', 'nenhum');
  }
  if (f.bancos.length)       query = query.in('banco_id', f.bancos);
  return query;
}

// Traz TODOS os lançamentos que passam pelo filtro, em blocos de 1.000
// (o Supabase devolve no máximo 1.000 linhas por resposta). Um mês fechado de
// Contas a Pagar tem ~1.700 contas, então sem isso a tela mostrava só parte.
// A ordenação inclui o id como desempate: com muitas contas de mesmo
// vencimento, sem um critério estável o banco pode devolver a mesma linha em
// dois blocos — ou pular uma.
async function buscarLancamentosFiltrados(db, filtros, select) {
  const PAGE = 1000;
  let todos = [], pagina = 0;
  while (true) {
    const qr = aplicarFiltrosLancamentos(
      db.from('lancamentos')
        .select(select)
        .order('vencimento', { ascending: true })
        .order('id', { ascending: true })
        .range(pagina * PAGE, (pagina + 1) * PAGE - 1),
      filtros
    );
    const { data: lote, error } = await qr;
    if (error) throw new Error(error.message);
    if (!lote || !lote.length) break;
    todos = todos.concat(lote);
    if (lote.length < PAGE) break;
    if (++pagina > 50) break;   // trava de segurança: 50.000 linhas
  }
  return todos;
}

const SELECT_LANCAMENTOS = '*, plano_contas(nome, grupo_id), bancos(nome), fornecedores(nome), unidades(nome)';

async function carregarLancamentos(tipo) {
  if (!(await garantirSessao())) return;
  const db = obterSupabase();
  const filtros = lerFiltrosLancamentos(tipo);

  const tbody   = document.getElementById(`tbody-${tipo}`);
  const colspan = tipo === 'pagar' ? '9' : '8';
  if (tbody) tbody.innerHTML = `<tr><td colspan="${colspan}" class="sem-dados"><i class="fas fa-spinner fa-spin" style="margin-right:6px;color:#c0392b;"></i>Carregando...</td></tr>`;

  // Uma única busca serve a tabela E os cards de total — antes eram duas
  // consultas, e só a dos cards trazia o mês inteiro.
  let todos;
  try {
    todos = await Promise.race([
      buscarLancamentosFiltrados(db, filtros, SELECT_LANCAMENTOS),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 60000))
    ]);
  } catch (e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="${colspan}" class="sem-dados" style="color:#e74c3c;"><i class="fas fa-wifi" style="margin-right:6px;"></i>Conexão lenta. <a href="javascript:void(0)" onclick="carregarLancamentos('${tipo}')" style="color:#c0392b;font-weight:600;">Tentar novamente</a></td></tr>`;
    return;
  }

  const hoje  = new Date().toISOString().split('T')[0];

  // Armazena dados para re-ordenação
  dadosLancamentos[tipo] = todos;
  const lancamentos     = dadosLancamentos[tipo];
  const todosParaTotais = todos;

  // ── Totais ────────────────────────────────────────────────────────────────
  const resumoEl = document.getElementById(`resumo-${tipo}`);
  if (resumoEl) {
    if (lancamentos.length === 0) {
      resumoEl.style.display = 'none';
    } else {
      const tPagos    = todosParaTotais.filter(l => l.status === 'pago');
      const tVencidos = todosParaTotais.filter(l => l.status === 'pendente' && l.vencimento < hoje);
      const tAbertos  = todosParaTotais.filter(l => l.status === 'pendente' && l.vencimento >= hoje);
      const soma = arr => arr.reduce((s, l) => s + Number(l.valor), 0);
      const totalGeral   = soma(todosParaTotais);
      const totalPago    = soma(tPagos);
      const totalVencido = soma(tVencidos);
      const totalAberto  = soma(tAbertos);

      const set = (id, val, qtd) => {
        const el = document.getElementById(id);
        if (el) el.textContent = formatarMoeda(val);
        const elQ = document.getElementById(id + '-qtd');
        if (elQ) elQ.textContent = qtd > 0 ? `${qtd} conta${qtd > 1 ? 's' : ''}` : '';
      };

      resumoEl.style.display = 'flex';
      set(`resumo-${tipo}-total`,   totalGeral,   todosParaTotais.length);
      if (tipo === 'pagar') {
        set(`resumo-${tipo}-aberto`,  totalAberto,  tAbertos.length);
        set(`resumo-${tipo}-vencido`, totalVencido, tVencidos.length);
      } else {
        set(`resumo-${tipo}-aberto`,  totalAberto + totalVencido, tAbertos.length + tVencidos.length);
      }
      set(`resumo-${tipo}-pago`, totalPago, tPagos.length);
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  renderizarLinhasLancamentos(tipo, lancamentos);
  if (tipo === 'pagar') atualizarBotaoPagarLote();
}

// =========================================================
// EXPORTAÇÃO PARA EXCEL
// Botão no topo de Contas a Pagar, Contas a Receber e Conciliação.
// Sempre exporta obedecendo os filtros aplicados na tela.
// =========================================================

let _concilExport = null;   // preenchido por carregarConciliacao()

// Converte 'AAAA-MM-DD' num Date local (evita o fuso jogar para o dia anterior).
function _dataExcel(str) {
  if (!str) return '';
  const [a, m, d] = String(str).split('-').map(Number);
  if (!a || !m || !d) return '';
  return new Date(a, m - 1, d);
}

// Monta a planilha, aplica formatos e baixa o arquivo.
function _baixarExcel(abas, nomeArquivo) {
  const wb = XLSX.utils.book_new();
  for (const aba of abas) {
    const ws = XLSX.utils.aoa_to_sheet(aba.linhas, { cellDates: true });
    if (aba.larguras) ws['!cols'] = aba.larguras.map(w => ({ wch: w }));
    if (aba.linhas.length) ws['!autofilter'] = { ref: XLSX.utils.encode_range({
      s: { r: 0, c: 0 }, e: { r: aba.linhas.length - 1, c: aba.linhas[0].length - 1 } }) };
    // Formata as colunas de data e de dinheiro
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let R = 1; R <= range.e.r; R++) {
      for (let C = 0; C <= range.e.c; C++) {
        const cel = ws[XLSX.utils.encode_cell({ r: R, c: C })];
        if (!cel) continue;
        if (aba.colsData?.includes(C)  && cel.t === 'd') cel.z = 'dd/mm/yyyy';
        if (aba.colsMoeda?.includes(C) && cel.t === 'n') cel.z = '#,##0.00';
      }
    }
    XLSX.utils.book_append_sheet(wb, ws, aba.nome);
  }
  XLSX.writeFile(wb, nomeArquivo);
}

function _hojeArquivo() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function _rotuloFiltro(id, padrao) {
  const t = document.getElementById(id)?.textContent?.trim();
  return t || padrao;
}

// Trava o botão enquanto gera (arquivo grande demora alguns segundos).
function _btnExportando(id, ligado) {
  const btn = document.getElementById(id);
  if (!btn) return null;
  if (ligado) {
    btn.dataset.htmlOriginal = btn.innerHTML;
    btn.disabled = true;
    btn.style.opacity = '.6';
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Gerando...';
  } else {
    btn.disabled = false;
    btn.style.opacity = '';
    if (btn.dataset.htmlOriginal) btn.innerHTML = btn.dataset.htmlOriginal;
  }
}

// ---------------------------------------------------------
// CONTAS A PAGAR / CONTAS A RECEBER
// ---------------------------------------------------------
async function exportarLancamentosExcel(tipo) {
  const btnId = `btn-exportar-${tipo}`;
  if (document.getElementById(btnId)?.disabled) return;
  if (!(await garantirSessao())) return;
  const db = obterSupabase();
  const filtros = lerFiltrosLancamentos(tipo);
  _btnExportando(btnId, true);

  try {
    // Mesma busca paginada da tela, para o arquivo nunca divergir dela.
    const linhas = await buscarLancamentosFiltrados(db, filtros, SELECT_LANCAMENTOS);

    if (!linhas.length) { mostrarToast('Nenhuma conta no filtro atual — nada a exportar.', 'erro'); return; }

    const hoje     = new Date().toISOString().split('T')[0];
    const ehPagar  = tipo === 'pagar';
    const rotuloOk = ehPagar ? 'Pago' : 'Recebido';

    const cabecalho = ['Pedido', ehPagar ? 'Fornecedor' : 'Cliente / Fornecedor', 'Descrição',
      'Categoria', 'Unidade', 'Banco', 'Vencimento', 'Data de Pagamento', 'Valor',
      'Valor Pago', 'Status', 'Rateio', 'Conciliado no extrato', 'Observações'];

    const corpo = linhas.map(l => {
      const atrasado = l.status === 'pendente' && l.vencimento < hoje;
      const status   = l.status === 'pago' ? rotuloOk : (atrasado ? 'Vencido' : 'Pendente');
      return [
        l.numero_pedido || extrairNumeroPedido(l.descricao) || '',
        l.fornecedores?.nome || '',
        l.descricao || '',
        l.plano_contas?.nome || (l.tem_rateio ? 'Rateio' : ''),
        l.unidades?.nome || '',
        l.bancos?.nome || '',
        _dataExcel(l.vencimento),
        _dataExcel(l.data_pagamento),
        Number(l.valor) || 0,
        Number(l.valor_pago) || 0,
        status,
        l.tem_rateio ? 'Sim' : '',
        l.ofx_id ? 'Sim' : '',
        l.observacoes || '',
      ];
    });

    const total    = corpo.reduce((soma, r) => soma + r[8], 0);
    const periodo  = filtros.campoData === 'data_pagamento' ? 'Data de pagamento' : 'Vencimento';
    const de       = filtros.de  ? formatarData(filtros.de)  : 'sem início';
    const ate      = filtros.ate ? formatarData(filtros.ate) : 'sem fim';
    const titulo   = ehPagar ? 'Contas a Pagar' : 'Contas a Receber';

    _baixarExcel([
      { nome: titulo.slice(0, 31),
        linhas: [cabecalho, ...corpo],
        colsData: [6, 7], colsMoeda: [8, 9],
        larguras: [10, 28, 42, 24, 16, 18, 13, 15, 14, 13, 11, 8, 12, 30] },
      { nome: 'Filtros', larguras: [26, 60], linhas: [
        ['Filtro', 'Aplicado'],
        ['Tela', titulo],
        ['Gerado em', new Date().toLocaleString('pt-BR')],
        ['Status', _rotuloFiltro(`filtro-status-label-${tipo}`, 'Todos os status')],
        ['Período por', periodo],
        ['De', de],
        ['Até', ate],
        ['Fornecedor', _rotuloFiltro(`filtro-fornecedor-label-${tipo}`, 'Todos os fornecedores')],
        ['Grupo', _rotuloFiltro(`filtro-grupo-label-${tipo}`, 'Todos os grupos')],
        ['Banco', _rotuloFiltro(`filtro-banco-label-${tipo}`, 'Todos os bancos')],
        ['Nº do pedido', filtros.pedido || '—'],
        ['Linhas exportadas', corpo.length],
        ['Soma dos valores', formatarMoeda(total)],
      ]},
    ], `${ehPagar ? 'contas-a-pagar' : 'contas-a-receber'}-${_hojeArquivo()}.xlsx`);

    mostrarToast(`✅ ${corpo.length} linha(s) exportada(s).`, 'sucesso');
  } catch (e) {
    mostrarToast('Erro ao gerar a planilha: ' + (e?.message || e), 'erro');
  } finally {
    _btnExportando(btnId, false);
  }
}

// ---------------------------------------------------------
// CONCILIAÇÃO DIÁRIA
// ---------------------------------------------------------
function exportarConciliacaoExcel() {
  if (!_concilExport) {
    mostrarToast('Clique em "Buscar" primeiro para carregar o período.', 'erro');
    return;
  }
  const btnId = 'btn-exportar-conciliacao';
  _btnExportando(btnId, true);
  try {
    const { mes, ano, lastDay, porDia, unidades, bancos } = _concilExport;
    const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto',
                   'Setembro','Outubro','Novembro','Dezembro'];
    const diasSemana = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];

    const corpo = [];
    let totalRec = 0, totalDesp = 0;
    for (let d = 1; d <= lastDay; d++) {
      const { rec, desp } = porDia[d];
      totalRec += rec; totalDesp += desp;
      corpo.push([_dataExcel(`${ano}-${String(mes).padStart(2,'0')}-${String(d).padStart(2,'0')}`),
                  diasSemana[new Date(ano, mes - 1, d).getDay()], rec, desp, rec - desp]);
    }
    corpo.push(['TOTAL', '', totalRec, totalDesp, totalRec - totalDesp]);

    _baixarExcel([
      { nome: `${meses[mes-1]} ${ano}`.slice(0, 31),
        linhas: [['Dia', 'Dia da semana', 'Receitas', 'Despesas', 'Resultado'], ...corpo],
        colsData: [0], colsMoeda: [2, 3, 4],
        larguras: [13, 16, 16, 16, 16] },
      { nome: 'Filtros', larguras: [26, 60], linhas: [
        ['Filtro', 'Aplicado'],
        ['Tela', 'Conciliação Diária'],
        ['Gerado em', new Date().toLocaleString('pt-BR')],
        ['Mês', `${meses[mes-1]} de ${ano}`],
        ['Unidades', unidades],
        ['Bancos', bancos],
        ['Total de receitas', formatarMoeda(totalRec)],
        ['Total de despesas', formatarMoeda(totalDesp)],
        ['Resultado', formatarMoeda(totalRec - totalDesp)],
      ]},
    ], `conciliacao-${ano}-${String(mes).padStart(2,'0')}.xlsx`);

    mostrarToast('✅ Planilha gerada.', 'sucesso');
  } catch (e) {
    mostrarToast('Erro ao gerar a planilha: ' + (e?.message || e), 'erro');
  } finally {
    _btnExportando(btnId, false);
  }
}

// Extrai o número do pedido da descrição (padrão da integração: "Pedido #00093 — Fornecedor")
function extrairNumeroPedido(descricao) {
  const m = (descricao || '').match(/Pedido\s+(#?\d+)/i);
  if (!m) return '';
  return m[1].startsWith('#') ? m[1] : `#${m[1]}`;
}

function renderizarLinhasLancamentos(tipo, lancamentos) {
  const hoje   = new Date().toISOString().split('T')[0];
  const tbody  = document.getElementById(`tbody-${tipo}`);
  const colspan = tipo === 'pagar' ? '9' : '8';
  const labelPagar = tipo === 'pagar' ? 'Pago' : 'Recebido';
  if (!tbody) return;

  if (lancamentos.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${colspan}" class="sem-dados">
      Nenhuma conta encontrada.
      <a href="javascript:void(0)" onclick="carregarLancamentos('${tipo}')"
         style="margin-left:10px;color:#c0392b;font-weight:600;font-size:12px;">
        <i class="fas fa-sync-alt"></i> Recarregar
      </a>
    </td></tr>`;
    if (tipo === 'pagar') { const b = document.getElementById('btn-pagar-lote'); if (b) b.style.display = 'none'; }
    return;
  }

  // Aplica ordenação
  const { col, dir } = sortEstado[tipo];
  const sorted = [...lancamentos].sort((a, b) => {
    let va, vb;
    if (col === 'pedido') { va = extrairNumeroPedido(a.descricao); vb = extrairNumeroPedido(b.descricao); }
    else if (col === 'fornecedor') { va = (a.fornecedores?.nome || '').toLowerCase(); vb = (b.fornecedores?.nome || '').toLowerCase(); }
    else if (col === 'unidade') { va = (a.unidades?.nome || '').toLowerCase(); vb = (b.unidades?.nome || '').toLowerCase(); }
    else if (col === 'descricao') { va = (a.descricao || '').toLowerCase(); vb = (b.descricao || '').toLowerCase(); }
    else if (col === 'categoria') { va = (a.plano_contas?.nome || '').toLowerCase(); vb = (b.plano_contas?.nome || '').toLowerCase(); }
    else if (col === 'banco') { va = (a.bancos?.nome || '').toLowerCase(); vb = (b.bancos?.nome || '').toLowerCase(); }
    else if (col === 'vencimento') { va = a.vencimento || ''; vb = b.vencimento || ''; }
    else if (col === 'valor') { va = Number(a.valor); vb = Number(b.valor); }
    else if (col === 'status') { va = a.status || ''; vb = b.status || ''; }
    else { va = a.vencimento || ''; vb = b.vencimento || ''; }
    if (va < vb) return dir === 'asc' ? -1 : 1;
    if (va > vb) return dir === 'asc' ?  1 : -1;
    return 0;
  });

  tbody.innerHTML = sorted.map(l => {
    const statusReal = (l.status === 'pendente' && l.vencimento < hoje) ? 'vencido' : l.status;
    const badgeTexto = statusReal === 'pago' ? labelPagar : statusReal.charAt(0).toUpperCase() + statusReal.slice(1);

    const subInfos = [];
    if (l.numero_pedido) subInfos.push(`<i class="fas fa-file-invoice"></i> ${l.numero_pedido}`);
    if (l.tem_rateio)         subInfos.push(`<i class="fas fa-code-branch"></i> Rateio`);
    if (l.ofx_id)             subInfos.push(`<i class="fas fa-university" style="color:#27ae60;"></i> <span style="color:#27ae60;font-weight:600;">Extrato conciliado</span> <a href="javascript:void(0)" onclick="desfazerConciliacaoLista('${l.id}','${tipo}')" title="Desfazer conciliação com o extrato" style="color:#e74c3c;font-size:11px;margin-left:6px;text-decoration:underline;"><i class="fas fa-unlink"></i> desfazer</a>`);
    if (Number(l.valor_pago) > 0 && l.status === 'pendente') {
      const restante = Number(l.valor) - Number(l.valor_pago);
      subInfos.push(`<i class="fas fa-coins" style="color:#e67e22;"></i> <span style="color:#e67e22;font-weight:600;">Pago parcial: ${formatarMoeda(Number(l.valor_pago))} — Restante: ${formatarMoeda(restante)}</span>`);
    }

    const acoes = `
      ${statusReal !== 'pago' ? `
        <button class="btn-icone pagar" title="${labelPagar}" onclick="marcarComoPago('${l.id}','${tipo}')">
          <i class="fas fa-check-circle"></i>
        </button>
        <button class="btn-icone" style="color:#2980b9;" title="Registrar Pagamento Parcial" onclick="registrarPagamento('${l.id}')">
          <i class="fas fa-coins"></i>
        </button>
        ${Number(l.valor_pago) > 0 ? `
        <button class="btn-icone" style="color:#e67e22;" title="Dar Baixa com Desconto" onclick="darBaixaComDesconto('${l.id}')">
          <i class="fas fa-hand-holding-usd"></i>
        </button>` : ''}` : ''}
      ${Number(l.valor_pago) > 0 ? `
      <button class="btn-icone" style="color:#8e44ad;" title="Histórico de Pagamentos" onclick="verHistoricoPagamentos('${l.id}')">
        <i class="fas fa-receipt"></i>
      </button>` : ''}
      <button class="btn-icone editar" title="Editar" onclick="editarLancamento('${l.id}','${tipo}')">
        <i class="fas fa-edit"></i>
      </button>
      <button class="btn-icone excluir" title="Excluir" onclick="excluirLancamento('${l.id}')">
        <i class="fas fa-trash"></i>
      </button>`;

    const descCell = `
      <td>
        <div class="desc-principal">${l.descricao}</div>
        ${subInfos.map(s => `<div class="desc-sub">${s}</div>`).join('')}
      </td>`;
    const numPedido = extrairNumeroPedido(l.descricao);
    const pedidoCell = `<td style="font-size:13px;white-space:nowrap;">${numPedido
      ? `<span style="color:#FF6B35;font-weight:600;"><i class="fas fa-hashtag" style="font-size:11px;"></i> ${numPedido}</span>`
      : '<span style="color:#ccc;">—</span>'}</td>`;
    const fornCell  = `<td style="font-size:13px;color:#555;">${l.fornecedores?.nome || '-'}</td>`;
    const uniCell   = `<td style="font-size:13px;color:#555;">${l.unidades?.nome || '-'}</td>`;
    const bancoCell = `<td style="font-size:13px;color:#555;">${l.bancos?.nome || '-'}</td>`;
    const catCell   = `<td>${l.plano_contas?.nome || (l.tem_rateio ? '<em style="color:#2980b9">Rateio</em>' : '-')}</td>`;
    const datCell  = `<td>${formatarData(l.vencimento)}</td>`;
    const valCell  = `<td style="white-space:nowrap;"><strong>${formatarMoeda(l.valor)}</strong></td>`;
    const stCell   = `<td><span class="badge badge-${statusReal}">${badgeTexto}</span></td>`;
    const actCell  = `<td>${acoes}</td>`;

    if (tipo === 'pagar') {
      return `<tr>
        <td><input type="checkbox" class="cb-pagar" data-id="${l.id}" data-valor="${l.valor}"
          onchange="atualizarBotaoPagarLote()"></td>
        ${pedidoCell}${fornCell}${descCell}${catCell}${datCell}${valCell}${stCell}${actCell}
      </tr>`;
    } else {
      return `<tr>${uniCell}${descCell}${catCell}${bancoCell}${datCell}${valCell}${stCell}${actCell}</tr>`;
    }
  }).join('');

  if (tipo === 'pagar') atualizarBotaoPagarLote();
}

function ordenarTabela(tipo, col) {
  const estado = sortEstado[tipo];
  if (estado.col === col) {
    estado.dir = estado.dir === 'asc' ? 'desc' : 'asc';
  } else {
    estado.col = col;
    estado.dir = 'asc';
  }

  // Atualiza ícones
  ['pedido','fornecedor','unidade','descricao','categoria','banco','vencimento','valor','status'].forEach(c => {
    const el = document.getElementById(`sort-${tipo}-${c}`);
    if (el) el.textContent = '';
  });
  const icon = document.getElementById(`sort-${tipo}-${col}`);
  if (icon) icon.textContent = estado.dir === 'asc' ? '▲' : '▼';

  renderizarLinhasLancamentos(tipo, dadosLancamentos[tipo]);
}

function abrirModal(idModal) {
  const tipo = idModal.includes('pagar') ? 'pagar' : 'receber';
  document.getElementById(idModal).classList.remove('hidden');
  document.getElementById(`${tipo}-id`).value           = '';
  document.getElementById(`${tipo}-descricao`).value    = '';
  document.getElementById(`${tipo}-valor`).value        = '';
  document.getElementById(`${tipo}-vencimento`).value   = new Date().toISOString().split('T')[0];
  document.getElementById(`${tipo}-plano-conta`).value  = '';
  document.getElementById(`${tipo}-banco`).value        = '';
  document.getElementById(`${tipo}-status`).value       = 'pendente';
  document.getElementById(`${tipo}-observacoes`).value  = '';
  document.getElementById(`grupo-data-pagamento-${tipo}`).style.display = 'none';

  const acrescEl = document.getElementById(`${tipo}-acrescimo`);
  if (acrescEl) acrescEl.value = '0';
  const descontoEl = document.getElementById(`${tipo}-desconto`);
  if (descontoEl) descontoEl.value = '0';
  const totalEl = document.getElementById(`${tipo}-valor-total`);
  if (totalEl) totalEl.value = '';

  const formaPagto = document.getElementById(`${tipo}-forma-pagamento`);
  if (formaPagto) formaPagto.value = '';
  const centroCusto = document.getElementById(`${tipo}-centro-custo`);
  if (centroCusto) centroCusto.value = '';

  const avisDup = document.getElementById(`aviso-duplicado-${tipo}`);
  if (avisDup) avisDup.classList.add('hidden');

  if (tipo === 'pagar') {
    const el = (id) => document.getElementById(id);
    if (el('pagar-fornecedor'))    el('pagar-fornecedor').value    = '';
    preencherNFsPagar('');
    if (el('pagar-tipo-documento'))el('pagar-tipo-documento').value= '';
    if (el('pagar-unidade'))       el('pagar-unidade').value       = '';
    const temRateio = el('pagar-tem-rateio');
    if (temRateio) temRateio.checked = false;
    const rateioSection = el('rateio-pagar-section');
    if (rateioSection) rateioSection.classList.add('hidden');
    rateioAtualPagar = [];
  }
  if (tipo === 'receber') {
    const el = document.getElementById('receber-numero-pedido');
    if (el) el.value = '';
  }

  document.getElementById(`${tipo}-status`).onchange = function() {
    document.getElementById(`grupo-data-pagamento-${tipo}`).style.display =
      this.value === 'pago' ? 'flex' : 'none';
  };
}

function fecharModal(idModal) {
  document.getElementById(idModal).classList.add('hidden');
  // Fechou sem salvar: o pagamento do caixa continua pendente.
  if (idModal === 'modal-pagar') _cxqPendente = null;
}

async function verificarDuplicadoPedido(tipo) {
  const numero = document.getElementById(`${tipo}-numero-pedido`)?.value.trim();
  const aviso  = document.getElementById(`aviso-duplicado-${tipo}`);
  if (!aviso) return;

  if (!numero) { aviso.classList.add('hidden'); return; }

  const idAtual = document.getElementById(`${tipo}-id`)?.value;
  const db = obterSupabase();
  let query = db.from('lancamentos')
    .select('id, descricao, valor, vencimento')
    .eq('numero_pedido', numero)
    .limit(1);
  if (idAtual) query = query.neq('id', idAtual);

  const { data } = await query;
  const found = data?.[0];

  if (found) {
    aviso.classList.remove('hidden');
    aviso.innerHTML = `<i class="fas fa-exclamation-triangle"></i>
      Já existe um lançamento com este número:
      <strong>${found.descricao}</strong> — ${formatarMoeda(found.valor)}
      (venc. ${formatarData(found.vencimento)})`;
  } else {
    aviso.classList.add('hidden');
  }
}

async function salvarLancamento(tipo, btnEl) {
  if (btnEl) { btnEl.disabled = true; btnEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...'; }
  const restaurarBtn = () => {
    if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = '<i class="fas fa-save"></i> Salvar'; }
  };
  const timeoutId = setTimeout(() => {
    restaurarBtn();
    mostrarToast('A operação demorou muito. Tente novamente.', 'erro');
  }, 60000);
  const restaurarComTimeout = () => { clearTimeout(timeoutId); restaurarBtn(); };
  if (!await garantirSessao()) { restaurarComTimeout(); return; }
  try {
  const db = obterSupabase();
  const id          = document.getElementById(`${tipo}-id`).value;
  const descricao   = document.getElementById(`${tipo}-descricao`).value.trim();
  const valorNota   = parseMoeda(document.getElementById(`${tipo}-valor`).value);
  const acrescimo   = parseMoeda(document.getElementById(`${tipo}-acrescimo`)?.value);
  const desconto    = parseMoeda(document.getElementById(`${tipo}-desconto`)?.value);
  const valor       = Math.max(0, valorNota + acrescimo - desconto);
  const vencimento  = document.getElementById(`${tipo}-vencimento`).value;
  const planoConta  = document.getElementById(`${tipo}-plano-conta`).value || null;
  const bancoId     = document.getElementById(`${tipo}-banco`).value || null;
  const status      = document.getElementById(`${tipo}-status`).value;
  const dataPgto    = document.getElementById(`${tipo}-data-pagamento`)?.value || null;
  const observacoes = document.getElementById(`${tipo}-observacoes`).value.trim();
  const formaPagtoId  = document.getElementById(`${tipo}-forma-pagamento`)?.value || null;
  const centroCustoId = document.getElementById(`${tipo}-centro-custo`)?.value || null;

  if (tipo === 'pagar' && !descricao) { mostrarToast('Informe a descrição!', 'erro'); restaurarComTimeout(); return; }
  if (!valorNota || valorNota <= 0) { mostrarToast('Informe um valor válido!', 'erro'); restaurarComTimeout(); return; }
  if (!vencimento) { mostrarToast('Informe a data!', 'erro'); restaurarComTimeout(); return; }
  if (status === 'pago' && !bancoId) { mostrarToast('Selecione o Banco / Caixa onde o valor foi recebido!', 'erro'); restaurarComTimeout(); return; }

  const numeroPedido = tipo === 'pagar' ? obterNFsPagar() : '';
  if (numeroPedido) {
    let qDup = db.from('lancamentos').select('id, descricao, valor, vencimento')
      .eq('numero_pedido', numeroPedido).limit(1);
    if (id) qDup = qDup.neq('id', id);
    const { data: dupData } = await qDup;
    if (dupData?.[0]) {
      const d = dupData[0];
      const continuar = confirm(
        `O pedido/NF "${numeroPedido}" já está cadastrado:\n"${d.descricao}" — ${formatarMoeda(d.valor)} (venc. ${formatarData(d.vencimento)})\n\nDeseja salvar mesmo assim?`
      );
      if (!continuar) { restaurarComTimeout(); return; }
    }
  }

  const temRateio = tipo === 'pagar' && (document.getElementById('pagar-tem-rateio')?.checked || false);

  const dados = {
    descricao, valor, vencimento, tipo,
    acrescimo,
    desconto,
    plano_conta_id:      planoConta,
    banco_id:            bancoId,
    status,
    data_pagamento:      status === 'pago' ? (dataPgto || vencimento) : null,
    observacoes:         observacoes || null,
    forma_pagamento_id:  formaPagtoId,
    centro_custo_id:     centroCustoId,
    tem_rateio:          temRateio
  };

  if (tipo === 'pagar') {
    dados.fornecedor_id  = document.getElementById('pagar-fornecedor')?.value || null;
    dados.numero_pedido  = numeroPedido || null;
    dados.tipo_documento = document.getElementById('pagar-tipo-documento')?.value || null;
    dados.unidade_id     = document.getElementById('pagar-unidade')?.value || null;
  }
  if (tipo === 'receber') {
    dados.unidade_id = document.getElementById('receber-unidade')?.value || null;
  }

  let lancamentoId;
  if (id) {
    // Nunca altera o campo tipo em edições — evita despesa virar receita e vice-versa
    const { tipo: _tipo, ...dadosSemTipo } = dados;
    const { error } = await q(db.from('lancamentos').update(dadosSemTipo).eq('id', id))
    if (tratarErro(error, 'Erro ao salvar')) { restaurarComTimeout(); return; }
    lancamentoId = id;
  } else {
    const { data: novo, error } = await q(db.from('lancamentos').insert([dados]).select().single())
    if (tratarErro(error, 'Erro ao salvar')) { restaurarComTimeout(); return; }
    lancamentoId = novo.id;
  }

  // Salvar rateio
  if (tipo === 'pagar') {
    await q(db.from('rateio_itens').delete().eq('lancamento_id', lancamentoId))
    if (temRateio && rateioAtualPagar.length > 0) {
      const rateioData = rateioAtualPagar
        .filter(r => r.plano_conta_id && r.valor > 0)
        .map(r => ({
          lancamento_id:  lancamentoId,
          plano_conta_id: r.plano_conta_id,
          valor:          r.valor,
          descricao:      r.descricao || null
        }));
      if (rateioData.length > 0) {
        await q(db.from('rateio_itens').insert(rateioData))
      }
    }
  }

  mostrarToast(id ? 'Lançamento atualizado!' : 'Lançamento salvo!', 'sucesso');
  restaurarComTimeout();
  // Veio da Conciliação do Dinheiro? Amarra o pagamento do caixa a esta conta.
  if (!id && tipo === 'pagar' && _cxqPendente) await cxqVincularSalvo(lancamentoId, planoConta);
  fecharModal(`modal-${tipo}`);
  carregarLancamentos(tipo);
  carregarDashboard();
  } catch (err) {
    restaurarComTimeout();
    mostrarToast('Erro ao salvar. Verifique sua conexão e tente novamente.', 'erro');
  }
}

async function editarLancamento(id, tipo) {
  const db = obterSupabase();
  const { data, error } = await db.from('lancamentos').select('*').eq('id', id).single();
  if (error || !data) { mostrarToast('Erro ao carregar lançamento.', 'erro'); return; }

  abrirModal(`modal-${tipo}`);
  const acrescimo = Number(data.acrescimo) || 0;
  const desconto  = Number(data.desconto)  || 0;
  const valorNota = Math.max(0, Number(data.valor) - acrescimo + desconto);

  document.getElementById(`${tipo}-id`).value          = data.id;
  document.getElementById(`${tipo}-descricao`).value   = data.descricao;
  setValorMoeda(`${tipo}-valor`, valorNota);
  document.getElementById(`${tipo}-vencimento`).value  = data.vencimento;
  document.getElementById(`${tipo}-plano-conta`).value = data.plano_conta_id || '';
  document.getElementById(`${tipo}-banco`).value       = data.banco_id || '';
  document.getElementById(`${tipo}-status`).value      = data.status;
  document.getElementById(`${tipo}-observacoes`).value = data.observacoes || '';

  const acrescEl = document.getElementById(`${tipo}-acrescimo`);
  if (acrescEl) setValorMoeda(`${tipo}-acrescimo`, acrescimo);
  const descontoEl = document.getElementById(`${tipo}-desconto`);
  if (descontoEl) setValorMoeda(`${tipo}-desconto`, desconto);
  calcularTotalLancamento(tipo);

  const formaPagto = document.getElementById(`${tipo}-forma-pagamento`);
  if (formaPagto) formaPagto.value = data.forma_pagamento_id || '';
  const centroCusto = document.getElementById(`${tipo}-centro-custo`);
  if (centroCusto) centroCusto.value = data.centro_custo_id || '';

  if (tipo === 'receber') {
    const uniEl = document.getElementById('receber-unidade');
    if (uniEl) uniEl.value = data.unidade_id || '';
  }

  if (tipo === 'pagar') {
    const el = (id) => document.getElementById(id);
    if (el('pagar-fornecedor'))     el('pagar-fornecedor').value     = data.fornecedor_id || '';
    preencherNFsPagar(data.numero_pedido || '');
    if (el('pagar-tipo-documento')) el('pagar-tipo-documento').value = data.tipo_documento || '';
    if (el('pagar-unidade'))        el('pagar-unidade').value        = data.unidade_id || '';

    if (data.tem_rateio) {
      const temRateioEl = el('pagar-tem-rateio');
      if (temRateioEl) temRateioEl.checked = true;
      const rateioSection = el('rateio-pagar-section');
      if (rateioSection) rateioSection.classList.remove('hidden');
      const { data: rateioData } = await db.from('rateio_itens').select('*').eq('lancamento_id', id);
      rateioAtualPagar = (rateioData || []).map(r => ({
        plano_conta_id: r.plano_conta_id || '',
        valor:          Number(r.valor),
        descricao:      r.descricao || ''
      }));
      renderizarRateio('pagar');
    }
  }

  if (data.status === 'pago') {
    document.getElementById(`grupo-data-pagamento-${tipo}`).style.display = 'flex';
    document.getElementById(`${tipo}-data-pagamento`).value = data.data_pagamento || '';
  }
  document.getElementById(`${tipo}-status`).onchange = function() {
    document.getElementById(`grupo-data-pagamento-${tipo}`).style.display =
      this.value === 'pago' ? 'flex' : 'none';
  };
}

async function marcarComoPago(id, tipo) {
  if (!await garantirSessao()) return;
  const db = obterSupabase();
  const { data: l } = await db.from('lancamentos').select('banco_id').eq('id', id).single();
  if (!l?.banco_id) {
    mostrarToast('Edite o lançamento e selecione o Banco / Caixa antes de marcar como recebido.', 'erro');
    return;
  }
  const hoje = new Date().toISOString().split('T')[0];
  const { error } = await q(db.from('lancamentos').update({ status: 'pago', data_pagamento: hoje }).eq('id', id));
  if (error) { mostrarToast('Erro ao atualizar.', 'erro'); return; }
  mostrarToast(tipo === 'pagar' ? 'Conta marcada como paga!' : 'Entrada marcada como recebida!', 'sucesso');
  carregarLancamentos(tipo);
  carregarDashboard();
}

function excluirLancamento(id) {
  idParaExcluir = id;
  fnExcluirAtual = async () => {
    const db = obterSupabase();
    const { error } = await q(db.from('lancamentos').delete().eq('id', idParaExcluir))
    fecharModal('modal-excluir');
    if (error) { mostrarToast('Erro ao excluir.', 'erro'); return; }
    mostrarToast('Lançamento excluído!', 'sucesso');
    const paginaAtiva = document.querySelector('.pagina.ativa')?.id;
    if (paginaAtiva === 'pagina-pagar')   carregarLancamentos('pagar');
    if (paginaAtiva === 'pagina-receber') carregarLancamentos('receber');
    carregarDashboard();
  };
  document.getElementById('modal-excluir').classList.remove('hidden');
}

async function confirmarExclusao() {
  if (fnExcluirAtual) await fnExcluirAtual();
  fnExcluirAtual = null;
  idParaExcluir = null;
}

// =========================================================
// RATEIO
// =========================================================
function toggleRateio(tipo) {
  const checked = document.getElementById(`${tipo}-tem-rateio`)?.checked;
  const section = document.getElementById(`rateio-${tipo}-section`);
  if (!section) return;
  if (checked) {
    section.classList.remove('hidden');
    if (rateioAtualPagar.length === 0) adicionarLinhaRateio(tipo);
  } else {
    section.classList.add('hidden');
  }
}

function adicionarLinhaRateio(tipo) {
  rateioAtualPagar.push({ plano_conta_id: '', valor: 0, descricao: '' });
  renderizarRateio(tipo);
}

function removerLinhaRateio(tipo, idx) {
  rateioAtualPagar.splice(idx, 1);
  renderizarRateio(tipo);
}

function renderizarRateio(tipo) {
  const container = document.getElementById(`rateio-${tipo}-itens`);
  if (!container) return;

  container.innerHTML = rateioAtualPagar.map((item, i) => {
    const subcats = planoContas.filter(p => p.tipo === tipo && p.grupo_id);
    const grupos  = planoContas.filter(p => p.tipo === tipo && !p.grupo_id);
    let opts = '<option value="">Categoria...</option>';
    grupos.forEach(g => {
      const subs = subcats.filter(s => s.grupo_id === g.id);
      if (!subs.length) return;
      opts += `<optgroup label="${g.nome}">`;
      subs.forEach(s => {
        opts += `<option value="${s.id}" ${s.id === item.plano_conta_id ? 'selected' : ''}>${s.nome}</option>`;
      });
      opts += '</optgroup>';
    });
    return `
      <div class="rateio-item">
        <select class="rateio-cat" onchange="rateioAtualPagar[${i}].plano_conta_id=this.value">${opts}</select>
        <input type="text" inputmode="decimal" class="rateio-valor input-moeda" value="${item.valor > 0 ? Number(item.valor).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}) : ''}"
          placeholder="R$ valor"
          onchange="rateioAtualPagar[${i}].valor=parseMoeda(this.value); atualizarTotalRateio('${tipo}')"
          oninput="rateioAtualPagar[${i}].valor=parseMoeda(this.value); atualizarTotalRateio('${tipo}')">
        <input type="text" class="rateio-desc" value="${item.descricao || ''}"
          placeholder="Descrição (opcional)"
          onchange="rateioAtualPagar[${i}].descricao=this.value">
        <button type="button" class="btn-icone excluir" onclick="removerLinhaRateio('${tipo}',${i})">
          <i class="fas fa-trash"></i>
        </button>
      </div>`;
  }).join('');

  atualizarTotalRateio(tipo);
}

function atualizarTotalRateio(tipo) {
  const total = rateioAtualPagar.reduce((s, i) => s + Number(i.valor || 0), 0);
  const totalEl = document.getElementById(`rateio-${tipo}-total`);
  const avisoEl = document.getElementById(`rateio-${tipo}-aviso`);
  if (totalEl) totalEl.textContent = formatarMoeda(total);
  if (avisoEl) {
    const totalEl = document.getElementById(`${tipo}-valor-total`);
    const valorConta = totalEl
      ? parseMoeda(totalEl.value)
      : parseMoeda(document.getElementById(`${tipo}-valor`)?.value);
    if (total > 0 && valorConta > 0 && Math.abs(total - valorConta) > 0.01) {
      avisoEl.classList.remove('hidden');
    } else {
      avisoEl.classList.add('hidden');
    }
  }
}

function calcularTotalLancamento(tipo) {
  const nota      = parseMoeda(document.getElementById(`${tipo}-valor`)?.value);
  const acrescimo = parseMoeda(document.getElementById(`${tipo}-acrescimo`)?.value);
  const desconto  = parseMoeda(document.getElementById(`${tipo}-desconto`)?.value);
  const total     = Math.max(0, nota + acrescimo - desconto);
  const totalEl   = document.getElementById(`${tipo}-valor-total`);
  if (totalEl) totalEl.value = total > 0
    ? total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '';
  if (tipo === 'pagar') atualizarTotalRateio('pagar');
}

// =========================================================
// PAGAR EM LOTE
// =========================================================
let idsParaPagarLote = [];

function selecionarTodosParaPagar(checked) {
  document.querySelectorAll('.cb-pagar').forEach(cb => cb.checked = checked);
  atualizarBotaoPagarLote();
}

function atualizarBotaoPagarLote() {
  const selecionados = document.querySelectorAll('.cb-pagar:checked');
  const btn   = document.getElementById('btn-pagar-lote');
  const qtd   = document.getElementById('qtd-selecionadas');
  const wrap  = document.getElementById('total-selecionadas-wrap');
  const total = document.getElementById('total-selecionadas-valor');

  const tem = selecionados.length > 0;
  if (btn)  btn.style.display  = tem ? 'inline-flex' : 'none';
  if (wrap) wrap.style.display = tem ? 'flex'        : 'none';
  if (qtd)  qtd.textContent    = selecionados.length;

  if (tem && total) {
    const soma = Array.from(selecionados).reduce((s, cb) => s + parseFloat(cb.dataset.valor || 0), 0);
    total.textContent = formatarMoeda(soma);
  }
}

function abrirModalPagarLote() {
  idsParaPagarLote = Array.from(document.querySelectorAll('.cb-pagar:checked')).map(cb => cb.dataset.id);
  if (!idsParaPagarLote.length) { mostrarToast('Selecione ao menos uma conta!', 'erro'); return; }
  document.getElementById('lote-qtd').textContent          = idsParaPagarLote.length;
  document.getElementById('lote-data-pagamento').value     = new Date().toISOString().split('T')[0];
  document.getElementById('lote-banco').innerHTML =
    '<option value="">Nenhum banco específico</option>' +
    bancosCadastrados.map(b => `<option value="${b.id}">${b.nome}</option>`).join('');
  document.getElementById('modal-pagar-lote').classList.remove('hidden');
}

async function confirmarPagamentoLote() {
  if (!await garantirSessao()) return;
  const dataPgto = document.getElementById('lote-data-pagamento').value;
  const bancoId  = document.getElementById('lote-banco').value || null;
  if (!dataPgto) { mostrarToast('Informe a data de pagamento!', 'erro'); return; }
  if (!idsParaPagarLote.length) return;

  const db = obterSupabase();
  await Promise.all(
    idsParaPagarLote.map(id =>
      db.from('lancamentos').update({ status: 'pago', data_pagamento: dataPgto, banco_id: bancoId }).eq('id', id)
    )
  );
  mostrarToast(`${idsParaPagarLote.length} conta(s) marcada(s) como paga(s)!`, 'sucesso');
  fecharModal('modal-pagar-lote');
  document.getElementById('cb-todos-pagar').checked = false;
  carregarLancamentos('pagar');
  carregarDashboard();
}

// =========================================================
// PLANO DE CONTAS
// =========================================================
function mostrarTabPlano(tipo, el) {
  tabPlanoAtiva = tipo;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('ativo'));
  el.classList.add('ativo');
  renderizarPlanoContas();
}

function renderizarPlanoContas() {
  const container = document.getElementById('lista-plano-contas');
  if (!container) return;

  const grupos  = planoContas.filter(p => p.tipo === tabPlanoAtiva && !p.grupo_id);
  const subcats = planoContas.filter(p => p.tipo === tabPlanoAtiva && p.grupo_id);

  if (grupos.length === 0) {
    container.innerHTML = '<p class="sem-dados">Nenhum item cadastrado. Clique em "+ Novo" para começar.</p>';
    return;
  }

  let html = '<div class="plano-lista">';
  grupos.forEach(g => {
    html += `
      <div class="plano-grupo">
        <div class="plano-grupo-header">
          <span>
            <i class="fas fa-folder"></i> <strong>${g.nome}</strong>
            ${g.is_cmv ? ' <span style="font-size:11px;color:#e67e22;font-weight:700;margin-left:6px;">[CMV]</span>' : ''}
          </span>
          <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
            <button class="btn btn-sm ${g.is_cmv ? 'btn-cmv-ativo' : 'btn-outline'}"
              onclick="toggleCMVGrupo('${g.id}', ${!!g.is_cmv})"
              title="${g.is_cmv ? 'Remover CMV deste grupo' : 'Marcar grupo inteiro como CMV'}">
              <i class="fas fa-percentage"></i> CMV
            </button>
            <button class="btn btn-sm btn-outline" onclick="abrirModalPlanoConta(null,'${g.id}','${tabPlanoAtiva}')">
              <i class="fas fa-plus"></i> Subcategoria
            </button>
            <button class="btn-icone editar" title="Editar" onclick="abrirModalPlanoConta('${g.id}')">
              <i class="fas fa-edit"></i>
            </button>
            <button class="btn-icone excluir" title="Excluir" onclick="excluirPlanoConta('${g.id}')">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
        <div class="plano-subcats">`;

    const subs = subcats.filter(s => s.grupo_id === g.id);
    if (subs.length === 0) {
      html += '<p class="sem-subcats">Nenhuma subcategoria ainda.</p>';
    } else {
      subs.forEach(s => {
        html += `
          <div class="plano-subcat">
            <span><i class="fas fa-tag"></i> ${s.nome}${s.is_cmv ? ' <span style="font-size:11px;color:#e67e22;font-weight:700;">[CMV]</span>' : ''}</span>
            <div>
              <button class="btn-icone editar" title="Editar" onclick="abrirModalPlanoConta('${s.id}')">
                <i class="fas fa-edit"></i>
              </button>
              <button class="btn-icone excluir" title="Excluir" onclick="excluirPlanoConta('${s.id}')">
                <i class="fas fa-trash"></i>
              </button>
            </div>
          </div>`;
      });
    }
    html += '</div></div>';
  });
  html += '</div>';
  container.innerHTML = html;
}

function abrirModalPlanoConta(id, grupoId, tipo) {
  planoGrupoIdModal = grupoId || null;
  const tipoModal   = tipo || tabPlanoAtiva;

  document.getElementById('modal-plano-conta-id').value    = id || '';
  document.getElementById('modal-plano-conta-nome').value  = '';
  document.getElementById('modal-plano-conta-tipo').value  = tipoModal;
  document.getElementById('modal-plano-conta-nivel').value = grupoId ? 'sub' : 'grupo';

  if (id) {
    const item = planoContas.find(p => p.id === id);
    if (item) {
      document.getElementById('modal-plano-conta-nome').value  = item.nome;
      document.getElementById('modal-plano-conta-tipo').value  = item.tipo;
      document.getElementById('modal-plano-conta-nivel').value = item.grupo_id ? 'sub' : 'grupo';
      planoGrupoIdModal = item.grupo_id;
    }
  }

  atualizarModalNivel();
  document.getElementById('modal-plano-conta').classList.remove('hidden');
}

function atualizarModalNivel() {
  const nivel = document.getElementById('modal-plano-conta-nivel').value;
  const tipo  = document.getElementById('modal-plano-conta-tipo').value;
  const cont  = document.getElementById('modal-plano-conta-grupo-container');

  if (nivel === 'sub') {
    cont.style.display = 'block';
    const sel = document.getElementById('modal-plano-conta-grupo');
    const grupos = planoContas.filter(p => p.tipo === tipo && !p.grupo_id);
    sel.innerHTML = '<option value="">Selecione o grupo...</option>' +
      grupos.map(g => `<option value="${g.id}" ${g.id === planoGrupoIdModal ? 'selected' : ''}>${g.nome}</option>`).join('');
  } else {
    cont.style.display = 'none';
  }
}

async function salvarPlanoConta() {
  if (!await garantirSessao()) return;
  const id    = document.getElementById('modal-plano-conta-id').value;
  const nome  = document.getElementById('modal-plano-conta-nome').value.trim();
  const tipo  = document.getElementById('modal-plano-conta-tipo').value;
  const nivel = document.getElementById('modal-plano-conta-nivel').value;
  const grupoId = nivel === 'sub'
    ? (document.getElementById('modal-plano-conta-grupo').value || null)
    : null;

  if (!nome) { mostrarToast('Informe o nome!', 'erro'); return; }
  if (nivel === 'sub' && !grupoId) { mostrarToast('Selecione o grupo!', 'erro'); return; }

  const db = obterSupabase();
  const dados = { nome, tipo, grupo_id: grupoId };
  let error;
  if (id) {
    ({ error } = await q(db.from('plano_contas').update(dados).eq('id', id)))
  } else {
    ({ error } = await q(db.from('plano_contas').insert([dados])))
  }

  if (tratarErro(error, 'Erro ao salvar')) return;
  mostrarToast(id ? 'Atualizado!' : 'Cadastrado!', 'sucesso');
  fecharModal('modal-plano-conta');
  await carregarPlanoContas();
  renderizarPlanoContas();
}

async function toggleCMVGrupo(id, ativo) {
  const db = obterSupabase();
  const { error } = await q(db.from('plano_contas').update({ is_cmv: !ativo }).eq('id', id))
  if (error) { mostrarToast('Erro ao atualizar CMV.', 'erro'); return; }
  mostrarToast(!ativo ? 'Grupo marcado como CMV!' : 'CMV removido do grupo.', 'sucesso');
  await carregarPlanoContas();
  renderizarPlanoContas();
}

async function excluirPlanoConta(id) {
  if (!confirm('Excluir este item? Se houver lançamentos vinculados, não será possível.')) return;
  const db = obterSupabase();
  const { error } = await q(db.from('plano_contas').delete().eq('id', id))
  if (error) {
    mostrarToast('Não é possível excluir: há lançamentos ou subcategorias vinculados.', 'erro');
    return;
  }
  mostrarToast('Excluído!', 'sucesso');
  await carregarPlanoContas();
  renderizarPlanoContas();
}

// =========================================================
// UNIDADES
// =========================================================
function renderizarUnidades() {
  const tbody = document.getElementById('tbody-unidades');
  if (!tbody) return;

  if (unidades.length === 0) {
    tbody.innerHTML = '<tr><td colspan="2" class="sem-dados">Nenhuma unidade cadastrada. Clique em "+ Nova Unidade".</td></tr>';
    return;
  }

  tbody.innerHTML = unidades.map(u => `
    <tr>
      <td><strong>${u.nome}</strong></td>
      <td>
        <button class="btn-icone editar" title="Editar" onclick="abrirModalUnidade('${u.id}')">
          <i class="fas fa-edit"></i>
        </button>
        <button class="btn-icone excluir" title="Excluir" onclick="excluirUnidade('${u.id}')">
          <i class="fas fa-trash"></i>
        </button>
      </td>
    </tr>`).join('');
}

function abrirModalUnidade(id) {
  document.getElementById('modal-unidade-id').value   = id || '';
  document.getElementById('modal-unidade-nome').value = '';

  if (id) {
    const u = unidades.find(x => x.id === id);
    if (u) document.getElementById('modal-unidade-nome').value = u.nome;
  }
  document.getElementById('modal-unidade').classList.remove('hidden');
  setTimeout(() => document.getElementById('modal-unidade-nome').focus(), 100);
}

async function salvarUnidade() {
  if (!await garantirSessao()) return;
  const id   = document.getElementById('modal-unidade-id').value;
  const nome = document.getElementById('modal-unidade-nome').value.trim();

  if (!nome) { mostrarToast('Informe o nome da unidade!', 'erro'); return; }

  const db = obterSupabase();
  let error;
  if (id) {
    ({ error } = await q(db.from('unidades').update({ nome }).eq('id', id)))
  } else {
    ({ error } = await q(db.from('unidades').insert([{ nome }])))
  }

  if (tratarErro(error, 'Erro ao salvar')) return;
  mostrarToast(id ? 'Unidade atualizada!' : 'Unidade cadastrada!', 'sucesso');
  fecharModal('modal-unidade');
  await carregarUnidades();
}

async function excluirUnidade(id) {
  if (!confirm('Excluir esta unidade?')) return;
  const db = obterSupabase();
  const { error } = await q(db.from('unidades').delete().eq('id', id))
  if (error) { mostrarToast('Não é possível excluir: há dados vinculados a esta unidade.', 'erro'); return; }
  mostrarToast('Unidade excluída!', 'sucesso');
  await carregarUnidades();
}

// =========================================================
// BANCOS
// =========================================================
function renderizarBancos() {
  const tbody = document.getElementById('tbody-bancos');
  if (!tbody) return;

  if (bancosCadastrados.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="sem-dados">Nenhum banco cadastrado. Clique em "+ Novo Banco".</td></tr>';
    return;
  }

  const tipos = { corrente: 'Corrente', poupanca: 'Poupança', investimento: 'Investimento' };
  tbody.innerHTML = bancosCadastrados.map(b => `
    <tr>
      <td><strong>${b.nome}</strong></td>
      <td>${b.agencia || '-'}</td>
      <td>${b.conta || '-'}</td>
      <td>${tipos[b.tipo_conta] || b.tipo_conta}</td>
      <td>${formatarMoeda(b.saldo_inicial || 0)}</td>
      <td>
        <button class="btn-icone editar" title="Editar" onclick="abrirModalBanco('${b.id}')">
          <i class="fas fa-edit"></i>
        </button>
        <button class="btn-icone excluir" title="Excluir" onclick="excluirBanco('${b.id}')">
          <i class="fas fa-trash"></i>
        </button>
      </td>
    </tr>`).join('');
}

function abrirModalBanco(id) {
  document.getElementById('modal-banco-id').value      = id || '';
  document.getElementById('modal-banco-nome').value    = '';
  document.getElementById('modal-banco-agencia').value = '';
  document.getElementById('modal-banco-conta').value   = '';
  document.getElementById('modal-banco-tipo').value    = 'corrente';
  document.getElementById('modal-banco-saldo').value   = '0';

  if (id) {
    const b = bancosCadastrados.find(x => x.id === id);
    if (b) {
      document.getElementById('modal-banco-nome').value    = b.nome;
      document.getElementById('modal-banco-agencia').value = b.agencia || '';
      document.getElementById('modal-banco-conta').value   = b.conta || '';
      document.getElementById('modal-banco-tipo').value    = b.tipo_conta || 'corrente';
      setValorMoeda('modal-banco-saldo', b.saldo_inicial || 0);
    }
  }
  document.getElementById('modal-banco').classList.remove('hidden');
}

async function salvarBanco() {
  if (!await garantirSessao()) return;
  const id          = document.getElementById('modal-banco-id').value;
  const nome        = document.getElementById('modal-banco-nome').value.trim();
  const agencia     = document.getElementById('modal-banco-agencia').value.trim();
  const conta       = document.getElementById('modal-banco-conta').value.trim();
  const tipo_conta  = document.getElementById('modal-banco-tipo').value;
  const saldo_inicial = parseMoeda(document.getElementById('modal-banco-saldo').value);

  if (!nome) { mostrarToast('Informe o nome do banco!', 'erro'); return; }

  const db = obterSupabase();
  const dados = { nome, agencia: agencia || null, conta: conta || null, tipo_conta, saldo_inicial };
  let error;
  if (id) {
    ({ error } = await q(db.from('bancos').update(dados).eq('id', id)))
  } else {
    ({ error } = await q(db.from('bancos').insert([dados])))
  }

  if (tratarErro(error, 'Erro ao salvar')) return;
  mostrarToast(id ? 'Banco atualizado!' : 'Banco cadastrado!', 'sucesso');
  fecharModal('modal-banco');
  await carregarBancosCadastrados();
  renderizarBancos();
}

async function excluirBanco(id) {
  if (!confirm('Excluir este banco?')) return;
  const db = obterSupabase();
  const { error } = await q(db.from('bancos').delete().eq('id', id))
  if (error) { mostrarToast('Não é possível excluir: há lançamentos vinculados.', 'erro'); return; }
  mostrarToast('Banco excluído!', 'sucesso');
  await carregarBancosCadastrados();
  renderizarBancos();
}

// =========================================================
// FORNECEDORES
// =========================================================
function renderizarFornecedores() {
  const tbody = document.getElementById('tbody-fornecedores');
  if (!tbody) return;

  if (fornecedores.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="sem-dados">Nenhum fornecedor cadastrado.</td></tr>';
    return;
  }

  tbody.innerHTML = fornecedores.map(f => `
    <tr>
      <td><strong>${f.nome}</strong></td>
      <td>${f.cnpj_cpf || '-'}</td>
      <td>${f.plano_contas?.nome || '-'}</td>
      <td>
        <button class="btn-icone editar" title="Editar" onclick="abrirModalFornecedor('${f.id}')">
          <i class="fas fa-edit"></i>
        </button>
        <button class="btn-icone excluir" title="Excluir" onclick="excluirFornecedor('${f.id}')">
          <i class="fas fa-trash"></i>
        </button>
      </td>
    </tr>`).join('');
}

function abrirModalFornecedor(id) {
  document.getElementById('modal-fornecedor-id').value   = id || '';
  document.getElementById('modal-fornecedor-nome').value = '';
  document.getElementById('modal-fornecedor-cnpj').value = '';
  preencherSelectPlanoContas('modal-fornecedor-plano-conta', 'pagar');
  document.getElementById('modal-fornecedor-plano-conta').value = '';

  if (id) {
    const f = fornecedores.find(x => x.id === id);
    if (f) {
      document.getElementById('modal-fornecedor-nome').value       = f.nome;
      document.getElementById('modal-fornecedor-cnpj').value       = f.cnpj_cpf || '';
      document.getElementById('modal-fornecedor-plano-conta').value = f.plano_conta_id || '';
    }
  }
  document.getElementById('modal-fornecedor').classList.remove('hidden');
}

async function salvarFornecedor() {
  if (!await garantirSessao()) return;
  const id          = document.getElementById('modal-fornecedor-id').value;
  const nome        = document.getElementById('modal-fornecedor-nome').value.trim();
  const cnpj_cpf    = document.getElementById('modal-fornecedor-cnpj').value.trim();
  const plano_conta_id = document.getElementById('modal-fornecedor-plano-conta').value || null;

  if (!nome) { mostrarToast('Informe o nome!', 'erro'); return; }

  const db = obterSupabase();
  const dados = { nome, cnpj_cpf: cnpj_cpf || null, plano_conta_id };
  let error;
  if (id) {
    ({ error } = await q(db.from('fornecedores').update(dados).eq('id', id)))
  } else {
    ({ error } = await q(db.from('fornecedores').insert([dados])))
  }

  if (tratarErro(error, 'Erro ao salvar')) return;
  mostrarToast(id ? 'Fornecedor atualizado!' : 'Fornecedor cadastrado!', 'sucesso');
  fecharModal('modal-fornecedor');
  await carregarFornecedores();
  renderizarFornecedores();
}

async function excluirFornecedor(id) {
  if (!confirm('Excluir este fornecedor?')) return;
  const db = obterSupabase();
  const { error } = await q(db.from('fornecedores').delete().eq('id', id))
  if (error) { mostrarToast('Não é possível excluir: há lançamentos vinculados.', 'erro'); return; }
  mostrarToast('Fornecedor excluído!', 'sucesso');
  await carregarFornecedores();
  renderizarFornecedores();
}

// =========================================================
// CENTROS DE CUSTO
// =========================================================
function renderizarCentrosCusto() {
  const tbody = document.getElementById('tbody-centros-custo');
  if (!tbody) return;

  if (centrosCusto.length === 0) {
    tbody.innerHTML = '<tr><td colspan="2" class="sem-dados">Nenhum centro de custo cadastrado.</td></tr>';
    return;
  }

  tbody.innerHTML = centrosCusto.map(c => `
    <tr>
      <td><strong>${c.nome}</strong></td>
      <td>
        <button class="btn-icone editar" title="Editar" onclick="abrirModalCentroCusto('${c.id}')">
          <i class="fas fa-edit"></i>
        </button>
        <button class="btn-icone excluir" title="Excluir" onclick="excluirCentroCusto('${c.id}')">
          <i class="fas fa-trash"></i>
        </button>
      </td>
    </tr>`).join('');
}

function abrirModalCentroCusto(id) {
  document.getElementById('modal-centro-custo-id').value   = id || '';
  document.getElementById('modal-centro-custo-nome').value = '';

  if (id) {
    const c = centrosCusto.find(x => x.id === id);
    if (c) document.getElementById('modal-centro-custo-nome').value = c.nome;
  }
  document.getElementById('modal-centro-custo').classList.remove('hidden');
}

async function salvarCentroCusto() {
  if (!await garantirSessao()) return;
  const id   = document.getElementById('modal-centro-custo-id').value;
  const nome = document.getElementById('modal-centro-custo-nome').value.trim();
  if (!nome) { mostrarToast('Informe o nome!', 'erro'); return; }

  const db = obterSupabase();
  let error;
  if (id) {
    ({ error } = await q(db.from('centros_custo').update({ nome }).eq('id', id)))
  } else {
    ({ error } = await q(db.from('centros_custo').insert([{ nome }])))
  }

  if (tratarErro(error, 'Erro ao salvar')) return;
  mostrarToast(id ? 'Centro atualizado!' : 'Centro cadastrado!', 'sucesso');
  fecharModal('modal-centro-custo');
  await carregarCentrosCusto();
  renderizarCentrosCusto();
}

async function excluirCentroCusto(id) {
  if (!confirm('Excluir este centro de custo?')) return;
  const db = obterSupabase();
  const { error } = await q(db.from('centros_custo').delete().eq('id', id))
  if (error) { mostrarToast('Não é possível excluir: há lançamentos vinculados.', 'erro'); return; }
  mostrarToast('Centro excluído!', 'sucesso');
  await carregarCentrosCusto();
  renderizarCentrosCusto();
}

// =========================================================
// FORMAS DE PAGAMENTO
// =========================================================
function renderizarFormasPagamento() {
  const tbody = document.getElementById('tbody-formas-pagamento');
  if (!tbody) return;

  if (formasPagamento.length === 0) {
    tbody.innerHTML = '<tr><td colspan="2" class="sem-dados">Nenhuma forma de pagamento cadastrada.</td></tr>';
    return;
  }

  tbody.innerHTML = formasPagamento.map(f => `
    <tr>
      <td><strong>${f.nome}</strong></td>
      <td>
        <button class="btn-icone editar" title="Editar" onclick="abrirModalFormaPagamento('${f.id}')">
          <i class="fas fa-edit"></i>
        </button>
        <button class="btn-icone excluir" title="Excluir" onclick="excluirFormaPagamento('${f.id}')">
          <i class="fas fa-trash"></i>
        </button>
      </td>
    </tr>`).join('');
}

function abrirModalFormaPagamento(id) {
  document.getElementById('modal-forma-pagamento-id').value   = id || '';
  document.getElementById('modal-forma-pagamento-nome').value = '';

  if (id) {
    const f = formasPagamento.find(x => x.id === id);
    if (f) document.getElementById('modal-forma-pagamento-nome').value = f.nome;
  }
  document.getElementById('modal-forma-pagamento').classList.remove('hidden');
}

async function salvarFormaPagamento() {
  if (!await garantirSessao()) return;
  const id   = document.getElementById('modal-forma-pagamento-id').value;
  const nome = document.getElementById('modal-forma-pagamento-nome').value.trim();
  if (!nome) { mostrarToast('Informe o nome!', 'erro'); return; }

  const db = obterSupabase();
  let error;
  if (id) {
    ({ error } = await q(db.from('formas_pagamento').update({ nome }).eq('id', id)))
  } else {
    ({ error } = await q(db.from('formas_pagamento').insert([{ nome }])))
  }

  if (tratarErro(error, 'Erro ao salvar')) return;
  mostrarToast(id ? 'Atualizado!' : 'Cadastrado!', 'sucesso');
  fecharModal('modal-forma-pagamento');
  await carregarFormasPagamento();
  renderizarFormasPagamento();
}

async function excluirFormaPagamento(id) {
  if (!confirm('Excluir esta forma de pagamento?')) return;
  const db = obterSupabase();
  const { error } = await q(db.from('formas_pagamento').delete().eq('id', id))
  if (error) { mostrarToast('Não é possível excluir: há lançamentos vinculados.', 'erro'); return; }
  mostrarToast('Excluído!', 'sucesso');
  await carregarFormasPagamento();
  renderizarFormasPagamento();
}

// =========================================================
// TAXAS DE CARTÃO (MDR + antecipação) — usado na Conciliação de Cartão
// =========================================================
let taxasCartao = [];
const MODALIDADES_TAXA = {
  debito:            'Débito',
  credito_avista:    'Crédito à vista',
  credito_parcelado: 'Crédito parcelado',
  pix:               'Pix'
};

async function carregarTaxasCartao() {
  if (!(await garantirSessao())) return;
  const db = obterSupabase();
  const { data, error } = await q(
    db.from('card_taxas').select('*')
      .order('bandeira').order('modalidade')
      .order('vigencia_inicio', { ascending: false })
  );
  const tbody = document.getElementById('tbody-taxas-cartao');
  if (error) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="sem-dados">Tabela ainda não existe. Rode <strong>SQL_CARD_CONCILIACAO.sql</strong> no Supabase para criar as tabelas de conciliação de cartão.</td></tr>';
    return;
  }
  taxasCartao = data || [];
  renderizarTaxasCartao();
}

function renderizarTaxasCartao() {
  const tbody = document.getElementById('tbody-taxas-cartao');
  if (!tbody) return;
  if (!taxasCartao.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="sem-dados">Nenhuma taxa cadastrada. Clique em "+ Nova Taxa".</td></tr>';
    return;
  }
  const dt  = d => d ? d.split('-').reverse().join('/') : '';
  const pct = n => Number(n || 0).toFixed(2).replace('.', ',') + '%';
  tbody.innerHTML = taxasCartao.map(t => `
    <tr>
      <td><strong>${t.bandeira}</strong></td>
      <td>${MODALIDADES_TAXA[t.modalidade] || t.modalidade}</td>
      <td>${t.parcelas ? t.parcelas + 'x' : '-'}</td>
      <td>${pct(t.percentual_mdr)}</td>
      <td>${pct(t.percentual_antecipacao)}</td>
      <td>${dt(t.vigencia_inicio)}${t.vigencia_fim ? ' — ' + dt(t.vigencia_fim) : ' — vigente'}</td>
      <td>
        <button class="btn-icone editar" title="Editar" onclick="abrirModalTaxaCartao('${t.id}')">
          <i class="fas fa-edit"></i>
        </button>
        <button class="btn-icone excluir" title="Excluir" onclick="excluirTaxaCartao('${t.id}')">
          <i class="fas fa-trash"></i>
        </button>
      </td>
    </tr>`).join('');
}

function abrirModalTaxaCartao(id) {
  document.getElementById('modal-taxa-id').value         = id || '';
  document.getElementById('modal-taxa-bandeira').value   = '';
  document.getElementById('modal-taxa-modalidade').value = 'debito';
  document.getElementById('modal-taxa-parcelas').value   = '';
  document.getElementById('modal-taxa-mdr').value        = '';
  document.getElementById('modal-taxa-antecip').value    = '';
  document.getElementById('modal-taxa-inicio').value     = new Date().toISOString().slice(0, 10);
  document.getElementById('modal-taxa-fim').value        = '';

  if (id) {
    const t = taxasCartao.find(x => x.id === id);
    if (t) {
      document.getElementById('modal-taxa-bandeira').value   = t.bandeira || '';
      document.getElementById('modal-taxa-modalidade').value = t.modalidade || 'debito';
      document.getElementById('modal-taxa-parcelas').value   = t.parcelas || '';
      document.getElementById('modal-taxa-mdr').value        = String(t.percentual_mdr ?? '').replace('.', ',');
      document.getElementById('modal-taxa-antecip').value    = String(t.percentual_antecipacao ?? '').replace('.', ',');
      document.getElementById('modal-taxa-inicio').value     = t.vigencia_inicio || '';
      document.getElementById('modal-taxa-fim').value        = t.vigencia_fim || '';
    }
  }
  atualizarCampoParcelasTaxa();
  document.getElementById('modal-taxa-cartao').classList.remove('hidden');
}

// Só mostra "parcelas" quando a modalidade é crédito parcelado
function atualizarCampoParcelasTaxa() {
  const mod = document.getElementById('modal-taxa-modalidade').value;
  const grupo = document.getElementById('grupo-taxa-parcelas');
  if (grupo) grupo.style.display = (mod === 'credito_parcelado') ? '' : 'none';
}

async function salvarTaxaCartao() {
  if (!await garantirSessao()) return;
  const pct = v => { const n = parseFloat(String(v || '').replace(',', '.')); return isNaN(n) ? null : n; };
  const id            = document.getElementById('modal-taxa-id').value;
  const bandeira      = document.getElementById('modal-taxa-bandeira').value.trim();
  const modalidade    = document.getElementById('modal-taxa-modalidade').value;
  const parcelasRaw   = document.getElementById('modal-taxa-parcelas').value.trim();
  const mdr           = pct(document.getElementById('modal-taxa-mdr').value);
  const antecip       = pct(document.getElementById('modal-taxa-antecip').value) || 0;
  const vigenciaIni   = document.getElementById('modal-taxa-inicio').value || null;
  const vigenciaFim   = document.getElementById('modal-taxa-fim').value || null;

  if (!bandeira)      { mostrarToast('Informe a bandeira!', 'erro'); return; }
  if (mdr === null)   { mostrarToast('Informe a taxa (MDR)!', 'erro'); return; }
  if (!vigenciaIni)   { mostrarToast('Informe a vigência inicial!', 'erro'); return; }

  const dados = {
    bandeira,
    modalidade,
    parcelas: (modalidade === 'credito_parcelado' && parcelasRaw) ? parseInt(parcelasRaw, 10) : null,
    percentual_mdr:         mdr,
    percentual_antecipacao: antecip,
    vigencia_inicio:        vigenciaIni,
    vigencia_fim:           vigenciaFim
  };

  const db = obterSupabase();
  let error;
  if (id) ({ error } = await q(db.from('card_taxas').update(dados).eq('id', id)));
  else    ({ error } = await q(db.from('card_taxas').insert([dados])));

  if (tratarErro(error, 'Erro ao salvar')) return;
  mostrarToast(id ? 'Taxa atualizada!' : 'Taxa cadastrada!', 'sucesso');
  fecharModal('modal-taxa-cartao');
  await carregarTaxasCartao();
}

async function excluirTaxaCartao(id) {
  if (!confirm('Excluir esta taxa?')) return;
  const db = obterSupabase();
  const { error } = await q(db.from('card_taxas').delete().eq('id', id));
  if (tratarErro(error, 'Erro ao excluir')) return;
  mostrarToast('Taxa excluída!', 'sucesso');
  await carregarTaxasCartao();
}

// =========================================================
// IMPORTAR ARQUIVO GETNET (EDI 400 bytes) → card_transacoes / card_lotes_pagamento
// =========================================================
let getnetImport = null; // { fileName, resultado }

// Parser do Extrato Eletrônico Getnet (largura fixa 400 bytes, v10.1). Função pura.
function parsearGetnetEDI(conteudo) {
  const linhas = String(conteudo).split(/\r?\n/).filter(l => l.length >= 400);
  if (!linhas.length) return { erro: 'Arquivo Getnet vazio ou fora do layout de 400 bytes.' };

  const money = s => { const n = parseInt(s, 10); return isNaN(n) ? 0 : n / 100; };
  const dataBR = s => (s && /^\d{8}$/.test(s)) ? `${s.slice(4)}-${s.slice(2, 4)}-${s.slice(0, 2)}` : null;
  const horaBR = s => (s && /^\d{6}$/.test(s)) ? `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)}` : null;
  const bandeiraBIN = card => {
    const b = (card || '').replace(/\D/g, '').slice(0, 6);
    if (b[0] === '4') return 'Visa';
    if (b[0] === '2' || ['51', '52', '53', '54', '55'].includes(b.slice(0, 2))) return 'Master';
    if (['37', '34'].includes(b.slice(0, 2))) return 'Amex';
    if (b.slice(0, 6) === '606282') return 'Hipercard';
    if (b[0] === '6' || b.slice(0, 2) === '50') return 'Elo';
    return b ? 'BIN ' + b : '';
  };

  const vendas = [], lotes = [], antecipacoes = [], ajustes = [];
  for (const l of linhas) {
    const tipo = l[0];
    if (tipo === '2') {
      // Offsets conforme Manual Getnet Extrato Eletrônico V10.1 (Registro Tipo 2 — Analítico):
      // RV[17:25] NSU[26:37] data[38:45] hora[46:51] cartão[52:70] valor[71:82]
      // parcelas_total[107:108] dt_pgto[123:130] cod_autoriz[131:140] terminal[160:167] MDR[176:187]
      const dataVenda  = dataBR(l.slice(37, 45));
      const dtPgtoPrev = dataBR(l.slice(122, 130));
      const parcelaTot = parseInt(l.slice(106, 108), 10) || 1;
      const bruto = money(l.slice(70, 82));
      const taxa  = money(l.slice(175, 187));
      const taxaPct = bruto > 0 ? +(taxa / bruto * 100).toFixed(2) : 0;
      // Modalidade: fonte oficial é o Código de Produto do RV (tipo 1). Enquanto não cruzamos,
      // aproxima pela taxa efetiva (débito ~1,4% × crédito ~2,5-3%).
      const modalidade = parcelaTot > 1 ? 'credito_parcelado' : (taxaPct <= 1.8 ? 'debito' : 'credito_avista');
      vendas.push({
        nsu: (l.slice(25, 37).replace(/\D/g, '').replace(/^0+/, '') || null),
        codigo_autorizacao: l.slice(130, 140).trim() || null,
        numero_rv: l.slice(16, 25).trim() || null,
        cartao_mascarado: l.slice(51, 70).trim(),
        bandeira: bandeiraBIN(l.slice(51, 70)),
        modalidade,
        taxa_efetiva_pct: taxaPct,
        parcelas: parcelaTot > 1 ? parcelaTot : null,
        terminal: l.slice(159, 167).trim(),
        data_venda: dataVenda,
        hora_venda: horaBR(l.slice(45, 51)),
        data_pagamento_prevista: dtPgtoPrev,
        valor_bruto: bruto,
        valor_taxa: taxa,
        valor_liquido: +(bruto - taxa).toFixed(2)
      });
    } else if (tipo === '3') {
      antecipacoes.push({
        data_venda: dataBR(l.slice(25, 33)),
        data_pagamento_original: dataBR(l.slice(33, 41)),
        valor_cedido: money(l.slice(63, 75))
      });
    } else if (tipo === '6') {
      // Detalhe Financeiro — é o LÍQUIDO EXATO que cai no banco (valida contra o extrato bancário).
      // CS (Cessão) = valor antecipado (crédito), campo [86:98]. PG (Agenda Livre) = débito, campo [110:122].
      const op = l.slice(44, 46);
      let modalidade = null, valor = 0;
      // CS (Cessão) e AC (Antecipação) = crédito antecipado, campo [86:98]. PG (Agenda Livre) = débito.
      if (op === 'CS' || op === 'AC') { modalidade = 'antecipacao'; valor = money(l.slice(86, 98)); }
      else if (op === 'PG')           { modalidade = 'debito';      valor = money(l.slice(110, 122)); }
      if (modalidade && valor > 0) {
        lotes.push({ data_pagamento: dataBR(l.slice(16, 24)), modalidade, valor_liquido: valor });
      }
    }
  }

  const soma = (arr, k) => +arr.reduce((s, x) => s + (x[k] || 0), 0).toFixed(2);
  const totais = {
    qtd_vendas: vendas.length, bruto: soma(vendas, 'valor_bruto'), taxa: soma(vendas, 'valor_taxa'),
    liquido: soma(vendas, 'valor_liquido'), qtd_lotes: lotes.length, liquido_pago: soma(lotes, 'valor_liquido'),
    qtd_antecipacoes: antecipacoes.length, valor_cedido: soma(antecipacoes, 'valor_cedido'), qtd_ajustes: ajustes.length
  };
  return { vendas, lotes, antecipacoes, ajustes, totais };
}

function carregarImportarGetnet() {
  getnetImport = null;
  const nome = document.getElementById('nome-arquivo-getnet');
  if (nome) nome.textContent = '';
  const resumo = document.getElementById('getnet-resumo');
  if (resumo) resumo.innerHTML = '';
  const btn = document.getElementById('btn-gravar-getnet');
  if (btn) btn.style.display = 'none';
}

function carregarArquivoGetnet(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  document.getElementById('nome-arquivo-getnet').textContent = file.name;
  const reader = new FileReader();
  reader.onload = function (e) {
    const resultado = parsearGetnetEDI(e.target.result);
    if (resultado.erro) { mostrarToast(resultado.erro, 'erro'); return; }
    getnetImport = { fileName: file.name, resultado };
    renderResumoGetnet();
  };
  reader.readAsText(file, 'latin1');
}

function renderResumoGetnet() {
  const el = document.getElementById('getnet-resumo');
  if (!el || !getnetImport) return;
  const t = getnetImport.resultado.totais;
  const brl = v => 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  const card = (rot, val, cor) => `<div class="card-resumo" style="border-left:4px solid ${cor}">
    <div style="font-size:12px;color:#777">${rot}</div><div style="font-size:18px;font-weight:700">${val}</div></div>`;
  const linhasVendas = getnetImport.resultado.vendas.slice(0, 10).map(v => `
    <tr><td>${v.data_venda} ${v.hora_venda || ''}</td><td>${v.bandeira}</td>
    <td>${MODALIDADES_TAXA[v.modalidade] || v.modalidade}</td>
    <td style="text-align:right">${brl(v.valor_bruto)}</td>
    <td style="text-align:right">${brl(v.valor_taxa)}</td>
    <td style="text-align:right">${brl(v.valor_liquido)}</td><td>${v.nsu}</td></tr>`).join('');
  el.innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin:14px 0">
      ${card('Vendas', t.qtd_vendas + ' transações', '#3498db')}
      ${card('Bruto', brl(t.bruto), '#2c3e50')}
      ${card('Taxa (MDR)', brl(t.taxa), '#e67e22')}
      ${card('Líquido', brl(t.liquido), '#27ae60')}
      ${card('Lotes p/ banco', t.qtd_lotes + ' · ' + brl(t.liquido_pago), '#8e44ad')}
      ${card('Antecipações', t.qtd_antecipacoes + ' · ' + brl(t.valor_cedido), '#16a085')}
    </div>
    <div class="tabela-box"><table class="tabela"><thead><tr>
      <th>Data/Hora</th><th>Bandeira</th><th>Modalidade</th><th>Bruto</th><th>Taxa</th><th>Líquido</th><th>NSU</th>
    </tr></thead><tbody>${linhasVendas}</tbody></table></div>
    <p style="font-size:12px;color:#777;margin-top:6px">Mostrando as 10 primeiras de ${t.qtd_vendas} vendas.</p>`;
  const btn = document.getElementById('btn-gravar-getnet');
  if (btn) btn.style.display = 'inline-flex';
}

async function gravarGetnet() {
  if (!getnetImport) { mostrarToast('Nenhum arquivo carregado.', 'erro'); return; }
  if (!await garantirSessao()) return;
  const db = obterSupabase();
  const fname = getnetImport.fileName;
  const { vendas, lotes } = getnetImport.resultado;
  const utc = (d, h) => d ? new Date(`${d}T${h || '00:00:00'}-03:00`).toISOString() : null;

  // Os arquivos diários se sobrepõem (uma venda/liquidação aparece em vários dias).
  // Por isso dedup GLOBAL contra o que já existe — nunca por arquivo.
  // VENDAS: chave (nsu, data_venda, valor_bruto)
  const dsV = [...new Set(vendas.map(v => v.data_venda).filter(Boolean))];
  let exV = [];
  try { exV = await ccFetchPaginado(() => db.from('card_transacoes')
    .select('nsu,data_venda,valor_bruto').eq('tipo_registro', 'venda').in('data_venda', dsV)); } catch (e) {}
  const kV = x => `${x.nsu || ''}|${x.data_venda}|${Number(x.valor_bruto).toFixed(2)}`;
  const temV = new Set(exV.map(kV));
  const rowsVendas = [];
  vendas.forEach(v => {
    if (!v.data_venda) return;
    const k = kV(v);
    if (temV.has(k)) return;
    temV.add(k);
    rowsVendas.push({
      nsu: v.nsu || null, codigo_autorizacao: v.codigo_autorizacao || null,
      bandeira: v.bandeira || null, modalidade: v.modalidade, parcelas: v.parcelas,
      cartao_mascarado: v.cartao_mascarado || null, terminal: v.terminal || null,
      data_venda: v.data_venda, hora_venda: v.hora_venda, data_hora_utc: utc(v.data_venda, v.hora_venda),
      data_pagamento_prevista: v.data_pagamento_prevista,
      valor_bruto: v.valor_bruto, valor_taxa: v.valor_taxa, valor_liquido: v.valor_liquido,
      tipo_registro: 'venda', origem: 'upload_edi', arquivo_origem: fname
    });
  });
  // LIQUIDAÇÕES FINANCEIRAS (tipo 6): chave (data_pagamento, modalidade, valor)
  const dsL = [...new Set(lotes.map(x => x.data_pagamento).filter(Boolean))];
  let exL = [];
  try { exL = await ccFetchPaginado(() => db.from('card_lotes_pagamento')
    .select('data_pagamento,modalidade,valor_liquido_esperado').in('data_pagamento', dsL)); } catch (e) {}
  const kL = x => `${x.data_pagamento}|${x.modalidade}|${Number(x.valor_liquido_esperado).toFixed(2)}`;
  const temL = new Set(exL.map(kL));
  const rowsLotes = [];
  lotes.forEach(x => {
    if (!x.data_pagamento) return;
    const k = kL({ data_pagamento: x.data_pagamento, modalidade: x.modalidade, valor_liquido_esperado: x.valor_liquido });
    if (temL.has(k)) return;
    temL.add(k);
    rowsLotes.push({ data_pagamento: x.data_pagamento, modalidade: x.modalidade,
      valor_liquido_esperado: x.valor_liquido, arquivo_origem: 'getnet_edi', status: 'pendente' });
  });

  const chunk = async (tabela, rows) => {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await q(db.from(tabela).insert(rows.slice(i, i + 500)));
      if (error) throw error;
    }
  };
  try {
    await chunk('card_transacoes', rowsVendas);
    await chunk('card_lotes_pagamento', rowsLotes);
  } catch (err) {
    tratarErro(err, 'Erro ao gravar as transações da Getnet');
    return;
  }
  mostrarToast(`Getnet importado: ${rowsVendas.length} vendas novas e ${rowsLotes.length} liquidações.`, 'sucesso');
}

// Import direto do arquivo Getnet (botão na Conciliação de Cartão)
function importarGetnetDireto(input) {
  const file = input.files && input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    input.value = '';
    const r = parsearGetnetEDI(e.target.result);
    if (r.erro) { mostrarToast(r.erro, 'erro'); return; }
    if (!confirm(`Importar arquivo Getnet: ${r.totais.qtd_vendas} vendas e ${r.totais.qtd_lotes} liquidações?`)) return;
    getnetImport = { fileName: file.name, resultado: r };
    await gravarGetnet();
    if (document.getElementById('cc-tab-cartao')) ccMudarTab('cartao');
  };
  reader.readAsText(file, 'latin1');
}

// =========================================================
// IMPORTAR PDV — relatório "Conciliação de Pagamento" (HTML disfarçado de .xls)
// =========================================================
let pdvImport = null;
const PDV_GRUPOS = { cartao:'💳 Cartão (Getnet)', pix:'⚡ Pix', ifood:'🛵 iFood', dinheiro:'💵 Dinheiro',
  voucher:'🎟️ Voucher/Benefício', conta_assinada:'📝 Conta Assinada', cortesia:'🎁 Cortesia', outro:'❔ Outro' };

function classificarFormaPDV(forma) {
  const low = (forma || '').toLowerCase();
  const band = () => low.includes('master') ? 'Master' : low.includes('visa') ? 'Visa' : low.includes('elo') ? 'Elo'
    : low.includes('amex') ? 'Amex' : low.includes('hiper') ? 'Hipercard' : low.includes('diners') ? 'Diners' : null;
  const cred = low.includes('crédito') || low.includes('credito');
  const deb  = low.includes('débito') || low.includes('debito');
  if ((cred || deb) && (low.includes('cartão') || low.includes('cartao') || low.includes('pos')))
    return { grupo: 'cartao', modalidade: deb ? 'debito' : 'credito', bandeira: band() || 'Outro' };
  if (low.startsWith('pix'))            return { grupo: 'pix', modalidade: null, bandeira: null };
  if (low.includes('ifood'))            return { grupo: 'ifood', modalidade: null, bandeira: null };
  if (low.includes('dinheiro'))         return { grupo: 'dinheiro', modalidade: null, bandeira: null };
  if (low.includes('cortesia'))         return { grupo: 'cortesia', modalidade: null, bandeira: null };
  if (low.includes('conta assinada'))   return { grupo: 'conta_assinada', modalidade: null, bandeira: null };
  if (/alelo|sodexo|\bvr\b|ticket|voucher|vale/.test(low)) return { grupo: 'voucher', modalidade: null, bandeira: band() };
  return { grupo: 'outro', modalidade: null, bandeira: null };
}

function parsearPDV(conteudo) {
  const txt = String(conteudo);
  if (!/<tr/i.test(txt)) return { erro: 'Arquivo não reconhecido. Esperado o relatório "Conciliação de Pagamento" do PDV.' };
  const strip = s => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#\d+;/g, '').replace(/\s+/g, ' ').trim();
  const trs = txt.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  const vendas = [];
  const seq = new Map(); // sequência p/ vendas idênticas (mesma hora+forma+valor) não colapsarem
  for (const tr of trs) {
    const tds = (tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map(strip);
    if (tds.length < 7 || !/^\d+$/.test(tds[0])) continue;
    const m = tds[2].match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
    if (!m) continue;
    const dataLocal = `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}`;
    const valor = parseFloat(String(tds[6]).replace(/[R$\s.]/g, '').replace(',', '.')) || 0;
    if (valor <= 0) continue;
    const cls = classificarFormaPDV(tds[5]);
    const base = `pdv|${dataLocal}|${tds[5]}|${Math.round(valor * 100)}`;
    const n = seq.get(base) || 0; seq.set(base, n + 1);
    vendas.push({
      id_ext: n ? `${base}#${n}` : base,
      data_hora_local: dataLocal, data: dataLocal.slice(0, 10), valor: +valor.toFixed(2),
      forma_raw: tds[5], grupo: cls.grupo, modalidade: cls.modalidade, bandeira: cls.bandeira
    });
  }
  if (!vendas.length) return { erro: 'Nenhuma venda encontrada no relatório.' };
  return { vendas };
}

function carregarImportarPDV() {
  pdvImport = null;
  const n = document.getElementById('nome-arquivo-pdv'); if (n) n.textContent = '';
  const r = document.getElementById('pdv-resumo'); if (r) r.innerHTML = '';
  const b = document.getElementById('btn-gravar-pdv'); if (b) b.style.display = 'none';
}

function carregarArquivoPDV(input) {
  const file = input.files && input.files[0]; if (!file) return;
  document.getElementById('nome-arquivo-pdv').textContent = file.name;
  const reader = new FileReader();
  reader.onload = e => {
    const r = parsearPDV(e.target.result);
    if (r.erro) { mostrarToast(r.erro, 'erro'); return; }
    pdvImport = { fileName: file.name, resultado: r };
    renderResumoPDV();
  };
  reader.readAsText(file, 'utf-8');
}

function renderResumoPDV() {
  const el = document.getElementById('pdv-resumo'); if (!el || !pdvImport) return;
  const vs = pdvImport.resultado.vendas;
  const brl = v => 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  const g = {}; vs.forEach(v => { (g[v.grupo] = g[v.grupo] || { n: 0, s: 0 }).n++; g[v.grupo].s += v.valor; });
  const dias = [...new Set(vs.map(v => v.data))].sort();
  const linhas = Object.keys(g).sort((a, b) => g[b].s - g[a].s).map(k =>
    `<tr><td>${PDV_GRUPOS[k] || k}</td><td style="text-align:right">${g[k].n}</td><td style="text-align:right">${brl(g[k].s)}</td></tr>`).join('');
  el.innerHTML = `
    <p style="margin:12px 0 6px;color:#555">${vs.length} vendas · período ${dias[0]?.split('-').reverse().join('/')} a ${dias[dias.length-1]?.split('-').reverse().join('/')}
    · <strong>cartão (Getnet): ${g.cartao?.n || 0} vendas, ${brl(g.cartao?.s || 0)}</strong>
    <span style="color:#888;font-size:12px">(só o cartão é gravado; o resto é só pra você conferir o fechamento)</span></p>
    <div class="tabela-box"><table class="tabela"><thead><tr><th>Forma</th><th style="text-align:right">Qtd</th><th style="text-align:right">Total</th></tr></thead>
    <tbody>${linhas}</tbody></table></div>`;
  const btn = document.getElementById('btn-gravar-pdv'); if (btn) btn.style.display = 'inline-flex';
}

async function gravarPDV() {
  if (!pdvImport) { mostrarToast('Nenhum arquivo carregado.', 'erro'); return; }
  if (!await garantirSessao()) return;
  const db = obterSupabase();
  const vs = pdvImport.resultado.vendas;
  const utc = dl => new Date(dl + '-04:00').toISOString(); // PDV é hora de Manaus (UTC-4)
  // dedup contra o que já existe: busca TODOS os ids (sem filtro de data — evita bug de fuso)
  let ex = [];
  try { ex = await ccFetchPaginado(() => db.from('pdv_vendas').select('id_venda_externa')); } catch (e) {
    mostrarToast('Rode o SQL_CARD_CONCILIACAO.sql antes (tabela pdv_vendas não existe).', 'erro'); return;
  }
  const tem = new Set(ex.map(x => x.id_venda_externa));
  const rows = [];
  vs.forEach(v => {                          // grava TODAS as formas (fechamento do dia); cartão cruza com a Getnet
    if (tem.has(v.id_ext)) return; tem.add(v.id_ext);
    rows.push({ id_venda_externa: v.id_ext, data_hora_local: v.data_hora_local + '-04:00', data_hora_utc: utc(v.data_hora_local),
      valor_bruto: v.valor, forma_pagamento: v.grupo, bandeira: v.bandeira,
      status_conciliacao: 'pendente', fonte: 'relatorio_pdv', raw: { forma: v.forma_raw, modalidade: v.modalidade } });
  });
  try {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await q(db.from('pdv_vendas').upsert(rows.slice(i, i + 500), { onConflict: 'id_venda_externa', ignoreDuplicates: true }));
      if (error) throw error;
    }
  } catch (err) { tratarErro(err, 'Erro ao gravar vendas do PDV'); return; }
  mostrarToast(rows.length ? `PDV importado: ${rows.length} vendas novas (todas as formas).` : 'PDV já estava importado (nada novo).', 'sucesso');
}

// Import direto (botão na Conciliação de Cartão abre o seletor e já grava)
function importarPDVDireto(input) {
  const file = input.files && input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    input.value = '';
    const r = parsearPDV(e.target.result);
    if (r.erro) { mostrarToast(r.erro, 'erro'); return; }
    if (!r.vendas.length) { mostrarToast('Nenhuma venda no relatório.', 'erro'); return; }
    const cartao = r.vendas.filter(v => v.grupo === 'cartao');
    const dias = [...new Set(r.vendas.map(v => v.data))].sort();
    const p = d => d ? d.split('-').reverse().join('/') : '';
    if (!confirm(`Importar ${r.vendas.length} vendas do PDV (${p(dias[0])} a ${p(dias[dias.length - 1])})?\n\n${cartao.length} são de cartão (cruzam com a Getnet); as em dinheiro/pix aparecem na conferência.`)) return;
    pdvImport = { fileName: file.name, resultado: r };
    await gravarPDV();
    if (document.getElementById('cc-tab-cartao')) ccMudarTab('cartao');
  };
  reader.readAsText(file, 'utf-8');
}

// =========================================================
// CONCILIAÇÃO DE CARTÃO (Etapa B) — vendas do dia X × banco no dia útil X+1
// Modelo: toda venda (débito e crédito) cai no dia útil seguinte via antecipação
// automática ("ANTECIPACAO GETNET" no extrato). O D+30 é só informativo.
// =========================================================
const CC_TOLERANCIA = 0.03; // 3% — cobre o custo da antecipação (~1%) + folga

// Próximo dia útil (pula sáb/dom). Sex/Sáb/Dom liquidam na segunda.
function ccProximoDiaUtil(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
  return d.toISOString().slice(0, 10);
}

// O Supabase devolve no máximo 1000 linhas por vez, então buscamos de mil em mil.
// A ordenação por uma coluna única (id) é OBRIGATÓRIA: sem ORDER BY o Postgres pode
// devolver cada página numa ordem diferente, repetindo umas linhas e perdendo outras.
// Era isso que fazia dias já conferidos voltarem para "a investigar" a cada recarga.
async function ccFetchPaginado(build, chave) {
  const col = chave || 'id';
  let out = [], from = 0, ordenar = true;
  while (true) {
    let qy = build();
    if (ordenar) qy = qy.order(col, { ascending: true });
    const { data, error } = await qy.range(from, from + 999);
    if (error) {
      // Tabela sem a coluna de ordenação: tenta do jeito antigo (só na 1ª página).
      if (ordenar && from === 0) { ordenar = false; continue; }
      throw error;
    }
    out = out.concat(data || []);
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return out;
}

let ccTab = 'cartao';
function ccRenderAtual() {
  if (ccTab === 'caixa') renderCaixaEspecie();
  else renderCartao();
}
function ccMudarTab(t) {
  ccTab = t;
  const views = { cartao: 'cc-view-cartao', caixa: 'cc-view-caixa' };
  Object.entries(views).forEach(([key, id]) => { const el = document.getElementById(id); if (el) el.style.display = t === key ? '' : 'none'; });
  [['cc-tab-cartao', 'cartao'], ['cc-tab-caixa', 'caixa']].forEach(([id, key]) => {
    const el = document.getElementById(id); if (!el) return;
    el.style.borderBottomColor = t === key ? '#2c3e50' : 'transparent'; el.style.color = t === key ? '#2c3e50' : '#999';
  });
  ccRenderAtual();
}

// ============ CARTÃO & PIX — uma tela, um dia por linha (PDV → Getnet → Banco) ============

async function carregarConciliacaoCartao() {
  if (!(await garantirSessao())) return;
  if (!ccMes) ccMes = ccMesAtual();
  // inputs cc-de/cc-ate ficam ocultos, mas o histórico do Caixa (espécie) ainda os usa como período.
  const de = document.getElementById('cc-de'), ate = document.getElementById('cc-ate');
  if (ate && !ate.value) ate.value = new Date().toISOString().slice(0, 10);
  if (de && !de.value) { const d = new Date(); d.setDate(d.getDate() - 60); de.value = d.toISOString().slice(0, 10); }
  ccRenderAtual();
}

const ccBRL = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
const ccDT = d => d.split('-').reverse().join('/');

// ---- Motor Etapa A: PDV × Getnet (venda por venda). Retorna { dias }. ----
async function computeEtapaA(db, de, ate) {
  let pdv;
  const buscaPdv = cols => ccFetchPaginado(() => db.from('pdv_vendas')
    .select(cols).eq('forma_pagamento', 'cartao')
    .gte('data_hora_utc', de + 'T00:00:00-04:00').lte('data_hora_utc', ate + 'T23:59:59-04:00'));
  const COLS_BASE  = 'id,data_hora_utc,valor_bruto,bandeira,raw';
  try {
    // As colunas de caixa vieram depois; se o SQL ainda não foi rodado, a tela
    // continua funcionando (só não mostra a quebra por caixa).
    try { pdv = await buscaPdv(COLS_BASE + ',caixa_ext,caixa_usuario,unidade_nome'); }
    catch (semCaixa) { pdv = await buscaPdv(COLS_BASE); }
  } catch (e) { return { erro: 'pdv', dias: {} }; }
  if (!pdv.length) return { vazio: true, dias: {} };

  const dd = (s, off) => { const x = new Date(s + 'T12:00:00'); x.setDate(x.getDate() + off); return x.toISOString().slice(0, 10); };
  const gnet = await ccFetchPaginado(() => db.from('card_transacoes')
    .select('id,data_venda,data_hora_utc,valor_bruto,bandeira,modalidade,terminal').eq('tipo_registro', 'venda')
    .gte('data_venda', dd(de, -1)).lte('data_venda', dd(ate, 1)));

  const manaus = iso => iso ? new Date(Date.parse(iso) - 4 * 3600000).toISOString() : '';
  const diaDiff = (a, b) => Math.round((Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 86400000);
  pdv.forEach(p => { const m = manaus(p.data_hora_utc); p.dia = m.slice(0, 10); p.hora = m.slice(11, 16); p.dtMs = Date.parse(p.data_hora_utc); p.mod = p.raw && p.raw.modalidade; p.ok = false; });
  // O casamento é guloso: a primeira venda a pedir uma cobrança fica com ela.
  // Logo, a ORDEM muda o resultado. Fixamos a ordem (hora, depois id) para que a
  // mesma conferência dê sempre o mesmo resultado, não importa como o banco devolveu.
  const ccOrdem = (a, b) => (a.dtMs - b.dtMs) || String(a.id).localeCompare(String(b.id));
  pdv.sort(ccOrdem);

  const pool = new Map();
  gnet.forEach(g => { const k = Math.round((g.valor_bruto || 0) * 100); const m = manaus(g.data_hora_utc); (pool.get(k) || pool.set(k, []).get(k)).push({ id: g.id, band: g.bandeira, mod: g.modalidade, data: g.data_venda, hora: m.slice(11, 16), dtMs: Date.parse(g.data_hora_utc), term: g.terminal || null, used: false }); });
  pool.forEach(arr => arr.sort(ccOrdem));
  // Terminal → caixa, aprendido dos pares que casaram, DENTRO de cada dia.
  // A Getnet não sabe o caixa; o terminal é uma pista. Medido em 14–19/08/2026:
  // acerta 91% (0% se comparado entre dias — o número do caixa muda diariamente).
  // Por isso o resultado aparece como "provável", nunca como certeza.
  const termCaixa = {};
  const TOL = 50; // R$ 0,50
  const casar = (p, tol, exigeBand) => {
    const C = Math.round(p.valor_bruto * 100); let best = null;
    for (let k = C - tol; k <= C + tol; k++) {
      const arr = pool.get(k); if (!arr) continue;
      for (const g of arr) {
        if (g.used) continue;
        if (exigeBand && p.bandeira && g.band && p.bandeira !== g.band) continue;
        const gap = Math.abs(diaDiff(p.dia, g.data)); if (gap > 1) continue;
        const score = Math.abs(k - C) * 10 + gap;
        if (!best || score < best.score) best = { g, score };
      }
    }
    if (best) {
      best.g.used = true;
      if (best.g.term && p.caixa_ext) {
        const t = (termCaixa[best.g.data] = termCaixa[best.g.data] || {});
        const c = (t[best.g.term] = t[best.g.term] || {});
        c[p.caixa_ext] = (c[p.caixa_ext] || 0) + 1;
      }
      return true;
    }
    return false;
  };
  [[0, true], [0, false], [TOL, true], [TOL, false]].forEach(([tol, eb]) => {
    pdv.filter(p => !p.ok).forEach(p => { p.ok = casar(p, tol, eb); });
  });

  const gUnmatched = [];
  pool.forEach((arr, k) => arr.forEach(g => { if (!g.used && g.data >= de && g.data <= ate) gUnmatched.push({ id: g.id, valor: k / 100, band: g.band, mod: g.mod, hora: g.hora, data: g.data, dtMs: g.dtMs, term: g.term, noise: false }); }));

  // Ficha de cada caixa (para nomear a dica) e o palpite por terminal.
  const fichaCaixa = {};
  pdv.forEach(p => { if (p.caixa_ext && !fichaCaixa[p.caixa_ext]) fichaCaixa[p.caixa_ext] = { ext: p.caixa_ext, usuario: p.caixa_usuario, loja: p.unidade_nome }; });
  gUnmatched.forEach(g => {
    const c = g.term && termCaixa[g.data] && termCaixa[g.data][g.term];
    if (!c) return;
    const pares = Object.entries(c).sort((a, b) => b[1] - a[1]);
    const total = pares.reduce((s, x) => s + x[1], 0);
    // Só arrisca se o terminal for bem dominado por um caixa naquele dia.
    if (total < 3 || pares[0][1] / total < 0.7) return;
    const f = fichaCaixa[pares[0][0]];
    if (f) g.palpite = { ...f, confianca: pares[0][1] / total };
  });
  const JANELA = 15 * 60 * 1000;
  pdv.filter(p => !p.ok).forEach(p => {
    let par = null;
    for (const g of gUnmatched) {
      if (g.noise) continue;
      if (isNaN(p.dtMs) || isNaN(g.dtMs)) continue;
      const dtm = Math.abs(p.dtMs - g.dtMs); if (dtm > JANELA) continue;
      if (!par || dtm < par.dtm) par = { g, dtm };
    }
    if (par) { par.g.noise = true; p.ruido = par.g; } else { p.investigar = true; }
  });

  const resPdv = new Map(), resGnet = new Map();
  try {
    const resol = await ccFetchPaginado(() => db.from('conc_conciliacoes')
      .select('venda_pdv_id,transacao_id,tipo_divergencia,observacao,resolvido_por,resolvido_em')
      .eq('etapa', 'pdv_operadora').eq('status', 'resolvido_manual'));
    resol.forEach(r => { if (r.venda_pdv_id) resPdv.set(r.venda_pdv_id, r); if (r.transacao_id) resGnet.set(r.transacao_id, r); });
  } catch (e) { /* tabela pode não ter linhas ainda */ }

  const dias = {};
  const novoD = () => ({ n: 0, ok: 0, invest: [], ruido: [], gAlone: [], resolv: [], pdvBruto: 0, gnetBruto: 0, caixas: {} });
  pdv.forEach(p => {
    const D = (dias[p.dia] = dias[p.dia] || novoD());
    D.n++;
    D.pdvBruto += (Number(p.valor_bruto) || 0);
    // Quebra por caixa: só o lado do PDV sabe o caixa. A Getnet traz terminal
    // (10 a 17 por dia contra ~4 caixas), então o bruto dela continua do dia.
    const ck = ccCaixaChave(p);
    const C  = (D.caixas[ck] = D.caixas[ck] || { chave: ck, ext: p.caixa_ext || null,
      usuario: p.caixa_usuario || null, loja: p.unidade_nome || null, bruto: 0, n: 0, inv: 0 });
    C.bruto += (Number(p.valor_bruto) || 0); C.n++;
    if (p.ok) D.ok++;
    else if (p.investigar) { const r = resPdv.get(p.id); if (r) { p.resol = r; D.resolv.push(p); } else { D.invest.push(p); C.inv++; } }
    else D.ruido.push(p);
  });
  gUnmatched.forEach(g => { if (!g.noise) { const D = (dias[g.data] = dias[g.data] || novoD()); const r = resGnet.get(g.id); if (r) { g.resol = r; D.resolv.push(g); } else D.gAlone.push(g); } });
  // Soma o bruto de TODAS as vendas Getnet por dia (não só as sem par) para a coluna de valor.
  gnet.forEach(g => { if (!g.data_venda) return; const D = (dias[g.data_venda] = dias[g.data_venda] || novoD()); D.gnetBruto += (Number(g.valor_bruto) || 0); });
  return { dias };
}

// ---- Caixa (quem registrou a venda no PDV) --------------------------------
// Vendas anteriores a 10/08/2026 vieram da planilha antiga do PDV, que não tem
// caixa nenhum — essas caem em "sem caixa" e é esperado, não é erro.
function ccCaixaChave(p) { return p.caixa_ext ? String(p.caixa_ext) : 'sem'; }

function ccLojaCurta(nome) {
  const n = (nome || '').toLowerCase();
  if (n.includes('parque')) return 'Parque 10';
  if (n.includes('centro'))  return 'Centro';
  return nome || '';
}

// "MARIA DE FATIMA DA SILVA SANTOS" não cabe na linha — vira "MARIA SANTOS".
function ccNomeCurto(nome) {
  const w = (nome || '').trim().split(/\s+/).filter(Boolean);
  return w.length > 2 ? `${w[0]} ${w[w.length - 1]}` : (nome || '');
}

// "Centro · Gisele" — o número do caixa muda todo dia, então quem identifica
// de verdade é a loja + quem operou. O número fica como referência miúda.
function ccCaixaLabel(c) {
  if (!c.ext) return '<span style="color:#999">sem caixa</span>';
  const loja = ccLojaCurta(c.loja);
  const quem = c.usuario ? ` · ${ccNomeCurto(c.usuario)}` : '';
  return `${loja}${quem} <span style="color:#bbb;font-weight:400">#${c.ext}</span>`;
}

// Dica de caixa para cobranças da Getnet sem venda no PDV. A Getnet não sabe o
// caixa — isto é deduzido do terminal e acerta ~91%, então aparece como palpite.
function ccPalpiteCaixa(x) {
  if (!x.palpite) return '';
  const loja = ccLojaCurta(x.palpite.loja);
  const quem = x.palpite.usuario ? ` · ${ccNomeCurto(x.palpite.usuario)}` : '';
  return `<span title="Deduzido pelo terminal da maquininha (acerta cerca de 91% das vezes) — confira antes de concluir."
    style="font-size:11px;color:#999;font-style:italic;margin-left:6px">provável: ${loja}${quem}</span>`;
}

function ccCaixasOrdenados(mapa) {
  return Object.values(mapa || {}).sort((a, b) =>
    (ccLojaCurta(a.loja) || 'zz').localeCompare(ccLojaCurta(b.loja) || 'zz') ||
    (a.ext || 0) - (b.ext || 0));
}

// ---- Motor Etapa B: Getnet × Banco (por dia de crédito). Retorna { dias, faltaOFX }. ----
async function computeEtapaB(db, de, ate) {
  let fin;
  try {
    fin = await ccFetchPaginado(() => db.from('card_lotes_pagamento')
      .select('data_pagamento,modalidade,valor_liquido_esperado')
      .gte('data_pagamento', de).lte('data_pagamento', ate));
  } catch (e) { return { erro: 'getnet', dias: {}, faltaOFX: [] }; }
  const esperado = {}, debFin = {};
  fin.forEach(x => { const d = x.data_pagamento; if (!d) return; const v = Number(x.valor_liquido_esperado) || 0; esperado[d] = (esperado[d] || 0) + v; if (x.modalidade === 'debito') debFin[d] = (debFin[d] || 0) + v; });

  const { data: banco } = await db.from('lancamentos')
    .select('data_pagamento,valor').eq('tipo', 'receber').eq('status', 'pago')
    .ilike('descricao', '%GETNET%').gte('data_pagamento', de).lte('data_pagamento', ate);
  const recebido = {};
  (banco || []).forEach(b => { const d = (b.data_pagamento || '').slice(0, 10); recebido[d] = (recebido[d] || 0) + (Number(b.valor) || 0); });

  const deV = new Date(de + 'T12:00:00'); deV.setDate(deV.getDate() - 6);
  let vendas = [];
  try {
    vendas = await ccFetchPaginado(() => db.from('card_transacoes')
      .select('data_venda,valor_liquido').eq('tipo_registro', 'venda')
      .gte('data_venda', deV.toISOString().slice(0, 10)).lte('data_venda', ate));
  } catch (e) {}
  const creditDates = [...new Set(fin.map(x => x.data_pagamento).filter(Boolean))].sort();
  const proxCredito = sd => { for (const cd of creditDates) { if (cd > sd) return cd; } return null; };
  const vLiq = {};
  vendas.forEach(v => { if (!v.data_venda) return; const s = proxCredito(v.data_venda); if (!s) return; vLiq[s] = (vLiq[s] || 0) + (Number(v.valor_liquido) || 0); });

  const bankDates = Object.keys(recebido);
  const maxBankDate = bankDates.length ? bankDates.sort().slice(-1)[0] : null;

  const dias = {}; const faltaOFX = [];
  const chaves = [...new Set([...Object.keys(esperado), ...Object.keys(recebido)])].filter(d => d >= de && d <= ate);
  chaves.forEach(d => {
    const esp = esperado[d] || 0, rec = recebido[d] || 0, dif = esp - rec;
    let cor, txt, espMostrar = esp, difMostrar = dif, estimado = false, aguardando = false;
    if (rec > 0 && Math.abs(dif) <= 1) { cor = '#27ae60'; txt = '🟢 exato'; }
    else if (dif > 1) {
      if (rec === 0 && (!maxBankDate || d > maxBankDate)) { cor = '#e67e22'; txt = '⏳ importe o OFX'; aguardando = true; faltaOFX.push(ccDT(d)); }
      else { cor = '#e74c3c'; txt = '🔴 recebeu menos'; }
    } else {
      const ep = vLiq[d] || 0;
      if (ep > 0 && ep >= rec * 0.9) { espMostrar = ep; difMostrar = ep - rec; estimado = true; cor = '#c9930a'; txt = '🟠 fecha amanhã'; }
      else if (esp === 0 && rec > 0) { cor = '#e67e22'; txt = '🟠 falta o arquivo Getnet'; aguardando = true; }
      else { cor = '#e67e22'; txt = '🟠 fecha amanhã'; aguardando = true; }
    }
    dias[d] = { esp: espMostrar, rec, dif: difMostrar, cor, txt, estimado, aguardando };
  });
  return { dias, faltaOFX: [...new Set(faltaOFX)], creditDates };
}

// ---- Motor Pix: PDV × banco (venda a venda, por valor + data ±1 dia). Retorna { dias }. ----
// Banco não tem horário nem NSU no Pix → casa só por valor+data. O que sobra no banco é
// fiado/transferência (esperado); o que sobra no PDV é venda que não caiu (⚠️).
async function computePix(db, de, ate) {
  let pdv;
  const buscaPix = cols => ccFetchPaginado(() => db.from('pdv_vendas')
    .select(cols).eq('forma_pagamento', 'pix')
    .gte('data_hora_utc', de + 'T00:00:00-04:00').lte('data_hora_utc', ate + 'T23:59:59-04:00'));
  try {
    try { pdv = await buscaPix('id,data_hora_utc,valor_bruto,caixa_ext,caixa_usuario,unidade_nome'); }
    catch (semCaixa) { pdv = await buscaPix('id,data_hora_utc,valor_bruto'); }
  } catch (e) { return { dias: {} }; }
  if (!pdv.length) return { dias: {} };
  const dd = (s, off) => { const x = new Date(s + 'T12:00:00'); x.setDate(x.getDate() + off); return x.toISOString().slice(0, 10); };
  let banco = [];
  try {
    banco = await ccFetchPaginado(() => db.from('lancamentos')
      .select('valor,data_pagamento').eq('tipo', 'receber').ilike('descricao', '%PIX%')
      .gte('data_pagamento', dd(de, -1)).lte('data_pagamento', dd(ate, 1)));
  } catch (e) {}
  // Pool de Pix recebidos no banco por valor (centavos)
  const pool = new Map();
  banco.forEach(b => { const k = Math.round((Number(b.valor) || 0) * 100); const d = (b.data_pagamento || '').slice(0, 10); if (!d) return; (pool.get(k) || pool.set(k, []).get(k)).push({ data: d, used: false }); });
  // Mesma regra da Etapa A: ordem fixa = resultado sempre igual.
  pool.forEach(arr => arr.sort((a, b) => a.data.localeCompare(b.data)));
  const diaDiff = (a, b) => Math.round((Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 86400000);
  pdv.forEach(p => { const m = new Date(Date.parse(p.data_hora_utc) - 4 * 3600000).toISOString(); p.dia = m.slice(0, 10); p.hora = m.slice(11, 16); });
  const casar = p => {
    const k = Math.round((p.valor_bruto || 0) * 100); const arr = pool.get(k); if (!arr) return false;
    let best = null;
    for (const b of arr) { if (b.used) continue; const gap = Math.abs(diaDiff(p.dia, b.data)); if (gap > 1) continue; if (!best || gap < best.gap) best = { b, gap }; }
    if (best) { best.b.used = true; return true; }
    return false;
  };
  const dias = {};
  const novo = () => ({ n: 0, ok: 0, total: 0, semBanco: [], resolv: [], semExtrato: false, caixas: {} });
  // ordena por dia+hora → prioriza casar no mesmo dia (gap 0) na ordem cronológica
  pdv.sort((a, b) => (a.dia + a.hora).localeCompare(b.dia + b.hora) || String(a.id).localeCompare(String(b.id))).forEach(p => {
    const D = dias[p.dia] = dias[p.dia] || novo();
    D.n++; D.total += (p.valor_bruto || 0);
    const ck = ccCaixaChave(p);
    const C  = (D.caixas[ck] = D.caixas[ck] || { chave: ck, ext: p.caixa_ext || null,
      usuario: p.caixa_usuario || null, loja: p.unidade_nome || null, bruto: 0, n: 0, inv: 0 });
    C.bruto += (p.valor_bruto || 0); C.n++;
    if (casar(p)) D.ok++; else { D.semBanco.push(p); C.inv++; }
  });
  // Resolvidos manualmente (Pix informado errado no fechamento) — saem das pendências.
  const resMap = new Map();
  try {
    const resol = await ccFetchPaginado(() => db.from('conc_conciliacoes')
      .select('venda_pdv_id,tipo_divergencia').eq('etapa', 'pdv_banco').eq('status', 'resolvido_manual'));
    resol.forEach(r => { if (r.venda_pdv_id) resMap.set(r.venda_pdv_id, r); });
  } catch (e) { /* tabela pode não ter linhas ainda */ }
  Object.values(dias).forEach(D => {
    // Dia com muitas vendas e NENHUMA casada = extrato do banco não importado (não é erro).
    if (D.n >= 5 && D.ok === 0) { D.semExtrato = true; D.semBanco = []; return; }
    const still = [];
    D.semBanco.forEach(p => { const r = resMap.get(p.id); if (r) { p.resol = r; D.resolv.push(p); } else still.push(p); });
    D.semBanco = still;
  });
  return { dias };
}

let ccaDetalhe = {};
function ccaToggle(dia) {
  const el = document.getElementById('cca-det-' + dia.replace(/-/g, ''));
  if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
}

// ---- Render unificado: uma linha por dia (Vendas→Getnet | Getnet→Banco | Pix) ----
// ============ CARTÃO & PIX — CALENDÁRIO (valor recebido/dia; clicar abre as conferências) ============
let ccMes = '';        // 'YYYY-MM' em exibição
let ccDiaSel = '';     // dia selecionado 'YYYY-MM-DD'
let ccDetalhes = {};   // HTML do painel de conferências por dia
let ccResumoDia = {};  // { cor, valTxt, chip } por dia (para as células)

function ccMesAtual() { return new Date().toISOString().slice(0, 7); }
function ccPad(n) { return String(n).padStart(2, '0'); }
function ccMudarMes(delta) {
  const [Y, M] = (ccMes || ccMesAtual()).split('-').map(Number);
  const d = new Date(Y, M - 1 + delta, 1);
  ccMes = d.getFullYear() + '-' + ccPad(d.getMonth() + 1);
  ccDiaSel = '';
  renderCartao();
}
function ccDiaSemana(d) {
  const nomes = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const [Y, M, D] = d.split('-').map(Number);
  return nomes[new Date(Y, M - 1, D).getDay()];
}
function ccCalNav() {
  const [Y, M] = (ccMes || ccMesAtual()).split('-').map(Number);
  const nm = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const btn = 'style="border:1px solid #ddd;background:#fff;border-radius:8px;width:34px;height:34px;font-size:18px;cursor:pointer;color:#2c3e50;line-height:1"';
  return `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
    <button ${btn} onclick="ccMudarMes(-1)">‹</button>
    <strong style="font-size:16px;color:#2c3e50">${nm[M - 1]} / ${Y}</strong>
    <button ${btn} onclick="ccMudarMes(1)">›</button>
  </div>`;
}
function ccCalGridHTML() {
  const [Y, M] = (ccMes || ccMesAtual()).split('-').map(Number);
  const lastDay = new Date(Y, M, 0).getDate();
  const firstDow = new Date(Y, M - 1, 1).getDay();
  const dows = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const head = dows.map(w => `<div style="text-align:center;font-size:11px;font-weight:700;color:#999;padding:2px 0">${w}</div>`).join('');
  const vazio = () => '<div style="min-height:66px"></div>';
  let cells = '';
  for (let i = 0; i < firstDow; i++) cells += vazio();
  for (let day = 1; day <= lastDay; day++) cells += ccCalCellHTML(`${Y}-${ccPad(M)}-${ccPad(day)}`, day);
  const trail = (7 - ((firstDow + lastDay) % 7)) % 7;
  for (let i = 0; i < trail; i++) cells += vazio();
  return `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px">${head}${cells}</div>`;
}
function ccCalCellHTML(d, day) {
  const R = ccResumoDia[d];
  const sel = d === ccDiaSel ? 'box-shadow:0 0 0 2px #2c3e50;' : '';
  if (!R) return `<div style="min-height:66px;border:1px solid #f2f2f2;border-radius:8px;padding:4px 6px;background:#fafafa"><div style="font-size:12px;color:#ccc">${day}</div></div>`;
  return `<div onclick="ccAbrirDia('${d}')" style="min-height:66px;border:1px solid #eee;border-left:4px solid ${R.cor};border-radius:8px;padding:4px 6px;background:#fff;cursor:pointer;${sel}">
    <div style="font-size:12px;color:#999">${day}</div>
    <div style="font-size:13px;font-weight:700;color:#2c3e50;font-variant-numeric:tabular-nums;line-height:1.15">${R.valTxt}</div>
    <div style="font-size:10px;color:${R.cor};line-height:1.2;margin-top:1px">${R.chip}</div>
  </div>`;
}
function ccAbrirDia(d) {
  ccDiaSel = d;
  const cal = document.getElementById('car-cal');
  if (cal) cal.innerHTML = ccCalNav() + ccCalGridHTML();
  ccRenderDetalhe();
}
function ccRenderDetalhe() {
  const el = document.getElementById('car-detalhe');
  if (!el) return;
  el.innerHTML = (ccDiaSel && ccDetalhes[ccDiaSel]) ? ccDetalhes[ccDiaSel]
    : '<div class="sem-dados" style="padding:20px;color:#999">👈 Clique num dia do calendário para ver as conferências (PDV → Getnet → Banco e Pix).</div>';
}
function ccStatusBancoTxt(DB) {
  if (DB.txt.indexOf('exato') >= 0) return '🟢 exato — bateu certinho';
  if (DB.estimado) return `⏳ ainda vai cair ~${ccBRL(Math.max(0, DB.dif))} (fecha amanhã)`;
  if (DB.aguardando) return DB.txt;
  return `🔴 recebeu ${ccBRL(DB.dif)} a MENOS que o esperado`;
}

// ---- Palpite de forma trocada pelo PDV ------------------------------------
// A nuvem do iComanda troca a forma de pagamento de algumas vendas. O fechamento
// da loja (caixa_dia_conf.formas) diz QUANTO sobrou numa forma e quanto faltou
// em outra; as vendas daquele caixa dizem QUAL venda tem exatamente aquele valor.
// Onde as duas pontas batem, dá pra apontar a venda com nome e sobrenome.
// Conferido em agosto/2026: 13 vendas identificadas em 15 dias.
let ccPalpiteForma = new Map();

// Sobras e faltas por forma (e por bandeira, quando a API detalha).
function ccBuckets(formas) {
  const sobra = [], falta = [];
  (formas || []).forEach(f => {
    const nome = (f.forma || '').trim();
    const bs = f.bandeiras || [];
    if (bs.length) {
      bs.forEach(b => {
        const d = Number(b.computado || 0) - Number(b.digitado || 0);
        if (Math.abs(d) >= CXQ_RUIDO) (d > 0 ? sobra : falta).push({ forma: nome, bandeira: b.bandeira, valor: Math.abs(d) });
      });
    } else {
      const d = Number(f.computado || 0) - Number(f.digitado || 0);
      if (Math.abs(d) >= CXQ_RUIDO) (d > 0 ? sobra : falta).push({ forma: nome, bandeira: null, valor: Math.abs(d) });
    }
  });
  return { sobra, falta };
}

const ccBucketLbl = b => b.forma + (b.bandeira ? '/' + b.bandeira : '');

// Subconjunto de até 3 vendas que soma o valor procurado. Precisa disso porque
// uma forma pode ter perdido duas vendas de uma vez — no caixa 12807 de 09/08 o
// Pix sumido de R$ 128,03 era R$ 27,93 + R$ 100,10.
function ccSubset(valores, alvo, tol) {
  const n = valores.length;
  for (let i = 0; i < n; i++) {
    if (Math.abs(valores[i] - alvo) < tol) return [i];
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(valores[i] + valores[j] - alvo) < tol) return [i, j];
      for (let k = j + 1; k < n; k++)
        if (Math.abs(valores[i] + valores[j] + valores[k] - alvo) < tol) return [i, j, k];
    }
  }
  return null;
}

async function ccCarregarPalpites(db, de, ate) {
  ccPalpiteForma = new Map();
  let confs = [];
  try {
    confs = await ccFetchPaginado(() => db.from('caixa_dia_conf')
      .select('data,caixa_ext,formas').gte('data', de).lte('data', ate));
  } catch (e) { return; }   // coluna 'formas' ainda não existe
  const alvo = confs.filter(c => {
    const b = ccBuckets(cxqFormas(c));
    return b.sobra.length && b.falta.length;
  });
  if (!alvo.length) return;

  // Busca TODAS as formas de pagamento desses caixas, não só cartão: a venda
  // trocada pode ter ido parar no dinheiro ou num voucher.
  const caixas = [...new Set(alvo.map(c => c.caixa_ext).filter(x => x != null))];
  const dias = alvo.map(c => c.data).sort();
  let vendas = [];
  try {
    vendas = await ccFetchPaginado(() => db.from('pdv_vendas')
      .select('id,valor_bruto,bandeira,raw,caixa_ext,data_hora_utc')
      .in('caixa_ext', caixas)
      .gte('data_hora_utc', dias[0] + 'T00:00:00-04:00')
      .lte('data_hora_utc', dias[dias.length - 1] + 'T23:59:59-04:00'));
  } catch (e) { return; }
  vendas.forEach(v => { v._dia = new Date(Date.parse(v.data_hora_utc) - 4 * 3600000).toISOString().slice(0, 10); });

  alvo.forEach(c => {
    const { sobra, falta } = ccBuckets(cxqFormas(c));
    const doCaixa = vendas.filter(v => v._dia === c.data && String(v.caixa_ext) === String(c.caixa_ext));
    const usados = new Set(), pend = [];
    sobra.forEach(s => {
      // A venda trocada vale o que sobrou aqui OU o que faltou lá.
      const alvos = [s.valor].concat(falta.map(f => f.valor));
      let melhor = null;
      doCaixa.forEach(v => {
        if (usados.has(v.id)) return;
        const nome = ((v.raw && v.raw.forma) || '').trim();
        if (nome !== s.forma) return;
        // A API não manda a bandeira por venda; o robô grava 'Outro'. Nesse caso
        // a bandeira não desqualifica — o valor é que decide.
        if (s.bandeira && v.bandeira && v.bandeira !== 'Outro' && v.bandeira !== s.bandeira) return;
        alvos.forEach(a => {
          const d = Math.abs(Number(v.valor_bruto || 0) - a);
          if (d < 0.60 && (!melhor || d < melhor.d)) melhor = { d, v };
        });
      });
      if (melhor) { usados.add(melhor.v.id); pend.push({ v: melhor.v, de: s }); }
    });
    if (!pend.length) return;

    // Cada falta tem que ser explicada pelas vendas achadas.
    let livres = pend.map((_, i) => i);
    falta.slice().sort((a, b) => b.valor - a.valor).forEach(f => {
      const idx = ccSubset(livres.map(i => Number(pend[i].v.valor_bruto || 0)), f.valor, 0.60);
      if (!idx) return;
      const escolhidos = idx.map(i => livres[i]);
      escolhidos.forEach(i => {
        const g = classificarFormaPDV(f.forma).grupo;
        ccPalpiteForma.set(pend[i].v.id, { de: ccBucketLbl(pend[i].de), para: ccBucketLbl(f), grupo: g });
      });
      livres = livres.filter(i => escolhidos.indexOf(i) < 0);
    });
  });
}

async function renderCartao() {
  const cal = document.getElementById('car-cal');
  if (!cal) return;
  if (!ccMes) ccMes = ccMesAtual();
  const [Y, M] = ccMes.split('-').map(Number);
  const ate = `${Y}-${ccPad(M)}-${ccPad(new Date(Y, M, 0).getDate())}`;
  const mesIni = `${Y}-${ccPad(M)}-01`;
  const deB = new Date(Y, M - 1, 1); deB.setDate(deB.getDate() - 4);
  const de = deB.getFullYear() + '-' + ccPad(deB.getMonth() + 1) + '-' + ccPad(deB.getDate());
  cal.innerHTML = ccCalNav() + '<div class="sem-dados" style="padding:30px;color:#999">Cruzando…</div>';
  const db = obterSupabase();

  const A = await computeEtapaA(db, de, ate);
  const cardsEl = document.getElementById('car-cards');
  if (A.erro === 'pdv') { cal.innerHTML = ccCalNav() + '<div class="sem-dados" style="padding:30px;color:#999">Importe o relatório do PDV primeiro (botão no topo).</div>'; if (cardsEl) cardsEl.innerHTML = ''; ccResumoDia = {}; ccDetalhes = {}; ccRenderDetalhe(); return; }
  const B = await computeEtapaB(db, de, ate);
  const P = await computePix(db, de, ate);
  await ccCarregarPalpites(db, de, ate);

  // Regroup por dia de liquidação (proxCredito), igual à versão em tabela.
  const creditDates = B.creditDates || [];
  const proxCredito = sd => { for (const cd of creditDates) { if (cd > sd) return cd; } return null; };
  const novoT = () => ({ n: 0, ok: 0, invest: [], ruido: [], gAlone: [], resolv: [], saleDays: new Set(), pdvBruto: 0, gnetBruto: 0, caixas: {} });
  const diasA = {}, pixG = {};
  Object.keys(A.dias).forEach(sd => {
    const c = proxCredito(sd) || sd;
    const T = diasA[c] = diasA[c] || novoT();
    const DA = A.dias[sd];
    T.n += DA.n; T.ok += DA.ok; T.pdvBruto += DA.pdvBruto || 0; T.gnetBruto += DA.gnetBruto || 0;
    Object.values(DA.caixas || {}).forEach(c => {
      const t = (T.caixas[c.chave] = T.caixas[c.chave] || { ...c, bruto: 0, n: 0, inv: 0 });
      t.bruto += c.bruto; t.n += c.n; t.inv += c.inv;
    });
    ['invest', 'ruido', 'gAlone', 'resolv'].forEach(k => DA[k].forEach(x => { x._vd = sd; T[k].push(x); }));
    if (sd !== c) T.saleDays.add(sd);
  });
  const novoP = () => ({ n: 0, ok: 0, total: 0, semBanco: [], resolv: [], gapN: 0, caixas: {} });
  Object.keys(P.dias).forEach(sd => {
    const c = proxCredito(sd) || sd;
    const T = pixG[c] = pixG[c] || novoP();
    const PD = P.dias[sd];
    T.n += PD.n; T.ok += PD.ok; T.total += PD.total;
    Object.values(PD.caixas || {}).forEach(c => {
      const t = (T.caixas[c.chave] = T.caixas[c.chave] || { ...c, bruto: 0, n: 0, inv: 0 });
      t.bruto += c.bruto; t.n += c.n; t.inv += c.inv;
    });
    if (PD.semExtrato) T.gapN += PD.n;
    PD.semBanco.forEach(x => { x._vd = sd; T.semBanco.push(x); });
    (PD.resolv || []).forEach(x => { x._vd = sd; T.resolv.push(x); });
  });
  const diasB = B.dias;

  // Helpers de detalhe (reaproveitados da versão em tabela)
  const modLbl = m => m === 'debito' ? 'Déb' : m === 'credito_parcelado' ? 'Créd.parc' : m ? 'Créd' : '-';
  const modCor = m => m === 'debito' ? '#2980b9' : '#8e44ad';
  const cel = (a, m, b, c) => `<div style="display:flex;gap:8px;padding:1px 0;font-size:12px;color:#555"><span style="width:40px">${a}</span><span style="width:52px;color:${modCor(m)};font-weight:600">${modLbl(m)}</span><span style="width:46px">${b}</span><span style="width:80px;text-align:right">${c}</span></div>`;
  const rb = (kind, id, tipo, valor, label) => `<button title="${label}" onclick="event.stopPropagation();ccResolver('${kind}','${id}','${tipo}',${valor})" style="font-size:11px;border:1px solid #ddd;background:#fff;border-radius:5px;padding:2px 6px;cursor:pointer;white-space:nowrap">${label}</button>`;
  // A nuvem do PDV erra a forma de pagamento de algumas vendas (um Pix chega como
  // Débito, por exemplo). Aqui o caixa diz qual era a forma de verdade e a venda
  // muda de lugar: sai desta conferência e entra na conferência certa.
  const selForma = (p, atual) => {
    const ops = [['pix', 'Pix'], ['dinheiro', 'Dinheiro'], ['cartao', 'Cartão'],
      ['voucher', 'Voucher/Refeição'], ['ifood', 'iFood'], ['outro', 'Outro']].filter(o => o[0] !== atual);
    return `<select onchange="event.stopPropagation();ccTrocarForma('${p.id}',this.value,this)" onclick="event.stopPropagation()" style="font-size:11px;border:1px solid #ddd;border-radius:5px;padding:2px 5px;cursor:pointer;background:#fff;color:#555">
      <option value="">🔀 era outra forma…</option>
      ${ops.map(o => `<option value="${o[0]}">era ${o[1]}</option>`).join('')}
    </select>`;
  };
  // Quando o fechamento da loja aponta exatamente esta venda, o palpite vira um
  // botão com a resposta pronta — não precisa escolher na lista.
  const dicaForma = (p, atual) => {
    const g = ccPalpiteForma.get(p.id);
    if (!g) return '';
    const tit = `O fechamento da loja aponta esta venda: entrou como ${g.de} e era ${g.para}.`;
    if (g.grupo === atual) return `<span title="${tit}" style="font-size:11px;color:#8e44ad;white-space:nowrap;align-self:center">⇢ era ${g.para}</span>`;
    return `<button title="${tit}" onclick="event.stopPropagation();ccTrocarForma('${p.id}','${g.grupo}',this)" style="font-size:11px;border:1px solid #8e44ad;background:#f6effa;color:#8e44ad;font-weight:600;border-radius:5px;padding:2px 7px;cursor:pointer;white-space:nowrap">⇢ era ${g.para}</button>`;
  };
  const btnsPdv = p => `<span style="display:inline-flex;gap:4px;margin-left:6px">${dicaForma(p, 'cartao')}${selForma(p, 'cartao')}${rb('pdv', p.id, 'venda_nao_processada', p.valor_bruto, '💸 Perdida')}${rb('pdv', p.id, 'conferido', p.valor_bruto, '✔️ OK')}</span>`;
  const btnsGnet = g => `<span style="display:inline-flex;gap:4px;margin-left:6px">${rb('gnet', g.id, 'outra_comanda', g.valor, '🔀 Outra comanda')}${rb('gnet', g.id, 'cartao_duplicado', g.valor, '💳 2x')}${rb('gnet', g.id, 'conferido', g.valor, '✔️ OK')}</span>`;
  const btnsPix = p => `<span style="display:inline-flex;gap:4px;margin-left:6px">${dicaForma(p, 'pix')}${selForma(p, 'pix')}${rb('pix', p.id, 'venda_nao_processada', p.valor_bruto, '💸 Não recebido')}${rb('pix', p.id, 'conferido', p.valor_bruto, '✔️ OK')}</span>`;
  const motivoLbl = m => ({ forma_errada: 'Pago em outra forma', venda_nao_processada: 'Venda perdida', conferido: 'Conferido', outra_comanda: 'Lançada em outra comanda', cartao_duplicado: 'Cartão passado 2x', recebimento_sem_venda: 'Conferido' }[m] || m || 'Resolvido');
  const linhaAcao = inner => `<div style="display:flex;align-items:center;flex-wrap:wrap;padding:2px 0">${inner}</div>`;
  const bloco = (tit, inner) => `<div style="border:1px solid #eee;border-radius:10px;padding:10px 12px;margin-bottom:10px;background:#fff">${tit}${inner}</div>`;
  const linhaVal = (lbl, val, forte) => `<div style="display:flex;justify-content:space-between;font-size:13px;padding:1px 0"><span style="color:#777">${lbl}</span><span style="${forte ? 'font-weight:700;' : ''}font-variant-numeric:tabular-nums">${val}</span></div>`;

  ccDetalhes = {}; ccResumoDia = {};
  let totInv = 0, totGA = 0, totDivB = 0, totRec = 0, totPixOk = 0, totPixKO = 0;
  const allDays = [...new Set([...Object.keys(diasA), ...Object.keys(diasB), ...Object.keys(pixG)])].filter(d => d >= mesIni && d <= ate);

  allDays.forEach(d => {
    const DA = diasA[d], DB = diasB[d], PG = pixG[d];
    const invN = DA ? DA.invest.length : 0, gaN = DA ? DA.gAlone.length : 0;
    const pixKO = PG ? PG.semBanco.length : 0;
    const confN = PG ? (PG.n - PG.gapN) : 0;
    const recebeuMenos = DB && DB.txt.indexOf('recebeu menos') >= 0;
    const estimado = DB && DB.estimado;
    const rec = DB ? DB.rec : 0;

    // Resumo p/ a célula do calendário
    let cor = '#27ae60', chip = DB ? '✓ conferido' : '';
    if (recebeuMenos) { cor = '#e74c3c'; chip = '🔴 faltou ' + ccBRL(DB.dif); }
    else if (invN) { cor = '#e74c3c'; chip = '⚠️ ' + invN + ' a investigar'; }
    else if (gaN || pixKO) { cor = '#e67e22'; chip = [gaN ? '🟠 ' + gaN + ' cobrança' : '', pixKO ? '⚡ ' + pixKO + ' pix' : ''].filter(Boolean).join(' · '); }
    else if (estimado) { cor = '#c9930a'; chip = '⏳ fecha amanhã'; }
    else if (DB && DB.aguardando) { cor = DB.cor; chip = DB.txt; }
    else if (!DB) { cor = '#bbb'; chip = 'sem liquidação'; }
    const valTxt = rec > 0 ? ccBRL(rec) : (estimado ? ccBRL(rec) : (DB && DB.esp > 0 ? '~' + ccBRL(DB.esp) : '—'));
    ccResumoDia[d] = { cor, valTxt, chip };

    // Totais dos cards
    if (invN) totInv += invN;
    if (gaN) totGA += gaN;
    if (recebeuMenos) totDivB++;
    totRec += rec;
    if (pixKO > 0) totPixKO += pixKO; else if (confN > 0) totPixOk += confN;

    // ----- Painel de conferências do dia -----
    const sdArr = DA ? [...DA.saleDays].sort() : [];
    const multiSale = sdArr.length > 1;
    const subVendas = sdArr.length ? `vendas de ${sdArr.map(s => s.slice(8, 10) + '/' + s.slice(5, 7)).join(', ')}` : '';
    const dchip = x => multiSale && x._vd ? `<span style="font-size:10px;color:#999;width:36px;display:inline-block;flex:none">${x._vd.slice(8, 10)}/${x._vd.slice(5, 7)}</span>` : '';

    // Bloco 1 — PDV → Getnet
    let b1 = linhaVal('Vendido (PDV)', ccBRL(DA ? DA.pdvBruto : 0), true);
    // Quebra por caixa — só do lado do PDV (a Getnet não sabe o caixa).
    const cxs = DA ? ccCaixasOrdenados(DA.caixas) : [];
    if (cxs.length > 1) {
      b1 += cxs.map(c => `<div style="display:flex;justify-content:space-between;font-size:12px;padding:0 0 0 10px;color:#888">
        <span>${ccCaixaLabel(c)}${c.inv ? ` <span style="color:#e74c3c;font-weight:700">⚠️ ${c.inv}</span>` : ''}</span>
        <span style="font-variant-numeric:tabular-nums">${ccBRL(c.bruto)}</span></div>`).join('');
    }
    b1 += linhaVal('Getnet (bruto)', ccBRL(DA ? DA.gnetBruto : 0));
    const stA = invN ? `<span style="color:#e74c3c">⚠️ ${invN} venda(s) a investigar</span>` : (gaN ? `<span style="color:#e67e22">🟠 ${gaN} cobrança sem venda</span>` : '<span style="color:#27ae60">✓ bate</span>');
    b1 += `<div style="font-size:12px;margin-top:4px">${stA}</div>`;
    if (DA && invN) {
      // Agrupado por caixa: é o que permite ir direto conferir com quem operou.
      const porCx = {};
      DA.invest.forEach(p => { const k = ccCaixaChave(p); (porCx[k] = porCx[k] || []).push(p); });
      const l = ccCaixasOrdenados(DA.caixas).filter(c => porCx[c.chave]).map(c => {
        const itens = porCx[c.chave].sort((a, b) => (a._vd + a.hora).localeCompare(b._vd + b.hora))
          .map(p => linhaAcao(dchip(p) + cel(p.hora, p.mod, p.bandeira || '-', ccBRL(p.valor_bruto)) + btnsPdv(p))).join('');
        const cab = cxs.length > 1
          ? `<div style="font-size:11px;color:#555;font-weight:600;margin:4px 0 1px">${ccCaixaLabel(c)}</div>` : '';
        return cab + itens;
      }).join('');
      b1 += `<div style="margin-top:6px;font-size:11px;color:#e74c3c;font-weight:700">Venda no PDV sem nada na Getnet:</div>${l}`;
    }
    if (DA && gaN) { const l = DA.gAlone.slice().sort((a, b) => (a._vd + (a.hora || '')).localeCompare(b._vd + (b.hora || ''))).map(x => linhaAcao(dchip(x) + cel(x.hora || '', x.mod, x.band || '-', ccBRL(x.valor)) + ccPalpiteCaixa(x) + btnsGnet(x))).join(''); b1 += `<div style="margin-top:6px;font-size:11px;color:#e67e22;font-weight:700">Cobrança na Getnet sem venda no PDV:</div>${l}`; }
    if (DA && DA.resolv.length) { const l = DA.resolv.slice().map(x => { const isP = x.valor_bruto !== undefined; const kind = isP ? 'pdv' : 'gnet'; const band = isP ? (x.bandeira || '-') : (x.band || '-'); const val = isP ? x.valor_bruto : x.valor; return `<div style="display:flex;align-items:center;flex-wrap:wrap;padding:1px 0;opacity:.85">${dchip(x)}${cel(x.hora || '', x.mod, band, ccBRL(val))}<span style="font-size:11px;color:#16a085;margin-left:6px">✔️ ${motivoLbl(x.resol && x.resol.tipo_divergencia)}</span><button onclick="event.stopPropagation();ccDesfazer('${kind}','${x.id}')" style="font-size:11px;border:none;background:none;color:#999;cursor:pointer;text-decoration:underline;margin-left:4px">desfazer</button></div>`; }).join(''); b1 += `<div style="margin-top:6px;font-size:11px;color:#16a085;font-weight:700">✔️ Resolvidos:</div>${l}`; }
    if (DA && DA.ruido.length) b1 += `<div style="margin-top:6px;font-size:11px;color:#999">🔗 ${DA.ruido.length} par(es) de ruído (mesma venda digitada torto — não é problema).</div>`;

    // Bloco 2 — Getnet → Banco
    let b2 = linhaVal('Líquido a receber', DB ? (estimado ? '~' : '') + ccBRL(DB.esp) : '—') + linhaVal('Caiu no banco', DB ? ccBRL(DB.rec) : '—', true);
    b2 += `<div style="font-size:12px;margin-top:4px;color:${DB ? DB.cor : '#999'}">${DB ? ccStatusBancoTxt(DB) : '— sem dados do banco'}</div>`;

    // Bloco 3 — Pix
    let b3;
    if (PG && PG.n) {
      const stP = pixKO > 0 ? `<span style="color:#e67e22">⚠️ ${pixKO} de ${confN} não caíram</span>` : (PG.gapN ? `<span style="color:#c9930a">⏳ ${PG.gapN} sem extrato importado</span>` : `<span style="color:#16a085">🟢 ${confN} conferidos</span>`);
      b3 = linhaVal('Total Pix (PDV)', ccBRL(PG.total), true);
      const cxsP = ccCaixasOrdenados(PG.caixas);
      if (cxsP.length > 1) {
        b3 += cxsP.map(c => `<div style="display:flex;justify-content:space-between;font-size:12px;padding:0 0 0 10px;color:#888">
          <span>${ccCaixaLabel(c)}${c.inv ? ` <span style="color:#e67e22;font-weight:700">⚠️ ${c.inv}</span>` : ''}</span>
          <span style="font-variant-numeric:tabular-nums">${ccBRL(c.bruto)}</span></div>`).join('');
      }
      b3 += `<div style="font-size:12px;margin-top:4px">${stP}</div>`;
      if (pixKO > 0) {
        const linhaPix = p => linhaAcao(dchip(p) + `<span style="font-size:12px;color:#555;width:46px">${p.hora || ''}</span><span style="font-size:12px;width:80px;text-align:right">${ccBRL(p.valor_bruto)}</span>` + btnsPix(p));
        const porCx = {};
        PG.semBanco.forEach(p => { const k = ccCaixaChave(p); (porCx[k] = porCx[k] || []).push(p); });
        const l = cxsP.filter(c => porCx[c.chave]).map(c => {
          const itens = porCx[c.chave].sort((a, b) => ((a._vd || '') + (a.hora || '')).localeCompare((b._vd || '') + (b.hora || ''))).map(linhaPix).join('');
          const cab = cxsP.length > 1 ? `<div style="font-size:11px;color:#555;font-weight:600;margin:4px 0 1px">${ccCaixaLabel(c)}</div>` : '';
          return cab + itens;
        }).join('');
        b3 += `<div style="margin-top:6px;font-size:11px;color:#e67e22;font-weight:700">Pix do PDV sem entrada no banco:</div>${l}`;
      }
      if (PG.resolv && PG.resolv.length) {
        const l = PG.resolv.slice().sort((a, b) => ((a._vd || '') + (a.hora || '')).localeCompare((b._vd || '') + (b.hora || ''))).map(p => `<div style="display:flex;align-items:center;flex-wrap:wrap;padding:1px 0;opacity:.85">${dchip(p)}<span style="font-size:12px;color:#555;width:46px">${p.hora || ''}</span><span style="font-size:12px;width:80px;text-align:right">${ccBRL(p.valor_bruto)}</span><span style="font-size:11px;color:#16a085;margin-left:6px">✔️ ${motivoLbl(p.resol && p.resol.tipo_divergencia)}</span><button onclick="event.stopPropagation();ccDesfazer('pix','${p.id}')" style="font-size:11px;border:none;background:none;color:#999;cursor:pointer;text-decoration:underline;margin-left:4px">desfazer</button></div>`).join('');
        b3 += `<div style="margin-top:6px;font-size:11px;color:#16a085;font-weight:700">✔️ Resolvidos:</div>${l}`;
      }
    } else { b3 = '<div style="font-size:12px;color:#999">Sem Pix nesse dia.</div>'; }

    const header = `<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;gap:10px">
      <div><div style="font-size:15px;font-weight:800;color:#2c3e50">${ccDiaSemana(d)}, ${ccDT(d)}</div>${subVendas ? `<div style="font-size:11px;color:#999">${subVendas}</div>` : ''}</div>
      <div style="text-align:right"><div style="font-size:11px;color:#999">recebido no banco</div><div style="font-size:20px;font-weight:800;color:#16a085">${rec > 0 ? ccBRL(rec) : '—'}</div></div>
    </div>`;
    ccDetalhes[d] = header
      + bloco('<div style="font-size:13px;font-weight:700;color:#2c3e50;margin-bottom:4px">💳 PDV → Getnet</div>', b1)
      + bloco('<div style="font-size:13px;font-weight:700;color:#2c3e50;margin-bottom:4px">🌐 Getnet → Banco</div>', b2)
      + bloco('<div style="font-size:13px;font-weight:700;color:#2c3e50;margin-bottom:4px">⚡ Pix (PDV × banco)</div>', b3);
  });

  // Seleção (mantém o dia aberto, ou pega o mais recente com dado)
  if (!ccDiaSel || !ccResumoDia[ccDiaSel]) {
    const comDado = Object.keys(ccResumoDia).sort();
    ccDiaSel = comDado.length ? comDado[comDado.length - 1] : '';
  }
  cal.innerHTML = ccCalNav() + ccCalGridHTML();

  const aviso = document.getElementById('car-aviso');
  if (aviso) aviso.innerHTML = (B.faltaOFX && B.faltaOFX.length)
    ? `<div style="background:#fff8e1;border:1px solid #f0c36d;border-radius:10px;padding:12px 16px;margin:4px 0 10px;color:#7a5c00"><i class="fas fa-hourglass-half"></i> <strong>Falta importar o extrato bancário (OFX)</strong> de: ${B.faltaOFX.join(', ')}. Esses dias só conciliam depois de importar o extrato (Gestão → Importar Extrato).</div>`
    : '';

  if (cardsEl) {
    const card = (r, v, c) => `<div style="flex:1;min-width:140px;background:#fff;border:1px solid #eee;border-left:4px solid ${c};border-radius:8px;padding:10px 14px"><div style="font-size:12px;color:#777">${r}</div><div style="font-size:18px;font-weight:700">${v}</div></div>`;
    cardsEl.innerHTML = `<div style="display:flex;gap:10px;flex-wrap:wrap;margin:14px 0">
      ${card('⚠️ Vendas a investigar', String(totInv), totInv ? '#e74c3c' : '#27ae60')}
      ${card('🟠 Cobrança sem venda', String(totGA), totGA ? '#e67e22' : '#27ae60')}
      ${card('🏦 Recebido no mês', ccBRL(totRec), '#27ae60')}
      ${card('⚡ Pix não caíram', totPixKO + (totPixOk + totPixKO ? ` <span style="font-size:12px;color:#888">de ${totPixOk + totPixKO}</span>` : ''), totPixKO ? '#e67e22' : '#16a085')}
    </div>`;
  }

  ccRenderDetalhe();
}

// ============ CAIXA EM ESPÉCIE — confere o dinheiro do dia → gera recebimento no Caixa ============
let cxeDataSel = '';
let cxeCtx = { data: '', vendas: 0, fechamento: null };
function cxeHoje() { return new Date().toISOString().slice(0, 10); }
function cxeNum(id) { const el = document.getElementById(id); return el ? (parseFloat(el.value) || 0) : 0; }
function cxeCaixaBancoId() { return (bancosCadastrados || []).find(b => { const n = (b.nome || '').toLowerCase(); return n.includes('caixa') || n.includes('dinheiro'); })?.id || null; }
function cxeTrocarData(d) { cxeDataSel = d; cxeRenderPainel(); }

// ===== CONCILIAÇÃO DO DINHEIRO — calendário (conferência por caixa + pagamentos → Contas a Pagar) =====
let cxqMes = '', cxqDiaSel = '', cxqResumoDia = {}, cxqDetalhes = {};
const CXQ_TOL = 1.00; // diferença de caixa aceitável (R$)

function cxqContado(c) { return c.contado_ajuste != null ? Number(c.contado_ajuste) : Number(c.contado_api || 0); }

// Valor das diferenças já explicadas por uma despesa (id do lançamento → valor).
// O botão só aparece se a coluna dif_lancamento_id existir (select('*') não a
// traz antes do SQL) — assim a tela não oferece um botão que iria falhar.
let cxqDifValor = {};

// Diferença de caixa já lançada como despesa. Caso típico: cliente pagou no
// cartão, pediu para tirar o serviço e o gerente devolveu em espécie sem
// registrar sangria no PDV — o dinheiro saiu da gaveta, mas o "esperado" que
// vem da API do PDV não sabe disso.
function cxqDifLancada(c) { return c.dif_lancamento_id ? (cxqDifValor[c.dif_lancamento_id] || 0) : 0; }

// Esperado da API menos o que já foi lançado como despesa.
// Se o fechamento da loja foi adotado, ele manda (ver cxqDiag abaixo).
function cxqEsperado(c) {
  if (c.esperado_ajuste != null) return Number(c.esperado_ajuste);
  return Number(c.esperado || 0) - cxqDifLancada(c);
}

// ---- Fechamento da loja × nuvem do PDV ------------------------------------
// A nuvem do iComanda troca a forma de pagamento de algumas vendas antes de
// mandar pra API (Sodexo vira Alelo, Pix vira Débito...). A API manda os dois
// números por forma: 'computado' (da nuvem, errado) e 'digitado' (o fechamento
// que a loja fez no PDV, certo). O robô guarda os dois em caixa_dia_conf.formas.
const CXQ_RUIDO = 1.00; // abaixo disso é arredondamento (o caixa digita reais redondos)

function cxqFormas(c) {
  const f = c && c.formas;
  if (!f) return null;
  try { return typeof f === 'string' ? JSON.parse(f) : f; } catch (e) { return null; }
}

// Diagnóstico do caixa: o que a nuvem trocou e se o caixa fecha assim mesmo.
// A soma dos desvios de TODAS as formas é o teste: se dá zero, nada sumiu —
// a nuvem só pendurou o dinheiro na forma errada.
function cxqDiag(c) {
  const formas = cxqFormas(c);
  if (!formas || !formas.length) return null;
  const desvios = formas.map(f => ({
    forma: (f.forma || '').trim(), computado: Number(f.computado || 0),
    digitado: Number(f.digitado || 0), bandeiras: f.bandeiras || null,
    valor: Number(f.computado || 0) - Number(f.digitado || 0)
  }));
  const grandes = desvios.filter(d => Math.abs(d.valor) >= CXQ_RUIDO);
  if (!grandes.length) return null;
  const soma = desvios.reduce((s, d) => s + d.valor, 0);
  const din = desvios.find(d => /inheiro/.test(d.forma));
  const difDin = din ? din.valor : 0;
  return { formas, desvios, grandes, soma,
    // Os desvios se anulam dentro do caixa → a nuvem só trocou os rótulos.
    troca: Math.abs(soma) < CXQ_RUIDO,
    // A troca chegou a mexer no dinheiro? Se não, não há o que corrigir aqui —
    // interessa só pra achar a venda na conferência de Cartão e Pix.
    mexeNoDinheiro: Math.abs(difDin) >= CXQ_TOL,
    difDinheiro: difDin,
    dinheiroLoja: din ? din.digitado : null, dinheiroNuvem: din ? din.computado : null };
}

// Emparelha o que faltou numa forma com o que sobrou em outra, quando o valor
// bate exatamente — aí dá pra dizer "Sodexo virou Alelo" com todas as letras.
function cxqPares(grandes) {
  const mais = grandes.filter(d => d.valor > 0).map(d => ({ ...d }));
  const menos = grandes.filter(d => d.valor < 0).map(d => ({ ...d }));
  const pares = [], faltou = [], sobrou = [];
  menos.forEach(m => {
    const i = mais.findIndex(x => !x._usado && Math.abs(x.valor + m.valor) < 0.02);
    if (i >= 0) { mais[i]._usado = true; pares.push({ real: m.forma, virou: mais[i].forma, valor: -m.valor }); }
    else faltou.push({ forma: m.forma, valor: -m.valor });
  });
  mais.filter(x => !x._usado).forEach(x => sobrou.push({ forma: x.forma, valor: x.valor }));
  return { pares, faltou, sobrou };
}

// Faturado em dinheiro do caixa (o que vira a Conta a Receber). Com o fechamento
// da loja adotado, é o que a loja apurou mais os pagamentos que saíram da gaveta.
function cxqBruto(c, despesas) {
  if (c.esperado_ajuste != null) return Number(c.esperado_ajuste) + Number(despesas || 0);
  return Number(c.vendas_dinheiro || 0);
}

// A diferença deste caixa já está explicada pela troca de formas do PDV?
// Se está, lançar despesa seria inventar uma saída de dinheiro que não houve —
// o certo ali é adotar o fechamento da loja.
function cxqTrocaExplica(c) {
  const dg = cxqDiag(c);
  return !!(dg && dg.troca && dg.mexeNoDinheiro);
}

async function cxqDespesasDb(db, c) {
  const { data } = await db.from('caixa_movimentos').select('valor')
    .eq('tipo', 'pagamento').eq('data', c.data).eq('caixa_ext', c.caixa_ext);
  return (data || []).reduce((s, m) => s + Number(m.valor || 0), 0);
}

async function renderCaixaEspecie() {
  if (!document.getElementById('cxq-cal')) return;
  if (!cxqMes) cxqMes = ccMesAtual();
  const cal = document.getElementById('cxq-cal');
  cal.innerHTML = cxqCalNav() + '<div class="sem-dados" style="padding:30px;color:#999">Carregando…</div>';
  const db = obterSupabase();
  const [Y, M] = cxqMes.split('-').map(Number);
  const mesIni = `${Y}-${ccPad(M)}-01`;
  const mesFim = `${Y}-${ccPad(M)}-${ccPad(new Date(Y, M, 0).getDate())}`;

  let confs = [], movs = [];
  try {
    confs = await ccFetchPaginado(() => db.from('caixa_dia_conf').select('*').gte('data', mesIni).lte('data', mesFim));
    movs  = await ccFetchPaginado(() => db.from('caixa_movimentos').select('*').eq('tipo', 'pagamento').gte('data', mesIni).lte('data', mesFim));
  } catch (e) {
    cal.innerHTML = cxqCalNav() + '<div class="sem-dados" style="padding:30px;color:#999">Rode o SQL_CAIXA_CONCILIACAO.sql e espere o robô do caixa rodar.</div>';
    return;
  }

  // Valores das diferenças já lançadas, para abater do esperado.
  cxqDifValor = {};
  const difIds = confs.map(c => c.dif_lancamento_id).filter(Boolean);
  if (difIds.length) {
    try {
      const ls = await ccFetchPaginado(() => db.from('lancamentos').select('id,valor').in('id', difIds));
      ls.forEach(l => { cxqDifValor[l.id] = Number(l.valor) || 0; });
    } catch (e) { /* coluna nova ainda sem SQL — segue sem abater */ }
  }

  const dias = {};
  confs.forEach(c => { (dias[c.data] = dias[c.data] || { confs: [], movs: [] }).confs.push(c); });
  movs.forEach(m => { (dias[m.data] = dias[m.data] || { confs: [], movs: [] }).movs.push(m); });

  cxqResumoDia = {}; cxqDetalhes = {};
  let totPend = 0, totPendValor = 0, totDiv = 0, totContado = 0;
  Object.keys(dias).forEach(d => {
    const { confs: cs, movs: ms } = dias[d];
    const contado = cs.reduce((s, c) => s + cxqContado(c), 0);
    const maxDif = cs.reduce((mx, c) => Math.max(mx, Math.abs(cxqContado(c) - cxqEsperado(c))), 0);
    const pend = ms.filter(m => m.status === 'pendente');
    totContado += contado;
    if (pend.length) { totPend += pend.length; totPendValor += pend.reduce((s, m) => s + Number(m.valor || 0), 0); }
    let cor = '#27ae60', chip = '✓ conferido';
    if (maxDif > CXQ_TOL) { cor = '#e74c3c'; chip = '⚠️ dif ' + ccBRL(maxDif); totDiv++; }
    else if (pend.length) { cor = '#e67e22'; chip = '🟠 ' + pend.length + ' pagto'; }
    cxqResumoDia[d] = { cor, valTxt: ccBRL(contado), chip };
    cxqDetalhes[d] = cxqDetalheHTML(d, cs, ms);
  });

  const cardsEl = document.getElementById('cxq-cards');
  if (cardsEl) {
    const card = (r, v, c) => `<div style="flex:1;min-width:150px;background:#fff;border:1px solid #eee;border-left:4px solid ${c};border-radius:8px;padding:10px 14px"><div style="font-size:12px;color:#777">${r}</div><div style="font-size:18px;font-weight:700">${v}</div></div>`;
    cardsEl.innerHTML = `<div style="display:flex;gap:10px;flex-wrap:wrap;margin:14px 0">
      ${card('🟠 Pagamentos a categorizar', String(totPend), totPend ? '#e67e22' : '#27ae60')}
      ${card('💰 Total a categorizar', ccBRL(totPendValor), '#e67e22')}
      ${card('⚠️ Dias com diferença', String(totDiv), totDiv ? '#e74c3c' : '#27ae60')}
      ${card('💵 Dinheiro conferido (mês)', ccBRL(totContado), '#27ae60')}
    </div>`;
  }

  if (!cxqDiaSel || !cxqResumoDia[cxqDiaSel]) {
    const comDado = Object.keys(cxqResumoDia).sort();
    cxqDiaSel = comDado.length ? comDado[comDado.length - 1] : '';
  }
  cal.innerHTML = cxqCalNav() + cxqCalGridHTML();
  cxqRenderDetalhe();
}

function cxqMudarMes(delta) {
  const [Y, M] = (cxqMes || ccMesAtual()).split('-').map(Number);
  const d = new Date(Y, M - 1 + delta, 1);
  cxqMes = d.getFullYear() + '-' + ccPad(d.getMonth() + 1);
  cxqDiaSel = '';
  renderCaixaEspecie();
}
function cxqCalNav() {
  const [Y, M] = (cxqMes || ccMesAtual()).split('-').map(Number);
  const nm = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const btn = 'style="border:1px solid #ddd;background:#fff;border-radius:8px;width:34px;height:34px;font-size:18px;cursor:pointer;color:#2c3e50;line-height:1"';
  return `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
    <button ${btn} onclick="cxqMudarMes(-1)">‹</button>
    <strong style="font-size:16px;color:#2c3e50">${nm[M - 1]} / ${Y}</strong>
    <button ${btn} onclick="cxqMudarMes(1)">›</button></div>`;
}
function cxqCalGridHTML() {
  const [Y, M] = (cxqMes || ccMesAtual()).split('-').map(Number);
  const lastDay = new Date(Y, M, 0).getDate();
  const firstDow = new Date(Y, M - 1, 1).getDay();
  const dows = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const head = dows.map(w => `<div style="text-align:center;font-size:11px;font-weight:700;color:#999;padding:2px 0">${w}</div>`).join('');
  const vazio = () => '<div style="min-height:66px"></div>';
  let cells = '';
  for (let i = 0; i < firstDow; i++) cells += vazio();
  for (let day = 1; day <= lastDay; day++) cells += cxqCalCellHTML(`${Y}-${ccPad(M)}-${ccPad(day)}`, day);
  const trail = (7 - ((firstDow + lastDay) % 7)) % 7;
  for (let i = 0; i < trail; i++) cells += vazio();
  return `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px">${head}${cells}</div>`;
}
function cxqCalCellHTML(d, day) {
  const R = cxqResumoDia[d];
  const sel = d === cxqDiaSel ? 'box-shadow:0 0 0 2px #2c3e50;' : '';
  if (!R) return `<div style="min-height:66px;border:1px solid #f2f2f2;border-radius:8px;padding:4px 6px;background:#fafafa"><div style="font-size:12px;color:#ccc">${day}</div></div>`;
  return `<div onclick="cxqAbrirDia('${d}')" style="min-height:66px;border:1px solid #eee;border-left:4px solid ${R.cor};border-radius:8px;padding:4px 6px;background:#fff;cursor:pointer;${sel}">
    <div style="font-size:12px;color:#999">${day}</div>
    <div style="font-size:13px;font-weight:700;color:#2c3e50;font-variant-numeric:tabular-nums;line-height:1.15">${R.valTxt}</div>
    <div style="font-size:10px;color:${R.cor};line-height:1.2;margin-top:1px">${R.chip}</div></div>`;
}
function cxqAbrirDia(d) {
  cxqDiaSel = d;
  const cal = document.getElementById('cxq-cal');
  if (cal) cal.innerHTML = cxqCalNav() + cxqCalGridHTML();
  cxqRenderDetalhe();
}
function cxqRenderDetalhe() {
  const el = document.getElementById('cxq-detalhe');
  if (!el) return;
  el.innerHTML = (cxqDiaSel && cxqDetalhes[cxqDiaSel]) ? cxqDetalhes[cxqDiaSel]
    : '<div class="sem-dados" style="padding:20px;color:#999">👈 Clique num dia pra ver os caixas e pagamentos.</div>';
}

function cxqPagamentoHTML(m) {
  if (m.status === 'lancado') {
    return `<div style="font-size:12px;color:#16a085;padding:2px 0">✔️ ${m.hora || ''} ${ccBRL(m.valor)} — ${m.descricao || ''} <button onclick="cxqDesfazer('${m.id}')" style="font-size:10px;border:none;background:none;color:#999;cursor:pointer;text-decoration:underline">desfazer</button></div>`;
  }
  return `<div style="background:#fbf8f2;border:1px solid #efe0c8;border-radius:8px;padding:8px 10px;margin-bottom:6px">
    <div style="font-size:12px;color:#2c3e50"><strong>${ccBRL(m.valor)}</strong> · ${m.hora || ''} · <span style="color:#777">${m.descricao || ''}</span></div>
    <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;justify-content:flex-end">
      <button onclick="cxqCategorizar('${m.id}')" style="font-size:12px;background:#2c3e50;color:#fff;border:0;border-radius:6px;padding:5px 10px;cursor:pointer;white-space:nowrap">→ Contas a Pagar</button>
    </div></div>`;
}

function cxqDetalheHTML(d, confs, movs) {
  // agrupa por loja → caixa (pagamentos ficam sob o caixa a que pertencem)
  const lojas = {};
  const getCx = (loja, ext) => {
    const L = lojas[loja || '—'] = lojas[loja || '—'] || { caixas: {}, ordem: [] };
    if (!L.caixas[ext]) { L.caixas[ext] = { ext, conf: null, movs: [] }; L.ordem.push(ext); }
    return L.caixas[ext];
  };
  confs.forEach(c => { getCx(c.unidade_nome, c.caixa_ext).conf = c; });
  movs.forEach(m => { getCx(m.unidade_nome, m.caixa_ext).movs.push(m); });

  let html = `<div style="font-size:15px;font-weight:800;color:#2c3e50;margin-bottom:12px">${ccDiaSemana(d)}, ${ccDT(d)}</div>`;
  Object.keys(lojas).sort().forEach(loja => {
    html += `<div style="font-size:13px;font-weight:700;color:#2c3e50;margin:10px 0 6px;border-bottom:1px solid #eee;padding-bottom:3px">🏬 ${loja}</div>`;
    const caixas = Object.values(lojas[loja].caixas).sort((a, b) => a.ext - b.ext);
    caixas.forEach(({ ext, conf: c, movs: ms }) => {
      const despesas = (ms || []).reduce((s, m) => s + Number(m.valor || 0), 0);
      const temPend = ms.some(m => m.status !== 'lancado');
      const linha = (lbl, val, opt) => `<div style="display:flex;justify-content:space-between;font-size:12px;padding:1px 0"><span style="color:#777">${lbl}</span><span style="${(opt && opt.forte) ? 'font-weight:700;' : ''}${(opt && opt.cor) ? 'color:' + opt.cor + ';' : ''}font-variant-numeric:tabular-nums">${val}</span></div>`;
      // lista de pagamentos (categorize) — entra logo abaixo do (−) Pagamentos
      const pagList = ms.length
        ? `<div style="font-size:11px;color:#e67e22;font-weight:700;margin:7px 0 5px">💸 Pagamentos deste caixa — categorize:</div>`
          + ms.slice().sort((a, b) => (a.hora || '').localeCompare(b.hora || '')).map(m => cxqPagamentoHTML(m)).join('')
        : '';
      let card;
      if (c) {
        const contado = cxqContado(c);
        const difLanc = cxqDifLancada(c);
        const esperado = cxqEsperado(c);
        const bruto = cxqBruto(c, despesas);
        const dif = contado - esperado;
        const corDif = Math.abs(dif) <= CXQ_TOL ? '#27ae60' : '#e74c3c';
        const okc = c.confirmado ? '<span style="font-size:11px;color:#16a085">✔️ conferido</span>' : '';
        card = `<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><span style="font-weight:700;color:#2c3e50">Caixa ${ext}</span>${okc}</div>
          ${linha('Faturado em dinheiro', ccBRL(bruto))}
          ${c.esperado_ajuste != null ? `<div style="font-size:11px;color:#2e7d32;padding:1px 0">✔️ pelo fechamento da loja <button onclick="cxqDesfazerLoja('${c.id}')" style="font-size:10px;border:none;background:none;color:#999;cursor:pointer;text-decoration:underline">desfazer</button></div>` : ''}
          ${despesas > 0 ? linha('(−) Pagamentos', ccBRL(despesas), { cor: '#e67e22' }) : ''}
          ${pagList}
          ${difLanc > 0 ? linha('(−) Diferença lançada', ccBRL(difLanc), { cor: '#8e44ad' })
            + `<div style="font-size:11px;color:#8e44ad;padding:1px 0">✔️ lançada no Contas a Pagar <button onclick="cxqDesfazerDif('${c.id}')" style="font-size:10px;border:none;background:none;color:#999;cursor:pointer;text-decoration:underline">desfazer</button></div>` : ''}
          ${cxqTrocaHTML(c)}
          <div style="border-top:1px solid #eee;margin:7px 0 3px"></div>
          ${linha('Esperado no caixa', ccBRL(esperado), { forte: true })}
          <div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap">
            <span style="font-size:12px;color:#777">contado</span>
            <input type="number" step="0.01" id="cxq-cont-${c.id}" value="${contado.toFixed(2)}" style="width:90px;text-align:right;padding:4px 6px;border:1px solid #ddd;border-radius:6px;font-size:13px">
            <span style="font-size:12px;font-weight:700;color:${corDif}">dif ${dif > 0 ? '+' : ''}${ccBRL(dif)}</span>
            ${(dif < -CXQ_TOL && ('dif_lancamento_id' in c) && !c.dif_lancamento_id && !cxqTrocaExplica(c)) ? `<button onclick="cxqLancarDif('${c.id}')" title="O dinheiro saiu da gaveta mas não foi registrado no PDV (ex.: devolução ao cliente). Cria a despesa e a diferença zera." style="font-size:11px;border:1px solid #8e44ad;background:#fff;color:#8e44ad;border-radius:6px;padding:4px 9px;cursor:pointer;white-space:nowrap">↳ lançar falta como despesa</button>` : ''}
            <button onclick="cxqConfirmar('${c.id}')" style="margin-left:auto;font-size:12px;border:1px solid #2c3e50;background:#2c3e50;color:#fff;border-radius:6px;padding:5px 14px;cursor:pointer;white-space:nowrap">${c.confirmado ? 'Atualizar' : 'Confirmar'}</button>
          </div>`;
      } else {
        card = `<div style="font-size:13px;font-weight:700;color:#2c3e50">Caixa ${ext}</div><div style="font-size:11px;color:#999;margin-bottom:4px">(sem conferência de dinheiro)</div>${pagList}`;
      }
      html += `<div style="background:#fff;border:1px solid #e6e6e6;${temPend ? 'border-left:3px solid #e67e22;' : ''}border-radius:10px;padding:10px 12px;margin-bottom:8px">${card}</div>`;
    });
  });
  return html;
}

// Aviso de "a nuvem do PDV trocou a forma de pagamento" + tabela nuvem × loja.
function cxqTrocaHTML(c) {
  const dg = cxqDiag(c);
  if (!dg) return '';
  // Se a única divergência é o próprio dinheiro, a linha "dif" logo acima já
  // conta a história inteira — repetir aqui só polui o card.
  if (!dg.troca && dg.grandes.length === 1 && /inheiro/.test(dg.grandes[0].forma)) return '';
  const { pares, faltou, sobrou } = cxqPares(dg.grandes);
  const lista = l => l.map(x => `${x.forma} ${ccBRL(x.valor)}`).join(' · ');
  // Só oferece adotar o fechamento da loja quando a troca de fato sujou o
  // dinheiro deste caixa. Senão, trocar o número só perderia centavos à toa.
  const podeAdotar = dg.troca && dg.mexeNoDinheiro && dg.dinheiroLoja != null
    && ('esperado_ajuste' in c) && c.esperado_ajuste == null;

  let corpo = pares.map(p => `<div style="padding:1px 0"><strong>${p.real} ${ccBRL(p.valor)}</strong> entrou como ${p.virou}</div>`).join('');
  if (faltou.length) corpo += `<div style="padding:1px 0">a nuvem contou <strong>a menos</strong> em: ${lista(faltou)}</div>`;
  if (sobrou.length) corpo += `<div style="padding:1px 0">a nuvem contou <strong>a mais</strong> em: ${lista(sobrou)}</div>`;

  let tit, cor, rodape;
  if (dg.troca && dg.mexeNoDinheiro) {
    tit = '⚠️ O PDV trocou a forma de pagamento — o caixa fecha assim mesmo';
    cor = '#e67e22';
    rodape = 'O total do caixa está certo: nada sumiu, só foi pendurado na forma errada.';
  } else if (dg.troca) {
    tit = 'ℹ️ O PDV trocou a forma de pagamento (o dinheiro não foi afetado)';
    cor = '#7f8c8d';
    rodape = 'Serve pra achar a venda na conferência de Cartão e Pix.';
  } else if (dg.mexeNoDinheiro) {
    tit = `⚠️ Em dinheiro, o PDV e a loja divergem em ${ccBRL(Math.abs(dg.difDinheiro))}`;
    cor = '#c0392b';
    rodape = 'Não é troca de rótulo: sobra diferença de verdade. Se ela se explicar (devolução, sangria não registrada), use o botão de lançar a falta como despesa.';
  } else {
    tit = 'ℹ️ O PDV divergiu da loja em outras formas (o dinheiro está certo)';
    cor = '#7f8c8d';
    rodape = 'Não mexe no dinheiro deste caixa; interessa à conferência de Cartão e Pix.';
  }
  const discreto = !dg.mexeNoDinheiro;

  const tid = 'cxq-fech-' + c.id;
  const linhaT = (nome, nuvem, loja, ind) => {
    const d = nuvem - loja;
    const cd = Math.abs(d) < CXQ_RUIDO ? '#999' : (d > 0 ? '#c0392b' : '#2e7d32');
    return `<tr><td style="padding:2px 6px;${ind ? 'padding-left:20px;color:#888' : ''}">${nome}</td>
      <td style="padding:2px 6px;text-align:right;font-variant-numeric:tabular-nums">${ccBRL(nuvem)}</td>
      <td style="padding:2px 6px;text-align:right;font-variant-numeric:tabular-nums">${ccBRL(loja)}</td>
      <td style="padding:2px 6px;text-align:right;font-variant-numeric:tabular-nums;color:${cd}">${Math.abs(d) < 0.005 ? '—' : ccBRL(d)}</td></tr>`;
  };
  const linhas = dg.desvios.map(d => linhaT(d.forma, d.computado, d.digitado, false)
    + (d.bandeiras || []).map(b => linhaT(b.bandeira, Number(b.computado || 0), Number(b.digitado || 0), true)).join('')).join('');

  const tabela = `<div id="${tid}" style="display:none;margin-top:7px;overflow-x:auto">
      <table style="width:100%;font-size:11px;border-collapse:collapse">
        <tr style="color:#888;text-align:left"><th style="padding:2px 6px;font-weight:600">Forma</th>
          <th style="padding:2px 6px;text-align:right;font-weight:600">Nuvem</th>
          <th style="padding:2px 6px;text-align:right;font-weight:600">Loja</th>
          <th style="padding:2px 6px;text-align:right;font-weight:600">Dif.</th></tr>
        ${linhas}
      </table>
    </div>`;

  // Quando o dinheiro não foi afetado, isso é recado — não alarme. Fica numa
  // linha discreta para não competir com a diferença de caixa de verdade.
  if (discreto) {
    return `<div style="margin-top:7px">
      <div style="font-size:11px;color:#8a8a8a">${tit}
        <button onclick="cxqToggleFech('${tid}')" style="font-size:11px;border:none;background:none;color:#777;cursor:pointer;text-decoration:underline;padding:0 0 0 4px">ver</button></div>
      <div style="font-size:11px;color:#8a8a8a;margin-top:2px">${corpo}</div>
      ${tabela}
    </div>`;
  }

  return `<div style="background:#fdf6ec;border:1px solid #f0d9b5;border-radius:8px;padding:8px 10px;margin-top:8px">
    <div style="font-size:12px;font-weight:700;color:${cor};margin-bottom:4px">${tit}</div>
    <div style="font-size:12px;color:#5a5a5a">${corpo}</div>
    <div style="font-size:11px;color:#8a8a8a;margin-top:5px">${rodape}</div>
    <div style="display:flex;gap:8px;align-items:center;margin-top:7px;flex-wrap:wrap">
      ${podeAdotar ? `<button onclick="cxqUsarLoja('${c.id}')" style="font-size:11px;border:1px solid #2e7d32;background:#fff;color:#2e7d32;border-radius:6px;padding:4px 9px;cursor:pointer;white-space:nowrap">↳ usar o fechamento da loja</button>` : ''}
      <button onclick="cxqToggleFech('${tid}')" style="font-size:11px;border:none;background:none;color:#777;cursor:pointer;text-decoration:underline">ver fechamento da loja</button>
    </div>
    ${tabela}
  </div>`;
}

function cxqToggleFech(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
}

// Adota o fechamento da loja: o esperado passa a ser o que a loja apurou, a
// diferença falsa some e o recebimento no Caixa é corrigido junto.
async function cxqUsarLoja(confId) {
  if (!(await garantirSessao())) return;
  const db = obterSupabase();
  const { data: c, error: e0 } = await db.from('caixa_dia_conf').select('*').eq('id', confId).single();
  if (e0 || !c) { mostrarToast('Conferência não encontrada.', 'erro'); return; }
  const dg = cxqDiag(c);
  if (!dg || !dg.troca || !dg.mexeNoDinheiro || dg.dinheiroLoja == null) {
    mostrarToast('Este caixa não fecha só com a troca de formas — confira à mão.', 'erro'); return;
  }
  if (c.dif_lancamento_id) {
    mostrarToast('Este caixa já tem a diferença lançada como despesa. Desfaça antes.', 'erro'); return;
  }
  const despesas = await cxqDespesasDb(db, c);
  const novoBruto = dg.dinheiroLoja + despesas;
  if (!confirm(`Adotar o fechamento da loja no caixa ${c.caixa_ext}?\n\n`
    + `Dinheiro esperado: ${ccBRL(dg.dinheiroNuvem)} (PDV) → ${ccBRL(dg.dinheiroLoja)} (loja)\n`
    + `Faturado em dinheiro: ${ccBRL(Number(c.vendas_dinheiro || 0))} → ${ccBRL(novoBruto)}\n\n`
    + `A diferença deixa de aparecer e o recebimento no Caixa passa a usar o valor da loja.`)) return;

  const { error } = await db.from('caixa_dia_conf').update({ esperado_ajuste: dg.dinheiroLoja }).eq('id', confId);
  if (error) { mostrarToast('Erro ao ajustar: ' + error.message, 'erro'); return; }
  // Se o recebimento já tinha sido lançado, corrige o valor junto.
  if (c.recebimento_lancamento_id && novoBruto > 0) {
    await db.from('lancamentos').update({ valor: novoBruto }).eq('id', c.recebimento_lancamento_id);
  }
  mostrarToast('Fechamento da loja adotado ✔️', 'sucesso');
  renderCaixaEspecie();
}

async function cxqDesfazerLoja(confId) {
  if (!(await garantirSessao())) return;
  const db = obterSupabase();
  const { data: c } = await db.from('caixa_dia_conf').select('*').eq('id', confId).single();
  const { error } = await db.from('caixa_dia_conf').update({ esperado_ajuste: null }).eq('id', confId);
  if (error) { mostrarToast('Erro ao desfazer: ' + error.message, 'erro'); return; }
  if (c && c.recebimento_lancamento_id && Number(c.vendas_dinheiro || 0) > 0) {
    await db.from('lancamentos').update({ valor: Number(c.vendas_dinheiro) }).eq('id', c.recebimento_lancamento_id);
  }
  mostrarToast('Voltou para o valor do PDV', 'sucesso');
  renderCaixaEspecie();
}

async function cxqConfirmar(confId) {
  if (!(await garantirSessao())) return;
  const inp = document.getElementById(`cxq-cont-${confId}`);
  if (!inp) return;
  const contado = parseFloat(inp.value) || 0;
  const db = obterSupabase();
  const { data: c, error: e0 } = await db.from('caixa_dia_conf').select('*').eq('id', confId).single();
  if (e0 || !c) { mostrarToast('Conferência não encontrada.', 'erro'); return; }
  let email = ''; try { const { data: { session } } = await db.auth.getSession(); email = (session && session.user && session.user.email) || ''; } catch (e) {}
  const caixaBanco = cxeCaixaBancoId();
  const bruto = cxqBruto(c, await cxqDespesasDb(db, c));

  // 1) recebimento das vendas em dinheiro (BRUTO) no Caixa — cria ou atualiza
  let recId = c.recebimento_lancamento_id || null;
  if (bruto > 0 && caixaBanco) {
    if (recId) {
      const { error } = await db.from('lancamentos').update({ valor: bruto, unidade_id: c.unidade_id || null }).eq('id', recId);
      if (error) { mostrarToast('Erro ao atualizar recebimento: ' + error.message, 'erro'); return; }
    } else {
      const { data: lanc, error } = await db.from('lancamentos').insert({
        descricao: `Vendas em dinheiro ${ccDT(c.data)} · Caixa ${c.caixa_ext}`,
        valor: bruto, tipo: 'receber', status: 'pago',
        data_pagamento: c.data, vencimento: c.data,
        banco_id: caixaBanco, unidade_id: c.unidade_id || null
      }).select('id').single();
      if (error) { mostrarToast('Erro ao lançar recebimento: ' + error.message, 'erro'); return; }
      recId = lanc.id;
    }
  } else if (bruto > 0 && !caixaBanco) {
    mostrarToast('Confirmado, mas o banco "Caixa/Dinheiro" não foi encontrado — recebimento não lançado.', 'erro');
  }

  // 2) grava a conferência (contado + confirmado + link do recebimento)
  const { error: e2 } = await db.from('caixa_dia_conf').update({
    contado_ajuste: contado, confirmado: true, confirmado_por: email,
    confirmado_em: new Date().toISOString(), recebimento_lancamento_id: recId
  }).eq('id', confId);
  if (e2) { mostrarToast('Erro ao confirmar: ' + e2.message, 'erro'); return; }
  mostrarToast(bruto > 0 && caixaBanco ? `Conferido ✔️ · recebimento ${ccBRL(bruto)} no Caixa` : 'Conferência confirmada ✔️', 'sucesso');
  renderCaixaEspecie();
}

// Pagamento do caixa aguardando o modal de Conta a Pagar ser salvo.
let _cxqPendente = null;

// Abre a tela normal de Conta a Pagar já preenchida com o pagamento do PDV.
// Antes isto criava o lançamento direto, só com o plano de contas — o usuário
// tinha que ir depois ao Contas a Pagar completar fornecedor, NF, centro de
// custo etc. Agora completa tudo de uma vez, sem retrabalho.
async function cxqCategorizar(movId) {
  if (!(await garantirSessao())) return;
  const db = obterSupabase();
  const { data: m, error } = await db.from('caixa_movimentos').select('*').eq('id', movId).single();
  if (error || !m) { mostrarToast('Movimento não encontrado.', 'erro'); return; }
  const caixaBanco = cxeCaixaBancoId();
  if (!caixaBanco) { mostrarToast('Banco Caixa/Dinheiro não encontrado.', 'erro'); return; }

  abrirModal('modal-pagar');            // zera o formulário
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set('pagar-descricao', m.descricao || ('Pagamento em dinheiro ' + ccDT(m.data)));
  setValorMoeda('pagar-valor', Number(m.valor) || 0);
  set('pagar-vencimento', m.data);
  set('pagar-banco', caixaBanco);
  set('pagar-status', 'pago');
  set('pagar-data-pagamento', m.data);
  if (m.unidade_id) set('pagar-unidade', m.unidade_id);
  // Guarda o texto original do PDV: a descrição costuma ser reescrita para algo
  // curto, e sem isto a origem do pagamento se perderia.
  const origem = ['Caixa iComanda', m.usuario, m.hora].filter(Boolean).join(' · ');
  set('pagar-observacoes', origem + (m.descricao ? ' — ' + m.descricao : ''));
  const grupo = document.getElementById('grupo-data-pagamento-pagar');
  if (grupo) grupo.style.display = 'flex';   // status=pago revela a data

  _cxqPendente = { movId };
}

// Chamado pelo salvarLancamento quando o lançamento veio deste fluxo:
// amarra o movimento do caixa ao lançamento recém-criado.
async function cxqVincularSalvo(lancamentoId, planoContaId) {
  const pend = _cxqPendente; _cxqPendente = null;
  if (!pend) return;
  const db = obterSupabase();

  // Fluxo B: diferença de caixa lançada como despesa
  if (pend.difConfId) {
    const { error } = await db.from('caixa_dia_conf')
      .update({ dif_lancamento_id: lancamentoId }).eq('id', pend.difConfId);
    if (error) { mostrarToast('Despesa criada, mas não consegui amarrá-la ao caixa: ' + error.message, 'erro'); return; }
    mostrarToast('Diferença lançada no Contas a Pagar ✔️', 'sucesso');
    if (typeof renderCaixaEspecie === 'function') renderCaixaEspecie();
    return;
  }

  // Fluxo A: pagamento em dinheiro do PDV
  let email = '';
  try { const { data: { session } } = await db.auth.getSession(); email = (session && session.user && session.user.email) || ''; } catch (e) {}
  const { error } = await db.from('caixa_movimentos').update({
    status: 'lancado', lancamento_id: lancamentoId, plano_conta_id: planoContaId || null,
    processado_por: email, processado_em: new Date().toISOString()
  }).eq('id', pend.movId);
  if (error) { mostrarToast('Conta criada, mas não consegui marcar o pagamento no caixa: ' + error.message, 'erro'); return; }
  mostrarToast('Pagamento enviado ao Contas a Pagar ✔️', 'sucesso');
  if (typeof renderCaixaEspecie === 'function') renderCaixaEspecie();
}

// Falta de dinheiro na gaveta que TEM explicação: o valor saiu de verdade, só
// não passou pelo PDV. Abre a mesma tela de Conta a Pagar com o valor da
// diferença; ao salvar, o esperado passa a descontá-la e a diferença zera.
async function cxqLancarDif(confId) {
  if (!(await garantirSessao())) return;
  const db = obterSupabase();
  const { data: c, error } = await db.from('caixa_dia_conf').select('*').eq('id', confId).single();
  if (error || !c) { mostrarToast('Conferência não encontrada.', 'erro'); return; }
  if (c.dif_lancamento_id) { mostrarToast('Esta diferença já foi lançada.', 'erro'); return; }
  if (cxqTrocaExplica(c)) {
    mostrarToast('Esta diferença é troca de forma do PDV, não falta de dinheiro. Use "usar o fechamento da loja".', 'erro'); return;
  }
  const falta = cxqEsperado(c) - cxqContado(c);        // positivo = falta dinheiro
  if (falta <= CXQ_TOL) { mostrarToast('Não há falta de dinheiro neste caixa.', 'erro'); return; }
  const caixaBanco = cxeCaixaBancoId();
  if (!caixaBanco) { mostrarToast('Banco Caixa/Dinheiro não encontrado.', 'erro'); return; }

  abrirModal('modal-pagar');
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set('pagar-descricao', `Diferença de caixa · Caixa ${c.caixa_ext} · ${ccDT(c.data)}`);
  setValorMoeda('pagar-valor', Number(falta.toFixed(2)));
  set('pagar-vencimento', c.data);
  set('pagar-banco', caixaBanco);
  set('pagar-status', 'pago');
  set('pagar-data-pagamento', c.data);
  if (c.unidade_id) set('pagar-unidade', c.unidade_id);
  set('pagar-observacoes', `Falta no caixa ${c.caixa_ext} de ${ccDT(c.data)} — dinheiro que saiu da gaveta sem passar pelo PDV. Esperado ${ccBRL(cxqEsperado(c))}, contado ${ccBRL(cxqContado(c))}.`);
  const grupo = document.getElementById('grupo-data-pagamento-pagar');
  if (grupo) grupo.style.display = 'flex';

  _cxqPendente = { difConfId: confId };
}

async function cxqDesfazerDif(confId) {
  if (!confirm('Desfazer o lançamento desta diferença? A despesa some do Contas a Pagar e a diferença volta a aparecer.')) return;
  if (!(await garantirSessao())) return;
  const db = obterSupabase();
  const { data: c } = await db.from('caixa_dia_conf').select('dif_lancamento_id').eq('id', confId).single();
  if (c && c.dif_lancamento_id) await db.from('lancamentos').delete().eq('id', c.dif_lancamento_id);
  const { error } = await db.from('caixa_dia_conf').update({ dif_lancamento_id: null }).eq('id', confId);
  if (error) { mostrarToast('Erro ao desfazer: ' + error.message, 'erro'); return; }
  mostrarToast('Lançamento da diferença desfeito', 'sucesso');
  renderCaixaEspecie();
}

async function cxqDesfazer(movId) {
  if (!confirm('Desfazer este lançamento? A despesa some do Contas a Pagar.')) return;
  const db = obterSupabase();
  const { data: m } = await db.from('caixa_movimentos').select('lancamento_id').eq('id', movId).single();
  if (m && m.lancamento_id) await db.from('lancamentos').delete().eq('id', m.lancamento_id);
  const { error } = await db.from('caixa_movimentos').update({ status: 'pendente', lancamento_id: null, plano_conta_id: null, processado_por: null, processado_em: null }).eq('id', movId);
  if (error) { mostrarToast('Erro ao desfazer: ' + error.message, 'erro'); return; }
  mostrarToast('Lançamento desfeito', 'sucesso');
  renderCaixaEspecie();
}

async function cxeRenderPainel() {
  const painel = document.getElementById('cxe-painel');
  if (!painel) return;
  const data = cxeDataSel;
  painel.innerHTML = `<div style="background:#fff;border:1px solid #eee;border-radius:10px;padding:16px 18px">Carregando ${ccDT(data)}…</div>`;
  const db = obterSupabase();

  let vendas = 0;
  try {
    const vs = await ccFetchPaginado(() => db.from('pdv_vendas').select('valor_bruto').eq('forma_pagamento', 'dinheiro')
      .gte('data_hora_utc', data + 'T00:00:00-04:00').lte('data_hora_utc', data + 'T23:59:59-04:00'));
    vendas = vs.reduce((s, v) => s + (v.valor_bruto || 0), 0);
  } catch (e) {}

  let ex = null;
  try { const { data: a } = await db.from('caixa_fechamentos').select('*').eq('data', data).limit(1); ex = a && a[0]; } catch (e) {}
  cxeCtx = { data, vendas, fechamento: ex };
  const contadoDefault = ex ? (Number(ex.contagem_fisica) || 0) : (vendas ? vendas.toFixed(2) : '');
  const obsDefault = ex ? (ex.observacao || '') : '';
  const semCaixa = !cxeCaixaBancoId();

  painel.innerHTML = `
    <div style="background:#fff;border:1px solid #eee;border-radius:10px;padding:16px 18px;max-width:520px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-weight:700;color:#2c3e50">Conferir o dinheiro do dia</span>
          <input type="date" id="cxe-data" value="${data}" onchange="cxeTrocarData(this.value)" style="padding:5px 8px;border:1px solid #ddd;border-radius:6px;font-size:13px">
        </div>
        ${ex ? `<span style="font-size:12px;background:#e8f5e9;color:#2e7d32;border-radius:12px;padding:3px 10px;font-weight:600">✔️ confirmado</span>` : ''}
      </div>
      ${semCaixa ? `<div style="background:#fff3cd;color:#856404;font-size:12px;border-radius:6px;padding:7px 10px;margin-bottom:10px">⚠️ Banco "Caixa/Dinheiro" não encontrado — o recebimento não poderá ser lançado.</div>` : ''}
      <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid #f2f2f2"><span style="color:#555">Vendas em dinheiro (PDV)</span><span style="font-weight:600;color:#2e7d32;font-variant-numeric:tabular-nums">${ccBRL(vendas)}</span></div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0"><span style="color:#555">Valor conferido na gaveta</span><input type="number" step="0.01" min="0" id="cxe-contado" value="${contadoDefault}" placeholder="0,00" oninput="cxeRecalc()" style="width:150px;text-align:right;padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:14px;font-variant-numeric:tabular-nums"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-top:2px solid #eee"><span style="font-weight:700;color:#2c3e50">Diferença</span><span id="cxe-dif" style="font-weight:800;font-size:16px;font-variant-numeric:tabular-nums">—</span></div>
      <textarea id="cxe-obs" placeholder="Observação (opcional)" style="width:100%;margin-top:8px;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:13px;font-family:inherit;resize:vertical;min-height:44px">${obsDefault}</textarea>
      <button onclick="confirmarCaixaEspecie()" ${semCaixa ? 'disabled' : ''} style="margin-top:10px;width:100%;background:${semCaixa ? '#bbb' : '#2c3e50'};color:#fff;border:0;border-radius:8px;padding:10px;font-size:14px;font-weight:600;cursor:${semCaixa ? 'not-allowed' : 'pointer'}">${ex ? 'Atualizar recebimento' : 'Confirmar → gerar recebimento'}</button>
      <div style="font-size:11px;color:#999;margin-top:6px;text-align:center">Cria um recebimento no Caixa com o <strong>valor conferido</strong>. Os pagamentos em dinheiro continuam no Contas a Pagar.</div>
    </div>`;
  cxeRecalc();
}

function cxeRecalc() {
  const dif = document.getElementById('cxe-dif'); if (!dif) return;
  const el = document.getElementById('cxe-contado');
  if (!el || el.value === '') { dif.textContent = '—'; dif.style.color = '#999'; return; }
  const d = cxeNum('cxe-contado') - cxeCtx.vendas;
  dif.textContent = (d > 0 ? '+' : '') + ccBRL(d) + (Math.abs(d) < 0.005 ? ' ✔️ bate' : (d < 0 ? ' (falta)' : ' (sobra)'));
  dif.style.color = Math.abs(d) < 0.005 ? '#2e7d32' : (d < 0 ? '#c0392b' : '#e67e22');
}

async function confirmarCaixaEspecie() {
  if (!(await garantirSessao())) return;
  const el = document.getElementById('cxe-contado');
  if (!el || el.value === '') { mostrarToast('Informe o valor conferido.', 'erro'); return; }
  const db = obterSupabase();
  const caixaId = cxeCaixaBancoId();
  if (!caixaId) { mostrarToast('Banco Caixa/Dinheiro não encontrado.', 'erro'); return; }
  const contado = cxeNum('cxe-contado');
  const dif = contado - cxeCtx.vendas;
  const obs = (document.getElementById('cxe-obs')?.value || '').trim();
  let email = '';
  try { const { data: { session } } = await db.auth.getSession(); email = (session && session.user && session.user.email) || ''; } catch (e) {}

  // 1) Cria/atualiza o recebimento no Caixa (valor = conferido)
  let lancId = cxeCtx.fechamento && cxeCtx.fechamento.lancamento_id;
  if (lancId) {
    const { error } = await db.from('lancamentos').update({ valor: contado, observacoes: obs || null }).eq('id', lancId);
    if (error) { mostrarToast('Erro ao atualizar recebimento: ' + error.message, 'erro'); return; }
  } else {
    const { data: lanc, error } = await db.from('lancamentos').insert({
      descricao: 'Vendas em dinheiro ' + ccDT(cxeCtx.data), valor: contado, tipo: 'receber', status: 'pago',
      data_pagamento: cxeCtx.data, vencimento: cxeCtx.data, banco_id: caixaId, observacoes: obs || null
    }).select('id').single();
    if (error) { mostrarToast('Erro ao lançar recebimento: ' + error.message, 'erro'); return; }
    lancId = lanc.id;
  }

  // 2) Registra a conferência (auditoria)
  const { error: e2 } = await db.from('caixa_fechamentos').upsert({
    data: cxeCtx.data, entradas_dinheiro: cxeCtx.vendas, saldo_esperado: cxeCtx.vendas,
    contagem_fisica: contado, diferenca: dif, observacao: obs, lancamento_id: lancId,
    fechado_por: email, fechado_em: new Date().toISOString()
  }, { onConflict: 'data' });
  if (e2) mostrarToast('Recebimento lançado, mas erro ao registrar conferência: ' + e2.message, 'erro');
  else mostrarToast('Dinheiro conferido e recebimento lançado ✔️', 'sucesso');
  cxeRenderPainel(); cxeRenderHistorico();
}

async function excluirCaixaEspecie(data) {
  if (!confirm('Reabrir a conferência de ' + ccDT(data) + '? O recebimento no Caixa desse dia será removido.')) return;
  const db = obterSupabase();
  let ex = null;
  try { const { data: a } = await db.from('caixa_fechamentos').select('*').eq('data', data).limit(1); ex = a && a[0]; } catch (e) {}
  if (ex && ex.lancamento_id) { await db.from('lancamentos').delete().eq('id', ex.lancamento_id); }
  const { error } = await db.from('caixa_fechamentos').delete().eq('data', data);
  if (error) { mostrarToast('Erro ao reabrir: ' + error.message, 'erro'); return; }
  mostrarToast('Conferência reaberta', 'sucesso');
  cxeRenderPainel(); cxeRenderHistorico();
}

async function cxeRenderHistorico() {
  const corpo = document.getElementById('cxe-corpo');
  if (!corpo) return;
  const db = obterSupabase();
  const de = document.getElementById('cc-de')?.value, ate = document.getElementById('cc-ate')?.value;
  if (!de || !ate) return;
  corpo.innerHTML = `<tr><td colspan="7" class="sem-dados">Carregando…</td></tr>`;
  let rows = [];
  try { const { data } = await db.from('caixa_fechamentos').select('*').gte('data', de).lte('data', ate).order('data', { ascending: false }); rows = data || []; } catch (e) {}
  if (!rows.length) { corpo.innerHTML = `<tr><td colspan="7" class="sem-dados">Nenhuma conferência no período.</td></tr>`; return; }
  const cor = d => Math.abs(d) < 0.005 ? '#2e7d32' : (d < 0 ? '#c0392b' : '#e67e22');
  corpo.innerHTML = rows.map(r => {
    const d = Number(r.diferenca) || 0;
    const dtxt = (d > 0 ? '+' : '') + ccBRL(d) + (Math.abs(d) < 0.005 ? ' ✔️' : ' ⚠️');
    const td = v => `<td style="text-align:right;font-variant-numeric:tabular-nums">${ccBRL(v)}</td>`;
    return `<tr>
      <td><strong>${ccDT(r.data)}</strong></td>
      ${td(r.entradas_dinheiro)}${td(r.contagem_fisica)}
      <td style="text-align:right;font-weight:700;font-variant-numeric:tabular-nums;color:${cor(d)}">${dtxt}</td>
      <td style="font-size:12px;color:${r.lancamento_id ? '#2e7d32' : '#999'}">${r.lancamento_id ? '✔️ lançado' : '—'}</td>
      <td style="font-size:12px;color:#888">${r.fechado_por || '—'}</td>
      <td style="text-align:right;white-space:nowrap">
        <button title="Abrir" onclick="cxeTrocarData('${r.data}');window.scrollTo({top:0,behavior:'smooth'})" style="border:1px solid #ddd;background:#fff;border-radius:5px;padding:2px 8px;cursor:pointer;font-size:12px">abrir</button>
        <button title="Reabrir/excluir" onclick="excluirCaixaEspecie('${r.data}')" style="border:1px solid #f0d0d0;background:#fff;color:#c0392b;border-radius:5px;padding:2px 8px;cursor:pointer;font-size:12px">reabrir</button>
      </td>
    </tr>`;
  }).join('');
}

// Marca um caso da Etapa A como resolvido (o caixa conferiu/corrigiu) → sai das pendências.
async function ccResolver(kind, id, tipo, valor) {
  if (!id) return;
  const db = obterSupabase();
  let email = '';
  try { const { data: { session } } = await db.auth.getSession(); email = (session && session.user && session.user.email) || ''; } catch (e) {}
  const etapa = kind === 'pix' ? 'pdv_banco' : 'pdv_operadora';
  const row = { etapa, status: 'resolvido_manual', tipo_divergencia: tipo,
    resolvido_por: email, resolvido_em: new Date().toISOString() };
  if (kind === 'gnet') { row.transacao_id = id; row.valor_real = valor; if (tipo === 'conferido') row.tipo_divergencia = 'recebimento_sem_venda'; }
  else { row.venda_pdv_id = id; row.valor_esperado = valor; }  // pdv e pix
  const { error } = await db.from('conc_conciliacoes').insert(row);
  if (error) { mostrarToast('Erro ao resolver: ' + error.message, 'erro'); return; }
  mostrarToast('Caso resolvido ✔️', 'sucesso');
  renderCartao();
}

const CC_FORMA_LBL = { cartao: 'Cartão', pix: 'Pix', dinheiro: 'Dinheiro',
  voucher: 'Voucher/Refeição', ifood: 'iFood', cortesia: 'Cortesia',
  conta_assinada: 'Conta assinada', outro: 'Outro' };
const ccFormaLbl = f => CC_FORMA_LBL[f] || f || '—';

// Corrige a forma de pagamento de UMA venda do PDV. O robô do PDV nunca
// sobrescreve linha já existente (insert com ignore-duplicates), então a
// correção fica de pé mesmo se ele reprocessar o dia.
async function ccTrocarForma(id, nova, el) {
  if (!nova) return;
  const voltar = () => { if (el) { el.disabled = false; el.value = ''; } };
  if (el) el.disabled = true;
  if (!(await garantirSessao())) { voltar(); return; }
  const db = obterSupabase();
  const { data: v, error: e0 } = await db.from('pdv_vendas')
    .select('id,forma_pagamento,valor_bruto').eq('id', id).single();
  if (e0 || !v) { mostrarToast('Venda não encontrada.', 'erro'); voltar(); return; }
  if (!confirm(`Corrigir a forma desta venda de ${ccBRL(Number(v.valor_bruto) || 0)}?\n\n`
    + `${ccFormaLbl(v.forma_pagamento)} → ${ccFormaLbl(nova)}\n\n`
    + `Ela sai desta conferência e passa a ser cobrada na conferência de ${ccFormaLbl(nova)}.`)) { voltar(); return; }

  let email = '';
  try { const { data: { session } } = await db.auth.getSession(); email = (session && session.user && session.user.email) || ''; } catch (e) {}
  const completo = { forma_pagamento: nova, forma_original: v.forma_pagamento,
    forma_corrigida_por: email, forma_corrigida_em: new Date().toISOString() };
  let { error } = await db.from('pdv_vendas').update(completo).eq('id', id);
  if (error) {
    // As colunas de auditoria podem não existir ainda; o essencial é a forma.
    const r2 = await db.from('pdv_vendas').update({ forma_pagamento: nova }).eq('id', id);
    error = r2.error;
  }
  if (error) { mostrarToast('Erro ao corrigir: ' + error.message, 'erro'); voltar(); return; }
  mostrarToast(`Venda corrigida para ${ccFormaLbl(nova)} ✔️`, 'sucesso');
  renderCartao();
}

// Desfaz a resolução (remove a marca) → o caso volta a aparecer como pendência.
async function ccDesfazer(kind, id) {
  if (!id) return;
  const db = obterSupabase();
  const etapa = kind === 'pix' ? 'pdv_banco' : 'pdv_operadora';
  const col = kind === 'gnet' ? 'transacao_id' : 'venda_pdv_id';
  const { error } = await db.from('conc_conciliacoes').delete()
    .eq('etapa', etapa).eq('status', 'resolvido_manual').eq(col, id);
  if (error) { mostrarToast('Erro ao desfazer: ' + error.message, 'erro'); return; }
  mostrarToast('Resolução desfeita', 'sucesso');
  renderCartao();
}

// =========================================================
// TRANSFERÊNCIAS
// =========================================================
async function carregarTransferencias() {
  if (!(await garantirSessao())) return;
  const db = obterSupabase();
  const dataFiltroDE    = document.getElementById('filtro-de-transferencias')?.value;
  const dataFiltroATE   = document.getElementById('filtro-ate-transferencias')?.value;
  const bancoOrigemId   = document.getElementById('filtro-banco-origem-transf')?.value;
  const bancoDestinoId  = document.getElementById('filtro-banco-destino-transf')?.value;

  let query = db.from('transferencias')
    .select('*, banco_origem:banco_origem_id(nome), banco_destino:banco_destino_id(nome)')
    .order('data', { ascending: false });

  if (dataFiltroDE)   query = query.gte('data', dataFiltroDE);
  if (dataFiltroATE)  query = query.lte('data', dataFiltroATE);
  if (bancoOrigemId)  query = query.eq('banco_origem_id', bancoOrigemId);
  if (bancoDestinoId) query = query.eq('banco_destino_id', bancoDestinoId);

  const { data, error } = await q(query);
  if (error) { mostrarToast('Erro ao carregar transferências.', 'erro'); return; }

  const tbody = document.getElementById('tbody-transferencias');
  const lista = data || [];

  if (lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="sem-dados">Nenhuma transferência encontrada.</td></tr>';
    return;
  }

  tbody.innerHTML = lista.map(t => `
    <tr>
      <td>${formatarData(t.data)}</td>
      <td>${t.banco_origem?.nome || '-'}</td>
      <td>${t.banco_destino?.nome || '-'}</td>
      <td><strong>${formatarMoeda(t.valor)}</strong></td>
      <td>${t.descricao || '-'}</td>
      <td>
        <button class="btn-icone editar" title="Editar" onclick="editarTransferencia('${t.id}')">
          <i class="fas fa-edit"></i>
        </button>
        <button class="btn-icone excluir" title="Excluir" onclick="excluirTransferencia('${t.id}')">
          <i class="fas fa-trash"></i>
        </button>
      </td>
    </tr>`).join('');
}

function abrirModalTransferencia(id) {
  document.getElementById('modal-transf-id').value        = id || '';
  document.getElementById('modal-transf-origem').value    = '';
  document.getElementById('modal-transf-destino').value   = '';
  document.getElementById('modal-transf-valor').value     = '';
  document.getElementById('modal-transf-data').value      = new Date().toISOString().split('T')[0];
  document.getElementById('modal-transf-descricao').value = '';
  preencherSelectBancosTransferencia();
  document.getElementById('modal-transferencia').classList.remove('hidden');
}

async function editarTransferencia(id) {
  const db = obterSupabase();
  const { data, error } = await db.from('transferencias').select('*').eq('id', id).single();
  if (error || !data) { mostrarToast('Erro ao carregar.', 'erro'); return; }

  abrirModalTransferencia(id);
  document.getElementById('modal-transf-origem').value    = data.banco_origem_id || '';
  document.getElementById('modal-transf-destino').value   = data.banco_destino_id || '';
  setValorMoeda('modal-transf-valor', data.valor);
  document.getElementById('modal-transf-data').value      = data.data;
  document.getElementById('modal-transf-descricao').value = data.descricao || '';
}

async function salvarTransferencia() {
  if (!await garantirSessao()) return;
  const id             = document.getElementById('modal-transf-id').value;
  const banco_origem_id  = document.getElementById('modal-transf-origem').value;
  const banco_destino_id = document.getElementById('modal-transf-destino').value;
  const valor          = parseMoeda(document.getElementById('modal-transf-valor').value);
  const data           = document.getElementById('modal-transf-data').value;
  const descricao      = document.getElementById('modal-transf-descricao').value.trim();

  if (!banco_origem_id)  { mostrarToast('Selecione a conta de origem!', 'erro'); return; }
  if (!banco_destino_id) { mostrarToast('Selecione a conta de destino!', 'erro'); return; }
  if (banco_origem_id === banco_destino_id) { mostrarToast('Origem e destino devem ser diferentes!', 'erro'); return; }
  if (!valor || valor <= 0) { mostrarToast('Informe um valor válido!', 'erro'); return; }
  if (!data) { mostrarToast('Informe a data!', 'erro'); return; }

  const db = obterSupabase();
  const dados = { banco_origem_id, banco_destino_id, valor, data, descricao: descricao || null };
  let error;
  if (id) {
    ({ error } = await q(db.from('transferencias').update(dados).eq('id', id)))
  } else {
    ({ error } = await q(db.from('transferencias').insert([dados])))
  }

  if (tratarErro(error, 'Erro ao salvar')) return;
  mostrarToast(id ? 'Transferência atualizada!' : 'Transferência salva!', 'sucesso');
  fecharModal('modal-transferencia');
  carregarTransferencias();
  carregarDashboard();
}

async function excluirTransferencia(id) {
  idParaExcluir = id;
  fnExcluirAtual = async () => {
    const db = obterSupabase();
    const { error } = await q(db.from('transferencias').delete().eq('id', idParaExcluir))
    fecharModal('modal-excluir');
    if (error) { mostrarToast('Erro ao excluir.', 'erro'); return; }
    mostrarToast('Transferência excluída!', 'sucesso');
    carregarTransferencias();
    carregarDashboard();
  };
  document.getElementById('modal-excluir').classList.remove('hidden');
}

// =========================================================
// ORÇAMENTO
// =========================================================
let modoOrcamento = 'mensal';

function carregarOrcamentoModo() {
  if (modoOrcamento === 'planilha') {
    carregarOrcamentoPlanilha();
  } else {
    carregarOrcamento();
  }
}

function alternarModoOrcamento(modo, el) {
  modoOrcamento = modo;
  document.querySelectorAll('#pagina-orcamento .plano-tabs .tab-btn').forEach(b => b.classList.remove('ativo'));
  el.classList.add('ativo');
  const filtroMes  = document.getElementById('filtro-mes-orcamento');
  const filtroTipo = document.getElementById('filtro-tipo-orcamento');
  if (filtroMes)  filtroMes.style.display  = modo === 'planilha' ? 'none' : '';
  if (filtroTipo) filtroTipo.style.display = modo === 'planilha' ? 'none' : '';
  carregarOrcamentoModo();
}

async function carregarOrcamentoPlanilha() {
  const container = document.getElementById('tabela-orcamento');
  if (!container) return;
  if (!(await garantirSessao())) return;
  try {
  const ano = parseInt(document.getElementById('filtro-ano-orcamento')?.value) || new Date().getFullYear();
  const db  = obterSupabase();

  const gruposRec  = planoContas.filter(p => p.tipo === 'receber' && !p.grupo_id);
  const subcatsRec = planoContas.filter(p => p.tipo === 'receber' &&  p.grupo_id);
  const gruposPag  = planoContas.filter(p => p.tipo === 'pagar'   && !p.grupo_id);
  const subcatsPag = planoContas.filter(p => p.tipo === 'pagar'   &&  p.grupo_id);

  if (!gruposRec.length && !gruposPag.length) {
    container.innerHTML = '<p class="sem-dados">Cadastre categorias no Plano de Contas primeiro.</p>';
    return;
  }

  const unidadeId = document.getElementById('filtro-unidade-orcamento')?.value || '';
  const soLeitura = !unidadeId;

  let orcQuery = db.from('orcamentos').select('*').eq('ano', ano).in('mes', [1,2,3,4,5,6,7,8,9,10,11,12]);
  if (unidadeId) orcQuery = orcQuery.eq('unidade_id', unidadeId);
  const { data: orcDados } = await q(orcQuery);
  const orcMap = {};
  (orcDados || []).forEach(o => {
    const key = `${o.plano_conta_id}_${o.mes}`;
    orcMap[key] = (orcMap[key] || 0) + Number(o.valor);
  });

  const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

  const cabecalho = meses.map(m => `<th style="min-width:130px;">${m}</th>`).join('');
  let html = `<div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
    <button id="btn-toggle-todos-orc" class="btn btn-outline btn-sm" data-estado="expandido" onclick="toggleTodosGruposOrcamento()">
      <i class="fas fa-compress-alt"></i> Recolher tudo
    </button></div>`
    + '<div style="overflow-x:auto;">'
    + `<table class="tabela tabela-planilha"><thead><tr>`
    + `<th style="min-width:180px;text-align:left;">Categoria</th>`
    + cabecalho
    + `<th style="min-width:100px;">Total</th></tr></thead><tbody>`;

  // helper: linha de input por categoria/grupo
  function linhaInput(id, nome, recuo, vals, ano) {
    const total = vals.reduce((a,v) => a+v, 0);
    return `<tr><td style="padding-left:${recuo}px;text-align:left;">${nome}</td>`
      + vals.map((v,i) => `<td><input type="text" inputmode="decimal" class="input-orcamento input-orcamento-mes${soLeitura ? '' : ' input-moeda'}"
          value="${v > 0 ? v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}) : ''}" placeholder="0,00"
          ${soLeitura ? 'readonly style="background:#f5f5f5;color:#999;cursor:default;"' : `onblur="salvarOrcamentoPlanilha('${id}',${ano},${i+1},this.value,'${unidadeId}')"`}></td>`).join('')
      + `<td id="total-plan-${id}" style="font-weight:600;">${formatarMoeda(total)}</td></tr>`;
  }

  // ── RECEITAS (uma linha por grupo, sem abrir subcategorias; exclui "Outras Receitas") ────
  html += `<tr style="background:#1a7a3c;color:#fff;">
    <td colspan="14" style="font-weight:700;padding:8px 12px;text-align:left;">
      <i class="fas fa-arrow-down" style="margin-right:6px;"></i>RECEITAS
    </td></tr>`;

  const totalRecMes = Array(12).fill(0);
  gruposRec
    .filter(g => normalizarTexto(g.nome) !== 'outras receitas')
    .forEach(g => {
      const subs = subcatsRec.filter(s => s.grupo_id === g.id);
      if (!subs.length) return;
      const vals  = Array.from({length:12}, (_, i) => orcMap[`${g.id}_${i+1}`] || 0);
      const total = vals.reduce((a,v) => a+v, 0);
      vals.forEach((v, i) => totalRecMes[i] += v);
      html += `<tr class="orcamento-grupo-row" onclick="toggleGrupoOrcamento('${g.id}')" style="cursor:pointer;">
        <td style="text-align:left;">
          <i class="fas fa-chevron-down" data-toggle-grupo="${g.id}" style="font-size:11px;margin-right:6px;color:#888;transition:transform 0.2s;"></i>
          <i class="fas fa-folder" style="color:#f39c12;margin-right:4px;"></i>
          <strong>${g.nome}</strong>
        </td>`
        + vals.map(v => `<td style="font-weight:600;color:#555;">${v > 0 ? formatarMoeda(v) : ''}</td>`).join('')
        + `<td style="font-weight:600;">${formatarMoeda(total)}</td></tr>`;
      html += `<tr data-filho-grupo="${g.id}"><td style="padding-left:20px;text-align:left;font-size:13px;color:#555;">Orçamento mensal</td>`
        + vals.map((v,i) => `<td><input type="text" inputmode="decimal" class="input-orcamento input-orcamento-mes${soLeitura ? '' : ' input-moeda'}"
            value="${v > 0 ? v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}) : ''}" placeholder="0,00"
            ${soLeitura ? 'readonly style="background:#f5f5f5;color:#999;cursor:default;"' : `onblur="salvarOrcamentoPlanilha('${g.id}',${ano},${i+1},this.value,'${unidadeId}')" onfocus="this.select()"`}></td>`).join('')
        + `<td id="total-plan-${g.id}" style="font-weight:600;">${formatarMoeda(total)}</td></tr>`;
    });

  // Linha TOTAL RECEITAS
  {
    const totalRec = totalRecMes.reduce((a,v) => a+v, 0);
    html += `<tr style="background:#d5f5e3;font-weight:700;border-top:2px solid #1a7a3c;">
      <td style="color:#1a7a3c;text-align:left;padding-left:12px;">TOTAL RECEITAS</td>`
      + totalRecMes.map(v => `<td style="color:#1a7a3c;">${formatarMoeda(v)}</td>`).join('')
      + `<td style="color:#1a7a3c;">${formatarMoeda(totalRec)}</td></tr>`;
  }

  // ── DESPESAS ──────────────────────────────────────────────
  html += `<tr style="background:#c0392b;color:#fff;">
    <td colspan="14" style="font-weight:700;padding:8px 12px;text-align:left;">
      <i class="fas fa-arrow-up" style="margin-right:6px;"></i>DESPESAS
    </td></tr>`;

  const totalPagMes = Array(12).fill(0);
  gruposPag.forEach(g => {
    const subs = subcatsPag.filter(s => s.grupo_id === g.id);
    if (!subs.length) return;

    if (g.is_cmv) {
      const vals  = Array.from({length:12}, (_, i) => orcMap[`${g.id}_${i+1}`] || 0);
      const total = vals.reduce((a,v) => a+v, 0);
      vals.forEach((v, i) => totalPagMes[i] += v);
      html += `<tr class="orcamento-grupo-row" onclick="toggleGrupoOrcamento('${g.id}')" style="cursor:pointer;">
        <td style="text-align:left;">
          <i class="fas fa-chevron-down" data-toggle-grupo="${g.id}" style="font-size:11px;margin-right:6px;color:#888;transition:transform 0.2s;"></i>
          <i class="fas fa-folder" style="color:#f39c12;margin-right:4px;"></i>
          <strong>${g.nome}</strong>
        </td>`
        + vals.map(v => `<td style="font-weight:600;color:#555;">${v > 0 ? formatarMoeda(v) : ''}</td>`).join('')
        + `<td style="font-weight:600;">${formatarMoeda(total)}</td></tr>`;
      html += `<tr data-filho-grupo="${g.id}"><td style="padding-left:20px;text-align:left;font-size:13px;color:#555;">Orçamento mensal</td>`
        + vals.map((v,i) => `<td><input type="text" inputmode="decimal" class="input-orcamento input-orcamento-mes${soLeitura ? '' : ' input-moeda'}"
            value="${v > 0 ? v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}) : ''}" placeholder="0,00"
            ${soLeitura ? 'readonly style="background:#f5f5f5;color:#999;cursor:default;"' : `onblur="salvarOrcamentoPlanilha('${g.id}',${ano},${i+1},this.value,'${unidadeId}')" onfocus="this.select()"`}></td>`).join('')
        + `<td id="total-plan-${g.id}" style="font-weight:600;">${formatarMoeda(total)}</td></tr>`;
    } else {
      const grupoMes = Array.from({length:12}, (_, i) =>
        subs.reduce((sum, s) => sum + (orcMap[`${s.id}_${i+1}`] || 0), 0));
      const grupoTotal = grupoMes.reduce((a,v) => a+v, 0);
      grupoMes.forEach((v, i) => totalPagMes[i] += v);

      html += `<tr class="orcamento-grupo-row" onclick="toggleGrupoOrcamento('${g.id}')" style="cursor:pointer;">
        <td style="text-align:left;">
          <i class="fas fa-chevron-down" data-toggle-grupo="${g.id}" style="font-size:11px;margin-right:6px;color:#888;transition:transform 0.2s;"></i>
          <i class="fas fa-folder" style="color:#f39c12;margin-right:4px;"></i>
          <strong>${g.nome}</strong>
        </td>`
        + grupoMes.map(v => `<td style="font-weight:600;color:#555;">${v > 0 ? formatarMoeda(v) : ''}</td>`).join('')
        + `<td style="font-weight:600;">${formatarMoeda(grupoTotal)}</td></tr>`;

      subs.forEach(s => {
        const vals = Array.from({length:12}, (_, i) => orcMap[`${s.id}_${i+1}`] || 0);
        const total = vals.reduce((a,v) => a+v, 0);
        html += `<tr data-filho-grupo="${g.id}"><td style="padding-left:20px;text-align:left;">${s.nome}</td>`
          + vals.map((v,i) => `<td><input type="text" inputmode="decimal" class="input-orcamento input-orcamento-mes${soLeitura ? '' : ' input-moeda'}"
              value="${v > 0 ? v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}) : ''}" placeholder="0,00"
              ${soLeitura ? 'readonly style="background:#f5f5f5;color:#999;cursor:default;"' : `onblur="salvarOrcamentoPlanilha('${s.id}',${ano},${i+1},this.value,'${unidadeId}')"`}></td>`).join('')
          + `<td id="total-plan-${s.id}" style="font-weight:600;">${formatarMoeda(total)}</td></tr>`;
      });
    }
  });

  // Linha TOTAL DESPESAS
  {
    const totalPag = totalPagMes.reduce((a,v) => a+v, 0);
    html += `<tr style="background:#fadbd8;font-weight:700;border-top:2px solid #c0392b;">
      <td style="color:#c0392b;text-align:left;padding-left:12px;">TOTAL DESPESAS</td>`
      + totalPagMes.map(v => `<td style="color:#c0392b;">${formatarMoeda(v)}</td>`).join('')
      + `<td style="color:#c0392b;">${formatarMoeda(totalPag)}</td></tr>`;

    // Linha RESULTADO (Receita − Despesa)
    const resultMes = totalRecMes.map((v, i) => v - totalPagMes[i]);
    const resultTotal = resultMes.reduce((a,v) => a+v, 0);
    html += `<tr style="background:#1a1a2e;color:#fff;font-weight:700;border-top:2px solid #aaa;">
      <td style="text-align:left;padding-left:12px;">RESULTADO</td>`
      + resultMes.map(v => `<td style="color:${v >= 0 ? '#7dff8a':'#ff7d7d'};">${formatarMoeda(v)}</td>`).join('')
      + `<td style="color:${resultTotal >= 0 ? '#7dff8a':'#ff7d7d'};">${formatarMoeda(resultTotal)}</td></tr>`;
  }

  html += '</tbody></table></div>';
  container.innerHTML = html;
  } catch(err) {
    container.innerHTML = '<p class="sem-dados" style="color:#e74c3c;">Erro ao carregar orçamento. Recarregue a página.</p>';
  }
}

async function salvarOrcamentoPlanilha(planoConta_id, ano, mes, valorStr, unidade_id) {
  if (!unidade_id) return;
  const valor = parseMoeda(valorStr);
  const db = obterSupabase();
  let delQ = db.from('orcamentos').delete()
    .eq('plano_conta_id', planoConta_id).eq('ano', ano).eq('mes', mes).eq('unidade_id', unidade_id);
  await delQ;
  if (valor > 0) {
    const { error } = await q(db.from('orcamentos').insert({ plano_conta_id: planoConta_id, ano, mes, valor, unidade_id }))
    if (error) { mostrarToast('Erro ao salvar.', 'erro'); return; }
  }
  const totalEl = document.getElementById(`total-plan-${planoConta_id}`);
  if (totalEl) {
    const inputs = totalEl.closest('tr').querySelectorAll('input');
    const soma = Array.from(inputs).reduce((s, inp) => s + parseMoeda(inp.value), 0);
    totalEl.textContent = formatarMoeda(soma);
  }
}

function toggleGrupoOrcamento(id) {
  const rows = document.querySelectorAll(`[data-filho-grupo="${id}"]`);
  const icon = document.querySelector(`[data-toggle-grupo="${id}"]`);
  const aberto = rows[0]?.style.display !== 'none';
  rows.forEach(r => { r.style.display = aberto ? 'none' : ''; });
  if (icon) icon.style.transform = aberto ? 'rotate(-90deg)' : '';
}

function toggleTodosGruposOrcamento() {
  const btn = document.getElementById('btn-toggle-todos-orc');
  const expandir = btn?.dataset.estado === 'recolhido';
  document.querySelectorAll('[data-filho-grupo]').forEach(r => { r.style.display = expandir ? '' : 'none'; });
  document.querySelectorAll('[data-toggle-grupo]').forEach(ic => { ic.style.transform = expandir ? '' : 'rotate(-90deg)'; });
  if (btn) { btn.dataset.estado = expandir ? 'expandido' : 'recolhido'; btn.innerHTML = expandir ? '<i class="fas fa-compress-alt"></i> Recolher tudo' : '<i class="fas fa-expand-alt"></i> Expandir tudo'; }
}

async function carregarOrcamento() {
  if (!(await garantirSessao())) return;
  const ano = parseInt(document.getElementById('filtro-ano-orcamento')?.value) || new Date().getFullYear();
  const mes = parseInt(document.getElementById('filtro-mes-orcamento')?.value) || 0;
  const db  = obterSupabase();

  const gruposRec  = planoContas.filter(p => p.tipo === 'receber' && !p.grupo_id);
  const subcatsRec = planoContas.filter(p => p.tipo === 'receber' &&  p.grupo_id);
  const gruposPag  = planoContas.filter(p => p.tipo === 'pagar'   && !p.grupo_id);
  const subcatsPag = planoContas.filter(p => p.tipo === 'pagar'   &&  p.grupo_id);

  const container = document.getElementById('tabela-orcamento');
  if (!container) return;

  if (!gruposRec.length && !gruposPag.length) {
    container.innerHTML = '<p class="sem-dados">Cadastre categorias no Plano de Contas primeiro.</p>';
    return;
  }

  const unidadeId = document.getElementById('filtro-unidade-orcamento')?.value || '';
  const soLeitura = !unidadeId;
  let orcQ = db.from('orcamentos').select('*').eq('ano', ano).eq('mes', mes);
  if (unidadeId) orcQ = orcQ.eq('unidade_id', unidadeId);
  const { data: orcDados } = await q(orcQ);
  const orcMap = {};
  (orcDados || []).forEach(o => {
    orcMap[o.plano_conta_id] = (orcMap[o.plano_conta_id] || 0) + Number(o.valor);
  });

  const primeiroDia = mes > 0 ? `${ano}-${String(mes).padStart(2,'0')}-01` : `${ano}-01-01`;
  const ultimoDia   = mes > 0 ? new Date(ano, mes, 0).toISOString().split('T')[0] : `${ano}-12-31`;

  const { data: lancDados } = await q(db.from('lancamentos')
    .select('plano_conta_id, valor, tipo')
    .gte('vencimento', primeiroDia).lte('vencimento', ultimoDia));
  const realMap = {};
  (lancDados || []).forEach(l => {
    realMap[l.plano_conta_id] = (realMap[l.plano_conta_id] || 0) + Number(l.valor);
  });

  const periodo = mes > 0
    ? ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'][mes-1]
    : `Anual ${ano}`;

  // helper: linha de subcategoria (com classe de filho para colapso)
  function linhaItemMes(id, nome, recuo, orc, real, inverte, grupoId) {
    const diff = inverte ? real - orc : orc - real;
    const pct  = orc > 0 ? Math.min(100, (real/orc)*100) : (real > 0 ? 100 : 0);
    const cor  = inverte
      ? (pct >= 100 ? '#27ae60' : pct >= 80 ? '#f39c12' : '#e74c3c')
      : (pct >= 100 ? '#e74c3c' : pct >= 80 ? '#f39c12' : '#27ae60');
    const attr = grupoId ? ` data-filho-grupo="${grupoId}"` : '';
    return `<tr${attr}>
      <td style="padding-left:${recuo}px;">${nome}</td>
      <td><input type="text" inputmode="decimal" class="input-orcamento${soLeitura ? '' : ' input-moeda'}" value="${orc > 0 ? orc.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}) : ''}"
        ${soLeitura ? 'readonly style="background:#f5f5f5;color:#999;cursor:default;"' : `onblur="salvarOrcamento('${id}',${ano},${mes},this.value,'${unidadeId}')"`} placeholder="0,00"></td>
      <td>${formatarMoeda(real)}</td>
      <td style="color:${diff >= 0 ? '#27ae60':'#e74c3c'};font-weight:600;">
        ${diff >= 0 ? (inverte ? '↑' : '↓') : (inverte ? '↓' : '↑')} ${formatarMoeda(Math.abs(diff))}
      </td>
      <td><div class="barra-progresso"><div class="barra-fill-container">
        <div class="barra-fill" style="width:${pct}%;background:${cor};"></div>
      </div><span>${pct.toFixed(0)}%</span></div></td>
    </tr>`;
  }

  // helper: linha de grupo colapsável com totais + barra
  // inverte=true para receitas (meta boa = atingir ou superar o orçado)
  function linhaGrupo(g, orcG, realG, inputOrc, inverte = false) {
    const dG  = inverte ? realG - orcG : orcG - realG;
    const pct = orcG > 0 ? Math.min(100, (realG/orcG)*100) : (realG > 0 ? 100 : 0);
    const cor = inverte
      ? (pct >= 100 ? '#27ae60' : pct >= 80 ? '#f39c12' : '#e74c3c')
      : (pct >= 100 ? '#e74c3c' : pct >= 80 ? '#f39c12' : '#27ae60');
    const orçadoCell = inputOrc && !soLeitura
      ? `<input type="text" inputmode="decimal" class="input-orcamento input-moeda" value="${orcG > 0 ? orcG.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}) : ''}" placeholder="0,00"
           onblur="salvarOrcamento('${g.id}',${ano},${mes},this.value,'${unidadeId}')" onfocus="this.select()">`
      : `<strong>${formatarMoeda(orcG)}</strong>`;
    return `<tr class="orcamento-grupo-row" onclick="toggleGrupoOrcamento('${g.id}')" style="cursor:pointer;">
      <td>
        <i class="fas fa-chevron-down" data-toggle-grupo="${g.id}" style="font-size:11px;margin-right:6px;color:#888;transition:transform 0.2s;"></i>
        <i class="fas fa-folder" style="color:#f39c12;margin-right:4px;"></i>
        <strong>${g.nome}</strong>
      </td>
      <td>${orçadoCell}</td>
      <td><strong>${formatarMoeda(realG)}</strong></td>
      <td style="color:${dG >= 0 ? '#27ae60':'#e74c3c'};font-weight:700;">
        ${dG >= 0 ? (inverte ? '↑' : '↓') : (inverte ? '↓' : '↑')} ${formatarMoeda(Math.abs(dG))}
      </td>
      <td><div class="barra-progresso"><div class="barra-fill-container">
        <div class="barra-fill" style="width:${pct}%;background:${cor};"></div>
      </div><span>${pct.toFixed(0)}%</span></div></td>
    </tr>`;
  }

  let totalOrcRec = 0, totalRealRec = 0;
  let totalOrcPag = 0, totalRealPag = 0;

  let html = `
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
      <p style="color:#888;font-size:13px;margin:0;">
        Período: <strong>${periodo} ${mes > 0 ? ano : ''}</strong> — Digite o valor orçado e clique fora para salvar.
      </p>
      <button id="btn-toggle-todos-orc" class="btn btn-outline btn-sm" data-estado="expandido" onclick="toggleTodosGruposOrcamento()">
        <i class="fas fa-compress-alt"></i> Recolher tudo
      </button>
    </div>
    <table class="tabela"><thead><tr>
      <th>Categoria</th><th>Orçado (R$)</th><th>Realizado (R$)</th><th>Diferença</th><th>Progresso</th>
    </tr></thead><tbody>`;

  // ── RECEITAS ────────────────────────────────────────────────
  html += `<tr style="background:#1a7a3c;color:#fff;">
    <td colspan="5" style="font-weight:700;padding:8px 12px;">
      <i class="fas fa-arrow-down" style="margin-right:6px;"></i>RECEITAS
    </td></tr>`;

  gruposRec
    .filter(g => normalizarTexto(g.nome) !== 'outras receitas')
    .forEach(g => {
      const subs = subcatsRec.filter(s => s.grupo_id === g.id);
      if (!subs.length) return;
      const orc  = orcMap[g.id] || 0;
      const real = subs.reduce((s2, s) => s2 + (realMap[s.id] || 0), 0);
      totalOrcRec += orc; totalRealRec += real;
      html += linhaGrupo(g, orc, real, false, true);
      html += `<tr data-filho-grupo="${g.id}">
        <td style="padding-left:32px;color:#666;font-size:13px;"><i class="fas fa-edit" style="margin-right:6px;color:#bbb;"></i>Orçamento do grupo</td>
        <td><input type="text" inputmode="decimal" class="input-orcamento${soLeitura ? '' : ' input-moeda'}" value="${orc > 0 ? orc.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}) : ''}"
          ${soLeitura ? 'readonly style="background:#f5f5f5;color:#999;cursor:default;"' : `onblur="salvarOrcamento('${g.id}',${ano},${mes},this.value,'${unidadeId}')"`} placeholder="0,00"></td>
        <td colspan="3"></td>
      </tr>`;
    });

  // Linha de total das receitas
  {
    const diffRec = totalOrcRec - totalRealRec;
    html += `<tr style="background:#d5f5e3;font-weight:700;border-top:2px solid #1a7a3c;">
      <td style="color:#1a7a3c;padding-left:12px;">TOTAL RECEITAS</td>
      <td style="color:#1a7a3c;">${formatarMoeda(totalOrcRec)}</td>
      <td style="color:#1a7a3c;">${formatarMoeda(totalRealRec)}</td>
      <td style="color:${diffRec >= 0 ? '#27ae60':'#e74c3c'};">${diffRec >= 0 ? '↑' : '↓'} ${formatarMoeda(Math.abs(diffRec))}</td>
      <td></td>
    </tr>`;
  }

  // ── DESPESAS ────────────────────────────────────────────────
  html += `<tr style="background:#c0392b;color:#fff;">
    <td colspan="5" style="font-weight:700;padding:8px 12px;">
      <i class="fas fa-arrow-up" style="margin-right:6px;"></i>DESPESAS
    </td></tr>`;

  gruposPag.forEach(g => {
    const subs = subcatsPag.filter(s => s.grupo_id === g.id);
    if (!subs.length) return;

    if (g.is_cmv) {
      const orc  = orcMap[g.id] || 0;
      const real = subs.reduce((s2, s) => s2 + (realMap[s.id] || 0), 0);
      totalOrcPag += orc; totalRealPag += real;
      html += linhaGrupo(g, orc, real, false);
      html += `<tr data-filho-grupo="${g.id}">
        <td style="padding-left:32px;color:#666;font-size:13px;"><i class="fas fa-edit" style="margin-right:6px;color:#bbb;"></i>Orçamento do grupo</td>
        <td><input type="text" inputmode="decimal" class="input-orcamento${soLeitura ? '' : ' input-moeda'}" value="${orc > 0 ? orc.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}) : ''}"
          ${soLeitura ? 'readonly style="background:#f5f5f5;color:#999;cursor:default;"' : `onblur="salvarOrcamento('${g.id}',${ano},${mes},this.value,'${unidadeId}')"`} placeholder="0,00"></td>
        <td colspan="3"></td>
      </tr>`;
    } else {
      let orcG = 0, realG = 0;
      subs.forEach(s => { orcG += orcMap[s.id] || 0; realG += realMap[s.id] || 0; });
      totalOrcPag += orcG; totalRealPag += realG;
      html += linhaGrupo(g, orcG, realG, false);
      subs.forEach(s => {
        html += linhaItemMes(s.id, s.nome, 32, orcMap[s.id] || 0, realMap[s.id] || 0, false, g.id);
      });
    }
  });

  // Linha de total das despesas
  {
    const diffPag = totalOrcPag - totalRealPag;
    html += `<tr style="background:#fadbd8;font-weight:700;border-top:2px solid #c0392b;">
      <td style="color:#c0392b;padding-left:12px;">TOTAL DESPESAS</td>
      <td style="color:#c0392b;">${formatarMoeda(totalOrcPag)}</td>
      <td style="color:#c0392b;">${formatarMoeda(totalRealPag)}</td>
      <td style="color:${diffPag >= 0 ? '#27ae60':'#e74c3c'};">${diffPag >= 0 ? '↓' : '↑'} ${formatarMoeda(Math.abs(diffPag))}</td>
      <td></td>
    </tr>`;
  }

  const saldoOrc  = totalOrcRec  - totalOrcPag;
  const saldoReal = totalRealRec - totalRealPag;
  html += `
    <tr style="background:#1a1a2e;color:#fff;font-weight:700;border-top:2px solid #ddd;">
      <td>RESULTADO (Receita − Despesa)</td>
      <td>${formatarMoeda(saldoOrc)}</td>
      <td>${formatarMoeda(saldoReal)}</td>
      <td style="color:${(saldoReal-saldoOrc) >= 0 ? '#7dff8a':'#ff7d7d'};">
        ${(saldoReal-saldoOrc) >= 0 ? '↑' : '↓'} ${formatarMoeda(Math.abs(saldoReal-saldoOrc))}
      </td><td></td>
    </tr>`;

  html += '</tbody></table>';
  container.innerHTML = html;
}

async function salvarOrcamento(planoConta_id, ano, mes, valorStr, unidade_id) {
  if (!unidade_id) return;
  const valor = parseMoeda(valorStr);
  const db = obterSupabase();
  await q(db.from('orcamentos').delete())
    .eq('plano_conta_id', planoConta_id).eq('ano', ano).eq('mes', mes).eq('unidade_id', unidade_id);
  if (valor > 0) {
    const { error } = await q(db.from('orcamentos').insert({ plano_conta_id: planoConta_id, ano, mes, valor, unidade_id }))
    if (error) mostrarToast('Erro ao salvar orçamento.', 'erro');
  }
}

// =========================================================
// IMPORTAR EXTRATO (OFX + XLSX)
// =========================================================
function carregarArquivoImportar(input) {
  const file = input.files[0];
  if (!file) return;

  if (!document.getElementById('banco-importar').value) {
    mostrarToast('Selecione o banco antes de escolher o arquivo!', 'erro');
    input.value = '';
    return;
  }

  document.getElementById('nome-arquivo-ofx').textContent = file.name;
  const ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'xlsx' || ext === 'xls') {
    mostrarCarregandoOFX();
    const reader = new FileReader();
    reader.onload = async function(e) {
      try {
        const wb = XLSX.read(e.target.result, { type: 'binary', cellDates: true });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows  = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        const resultado = parsearXLSX(rows);
        if (resultado.erro) { ocultarCarregandoOFX(); mostrarToast(resultado.erro, 'erro'); return; }
        transacoesOFX = resultado.transacoes;
        autoMatchFornecedores(transacoesOFX);
        autoMatchCategorias(transacoesOFX);
        autoMatchConciliacao(transacoesOFX);
        await verificarDuplicatasComTimeout(transacoesOFX);
        ocultarCarregandoOFX();
        renderizarPreviewOFX(transacoesOFX);
      } catch (err) {
        ocultarCarregandoOFX();
        mostrarToast('Erro ao ler arquivo Excel. Verifique o formato.', 'erro');
      }
    };
    reader.readAsBinaryString(file);
  } else {
    mostrarCarregandoOFX();
    const reader = new FileReader();
    reader.onload = async function(e) {
      try {
        const resultado = parsearOFX(e.target.result);
        if (resultado.erro) { ocultarCarregandoOFX(); mostrarToast(resultado.erro, 'erro'); return; }
        transacoesOFX = resultado.transacoes;
        autoMatchFornecedores(transacoesOFX);
        autoMatchCategorias(transacoesOFX);
        autoMatchConciliacao(transacoesOFX);
        await verificarDuplicatasComTimeout(transacoesOFX);
        ocultarCarregandoOFX();
        renderizarPreviewOFX(transacoesOFX);
      } catch (err) {
        ocultarCarregandoOFX();
        mostrarToast('Erro ao processar o arquivo OFX. Tente novamente.', 'erro');
      }
    };
    reader.readAsText(file, 'windows-1252');
  }
}

function mostrarCarregandoOFX() {
  let el = document.getElementById('ofx-carregando');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ofx-carregando';
    el.style.cssText = 'padding:20px; text-align:center; color:#888; font-size:14px;';
    el.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:8px;"></i>Processando arquivo, aguarde...';
    const preview = document.getElementById('preview-importar');
    if (preview) preview.parentNode.insertBefore(el, preview);
  }
  el.style.display = 'block';
}

function ocultarCarregandoOFX() {
  const el = document.getElementById('ofx-carregando');
  if (el) el.style.display = 'none';
}

// Mantém compatibilidade com nome antigo
function carregarArquivoOFX(input) { carregarArquivoImportar(input); }

function normalizarTexto(str) {
  return str.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function autoMatchFornecedores(transacoes) {
  if (!fornecedores.length) return;
  transacoes.forEach(t => {
    if (t.plano_conta_id) return;
    const descLower = t.descricao.toLowerCase();
    const match = fornecedores.find(f => {
      const nomeLower = f.nome.toLowerCase();
      if (descLower.includes(nomeLower)) return true;
      return nomeLower.split(' ').some(word => word.length > 4 && descLower.includes(word));
    });
    if (match && match.plano_conta_id) {
      t.plano_conta_id = match.plano_conta_id;
    }
  });
}

function autoMatchCategorias(transacoes) {
  const stopwords = new Set(['de','do','da','dos','das','em','no','na','nos','nas','por','com','uma','uns','para','e','a','o','as','os']);

  // Palavras na descrição do extrato → palavra a buscar no nome da categoria
  const aliases = {
    'antecipacao': 'credito',
    'antecip':     'credito',
  };

  const subcats = planoContas.filter(p => p.grupo_id);
  if (!subcats.length) return;

  transacoes.forEach(t => {
    if (t.plano_conta_id) return;
    const descNorm = normalizarTexto(t.descricao);

    // 1ª tentativa: histórico de classificações anteriores (memória do usuário)
    const idHistorico = classificacaoHistorica.get(descNorm);
    if (idHistorico) {
      const cat = subcats.find(p => p.id === idHistorico && p.tipo === t.tipo);
      if (cat) { t.plano_conta_id = cat.id; t.classificado_por_historico = true; return; }
    }

    const candidates = subcats.filter(p => p.tipo === t.tipo);

    // 2ª tentativa: maior pontuação (quantas palavras do nome da categoria aparecem na descrição)
    let melhorScore = 0;
    let match = null;
    for (const cat of candidates) {
      const palavras = normalizarTexto(cat.nome)
        .split(' ')
        .filter(w => w.length >= 3 && !stopwords.has(w));
      if (!palavras.length) continue;
      const score = palavras.filter(p => descNorm.includes(p)).length;
      if (score > melhorScore) { melhorScore = score; match = cat; }
    }

    // 3ª tentativa: alias (ex: "antecipacao" na descrição → busca "credito" na categoria)
    if (!match) {
      for (const [trigger, alvo] of Object.entries(aliases)) {
        if (descNorm.includes(trigger)) {
          match = candidates.find(cat => normalizarTexto(cat.nome).includes(alvo));
          if (match) break;
        }
      }
    }

    if (match) t.plano_conta_id = match.id;
  });
}

async function gravarClassificacaoHistorica(transacoes) {
  const db = obterSupabase();
  const registros = transacoes
    .filter(t => t.plano_conta_id && t.descricao)
    .map(t => ({
      descricao_norm: normalizarTexto(t.descricao),
      plano_conta_id: t.plano_conta_id,
      atualizado_em:  new Date().toISOString()
    }));
  if (!registros.length) return;
  await q(db.from('classificacao_historica')
    .upsert(registros, { onConflict: 'descricao_norm' }));
  // Atualiza cache local com as novas classificações
  registros.forEach(r => classificacaoHistorica.set(r.descricao_norm, r.plano_conta_id));
}

async function verificarDuplicatasComTimeout(transacoes) {
  const TIMEOUT_MS = 12000;
  const timeout = new Promise(resolve => setTimeout(resolve, TIMEOUT_MS));
  await Promise.race([verificarDuplicatas(transacoes), timeout]);
}

// Expande uma transação do extrato nos seus débitos constituintes.
// Se for um GRUPO de lotes, devolve 1 entrada por lote (fitId + valor de cada);
// senão devolve a própria transação. Usado para gravar 1 pagamento por débito,
// garantindo que TODO FITID consumido numa conciliação fique registrado.
function debitosDaTransacaoOFX(t) {
  if (t.agrupamento_indices?.length) {
    const arr = [{ fitId: t.fitId || null, valor: Number(t.valor_original ?? t.valor) || 0 }];
    for (const idx of t.agrupamento_indices) {
      const m = transacoesOFX[idx];
      if (m) arr.push({ fitId: m.fitId || null, valor: Number(m.valor) || 0 });
    }
    return arr;
  }
  return [{ fitId: t.fitId || null, valor: Number(t.valor) || 0 }];
}

async function verificarDuplicatas(transacoes) {
  const db = obterSupabase();
  const bancoId = document.getElementById('banco-importar')?.value || null;

  // 1. Por fitId — checa tanto lancamentos.ofx_id (1 por lançamento) quanto
  //    pagamentos.ofx_id (1 por débito do extrato). Conciliações com vários
  //    débitos guardam os FITIDs extras SÓ em pagamentos; sem olhar os dois,
  //    débitos agrupados reaparecem como não conciliados no reimport.
  const fitIds = transacoes.map(t => t.fitId).filter(f => f);
  if (fitIds.length) {
    const [rLanc, rPag] = await Promise.all([
      db.from('lancamentos').select('ofx_id').in('ofx_id', fitIds),
      db.from('pagamentos').select('ofx_id').in('ofx_id', fitIds)
    ]);
    const idsExistentes = new Set([
      ...((rLanc.data || []).map(l => l.ofx_id)),
      ...((rPag.data || []).map(p => p.ofx_id))
    ].filter(Boolean));
    if (idsExistentes.size) {
      transacoes.forEach(t => {
        if (t.fitId && idsExistentes.has(t.fitId)) {
          t.jaImportado = true;
          t.selecionado = false;
        }
      });
    }
  }

  // 2. Fallback principal: banco + data_pagamento + valor + tipo + status=pago
  //    Não depende da coluna ofx_id existir. Cobre lançamentos criados ou conciliados.
  const semMatch = transacoes.filter(t => !t.jaImportado);
  if (semMatch.length && bancoId) {
    const minData = semMatch.reduce((min, t) => t.data < min ? t.data : min, '9999-12-31');
    const maxData = semMatch.reduce((max, t) => t.data > max ? t.data : max, '0000-01-01');
    const { data: pagos } = await db.from('lancamentos')
      .select('id, valor, valor_pago, data_pagamento, tipo')
      .eq('status', 'pago')
      .eq('banco_id', bancoId)
      .gte('data_pagamento', minData)
      .lte('data_pagamento', maxData);

    if (pagos && pagos.length) {
      const usados = new Set();
      const atualizarOFXId = [];
      semMatch.forEach(t => {
        const match = pagos.find(p =>
          !usados.has(p.id) &&
          p.tipo === t.tipo &&
          (Math.abs(Number(p.valor) - t.valor) < 0.01 ||
           Math.abs(Number(p.valor_pago || p.valor) - t.valor) < 0.01) &&
          (p.data_pagamento || '').substring(0, 10) === t.data
        );
        if (match) {
          t.jaImportado = true;
          t.selecionado = false;
          usados.add(match.id);
          if (t.fitId) atualizarOFXId.push({ id: match.id, ofx_id: t.fitId });
        }
      });
      // Salva ofx_id retroativamente (best-effort, não bloqueia se coluna não existir)
      for (const item of atualizarOFXId) {
        db.from('lancamentos').update({ ofx_id: item.ofx_id }).eq('id', item.id);
      }
    }
  }

  // 2b. Fallback por SOMA (conciliação "múltiplos"): 1 linha do extrato paga
  //     VÁRIOS lançamentos (ex.: boleto de fatura de cartão). Nesse caso nenhum
  //     lançamento isolado tem o valor da linha, então o passo 2 não pega — e o
  //     FITID do Santander muda a cada download, então o passo 1 também não pega.
  //     Aqui agrupamos os pagamentos OFX já gravados por (data, ofx_id) e, se a
  //     SOMA de um grupo (2+ pagamentos) bater com o valor da linha, é duplicata.
  const semMatch2 = transacoes.filter(t => !t.jaImportado && t.fitId);
  if (semMatch2.length && bancoId) {
    const minData = semMatch2.reduce((min, t) => t.data < min ? t.data : min, '9999-12-31');
    const maxData = semMatch2.reduce((max, t) => t.data > max ? t.data : max, '0000-01-01');
    const { data: pagosOfx } = await db.from('pagamentos')
      .select('valor, data, ofx_id')
      .eq('origem', 'ofx')
      .eq('banco_id', bancoId)
      .gte('data', minData)
      .lte('data', maxData);

    if (pagosOfx && pagosOfx.length) {
      // Agrupa por (data, ofx_id) — cada conciliação múltipla compartilha o mesmo ofx_id.
      const grupos = new Map();
      for (const p of pagosOfx) {
        if (!p.ofx_id) continue; // sem id não dá pra agrupar com segurança
        const dia = (p.data || '').substring(0, 10);
        const chave = `${dia}|${p.ofx_id}`;
        const g = grupos.get(chave) || { data: dia, soma: 0, n: 0 };
        g.soma += Number(p.valor) || 0;
        g.n += 1;
        grupos.set(chave, g);
      }
      // Só grupos com 2+ pagamentos são "múltiplos" (1 pagamento já foi coberto no passo 2).
      const gruposMulti = [...grupos.values()].filter(g => g.n >= 2);
      const usados = new Set();
      semMatch2.forEach(t => {
        const g = gruposMulti.find(g =>
          !usados.has(g) &&
          g.data === t.data &&
          Math.abs(g.soma - t.valor) < 0.01
        );
        if (g) {
          t.jaImportado = true;
          t.selecionado = false;
          usados.add(g);
        }
      });
    }
  }

  // 3. Excel (sem fitId): verifica por valor + data + tipo já pagos
  const semFitId = transacoes.filter(t => !t.fitId && !t.jaImportado);
  if (semFitId.length) {
    const datas = [...new Set(semFitId.map(t => t.data))];
    const { data: jaExistem } = await db.from('lancamentos')
      .select('valor, vencimento, tipo')
      .eq('status', 'pago')
      .in('vencimento', datas);
    const existentes = (jaExistem || []).map(l =>
      `${Number(l.valor).toFixed(2)}|${l.vencimento}|${l.tipo}`
    );
    semFitId.forEach(t => {
      const chave = `${t.valor.toFixed(2)}|${t.data}|${t.tipo}`;
      if (existentes.includes(chave)) {
        t.jaImportado = true;
        t.selecionado = false;
      }
    });
  }

  // Verifica transferências já registradas para este banco
  const semImportar = transacoes.filter(t => !t.jaImportado);
  if (semImportar.length && bancoId) {
    const datas = [...new Set(semImportar.map(t => t.data))];
    const { data: transfs } = await db.from('transferencias')
      .select('banco_origem_id, banco_destino_id, valor, data')
      .in('data', datas);
    if (transfs?.length) {
      semImportar.forEach(t => {
        const match = transfs.find(tr =>
          Math.abs(Number(tr.valor) - t.valor) < 0.01 &&
          tr.data === t.data &&
          (tr.banco_origem_id === bancoId || tr.banco_destino_id === bancoId)
        );
        if (match) { t.jaImportado = true; t.selecionado = false; }
      });
    }
  }
}

function autoMatchConciliacao(transacoes) {
  const usados = new Set();
  transacoes.forEach(t => {
    t.lancamento_id           = null;
    t.lancamentos_ids         = [];
    t.transferencia_destino_id = null;
    const dataTransacao = new Date(t.data + 'T00:00:00');
    const candidatos = lancamentosPendentes.filter(l => {
      if (usados.has(l.id)) return false;
      if (l.tipo !== t.tipo) return false;
      if (Math.abs(Number(l.valor) - t.valor) >= 0.01) return false;
      // Não auto-conciliar pagamentos com vencimento no futuro:
      // o sistema não pode presumir que o usuário está pagando antecipado.
      const dataVenc = new Date(l.vencimento + 'T00:00:00');
      if (dataVenc > dataTransacao) return false;
      return true;
    });
    if (!candidatos.length) return;
    candidatos.sort((a, b) => {
      const da = Math.abs(new Date(a.vencimento + 'T00:00:00') - dataTransacao);
      const db = Math.abs(new Date(b.vencimento + 'T00:00:00') - dataTransacao);
      return da - db;
    });
    const melhor = candidatos[0];
    const diffDias = (dataTransacao - new Date(melhor.vencimento + 'T00:00:00')) / 86400000;
    if (diffDias <= 45) {
      t.lancamento_id = melhor.id;
      usados.add(melhor.id);
    }
  });
}

function parsearOFX(conteudo) {
  const ofxStart = conteudo.indexOf('<OFX>');
  if (ofxStart === -1) return { erro: 'Arquivo inválido. Não é um OFX reconhecido.' };

  const texto    = conteudo.substring(ofxStart);
  const partes   = texto.split('<STMTTRN>');
  const transacoes = [];

  for (let i = 1; i < partes.length; i++) {
    const bloco  = partes[i];
    const dtStr  = extrairTagOFX(bloco, 'DTPOSTED');
    const amtStr = extrairTagOFX(bloco, 'TRNAMT');
    const fitId  = extrairTagOFX(bloco, 'FITID') || '';
    const memo   = extrairTagOFX(bloco, 'MEMO') || extrairTagOFX(bloco, 'NAME') || 'Sem descrição';

    if (!dtStr || !amtStr) continue;
    const valor = parseFloat(amtStr.replace(',', '.'));
    if (isNaN(valor)) continue;

    transacoes.push({
      data:          parsearDataOFX(dtStr),
      descricao:     memo.trim(),
      valor:         Math.abs(valor),
      tipo:          valor < 0 ? 'pagar' : 'receber',
      fitId,
      selecionado:   true,
      plano_conta_id: ''
    });
  }

  if (!transacoes.length) return { erro: 'Nenhuma transação encontrada no arquivo.' };
  return { transacoes };
}

function parsearXLSX(rows) {
  if (!rows || rows.length < 2) return { erro: 'Arquivo vazio ou sem dados.' };

  const headers = rows[0].map(h => String(h || '').toLowerCase().trim());

  const colData = headers.findIndex(h =>
    h === 'data' || h.includes('data') || h === 'date');
  const colDesc = headers.findIndex(h =>
    h.includes('histórico') || h.includes('historico') ||
    h.includes('descrição') || h.includes('descricao') ||
    h.includes('memo') || h.includes('lançamento') || h.includes('lancamento') ||
    h === 'historico' || h === 'descricao');
  const colDebito = headers.findIndex(h =>
    h.includes('débito') || h.includes('debito') ||
    h.includes('saída') || h.includes('saida') || h === 'debito');
  const colCredito = headers.findIndex(h =>
    h.includes('crédito') || h.includes('credito') ||
    h.includes('entrada') || h === 'credito');
  const colValor = colDebito === -1 && colCredito === -1
    ? headers.findIndex(h => h === 'valor' || h === 'quantia' || h === 'montante')
    : -1;

  if (colData === -1 || colDesc === -1) {
    return { erro: `Não foi possível identificar colunas "Data" e "Descrição/Histórico" na planilha.\nColunas encontradas: ${headers.join(', ')}` };
  }

  const transacoes = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(c => !c)) continue;

    let dataStr = '';
    const rawData = row[colData];
    if (rawData instanceof Date) {
      dataStr = rawData.toISOString().split('T')[0];
    } else if (typeof rawData === 'number') {
      const d = new Date((rawData - 25569) * 86400 * 1000);
      dataStr = d.toISOString().split('T')[0];
    } else if (rawData) {
      dataStr = parsearDataXLSX(String(rawData)) || '';
    }
    if (!dataStr) continue;

    const descricao = String(row[colDesc] || '').trim();
    if (!descricao) continue;

    let valor = 0, tipo = 'pagar';

    if (colDebito !== -1 || colCredito !== -1) {
      const deb = colDebito !== -1 ? (parseFloat(String(row[colDebito] || '0').replace(',', '.')) || 0) : 0;
      const cre = colCredito !== -1 ? (parseFloat(String(row[colCredito] || '0').replace(',', '.')) || 0) : 0;
      if (deb > 0)       { valor = deb;  tipo = 'pagar'; }
      else if (cre > 0)  { valor = cre;  tipo = 'receber'; }
      else continue;
    } else if (colValor !== -1) {
      const v = parseFloat(String(row[colValor] || '0').replace(',', '.')) || 0;
      if (v === 0) continue;
      valor = Math.abs(v);
      tipo  = v < 0 ? 'pagar' : 'receber';
    } else {
      continue;
    }

    transacoes.push({ data: dataStr, descricao, valor, tipo, fitId: '', selecionado: true, plano_conta_id: '' });
  }

  if (!transacoes.length) return { erro: 'Nenhuma transação encontrada. Verifique o formato da planilha.' };
  return { transacoes };
}

function parsearDataXLSX(dateStr) {
  const m1 = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m1) return `${m1[3]}-${m1[2].padStart(2,'0')}-${m1[1].padStart(2,'0')}`;
  const m2 = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  const m3 = dateStr.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m3) return `${m3[3]}-${m3[2].padStart(2,'0')}-${m3[1].padStart(2,'0')}`;
  return null;
}

function extrairTagOFX(texto, tag) {
  const m = texto.match(new RegExp('<' + tag + '>\\s*([^<\\r\\n]+)', 'i'));
  return m ? m[1].trim() : null;
}

function parsearDataOFX(dtStr) {
  const s = dtStr.replace(/\[.*\]/, '').trim();
  if (s.length >= 8) return `${s.substring(0,4)}-${s.substring(4,6)}-${s.substring(6,8)}`;
  return new Date().toISOString().split('T')[0];
}

function labelCatOFX(id) {
  const cat   = planoContas.find(p => p.id === id);
  if (!cat) return '';
  const grupo = planoContas.find(p => p.id === cat.grupo_id);
  return grupo ? `${grupo.nome} › ${cat.nome}` : cat.nome;
}

function selecionarCatOFX(i, valor) {
  const t       = transacoesOFX[i];
  const subcats = planoContas.filter(p => p.tipo === t.tipo && p.grupo_id);
  const grupos  = planoContas.filter(p => p.tipo === t.tipo && !p.grupo_id);
  const match   = subcats.find(s => {
    const g     = grupos.find(g => g.id === s.grupo_id);
    const label = g ? `${g.nome} › ${s.nome}` : s.nome;
    return label === valor || s.nome === valor;
  });
  transacoesOFX[i].plano_conta_id = match ? match.id : '';
}

function selecionarConciliacaoOFX(i, lancamentoId) {
  transacoesOFX[i].lancamento_id  = lancamentoId || null;
  transacoesOFX[i].lancamentos_ids = [];
  renderizarCelulaConciliacao(i);
}

function htmlConciliacaoCell(t, i) {
  // Modo transferência: já tem destino definido
  if (t.transferencia_destino_id) {
    const banco = bancosCadastrados.find(b => b.id === t.transferencia_destino_id);
    const label = banco ? `${banco.nome}${banco.conta ? ' (' + banco.conta + ')' : ''}` : '?';
    const seta  = t.tipo === 'pagar' ? `→ ${label}` : `← ${label}`;
    return `
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <span style="color:#3498db;font-size:12px;font-weight:600;">
          <i class="fas fa-exchange-alt"></i> ${seta}
        </span>
        <button class="btn btn-sm" style="background:#fef0ee;color:#e74c3c;border:1px solid #e74c3c;cursor:pointer;border-radius:6px;padding:2px 8px;font-size:12px;" onclick="limparTransferencia(${i})">✕ Cancelar</button>
      </div>`;
  }

  if (t.agrupado_em_idx !== undefined) {
    const principal = transacoesOFX[t.agrupado_em_idx];
    return `
      <div style="font-size:12px;font-weight:600;color:#2980b9;margin-bottom:4px;">
        <i class="fas fa-object-group"></i> Agrupada com outro lote
      </div>
      <div style="font-size:11px;color:#555;margin-bottom:6px;word-break:break-word;">
        ${principal ? principal.descricao_original || principal.descricao : ''}
      </div>
      <button class="btn btn-sm" style="background:#fef0ee;color:#e74c3c;border:1px solid #e74c3c;cursor:pointer;border-radius:6px;padding:2px 8px;font-size:12px;" onclick="desfazerAgrupamento(${t.agrupado_em_idx})">✕ Desfazer</button>`;
  }

  // Débito que é parte de uma divisão de pedido por data
  if (t.dividido_em_idx !== undefined) {
    return `
      <div style="font-size:12px;font-weight:600;color:#8e44ad;margin-bottom:4px;">
        <i class="fas fa-scissors"></i> Parte da divisão do pedido
      </div>
      <div style="font-size:11px;color:#555;margin-bottom:6px;word-break:break-word;">
        ${transacoesOFX[t.dividido_em_idx]?.dividir_pedido?.descricao || ''}
      </div>
      <button class="btn btn-sm" style="background:#fef0ee;color:#e74c3c;border:1px solid #e74c3c;cursor:pointer;border-radius:6px;padding:2px 8px;font-size:12px;" onclick="desfazerDividirPedido(${t.dividido_em_idx})">✕ Desfazer divisão</button>`;
  }

  // Líder de uma divisão de pedido por data
  if (t.dividir_pedido) {
    const n = 1 + (t.dividir_indices?.length || 0);
    return `
      <div style="font-size:12px;font-weight:600;color:#8e44ad;margin-bottom:4px;">
        <i class="fas fa-scissors"></i> Dividido em ${n} partes por data
      </div>
      <div style="font-size:11px;color:#777;margin-bottom:6px;word-break:break-word;">
        ${t.dividir_pedido.descricao} · rateio proporcional
      </div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;">
        <button class="btn btn-outline btn-sm" style="font-size:11px;" onclick="abrirDividirPedido(${i})">Editar</button>
        <button class="btn btn-sm" style="background:#fef0ee;color:#e74c3c;border:1px solid #e74c3c;cursor:pointer;border-radius:6px;padding:2px 8px;font-size:12px;" onclick="desfazerDividirPedido(${i})">✕ Desfazer</button>
      </div>`;
  }

  if (t.agrupamento_indices?.length > 0) {
    const n = t.agrupamento_indices.length + 1;
    return `
      <div style="font-size:12px;font-weight:600;color:#2980b9;margin-bottom:4px;">
        <i class="fas fa-object-group"></i> Grupo de ${n} lotes — ${formatarMoeda(t.valor)}
      </div>
      <div style="font-size:11px;color:#777;margin-bottom:6px;">Valor combinado de ${n} transações do extrato</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;">
        <button class="btn btn-outline btn-sm" style="font-size:11px;" onclick="abrirConciliacaoMultipla(${i})">
          <i class="fas fa-layer-group"></i> Múltiplos
        </button>
        <button class="btn btn-sm" style="background:#fef0ee;color:#e74c3c;border:1px solid #e74c3c;cursor:pointer;border-radius:6px;padding:2px 8px;font-size:12px;" onclick="desfazerAgrupamento(${i})">✕ Desfazer grupo</button>
      </div>`;
  }

  if (t.lancamentos_ids && t.lancamentos_ids.length > 0) {
    const total = t.lancamentos_ids.reduce((s, id) => {
      const l = lancamentosPendentes.find(l => l.id === id);
      return s + (l ? Number(l.valor) : 0);
    }, 0);
    const dif = Math.abs(total - t.valor);
    const cor = dif < 0.01 ? '#27ae60' : '#f39c12';
    return `
      <div style="font-size:12px;font-weight:600;color:${cor};margin-bottom:4px;">
        <i class="fas fa-layer-group"></i> ${t.lancamentos_ids.length} lançamento(s) — ${formatarMoeda(total)}
      </div>
      <div style="display:flex;gap:4px;">
        <button class="btn btn-outline btn-sm" onclick="abrirConciliacaoMultipla(${i})">Editar</button>
        <button class="btn btn-sm" style="background:#fef0ee;color:#e74c3c;border:1px solid #e74c3c;cursor:pointer;border-radius:6px;padding:2px 8px;font-size:12px;" onclick="limparConciliacaoMultipla(${i})">✕ Limpar</button>
      </div>`;
  }

  if (t.unidade_split && t.unidade_split.length > 0) {
    const totalSplit = t.unidade_split.reduce((s, r) => s + r.valor, 0);
    const linhas = t.unidade_split.map(r => {
      const u = unidades.find(u => u.id === r.unidade_id);
      return `<div style="font-size:11px;color:#555;">${u ? u.nome : '?'}: ${formatarMoeda(r.valor)}</div>`;
    }).join('');
    return `
      <div style="font-size:12px;font-weight:600;color:#8e44ad;margin-bottom:4px;">
        <i class="fas fa-sitemap"></i> ${t.unidade_split.length} unidade(s) — ${formatarMoeda(totalSplit)}
      </div>
      ${linhas}
      <div style="display:flex;gap:4px;margin-top:4px;">
        <button class="btn btn-outline btn-sm" style="font-size:11px;" onclick="abrirDivisaoUnidade(${i})">Editar</button>
        <button class="btn btn-sm" style="background:#fef0ee;color:#e74c3c;border:1px solid #e74c3c;cursor:pointer;border-radius:6px;padding:2px 8px;font-size:12px;" onclick="limparDivisaoUnidade(${i})">✕ Limpar</button>
      </div>`;
  }

  const pendentesDoTipo   = lancamentosPendentes.filter(l => l.tipo === t.tipo);
  const dataInicial       = t.data || '';
  const pendentesVisiveis = dataInicial
    ? pendentesDoTipo.filter(l => l.vencimento === dataInicial || l.id === t.lancamento_id)
    : pendentesDoTipo;
  const opcoesSelect = pendentesVisiveis.map(l => {
    const fornNome   = l.fornecedores?.nome ? ` — ${l.fornecedores.nome}` : '';
    const valorPago  = Number(l.valor_pago || 0);
    const valorLabel = valorPago > 0
      ? `Restante: ${formatarMoeda(Number(l.valor) - valorPago)} (pago: ${formatarMoeda(valorPago)})`
      : formatarMoeda(Number(l.valor));
    const label      = `${l.descricao}${fornNome} (${formatarData(l.vencimento)}) ${valorLabel}`;
    const sel        = t.lancamento_id === l.id ? 'selected' : '';
    return `<option value="${l.id}" ${sel}>${label}</option>`;
  }).join('');
  const lancSel = t.lancamento_id ? lancamentosPendentes.find(l => l.id === t.lancamento_id) : null;
  const vencFuturo = lancSel && lancSel.vencimento > (t.data || '');

  // Alerta de duplicata: sem conciliação selecionada, mas há pendentes com mesmo valor
  let badgeDuplicata = '';
  if (!t.lancamento_id) {
    const candidatos = lancamentosPendentes.filter(l =>
      l.tipo === t.tipo && Math.abs(Number(l.valor) - t.valor) < 0.01
    );
    if (candidatos.length > 0) {
      const nomes = candidatos.slice(0, 2).map(l => {
        const forn = l.fornecedores?.nome ? ` — ${l.fornecedores.nome}` : '';
        return `<strong>${l.descricao}${forn}</strong> (${formatarData(l.vencimento)})`;
      }).join('<br>');
      const mais = candidatos.length > 2 ? `<br>+${candidatos.length - 2} outro(s)` : '';
      badgeDuplicata = `
        <div style="margin-top:5px;padding:6px 8px;background:#fff8e1;border:1px solid #f39c12;border-radius:6px;font-size:11px;color:#856404;">
          <div style="font-weight:600;margin-bottom:3px;"><i class="fas fa-exclamation-triangle"></i> Possível duplicata — há ${candidatos.length} lançamento(s) pendente(s) com mesmo valor:</div>
          ${nomes}${mais}
          <div style="margin-top:3px;color:#888;">Selecione acima para conciliar em vez de criar um novo lançamento.</div>
        </div>`;
    }
  }

  const badge = t.lancamento_id
    ? vencFuturo
      ? `<div style="font-size:11px;color:#e67e22;margin-top:3px;font-weight:600;">
           <i class="fas fa-exclamation-triangle"></i> Vencimento futuro: ${formatarData(lancSel.vencimento)} — confirme se é pagamento antecipado
         </div>`
      : '<div style="font-size:11px;color:#27ae60;margin-top:3px;"><i class="fas fa-link"></i> conciliado automaticamente</div>'
    : '';

  // Ajuste de desconto/juros quando o valor do extrato difere do lançamento
  let ajusteHtml = '';
  if (lancSel) {
    const diff = t.valor - Number(lancSel.valor); // + = juros, - = desconto
    const diffAbs = Math.abs(diff);
    if (diffAbs >= 0.01) {
      const tipoDetect  = diff < 0 ? 'desconto' : 'acrescimo';
      const tipoAtual   = t.ajuste_tipo  || tipoDetect;
      const valorAtual  = t.ajuste_valor != null ? t.ajuste_valor : diffAbs;
      const valFmt      = valorAtual.toFixed(2).replace('.', ',');
      const cor         = diff < 0 ? '#27ae60' : '#e74c3c';
      const bg          = diff < 0 ? '#eafaf1' : '#fef9e7';
      const icone       = diff < 0 ? 'fa-tag' : 'fa-chart-line';
      const label       = diff < 0 ? 'Desconto' : 'Juros/Multa';
      // Inicializa estado na transação se ainda não foi definido
      if (t.ajuste_tipo == null) { transacoesOFX[i].ajuste_tipo = tipoDetect; transacoesOFX[i].ajuste_valor = diffAbs; }
      ajusteHtml = `
        <div style="margin-top:5px;padding:6px 8px;background:${bg};border:1px solid ${cor}44;border-radius:6px;font-size:12px;">
          <div style="color:${cor};font-weight:600;margin-bottom:5px;">
            <i class="fas ${icone}"></i> Diferença de ${formatarMoeda(diffAbs)} — informe o ajuste:
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <select style="font-size:11px;padding:2px 4px;border:1px solid #ddd;border-radius:4px;"
              onchange="transacoesOFX[${i}].ajuste_tipo=this.value">
              <option value="desconto"  ${tipoAtual==='desconto'  ? 'selected':''}>Desconto</option>
              <option value="acrescimo" ${tipoAtual==='acrescimo' ? 'selected':''}>Juros/Multa</option>
            </select>
            <input type="text" value="${valFmt}"
              style="width:85px;font-size:11px;padding:2px 6px;border:1px solid #ddd;border-radius:4px;text-align:right;"
              oninput="transacoesOFX[${i}].ajuste_valor=parseMoeda(this.value)">
            <span style="color:#888;font-size:11px;">Original: ${formatarMoeda(Number(lancSel.valor))}</span>
          </div>
        </div>`;
    } else {
      transacoesOFX[i].ajuste_tipo  = null;
      transacoesOFX[i].ajuste_valor = null;
    }
  }

  return `
    <input type="date" id="filtro-data-concil-${i}" value="${dataInicial}"
      oninput="filtrarDataConciliacao(${i})"
      title="Filtrar por data de vencimento"
      style="width:100%;padding:4px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;margin-bottom:4px;">
    <select id="select-concil-${i}" class="input-ofx-cat" onchange="selecionarConciliacaoOFX(${i}, this.value)">
      <option value="">➕ Novo lançamento</option>
      ${opcoesSelect}
    </select>
    ${badge}
    ${badgeDuplicata}
    ${ajusteHtml}
    <div style="display:flex;gap:4px;margin-top:5px;flex-wrap:wrap;">
      <button class="btn btn-outline btn-sm" style="font-size:11px;" onclick="abrirConciliacaoMultipla(${i})">
        <i class="fas fa-layer-group"></i> Múltiplos
      </button>
      <button class="btn btn-outline btn-sm" style="font-size:11px;color:#2980b9;border-color:#2980b9;" onclick="abrirAgrupar(${i})">
        <i class="fas fa-object-group"></i> Agrupar
      </button>
      ${t.tipo === 'receber' ? `<button class="btn btn-outline btn-sm" style="font-size:11px;color:#8e44ad;border-color:#8e44ad;" onclick="abrirDivisaoUnidade(${i})">
        <i class="fas fa-sitemap"></i> Dividir Unidade
      </button>` : ''}
      ${t.tipo === 'pagar' ? `<button class="btn btn-outline btn-sm" style="font-size:11px;color:#8e44ad;border-color:#8e44ad;" onclick="abrirDividirPedido(${i})">
        <i class="fas fa-scissors"></i> Dividir Pedido
      </button>` : ''}
      <button class="btn btn-outline btn-sm" style="font-size:11px;color:#3498db;border-color:#3498db;" onclick="abrirTransferencia(${i})">
        <i class="fas fa-exchange-alt"></i> Transferência
      </button>
    </div>`;
}

function renderizarCelulaConciliacao(i) {
  const cell = document.getElementById(`concil-cell-${i}`);
  if (!cell) return;
  cell.innerHTML = htmlConciliacaoCell(transacoesOFX[i], i);
  const row = cell.closest('tr');
  if (row) row.style.background = transacoesOFX[i].transferencia_destino_id ? '#eaf4fd' : '';
}

function renderizarPreviewOFX(transacoes) {
  document.getElementById('preview-importar').classList.remove('hidden');
  document.getElementById('resumo-ofx').textContent =
    `${transacoes.length} transação(ões) encontrada(s) no arquivo`;

  const tbody = document.getElementById('tbody-importar');
  tbody.innerHTML = transacoes.map((t, i) => {
    const grupos  = planoContas.filter(p => p.tipo === t.tipo && !p.grupo_id);
    const subcats = planoContas.filter(p => p.tipo === t.tipo && p.grupo_id);

    let datalistOpts = '';
    grupos.forEach(g => {
      subcats.filter(s => s.grupo_id === g.id).forEach(s => {
        datalistOpts += `<option value="${g.nome} › ${s.nome}">`;
      });
    });

    const corBadge  = t.tipo === 'pagar' ? 'vencido' : 'pago';
    const labelTipo = t.tipo === 'pagar' ? 'Saída' : 'Entrada';
    const valorAtual = labelCatOFX(t.plano_conta_id);
    const autoMatch  = t.classificado_por_historico
      ? ' <span style="font-size:11px;color:#8e44ad;" title="Classificado com base em importações anteriores">📚 histórico</span>'
      : t.plano_conta_id ? ' <span style="font-size:11px;color:#27ae60;">(auto)</span>' : '';

    const uniOpts = `<option value="">— Nenhuma —</option>`
      + unidades.map(u => `<option value="${u.id}" ${t.unidade_id === u.id ? 'selected' : ''}>${u.nome}</option>`).join('');

    if (t.jaImportado) {
      const btnDesfazer = t.fitId
        ? `<button class="btn btn-sm" style="margin-left:10px;background:#fef0ee;color:#e74c3c;border:1px solid #e74c3c;border-radius:6px;padding:2px 10px;font-size:11px;cursor:pointer;"
             onclick="desfazerImportacaoOFX('${t.fitId}', ${i})">
             <i class="fas fa-undo"></i> Desfazer
           </button>`
        : '';
      return `
        <tr style="opacity:0.6; background:#fff8e1;">
          <td><input type="checkbox" onchange="transacoesOFX[${i}].selecionado = this.checked"></td>
          <td>${formatarData(t.data)}</td>
          <td style="max-width:200px;word-break:break-word;font-size:13px;">${t.descricao}</td>
          <td><strong>${formatarMoeda(t.valor)}</strong></td>
          <td><span class="badge badge-${corBadge}">${labelTipo}</span></td>
          <td colspan="3" style="color:#e67e22;font-size:12px;font-weight:600;">
            <i class="fas fa-exclamation-triangle"></i> Já importado anteriormente
            ${btnDesfazer}
          </td>
        </tr>`;
    }

    return `
      <tr>
        <td><input type="checkbox" ${t.selecionado ? 'checked' : ''}
          onchange="transacoesOFX[${i}].selecionado = this.checked"></td>
        <td>${formatarData(t.data)}</td>
        <td style="max-width:200px;word-break:break-word;font-size:13px;">${t.descricao}</td>
        <td><strong>${formatarMoeda(t.valor)}</strong></td>
        <td><span class="badge badge-${corBadge}">${labelTipo}</span></td>
        <td>
          <input type="text" list="cats-${i}" class="input-ofx-cat"
            value="${valorAtual}"
            placeholder="Digite para buscar..."
            oninput="selecionarCatOFX(${i}, this.value)">
          <datalist id="cats-${i}">${datalistOpts}</datalist>
          ${autoMatch}
          ${t.tipo === 'pagar' ? `<select id="cc-ofx-${i}"
            style="margin-top:5px;width:100%;padding:4px 6px;border:1px solid #ddd;border-radius:6px;font-size:12px;color:#555;"
            onchange="transacoesOFX[${i}].centro_custo_id = this.value || null">
            <option value="">Centro de Custo (opc.)</option>
            ${centrosCusto.map(c => `<option value="${c.id}">${c.nome}</option>`).join('')}
          </select>` : ''}
        </td>
        <td style="min-width:150px;">
          <select style="width:100%;padding:5px 6px;border:1px solid #ddd;border-radius:6px;font-size:13px;color:#555;"
            onchange="transacoesOFX[${i}].unidade_id = this.value || null">
            ${uniOpts}
          </select>
        </td>
        <td id="concil-cell-${i}" style="min-width:220px;">
          ${htmlConciliacaoCell(t, i)}
        </td>
      </tr>`;
  }).join('');
}

async function desfazerImportacaoOFX(fitId, i) {
  if (!await garantirSessao()) return;
  if (!confirm('Desfazer esta importação? O lançamento voltará para pendente e a transação poderá ser reimportada.')) return;

  const db = obterSupabase();

  // Verifica se foi conciliado com lançamento existente (registro em pagamentos)
  const { data: pagamentos } = await q(
    db.from('pagamentos').select('id, lancamento_id, valor').eq('ofx_id', fitId)
  );

  if (pagamentos && pagamentos.length > 0) {
    for (const pag of pagamentos) {
      await q(db.from('pagamentos').delete().eq('id', pag.id));
      const { data: restantes } = await q(
        db.from('pagamentos').select('valor').eq('lancamento_id', pag.lancamento_id)
      );
      const novoValorPago = (restantes || []).reduce((s, p) => s + Number(p.valor), 0);
      const upd = novoValorPago > 0
        ? { valor_pago: novoValorPago }
        : { valor_pago: 0, status: 'pendente', data_pagamento: null, ofx_id: null };
      await q(db.from('lancamentos').update(upd).eq('id', pag.lancamento_id));
    }
  } else {
    // Foi criado como novo lançamento — deleta o lançamento inteiro
    const { data: lanc } = await q(
      db.from('lancamentos').select('id').eq('ofx_id', fitId).maybeSingle()
    );
    if (lanc) {
      await q(db.from('lancamentos').delete().eq('id', lanc.id));
    }
  }

  mostrarToast('Conciliação desfeita. Selecione o lançamento correto.', 'sucesso');

  // Reativa a transação na tela
  await carregarLancamentosPendentes();
  carregarConciliacao();
  transacoesOFX[i].jaImportado  = false;
  transacoesOFX[i].selecionado  = true;
  transacoesOFX[i].lancamento_id = null;
  // Tenta re-fazer o auto-match só para essa transação
  autoMatchConciliacao([transacoesOFX[i]]);
  renderizarPreviewOFX(transacoesOFX);
}

let _concilMultiplaIdx = null;

// ── Divisão por Unidade ──────────────────────────────────────
let _divisaoIdx   = null;
let _divisaoLinhas = [];

function abrirDivisaoUnidade(i) {
  _divisaoIdx = i;
  const t = transacoesOFX[i];
  document.getElementById('du-info').innerHTML = `
    <strong>${t.descricao}</strong><br>
    <span style="color:#888;">${formatarData(t.data)}</span> &nbsp;|&nbsp;
    <strong style="color:#27ae60;">${formatarMoeda(t.valor)}</strong>`;
  _divisaoLinhas = t.unidade_split?.length
    ? t.unidade_split.map(r => ({...r}))
    : [{ unidade_id: '', valor: t.valor, plano_conta_id: t.plano_conta_id || '' }];
  renderizarLinhasDivisao();
  atualizarTotalDivisao();
  document.getElementById('modal-divisao-unidade').classList.remove('hidden');
}

function renderizarLinhasDivisao() {
  const t = transacoesOFX[_divisaoIdx];
  const gruposRec  = planoContas.filter(p => p.tipo === 'receber' && !p.grupo_id);
  const subcatsRec = planoContas.filter(p => p.tipo === 'receber' &&  p.grupo_id);
  document.getElementById('du-linhas').innerHTML = _divisaoLinhas.map((linha, idx) => {
    const catOpts = '<option value="">Categoria (opc.)</option>'
      + gruposRec.flatMap(g => subcatsRec.filter(s => s.grupo_id === g.id)
          .map(s => `<option value="${s.id}" ${linha.plano_conta_id === s.id ? 'selected' : ''}>${g.nome} › ${s.nome}</option>`))
        .join('');
    const uniOpts = unidades.map(u => `<option value="${u.id}" ${linha.unidade_id === u.id ? 'selected' : ''}>${u.nome}</option>`).join('');
    return `
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap;">
        <select onchange="_divisaoLinhas[${idx}].unidade_id = this.value"
          style="flex:1.5;min-width:130px;padding:5px 8px;border:1px solid #ddd;border-radius:6px;font-size:13px;">
          <option value="">Selecione a unidade *</option>${uniOpts}
        </select>
        <select onchange="_divisaoLinhas[${idx}].plano_conta_id = this.value"
          style="flex:1.5;min-width:130px;padding:5px 8px;border:1px solid #ddd;border-radius:6px;font-size:13px;">
          ${catOpts}
        </select>
        <input type="text" inputmode="decimal" class="input-moeda"
          value="${linha.valor > 0 ? linha.valor.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}) : ''}"
          placeholder="0,00"
          oninput="_divisaoLinhas[${idx}].valor = parseMoeda(this.value); atualizarTotalDivisao()"
          style="width:100px;padding:5px 8px;border:1px solid #ddd;border-radius:6px;font-size:13px;text-align:right;">
        <button onclick="removerLinhaDivisao(${idx})"
          style="background:none;border:none;color:#e74c3c;cursor:pointer;font-size:16px;padding:2px 6px;">✕</button>
      </div>`;
  }).join('');
}

function adicionarLinhaDivisao() {
  _divisaoLinhas.push({ unidade_id: '', valor: 0, plano_conta_id: transacoesOFX[_divisaoIdx]?.plano_conta_id || '' });
  renderizarLinhasDivisao();
  atualizarTotalDivisao();
}

function removerLinhaDivisao(idx) {
  _divisaoLinhas.splice(idx, 1);
  renderizarLinhasDivisao();
  atualizarTotalDivisao();
}

function atualizarTotalDivisao() {
  const i = _divisaoIdx;
  if (i === null) return;
  const t = transacoesOFX[i];
  const soma = _divisaoLinhas.reduce((s, r) => s + (r.valor || 0), 0);
  const restante = t.valor - soma;
  const cor = Math.abs(restante) < 0.01 ? '#27ae60' : (restante < 0 ? '#e74c3c' : '#f39c12');
  const msg = Math.abs(restante) < 0.01 ? '✔ Total conferido!'
    : (restante > 0 ? `Faltam: ${formatarMoeda(restante)}` : `Excesso: ${formatarMoeda(-restante)}`);
  document.getElementById('du-total').innerHTML = `
    <span style="color:#555;">Distribuído: </span>
    <strong style="color:${cor}">${formatarMoeda(soma)}</strong>
    <span style="color:#aaa;font-size:12px;margin-left:8px;">/ ${formatarMoeda(t.valor)}</span>
    <span style="color:${cor};font-size:12px;margin-left:8px;">${msg}</span>`;
}

function confirmarDivisaoUnidade() {
  const i = _divisaoIdx;
  if (i === null) return;
  const t = transacoesOFX[i];
  if (_divisaoLinhas.some(r => !r.unidade_id || !r.valor || r.valor <= 0)) {
    mostrarToast('Selecione a unidade e informe um valor válido em cada linha.', 'erro'); return;
  }
  const soma = _divisaoLinhas.reduce((s, r) => s + r.valor, 0);
  if (Math.abs(soma - t.valor) > 0.01) {
    mostrarToast(`Total distribuído (${formatarMoeda(soma)}) deve ser igual ao valor do extrato (${formatarMoeda(t.valor)}).`, 'erro'); return;
  }
  transacoesOFX[i].unidade_split   = [..._divisaoLinhas];
  transacoesOFX[i].lancamento_id   = null;
  transacoesOFX[i].lancamentos_ids = [];
  fecharModal('modal-divisao-unidade');
  renderizarCelulaConciliacao(i);
  mostrarToast(`Receita dividida em ${_divisaoLinhas.length} unidade(s).`, 'sucesso');
}

function limparDivisaoUnidade(i) {
  transacoesOFX[i].unidade_split = null;
  renderizarCelulaConciliacao(i);
}

function filtrarDataConciliacao(i) {
  const t = transacoesOFX[i];
  const dataFiltro = document.getElementById(`filtro-data-concil-${i}`)?.value;
  let pendentes = lancamentosPendentes.filter(l => l.tipo === t.tipo);
  if (dataFiltro) pendentes = pendentes.filter(l => l.vencimento === dataFiltro || l.id === t.lancamento_id);
  const select = document.getElementById(`select-concil-${i}`);
  if (!select) return;
  const valorAtual = select.value;
  select.innerHTML = `<option value="">➕ Novo lançamento</option>`
    + pendentes.map(l => {
        const fornNome = l.fornecedores?.nome ? ` — ${l.fornecedores.nome}` : '';
        const label = `${l.descricao}${fornNome} (${formatarData(l.vencimento)}) ${formatarMoeda(Number(l.valor))}`;
        const sel = valorAtual === l.id ? 'selected' : '';
        return `<option value="${l.id}" ${sel}>${label}</option>`;
      }).join('');
}

function renderizarListaCM(dataFiltro) {
  const i = _concilMultiplaIdx;
  if (i === null) return;
  const t = transacoesOFX[i];
  const selecionados = new Set(t.lancamentos_ids || []);
  let pendentes = lancamentosPendentes.filter(l => l.tipo === t.tipo);
  if (dataFiltro) pendentes = pendentes.filter(l => l.vencimento === dataFiltro || selecionados.has(l.id));
  document.getElementById('cm-lista').innerHTML = pendentes.length
    ? pendentes.map(l => {
        const forn      = l.fornecedores?.nome ? ` — ${l.fornecedores.nome}` : '';
        const checked   = selecionados.has(l.id) ? 'checked' : '';
        const valorPago = Number(l.valor_pago || 0);
        const restante  = Number(l.valor) - valorPago;
        const valorHtml = valorPago > 0
          ? `<span style="color:#e67e22;font-size:12px;">Restante: </span><strong style="color:#e67e22;flex-shrink:0;">${formatarMoeda(restante)}</strong>`
          : `<strong style="flex-shrink:0;white-space:nowrap;">${formatarMoeda(Number(l.valor))}</strong>`;
        return `
          <label style="display:flex;align-items:flex-start;gap:10px;padding:8px 4px;border-bottom:1px solid #f0f0f0;cursor:pointer;">
            <input type="checkbox" value="${l.id}" ${checked} onchange="atualizarTotalCM()" style="margin-top:3px;flex-shrink:0;">
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;word-break:break-word;">${l.descricao}${forn}</div>
              <div style="font-size:12px;color:#888;">${formatarData(l.vencimento)}</div>
            </div>
            ${valorHtml}
          </label>`;
      }).join('')
    : '<p class="sem-dados">Nenhum lançamento encontrado para esta data.</p>';
}

function abrirConciliacaoMultipla(i) {
  _concilMultiplaIdx = i;
  const t = transacoesOFX[i];

  const grupoTag = t.agrupamento_indices?.length
    ? `&nbsp;<span style="font-size:11px;background:#d6eaf8;color:#2980b9;padding:2px 6px;border-radius:4px;"><i class="fas fa-object-group"></i> Grupo de ${1 + t.agrupamento_indices.length} lotes</span>`
    : '';
  document.getElementById('cm-info').innerHTML = `
    <strong>${t.descricao_original || t.descricao}</strong>${grupoTag}<br>
    <span style="color:#888;">${formatarData(t.data)}</span> &nbsp;|&nbsp;
    <strong style="color:${t.tipo === 'pagar' ? '#e74c3c' : '#27ae60'}">${formatarMoeda(t.valor)}</strong>`;

  const filtroEl = document.getElementById('cm-filtro-data');
  if (filtroEl) { filtroEl.value = t.data || ''; }

  const descontoEl  = document.getElementById('cm-desconto');
  const descontoWrap = document.getElementById('cm-desconto-wrap');
  const btnConfirmar = document.getElementById('btn-confirmar-cm');
  if (descontoEl)   descontoEl.value = '';
  if (descontoWrap) descontoWrap.style.display = 'none';
  if (btnConfirmar) btnConfirmar.disabled = true;

  renderizarListaCM(t.data || '');
  atualizarTotalCM();
  document.getElementById('modal-conciliacao-multipla').classList.remove('hidden');
}

function atualizarTotalCM() {
  const i = _concilMultiplaIdx;
  if (i === null) return;
  const t = transacoesOFX[i];
  const checks = document.querySelectorAll('#cm-lista input[type="checkbox"]:checked');
  const total  = Array.from(checks).reduce((s, cb) => {
    const l = lancamentosPendentes.find(l => l.id === cb.value);
    return s + (l ? Number(l.valor) : 0);
  }, 0);

  const descontoEl   = document.getElementById('cm-desconto');
  const descontoWrap = document.getElementById('cm-desconto-wrap');
  const btnConfirmar = document.getElementById('btn-confirmar-cm');
  const desconto     = descontoEl ? (parseFloat((descontoEl.value || '0').replace(/\./g, '').replace(',', '.')) || 0) : 0;
  const totalAjustado = total - desconto;
  const excede = total - t.valor;

  let htmlStatus = '';
  let podeConfirmar = false;

  if (total === 0) {
    htmlStatus = '';
    if (descontoWrap) descontoWrap.style.display = 'none';
  } else if (Math.abs(totalAjustado - t.valor) < 0.01) {
    htmlStatus = `<span style="color:#27ae60;font-weight:600;"><i class="fas fa-check-circle"></i> Valores conferem!</span>`;
    podeConfirmar = true;
    if (descontoWrap) descontoWrap.style.display = excede > 0.01 ? 'block' : 'none';
  } else if (excede > 0.01) {
    if (descontoWrap) descontoWrap.style.display = 'block';
    const difRestante = totalAjustado - t.valor;
    if (difRestante > 0.01) {
      htmlStatus = `<span style="color:#e74c3c;"><i class="fas fa-times-circle"></i> Ainda excede em ${formatarMoeda(difRestante)} — aumente o desconto</span>`;
    } else if (difRestante < -0.01) {
      htmlStatus = `<span style="color:#e74c3c;"><i class="fas fa-times-circle"></i> Desconto maior que a diferença</span>`;
    }
  } else {
    if (descontoWrap) descontoWrap.style.display = 'none';
    htmlStatus = `<span style="color:#e74c3c;"><i class="fas fa-times-circle"></i> Faltam ${formatarMoeda(t.valor - total)} — selecione mais lançamentos</span>`;
  }

  if (btnConfirmar) btnConfirmar.disabled = !podeConfirmar;

  const exibirDesconto = desconto > 0 && excede > 0.01;
  document.getElementById('cm-total').innerHTML = `
    <span style="color:#555;">Total selecionado: </span>
    <strong>${formatarMoeda(total)}</strong>
    ${exibirDesconto ? `<span style="color:#888;font-size:12px;margin-left:6px;">− ${formatarMoeda(desconto)} desc. = </span><strong>${formatarMoeda(totalAjustado)}</strong>` : ''}
    <span style="color:#aaa;font-size:12px;margin-left:8px;">/ ${formatarMoeda(t.valor)} do extrato</span>
    <span style="margin-left:8px;">${htmlStatus}</span>`;
}

function confirmarConciliacaoMultipla() {
  const i = _concilMultiplaIdx;
  if (i === null) return;
  const btn = document.getElementById('btn-confirmar-cm');
  if (btn && btn.disabled) { mostrarToast('Ajuste os valores antes de confirmar.', 'erro'); return; }
  const checks = document.querySelectorAll('#cm-lista input[type="checkbox"]:checked');
  const ids = Array.from(checks).map(cb => cb.value);
  if (!ids.length) { mostrarToast('Selecione ao menos um lançamento.', 'erro'); return; }
  const descontoEl = document.getElementById('cm-desconto');
  const desconto   = descontoEl ? (parseFloat((descontoEl.value || '0').replace(/\./g, '').replace(',', '.')) || 0) : 0;
  transacoesOFX[i].lancamentos_ids = ids;
  transacoesOFX[i].lancamento_id   = null;
  if (desconto > 0) transacoesOFX[i].desconto_cm = desconto;
  fecharModal('modal-conciliacao-multipla');
  renderizarCelulaConciliacao(i);
  mostrarToast(`${ids.length} lançamento(s) vinculado(s) com sucesso.`, 'sucesso');
}

function limparConciliacaoMultipla(i) {
  transacoesOFX[i].lancamentos_ids = [];
  renderizarCelulaConciliacao(i);
}

// ── Agrupar transações do extrato ────────────────────────────────────────────
let _agruparIdx = null;

function abrirAgrupar(i) {
  _agruparIdx = i;
  const t = transacoesOFX[i];
  document.getElementById('ag-info').innerHTML = `
    <strong>${t.descricao_original || t.descricao}</strong><br>
    <span style="color:#888;">${formatarData(t.data)}</span> &nbsp;|&nbsp;
    <strong style="color:#e74c3c;">${formatarMoeda(t.valor)}</strong>`;

  const jaAgrupados = new Set(t.agrupamento_indices || []);
  const candidatas = transacoesOFX
    .map((tx, idx) => ({ tx, idx }))
    .filter(({ tx, idx }) =>
      idx !== i &&
      tx.tipo === t.tipo &&
      tx.selecionado &&
      !tx.transferencia_destino_id &&
      tx.agrupado_em_idx === undefined &&
      !tx.agrupamento_indices?.length
    );

  document.getElementById('ag-lista').innerHTML = candidatas.length
    ? candidatas.map(({ tx, idx }) => `
        <label style="display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid #f0f0f0;cursor:pointer;">
          <input type="checkbox" value="${idx}" ${jaAgrupados.has(idx) ? 'checked' : ''}
            onchange="atualizarTotalAgrupar()" style="flex-shrink:0;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;word-break:break-word;">${tx.descricao}</div>
            <div style="font-size:12px;color:#888;">${formatarData(tx.data)}</div>
          </div>
          <strong style="color:#e74c3c;flex-shrink:0;white-space:nowrap;">${formatarMoeda(tx.valor)}</strong>
        </label>`).join('')
    : '<p class="sem-dados">Nenhuma outra transação disponível para agrupar.</p>';

  atualizarTotalAgrupar();
  document.getElementById('modal-agrupar').classList.remove('hidden');
}

function atualizarTotalAgrupar() {
  const i = _agruparIdx;
  if (i === null) return;
  const t = transacoesOFX[i];
  const checks = document.querySelectorAll('#ag-lista input[type="checkbox"]:checked');
  const somaExtras = Array.from(checks).reduce((s, cb) => {
    return s + (transacoesOFX[Number(cb.value)]?.valor || 0);
  }, 0);
  const total = t.valor + somaExtras;
  const n = 1 + checks.length;
  document.getElementById('ag-total').innerHTML =
    `Total do grupo (${n} transação${n > 1 ? 'ões' : ''}): <span style="color:#2980b9;">${formatarMoeda(total)}</span>`;
  document.getElementById('btn-confirmar-ag').disabled = checks.length === 0;
}

function confirmarAgrupar() {
  const i = _agruparIdx;
  if (i === null) return;
  const t = transacoesOFX[i];
  const checks = document.querySelectorAll('#ag-lista input[type="checkbox"]:checked');
  const indices = Array.from(checks).map(cb => Number(cb.value));
  if (!indices.length) return;

  // Limpa agrupamento anterior, se houver
  desfazerAgrupamento(i, true);

  // Salva descrição e valor originais antes de sobrescrever
  if (!t.descricao_original) t.descricao_original = t.descricao;
  if (!t.valor_original)     t.valor_original     = t.valor;

  const somaExtras = indices.reduce((s, idx) => s + (transacoesOFX[idx]?.valor || 0), 0);
  t.valor               = t.valor_original + somaExtras;
  t.descricao           = `GRUPO (${1 + indices.length} lotes): ${t.descricao_original}`;
  t.agrupamento_indices = indices;
  t.fitIds_grupo        = [
    t.fitId,
    ...indices.map(idx => transacoesOFX[idx]?.fitId).filter(Boolean)
  ];

  // Marca secundárias como absorvidas
  indices.forEach(idx => {
    if (transacoesOFX[idx]) transacoesOFX[idx].agrupado_em_idx = i;
  });

  fecharModal('modal-agrupar');
  renderizarCelulaConciliacao(i);
  indices.forEach(idx => renderizarCelulaConciliacao(idx));
  mostrarToast(`${1 + indices.length} lotes agrupados — total ${formatarMoeda(t.valor)}.`, 'sucesso');
}

function desfazerAgrupamento(i, silencioso = false) {
  const t = transacoesOFX[i];
  if (!t) return;
  // Restaura secundárias
  (t.agrupamento_indices || []).forEach(idx => {
    if (transacoesOFX[idx]) {
      delete transacoesOFX[idx].agrupado_em_idx;
      renderizarCelulaConciliacao(idx);
    }
  });
  // Restaura valores originais do primário
  if (t.valor_original !== undefined) t.valor = t.valor_original;
  if (t.descricao_original)           t.descricao = t.descricao_original;
  delete t.valor_original;
  delete t.descricao_original;
  delete t.agrupamento_indices;
  delete t.fitIds_grupo;
  t.lancamentos_ids = [];
  renderizarCelulaConciliacao(i);
  if (!silencioso) mostrarToast('Agrupamento desfeito.', 'sucesso');
}

// ── Dividir Pedido por data (comprador externo) ─────────────────────────────
// Um pedido pago em várias compras (débitos em datas diferentes) é desmembrado
// em N lançamentos — um por débito, na sua data real — com o rateio do pedido
// aplicado proporcionalmente. Resolve o caso de compras em meses diferentes.
let _dpIdx = null;
let _dpPedidoCache = {};   // lancamentoId -> { lanc, categorias:[{plano_conta_id, prop}] }

// Distribui um valor pelas proporções das categorias, ajustando o último centavo
function dpRatearValor(valor, categorias) {
  let acc = 0;
  return categorias.map((c, idx) => {
    if (idx === categorias.length - 1) return Math.round((valor - acc) * 100) / 100;
    const v = Math.round(valor * c.prop * 100) / 100;
    acc += v;
    return v;
  });
}

function dpNomeCat(id) {
  const c = planoContas.find(p => p.id === id);
  if (!c) return '—';
  const g = planoContas.find(p => p.id === c.grupo_id);
  return g ? `${g.nome} › ${c.nome}` : c.nome;
}

async function abrirDividirPedido(i) {
  _dpIdx = i;
  const t = transacoesOFX[i];

  // Candidatos: outras transações de saída selecionadas e livres — mais os
  // membros da própria divisão (caso esteja editando)
  const candidatas = transacoesOFX
    .map((tx, idx) => ({ tx, idx }))
    .filter(({ tx, idx }) =>
      idx !== i && tx.tipo === t.tipo && tx.selecionado &&
      !tx.transferencia_destino_id && tx.agrupado_em_idx === undefined &&
      (tx.dividido_em_idx === undefined || tx.dividido_em_idx === i) &&
      !tx.agrupamento_indices?.length && !tx.dividir_pedido
    );

  const jaMembros = new Set(t.dividir_indices || []);
  const linhaTx = (tx, val, marcado, fixo) => `
    <label style="display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid #f0f0f0;${fixo ? '' : 'cursor:pointer;'}">
      <input type="checkbox" ${marcado ? 'checked' : ''} ${fixo ? 'disabled' : `value="${val}" onchange="dpAtualizar()"`} style="flex-shrink:0;">
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;word-break:break-word;">${tx.descricao}</div>
        <div style="font-size:12px;color:#888;">${formatarData(tx.data)}</div>
      </div>
      <strong style="color:#e74c3c;flex-shrink:0;white-space:nowrap;">${formatarMoeda(tx.valor)}</strong>
    </label>`;

  document.getElementById('dp-lista').innerHTML =
    linhaTx(t, i, true, true) +
    candidatas.map(({ tx, idx }) => linhaTx(tx, idx, jaMembros.has(idx), false)).join('');

  const pend = lancamentosPendentes.filter(l => l.tipo === t.tipo);
  const selPed = t.dividir_pedido?.lancamentoId || '';
  document.getElementById('dp-pedido').innerHTML =
    `<option value="">Selecione o pedido...</option>` +
    pend.map(l => {
      const forn = l.fornecedores?.nome ? ` — ${l.fornecedores.nome}` : '';
      return `<option value="${l.id}" ${selPed === l.id ? 'selected' : ''}>${l.descricao}${forn} (${formatarMoeda(Number(l.valor))})</option>`;
    }).join('');

  document.getElementById('dp-preview').innerHTML = '';
  document.getElementById('dp-resumo').innerHTML = '';
  document.getElementById('btn-confirmar-dp').disabled = true;
  document.getElementById('modal-dividir-pedido').classList.remove('hidden');
  if (selPed) dpAtualizar();
}

function dpPartesSelecionadas() {
  const t = transacoesOFX[_dpIdx];
  const membros = [...document.querySelectorAll('#dp-lista input[type="checkbox"]:checked')]
    .map(cb => cb.value)
    .filter(v => v !== '' && v != null && !isNaN(Number(v)))
    .map(v => Number(v));
  return [{ idx: _dpIdx, tx: t }, ...membros.map(idx => ({ idx, tx: transacoesOFX[idx] }))];
}

async function dpAtualizar() {
  const pedidoId = document.getElementById('dp-pedido').value;
  const preview  = document.getElementById('dp-preview');
  const resumo   = document.getElementById('dp-resumo');
  const btn      = document.getElementById('btn-confirmar-dp');
  if (!pedidoId) { preview.innerHTML = ''; resumo.innerHTML = ''; btn.disabled = true; return; }

  if (!_dpPedidoCache[pedidoId]) {
    const db = obterSupabase();
    const { data: lanc } = await q(db.from('lancamentos')
      .select('id, descricao, valor, tem_rateio, plano_conta_id, fornecedor_id, unidade_id, numero_pedido')
      .eq('id', pedidoId).single());
    let categorias;
    if (lanc?.tem_rateio) {
      const { data: ri } = await q(db.from('rateio_itens').select('plano_conta_id, valor').eq('lancamento_id', pedidoId));
      const tot = (ri || []).reduce((s, r) => s + Number(r.valor), 0) || 1;
      categorias = (ri || []).map(r => ({ plano_conta_id: r.plano_conta_id, prop: Number(r.valor) / tot }));
    } else {
      categorias = [{ plano_conta_id: lanc?.plano_conta_id || null, prop: 1 }];
    }
    _dpPedidoCache[pedidoId] = { lanc, categorias };
  }
  const { lanc, categorias } = _dpPedidoCache[pedidoId];

  const partes    = dpPartesSelecionadas();
  const realTotal = partes.reduce((s, p) => s + Number(p.tx.valor), 0);
  const estimado  = Number(lanc.valor);
  const variacao  = realTotal - estimado;

  const head = `<tr><th style="text-align:left;padding:7px 9px;">Parte / data</th><th style="text-align:right;padding:7px 9px;">Valor</th>` +
    categorias.map(c => `<th style="text-align:right;padding:7px 9px;">${dpNomeCat(c.plano_conta_id).split('›').pop().trim()}</th>`).join('') + `</tr>`;
  const rows = partes.map(p => {
    const v = Number(p.tx.valor);
    const cats = dpRatearValor(v, categorias);
    return `<tr><td style="text-align:left;padding:7px 9px;"><strong>${formatarData(p.tx.data)}</strong></td>` +
      `<td style="text-align:right;padding:7px 9px;font-weight:600;">${formatarMoeda(v)}</td>` +
      cats.map(cv => `<td style="text-align:right;padding:7px 9px;color:#555;">${formatarMoeda(cv)}</td>`).join('') + `</tr>`;
  }).join('');
  preview.innerHTML = `<div style="overflow-x:auto;border:1px solid #eee;border-radius:8px;">
    <table style="width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums;">
      <thead style="background:#f8f9fa;color:#666;">${head}</thead><tbody>${rows}</tbody></table></div>`;

  const corVar = Math.abs(variacao) < 0.01 ? '#888' : (variacao > 0 ? '#e67e22' : '#27ae60');
  resumo.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap;font-size:12px;">
    <div style="flex:1;min-width:110px;background:#f8f9fa;border-radius:8px;padding:8px 10px;"><div style="color:#888;">Estimado</div><strong>${formatarMoeda(estimado)}</strong></div>
    <div style="flex:1;min-width:110px;background:#eafaf1;border-radius:8px;padding:8px 10px;"><div style="color:#888;">Real (extrato)</div><strong style="color:#27ae60;">${formatarMoeda(realTotal)}</strong></div>
    <div style="flex:1;min-width:110px;background:#fef9e7;border-radius:8px;padding:8px 10px;"><div style="color:#888;">Variação</div><strong style="color:${corVar};">${variacao >= 0 ? '+' : ''}${formatarMoeda(variacao)}</strong></div>
  </div>`;

  btn.disabled = partes.length < 2;
}

function confirmarDividirPedido() {
  const t = transacoesOFX[_dpIdx];
  const pedidoId = document.getElementById('dp-pedido').value;
  if (!pedidoId) { mostrarToast('Selecione o pedido.', 'erro'); return; }
  const cache = _dpPedidoCache[pedidoId];
  if (!cache) return;
  const partes = dpPartesSelecionadas();
  if (partes.length < 2) { mostrarToast('Selecione ao menos 2 débitos para dividir.', 'erro'); return; }

  desfazerDividirPedido(_dpIdx, true);   // limpa divisão anterior deste líder

  const indices = partes.filter(p => p.idx !== _dpIdx).map(p => p.idx);
  t.dividir_pedido = {
    lancamentoId:  pedidoId,
    numero_pedido: cache.lanc.numero_pedido || null,
    descricao:     cache.lanc.descricao || '',
    fornecedor_id: cache.lanc.fornecedor_id || null,
    unidade_id:    cache.lanc.unidade_id || null,
    valorEstimado: Number(cache.lanc.valor),
    categorias:    cache.categorias,
  };
  t.dividir_indices = indices;
  t.lancamento_id = null;
  t.lancamentos_ids = [];
  indices.forEach(idx => {
    if (transacoesOFX[idx]) {
      transacoesOFX[idx].dividido_em_idx = _dpIdx;
      transacoesOFX[idx].lancamento_id   = null;
      transacoesOFX[idx].lancamentos_ids = [];
    }
  });

  fecharModal('modal-dividir-pedido');
  renderizarCelulaConciliacao(_dpIdx);
  indices.forEach(idx => renderizarCelulaConciliacao(idx));
  mostrarToast(`Pedido dividido em ${partes.length} partes por data.`, 'sucesso');
}

function desfazerDividirPedido(i, silencioso = false) {
  const t = transacoesOFX[i];
  if (!t) return;
  (t.dividir_indices || []).forEach(idx => {
    if (transacoesOFX[idx]) { delete transacoesOFX[idx].dividido_em_idx; renderizarCelulaConciliacao(idx); }
  });
  delete t.dividir_pedido;
  delete t.dividir_indices;
  renderizarCelulaConciliacao(i);
  if (!silencioso) mostrarToast('Divisão desfeita.', 'sucesso');
}

// ── Dar Baixa com Desconto (pagamento parcial) ─────────────────────────────
let _baixaDescontoId = null;

async function darBaixaComDesconto(id) {
  const db = obterSupabase();
  const { data: l } = await db.from('lancamentos').select('descricao, valor, valor_pago').eq('id', id).single();
  if (!l) return;
  _baixaDescontoId   = id;
  const valorPago    = Number(l.valor_pago || 0);
  const restante     = Number(l.valor) - valorPago;
  document.getElementById('bd-descricao').textContent  = l.descricao;
  document.getElementById('bd-valor-total').textContent = formatarMoeda(Number(l.valor));
  document.getElementById('bd-valor-pago').textContent  = formatarMoeda(valorPago);
  document.getElementById('bd-restante').textContent    = formatarMoeda(restante);
  document.getElementById('bd-desconto').value          = restante.toFixed(2).replace('.', ',');
  atualizarBaixaDesconto();
  document.getElementById('modal-baixa-desconto').classList.remove('hidden');
}

function atualizarBaixaDesconto() {
  const id = _baixaDescontoId;
  if (!id) return;
  const descontoEl = document.getElementById('bd-desconto');
  const btnConfirmar = document.getElementById('btn-confirmar-baixa');
  const msgEl = document.getElementById('bd-msg');
  const desconto = parseFloat((descontoEl?.value || '0').replace(/\./g, '').replace(',', '.')) || 0;
  const restanteEl = document.getElementById('bd-restante');
  const restante = parseFloat((restanteEl?.textContent || '0').replace('R$', '').replace(/\./g, '').replace(',', '.').trim()) || 0;
  const dif = Math.abs(desconto - restante);
  if (dif < 0.01) {
    msgEl.innerHTML = `<span style="color:#27ae60;"><i class="fas fa-check-circle"></i> Desconto cobre o saldo restante. Conta será encerrada.</span>`;
    if (btnConfirmar) btnConfirmar.disabled = false;
  } else if (desconto < restante) {
    const sobra = restante - desconto;
    msgEl.innerHTML = `<span style="color:#f39c12;"><i class="fas fa-exclamation-triangle"></i> Ainda restará ${formatarMoeda(sobra)} em aberto após o desconto.</span>`;
    if (btnConfirmar) btnConfirmar.disabled = false;
  } else {
    msgEl.innerHTML = `<span style="color:#e74c3c;"><i class="fas fa-times-circle"></i> Desconto maior que o saldo restante.</span>`;
    if (btnConfirmar) btnConfirmar.disabled = true;
  }
}

async function confirmarBaixaDesconto() {
  if (!await garantirSessao()) return;
  const id = _baixaDescontoId;
  if (!id) return;
  const btn = document.getElementById('btn-confirmar-baixa');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Aguarde...'; }
  try {
    const db      = obterSupabase();
    const hoje    = new Date().toISOString().split('T')[0];
    const descontoEl = document.getElementById('bd-desconto');
    const desconto   = parseFloat((descontoEl?.value || '0').replace(/\./g, '').replace(',', '.')) || 0;
    const { data: l } = await db.from('lancamentos').select('valor, valor_pago').eq('id', id).single();
    const valorPago   = Number(l?.valor_pago || 0);
    const novoValorPago = valorPago + desconto;
    const { error } = await q(db.from('lancamentos').update({
      status: 'pago',
      data_pagamento: hoje,
      valor_pago: novoValorPago
    }).eq('id', id));
    if (error) throw error;
    await q(db.from('pagamentos').insert({
      lancamento_id: id,
      valor:         desconto,
      data:          hoje,
      origem:        'desconto'
    }));
    fecharModal('modal-baixa-desconto');
    mostrarToast('Baixa realizada com sucesso!', 'sucesso');
    carregarLancamentos('pagar');
    carregarDashboard();
  } catch (e) {
    mostrarToast('Erro ao dar baixa. Tente novamente.', 'erro');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Confirmar Baixa'; }
  }
}

// ── Registrar Pagamento Parcial ────────────────────────────────────────────
let _registroPagamentoId = null;

async function registrarPagamento(id) {
  const db = obterSupabase();
  const { data: l } = await db.from('lancamentos').select('descricao, valor, valor_pago, plano_conta_id').eq('id', id).single();
  if (!l) return;
  _registroPagamentoId = id;
  const valorPago  = Number(l.valor_pago || 0);
  const restante   = Number(l.valor) - valorPago;
  document.getElementById('rp-descricao').textContent   = l.descricao;
  document.getElementById('rp-valor-total').textContent = formatarMoeda(Number(l.valor));
  document.getElementById('rp-valor-pago').textContent  = formatarMoeda(valorPago);
  document.getElementById('rp-restante').textContent    = formatarMoeda(restante);
  document.getElementById('rp-valor').value             = restante.toFixed(2).replace('.', ',');
  document.getElementById('rp-data').value              = new Date().toISOString().split('T')[0];
  const selBanco = document.getElementById('rp-banco');
  selBanco.innerHTML = '<option value="">Selecione a conta...</option>' +
    bancosCadastrados.map(b => `<option value="${b.id}">${b.nome}${b.conta ? ' (' + b.conta + ')' : ''}</option>`).join('');
  const selCat = document.getElementById('rp-plano-conta');
  const pagarCats = planoContas.filter(p => p.tipo === 'pagar' || !p.tipo);
  selCat.innerHTML = '<option value="">Manter categoria atual</option>' +
    pagarCats.map(p => `<option value="${p.id}" ${p.id === l.plano_conta_id ? 'selected' : ''}>${p.nome}</option>`).join('');
  document.getElementById('rp-msg').innerHTML = '';
  document.getElementById('btn-confirmar-rp').disabled = false;
  document.getElementById('modal-registrar-pagamento').classList.remove('hidden');
}

function atualizarRegistroPagamento() {
  const msgEl    = document.getElementById('rp-msg');
  const btnEl    = document.getElementById('btn-confirmar-rp');
  const valorEl  = document.getElementById('rp-valor');
  const restEl   = document.getElementById('rp-restante');
  const valor    = parseFloat((valorEl?.value || '0').replace(/\./g, '').replace(',', '.')) || 0;
  const restante = parseFloat((restEl?.textContent || '0').replace('R$', '').replace(/\./g, '').replace(',', '.').trim()) || 0;
  if (valor <= 0) {
    msgEl.innerHTML = `<span style="color:#e74c3c;">Informe um valor maior que zero.</span>`;
    btnEl.disabled = true;
  } else if (valor > restante + 0.01) {
    msgEl.innerHTML = `<span style="color:#e74c3c;"><i class="fas fa-times-circle"></i> Valor maior que o saldo restante (${formatarMoeda(restante)}).</span>`;
    btnEl.disabled = true;
  } else if (Math.abs(valor - restante) < 0.01) {
    msgEl.innerHTML = `<span style="color:#27ae60;"><i class="fas fa-check-circle"></i> Pagamento completo — conta será encerrada.</span>`;
    btnEl.disabled = false;
  } else {
    msgEl.innerHTML = `<span style="color:#f39c12;"><i class="fas fa-exclamation-triangle"></i> Pagamento parcial — restará ${formatarMoeda(restante - valor)} em aberto.</span>`;
    btnEl.disabled = false;
  }
}

async function confirmarRegistroPagamento() {
  if (!await garantirSessao()) return;
  const id = _registroPagamentoId;
  if (!id) return;
  const bancoId = document.getElementById('rp-banco')?.value;
  if (!bancoId) { mostrarToast('Selecione a conta de pagamento.', 'erro'); return; }
  const valorEl = document.getElementById('rp-valor');
  const valor   = parseFloat((valorEl?.value || '0').replace(/\./g, '').replace(',', '.')) || 0;
  if (valor <= 0) { mostrarToast('Informe um valor válido.', 'erro'); return; }
  const data = document.getElementById('rp-data')?.value || new Date().toISOString().split('T')[0];
  const btn  = document.getElementById('btn-confirmar-rp');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Aguarde...'; }
  try {
    const db = obterSupabase();
    const { data: l } = await db.from('lancamentos').select('valor, valor_pago').eq('id', id).single();
    const valorPagoAtual    = Number(l?.valor_pago || 0);
    const valorTotal        = Number(l?.valor || 0);
    const novoValorPago     = valorPagoAtual + valor;
    const pagamentoCompleto = novoValorPago >= valorTotal - 0.01;
    const planoConta = document.getElementById('rp-plano-conta')?.value || null;
    const updDados = {
      valor_pago: novoValorPago,
      banco_id:   bancoId,
      ...(planoConta ? { plano_conta_id: planoConta } : {}),
      ...(pagamentoCompleto ? { status: 'pago', data_pagamento: data } : {})
    };
    const { error } = await q(db.from('lancamentos').update(updDados).eq('id', id))
    if (error) throw error;
    await q(db.from('pagamentos').insert({
      lancamento_id:  id,
      valor:          valor,
      data:           data,
      banco_id:       bancoId,
      plano_conta_id: planoConta || null,
      origem:         'manual'
    }));
    fecharModal('modal-registrar-pagamento');
    mostrarToast(pagamentoCompleto ? 'Pagamento registrado — conta encerrada!' : 'Pagamento parcial registrado!', 'sucesso');
    carregarLancamentos('pagar');
    carregarDashboard();
  } catch (e) {
    mostrarToast('Erro ao registrar pagamento. Tente novamente.', 'erro');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Confirmar Pagamento'; }
  }
}

// ── Histórico de Pagamentos ────────────────────────────────────────────────
async function verHistoricoPagamentos(id) {
  const db = obterSupabase();
  const [{ data: lanc }, { data: pagtos }] = await Promise.all([
    db.from('lancamentos').select('descricao, valor, valor_pago, status, tipo').eq('id', id).single(),
    db.from('pagamentos')
      .select('id, valor, data, plano_conta_id, bancos(nome), plano_contas(nome), origem')
      .eq('lancamento_id', id)
      .order('data', { ascending: true })
  ]);
  _hpCtx = { lancamentoId: id, tipo: lanc?.tipo || 'pagar' };
  document.getElementById('hp-descricao').textContent   = lanc?.descricao || '';
  document.getElementById('hp-valor-total').textContent = formatarMoeda(Number(lanc?.valor || 0));
  _hpRenderTabela(pagtos || [], lanc);
  document.getElementById('modal-historico-pagamentos').classList.remove('hidden');
}

function _hpRenderTabela(pagtos, lanc) {
  const origemLabel = { manual: 'Manual', ofx: 'OFX', desconto: 'Desconto/Baixa' };
  const origemCor   = { manual: { bg:'#eafaf1', txt:'#1a6e3b' }, ofx: { bg:'#eaf4fd', txt:'#2980b9' }, desconto: { bg:'#fff3cd', txt:'#b7770d' } };
  if (!pagtos.length) {
    document.getElementById('hp-tabela').innerHTML = `<tr><td colspan="6" class="sem-dados">Nenhum pagamento registrado ainda.</td></tr>`;
  } else {
    document.getElementById('hp-tabela').innerHTML = pagtos.map(p => {
      const cor = origemCor[p.origem] || { bg:'#f0f0f0', txt:'#555' };
      const podeAgir = p.origem === 'ofx';
      const acoes = podeAgir ? `
        <button onclick="hpEditarCategoria('${p.id}','${p.plano_conta_id||''}')"
          style="background:none;border:none;cursor:pointer;padding:2px 5px;color:#2980b9;" title="Editar categoria">
          <i class="fas fa-tag"></i>
        </button>
        <button onclick="hpDesfazerConciliacao('${p.id}',${Number(p.valor)})"
          style="background:none;border:none;cursor:pointer;padding:2px 5px;color:#e74c3c;" title="Desfazer conciliação">
          <i class="fas fa-unlink"></i>
        </button>` : '<span style="color:#bbb;font-size:11px;">—</span>';
      return `<tr id="hp-row-${p.id}">
        <td>${formatarData(p.data)}</td>
        <td style="text-align:right;"><strong>${formatarMoeda(Number(p.valor))}</strong></td>
        <td>${p.bancos?.nome || '-'}</td>
        <td id="hp-cat-${p.id}">${p.plano_contas?.nome || '-'}</td>
        <td><span style="font-size:11px;padding:2px 8px;border-radius:10px;background:${cor.bg};color:${cor.txt};font-weight:600;">${origemLabel[p.origem] || p.origem}</span></td>
        <td style="white-space:nowrap;">${acoes}</td>
      </tr>`;
    }).join('');
  }
  if (lanc) {
    const valorPago = Number(lanc.valor_pago || 0);
    const restante  = Number(lanc.valor || 0) - valorPago;
    document.getElementById('hp-status').innerHTML = lanc.status === 'pago'
      ? `<span style="color:#27ae60;font-weight:600;"><i class="fas fa-check-circle"></i> Pago integralmente — ${formatarMoeda(valorPago)}</span>`
      : `<span style="color:#e67e22;font-weight:600;"><i class="fas fa-coins"></i> Pago: ${formatarMoeda(valorPago)} — Restante: ${formatarMoeda(restante)}</span>`;
  }
}

function hpEditarCategoria(pagamentoId, planoAtualId) {
  const cell = document.getElementById(`hp-cat-${pagamentoId}`);
  if (!cell) return;
  const grupos  = planoContas.filter(p => p.tipo === _hpCtx.tipo && !p.grupo_id);
  const subcats = planoContas.filter(p => p.tipo === _hpCtx.tipo &&  p.grupo_id);
  const opts = grupos.map(g => {
    const filhos = subcats.filter(s => s.grupo_id === g.id);
    if (!filhos.length) return '';
    return `<optgroup label="${g.nome}">${filhos.map(s =>
      `<option value="${s.id}" ${s.id === planoAtualId ? 'selected' : ''}>${s.nome}</option>`
    ).join('')}</optgroup>`;
  }).join('');
  cell.innerHTML = `
    <div style="display:flex;gap:4px;align-items:center;">
      <select id="hp-select-cat-${pagamentoId}" style="font-size:12px;padding:2px 4px;border:1px solid #ddd;border-radius:4px;max-width:160px;">
        <option value="">— categoria —</option>${opts}
      </select>
      <button onclick="hpConfirmarCategoria('${pagamentoId}')"
        style="background:#2980b9;color:#fff;border:none;border-radius:4px;padding:2px 7px;cursor:pointer;font-size:12px;">✓</button>
      <button onclick="verHistoricoPagamentos('${_hpCtx.lancamentoId}')"
        style="background:none;border:none;cursor:pointer;color:#888;font-size:13px;">✕</button>
    </div>`;
}

async function hpConfirmarCategoria(pagamentoId) {
  const sel = document.getElementById(`hp-select-cat-${pagamentoId}`);
  const novoId = sel?.value;
  if (!novoId) { mostrarToast('Selecione uma categoria.', 'erro'); return; }
  const db = obterSupabase();
  const [r1, r2] = await Promise.all([
    q(db.from('pagamentos').update({ plano_conta_id: novoId }).eq('id', pagamentoId)),
    q(db.from('lancamentos').update({ plano_conta_id: novoId }).eq('id', _hpCtx.lancamentoId))
  ]);
  if (r1.error || r2.error) { mostrarToast('Erro ao salvar categoria.', 'erro'); return; }
  mostrarToast('Categoria atualizada!', 'sucesso');
  verHistoricoPagamentos(_hpCtx.lancamentoId);
}

async function hpDesfazerConciliacao(pagamentoId, valorPagamento) {
  if (!confirm(`Desfazer a conciliação deste pagamento de ${formatarMoeda(valorPagamento)}?\nO lançamento voltará para Pendente.`)) return;
  const db = obterSupabase();
  const { error: errDel } = await q(db.from('pagamentos').delete().eq('id', pagamentoId));
  if (errDel) { mostrarToast('Erro ao remover pagamento.', 'erro'); return; }

  // Recalcula valor_pago com base nos pagamentos restantes
  const { data: restantes } = await q(db.from('pagamentos').select('valor').eq('lancamento_id', _hpCtx.lancamentoId));
  const novoValorPago = (restantes || []).reduce((s, p) => s + Number(p.valor), 0);

  const upd = novoValorPago > 0
    ? { valor_pago: novoValorPago }
    : { valor_pago: 0, status: 'pendente', data_pagamento: null, ofx_id: null };
  await q(db.from('lancamentos').update(upd).eq('id', _hpCtx.lancamentoId));

  mostrarToast('Conciliação desfeita. Lançamento voltou para Pendente.', 'sucesso');
  fecharModal('modal-historico-pagamentos');
  await carregarLancamentosPendentes();
  carregarDashboard();
  carregarConciliacao();
}

// Desfazer conciliação direto da lista de Contas a Pagar/Receber (link ao lado
// de "Extrato conciliado"). Reaproveita a mesma lógica do histórico: remove os
// pagamentos vindos do extrato, limpa o ofx_id e volta o lançamento a pendente.
async function desfazerConciliacaoLista(id, tipo) {
  if (!confirm('Desfazer a conciliação com o extrato?\n\nO lançamento perde o vínculo com o banco e volta para PENDENTE, pronto para reconciliar. O pagamento em si não é apagado do sistema — só o vínculo com o extrato.')) return;
  if (!(await garantirSessao())) return;
  const db = obterSupabase();

  // Remove os pagamentos vindos do extrato (origem ofx) deste lançamento
  const { error: errDel } = await q(db.from('pagamentos').delete().eq('lancamento_id', id).eq('origem', 'ofx'));
  if (errDel) { mostrarToast('Erro ao desfazer conciliação.', 'erro'); return; }

  // Recalcula valor_pago com base em pagamentos que sobraram (ex: baixas manuais)
  const { data: restantes } = await q(db.from('pagamentos').select('valor').eq('lancamento_id', id));
  const novoValorPago = (restantes || []).reduce((s, p) => s + Number(p.valor), 0);

  const upd = { valor_pago: novoValorPago, status: 'pendente', data_pagamento: null, ofx_id: null };
  const { error: errUpd } = await q(db.from('lancamentos').update(upd).eq('id', id));
  if (errUpd) { mostrarToast('Erro ao atualizar o lançamento.', 'erro'); return; }

  mostrarToast('Conciliação desfeita. Lançamento pronto para reconciliar.', 'sucesso');
  carregarLancamentos(tipo);
  carregarLancamentosPendentes();
  carregarDashboard();
}

function abrirTransferencia(i) {
  const cell = document.getElementById(`concil-cell-${i}`);
  if (!cell) return;
  const t = transacoesOFX[i];
  const origemId = document.getElementById('banco-importar')?.value;
  const outros = bancosCadastrados.filter(b => b.id !== origemId);
  const opts = outros.map(b =>
    `<option value="${b.id}">${b.nome}${b.conta ? ' (' + b.conta + ')' : ''}</option>`
  ).join('');
  const labelBanco = t.tipo === 'pagar'
    ? 'Para qual conta foi? (destino)'
    : 'De qual conta veio? (origem)';
  cell.innerHTML = `
    <div style="font-size:11px;color:#3498db;margin-bottom:4px;font-weight:600;">
      <i class="fas fa-exchange-alt"></i> ${labelBanco}
    </div>
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
      <select id="transf-sel-${i}" class="input-ofx-cat" style="flex:1;min-width:140px;">
        <option value="">Selecione o banco...</option>
        ${opts}
      </select>
      <button class="btn btn-primary btn-sm" onclick="confirmarTransferencia(${i})">
        <i class="fas fa-check"></i>
      </button>
      <button class="btn btn-outline btn-sm" onclick="renderizarCelulaConciliacao(${i})">✕</button>
    </div>`;
}

function confirmarTransferencia(i) {
  const sel = document.getElementById(`transf-sel-${i}`);
  if (!sel?.value) { mostrarToast('Selecione a conta destino.', 'erro'); return; }
  transacoesOFX[i].transferencia_destino_id = sel.value;
  transacoesOFX[i].lancamento_id            = null;
  transacoesOFX[i].lancamentos_ids          = [];
  renderizarCelulaConciliacao(i);
}

function limparTransferencia(i) {
  transacoesOFX[i].transferencia_destino_id = null;
  renderizarCelulaConciliacao(i);
}

function selecionarTodosOFX(selecionado) {
  transacoesOFX.forEach(t => t.selecionado = selecionado);
  document.querySelectorAll('#tbody-importar input[type="checkbox"]')
    .forEach(cb => cb.checked = selecionado);
  const cbTodos = document.getElementById('cb-todos-ofx');
  if (cbTodos) cbTodos.checked = selecionado;
}

async function importarTransacoes() {
  const btn = document.getElementById('btn-importar-ofx');
  const restaurarBtn = () => {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Importar Selecionados'; }
  };

  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importando...'; }

  if (!await garantirSessao()) { restaurarBtn(); return; }

  const bancoId      = document.getElementById('banco-importar').value || null;
  // Transações absorvidas por um grupo ou por uma divisão de pedido são
  // processadas pela transação principal (não entram sozinhas)
  const selecionadas = transacoesOFX.filter(t => t.selecionado && t.agrupado_em_idx === undefined && t.dividido_em_idx === undefined);

  if (!bancoId) { mostrarToast('Selecione o banco antes de importar!', 'erro'); restaurarBtn(); return; }
  if (!selecionadas.length) { mostrarToast('Selecione ao menos uma transação!', 'erro'); restaurarBtn(); return; }

  try {

  const db     = obterSupabase();
  const aTransferencias  = selecionadas.filter(t => t.transferencia_destino_id);
  const aDividirPedido   = selecionadas.filter(t => t.dividir_pedido);
  const aDividirUnidade  = selecionadas.filter(t => !t.transferencia_destino_id && !t.dividir_pedido && t.unidade_split?.length > 0);
  const aMultiplos       = selecionadas.filter(t => !t.transferencia_destino_id && !t.dividir_pedido && !t.unidade_split?.length && t.lancamentos_ids?.length > 0);
  const aConciliar       = selecionadas.filter(t => !t.transferencia_destino_id && !t.dividir_pedido && !t.unidade_split?.length && t.lancamento_id && !t.lancamentos_ids?.length);
  const aCriar           = selecionadas.filter(t => !t.transferencia_destino_id && !t.dividir_pedido && !t.unidade_split?.length && !t.lancamento_id && !t.lancamentos_ids?.length);
  let erros = 0;

  // ── Guardião de duplicata ────────────────────────────────────────────────
  // Antes de criar lançamentos novos, reconsulta os pendentes FRESCOS no banco.
  // A lista em cache (lancamentosPendentes) pode estar velha se um pedido foi
  // aprovado no financeiro depois que a tela de importação foi aberta — foi o
  // que gerou a duplicata do Pedido #00316. Só alerta sobre pendentes de mesmo
  // valor+tipo que AINDA NÃO estão sendo vinculados por outra transação deste
  // lote (senão dá falso positivo quando duas pessoas têm o mesmo valor).
  if (aCriar.length) {
    const idsJaVinculados = new Set();
    aConciliar.forEach(t => idsJaVinculados.add(t.lancamento_id));
    aMultiplos.forEach(t => (t.lancamentos_ids || []).forEach(id => idsJaVinculados.add(id)));

    const valores = [...new Set(aCriar.map(t => t.valor))];
    const tipos   = [...new Set(aCriar.map(t => t.tipo))];
    const { data: pendFresco } = await db.from('lancamentos')
      .select('id, descricao, valor, vencimento, tipo')
      .eq('status', 'pendente')
      .in('tipo', tipos)
      .in('valor', valores);
    const usadosGuard = new Set();
    const colisoes = [];
    for (const t of aCriar) {
      const match = (pendFresco || []).find(l =>
        !idsJaVinculados.has(l.id) &&
        !usadosGuard.has(l.id) &&
        l.tipo === t.tipo &&
        Math.abs(Number(l.valor) - t.valor) < 0.01 &&
        l.vencimento <= t.data
      );
      if (match) { usadosGuard.add(match.id); colisoes.push({ t, match }); }
    }
    if (colisoes.length) {
      const lista = colisoes.slice(0, 8).map(c =>
        `• ${formatarMoeda(c.t.valor)}\n   extrato: "${c.t.descricao}"\n   conta pendente: "${c.match.descricao}" (venc. ${formatarData(c.match.vencimento)})`
      ).join('\n\n');
      const extra = colisoes.length > 8 ? `\n\n…e mais ${colisoes.length - 8}.` : '';
      const ok = confirm(
        `Atenção: ${colisoes.length} transação(ões) marcada(s) para criar NOVO lançamento têm conta pendente de mesmo valor:\n\n` +
        `${lista}${extra}\n\n` +
        `Se for o MESMO pagamento, cancele e vincule à conta pendente. ` +
        `Se forem pagamentos diferentes com valor igual, clique em Criar.\n\n` +
        `Criar mesmo assim?`
      );
      if (!ok) {
        // Atualiza a lista de pendentes SEM refazer o auto-match, para não
        // desfazer as escolhas manuais que o usuário acabou de fazer.
        await carregarLancamentosPendentes();
        renderizarPreviewOFX(transacoesOFX);
        restaurarBtn();
        mostrarToast('Importação pausada. Vincule as contas destacadas e confirme novamente.');
        return;
      }
    }
  }

  // Transferências entre contas
  for (const t of aTransferencias) {
    const origemId  = t.tipo === 'pagar'   ? bancoId : t.transferencia_destino_id;
    const destinoId = t.tipo === 'pagar'   ? t.transferencia_destino_id : bancoId;
    const { error } = await q(db.from('transferencias').insert([{
      banco_origem_id:  origemId,
      banco_destino_id: destinoId,
      valor:            t.valor,
      data:             t.data,
      descricao:        t.descricao || null
    }]));
    if (error) erros++;
  }

  // Divisão por unidade: cria um lançamento por unidade
  for (const t of aDividirUnidade) {
    for (const split of t.unidade_split) {
      const { error } = await q(db.from('lancamentos').insert({
        descricao:      t.descricao,
        valor:          split.valor,
        vencimento:     t.data,
        data_pagamento: t.data,
        status:         'pago',
        tipo:           'receber',
        plano_conta_id: split.plano_conta_id || t.plano_conta_id || null,
        banco_id:       bancoId,
        ofx_id:         t.fitId || null,
        unidade_id:     split.unidade_id || null
      }));
      if (error) erros++;
    }
  }

  // Conciliação múltipla: marca todas as contas vinculadas como pagas
  // Se for um grupo de lotes, distribui os ofx_ids para evitar reimportação de todos os lotes
  for (const t of aMultiplos) {
    const debitos   = debitosDaTransacaoOFX(t);
    const fitIdsRef = debitos.map(d => d.fitId).filter(Boolean);
    const lancIds   = t.lancamentos_ids;
    // Marca cada lançamento como pago (ofx_id de referência = um dos débitos).
    for (let j = 0; j < lancIds.length; j++) {
      const ofxIdRef = fitIdsRef.length ? fitIdsRef[j % fitIdsRef.length] : null;
      const { error } = await db.from('lancamentos')
        .update({ status: 'pago', data_pagamento: t.data, banco_id: bancoId, ofx_id: ofxIdRef })
        .eq('id', lancIds[j]);
      if (error) erros++;
    }
    if (lancIds.length === 1 && debitos.length > 1) {
      // 1 lançamento pago por VÁRIOS débitos (grupo de lotes): grava 1 pagamento
      // por débito, cada um com seu ofx_id. Antes só o 1º FITID era gravado e os
      // demais reapareciam soltos no reimport.
      const lancId  = lancIds[0];
      const planoId = lancamentosPendentes.find(l => l.id === lancId)?.plano_conta_id || null;
      for (const d of debitos) {
        await q(db.from('pagamentos').insert({
          lancamento_id:  lancId,
          valor:          d.valor,
          data:           t.data,
          banco_id:       bancoId,
          plano_conta_id: planoId,
          origem:         'ofx',
          ofx_id:         d.fitId
        }));
      }
    } else {
      // Demais casos: 1 pagamento por lançamento (comportamento original).
      for (let j = 0; j < lancIds.length; j++) {
        const lancRef = lancamentosPendentes.find(l => l.id === lancIds[j]);
        await q(db.from('pagamentos').insert({
          lancamento_id:  lancIds[j],
          valor:          Number(lancRef?.valor || 0),
          data:           t.data,
          banco_id:       bancoId,
          plano_conta_id: lancRef?.plano_conta_id || null,
          origem:         'ofx',
          ofx_id:         fitIdsRef.length ? fitIdsRef[j % fitIdsRef.length] : null
        }));
      }
    }
  }

  // Conciliação simples: agrupa por lançamento (vários OFX podem apontar para o mesmo),
  // acumula valor_pago e marca como pago apenas quando atinge o total
  const concilPorLanc = new Map();
  for (const t of aConciliar) {
    const lancRef = lancamentosPendentes.find(l => l.id === t.lancamento_id);
    if (!lancRef?.valor) { erros++; continue; }
    if (!concilPorLanc.has(t.lancamento_id)) {
      concilPorLanc.set(t.lancamento_id, {
        valorTotal:      Number(lancRef.valor),
        valorPagoAtual:  Number(lancRef.valor_pago || 0),
        somaOFX:         0,
        ofxId:           null,
        tipo:            t.tipo,
        data:            t.data,
        centroCustoId:   null,
        planoContaId:    lancRef.plano_conta_id || null,
        unidadeId:       t.unidade_id || null
      });
    }
    const entry = concilPorLanc.get(t.lancamento_id);
    entry.somaOFX += t.valor;
    entry.ofxId    = t.fitId || null;
    (entry.debitos = entry.debitos || []).push(...debitosDaTransacaoOFX(t));
    if (t.tipo === 'pagar' && t.centro_custo_id) entry.centroCustoId = t.centro_custo_id;
    if (t.unidade_id) entry.unidadeId = t.unidade_id;
    if (t.ajuste_tipo && t.ajuste_valor > 0) {
      entry.ajuste_tipo  = t.ajuste_tipo;
      entry.ajuste_valor = t.ajuste_valor;
    }
  }
  for (const [lancId, entry] of concilPorLanc) {
    const desconto  = entry.ajuste_tipo === 'desconto'  ? (entry.ajuste_valor || 0) : 0;
    const acrescimo = entry.ajuste_tipo === 'acrescimo' ? (entry.ajuste_valor || 0) : 0;
    const novoValorPago = entry.valorPagoAtual + entry.somaOFX;
    // Pagamento completo: OFX + desconto - juros deve cobrir o valor original
    const valorEfetivo  = novoValorPago + desconto - acrescimo;
    const pagamentoCompleto = valorEfetivo >= entry.valorTotal - 0.01;
    // Atualiza valor para refletir o total real pago (nota + acrescimo - desconto)
    const novoValor = entry.valorTotal + acrescimo - desconto;
    const updDados = {
      valor_pago: novoValorPago,
      ofx_id:     entry.ofxId,
      banco_id:   bancoId,
      ...(novoValor !== entry.valorTotal ? { valor: novoValor } : {}),
      ...(desconto   > 0 ? { desconto }   : {}),
      ...(acrescimo  > 0 ? { acrescimo }  : {}),
      ...(pagamentoCompleto ? { status: 'pago', data_pagamento: entry.data } : {})
    };
    if (entry.tipo === 'pagar' && entry.centroCustoId) updDados.centro_custo_id = entry.centroCustoId;
    if (entry.unidadeId) updDados.unidade_id = entry.unidadeId;
    const { error } = await q(db.from('lancamentos').update(updDados).eq('id', lancId))
    if (error) { erros++; continue; }
    // Grava 1 pagamento por débito do extrato (expandindo grupos de lotes), cada um
    // com seu ofx_id — garante que todo FITID consumido fique registrado e seja
    // reconhecido no reimport. Antes gravava 1 pagamento só, com 1 FITID.
    const debitosConcil = (entry.debitos && entry.debitos.length)
      ? entry.debitos
      : [{ fitId: entry.ofxId, valor: entry.somaOFX }];
    for (const d of debitosConcil) {
      await q(db.from('pagamentos').insert({
        lancamento_id:  lancId,
        valor:          d.valor,
        data:           entry.data,
        banco_id:       bancoId,
        plano_conta_id: entry.planoContaId || null,
        origem:         'ofx',
        ofx_id:         d.fitId
      }));
    }
  }

  // Dividir Pedido: desmembra 1 pedido em N lançamentos (um por débito/data),
  // com o rateio do pedido aplicado proporcionalmente, e apaga o original.
  for (const t of aDividirPedido) {
    const dp = t.dividir_pedido;
    const partes = [t, ...(t.dividir_indices || []).map(idx => transacoesOFX[idx])].filter(Boolean);
    const n = partes.length;
    const isRateio = dp.categorias.length > 1;
    let primeiroId = null, falhou = false, k = 0;
    for (const p of partes) {
      k++;
      const valorParte = Number(p.valor);
      const catVals = dpRatearValor(valorParte, dp.categorias);
      const { data: novo, error } = await q(db.from('lancamentos').insert({
        descricao:      `${dp.descricao} (${k}/${n})`,
        valor:          valorParte,
        vencimento:     p.data,
        data_pagamento: p.data,
        status:         'pago',
        tipo:           'pagar',
        banco_id:       bancoId,
        ofx_id:         p.fitId || null,
        fornecedor_id:  dp.fornecedor_id || null,
        unidade_id:     dp.unidade_id || null,
        numero_pedido:  dp.numero_pedido || null,
        plano_conta_id: isRateio ? null : (dp.categorias[0]?.plano_conta_id || null),
        tem_rateio:     isRateio,
      }).select('id').single());
      if (error || !novo) { erros++; falhou = true; continue; }
      if (!primeiroId) primeiroId = novo.id;
      if (isRateio) {
        await q(db.from('rateio_itens').insert(dp.categorias.map((c, ci) => ({
          lancamento_id: novo.id, plano_conta_id: c.plano_conta_id, valor: catVals[ci], descricao: ''
        }))));
      }
      await q(db.from('pagamentos').insert({
        lancamento_id:  novo.id,
        valor:          valorParte,
        data:           p.data,
        banco_id:       bancoId,
        plano_conta_id: isRateio ? null : (dp.categorias[0]?.plano_conta_id || null),
        origem:         'ofx',
        ofx_id:         p.fitId || null
      }));
    }
    // Substitui o lançamento estimado original pelas partes (só se tudo ok)
    if (!falhou && primeiroId) {
      await q(db.from('cmp_contas_pagar').update({ lancamento_id: primeiroId }).eq('lancamento_id', dp.lancamentoId)).catch(() => {});
      await q(db.from('rateio_itens').delete().eq('lancamento_id', dp.lancamentoId)).catch(() => {});
      await q(db.from('lancamentos').delete().eq('id', dp.lancamentoId));
    }
  }

  // Criar: insere novos lançamentos para o que não tem correspondência
  if (aCriar.length) {
    const novos = aCriar.map(t => ({
      descricao:       t.descricao,
      valor:           t.valor,
      vencimento:      t.data,
      data_pagamento:  t.data,
      status:          'pago',
      tipo:            t.tipo,
      plano_conta_id:  t.plano_conta_id || null,
      banco_id:        bancoId,
      ofx_id:          t.fitId || null,
      unidade_id:      t.unidade_id || null,
      ...(t.tipo === 'pagar' && t.centro_custo_id ? { centro_custo_id: t.centro_custo_id } : {})
    }));
    const { error } = await q(db.from('lancamentos').insert(novos))
    if (error) erros++;
  }

  // Grava histórico de classificações (best-effort, não bloqueia em caso de erro)
  await gravarClassificacaoHistorica(selecionadas).catch(() => {});

  if (erros) {
    mostrarToast('Erro em algumas transações. Verifique e tente novamente.', 'erro');
  } else {
    const partes = [];
    if (aTransferencias.length) partes.push(`${aTransferencias.length} transferência(s)`);
    if (aDividirUnidade.length) partes.push(`${aDividirUnidade.length} dividida(s) por unidade`);
    if (aMultiplos.length)      partes.push(`${aMultiplos.length} em lote`);
    if (aDividirPedido.length)  partes.push(`${aDividirPedido.length} pedido(s) dividido(s) por data`);
    if (aConciliar.length)      partes.push(`${aConciliar.length} conciliada(s)`);
    if (aCriar.length)          partes.push(`${aCriar.length} nova(s)`);
    mostrarToast(`Importação concluída: ${partes.join(' + ')}!`, 'sucesso');
  }

  document.getElementById('arquivo-ofx').value = '';
  document.getElementById('nome-arquivo-ofx').textContent = '';
  document.getElementById('preview-importar').classList.add('hidden');
  transacoesOFX = [];
  restaurarBtn();
  await carregarLancamentosPendentes();
  carregarDashboard();
  carregarConciliacao();
  } catch (err) {
    restaurarBtn();
    mostrarToast('Erro durante a importação. Verifique sua conexão e tente novamente.', 'erro');
  }
}

// =========================================================
// USUÁRIOS
// =========================================================
async function carregarUsuarios() {
  if (!(await garantirSessao())) return;
  const usuario = await obterUsuarioAtual();
  if (usuario) {
    const nome = usuario.user_metadata?.nome || usuario.email.split('@')[0];
    document.getElementById('meu-nome').textContent  = nome;
    document.getElementById('meu-email').textContent = usuario.email;
  }

  const db = obterSupabase();

  // Verifica se o usuário atual é administrador
  const { data: perfilAtual } = await q(db.from('perfis').select('is_admin').eq('id', usuario.id).single());
  const isAdmin = perfilAtual?.is_admin === true;
  const btnConvidar = document.getElementById('btn-convidar');
  if (btnConvidar) btnConvidar.style.display = isAdmin ? '' : 'none';

  const { data: perfis } = await q(db.from('perfis').select('*').order('nome'));
  const container = document.getElementById('lista-usuarios');
  if (!container) return;

  if (!perfis || !perfis.length) {
    container.innerHTML = '<p class="sem-dados">Nenhum usuário encontrado.</p>';
    return;
  }

  // Busca sistemas via admin API
  const sbAdmin = window.supabase.createClient(SB_URL, SB_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: authData } = await sbAdmin.auth.admin.listUsers();
  const authUsers = authData?.users || [];

  container.innerHTML = `
    <table class="tabela">
      <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Sistemas</th><th>Cadastrado em</th>${isAdmin ? '<th></th>' : ''}</tr></thead>
      <tbody>
        ${perfis.map(p => {
          const au = authUsers.find(u => u.email === p.email);
          const sistemas = au?.user_metadata?.sistemas;
          const sisBadges = sistemas
            ? sistemas.map(s => s === 'financeiro'
                ? '<span style="background:#27ae60;color:white;padding:2px 8px;border-radius:10px;font-size:.75rem;margin-right:3px;">Financeiro</span>'
                : '<span style="background:#2980b9;color:white;padding:2px 8px;border-radius:10px;font-size:.75rem;margin-right:3px;">Compras</span>'
              ).join('')
            : '<span style="background:#95a5a6;color:white;padding:2px 8px;border-radius:10px;font-size:.75rem;">Todos</span>';
          const canEdit = isAdmin && p.id !== usuario.id && !p.is_admin;
          const metaNome = encodeURIComponent(p.nome);
          return `
          <tr>
            <td>${p.nome}</td>
            <td>${p.email}</td>
            <td>${p.is_admin ? '<span style="color:#c0392b;font-weight:700;">Administrador</span>' : 'Funcionário'}</td>
            <td>${sisBadges}</td>
            <td>${formatarData(p.criado_em?.split('T')[0])}</td>
            ${isAdmin ? `<td style="white-space:nowrap">
              ${canEdit ? `<button class="btn btn-sm" style="background:#8e44ad;color:white;margin-right:4px;" title="Permissões" onclick="abrirPermissoesFinanceiro('${p.id}','${p.email}','${metaNome}',${JSON.stringify(sistemas||null)})"><i class="fas fa-shield-alt"></i></button>` : ''}
              ${canEdit ? `<button class="btn btn-danger btn-sm" onclick="abrirExcluirUsuario('${p.id}','${p.nome.replace(/'/g, "\\'")}')"><i class="fas fa-trash"></i></button>` : ''}
            </td>` : ''}
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

function abrirExcluirUsuario(id, nome) {
  document.querySelector('#modal-excluir .modal-corpo p').textContent =
    `Tem certeza que deseja excluir o usuário "${nome}"?`;
  fnExcluirAtual = async () => {
    const db = obterSupabase();
    const { error } = await db.rpc('excluir_usuario', { usuario_id: id });
    if (error) {
      mostrarToast('Erro ao excluir usuário: ' + error.message, 'erro');
      return;
    }
    mostrarToast(`Usuário "${nome}" excluído com sucesso.`, 'sucesso');
    fecharModal('modal-excluir');
    carregarUsuarios();
  };
  document.getElementById('modal-excluir').classList.remove('hidden');
}

function abrirPermissoesFinanceiro(id, email, metaNome, sistemas) {
  document.getElementById('perm-fin-id').value        = id;
  document.getElementById('perm-fin-meta-nome').value = decodeURIComponent(metaNome);
  document.getElementById('perm-fin-nome').textContent = `${decodeURIComponent(metaNome)} (${email})`;
  document.getElementById('perm-fin-financeiro').checked = !sistemas || sistemas.includes('financeiro');
  document.getElementById('perm-fin-estoque').checked    = !sistemas || sistemas.includes('estoque');
  document.getElementById('perm-fin-msg').textContent    = '';
  document.getElementById('modal-permissoes').classList.remove('hidden');
}

async function salvarPermissoesFinanceiro() {
  const id   = document.getElementById('perm-fin-id').value;
  const nome = document.getElementById('perm-fin-meta-nome').value;
  const msg  = document.getElementById('perm-fin-msg');

  const sistemas = [];
  if (document.getElementById('perm-fin-financeiro').checked) sistemas.push('financeiro');
  if (document.getElementById('perm-fin-estoque').checked)    sistemas.push('estoque');

  if (!sistemas.length) {
    msg.textContent = 'Selecione ao menos um sistema.';
    msg.style.color = '#c0392b';
    return;
  }

  const sbAdmin = window.supabase.createClient(SB_URL, SB_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { error } = await sbAdmin.auth.admin.updateUserById(id, {
    user_metadata: { nome, sistemas }
  });

  if (error) { msg.textContent = error.message; msg.style.color = '#c0392b'; return; }

  msg.textContent  = 'Permissões salvas!';
  msg.style.color  = '#27ae60';
  setTimeout(() => {
    fecharModal('modal-permissoes');
    carregarUsuarios();
  }, 1200);
}

function abrirModalConvidar() {
  document.getElementById('convidar-nome').value = '';
  document.getElementById('convidar-email').value = '';
  document.getElementById('convidar-senha').value = '';
  document.getElementById('convidar-confirmar-senha').value = '';
  document.getElementById('modal-convidar').classList.remove('hidden');
}

async function convidarFuncionario() {
  const nome      = document.getElementById('convidar-nome').value.trim();
  const email     = document.getElementById('convidar-email').value.trim();
  const senha     = document.getElementById('convidar-senha').value;
  const confirmar = document.getElementById('convidar-confirmar-senha').value;

  if (!nome)  { mostrarToast('Informe o nome do funcionário.', 'erro'); return; }
  if (!email) { mostrarToast('Informe o e-mail do funcionário.', 'erro'); return; }
  if (!senha || senha.length < 6) { mostrarToast('A senha deve ter ao menos 6 caracteres.', 'erro'); return; }
  if (senha !== confirmar) { mostrarToast('As senhas não coincidem.', 'erro'); return; }

  const sistemas = [];
  if (document.getElementById('convidar-sys-financeiro').checked) sistemas.push('financeiro');
  if (document.getElementById('convidar-sys-estoque').checked)    sistemas.push('estoque');
  if (!sistemas.length) { mostrarToast('Selecione ao menos um sistema.', 'erro'); return; }

  const sbAdmin = window.supabase.createClient(SB_URL, SB_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { error } = await sbAdmin.auth.admin.createUser({
    email,
    password: senha,
    user_metadata: { nome, sistemas },
    email_confirm: true,
  });

  if (error) {
    if (error.message.includes('already registered') || error.message.includes('User already registered')) {
      mostrarToast('Este e-mail já está cadastrado no sistema.', 'erro');
    } else {
      mostrarToast('Erro ao convidar: ' + error.message, 'erro');
    }
    return;
  }

  mostrarToast(`Convite enviado para ${email}! O funcionário deve confirmar o e-mail para acessar o sistema.`, 'sucesso');
  fecharModal('modal-convidar');
  carregarUsuarios();
}

function abrirModalAlterarSenha() {
  document.getElementById('nova-senha').value      = '';
  document.getElementById('confirmar-senha').value = '';
  document.getElementById('modal-alterar-senha').classList.remove('hidden');
}

async function salvarAlteracaoSenha() {
  if (!await garantirSessao()) return;
  const nova      = document.getElementById('nova-senha').value;
  const confirmar = document.getElementById('confirmar-senha').value;

  if (!nova || nova.length < 6) {
    mostrarToast('A senha deve ter ao menos 6 caracteres!', 'erro'); return;
  }
  if (nova !== confirmar) {
    mostrarToast('As senhas não coincidem!', 'erro'); return;
  }

  const { error } = await alterarMinhaSenha(nova);
  if (error) { mostrarToast('Erro ao alterar senha.', 'erro'); return; }
  mostrarToast('Senha alterada com sucesso!', 'sucesso');
  fecharModal('modal-alterar-senha');
}

// =========================================================
// CONCILIAÇÃO DIÁRIA
// =========================================================
function preencherFiltrosConciliacao() {
  // Unidades
  const listaUni = document.getElementById('concil-lista-unidades');
  if (listaUni && listaUni.children.length === 0) {
    listaUni.innerHTML = unidades.map(u =>
      `<label style="display:flex;align-items:center;gap:6px;padding:4px 0;cursor:pointer;font-size:13px;">
        <input type="checkbox" class="concil-uni-cb" value="${u.id}" checked onchange="atualizarLabelConcil('unidades')"> ${u.nome}
      </label>`
    ).join('');
  }
  // Bancos
  const listaBanco = document.getElementById('concil-lista-bancos');
  if (listaBanco && listaBanco.children.length === 0) {
    listaBanco.innerHTML = bancosCadastrados.map(b =>
      `<label style="display:flex;align-items:center;gap:6px;padding:4px 0;cursor:pointer;font-size:13px;">
        <input type="checkbox" class="concil-banco-cb" value="${b.id}" checked onchange="atualizarLabelConcil('bancos')"> ${b.nome}
      </label>`
    ).join('');
  }
  // Mês atual
  const agora = new Date();
  const selMes = document.getElementById('concil-mes');
  const selAno = document.getElementById('concil-ano');
  if (selMes) selMes.value = agora.getMonth() + 1;
  if (selAno) selAno.value = agora.getFullYear();
}

function toggleConcilDropdown(tipo) {
  const drop = document.getElementById(`concil-drop-${tipo}`);
  if (!drop) return;
  document.querySelectorAll('[id^="concil-drop-"]').forEach(d => { if (d !== drop) d.classList.add('hidden'); });
  drop.classList.toggle('hidden');
}

function toggleTodosConcil(tipo) {
  const todos = document.getElementById(`concil-${tipo === 'unidades' ? 'uni' : 'banco'}-todos`);
  const cbs = document.querySelectorAll(`.concil-${tipo === 'unidades' ? 'uni' : 'banco'}-cb`);
  cbs.forEach(cb => cb.checked = todos.checked);
  atualizarLabelConcil(tipo);
}

function atualizarLabelConcil(tipo) {
  const isUni = tipo === 'unidades';
  const cbs = [...document.querySelectorAll(`.concil-${isUni ? 'uni' : 'banco'}-cb`)];
  const sel = cbs.filter(cb => cb.checked);
  const todos = document.getElementById(`concil-${isUni ? 'uni' : 'banco'}-todos`);
  const label = document.getElementById(`concil-label-${tipo}`);
  if (!label) return;
  if (todos) todos.checked = sel.length === cbs.length;
  if (sel.length === 0) label.textContent = isUni ? 'Nenhuma unidade' : 'Nenhum banco';
  else if (sel.length === cbs.length) label.textContent = isUni ? 'Todas as unidades' : 'Todos os bancos';
  else label.textContent = `${sel.length} ${isUni ? 'unidade(s)' : 'banco(s)'}`;
}

async function carregarConciliacao() {
  if (!(await garantirSessao())) return;
  const db = obterSupabase();

  const mes  = parseInt(document.getElementById('concil-mes').value);
  const ano  = parseInt(document.getElementById('concil-ano').value);
  const unidadesSel = [...document.querySelectorAll('.concil-uni-cb:checked')].map(cb => cb.value);
  const bancosSel   = [...document.querySelectorAll('.concil-banco-cb:checked')].map(cb => cb.value);
  const totalUni    = document.querySelectorAll('.concil-uni-cb').length;
  const totalBanco  = document.querySelectorAll('.concil-banco-cb').length;

  const mesStr  = String(mes).padStart(2, '0');
  const lastDay = new Date(ano, mes, 0).getDate();
  const dataIni = `${ano}-${mesStr}-01`;
  const dataFim = `${ano}-${mesStr}-${String(lastDay).padStart(2,'0')}`;

  const tbody = document.getElementById('tbody-conciliacao');
  const tfoot = document.getElementById('tfoot-conciliacao');
  tbody.innerHTML = `<tr><td colspan="4" class="sem-dados"><i class="fas fa-spinner fa-spin"></i> Carregando...</td></tr>`;

  // Fechar dropdowns
  document.querySelectorAll('[id^="concil-drop-"]').forEach(d => d.classList.add('hidden'));

  // Busca paginada — PostgREST limita a 1.000 linhas por resposta
  async function fetchConcilPag(tabela, selectFields, filtros) {
    const PAGE = 1000;
    let todos = [], pagina = 0;
    while (true) {
      let qr = db.from(tabela).select(selectFields).range(pagina * PAGE, (pagina + 1) * PAGE - 1);
      for (const [met, ...args] of filtros) qr = qr[met](...args);
      const { data, error } = await qr;
      if (error || !data || data.length === 0) break;
      todos = todos.concat(data);
      if (data.length < PAGE) break;
      pagina++;
    }
    return todos;
  }

  const [lancamentos_raw, transferencias_raw] = await Promise.all([
    fetchConcilPag('lancamentos', 'data_pagamento, tipo, valor, unidade_id, banco_id', [
      ['eq', 'status', 'pago'],
      ['gte', 'data_pagamento', dataIni],
      ['lte', 'data_pagamento', dataFim]
    ]),
    fetchConcilPag('transferencias', 'data, valor, banco_origem_id, banco_destino_id', [
      ['gte', 'data', dataIni],
      ['lte', 'data', dataFim]
    ])
  ]);

  let lancamentos = lancamentos_raw;
  let transferencias = transferencias_raw;

  // Filtro unidades (se não for todas)
  if (unidadesSel.length < totalUni) {
    lancamentos = lancamentos.filter(l => unidadesSel.includes(l.unidade_id));
  }
  // Filtro bancos (se não for todos) — aplica em lancamentos e transferencias
  if (bancosSel.length < totalBanco) {
    lancamentos    = lancamentos.filter(l => bancosSel.includes(l.banco_id));
    transferencias = transferencias.filter(t =>
      bancosSel.includes(t.banco_destino_id) || bancosSel.includes(t.banco_origem_id)
    );
  }

  // Agrupa por dia
  const porDia = {};
  for (let d = 1; d <= lastDay; d++) porDia[d] = { rec: 0, desp: 0 };

  lancamentos.forEach(l => {
    const dia = parseInt(l.data_pagamento.slice(8, 10));
    if (l.tipo === 'receber') porDia[dia].rec  += Number(l.valor);
    else                      porDia[dia].desp += Number(l.valor);
  });

  // Transferências: entrada no banco destino = receita, saída do banco origem = despesa
  transferencias.forEach(t => {
    const dia = parseInt(t.data.slice(8, 10));
    if (!porDia[dia]) return;
    const val = Number(t.valor);
    // Se filtro de banco ativo, só conta o lado do banco selecionado
    if (bancosSel.length < totalBanco) {
      if (bancosSel.includes(t.banco_destino_id)) porDia[dia].rec  += val;
      if (bancosSel.includes(t.banco_origem_id))  porDia[dia].desp += val;
    } else {
      // Sem filtro de banco: transferências são neutras (entrada + saída se cancelam)
      // Mostrar como receita no destino e despesa na origem
      porDia[dia].rec  += val;
      porDia[dia].desp += val;
    }
  });

  const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const diasSemana = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

  let totalRec = 0, totalDesp = 0, html = '';

  for (let d = 1; d <= lastDay; d++) {
    const { rec, desp } = porDia[d];
    const resultado = rec - desp;
    totalRec  += rec;
    totalDesp += desp;
    const hasData = rec > 0 || desp > 0;
    const diaSemana = diasSemana[new Date(ano, mes - 1, d).getDay()];
    const isWeekend = new Date(ano, mes - 1, d).getDay() === 0 || new Date(ano, mes - 1, d).getDay() === 6;

    let rowBg = isWeekend && !hasData ? 'background:#f9f9f9;' : '';
    if (hasData) rowBg = resultado >= 0 ? 'background:#f0fdf4;' : 'background:#fff5f5;';

    const recHtml  = rec  > 0 ? `<span style="color:#16a34a;font-weight:500;">${formatarMoeda(rec)}</span>`  : `<span style="color:#ccc;">—</span>`;
    const despHtml = desp > 0 ? `<span style="color:#dc2626;font-weight:500;">${formatarMoeda(desp)}</span>` : `<span style="color:#ccc;">—</span>`;
    let resHtml = `<span style="color:#ccc;">—</span>`;
    if (hasData) {
      const cor = resultado >= 0 ? '#16a34a' : '#dc2626';
      const sinal = resultado >= 0 ? '' : '-';
      resHtml = `<span style="color:${cor};font-weight:600;">${sinal}${formatarMoeda(Math.abs(resultado))}</span>`;
    }

    html += `<tr style="${rowBg}">
      <td style="text-align:center;">
        <span style="font-weight:600;font-size:15px;">${d}</span>
        <span style="font-size:10px;color:#999;display:block;">${diaSemana}</span>
      </td>
      <td style="text-align:right;padding-right:16px;">${recHtml}</td>
      <td style="text-align:right;padding-right:16px;">${despHtml}</td>
      <td style="text-align:right;padding-right:16px;">${resHtml}</td>
    </tr>`;
  }

  tbody.innerHTML = html || `<tr><td colspan="4" class="sem-dados">Nenhum lançamento encontrado.</td></tr>`;

  // Guarda o resultado para o botão "Exportar Excel" desta tela
  _concilExport = {
    mes, ano, lastDay, porDia,
    unidades: document.getElementById('concil-label-unidades')?.textContent?.trim() || 'Todas as unidades',
    bancos:   document.getElementById('concil-label-bancos')?.textContent?.trim()   || 'Todos os bancos',
  };

  // Rodapé total
  const totalRes = totalRec - totalDesp;
  const corRes = totalRes >= 0 ? '#16a34a' : '#dc2626';
  const sinalRes = totalRes >= 0 ? '' : '-';
  tfoot.innerHTML = `<tr style="background:#f1f5f9;font-weight:700;border-top:2px solid #cbd5e1;">
    <td style="text-align:center;padding:10px 8px;">TOTAL</td>
    <td style="text-align:right;padding-right:16px;color:#16a34a;">${formatarMoeda(totalRec)}</td>
    <td style="text-align:right;padding-right:16px;color:#dc2626;">${formatarMoeda(totalDesp)}</td>
    <td style="text-align:right;padding-right:16px;color:${corRes};">${sinalRes}${formatarMoeda(Math.abs(totalRes))}</td>
  </tr>`;

  // Cards resumo
  document.getElementById('concil-total-rec').textContent  = formatarMoeda(totalRec);
  document.getElementById('concil-total-desp').textContent = formatarMoeda(totalDesp);
  const elRes = document.getElementById('concil-total-res');
  elRes.textContent = `${sinalRes}${formatarMoeda(Math.abs(totalRes))}`;
  elRes.style.color = corRes;
}

// =========================================================
// RELATÓRIOS
// =========================================================

// ---------------------------------------------------------
// RESULTADO × CAIXA — Ponte (concilia o resultado da DRE com
// a variação real de saldo de todas as contas no mês).
// Consolidado: todas as unidades e contas. Regime de caixa.
// ---------------------------------------------------------
function carregarPonteCaixa() {
  const elMes = document.getElementById('pc-mes');
  const elAno = document.getElementById('pc-ano');
  if (elMes && !elMes.value) elMes.value = String(new Date().getMonth() + 1);
  if (elAno && !elAno.value) elAno.value = String(new Date().getFullYear());
  _executarPonteCaixa();
}

async function _executarPonteCaixa() {
  if (!(await garantirSessao())) return;
  const db = obterSupabase();
  const mes = parseInt(document.getElementById('pc-mes')?.value || (new Date().getMonth() + 1));
  const ano = parseInt(document.getElementById('pc-ano')?.value || new Date().getFullYear());

  const mesStr  = String(mes).padStart(2, '0');
  const lastDay = new Date(ano, mes, 0).getDate();
  const mesIni  = `${ano}-${mesStr}-01`;
  const mesFim  = `${ano}-${mesStr}-${String(lastDay).padStart(2, '0')}`;
  const diaAntes = new Date(ano, mes - 1, 0);   // último dia do mês anterior
  const diaAntesStr = `${diaAntes.getFullYear()}-${String(diaAntes.getMonth() + 1).padStart(2, '0')}-${String(diaAntes.getDate()).padStart(2, '0')}`;

  const el = document.getElementById('pc-conteudo');
  if (el) el.innerHTML = '<p class="sem-dados"><i class="fas fa-spinner fa-spin"></i> Calculando a ponte Resultado × Caixa...</p>';

  async function buscar(tabela, campos, filtros) {
    const PAGE = 1000;
    let todos = [], pagina = 0;
    while (true) {
      let qr = db.from(tabela).select(campos).range(pagina * PAGE, (pagina + 1) * PAGE - 1);
      for (const [met, ...args] of filtros) qr = qr[met](...args);
      const { data, error } = await qr;
      if (error || !data || data.length === 0) break;
      todos = todos.concat(data);
      if (data.length < PAGE) break;
      pagina++;
    }
    return todos;
  }

  const [saldoRows, mesRows, transfRows] = await Promise.all([
    // saldos: tudo pago com banco, até o fim do mês
    buscar('lancamentos', 'tipo, valor, data_pagamento, banco_id', [
      ['eq', 'status', 'pago'], ['not', 'banco_id', 'is', null], ['lte', 'data_pagamento', mesFim]
    ]),
    // detalhe do mês (para reproduzir a DRE + itens de reconciliação)
    buscar('lancamentos', 'id, tipo, valor, plano_conta_id, banco_id, descricao, unidade_id, data_pagamento, tem_rateio', [
      ['eq', 'status', 'pago'], ['gte', 'data_pagamento', mesIni], ['lte', 'data_pagamento', mesFim]
    ]),
    // transferências até o fim do mês (afetam saldo por conta; no consolidado se anulam)
    buscar('transferencias', 'valor, data, banco_origem_id, banco_destino_id', [
      ['lte', 'data', mesFim]
    ]),
  ]);

  // ---- Saldos por conta (início e fim do mês) ----
  const saldoIni = {}, saldoFim = {};
  bancosCadastrados.forEach(b => { saldoIni[b.id] = Number(b.saldo_inicial) || 0; saldoFim[b.id] = Number(b.saldo_inicial) || 0; });
  saldoRows.forEach(l => {
    if (!l.banco_id) return;
    const d = l.tipo === 'receber' ? Number(l.valor) : -Number(l.valor);
    if (saldoFim[l.banco_id] === undefined) { saldoIni[l.banco_id] = 0; saldoFim[l.banco_id] = 0; }
    saldoFim[l.banco_id] += d;
    if (l.data_pagamento <= diaAntesStr) saldoIni[l.banco_id] += d;
  });
  transfRows.forEach(t => {
    const apl = (obj) => {
      if (t.banco_origem_id)  obj[t.banco_origem_id]  = (obj[t.banco_origem_id]  || 0) - Number(t.valor);
      if (t.banco_destino_id) obj[t.banco_destino_id] = (obj[t.banco_destino_id] || 0) + Number(t.valor);
    };
    apl(saldoFim);
    if (t.data <= diaAntesStr) apl(saldoIni);
  });
  const consIni = Object.values(saldoIni).reduce((a, v) => a + v, 0);
  const consFim = Object.values(saldoFim).reduce((a, v) => a + v, 0);
  const varReal = consFim - consIni;

  // ---- DRE do mês (mesmo motor da tela DRE, com rateio expandido) ----
  const mesEx = await _expandirRateios(db, mesRows);
  const cal = _calcularDre(mesEx);
  const resultadoDRE = cal.resultadoFinal;

  // ---- Itens de reconciliação (DRE -> Caixa) ----
  const planoIds = new Set(planoContas.map(p => p.id));
  const catValida = (l) => l.plano_conta_id && planoIds.has(l.plano_conta_id);
  let recSemCatBanco = 0, despSemCatBanco = 0, despCatSemBanco = 0, recCatSemBanco = 0;
  mesEx.forEach(l => {
    const v = Number(l.valor), temBanco = !!l.banco_id, cat = catValida(l);
    if (l.tipo === 'receber') {
      if (!cat && temBanco) recSemCatBanco += v;
      if (cat && !temBanco)  recCatSemBanco += v;
    } else {
      if (!cat && temBanco) despSemCatBanco += v;
      if (cat && !temBanco)  despCatSemBanco += v;
    }
  });
  const varEsperada = resultadoDRE + recSemCatBanco - despSemCatBanco + despCatSemBanco - recCatSemBanco;
  const diff = varReal - varEsperada;

  const mesesPt = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  _renderizarPonteCaixa({
    nomeMes: mesesPt[mes - 1], ano, cal, resultadoDRE,
    recSemCatBanco, despSemCatBanco, despCatSemBanco, recCatSemBanco,
    varEsperada, varReal, diff, consIni, consFim, saldoIni, saldoFim,
  });
}

function _renderizarPonteCaixa(d) {
  const el = document.getElementById('pc-conteudo');
  if (!el) return;
  const fm = v => formatarMoeda(v);
  const cor = v => v >= 0 ? '#1a7a3c' : '#c0392b';

  // KPIs
  const kpi = (label, val, sub, corVal) => `
    <div class="dre-kpi" style="border-left-color:${corVal};">
      <div class="dre-kpi-info">
        <span class="dre-kpi-label">${label}</span>
        <span class="dre-kpi-valor" style="color:${corVal};">${fm(val)}</span>
        ${sub ? `<span class="dre-kpi-sub">${sub}</span>` : ''}
      </div>
    </div>`;
  const kpis = `<div class="dre-kpi-grid-inner" style="margin-bottom:16px;">
    ${kpi('Saldo início do mês', d.consIni, 'todas as contas', '#1a3a7a')}
    ${kpi('Variação no mês', d.varReal, d.varReal >= 0 ? 'entrou mais do que saiu' : 'saiu mais do que entrou', cor(d.varReal))}
    ${kpi('Saldo fim do mês', d.consFim, 'todas as contas', '#1a3a7a')}
    ${kpi('Resultado da DRE', d.resultadoDRE, 'lucro do período', cor(d.resultadoDRE))}
  </div>`;

  // Mini-DRE (de onde veio, pra onde foi)
  const linhaMini = (lbl, val, tipo) => {
    const isTotal = tipo === 'total';
    return `<tr style="${isTotal ? 'font-weight:700;background:#f4f8f5;' : ''}">
      <td style="padding:7px 12px;font-size:13px;${isTotal ? '' : 'color:#555;'}">${lbl}</td>
      <td style="padding:7px 12px;font-size:13px;text-align:right;font-variant-numeric:tabular-nums;color:${tipo === 'neg' ? '#c0392b' : (isTotal ? cor(val) : '#333')};">${tipo === 'neg' ? '(' + fm(val) + ')' : fm(val)}</td>
    </tr>`;
  };
  const miniDre = `
    <div style="flex:1 1 320px;min-width:300px;">
      <h3 style="font-size:14px;color:#1a3a7a;margin:0 0 8px;"><i class="fas fa-file-invoice-dollar"></i> Como o resultado se formou</h3>
      <div style="border:1px solid #e8e8e8;border-radius:10px;overflow:hidden;">
        <table style="width:100%;border-collapse:collapse;">
          ${linhaMini('Receita Bruta', d.cal.receitaBruta, 'pos')}
          ${linhaMini('(−) CMV', d.cal.totalCMV, 'neg')}
          ${linhaMini('= Lucro Bruto', d.cal.lucroBruto, 'total')}
          ${linhaMini('(−) Despesas Operacionais', d.cal.totalDesp, 'neg')}
          ${linhaMini('= EBITDA (geração de caixa)', d.cal.ebitda, 'total')}
          ${linhaMini('(−) Distribuições / Uso do Lucro', d.cal.totalUsoLucro, 'neg')}
          ${linhaMini('= Resultado Final', d.cal.resultadoFinal, 'total')}
        </table>
      </div>
      ${d.cal.totalUsoLucro > 0 ? `<p style="font-size:12px;color:#8a6d00;background:#fff8e1;border:1px solid #f5e0a3;border-radius:8px;padding:8px 10px;margin:8px 0 0;">
        <i class="fas fa-hand-holding-dollar"></i> <strong>${fm(d.cal.totalUsoLucro)}</strong> foram distribuídos como lucro no mês — esse dinheiro <strong>saiu do caixa</strong> (por isso o EBITDA de ${fm(d.cal.ebitda)} não fica na conta).
      </p>` : ''}
    </div>`;

  // A Ponte (walk)
  const linhaPonte = (lbl, val, sinal, hint) => {
    const sImg = sinal === '+' ? '+' : (sinal === '−' ? '−' : '');
    return `<tr>
      <td style="padding:8px 12px;font-size:13px;color:#555;">${sImg ? `<span style="color:${sinal === '+' ? '#1a7a3c' : '#c0392b'};font-weight:700;margin-right:6px;">${sImg}</span>` : ''}${lbl}${hint ? `<br><span style="font-size:11px;color:#999;">${hint}</span>` : ''}</td>
      <td style="padding:8px 12px;font-size:13px;text-align:right;font-variant-numeric:tabular-nums;">${fm(val)}</td>
    </tr>`;
  };
  const temAjustes = d.recSemCatBanco || d.despSemCatBanco || d.despCatSemBanco || d.recCatSemBanco;
  const ponte = `
    <div style="flex:1 1 340px;min-width:300px;">
      <h3 style="font-size:14px;color:#1a3a7a;margin:0 0 8px;"><i class="fas fa-scale-balanced"></i> Do resultado até o caixa</h3>
      <div style="border:1px solid #e8e8e8;border-radius:10px;overflow:hidden;">
        <table style="width:100%;border-collapse:collapse;">
          <tr style="font-weight:700;background:#eef3fb;">
            <td style="padding:8px 12px;font-size:13px;">Resultado da DRE (mês)</td>
            <td style="padding:8px 12px;font-size:13px;text-align:right;color:${cor(d.resultadoDRE)};font-variant-numeric:tabular-nums;">${fm(d.resultadoDRE)}</td>
          </tr>
          ${d.recSemCatBanco  ? linhaPonte('Receitas sem categoria', d.recSemCatBanco, '+', 'entraram no caixa, fora da DRE') : ''}
          ${d.despSemCatBanco ? linhaPonte('Despesas sem categoria', d.despSemCatBanco, '−', 'saíram do caixa, fora da DRE') : ''}
          ${d.despCatSemBanco ? linhaPonte('Despesas sem conta bancária', d.despCatSemBanco, '+', 'estão na DRE, mas não baixaram conta') : ''}
          ${d.recCatSemBanco  ? linhaPonte('Receitas sem conta bancária', d.recCatSemBanco, '−', 'estão na DRE, mas não entraram em conta') : ''}
          ${!temAjustes ? `<tr><td colspan="2" style="padding:8px 12px;font-size:12px;color:#999;text-align:center;">Sem ajustes — DRE e caixa batem direto.</td></tr>` : ''}
          <tr style="font-weight:700;background:#f4f8f5;border-top:2px solid #e0e0e0;">
            <td style="padding:9px 12px;font-size:13px;">= Variação de caixa esperada</td>
            <td style="padding:9px 12px;font-size:13px;text-align:right;color:${cor(d.varEsperada)};font-variant-numeric:tabular-nums;">${fm(d.varEsperada)}</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;font-size:13px;color:#555;">Variação de caixa <strong>real</strong> (contas)</td>
            <td style="padding:8px 12px;font-size:13px;text-align:right;color:${cor(d.varReal)};font-variant-numeric:tabular-nums;">${fm(d.varReal)}</td>
          </tr>
        </table>
      </div>
      <div style="margin-top:8px;padding:10px 12px;border-radius:8px;font-size:13px;${Math.abs(d.diff) < 0.5
        ? 'background:#e8f6ee;border:1px solid #b7e0c5;color:#1a7a3c;'
        : 'background:#fdecea;border:1px solid #f5b7b1;color:#c0392b;'}">
        ${Math.abs(d.diff) < 0.5
          ? '<i class="fas fa-circle-check"></i> <strong>Confere.</strong> O resultado da DRE explica a variação de caixa do mês.'
          : `<i class="fas fa-triangle-exclamation"></i> <strong>Diferença de ${fm(Math.abs(d.diff))}</strong> não explicada — vale investigar lançamentos sem conta/categoria ou movimentos fora do padrão.`}
      </div>
    </div>`;

  // Prova + por conta
  const contasHtml = bancosCadastrados
    .map(b => ({ nome: b.nome, ini: d.saldoIni[b.id] || 0, fim: d.saldoFim[b.id] || 0 }))
    .sort((a, b) => b.fim - a.fim)
    .map(c => `<tr style="border-bottom:1px solid #f0f0f0;">
        <td style="padding:7px 12px;font-size:13px;">${c.nome}</td>
        <td style="padding:7px 12px;font-size:13px;text-align:right;font-variant-numeric:tabular-nums;color:#666;">${fm(c.ini)}</td>
        <td style="padding:7px 12px;font-size:13px;text-align:right;font-variant-numeric:tabular-nums;color:${cor(c.fim - c.ini)};">${(c.fim - c.ini) >= 0 ? '+' : ''}${fm(c.fim - c.ini)}</td>
        <td style="padding:7px 12px;font-size:13px;text-align:right;font-variant-numeric:tabular-nums;font-weight:600;color:${cor(c.fim)};">${fm(c.fim)}</td>
      </tr>`).join('');
  const porConta = `
    <div style="margin-top:20px;">
      <h3 style="font-size:14px;color:#1a3a7a;margin:0 0 8px;"><i class="fas fa-building-columns"></i> Saldo por conta</h3>
      <div style="overflow-x:auto;border:1px solid #e8e8e8;border-radius:10px;">
        <table style="width:100%;border-collapse:collapse;min-width:520px;">
          <thead><tr style="background:#f4f6f8;text-align:right;">
            <th style="padding:8px 12px;font-size:11px;color:#667;text-transform:uppercase;letter-spacing:.03em;text-align:left;">Conta</th>
            <th style="padding:8px 12px;font-size:11px;color:#667;text-transform:uppercase;letter-spacing:.03em;">Início</th>
            <th style="padding:8px 12px;font-size:11px;color:#667;text-transform:uppercase;letter-spacing:.03em;">Variação</th>
            <th style="padding:8px 12px;font-size:11px;color:#667;text-transform:uppercase;letter-spacing:.03em;">Fim</th>
          </tr></thead>
          <tbody>${contasHtml}</tbody>
          <tfoot><tr style="background:#eef3fb;font-weight:700;border-top:2px solid #dbe4f0;">
            <td style="padding:8px 12px;font-size:13px;">CONSOLIDADO</td>
            <td style="padding:8px 12px;font-size:13px;text-align:right;font-variant-numeric:tabular-nums;">${fm(d.consIni)}</td>
            <td style="padding:8px 12px;font-size:13px;text-align:right;font-variant-numeric:tabular-nums;color:${cor(d.varReal)};">${d.varReal >= 0 ? '+' : ''}${fm(d.varReal)}</td>
            <td style="padding:8px 12px;font-size:13px;text-align:right;font-variant-numeric:tabular-nums;color:${cor(d.consFim)};">${fm(d.consFim)}</td>
          </tr></tfoot>
        </table>
      </div>
      <p style="font-size:12px;color:#999;margin:8px 2px 0;"><i class="fas fa-circle-info"></i> Transferências entre contas próprias se anulam no consolidado. Para conferir contra o extrato do banco, compare o "Fim" de cada conta com o saldo do OFX (próximo relatório).</p>
    </div>`;

  el.innerHTML = `
    <h2 style="font-size:16px;color:#333;margin:0 0 4px;">${d.nomeMes} / ${d.ano}</h2>
    <p style="font-size:13px;color:#777;margin:0 0 16px;">Consolidado — todas as unidades e contas · regime de caixa (data de pagamento)</p>
    ${kpis}
    <div style="display:flex;flex-wrap:wrap;gap:20px;">${miniDre}${ponte}</div>
    ${porConta}`;
}

// =========================================================
// DRE — DEMONSTRAÇÃO DO RESULTADO DO EXERCÍCIO
// =========================================================
let dreChartWaterfall = null, dreChartDespesas = null, dreChartEvolucao = null;

function carregarDre() {
  // Preencher mês/ano padrão
  const elMes = document.getElementById('dre-mes');
  const elAno = document.getElementById('dre-ano');
  if (elMes && !elMes.value) elMes.value = String(new Date().getMonth() + 1);
  if (elAno && !elAno.value) elAno.value = String(new Date().getFullYear());
  // Preencher unidades (multi-seleção)
  const listaUni = document.getElementById('dre-lista-unidades');
  if (listaUni && listaUni.children.length === 0) {
    listaUni.innerHTML = unidades.map(u =>
      `<label style="display:flex;align-items:center;gap:6px;padding:4px 0;cursor:pointer;font-size:13px;">
        <input type="checkbox" class="dre-uni-cb" value="${u.id}" checked onchange="atualizarLabelDre()"> ${u.nome}
      </label>`
    ).join('');
  }
  _executarDre();
}

function toggleDreDropdown() {
  const drop = document.getElementById('dre-drop-unidades');
  if (drop) drop.classList.toggle('hidden');
}

function toggleTodosDre() {
  const todos = document.getElementById('dre-uni-todos');
  document.querySelectorAll('.dre-uni-cb').forEach(cb => cb.checked = todos.checked);
  atualizarLabelDre();
}

function atualizarLabelDre() {
  const cbs = [...document.querySelectorAll('.dre-uni-cb')];
  const sel = cbs.filter(cb => cb.checked);
  const todos = document.getElementById('dre-uni-todos');
  const label = document.getElementById('dre-label-unidades');
  if (todos) todos.checked = sel.length === cbs.length && cbs.length > 0;
  if (!label) return;
  if (sel.length === 0)                 label.textContent = 'Nenhuma unidade';
  else if (sel.length === cbs.length)   label.textContent = 'Consolidado';
  else if (sel.length === 1)            label.textContent = sel[0].parentElement.textContent.trim();
  else                                  label.textContent = `${sel.length} unidades`;
}

// Expande lançamentos com rateio: substitui cada lançamento tem_rateio pelos
// seus itens de rateio_itens (cada um com seu plano_conta_id e valor), herdando
// os demais campos do pai (id, tipo, banco_id, unidade_id, descricao, data).
// Assim a categorização feita no rateio entra na DRE / relatórios.
async function _expandirRateios(db, lancamentos, inconsist) {
  const ids = lancamentos.filter(l => l.tem_rateio).map(l => l.id);
  if (ids.length === 0) return lancamentos;
  const mapa = {};
  const CH = 150;
  for (let i = 0; i < ids.length; i += CH) {
    const { data } = await db.from('rateio_itens')
      .select('lancamento_id, plano_conta_id, valor')
      .in('lancamento_id', ids.slice(i, i + CH));
    (data || []).forEach(r => { (mapa[r.lancamento_id] = mapa[r.lancamento_id] || []).push(r); });
  }
  const out = [];
  lancamentos.forEach(l => {
    const itens = mapa[l.id];
    if (l.tem_rateio && itens && itens.length) {
      // Ancora o total no valor REALMENTE pago: usa o rateio só para a proporção
      // entre categorias. Protege contra rateio digitado com total errado.
      const soma = itens.reduce((a, r) => a + Number(r.valor), 0);
      if (inconsist && Math.abs(soma - Number(l.valor)) > 0.01) {
        inconsist.push({ id: l.id, descricao: l.descricao || '(sem descrição)', valor: Number(l.valor),
          somaRateio: soma, tipo: l.tipo, unidade_id: l.unidade_id || null, data: l.data_pagamento });
      }
      const fator = (soma > 0.01 && Math.abs(soma - Number(l.valor)) > 0.01) ? Number(l.valor) / soma : 1;
      itens.forEach(r => out.push({ ...l, plano_conta_id: r.plano_conta_id, valor: Number(r.valor) * fator, _viaRateio: true }));
    } else {
      if (l.tem_rateio && inconsist) {   // marcado como rateio mas sem itens → também é inconsistência
        inconsist.push({ id: l.id, descricao: l.descricao || '(sem descrição)', valor: Number(l.valor),
          somaRateio: 0, tipo: l.tipo, unidade_id: l.unidade_id || null, data: l.data_pagamento, semItens: true });
      }
      out.push(l);   // sem rateio, ou rateio sem itens (fica como está → aparece como sem categoria)
    }
  });
  return out;
}

async function _executarDre() {
  if (!(await garantirSessao())) return;
  const db = obterSupabase();
  const mes       = parseInt(document.getElementById('dre-mes')?.value  || (new Date().getMonth() + 1));
  const ano       = parseInt(document.getElementById('dre-ano')?.value  || new Date().getFullYear());
  // Multi-seleção de unidades: se todas (ou nenhuma restrição) → Consolidado (sem filtro).
  const cbsUni      = [...document.querySelectorAll('.dre-uni-cb')];
  const unidadesSel = cbsUni.filter(cb => cb.checked).map(cb => cb.value);
  const totalUni    = cbsUni.length;
  // filtra só quando é um subconjunto real (nem tudo, nem vazio)
  const filtrarUnid = unidadesSel.length > 0 && unidadesSel.length < totalUni;
  // Fecha o dropdown ao gerar
  document.getElementById('dre-drop-unidades')?.classList.add('hidden');

  const mesStr  = String(mes).padStart(2, '0');
  const lastDay = new Date(ano, mes, 0).getDate();
  const mesIni  = `${ano}-${mesStr}-01`;
  const mesFim  = `${ano}-${mesStr}-${String(lastDay).padStart(2,'0')}`;
  const anoIni  = `${ano}-01-01`;

  const elTabela = document.getElementById('dre-tabela');
  const elKPIs   = document.getElementById('dre-kpis');
  if (elTabela) elTabela.innerHTML = '<p class="sem-dados"><i class="fas fa-spinner fa-spin"></i> Carregando DRE...</p>';
  if (elKPIs)   elKPIs.innerHTML = '';

  async function buscarPaginado(de, ate) {
    const PAGE = 1000;
    let todos = [], pagina = 0;
    while (true) {
      let q2 = db.from('lancamentos')
        .select('id, tipo, plano_conta_id, valor, data_pagamento, descricao, unidade_id, tem_rateio')
        .eq('status', 'pago')
        .gte('data_pagamento', de)
        .lte('data_pagamento', ate)
        .range(pagina * PAGE, (pagina + 1) * PAGE - 1);
      if (filtrarUnid) q2 = q2.in('unidade_id', unidadesSel);
      const { data: lote, error } = await q2;
      if (error || !lote || lote.length === 0) break;
      todos = todos.concat(lote);
      if (lote.length < PAGE) break;
      pagina++;
    }
    return todos;
  }

  const [dadosMes, dadosAno, dadosHist] = await Promise.all([
    buscarPaginado(mesIni, mesFim),
    buscarPaginado(anoIni, mesFim),
    buscarPaginado(`${ano}-01-01`, `${ano}-12-31`),
  ]);

  // Expande rateio para que a categorização feita na divisão entre na DRE
  const rateioInconsist = [];
  const [exMes, exAno, exHist] = await Promise.all([
    _expandirRateios(db, dadosMes, rateioInconsist),
    _expandirRateios(db, dadosAno),
    _expandirRateios(db, dadosHist),
  ]);

  const calMes = _calcularDre(exMes);
  const calAno = _calcularDre(exAno);
  const mesesPt = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  _renderizarDreKPIs(calMes, calAno);
  _renderizarDreTabela(calMes, calAno, mesesPt[mes-1], ano, rateioInconsist);

  window._dreCalMes   = calMes;
  window._dreCalAno   = calAno;
  window._dreHistData = exHist;
  window._dreAno      = ano;
  // Se a aba BI já estiver ativa, renderiza imediatamente
  if (document.getElementById('dre-aba-bi')?.style.display !== 'none') _renderizarChartsBI();
}

function _isUsoLucro(g) {
  const n = normalizarTexto(g.nome);
  return n.includes('uso do lucro') || n.includes('lucro operacional') || n.includes('distribuicao de lucro');
}

function _calcularDre(lancamentos) {
  const map = {};
  const semCategoria = { qtd: 0, totalRec: 0, totalPag: 0, itens: [] };
  const planoIds = new Set(planoContas.map(p => p.id));

  lancamentos.forEach(l => {
    if (!l.plano_conta_id || !planoIds.has(l.plano_conta_id)) {
      semCategoria.qtd++;
      if (l.tipo === 'receber') semCategoria.totalRec += Number(l.valor);
      else                      semCategoria.totalPag += Number(l.valor);
      semCategoria.itens.push({
        id: l.id, descricao: l.descricao || '(sem descrição)', valor: Number(l.valor),
        tipo: l.tipo, data: l.data_pagamento, unidade_id: l.unidade_id || null
      });
    } else {
      map[l.plano_conta_id] = (map[l.plano_conta_id] || 0) + Number(l.valor);
    }
  });

  const gruposRec  = planoContas.filter(p => p.tipo === 'receber' && !p.grupo_id);
  const subcatsRec = planoContas.filter(p => p.tipo === 'receber' &&  p.grupo_id);
  const gruposPag  = planoContas.filter(p => p.tipo === 'pagar'   && !p.grupo_id);
  const subcatsPag = planoContas.filter(p => p.tipo === 'pagar'   &&  p.grupo_id);

  function somarGrupo(grupo, subcats, mapVals) {
    const subs = subcats.filter(s => s.grupo_id === grupo.id)
      .map(s => ({ id: s.id, nome: s.nome, valor: mapVals[s.id] || 0 }));
    const total = subs.reduce((a, s) => a + s.valor, 0) + (mapVals[grupo.id] || 0);
    return { id: grupo.id, nome: grupo.nome, total, subs };
  }

  let receitaBruta = 0;
  const recGrupos = gruposRec.map(g => { const r = somarGrupo(g, subcatsRec, map); receitaBruta += r.total; return r; });

  let totalCMV = 0;
  const cmvGrupos = gruposPag.filter(g => g.is_cmv)
    .map(g => { const r = somarGrupo(g, subcatsPag, map); totalCMV += r.total; return r; });

  const lucroBruto = receitaBruta - totalCMV;

  let totalDesp = 0;
  const despGrupos = gruposPag.filter(g => !g.is_cmv && !_isUsoLucro(g))
    .map(g => { const r = somarGrupo(g, subcatsPag, map); totalDesp += r.total; return r; });

  const ebitda = lucroBruto - totalDesp;

  let totalUsoLucro = 0;
  const usoLucroGrupos = gruposPag.filter(g => _isUsoLucro(g))
    .map(g => { const r = somarGrupo(g, subcatsPag, map); totalUsoLucro += r.total; return r; });

  const resultadoFinal = ebitda - totalUsoLucro;
  const av = (v) => receitaBruta > 0 ? v / receitaBruta * 100 : 0;

  return {
    receitaBruta, recGrupos,
    totalCMV, cmvGrupos,
    lucroBruto,
    totalDesp, despGrupos,
    ebitda,
    totalUsoLucro, usoLucroGrupos,
    resultadoFinal,
    margemBruta:   av(lucroBruto),
    margemEbitda:  av(ebitda),
    margemLiquida: av(resultadoFinal),
    cmvPct:        av(totalCMV),
    semCategoria,
  };
}

function _renderizarDreKPIs(calMes, calAno) {
  const el = document.getElementById('dre-kpis');
  if (!el) return;
  function kpi(icon, label, val, pct, cor, borderCor) {
    const corVal = val >= 0 ? '#1a7a3c' : '#c0392b';
    return `<div class="dre-kpi" style="border-left-color:${borderCor};">
      <div class="dre-kpi-icone" style="background:${cor}18;color:${cor};"><i class="fas ${icon}"></i></div>
      <div class="dre-kpi-info">
        <span class="dre-kpi-label">${label}</span>
        <span class="dre-kpi-valor" style="color:${corVal};">${formatarMoeda(val)}</span>
        ${pct !== null ? `<span class="dre-kpi-sub">${pct.toFixed(1)}% da receita</span>` : ''}
      </div>
    </div>`;
  }
  el.innerHTML = `<div class="dre-kpi-grid-inner">
    ${kpi('fa-arrow-trend-up',  'Receita Bruta',   calMes.receitaBruta,   null,                  '#1a7a3c','#1a7a3c')}
    ${kpi('fa-industry',        'CMV',              calMes.totalCMV,       calMes.cmvPct,         '#e67e22','#e67e22')}
    ${kpi('fa-coins',           'Lucro Bruto',      calMes.lucroBruto,     calMes.margemBruta,    '#27ae60','#27ae60')}
    ${kpi('fa-chart-line',      'EBITDA',           calMes.ebitda,         calMes.margemEbitda,   '#1a3a7a','#1a3a7a')}
    ${kpi('fa-wallet',          'Resultado Final',  calMes.resultadoFinal, calMes.margemLiquida,  calMes.resultadoFinal >= 0 ? '#1a3a7a' : '#c0392b', calMes.resultadoFinal >= 0 ? '#1a3a7a' : '#c0392b')}
  </div>`;
}

function _renderizarDreTabela(calMes, calAno, nomeMes, ano, rateioInconsist) {
  const el = document.getElementById('dre-tabela');
  if (!el) return;

  const uniNomeMap = {};
  (typeof unidades !== 'undefined' ? unidades : []).forEach(u => { uniNomeMap[u.id] = u.nome; });
  const fmtDataBR = d => d ? d.split('-').reverse().join('/') : '—';

  // Aviso de rateio inconsistente (soma dos itens ≠ valor pago)
  let rateioHtml = '';
  const ri = rateioInconsist || [];
  if (ri.length > 0) {
    const totalDif = ri.reduce((a, x) => a + (x.somaRateio - x.valor), 0);
    const linhas = [...ri].sort((a, b) => Math.abs(b.somaRateio - b.valor) - Math.abs(a.somaRateio - a.valor)).map(x => {
      const dif = x.somaRateio - x.valor;
      return `<tr style="border-bottom:1px solid #f3d6d3;">
        <td style="padding:6px 8px;white-space:nowrap;color:#666;font-size:12px;">${fmtDataBR(x.data)}</td>
        <td style="padding:6px 8px;font-size:13px;">${x.descricao}</td>
        <td style="padding:6px 8px;font-size:12px;color:#666;">${uniNomeMap[x.unidade_id] || '<em style=\"color:#c0392b;\">sem unidade</em>'}</td>
        <td style="padding:6px 8px;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;">${formatarMoeda(x.valor)}</td>
        <td style="padding:6px 8px;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;">${x.semItens ? '<em style=\"color:#c0392b;\">sem itens</em>' : formatarMoeda(x.somaRateio)}</td>
        <td style="padding:6px 8px;text-align:right;white-space:nowrap;font-weight:600;font-variant-numeric:tabular-nums;color:#c0392b;">${dif >= 0 ? '+' : ''}${formatarMoeda(dif)}</td>
        <td style="padding:6px 8px;text-align:right;">
          <button class="btn btn-sm btn-primary" style="font-size:11px;padding:3px 10px;" onclick="editarLancamento('${x.id}','${x.tipo}')">
            <i class="fas fa-wrench"></i> Corrigir
          </button>
        </td>
      </tr>`;
    }).join('');
    rateioHtml = `<div style="background:#fdecea;border:1px solid #e74c3c;border-radius:10px;padding:14px 16px;margin-bottom:16px;">
      <div style="display:flex;align-items:flex-start;gap:12px;">
        <i class="fas fa-scale-unbalanced" style="color:#e74c3c;font-size:20px;flex-shrink:0;margin-top:2px;"></i>
        <div style="flex:1;">
          <strong style="color:#c0392b;font-size:13px;">Rateio inconsistente — soma das categorias ≠ valor pago</strong>
          <p style="margin:4px 0 0;font-size:13px;color:#555;">
            <strong>${ri.length}</strong> lançamento${ri.length > 1 ? 's' : ''} com rateio que não bate com o valor pago
            (diferença total no rateio: <strong>${totalDif >= 0 ? '+' : ''}${formatarMoeda(totalDif)}</strong>).
            A DRE ancora no valor pago e usa o rateio só para a proporção — mas o ideal é corrigir a divisão na origem.
          </p>
        </div>
      </div>
      <details style="margin-top:10px;" open>
        <summary style="cursor:pointer;font-size:13px;font-weight:600;color:#c0392b;user-select:none;">
          <i class="fas fa-list"></i> Ver e corrigir
        </summary>
        <div style="overflow-x:auto;margin-top:10px;background:#fff;border:1px solid #f3d6d3;border-radius:8px;">
          <table style="width:100%;border-collapse:collapse;min-width:680px;">
            <thead>
              <tr style="background:#fbe4e2;text-align:left;">
                <th style="padding:7px 8px;font-size:11px;color:#a5281c;text-transform:uppercase;letter-spacing:.03em;">Data</th>
                <th style="padding:7px 8px;font-size:11px;color:#a5281c;text-transform:uppercase;letter-spacing:.03em;">Descrição</th>
                <th style="padding:7px 8px;font-size:11px;color:#a5281c;text-transform:uppercase;letter-spacing:.03em;">Unidade</th>
                <th style="padding:7px 8px;font-size:11px;color:#a5281c;text-transform:uppercase;letter-spacing:.03em;text-align:right;">Valor pago</th>
                <th style="padding:7px 8px;font-size:11px;color:#a5281c;text-transform:uppercase;letter-spacing:.03em;text-align:right;">Soma rateio</th>
                <th style="padding:7px 8px;font-size:11px;color:#a5281c;text-transform:uppercase;letter-spacing:.03em;text-align:right;">Diferença</th>
                <th style="padding:7px 8px;"></th>
              </tr>
            </thead>
            <tbody>${linhas}</tbody>
          </table>
        </div>
        <p style="margin:8px 2px 0;font-size:12px;color:#888;">Clique em <strong>Corrigir</strong>, ajuste a divisão para somar o valor pago e salve. Depois clique em <strong>Gerar DRE</strong>.</p>
      </details>
    </div>`;
  }

  // Aviso de lançamentos sem categoria
  const sc = calMes.semCategoria;
  let avisoHtml = '';
  if (sc.qtd > 0) {
    const totalExcluido = sc.totalRec + sc.totalPag;
    const uniNome = {};
    (typeof unidades !== 'undefined' ? unidades : []).forEach(u => { uniNome[u.id] = u.nome; });
    const fmtData = d => d ? d.split('-').reverse().join('/') : '—';
    const itens = [...(sc.itens || [])].sort((a, b) => b.valor - a.valor);
    const linhas = itens.map(it => {
      const chip = it.tipo === 'receber'
        ? '<span style="font-size:11px;color:#1a7a3c;background:#e8f6ee;padding:1px 6px;border-radius:4px;">Receita</span>'
        : '<span style="font-size:11px;color:#b7770d;background:#fdf3e0;padding:1px 6px;border-radius:4px;">Despesa</span>';
      return `<tr style="border-bottom:1px solid #f0e6cc;">
        <td style="padding:6px 8px;white-space:nowrap;color:#666;font-size:12px;">${fmtData(it.data)}</td>
        <td style="padding:6px 8px;font-size:13px;">${it.descricao}</td>
        <td style="padding:6px 8px;font-size:12px;color:#666;">${uniNome[it.unidade_id] || '<em style=\"color:#c0392b;\">sem unidade</em>'}</td>
        <td style="padding:6px 8px;">${chip}</td>
        <td style="padding:6px 8px;text-align:right;white-space:nowrap;font-weight:600;font-variant-numeric:tabular-nums;color:${it.tipo === 'receber' ? '#1a7a3c' : '#b7770d'};">${formatarMoeda(it.valor)}</td>
        <td style="padding:6px 8px;text-align:right;">
          <button class="btn btn-sm btn-primary" style="font-size:11px;padding:3px 10px;" onclick="editarLancamento('${it.id}','${it.tipo}')">
            <i class="fas fa-tag"></i> Categorizar
          </button>
        </td>
      </tr>`;
    }).join('');
    avisoHtml = `<div style="background:#fff8e1;border:1px solid #f39c12;border-radius:10px;padding:14px 16px;margin-bottom:16px;">
      <div style="display:flex;align-items:flex-start;gap:12px;">
        <i class="fas fa-exclamation-triangle" style="color:#f39c12;font-size:20px;flex-shrink:0;margin-top:2px;"></i>
        <div style="flex:1;">
          <strong style="color:#b7770d;font-size:13px;">Lançamentos sem categoria excluídos da DRE</strong>
          <p style="margin:4px 0 0;font-size:13px;color:#555;">
            <strong>${sc.qtd}</strong> lançamento${sc.qtd > 1 ? 's' : ''} sem Plano de Contas definido
            ${sc.qtd > 1 ? 'foram' : 'foi'} ignorado${sc.qtd > 1 ? 's' : ''} neste período — total de <strong>${formatarMoeda(totalExcluido)}</strong>
            ${sc.totalRec > 0 ? ` (receitas: ${formatarMoeda(sc.totalRec)}` : ''}${sc.totalPag > 0 ? `${sc.totalRec > 0 ? ' | ' : ' ('}despesas: ${formatarMoeda(sc.totalPag)}` : ''}${sc.totalRec > 0 || sc.totalPag > 0 ? ')' : ''}.
          </p>
        </div>
      </div>
      <details style="margin-top:10px;">
        <summary style="cursor:pointer;font-size:13px;font-weight:600;color:#b7770d;user-select:none;">
          <i class="fas fa-list"></i> Ver e categorizar ${sc.qtd > 1 ? 'os lançamentos' : 'o lançamento'}
        </summary>
        <div style="overflow-x:auto;margin-top:10px;background:#fff;border:1px solid #f0e6cc;border-radius:8px;">
          <table style="width:100%;border-collapse:collapse;min-width:640px;">
            <thead>
              <tr style="background:#fdf3e0;text-align:left;">
                <th style="padding:7px 8px;font-size:11px;color:#8a6d00;text-transform:uppercase;letter-spacing:.03em;">Data</th>
                <th style="padding:7px 8px;font-size:11px;color:#8a6d00;text-transform:uppercase;letter-spacing:.03em;">Descrição</th>
                <th style="padding:7px 8px;font-size:11px;color:#8a6d00;text-transform:uppercase;letter-spacing:.03em;">Unidade</th>
                <th style="padding:7px 8px;font-size:11px;color:#8a6d00;text-transform:uppercase;letter-spacing:.03em;">Tipo</th>
                <th style="padding:7px 8px;font-size:11px;color:#8a6d00;text-transform:uppercase;letter-spacing:.03em;text-align:right;">Valor</th>
                <th style="padding:7px 8px;"></th>
              </tr>
            </thead>
            <tbody>${linhas}</tbody>
          </table>
        </div>
        <p style="margin:8px 2px 0;font-size:12px;color:#888;">Após categorizar, clique em <strong>Gerar DRE</strong> novamente para atualizar os números.</p>
      </details>
    </div>`;
  }

  const recB  = calMes.receitaBruta;
  const recBA = calAno.receitaBruta;

  const fmtM = v => formatarMoeda(v);
  const fmtP = (v, base) => base > 0 ? (v / base * 100).toFixed(1) + '%' : '—';

  function rowSecao(label, cor) {
    return `<tr style="background:${cor};color:#fff;">
      <td colspan="5" style="padding:10px 16px;font-weight:800;font-size:12px;letter-spacing:0.8px;text-transform:uppercase;">${label}</td></tr>`;
  }
  function rowGrupo(uid, nome, vM, vA) {
    const cM = vM < 0 ? '#e74c3c' : '#222', cA = vA < 0 ? '#e74c3c' : '#222';
    return `<tr class="dre-grupo-row" onclick="toggleDreGrupo('${uid}')" style="background:#f8f9fa;cursor:pointer;">
      <td style="padding:9px 12px 9px 20px;font-weight:600;font-size:13px;">
        <i class="fas fa-chevron-right dre-chevron" id="dre-chev-${uid}" style="font-size:10px;margin-right:8px;color:#aaa;transition:transform 0.2s;"></i>${nome}</td>
      <td style="text-align:right;padding:9px 14px;font-weight:600;color:${cM};">${fmtM(vM)}</td>
      <td style="text-align:right;padding:9px 8px;font-size:11px;color:#aaa;">${fmtP(vM, recB)}</td>
      <td style="text-align:right;padding:9px 14px;font-weight:600;color:${cA};">${fmtM(vA)}</td>
      <td style="text-align:right;padding:9px 8px;font-size:11px;color:#aaa;">${fmtP(vA, recBA)}</td></tr>`;
  }
  function rowSub(uid, nome, vM, vA) {
    return `<tr class="dre-subcat-row" data-dre-filho="${uid}" style="display:none;">
      <td style="padding:6px 12px 6px 48px;font-size:12px;color:#555;">${nome}</td>
      <td style="text-align:right;padding:6px 14px;font-size:12px;">${vM > 0 ? fmtM(vM) : '<span style="color:#ccc">—</span>'}</td>
      <td style="text-align:right;padding:6px 8px;font-size:11px;color:#ccc;">${vM > 0 ? fmtP(vM, recB) : ''}</td>
      <td style="text-align:right;padding:6px 14px;font-size:12px;">${vA > 0 ? fmtM(vA) : '<span style="color:#ccc">—</span>'}</td>
      <td style="text-align:right;padding:6px 8px;font-size:11px;color:#ccc;">${vA > 0 ? fmtP(vA, recBA) : ''}</td></tr>`;
  }
  function rowTotal(label, vM, vA, bgCor, txtCor) {
    return `<tr style="background:${bgCor};">
      <td style="padding:9px 16px;font-weight:700;font-size:13px;color:${txtCor};">${label}</td>
      <td style="text-align:right;padding:9px 14px;font-weight:700;color:${txtCor};">${fmtM(vM)}</td>
      <td style="text-align:right;padding:9px 8px;font-size:11px;color:${txtCor};opacity:.7;">${fmtP(vM, recB)}</td>
      <td style="text-align:right;padding:9px 14px;font-weight:700;color:${txtCor};">${fmtM(vA)}</td>
      <td style="text-align:right;padding:9px 8px;font-size:11px;color:${txtCor};opacity:.7;">${fmtP(vA, recBA)}</td></tr>`;
  }
  function rowDestaque(label, vM, vA, bgCor) {
    const cM = vM >= 0 ? '#7dff8a' : '#ff9999', cA = vA >= 0 ? '#7dff8a' : '#ff9999';
    return `<tr style="background:${bgCor};border-top:2px solid rgba(255,255,255,0.25);">
      <td style="padding:14px 16px;font-weight:900;font-size:15px;color:#fff;">${label}</td>
      <td style="text-align:right;padding:14px 14px;font-weight:900;font-size:17px;color:${cM};">${fmtM(vM)}</td>
      <td style="text-align:right;padding:14px 8px;font-size:12px;color:rgba(255,255,255,.75);">${fmtP(vM, recB)}</td>
      <td style="text-align:right;padding:14px 14px;font-weight:900;font-size:17px;color:${cA};">${fmtM(vA)}</td>
      <td style="text-align:right;padding:14px 8px;font-size:12px;color:rgba(255,255,255,.75);">${fmtP(vA, recBA)}</td></tr>`;
  }
  function rowMargem(lbl, pM, pA, bgCor) {
    return `<tr style="background:${bgCor};">
      <td colspan="5" style="text-align:center;padding:5px 12px;font-size:12px;color:rgba(255,255,255,.8);">
        ${lbl}: <strong>${pM.toFixed(1)}%</strong> no mês &nbsp;|&nbsp; <strong>${pA.toFixed(1)}%</strong> acumulado
      </td></tr>`;
  }
  function rowSep() { return `<tr style="height:6px;background:#f0f2f5;"><td colspan="5"></td></tr>`; }

  function gruposHtml(grupos, gruposAno, uid_prefix) {
    return grupos.map(g => {
      const gA = gruposAno.find(x => x.id === g.id) || { total: 0, subs: [] };
      let h = rowGrupo(uid_prefix + g.id, g.nome, g.total, gA.total);
      g.subs.forEach(s => { const sA = gA.subs.find(x => x.id === s.id); h += rowSub(uid_prefix + g.id, s.nome, s.valor, sA?.valor || 0); });
      return h;
    }).join('');
  }

  let html = rateioHtml + avisoHtml + `<div style="overflow-x:auto;">
  <table style="width:100%;border-collapse:collapse;border-radius:12px;overflow:hidden;box-shadow:0 2px 14px rgba(0,0,0,0.09);">
  <thead><tr style="background:#2c3e50;color:#fff;">
    <th style="padding:12px 16px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;min-width:220px;">Descrição</th>
    <th style="padding:12px 14px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;white-space:nowrap;">${nomeMes} ${ano}</th>
    <th style="padding:12px 8px;text-align:right;font-size:10px;font-weight:600;color:rgba(255,255,255,.6);">AV%</th>
    <th style="padding:12px 14px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;white-space:nowrap;">Acum. ${ano}</th>
    <th style="padding:12px 8px;text-align:right;font-size:10px;font-weight:600;color:rgba(255,255,255,.6);">AV%</th>
  </tr></thead><tbody>`;

  // ── RECEITA BRUTA
  html += rowSecao('Receita Bruta', '#1a7a3c');
  html += gruposHtml(calMes.recGrupos, calAno.recGrupos, 'rec-');
  html += rowTotal('Total Receita Bruta', calMes.receitaBruta, calAno.receitaBruta, '#d5f5e3', '#1a7a3c');
  html += rowSep();

  // ── CMV
  if (calMes.cmvGrupos.length || calMes.totalCMV > 0) {
    html += rowSecao('(-) Custo das Mercadorias Vendidas — CMV', '#b7770d');
    html += gruposHtml(calMes.cmvGrupos, calAno.cmvGrupos, 'cmv-');
    html += rowTotal('Total CMV', calMes.totalCMV, calAno.totalCMV, '#fef9e7', '#b7770d');
    html += rowSep();
  }

  // ── LUCRO BRUTO
  html += rowDestaque('▶  Lucro Bruto', calMes.lucroBruto, calAno.lucroBruto, '#1a7a3c');
  html += rowMargem('Margem Bruta', calMes.margemBruta, calAno.margemBruta, '#155e34');
  html += rowSep();

  // ── DESPESAS OPERACIONAIS
  html += rowSecao('(-) Despesas Operacionais', '#c0392b');
  html += gruposHtml(calMes.despGrupos, calAno.despGrupos, 'desp-');
  html += rowTotal('Total Despesas Operacionais', calMes.totalDesp, calAno.totalDesp, '#fadbd8', '#c0392b');
  html += rowSep();

  // ── EBITDA
  html += rowDestaque('★  EBITDA', calMes.ebitda, calAno.ebitda, '#1a3a7a');
  html += rowMargem('Margem EBITDA', calMes.margemEbitda, calAno.margemEbitda, '#16347a');
  html += rowSep();

  // ── USO DO LUCRO OPERACIONAL
  if (calMes.usoLucroGrupos.length || calMes.totalUsoLucro > 0) {
    html += rowSecao('(-) Uso do Lucro Operacional', '#7d3c98');
    html += gruposHtml(calMes.usoLucroGrupos, calAno.usoLucroGrupos, 'uso-');
    html += rowTotal('Total Uso do Lucro', calMes.totalUsoLucro, calAno.totalUsoLucro, '#e8daef', '#7d3c98');
    html += rowSep();
  }

  // ── RESULTADO FINAL
  html += rowDestaque('◆  Resultado Final', calMes.resultadoFinal, calAno.resultadoFinal, '#1a1a2e');
  html += rowMargem('Margem Líquida', calMes.margemLiquida, calAno.margemLiquida, '#111122');

  html += '</tbody></table></div>';
  el.innerHTML = html;
}

function toggleDreGrupo(uid) {
  document.querySelectorAll(`[data-dre-filho="${uid}"]`).forEach(r => {
    r.style.display = r.style.display === 'none' ? '' : 'none';
  });
  const chev = document.getElementById(`dre-chev-${uid}`);
  if (chev) chev.style.transform = chev.style.transform ? '' : 'rotate(90deg)';
}

function trocarAbaDre(aba) {
  document.getElementById('dre-aba-demonstrativo').style.display = aba === 'demonstrativo' ? '' : 'none';
  document.getElementById('dre-aba-bi').style.display             = aba === 'bi'             ? '' : 'none';
  document.getElementById('dre-tab-btn-demonstrativo').classList.toggle('ativo', aba === 'demonstrativo');
  document.getElementById('dre-tab-btn-bi').classList.toggle('ativo',             aba === 'bi');
  if (aba === 'bi') _renderizarChartsBI();
}

function _renderizarChartsBI() {
  if (!window._dreCalMes) return;
  _dreWaterfall(window._dreCalMes);
  _dreDonutDespesas(window._dreCalMes);
  _dreEvolucao(window._dreHistData || [], window._dreAno);
}

function _dreWaterfall(cal) {
  const ctx = document.getElementById('dre-chart-waterfall');
  if (!ctx) return;
  if (dreChartWaterfall) dreChartWaterfall.destroy();
  const labels = ['Receita', 'CMV', 'Lucro Bruto', 'Desp. Oper.', 'EBITDA', 'Uso Lucro', 'Resultado'];
  const valores = [cal.receitaBruta, cal.totalCMV, cal.lucroBruto, cal.totalDesp, cal.ebitda, cal.totalUsoLucro, cal.resultadoFinal];
  const cores   = ['#27ae60','#e74c3c','#1a7a3c','#e74c3c','#1a3a7a','#7d3c98', cal.resultadoFinal >= 0 ? '#1a1a2e' : '#e74c3c'];
  dreChartWaterfall = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ data: valores, backgroundColor: cores, borderRadius: 6, borderSkipped: false }] },
    options: {
      responsive: true, plugins: { legend: { display: false },
        tooltip: { callbacks: { label: c => ' ' + formatarMoeda(c.raw) } } },
      scales: { y: { ticks: { callback: v => 'R$' + (v/1000).toFixed(0) + 'k' } } }
    }
  });
}

function _dreDonutDespesas(cal) {
  const ctx = document.getElementById('dre-chart-despesas');
  if (!ctx) return;
  if (dreChartDespesas) dreChartDespesas.destroy();
  const grupos = [...cal.despGrupos, ...cal.cmvGrupos].filter(g => g.total > 0);
  const cores = ['#3498db','#e74c3c','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#c0392b','#16a085','#8e44ad','#d35400','#95a5a6'];
  dreChartDespesas = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: grupos.map(g => g.nome),
      datasets: [{ data: grupos.map(g => g.total), backgroundColor: cores.slice(0, grupos.length), borderWidth: 2, borderColor: '#fff', hoverOffset: 8 }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'right', labels: { font: { size: 11 }, boxWidth: 12 } },
        tooltip: { callbacks: { label: c => { const t = c.dataset.data.reduce((a,b)=>a+b,0); return ` ${formatarMoeda(c.raw)} (${(c.raw/t*100).toFixed(1)}%)`; } } }
      }
    }
  });
}

function _dreEvolucao(histData, ano) {
  const ctx = document.getElementById('dre-chart-evolucao');
  if (!ctx) return;
  if (dreChartEvolucao) dreChartEvolucao.destroy();
  const rec = Array(12).fill(0), desp = Array(12).fill(0), cmv = Array(12).fill(0);
  histData.forEach(l => {
    const m = parseInt(l.data_pagamento.slice(5,7)) - 1;
    if (m < 0 || m > 11) return;
    const pc = planoContas.find(p => p.id === l.plano_conta_id);
    if (!pc) return;
    if (l.tipo === 'receber') { rec[m] += Number(l.valor); return; }
    const pai = pc.grupo_id ? planoContas.find(p => p.id === pc.grupo_id) : pc;
    if (pai?.is_cmv) cmv[m] += Number(l.valor);
    else if (!_isUsoLucro(pai || pc)) desp[m] += Number(l.valor);
  });
  const ebitda = Array(12).fill(0).map((_,i) => rec[i] - cmv[i] - desp[i]);
  const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  dreChartEvolucao = new Chart(ctx, {
    data: {
      labels: meses,
      datasets: [
        { type:'bar',  label:'Receita',   data: rec,    backgroundColor:'rgba(26,122,60,.7)',  borderRadius:4, order:2 },
        { type:'bar',  label:'Despesas',  data: desp.map(v=>-v), backgroundColor:'rgba(192,57,43,.65)', borderRadius:4, order:2 },
        { type:'line', label:'EBITDA',    data: ebitda, borderColor:'#1a3a7a', backgroundColor:'rgba(26,58,122,.08)',
          borderWidth:2.5, pointRadius:4, pointBackgroundColor:'#1a3a7a', tension:0.35, fill:true, order:1 }
      ]
    },
    options: {
      responsive: true, interaction:{ mode:'index', intersect:false },
      plugins: { legend:{ position:'top' }, tooltip:{ callbacks:{ label: c => ` ${c.dataset.label}: ${formatarMoeda(Math.abs(c.raw))}` } } },
      scales: { y: { ticks:{ callback: v => 'R$'+(v/1000).toFixed(0)+'k' } } }
    }
  });
}

async function carregarRelatorio() {
  if (!(await garantirSessao())) return;
  const db        = obterSupabase();
  const unidadeId = document.getElementById('filtro-unidade-relatorio')?.value;
  const ano       = document.getElementById('filtro-ano-relatorio')?.value || new Date().getFullYear();

  let query = db.from('lancamentos')
    .select('*, plano_contas(nome)')
    .gte('vencimento', `${ano}-01-01`)
    .lte('vencimento', `${ano}-12-31`);
  if (unidadeId) query = query.eq('unidade_id', unidadeId);

  const { data, error } = await q(query);
  if (error) { mostrarToast('Erro ao carregar relatório.', 'erro'); return; }

  const lancamentos  = data || [];
  const totalPagar   = lancamentos.filter(l => l.tipo === 'pagar').reduce((s,l) => s+Number(l.valor), 0);
  const totalReceber = lancamentos.filter(l => l.tipo === 'receber').reduce((s,l) => s+Number(l.valor), 0);

  document.getElementById('relatorio-total-pagar').textContent   = formatarMoeda(totalPagar);
  document.getElementById('relatorio-total-receber').textContent = formatarMoeda(totalReceber);
  const resEl    = document.getElementById('relatorio-resultado');
  const resultado = totalReceber - totalPagar;
  resEl.textContent = formatarMoeda(resultado);
  resEl.style.color = resultado >= 0 ? '#27ae60' : '#e74c3c';

  await renderizarGraficoMensal('grafico-relatorio-mensal', unidadeId, 12, ano);

  const despesas = lancamentos.filter(l => l.tipo === 'pagar');
  const porCatDesp = {};
  despesas.forEach(l => {
    const nome = l.plano_contas?.nome || 'Sem categoria';
    porCatDesp[nome] = (porCatDesp[nome] || 0) + Number(l.valor);
  });
  if (graficoRelatorioCategoriasInst) graficoRelatorioCategoriasInst.destroy();
  graficoRelatorioCategoriasInst = renderizarPizza('grafico-relatorio-categorias',
    Object.keys(porCatDesp), Object.values(porCatDesp));

  const entradas = lancamentos.filter(l => l.tipo === 'receber');
  const porCatRec = {};
  entradas.forEach(l => {
    const nome = l.plano_contas?.nome || 'Sem categoria';
    porCatRec[nome] = (porCatRec[nome] || 0) + Number(l.valor);
  });
  if (graficoRelatorioReceitasInst) graficoRelatorioReceitasInst.destroy();
  graficoRelatorioReceitasInst = renderizarPizza('grafico-relatorio-receitas',
    Object.keys(porCatRec), Object.values(porCatRec));
}

// =========================================================
// RELATÓRIO DE CONCILIAÇÃO
// =========================================================
let _dadosConciliacao = [];

async function carregarRelatorioConciliacao() {
  const de     = document.getElementById('rel-concil-de')?.value;
  const ate    = document.getElementById('rel-concil-ate')?.value;
  const banco  = document.getElementById('rel-concil-banco')?.value;
  const tipo   = document.getElementById('rel-concil-tipo')?.value;
  if (!de || !ate) { mostrarToast('Selecione o período.', 'erro'); return; }

  const btn = document.querySelector('button[onclick="carregarRelatorioConciliacao()"]');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Carregando...'; }

  try {
    const db = obterSupabase();
    let qry = db.from('lancamentos')
      .select('id, tipo, descricao, valor, valor_pago, data_pagamento, ofx_id, fornecedores(nome), plano_contas(nome), bancos(nome)')
      .eq('status', 'pago')
      .gte('data_pagamento', de)
      .lte('data_pagamento', ate)
      .order('data_pagamento', { ascending: true });
    if (banco) qry = qry.eq('banco_id', banco);
    if (tipo)  qry = qry.eq('tipo', tipo);
    const { data, error } = await q(qry);
    if (error) throw error;
    _dadosConciliacao = data || [];
    _renderizarTabelaConciliacao(_dadosConciliacao, de, ate);
  } catch (e) {
    mostrarToast('Erro ao gerar relatório.', 'erro');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-search"></i> Gerar Relatório'; }
  }
}

function _renderizarTabelaConciliacao(lista, de, ate) {
  const resultado = document.getElementById('rel-concil-resultado');
  const tbody     = document.getElementById('rel-concil-tbody');
  const kpisEl    = document.getElementById('rel-concil-kpis');
  const tituloEl  = document.getElementById('rel-concil-titulo');
  resultado.style.display = 'block';

  const pagar    = lista.filter(l => l.tipo === 'pagar');
  const receber  = lista.filter(l => l.tipo === 'receber');
  const viaOFX   = lista.filter(l => l.ofx_id);
  const manual   = lista.filter(l => !l.ofx_id);
  const totalPag = pagar.reduce((s, l) => s + Number(l.valor), 0);
  const totalRec = receber.reduce((s, l) => s + Number(l.valor), 0);

  kpisEl.innerHTML = [
    { label: 'Total Despesas', val: formatarMoeda(totalPag), cor: '#e74c3c', icon: 'fa-arrow-up' },
    { label: 'Total Receitas', val: formatarMoeda(totalRec), cor: '#27ae60', icon: 'fa-arrow-down' },
    { label: 'Resultado',      val: formatarMoeda(totalRec - totalPag), cor: totalRec >= totalPag ? '#27ae60' : '#e74c3c', icon: 'fa-balance-scale' },
    { label: 'Via Extrato (OFX)', val: `${viaOFX.length} lançamento(s)`, cor: '#2980b9', icon: 'fa-university' },
    { label: 'Baixa Manual',   val: `${manual.length} lançamento(s)`, cor: '#e67e22', icon: 'fa-hand-holding-usd' },
  ].map(k => `
    <div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:12px 14px;border-left:4px solid ${k.cor};">
      <div style="font-size:11px;color:#888;margin-bottom:4px;"><i class="fas ${k.icon}" style="margin-right:4px;"></i>${k.label}</div>
      <div style="font-size:15px;font-weight:700;color:${k.cor};">${k.val}</div>
    </div>`).join('');

  tituloEl.textContent = `${lista.length} lançamento(s) — ${formatarData(de)} a ${formatarData(ate)}`;

  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="sem-dados">Nenhum lançamento encontrado no período.</td></tr>`;
    return;
  }

  const origemLabel = { ofx: 'OFX', manual: 'Manual', desconto: 'Desconto' };
  const origemCor   = { ofx: '#2980b9', manual: '#e67e22', desconto: '#8e44ad' };

  tbody.innerHTML = lista.map(l => {
    const origem  = l.ofx_id ? 'ofx' : 'manual';
    const cor     = origemCor[origem];
    const bgLinha = l.tipo === 'receber' ? '' : '';
    return `<tr style="border-bottom:1px solid #f0f0f0;">
      <td style="padding:7px 10px;white-space:nowrap;">${formatarData(l.data_pagamento)}</td>
      <td style="padding:7px 10px;font-size:12px;color:#555;">${l.fornecedores?.nome || '—'}</td>
      <td style="padding:7px 10px;">${l.descricao}</td>
      <td style="padding:7px 10px;font-size:12px;color:#666;">${l.plano_contas?.nome || '—'}</td>
      <td style="padding:7px 10px;font-size:12px;">${l.bancos?.nome || '—'}</td>
      <td style="padding:7px 10px;text-align:right;white-space:nowrap;">
        <strong style="color:${l.tipo==='pagar'?'#e74c3c':'#27ae60'}">${l.tipo==='pagar'?'-':'+'} ${formatarMoeda(l.valor)}</strong>
      </td>
      <td style="padding:7px 10px;">
        <span style="font-size:11px;padding:2px 7px;border-radius:10px;background:${l.tipo==='pagar'?'#fef0ee':'#eafaf1'};color:${l.tipo==='pagar'?'#c0392b':'#1a6e3b'};font-weight:600;">
          ${l.tipo === 'pagar' ? 'Pagar' : 'Receber'}
        </span>
      </td>
      <td style="padding:7px 10px;">
        <span style="font-size:11px;padding:2px 7px;border-radius:10px;background:${cor}20;color:${cor};font-weight:600;">
          <i class="fas ${origem==='ofx'?'fa-university':'fa-hand-holding-usd'}" style="margin-right:3px;"></i>${origemLabel[origem]}
        </span>
      </td>
    </tr>`;
  }).join('');
}

function imprimirRelatorioConciliacao() {
  const de  = document.getElementById('rel-concil-de')?.value  || '';
  const ate = document.getElementById('rel-concil-ate')?.value || '';
  const lista = _dadosConciliacao;
  if (!lista.length) return;

  const totalPag = lista.filter(l=>l.tipo==='pagar').reduce((s,l)=>s+Number(l.valor),0);
  const totalRec = lista.filter(l=>l.tipo==='receber').reduce((s,l)=>s+Number(l.valor),0);
  const resultado = totalRec - totalPag;

  const linhas = lista.map(l => {
    const origem = l.ofx_id ? 'OFX' : 'Manual';
    return `<tr>
      <td>${formatarData(l.data_pagamento)}</td>
      <td>${l.fornecedores?.nome || '—'}</td>
      <td>${l.descricao}</td>
      <td>${l.plano_contas?.nome || '—'}</td>
      <td>${l.bancos?.nome || '—'}</td>
      <td style="text-align:right">${l.tipo==='pagar'?'- ':'+ '}${formatarMoeda(l.valor)}</td>
      <td>${l.tipo === 'pagar' ? 'Despesa' : 'Receita'}</td>
      <td>${origem}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html lang="pt-BR"><head>
    <meta charset="UTF-8">
    <title>Relatório de Conciliação — ${formatarData(de)} a ${formatarData(ate)}</title>
    <style>
      body { font-family: Arial, sans-serif; font-size: 12px; color: #222; margin: 20px; }
      h2 { font-size: 16px; margin-bottom: 4px; color: #c0392b; }
      .periodo { font-size: 12px; color: #666; margin-bottom: 16px; }
      .resumo { display: flex; gap: 24px; margin-bottom: 20px; flex-wrap: wrap; }
      .resumo-item { background: #f5f5f5; padding: 8px 14px; border-radius: 6px; }
      .resumo-item .label { font-size: 11px; color: #888; }
      .resumo-item .valor { font-size: 14px; font-weight: 700; }
      table { width: 100%; border-collapse: collapse; }
      th { background: #f0f0f0; padding: 7px 8px; text-align: left; font-size: 11px; border-bottom: 2px solid #ccc; }
      td { padding: 6px 8px; border-bottom: 1px solid #eee; font-size: 11px; }
      tr:nth-child(even) { background: #fafafa; }
      .verde { color: #27ae60; font-weight: 700; }
      .vermelho { color: #c0392b; font-weight: 700; }
      @media print { body { margin: 10px; } }
    </style>
  </head><body>
    <h2><i>Relatório de Conciliação</i></h2>
    <div class="periodo">Período: ${formatarData(de)} a ${formatarData(ate)} &nbsp;|&nbsp; Gerado em: ${new Date().toLocaleDateString('pt-BR')}</div>
    <div class="resumo">
      <div class="resumo-item"><div class="label">Total Despesas</div><div class="valor vermelho">${formatarMoeda(totalPag)}</div></div>
      <div class="resumo-item"><div class="label">Total Receitas</div><div class="valor verde">${formatarMoeda(totalRec)}</div></div>
      <div class="resumo-item"><div class="label">Resultado</div><div class="valor ${resultado>=0?'verde':'vermelho'}">${formatarMoeda(resultado)}</div></div>
      <div class="resumo-item"><div class="label">Total de lançamentos</div><div class="valor">${lista.length}</div></div>
    </div>
    <table>
      <thead><tr>
        <th>Data Pgto</th><th>Fornecedor</th><th>Descrição</th><th>Categoria</th>
        <th>Banco</th><th>Valor</th><th>Tipo</th><th>Origem</th>
      </tr></thead>
      <tbody>${linhas}</tbody>
    </table>
  </body></html>`;

  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 400);
}

// =========================================================
// GRÁFICOS
// =========================================================
async function renderizarGraficoMensal(canvasId, unidadeId, quantMeses, anoFixo) {
  const db = obterSupabase();
  const hoje = new Date();
  const labels = [], dadosPagar = [], dadosReceber = [];
  const mesesPt = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

  for (let i = quantMeses - 1; i >= 0; i--) {
    const data = anoFixo ? new Date(anoFixo, i, 1) : new Date(hoje.getFullYear(), hoje.getMonth()-i, 1);
    const ano  = data.getFullYear();
    const mes  = data.getMonth();
    const ini  = `${ano}-${String(mes+1).padStart(2,'0')}-01`;
    const fim  = new Date(ano, mes+1, 0).toISOString().split('T')[0];
    labels.push(`${mesesPt[mes]}/${String(ano).slice(-2)}`);

    const lista = await fetchTodosPag((de, ate) => {
      let qry = db.from('lancamentos').select('tipo, valor').gte('vencimento', ini).lte('vencimento', fim).range(de, ate);
      if (unidadeId) qry = qry.eq('unidade_id', unidadeId);
      return qry;
    });
    dadosPagar.push(lista.filter(l=>l.tipo==='pagar').reduce((s,l)=>s+Number(l.valor),0));
    dadosReceber.push(lista.filter(l=>l.tipo==='receber').reduce((s,l)=>s+Number(l.valor),0));
  }

  if (canvasId === 'grafico-mensal' && graficoMensalInst) graficoMensalInst.destroy();
  if (canvasId === 'grafico-relatorio-mensal' && graficoRelatorioMensalInst) graficoRelatorioMensalInst.destroy();

  const inst = new Chart(document.getElementById(canvasId), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Entradas (R$)', data: dadosReceber, backgroundColor: 'rgba(39,174,96,0.7)', borderRadius: 4 },
        { label: 'Saídas (R$)',   data: dadosPagar,   backgroundColor: 'rgba(231,76,60,0.7)',  borderRadius: 4 }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'top' } },
      scales: { y: { beginAtZero: true, ticks: { callback: v => 'R$' + v.toLocaleString('pt-BR') } } }
    }
  });

  if (canvasId === 'grafico-mensal') graficoMensalInst = inst;
  if (canvasId === 'grafico-relatorio-mensal') graficoRelatorioMensalInst = inst;
}

function renderizarPizza(canvasId, labels, valores) {
  if (!labels.length) return null;
  const cores = ['#e74c3c','#f39c12','#27ae60','#2980b9','#9b59b6',
                 '#1abc9c','#e67e22','#34495e','#e91e63','#00bcd4'];
  return new Chart(document.getElementById(canvasId), {
    type: 'pie',
    data: {
      labels,
      datasets: [{ data: valores, backgroundColor: cores.slice(0, labels.length), borderWidth: 2, borderColor: '#fff' }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'right' },
        tooltip: { callbacks: { label: ctx => ` R$ ${Number(ctx.raw).toLocaleString('pt-BR',{minimumFractionDigits:2})}` } }
      }
    }
  });
}

// =========================================================
// UTILITÁRIOS
// =========================================================
function formatarMoeda(valor) {
  return 'R$ ' + Number(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatarData(dataStr) {
  if (!dataStr) return '-';
  const [ano, mes, dia] = dataStr.split('-');
  return `${dia}/${mes}/${ano}`;
}

// =========================================================
// IMPORTAR PEDIDO DE COMPRA (PDF)
// =========================================================
async function lerPedidoPDF(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';

  mostrarToast('Lendo PDF...', '');
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let linhas = [];

    for (let p = 1; p <= pdf.numPages; p++) {
      const page   = await pdf.getPage(p);
      const tc     = await page.getTextContent();
      const porY   = {};
      for (const item of tc.items) {
        const y = Math.round(item.transform[5]);
        if (!porY[y]) porY[y] = [];
        porY[y].push(item.str);
      }
      Object.keys(porY).map(Number).sort((a, b) => b - a)
        .forEach(y => linhas.push(porY[y].join(' ')));
    }

    const texto = linhas.join('\n');
    if (/NF-e|DANFE|V\.\s*TOTAL\s*DA\s*NOTA/i.test(texto)) {
      extrairCamposNF(texto);
    } else if (/Benefici[aá]rio|Valor do Documento/i.test(texto)) {
      extrairCamposBoleto(texto);
    } else {
      extrairCamposPedidoPDF(texto);
    }
  } catch (e) {
    mostrarToast('Erro ao ler o PDF. Verifique o arquivo.', 'erro');
  }
}

async function lerFotoDocumento(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';

  mostrarToast('Processando imagem... aguarde.', '');
  try {
    const { data: { text } } = await Tesseract.recognize(file, 'por');
    const texto = text;
    if (/NF-e|DANFE|V\.\s*TOTAL\s*DA\s*NOTA/i.test(texto)) {
      extrairCamposNF(texto);
    } else if (/Benefici[aá]rio|Valor do Documento/i.test(texto)) {
      extrairCamposBoleto(texto);
    } else {
      extrairCamposPedidoPDF(texto);
    }
  } catch (e) {
    mostrarToast('Não foi possível ler a imagem. Tente com boa iluminação e sem sombras.', 'erro');
  }
}

function extrairCamposPedidoPDF(texto) {
  let campos = 0;

  // Número do pedido
  const mNum = texto.match(/Pedido\s+N[°º]:?\s*(\d+)/i)
            || texto.match(/Pedido de N[°º]:?\s*[\s\S]{0,30}?(\d{4,6})/i);
  if (mNum) {
    document.getElementById('pagar-numero-pedido').value = mNum[1];
    campos++;
  }

  // Fornecedor — tenta mesma linha, depois primeira linha do doc
  let nomeFornecedor = '';
  const mForn = texto.match(/Fornecedor:\s+([A-ZÁÀÂÃÉÈÊÍÏÓÔÕÚÜÇ][A-ZÁÀÂÃÉÈÊÍÏÓÔÕÚÜÇ0-9\s\.&]+?)(?:\s{3,}|\n|$)/i)
              || texto.match(/^\s*\d{4,6}\s+\d{2}\/\d{2}\/\d{4}\s+(.+)$/m);
  if (mForn) nomeFornecedor = mForn[1].trim();

  if (nomeFornecedor) {
    // Tenta casar com fornecedor já cadastrado
    const fornNorm = normalizarTexto(nomeFornecedor);
    const match = fornecedores.find(f => {
      const n = normalizarTexto(f.nome);
      return n === fornNorm || n.includes(fornNorm) || fornNorm.includes(n)
          || n.split(' ').some(w => w.length > 3 && fornNorm.includes(w));
    });
    if (match) {
      document.getElementById('pagar-fornecedor').value = match.id;
      if (match.plano_conta_id) {
        document.getElementById('pagar-plano-conta').value = match.plano_conta_id;
      }
      campos++;
    }
    const numPedido = document.getElementById('pagar-numero-pedido').value;
    document.getElementById('pagar-descricao').value = numPedido
      ? `Pedido ${numPedido} - ${nomeFornecedor}`
      : `Compra - ${nomeFornecedor}`;
    campos++;
  }

  // Valor total (último "Total R$ ..." que não seja Subtotal)
  const todosTotal = [...texto.matchAll(/\bTotal\b\s+R\$\s*([\d.]+,\d{2})/gi)]
    .filter(m => !texto.slice(Math.max(0, m.index - 4), m.index).toLowerCase().includes('sub'));
  if (todosTotal.length) {
    const valorStr = todosTotal[todosTotal.length - 1][1];
    const valor = parseFloat(valorStr.replace(/\./g, '').replace(',', '.'));
    setValorMoeda('pagar-valor', valor);
    calcularTotalLancamento('pagar');
    campos++;
  }

  if (campos > 0) {
    mostrarToast(`PDF lido! ${campos} campo(s) preenchido(s).`, 'sucesso');
    verificarDuplicadoPedido('pagar');
  } else {
    mostrarToast('Não foi possível identificar os campos no PDF.', 'erro');
  }
}

function preencherFornecedorPDF(nomeFornecedor) {
  if (!nomeFornecedor) return false;
  const fornNorm = normalizarTexto(nomeFornecedor);
  const match = fornecedores.find(f => {
    const n = normalizarTexto(f.nome);
    return n === fornNorm || n.includes(fornNorm) || fornNorm.includes(n)
        || n.split(' ').some(w => w.length > 3 && fornNorm.includes(w));
  });
  if (match) {
    document.getElementById('pagar-fornecedor').value = match.id;
    if (match.plano_conta_id) document.getElementById('pagar-plano-conta').value = match.plano_conta_id;
    return true;
  }
  return false;
}

function converterData(ddmmaaaa) {
  const d = ddmmaaaa.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return d ? `${d[3]}-${d[2]}-${d[1]}` : null;
}

function extrairCamposBoleto(texto) {
  let campos = 0;

  // Vencimento
  const mVenc = texto.match(/Vencimento\s+(\d{2}\/\d{2}\/\d{4})/i);
  if (mVenc) {
    const data = converterData(mVenc[1]);
    if (data) { document.getElementById('pagar-vencimento').value = data; campos++; }
  }

  // Beneficiário (fornecedor)
  const mBenef = texto.match(/Benefici[aá]rio\s+([A-ZÁÀÂÃÉÈÊÍÏÓÔÕÚÜÇ][A-ZÁÀÂÃÉÈÊÍÏÓÔÕÚÜÇ\s]+?)(?:\s+CNPJ|\n|$)/i);
  const nomeFornecedor = mBenef ? mBenef[1].trim() : '';

  // Valor do Documento
  const mValor = texto.match(/Valor do Documento\s+([\d.]+,\d{2})/i);
  if (mValor) {
    const valor = parseFloat(mValor[1].replace(/\./g, '').replace(',', '.'));
    setValorMoeda('pagar-valor', valor);
    calcularTotalLancamento('pagar');
    campos++;
  }

  // Número do documento
  const mNum = texto.match(/N[uú]m\.\s+do\s+documento\s+(\S+)/i);
  if (mNum) { document.getElementById('pagar-numero-pedido').value = mNum[1]; campos++; }

  // Tipo de documento (campo removido do formulário)

  // Fornecedor + categoria
  if (nomeFornecedor) {
    if (preencherFornecedorPDF(nomeFornecedor)) campos++;
    const num = document.getElementById('pagar-numero-pedido').value;
    document.getElementById('pagar-descricao').value = num
      ? `Boleto ${num} - ${nomeFornecedor}`
      : `Boleto - ${nomeFornecedor}`;
    campos++;
  }

  if (campos > 0) {
    mostrarToast(`Boleto lido! ${campos} campo(s) preenchido(s).`, 'sucesso');
    verificarDuplicadoPedido('pagar');
  } else {
    mostrarToast('Não foi possível identificar os campos do boleto.', 'erro');
  }
}

function extrairCamposNF(texto) {
  let campos = 0;

  // Número da NF
  const mNum = texto.match(/N[°º]\.\s*([\d.]+)/i);
  if (mNum) {
    document.getElementById('pagar-numero-pedido').value = mNum[1].replace(/\./g, '');
    campos++;
  }

  // Vencimento — seção Fatura/Duplicata
  const mVenc = texto.match(/Venc\.\s+(\d{2}\/\d{2}\/\d{4})/i);
  if (mVenc) {
    const data = converterData(mVenc[1]);
    if (data) { document.getElementById('pagar-vencimento').value = data; campos++; }
  }

  // Valor total da nota
  const mValor = texto.match(/V\.\s*TOTAL\s*DA\s*NOTA\s+([\d.]+,\d{2})/i)
               || texto.match(/VALOR TOTAL:\s*R\$\s*([\d.]+,\d{2})/i);
  if (mValor) {
    const valor = parseFloat(mValor[1].replace(/\./g, '').replace(',', '.'));
    setValorMoeda('pagar-valor', valor);
    calcularTotalLancamento('pagar');
    campos++;
  }

  // Emitente (fornecedor) — "RECEBEMOS DE [nome] OS PRODUTOS"
  const mEmit = texto.match(/RECEBEMOS DE\s+(.+?)\s+OS PRODUTOS/i)
             || texto.match(/IDENTIFICA[ÇC][ÃA]O DO EMITENTE\s+([A-Z][A-Z\s]+?)(?:\n|AV\.|RUA|R )/i);
  const nomeFornecedor = mEmit ? mEmit[1].trim() : '';

  // Tipo de documento (campo removido do formulário)

  // Fornecedor + categoria
  if (nomeFornecedor) {
    if (preencherFornecedorPDF(nomeFornecedor)) campos++;
    const num = document.getElementById('pagar-numero-pedido').value;
    document.getElementById('pagar-descricao').value = num
      ? `NF ${num} - ${nomeFornecedor}`
      : `NF - ${nomeFornecedor}`;
    campos++;
  }

  if (campos > 0) {
    mostrarToast(`Nota Fiscal lida! ${campos} campo(s) preenchido(s).`, 'sucesso');
    verificarDuplicadoPedido('pagar');
  } else {
    mostrarToast('Não foi possível identificar os campos da NF.', 'erro');
  }
}

// =========================================================
// BACKUP E RESTAURAÇÃO
// =========================================================
const TABELAS_BACKUP = [
  'unidades','plano_contas','bancos','fornecedores',
  'centros_custo','formas_pagamento','lancamentos',
  'orcamentos','transferencias','pagamentos'
];

let _dadosBackup = null;

async function fazerBackup() {
  const btn = document.getElementById('btn-fazer-backup');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Gerando...'; }
  const log = document.getElementById('backup-log');
  log.style.display = 'block';
  log.innerHTML = '';
  const addLog = msg => { log.innerHTML += msg + '<br>'; log.scrollTop = log.scrollHeight; };

  const queryComTimeout = (promise, ms = 15000) =>
    Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('Tempo esgotado (15s)')), ms))]);

  try {
    const db = obterSupabase();
    // Garante sessão válida antes de começar
    try {
      const { data: { session } } = await db.auth.getSession();
      if (!session) { await db.auth.refreshSession(); }
    } catch (e) {}

    const backup = { versao: '3', data: new Date().toISOString(), tabelas: {} };

    for (const tabela of TABELAS_BACKUP) {
      addLog(`⏳ Exportando ${tabela}...`);
      try {
        const { data, error } = await queryComTimeout(db.from(tabela).select('*'));
        if (error) { addLog(`⚠️ ${tabela}: ${error.message}`); backup.tabelas[tabela] = []; }
        else { backup.tabelas[tabela] = data || []; addLog(`✅ ${tabela}: ${backup.tabelas[tabela].length} registro(s)`); }
      } catch (err) {
        addLog(`⚠️ ${tabela}: ${err.message}`);
        backup.tabelas[tabela] = [];
      }
    }

    const json     = JSON.stringify(backup, null, 2);
    const blob     = new Blob([json], { type: 'application/json' });
    const url      = URL.createObjectURL(blob);
    const a        = document.createElement('a');
    const dataStr  = new Date().toISOString().slice(0,10);
    a.href         = url;
    a.download     = `backup-financeiro-${dataStr}.json`;
    a.click();
    URL.revokeObjectURL(url);

    const total = Object.values(backup.tabelas).reduce((s, t) => s + t.length, 0);
    addLog(`<strong style="color:#27ae60;">✅ Backup concluído! ${total} registros exportados.</strong>`);
    mostrarToast('Backup gerado e baixado com sucesso!', 'sucesso');
  } catch (e) {
    addLog(`❌ Erro: ${e.message}`);
    mostrarToast('Erro ao gerar backup.', 'erro');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-download"></i> Fazer Backup Agora'; }
  }
}

function lerArquivoBackup(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const backup = JSON.parse(e.target.result);
      if (!backup.tabelas || !backup.versao) { mostrarToast('Arquivo de backup inválido.', 'erro'); return; }
      _dadosBackup = backup;
      const dataBackup = new Date(backup.data).toLocaleString('pt-BR');
      const linhas = Object.entries(backup.tabelas).map(([t, rows]) =>
        `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #f0e0a0;">
          <span>${t}</span><strong>${rows.length} registro(s)</strong>
        </div>`).join('');
      document.getElementById('backup-info').innerHTML = `
        <div style="margin-bottom:10px;">
          <i class="fas fa-calendar-alt" style="color:#b7770d;margin-right:5px;"></i>
          <strong>Data do backup:</strong> ${dataBackup}
        </div>
        <div style="font-size:12px;">${linhas}</div>`;
      document.getElementById('backup-preview').style.display = 'block';
      document.getElementById('backup-log').style.display = 'none';
      document.getElementById('backup-log').innerHTML = '';
    } catch (err) {
      mostrarToast('Arquivo inválido ou corrompido.', 'erro');
    }
    input.value = '';
  };
  reader.readAsText(file);
}

async function confirmarRestaurarBackup(modo) {
  if (!_dadosBackup) return;
  const log = document.getElementById('backup-log');
  log.style.display = 'block';
  log.innerHTML = '';
  const addLog = msg => { log.innerHTML += msg + '<br>'; log.scrollTop = log.scrollHeight; };
  document.getElementById('backup-preview').style.display = 'none';

  const btnL = document.getElementById('btn-restaurar-lanc');
  const btnC = document.getElementById('btn-restaurar-completo');
  if (btnL) btnL.disabled = true;
  if (btnC) btnC.disabled = true;

  try {
    const db = obterSupabase();

    if (modo === 'lancamentos') {
      // Apaga e restaura apenas lancamentos + pagamentos
      const tabDel = ['pagamentos', 'lancamentos'];
      for (const t of tabDel) {
        addLog(`🗑️ Limpando ${t}...`);
        const { error } = await q(db.from(t).delete().gte('created_at', '2000-01-01'))
        if (error) throw new Error(`Erro ao limpar ${t}: ${error.message}`);
        addLog(`✅ ${t} limpo`);
      }
      for (const t of ['lancamentos', 'pagamentos']) {
        const rows = _dadosBackup.tabelas[t] || [];
        if (!rows.length) { addLog(`⏭️ ${t}: nenhum registro no backup`); continue; }
        addLog(`⏳ Restaurando ${t} (${rows.length} registros)...`);
        const { error } = await q(db.from(t).insert(rows))
        if (error) throw new Error(`Erro ao restaurar ${t}: ${error.message}`);
        addLog(`✅ ${t}: ${rows.length} registro(s) restaurado(s)`);
      }
    } else {
      // Restauração completa — ordem respeita dependências
      const ordemDel = ['pagamentos','orcamentos','transferencias','lancamentos','fornecedores','formas_pagamento','centros_custo','bancos','unidades','plano_contas'];
      const ordemIns = ['unidades','bancos','centros_custo','formas_pagamento','plano_contas','fornecedores','lancamentos','orcamentos','transferencias','pagamentos'];

      for (const t of ordemDel) {
        addLog(`🗑️ Limpando ${t}...`);
        const { error } = await q(db.from(t).delete().gte('created_at', '2000-01-01'))
        if (error) addLog(`⚠️ ${t}: ${error.message} (ignorado)`);
        else addLog(`✅ ${t} limpo`);
      }

      for (const t of ordemIns) {
        const rows = _dadosBackup.tabelas[t] || [];
        if (!rows.length) { addLog(`⏭️ ${t}: nenhum registro`); continue; }
        addLog(`⏳ Restaurando ${t} (${rows.length} registros)...`);
        if (t === 'plano_contas') {
          // Insere sem grupo_id primeiro, depois atualiza
          const semGrupo = rows.map(r => ({ ...r, grupo_id: null }));
          await q(db.from(t).insert(semGrupo))
          for (const r of rows.filter(r => r.grupo_id)) {
            await q(db.from(t).update({ grupo_id: r.grupo_id }).eq('id', r.id))
          }
        } else {
          const chunkSize = 500;
          for (let i = 0; i < rows.length; i += chunkSize) {
            const { error } = await q(db.from(t).insert(rows.slice(i, i + chunkSize)))
            if (error) throw new Error(`Erro ao restaurar ${t}: ${error.message}`);
          }
        }
        addLog(`✅ ${t}: ${rows.length} registro(s) restaurado(s)`);
      }
    }

    addLog(`<strong style="color:#27ae60;">✅ Restauração concluída com sucesso!</strong>`);
    mostrarToast('Dados restaurados com sucesso!', 'sucesso');
    _dadosBackup = null;
    // Recarrega dados em memória
    await carregarBancosCadastrados();
    await carregarFornecedores();
    await carregarCentrosCusto();
    await carregarFormasPagamento();
  } catch (e) {
    addLog(`<strong style="color:#e74c3c;">❌ Erro: ${e.message}</strong>`);
    mostrarToast('Erro durante a restauração. Verifique o log.', 'erro');
  } finally {
    if (btnL) btnL.disabled = false;
    if (btnC) btnC.disabled = false;
  }
}

function mostrarToast(mensagem, tipo = '') {
  const toast = document.getElementById('toast');
  toast.textContent = mensagem;
  toast.className = 'toast ' + tipo;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3500);
}


// =========================================================
// INTEGRAÇÕES PENDENTES (rascunhos do sistema de compras)
// =========================================================
let _integRascunhos = [];
let _integItensMap  = {};
let _integRateioMap = {};

async function carregarIntegracoes() {
  if (!(await garantirSessao())) return;
  const db = obterSupabase();

  const { data: rascunhos } = await q(db
    .from('lancamentos_rascunho')
    .select('*, fornecedores(nome), plano_contas(nome)')
    .order('pedido_num', { ascending: false }));

  const badge = document.getElementById('badge-integracoes');
  if (badge) {
    const qtd = rascunhos?.length || 0;
    badge.textContent = qtd;
    badge.style.display = qtd > 0 ? 'inline' : 'none';
  }

  const vazio = document.getElementById('integracoes-vazio');
  if (!rascunhos?.length) {
    document.getElementById('integracoes-lista').innerHTML = '';
    if (vazio) vazio.style.display = 'block';
    return;
  }
  if (vazio) vazio.style.display = 'none';

  // Busca rateios
  const idsComRateio = rascunhos.filter(r => r.tem_rateio).map(r => r.id);
  _integRateioMap = {};
  if (idsComRateio.length) {
    const { data: rateios } = await q(db
      .from('rascunho_rateio_itens')
      .select('rascunho_id, valor, descricao, plano_contas(nome)')
      .in('rascunho_id', idsComRateio));
    (rateios || []).forEach(ri => {
      if (!_integRateioMap[ri.rascunho_id]) _integRateioMap[ri.rascunho_id] = [];
      _integRateioMap[ri.rascunho_id].push(ri);
    });
  }

  // Busca itens dos pedidos
  const pedidoNums = rascunhos.map(r => r.pedido_num).filter(Boolean);
  _integItensMap = {};
  if (pedidoNums.length) {
    const { data: itens } = await q(db
      .from('cmp_compras')
      .select('pedido_num,produto,categoria,quantidade,unidade_med,custo_unit,fornecedor_nome,comprador,data')
      .in('pedido_num', pedidoNums));
    (itens || []).forEach(it => {
      if (!_integItensMap[it.pedido_num]) _integItensMap[it.pedido_num] = [];
      _integItensMap[it.pedido_num].push(it);
    });
  }

  _integRascunhos = rascunhos;

  // Popula dropdown de fornecedores
  _popularFornInteg();
  renderIntegracoes();

  // Busca rateios dos rascunhos com rateio
}

function _popularFornInteg() {
  const lista = document.getElementById('integ-forn-lista');
  if (!lista) return;
  const forns = [...new Set(_integRascunhos.map(r => r.fornecedores?.nome).filter(Boolean))].sort();
  lista.innerHTML = forns.map(f => `
    <label style="display:flex;align-items:center;gap:.5rem;padding:.35rem .5rem;border-radius:5px;cursor:pointer;font-size:.84rem"
      onmouseover="this.style.background='#f8f9fa'" onmouseout="this.style.background=''">
      <input type="checkbox" value="${f.replace(/"/g,'&quot;')}" onchange="_atualizarLabelFornInteg();filtrarIntegracoes()">
      <span>${f}</span>
    </label>`).join('');
}

function filtrarListaFornInteg() {
  const busca = (document.getElementById('integ-forn-busca')?.value || '').toLowerCase();
  document.querySelectorAll('#integ-forn-lista label').forEach(label => {
    label.style.display = label.textContent.toLowerCase().includes(busca) ? '' : 'none';
  });
}

function _getFornsSelecionados() {
  return Array.from(document.querySelectorAll('#integ-forn-lista input:checked')).map(c => c.value);
}

function _atualizarLabelFornInteg() {
  const sels = _getFornsSelecionados();
  const label = document.getElementById('integ-forn-label');
  if (!label) return;
  label.textContent = sels.length === 0 ? 'Todos os fornecedores'
    : sels.length === 1 ? sels[0]
    : `${sels.length} fornecedores`;
}

function toggleDropIntegForn(e) {
  e.stopPropagation();
  const drop = document.getElementById('integ-forn-dropdown');
  if (drop) drop.style.display = drop.style.display === 'none' ? 'block' : 'none';
}


function limparFiltrosInteg() {
  const venc = document.getElementById('integ-filtro-venc');
  if (venc) venc.value = '';
  document.querySelectorAll('#integ-forn-lista input').forEach(c => c.checked = false);
  _atualizarLabelFornInteg();
  filtrarIntegracoes();
}

function filtrarIntegracoes() {
  const venc  = document.getElementById('integ-filtro-venc')?.value || '';
  const forns = _getFornsSelecionados();
  let lista = _integRascunhos;
  if (venc)        lista = lista.filter(r => r.vencimento === venc);
  if (forns.length) lista = lista.filter(r => forns.includes(r.fornecedores?.nome));
  const vazioPrincipal = document.getElementById('integracoes-vazio');
  const vazioFiltro    = document.getElementById('integracoes-vazio-filtro');
  if (vazioPrincipal) vazioPrincipal.style.display = 'none';
  if (vazioFiltro)    vazioFiltro.style.display = lista.length ? 'none' : 'block';
  renderIntegracoes(lista);
}

function renderIntegracoes(rascunhos) {
  rascunhos = rascunhos ?? _integRascunhos;
  const lista = document.getElementById('integracoes-lista');
  if (!lista) return;

  lista.innerHTML = rascunhos.map(r => {
    const venc      = (r.vencimento || '').split('-').reverse().join('/');
    const forn      = r.fornecedores?.nome || '—';
    const isCompExt  = (r.fornecedores?.nome || '').toLowerCase().trim() === 'comprador externo'
                    || (r.descricao || '').toLowerCase().includes('comprador externo');
    const isDinheiro = isCompExt && (r.observacoes || '').toLowerCase().includes('dinheiro');
    const itens     = _integItensMap[r.pedido_num] || [];
    const ref       = itens[0] || {};
    const dataBR    = (ref.data || '').split('-').reverse().join('/');
    const acrescimo = Number(r.acrescimo) || 0;
    const total     = Number(r.valor) + acrescimo; // valor da nota + acréscimo do lançamento
    const rateioItens = r.tem_rateio && _integRateioMap[r.id]?.length ? _integRateioMap[r.id] : [];

    const linhasTabela = itens.length
      ? itens.map(it => `
          <tr style="font-size:.72rem">
            <td style="padding:2px 4px;border:1px solid #e0e0e0"><strong>${it.produto}</strong></td>
            <td style="padding:2px 4px;border:1px solid #e0e0e0;color:#666">${it.categoria||'—'}</td>
            <td style="padding:2px 4px;border:1px solid #e0e0e0;text-align:center">${it.quantidade} ${it.unidade_med||''}</td>
            <td style="padding:2px 4px;border:1px solid #e0e0e0;text-align:right">${formatarMoeda((it.quantidade||0)*(it.custo_unit||0))}</td>
          </tr>`).join('')
      : `<tr><td colspan="4" style="padding:4px;color:#aaa;text-align:center;font-size:.72rem">Sem itens</td></tr>`;

    const rateioMini = rateioItens.length
      ? `<div style="margin-top:6px;padding:4px 6px;background:#fff9e6;border-radius:4px;border:1px solid #f39c12;font-size:.7rem">
           <div style="color:#999;margin-bottom:2px;font-weight:600">RATEIO</div>
           ${rateioItens.map(ri => `
             <div style="display:flex;justify-content:space-between">
               <span>${ri.plano_contas?.nome || ri.descricao || '—'}</span>
               <span style="font-weight:600">${formatarMoeda(ri.valor)}</span>
             </div>`).join('')}
         </div>` : '';

    return `
    <div style="background:#fff;border:1px solid #e0e0e0;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);display:flex;flex-direction:column">
      <!-- Miniatura do pedido -->
      <div style="padding:.9rem;flex:1;border-bottom:1px solid #f0f0f0">
        <!-- Cabeçalho -->
        <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #FF6B35;padding-bottom:.4rem;margin-bottom:.5rem">
          <div>
            <div style="font-weight:700;font-size:.8rem;color:#1a1a2e">Tambaqui de Banda</div>
            <div style="font-size:.68rem;color:#888">Pedido de Compra</div>
          </div>
          <div style="font-size:.95rem;font-weight:700;color:#FF6B35">Nº ${r.pedido_num||'—'}</div>
        </div>
        <!-- Meta -->
        <div style="display:flex;gap:1rem;font-size:.7rem;margin-bottom:.5rem">
          <div><span style="color:#888">Data</span><br><strong>${dataBR||'—'}</strong></div>
          <div style="flex:1"><span style="color:#888">Fornecedor</span><br><strong>${forn}</strong></div>
          <div><span style="color:#888">Comprador</span><br><strong>${ref.comprador||'—'}</strong></div>
        </div>
        <!-- Tabela de itens -->
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="background:#1a1a2e;color:#fff;font-size:.68rem">
              <th style="padding:2px 4px;text-align:left">Produto</th>
              <th style="padding:2px 4px;text-align:left">Categoria</th>
              <th style="padding:2px 4px;text-align:center">Qtd</th>
              <th style="padding:2px 4px;text-align:right">Total</th>
            </tr>
          </thead>
          <tbody>${linhasTabela}</tbody>
          <tfoot>
            ${acrescimo > 0 ? `<tr style="font-size:.68rem;color:#c2410c">
              <td colspan="3" style="padding:2px 4px;border:1px solid #e0e0e0;text-align:right">Acréscimo</td>
              <td style="padding:2px 4px;border:1px solid #e0e0e0;text-align:right;font-weight:600">+ ${formatarMoeda(acrescimo)}</td>
            </tr>` : ''}
            <tr style="background:#f0fdf4;font-size:.72rem;font-weight:700">
              <td colspan="3" style="padding:2px 4px;border:1px solid #e0e0e0;text-align:right">TOTAL</td>
              <td style="padding:2px 4px;border:1px solid #e0e0e0;text-align:right;color:#16a34a">${formatarMoeda(total)}</td>
            </tr>
          </tfoot>
        </table>
        ${rateioMini}
        <!-- Vencimento -->
        <div style="margin-top:.5rem;font-size:.7rem;color:#888">Vencimento: <strong style="color:#e74c3c">${venc}</strong></div>
        ${r.observacoes ? `<div style="margin-top:.3rem;font-size:.7rem;color:#555;background:#f8f9fa;border-radius:4px;padding:3px 6px">📝 ${r.observacoes}</div>` : ''}
      </div>
      <!-- Botões -->
      ${isCompExt ? isDinheiro ? `
      <div style="padding:.6rem .8rem;background:#fefce8;border-top:1px solid #fef08a">
        <div style="font-size:.72rem;font-weight:700;color:#854d0e;margin-bottom:.4rem">💵 Pagamento em Dinheiro — Caixa</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.4rem">
          <button onclick="visualizarIntegracao('${r.pedido_num||''}','${r.id}')"
            style="padding:.4rem;background:#f1f5f9;color:#334155;border:1px solid #cbd5e1;border-radius:5px;font-size:.75rem;cursor:pointer;font-weight:600">
            <i class="fas fa-eye"></i> Visualizar
          </button>
          <button onclick="aprovarComoDinheiro('${r.id}','${r.conta_id||''}',${total},'${r.vencimento||''}','${bancosCadastrados.find(b=>{const n=b.nome.toLowerCase();return n.includes('caixa')||n.includes('dinheiro');})?.id||''}')"
            style="padding:.4rem;background:#854d0e;color:#fff;border:none;border-radius:5px;font-size:.75rem;cursor:pointer;font-weight:600">
            💵 Registrar Pagamento
          </button>
          <button onclick="rejeitarIntegracao('${r.id}','${r.pedido_num||''}')"
            style="padding:.4rem;background:#fff5f5;color:#dc2626;border:1px solid #fecaca;border-radius:5px;font-size:.75rem;cursor:pointer;font-weight:600">
            <i class="fas fa-times"></i> Rejeitar
          </button>
        </div>
      </div>` : `
      <div style="padding:.6rem .8rem;background:#eff6ff;border-top:1px solid #dbeafe">
        <div style="font-size:.72rem;font-weight:700;color:#1d4ed8;margin-bottom:.4rem">🔄 Transferência Interna — selecione os bancos:</div>
        <div style="display:flex;gap:.4rem;align-items:center;margin-bottom:.4rem">
          <select id="transfOrigem-${r.id}" style="flex:1;font-size:.73rem;padding:.25rem .3rem;border:1px solid #93c5fd;border-radius:4px;background:#fff">
            <option value="">Origem</option>
            ${bancosCadastrados.map(b => { const n = b.nome.toLowerCase(); return `<option value="${b.id}" ${n.includes('santander') && !n.includes('smoke') && !n.includes('test') ? 'selected' : ''}>${b.nome}</option>`; }).join('')}
          </select>
          <span style="color:#93c5fd;font-weight:700">→</span>
          <select id="transfDestino-${r.id}" style="flex:1;font-size:.73rem;padding:.25rem .3rem;border:1px solid #93c5fd;border-radius:4px;background:#fff">
            <option value="">Destino</option>
            ${bancosCadastrados.map(b => `<option value="${b.id}" ${b.nome.toLowerCase().includes('nubank') ? 'selected' : ''}>${b.nome}</option>`).join('')}
          </select>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.4rem">
          <button onclick="visualizarIntegracao('${r.pedido_num||''}','${r.id}')"
            style="padding:.4rem;background:#f1f5f9;color:#334155;border:1px solid #cbd5e1;border-radius:5px;font-size:.75rem;cursor:pointer;font-weight:600">
            <i class="fas fa-eye"></i> Visualizar
          </button>
          <button id="btnTransf-${r.id}" onclick="aprovarComoTransferencia('${r.id}','${r.conta_id||''}',${total},'${r.vencimento||''}')"
            style="padding:.4rem;background:#1d4ed8;color:#fff;border:none;border-radius:5px;font-size:.75rem;cursor:pointer;font-weight:600">
            <i class="fas fa-exchange-alt"></i> Registrar Transferência
          </button>
          <button onclick="rejeitarIntegracao('${r.id}','${r.pedido_num||''}')"
            style="padding:.4rem;background:#fff5f5;color:#dc2626;border:1px solid #fecaca;border-radius:5px;font-size:.75rem;cursor:pointer;font-weight:600">
            <i class="fas fa-times"></i> Rejeitar
          </button>
        </div>
      </div>` : `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0">
        <button onclick="visualizarIntegracao('${r.pedido_num||''}','${r.id}')"
          style="padding:.6rem;background:#f8f9fa;border:none;border-right:1px solid #e0e0e0;font-size:.78rem;cursor:pointer;color:#1a1a2e;font-weight:600;transition:background .15s"
          onmouseover="this.style.background='#e9ecef'" onmouseout="this.style.background='#f8f9fa'">
          <i class="fas fa-eye"></i><br>Visualizar
        </button>
        <button onclick="aprovarIntegracao('${r.id}','${r.conta_id||''}')"
          style="padding:.6rem;background:#f0fdf4;border:none;border-right:1px solid #e0e0e0;font-size:.78rem;cursor:pointer;color:#16a34a;font-weight:600;transition:background .15s"
          onmouseover="this.style.background='#dcfce7'" onmouseout="this.style.background='#f0fdf4'">
          <i class="fas fa-check"></i><br>Aprovar
        </button>
        <button onclick="rejeitarIntegracao('${r.id}','${r.pedido_num||''}')"
          style="padding:.6rem;background:#fff5f5;border:none;font-size:.78rem;cursor:pointer;color:#dc2626;font-weight:600;transition:background .15s"
          onmouseover="this.style.background='#fee2e2'" onmouseout="this.style.background='#fff5f5'">
          <i class="fas fa-times"></i><br>Rejeitar
        </button>
      </div>`}
    </div>`;
  }).join('');
}

let _vizPedidoAtual = null;

async function visualizarIntegracao(pedido_num, rascunhoId) {
  if (!pedido_num) return;
  const db = obterSupabase();

  // Busca itens do pedido e observação do rascunho em paralelo
  const [{ data: itens }, { data: rasc }] = await Promise.all([
    q(db.from('cmp_compras').select('*').eq('pedido_num', pedido_num)),
    q(db.from('lancamentos_rascunho').select('observacoes,unidade_id,acrescimo,valor').eq('id', rascunhoId).maybeSingle()),
  ]);

  if (!itens?.length) { mostrarToast('Itens do pedido não encontrados.', 'erro'); return; }

  const ref         = itens[0];
  const dataBR      = (ref.data||'').split('-').reverse().join('/');
  const acrescimo   = Number(rasc?.acrescimo) || 0;
  const total       = Number(rasc?.valor || 0) + acrescimo; // valor da nota + acréscimo do lançamento
  const obs         = rasc?.observacoes || '';
  const unidadeNome = unidades.find(u => u.id === rasc?.unidade_id)?.nome || ref.unidade_uso || '';

  const linhas = itens.map((c,i) => `
    <tr>
      <td style="padding:5px 8px;border:1px solid #e0e0e0">${i+1}</td>
      <td style="padding:5px 8px;border:1px solid #e0e0e0"><strong>${c.produto}</strong></td>
      <td style="padding:5px 8px;border:1px solid #e0e0e0">${c.categoria||'—'}</td>
      <td style="padding:5px 8px;border:1px solid #e0e0e0;text-align:center">${c.quantidade} ${c.unidade_med||''}</td>
      <td style="padding:5px 8px;border:1px solid #e0e0e0;text-align:right">${formatarMoeda(c.custo_unit)}</td>
      <td style="padding:5px 8px;border:1px solid #e0e0e0;text-align:right;font-weight:700">${formatarMoeda((c.quantidade||0)*(c.custo_unit||0))}</td>
    </tr>`).join('');

  _vizPedidoAtual = { pedido_num, dataBR, ref, linhas, total };

  document.getElementById('viz-pedido-conteudo').innerHTML = `
    <div id="viz-pedido-print">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #FF6B35;padding-bottom:1rem;margin-bottom:1.5rem">
        <div>
          <div style="font-weight:700;font-size:1.4rem;color:#1a1a2e">Tambaqui de Banda</div>
          <div style="color:#666">Pedido de Compra</div>
        </div>
        <div style="font-size:1.8rem;font-weight:700;color:#FF6B35">Nº ${pedido_num}</div>
      </div>
      <div style="display:flex;gap:2rem;margin-bottom:1rem;font-size:.9rem">
        <div><span style="color:#888">Data</span><div><strong>${dataBR}</strong></div></div>
        <div><span style="color:#888">Fornecedor</span><div><strong>${ref.fornecedor_nome||'—'}</strong></div></div>
        <div><span style="color:#888">Comprador</span><div><strong>${ref.comprador||'—'}</strong></div></div>
        ${unidadeNome ? `<div><span style="color:#888">Unidade</span><div><strong>${unidadeNome}</strong></div></div>` : ''}
        ${ref.data_entrega ? `<div><span style="color:#888">Entrega</span><div><strong>${ref.data_entrega.split('-').reverse().join('/')}</strong></div></div>` : ''}
      </div>
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:#1a1a2e;color:#fff">
            <th style="padding:6px 8px">#</th>
            <th style="padding:6px 8px">Produto</th>
            <th style="padding:6px 8px">Categoria</th>
            <th style="padding:6px 8px;text-align:center">Quantidade</th>
            <th style="padding:6px 8px;text-align:right">Valor Unit.</th>
            <th style="padding:6px 8px;text-align:right">Total</th>
          </tr>
        </thead>
        <tbody>${linhas}</tbody>
        <tfoot>
          ${acrescimo > 0 ? `<tr style="color:#c2410c;font-size:.85rem">
            <td colspan="5" style="padding:5px 8px;border:1px solid #e0e0e0;text-align:right">Acréscimo (frete/taxa)</td>
            <td style="padding:5px 8px;border:1px solid #e0e0e0;text-align:right;font-weight:600">+ ${formatarMoeda(acrescimo)}</td>
          </tr>` : ''}
          <tr style="background:#f0fdf4;font-weight:700">
            <td colspan="5" style="padding:6px 8px;border:1px solid #e0e0e0;text-align:right">TOTAL DO PEDIDO</td>
            <td style="padding:6px 8px;border:1px solid #e0e0e0;text-align:right;color:#16a34a">${formatarMoeda(total)}</td>
          </tr>
        </tfoot>
      </table>
      ${obs ? `<div style="margin-top:1rem;padding:.5rem .75rem;background:#f8f9fa;border-left:3px solid #FF6B35;font-size:.85rem;color:#555"><strong>Observações:</strong> ${obs}</div>` : ''}
      <div style="margin-top:2.5rem;display:flex;gap:4rem">
        <div style="border-top:1px solid #333;width:160px;padding-top:.3rem;text-align:center;font-size:.8rem">Comprador</div>
        <div style="border-top:1px solid #333;width:160px;padding-top:.3rem;text-align:center;font-size:.8rem">Fornecedor</div>
      </div>
    </div>`;

  document.getElementById('modal-viz-pedido').style.display = 'block';
}

function fecharVizPedido() {
  document.getElementById('modal-viz-pedido').style.display = 'none';
}

function imprimirVizPedido() {
  const conteudo = document.getElementById('viz-pedido-print')?.innerHTML || '';
  const w = window.open('', '_blank', 'width=900,height=700');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
    <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;padding:1.5cm}</style>
    </head><body>${conteudo}</body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 400);
}

async function aprovarIntegracao(rascunhoId, contaId) {
  if (!(await garantirSessao())) return;
  const db = obterSupabase();

  // Busca o rascunho
  const { data: r } = await q(db.from('lancamentos_rascunho').select('*').eq('id', rascunhoId).single());
  if (!r) { mostrarToast('Rascunho não encontrado.', 'erro'); return; }

  // Busca rateio (se tiver)
  let rateioItens = [];
  if (r.tem_rateio) {
    const { data: ri } = await q(db.from('rascunho_rateio_itens').select('*').eq('rascunho_id', rascunhoId));
    rateioItens = ri || [];
  }

  // Insere em lancamentos
  const { data: lanc, error } = await q(db.from('lancamentos').insert([{
    descricao:      r.descricao,
    valor:          (Number(r.valor) || 0) + (Number(r.acrescimo) || 0) - (Number(r.desconto) || 0), // total = nota + acréscimo − desconto
    vencimento:     r.vencimento,
    tipo:           r.tipo,
    status:         r.status,
    fornecedor_id:  r.fornecedor_id,
    plano_conta_id: r.tem_rateio ? null : r.plano_conta_id,
    numero_pedido:  r.numero_pedido,
    observacoes:    r.observacoes,
    acrescimo:      r.acrescimo || 0,
    desconto:       r.desconto  || 0,
    data_pagamento: null,
    tem_rateio:     r.tem_rateio || false,
    unidade_id:     r.unidade_id || null,
  }]).select('id').single());

  if (error) { mostrarToast('Erro ao aprovar: ' + error.message, 'erro'); return; }

  // Cria rateio_itens no financeiro
  if (r.tem_rateio && lanc?.id && rateioItens.length) {
    await q(db.from('rateio_itens').insert(
      rateioItens.map(ri => ({
        lancamento_id:  lanc.id,
        plano_conta_id: ri.plano_conta_id,
        valor:          ri.valor,
        descricao:      ri.descricao,
      }))
    ));
  }

  // Atualiza cmp_contas_pagar com lancamento_id (avisa o estoque que já foi enviado).
  // Fallback: se não veio contaId, localiza a conta pelo pedido_num do rascunho.
  let _contaId = contaId;
  if (!_contaId && r.pedido_num) {
    const { data: _cp } = await q(db.from('cmp_contas_pagar').select('id').eq('pedido_num', r.pedido_num).maybeSingle());
    _contaId = _cp?.id || null;
  }
  if (_contaId && lanc?.id) {
    await q(db.from('cmp_contas_pagar').update({ lancamento_id: lanc.id }).eq('id', _contaId));
  }

  // Remove rascunho (cascade apaga rascunho_rateio_itens automaticamente)
  await q(db.from('lancamentos_rascunho').delete().eq('id', rascunhoId));

  mostrarToast('✅ Conta a pagar gerada com sucesso!', 'sucesso');
  carregarIntegracoes();
}

// Pedidos cuja transferência está sendo gravada agora (trava contra clique duplo).
const _transfEmAndamento = new Set();

async function aprovarComoTransferencia(rascunhoId, contaId, valor, vencimento) {
  // Trava 1: clique duplo / dois cliques rápidos no mesmo card.
  if (_transfEmAndamento.has(rascunhoId)) return;

  const origemId  = document.getElementById(`transfOrigem-${rascunhoId}`)?.value;
  const destinoId = document.getElementById(`transfDestino-${rascunhoId}`)?.value;
  if (!origemId)                    { mostrarToast('Selecione o banco de origem.', 'erro'); return; }
  if (!destinoId)                   { mostrarToast('Selecione o banco de destino.', 'erro'); return; }
  if (origemId === destinoId)       { mostrarToast('Origem e destino devem ser diferentes.', 'erro'); return; }
  if (!(await garantirSessao()))    return;
  const db = obterSupabase();

  const { data: r } = await q(db.from('lancamentos_rascunho').select('*').eq('id', rascunhoId).single());
  if (!r) { mostrarToast('Rascunho não encontrado.', 'erro'); return; }

  // Aviso A: destino diferente do padrão (Nubank, o cartão do comprador externo).
  // Compra feita no cartão da EMPRESA não gera transferência — o dinheiro só sai no
  // pagamento da fatura. Foi assim que o Pedido #00616 virou uma transferência
  // Santander → Cora de R$ 1.059,24 que nunca aconteceu (22/07/2026).
  const _bancoNome = id => bancosCadastrados.find(b => b.id === id)?.nome || 'conta selecionada';
  const _destPadrao = bancosCadastrados.find(b => b.nome.toLowerCase().includes('nubank'));
  if (_destPadrao && destinoId !== _destPadrao.id) {
    const ok = confirm(
      `Você mudou o destino de ${_destPadrao.nome} para ${_bancoNome(destinoId)}.\n\n` +
      `As transferências de comprador externo vão para o ${_destPadrao.nome}.\n\n` +
      `Se esta compra foi feita no CARTÃO DA EMPRESA, ela NÃO gera transferência — ` +
      `o dinheiro sai no pagamento da fatura. Nesse caso cancele e registre como ` +
      `conta a pagar naquele cartão.\n\n` +
      `Registrar a transferência mesmo assim?`
    );
    if (!ok) { mostrarToast('Operação cancelada. Nada foi gravado.'); return; }
  }

  // Aviso B: data distante de hoje. A transferência herda o vencimento do pedido,
  // mas o PIX sai no dia da aprovação. No #00616 isso gravou 15/08 numa saída de 22/07.
  const _hoje = new Date().toISOString().split('T')[0];
  let dataTransf = vencimento || _hoje;
  const _diasFora = Math.abs(new Date(dataTransf + 'T00:00:00') - new Date(_hoje + 'T00:00:00')) / 86400000;
  if (_diasFora > 7) {
    const usarHoje = confirm(
      `Esta transferência será registrada em ${formatarData(dataTransf)}, mas hoje é ${formatarData(_hoje)}.\n\n` +
      `A data veio do vencimento do pedido. Se o PIX está saindo agora, use a data de hoje.\n\n` +
      `OK = usar ${formatarData(_hoje)}   ·   Cancelar = manter ${formatarData(dataTransf)}`
    );
    if (usarHoje) dataTransf = _hoje;
  }

  // Trava 2: já existe transferência para este pedido?
  // Acontecia quando a 1ª tentativa gravava a transferência e falhava no lançamento:
  // o rascunho continuava na lista e o 2º clique criava uma transferência duplicada
  // (caso real: Pedido #00945, R$ 462,00 órfã em 14/08/2026).
  if (r.pedido_num) {
    const { data: jaExiste } = await q(db.from('transferencias')
      .select('id, valor, data')
      .ilike('descricao', `%${r.pedido_num}%`));
    if (jaExiste?.length) {
      const lista = jaExiste.map(t => `• ${formatarData(t.data)} — ${formatarMoeda(t.valor)}`).join('\n');
      const ok = confirm(
        `Atenção: já existe ${jaExiste.length} transferência registrada para o pedido ${r.pedido_num}:\n\n` +
        `${lista}\n\n` +
        `Só continue se o PIX foi mesmo enviado mais de uma vez para este pedido.\n\n` +
        `Registrar outra transferência mesmo assim?`
      );
      if (!ok) { mostrarToast('Operação cancelada. Nada foi gravado.'); return; }
    }
  }

  // Trava 3: desabilita o botão enquanto grava.
  _transfEmAndamento.add(rascunhoId);
  const btn       = document.getElementById(`btnTransf-${rascunhoId}`);
  const btnHtml   = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.style.opacity = '.6'; btn.style.cursor = 'wait'; btn.innerHTML = 'Registrando…'; }
  const destravar = () => {
    _transfEmAndamento.delete(rascunhoId);
    if (btn) { btn.disabled = false; btn.style.opacity = ''; btn.style.cursor = 'pointer'; btn.innerHTML = btnHtml; }
  };

  try {
    // 1. Cria transferência interna Santander → Nubank
    const { data: transf, error: errTransf } = await q(db.from('transferencias').insert([{
      banco_origem_id:  origemId,
      banco_destino_id: destinoId,
      valor,
      data:             dataTransf,
      descricao:        r.descricao || `Adiantamento ${r.pedido_num}`,
    }]).select('id').single());
    if (errTransf) { mostrarToast('Erro ao criar transferência: ' + errTransf.message, 'erro'); return; }

    // 2. Cria lançamento pendente para manter o vínculo em cmp_contas_pagar.adiantamento_lancamento_id
    //    Fica pendente até a conciliação OFX confirmar a saída no Santander
    const { data: lanc, error: errLanc } = await q(db.from('lancamentos').insert([{
      descricao:      r.descricao,
      valor:          (Number(r.valor) || 0) + (Number(r.acrescimo) || 0) - (Number(r.desconto) || 0), // total = nota + acréscimo − desconto
      acrescimo:      r.acrescimo || 0,
      desconto:       r.desconto  || 0,
      vencimento:     r.vencimento,
      tipo:           'pagar',
      status:         'pendente',
      data_pagamento: null,
      banco_id:       null,
      fornecedor_id:  r.fornecedor_id  || null,
      plano_conta_id: r.plano_conta_id || null,
      numero_pedido:  r.numero_pedido,
      observacoes:    r.observacoes,
      tem_rateio:     false,
      unidade_id:     r.unidade_id || null,
    }]).select('id').single());

    // Desfaz a transferência se o lançamento falhar — nunca deixa transferência órfã.
    if (errLanc) {
      let desfeita = false;
      if (transf?.id) {
        const { error: errUndo } = await q(db.from('transferencias').delete().eq('id', transf.id));
        desfeita = !errUndo;
      }
      mostrarToast(
        'Erro ao registrar lançamento: ' + errLanc.message +
        (desfeita ? ' — a transferência foi desfeita, nada ficou gravado. Pode tentar de novo.'
                  : ' — ATENÇÃO: não consegui desfazer a transferência. Confira a tela de Transferências antes de tentar de novo.'),
        'erro'
      );
      return;
    }

    // 3. Atualiza cmp_contas_pagar com adiantamento_lancamento_id
    if (contaId && lanc?.id) {
      await q(db.from('cmp_contas_pagar').update({ adiantamento_lancamento_id: lanc.id }).eq('id', contaId));
    }

    // 4. Remove rascunho
    await q(db.from('lancamentos_rascunho').delete().eq('id', rascunhoId));

    mostrarToast('✅ Transferência registrada!', 'sucesso');
    carregarIntegracoes();
  } finally {
    destravar();
  }
}

async function aprovarComoDinheiro(rascunhoId, contaId, valor, vencimento, caixaBancoId) {
  if (!confirm('Registrar pagamento em dinheiro (Caixa) para este pedido?')) return;
  if (!(await garantirSessao())) return;
  const db = obterSupabase();

  const { data: r } = await q(db.from('lancamentos_rascunho').select('*').eq('id', rascunhoId).single());
  if (!r) { mostrarToast('Rascunho não encontrado.', 'erro'); return; }

  const dataPag = vencimento || new Date().toISOString().split('T')[0];

  const { data: lanc, error: errLanc } = await q(db.from('lancamentos').insert([{
    descricao:      r.descricao,
    valor:          (Number(r.valor) || 0) + (Number(r.acrescimo) || 0) - (Number(r.desconto) || 0), // total = nota + acréscimo − desconto
    acrescimo:      r.acrescimo || 0,
    desconto:       r.desconto  || 0,
    vencimento:     r.vencimento,
    tipo:           'pagar',
    status:         'pago',
    data_pagamento: dataPag,
    banco_id:       caixaBancoId || null,
    fornecedor_id:  r.fornecedor_id  || null,
    plano_conta_id: r.plano_conta_id || null,
    numero_pedido:  r.numero_pedido,
    observacoes:    r.observacoes,
    tem_rateio:     false,
    unidade_id:     r.unidade_id || null,
  }]).select('id').single());
  if (errLanc) { mostrarToast('Erro ao registrar lançamento: ' + errLanc.message, 'erro'); return; }

  if (contaId && lanc?.id) {
    await q(db.from('cmp_contas_pagar').update({ adiantamento_lancamento_id: lanc.id }).eq('id', contaId));
  }

  await q(db.from('lancamentos_rascunho').delete().eq('id', rascunhoId));

  mostrarToast('✅ Pagamento em dinheiro registrado!', 'sucesso');
  carregarIntegracoes();
}

async function rejeitarIntegracao(rascunhoId, pedidoNum) {
  if (!confirm(`Rejeitar a integração do pedido ${pedidoNum}?\n\nO rascunho será excluído. Se o pedido ainda não tiver lançamento, o recebimento no estoque também será DESFEITO (itens voltam para pendente), para o estoquista receber de novo com os valores corretos — evitando valores acumulados.`)) return;
  if (!(await garantirSessao())) return;
  const db = obterSupabase();
  await q(db.from('lancamentos_rascunho').delete().eq('id', rascunhoId));

  // Desfaz o recebimento no estoque para permitir novo recebimento limpo (evita acúmulo).
  // Exceção: se o pedido já tem lançamento (caso de duplicata), NÃO desfaz — só apaga o rascunho.
  if (pedidoNum) {
    const { data: lancNum }  = await q(db.from('lancamentos').select('id').eq('numero_pedido', pedidoNum).limit(1));
    const { data: lancDesc } = await q(db.from('lancamentos').select('id').ilike('descricao', `Pedido ${pedidoNum}%`).limit(1));
    if (!(lancNum?.length || lancDesc?.length)) {
      const { data: recs } = await q(db.from('cmp_recebimentos').select('id').eq('pedido_num', pedidoNum));
      if (recs?.length) {
        const ids = recs.map(r => r.id);
        await q(db.from('cmp_recebimento_itens').delete().in('recebimento_id', ids));
        await q(db.from('cmp_recebimentos').delete().in('id', ids));
      }
      await q(db.from('cmp_contas_pagar').delete().eq('pedido_num', pedidoNum));
      await q(db.from('cmp_compras').update({ status_receb: 'pendente' }).eq('pedido_num', pedidoNum));
    }
  }
  mostrarToast('Rascunho rejeitado. Recebimento desfeito no estoque para novo recebimento.', 'sucesso');
  carregarIntegracoes();
}

// Verifica integrações pendentes ao carregar o app (para mostrar badge)
async function verificarIntegracoesPendentes() {
  try {
    const db = obterSupabase();
    const { count } = await db.from('lancamentos_rascunho').select('id', { count: 'exact', head: true });
    const badge = document.getElementById('badge-integracoes');
    if (badge && count > 0) {
      badge.textContent = count;
      badge.style.display = 'inline';
    }
  } catch (_) {}
}
