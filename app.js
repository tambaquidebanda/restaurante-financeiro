// =========================================================
// SISTEMA FINANCEIRO DO RESTAURANTE v3
// =========================================================

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
        mostrarToast('Sessão encerrada. Faça login novamente.', 'erro');
        setTimeout(() => mostrarTela('login'), 1500);
      } else if (event === 'SIGNED_IN' && session) {
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
  mostrarTela('app');
  const nome = usuario.user_metadata?.nome || usuario.email.split('@')[0];
  document.getElementById('nome-usuario-sidebar').textContent = nome;

  await carregarUnidades();
  await carregarPlanoContas();
  await carregarBancosCadastrados();
  await carregarFornecedores();
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

  iniciarAutoRefresh();
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
let _arUltimaInteracao = Date.now();
let _arUltimoRefresh   = null;

function iniciarAutoRefresh() {
  // Registra qualquer interação do usuário
  ['mousedown','keydown','touchstart','scroll','input'].forEach(ev =>
    document.addEventListener(ev, () => { _arUltimaInteracao = Date.now(); }, { passive: true })
  );

  setInterval(_tentarAutoRefresh, 30000);
}

async function _tentarAutoRefresh() {
  // 1. Só age em Contas a Pagar ou Receber
  const paginaAtiva = document.querySelector('.pagina.ativa')?.id;
  if (!['pagina-pagar','pagina-receber'].includes(paginaAtiva)) return;

  // 2. Páginas bloqueadas
  const paginasBloqueadas = ['pagina-importar','pagina-conciliacao','pagina-orcamento'];
  if (paginasBloqueadas.includes(paginaAtiva)) return;

  // 3. Nenhum modal aberto
  const modalAberto = document.querySelector('.modal-fundo:not(.hidden)');
  if (modalAberto) return;

  // 4. Nenhum campo em foco
  const tag = document.activeElement?.tagName;
  if (['INPUT','TEXTAREA','SELECT'].includes(tag)) return;

  // 5. Usuário não interagiu nos últimos 60 segundos
  const segsInativo = (Date.now() - _arUltimaInteracao) / 1000;
  if (segsInativo < 60) return;

  // Tudo ok — atualiza silenciosamente
  const tipo = paginaAtiva === 'pagina-pagar' ? 'pagar' : 'receber';
  await carregarLancamentos(tipo);
  _arUltimoRefresh = new Date();
  _atualizarIndicadorRefresh(tipo);
}

function _atualizarIndicadorRefresh(tipo) {
  const id = `ar-indicador-${tipo}`;
  let el = document.getElementById(id);
  if (!el) {
    // Cria o indicador na barra de filtros se ainda não existir
    const filtros = document.querySelector(`#pagina-${tipo} .filtros`);
    if (!filtros) return;
    el = document.createElement('span');
    el.id = id;
    el.style.cssText = 'font-size:11px;color:#aaa;white-space:nowrap;align-self:center;';
    filtros.appendChild(el);
  }
  const hora = _arUltimoRefresh.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  el.innerHTML = `<i class="fas fa-sync-alt" style="color:#27ae60;margin-right:4px;"></i>Atualizado às ${hora}`;
}

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
  if (pagina === 'transferencias')   carregarTransferencias();
  if (pagina === 'orcamento')        carregarOrcamentoModo();
  if (pagina === 'relatorios')       carregarRelatorio();
  if (pagina === 'dre')              carregarDre();
  if (pagina === 'usuarios')         carregarUsuarios();
  if (pagina === 'importar')         { preencherSelectBancoImportar(); carregarLancamentosPendentes(); }
  if (pagina === 'conciliacao')      { preencherFiltrosConciliacao(); carregarConciliacao(); }

  // Auto-expandir o grupo accordion correto
  const grupoNavPorPagina = {
    'pagar': 'gestao', 'receber': 'gestao', 'importar': 'gestao',
    'conciliacao': 'gestao', 'transferencias': 'gestao', 'orcamento': 'gestao',
    'plano-contas': 'cadastros', 'unidades': 'cadastros', 'bancos': 'cadastros',
    'fornecedores': 'cadastros', 'centros-custo': 'cadastros', 'formas-pagamento': 'cadastros',
    'dre': 'relatorios', 'relatorios': 'relatorios',
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
  let resultado;
  try {
    resultado = await Promise.race([
      db.from('lancamentos')
        .select('id, descricao, valor, valor_pago, vencimento, tipo, fornecedores(nome)')
        .eq('status', 'pendente')
        .order('vencimento', { ascending: true }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000))
    ]);
  } catch (e) {
    mostrarToast('Conexão lenta ao carregar lançamentos pendentes. Tente novamente.', 'erro');
    return;
  }
  lancamentosPendentes = resultado.data || [];
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
  const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                 'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const mesAtual = new Date().getMonth();
  const anoAtual = new Date().getFullYear();
  const el = document.getElementById('filtro-mes-transferencias');
  if (!el) return;
  el.innerHTML = '<option value="">Todos os meses</option>' +
    meses.map((m, i) => {
      const val = `${anoAtual}-${String(i+1).padStart(2,'0')}`;
      return `<option value="${val}" ${i === mesAtual ? 'selected' : ''}>${m} ${anoAtual}</option>`;
    }).join('');
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
  carregarLancamentos(tipo);
}

async function carregarLancamentos(tipo) {
  if (!(await garantirSessao())) return;
  const db = obterSupabase();
  const statusFiltros  = obterSelecionadosMulti(tipo, 'status');
  const deFiltro       = document.getElementById(`filtro-de-${tipo}`)?.value;
  const ateFiltro      = document.getElementById(`filtro-ate-${tipo}`)?.value;
  const campoData      = document.getElementById(`filtro-tipo-data-${tipo}`)?.value || 'vencimento';
  const fornFiltros    = obterSelecionadosMulti(tipo, 'fornecedor');
  const grupoFiltros   = obterSelecionadosMulti(tipo, 'grupo');
  const bancosFiltro   = obterBancosSelecionados(tipo);

  let query = db.from('lancamentos')
    .select('*, plano_contas(nome, grupo_id), bancos(nome), fornecedores(nome), unidades(nome)')
    .eq('tipo', tipo)
    .order('vencimento', { ascending: true });

  if (statusFiltros.length) query = query.in('status', statusFiltros);

  if (deFiltro)  query = query.gte(campoData, deFiltro);
  if (ateFiltro) query = query.lte(campoData, ateFiltro);

  if (fornFiltros.length) query = query.in('fornecedor_id', fornFiltros);

  if (grupoFiltros.length) {
    const subcatIds = planoContas.filter(p => grupoFiltros.includes(p.grupo_id)).map(p => p.id);
    if (subcatIds.length) query = query.in('plano_conta_id', subcatIds);
    else query = query.eq('plano_conta_id', 'nenhum');
  }

  if (bancosFiltro.length) query = query.in('banco_id', bancosFiltro);

  // Busca paginada para totais (contorna o limite de 1000 linhas do Supabase)
  async function buscarTodosPaginado() {
    const PAGE = 1000;
    let todos = [], pagina = 0;
    while (true) {
      let q2 = db.from('lancamentos')
        .select('valor, status, vencimento')
        .eq('tipo', tipo)
        .range(pagina * PAGE, (pagina + 1) * PAGE - 1);
      if (statusFiltros.length) q2 = q2.in('status', statusFiltros);
      if (deFiltro)             q2 = q2.gte(campoData, deFiltro);
      if (ateFiltro)            q2 = q2.lte(campoData, ateFiltro);
      if (fornFiltros.length)   q2 = q2.in('fornecedor_id', fornFiltros);
      if (grupoFiltros.length) {
        const sc = planoContas.filter(p => grupoFiltros.includes(p.grupo_id)).map(p => p.id);
        if (sc.length) q2 = q2.in('plano_conta_id', sc);
        else q2 = q2.eq('plano_conta_id', 'nenhum');
      }
      if (bancosFiltro.length) q2 = q2.in('banco_id', bancosFiltro);
      const { data: lote } = await q2;
      if (!lote || lote.length === 0) break;
      todos = todos.concat(lote);
      if (lote.length < PAGE) break;
      pagina++;
    }
    return todos;
  }

  const tbody   = document.getElementById(`tbody-${tipo}`);
  const colspan = '8';
  if (tbody) tbody.innerHTML = `<tr><td colspan="${colspan}" class="sem-dados"><i class="fas fa-spinner fa-spin" style="margin-right:6px;color:#c0392b;"></i>Carregando...</td></tr>`;

  let data, error, todosParaTotais;
  try {
    const [resultado, todosTotais] = await Promise.all([
      Promise.race([query, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 30000))]),
      buscarTodosPaginado()
    ]);
    data  = resultado.data;
    error = resultado.error;
    todosParaTotais = todosTotais;
  } catch (e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="${colspan}" class="sem-dados" style="color:#e74c3c;"><i class="fas fa-wifi" style="margin-right:6px;"></i>Conexão lenta. <a href="javascript:void(0)" onclick="carregarLancamentos('${tipo}')" style="color:#c0392b;font-weight:600;">Tentar novamente</a></td></tr>`;
    return;
  }
  if (tratarErro(error, 'Erro ao carregar lançamentos')) return;

  const hoje  = new Date().toISOString().split('T')[0];
  const labelPagar  = tipo === 'pagar' ? 'Pago' : 'Recebido';

  // Armazena dados para re-ordenação
  dadosLancamentos[tipo] = data || [];
  const lancamentos = dadosLancamentos[tipo];

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

function renderizarLinhasLancamentos(tipo, lancamentos) {
  const hoje   = new Date().toISOString().split('T')[0];
  const tbody  = document.getElementById(`tbody-${tipo}`);
  const colspan = '8';
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
    if (col === 'fornecedor') { va = (a.fornecedores?.nome || '').toLowerCase(); vb = (b.fornecedores?.nome || '').toLowerCase(); }
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
    if (l.numero_pedido) subInfos.push(`<i class="fas fa-hashtag"></i> ${l.numero_pedido}`);
    if (l.tem_rateio)         subInfos.push(`<i class="fas fa-code-branch"></i> Rateio`);
    if (l.ofx_id)             subInfos.push(`<i class="fas fa-university" style="color:#27ae60;"></i> <span style="color:#27ae60;font-weight:600;">Extrato conciliado</span>`);
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
        ${fornCell}${descCell}${catCell}${datCell}${valCell}${stCell}${actCell}
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
  ['fornecedor','unidade','descricao','categoria','banco','vencimento','valor','status'].forEach(c => {
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
  const hoje = new Date().toISOString().split('T')[0];
  const { error } = await q(db.from('lancamentos').update({ status: 'pago', data_pagamento: hoje }).eq('id', id))
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
// TRANSFERÊNCIAS
// =========================================================
async function carregarTransferencias() {
  if (!(await garantirSessao())) return;
  const db = obterSupabase();
  const mesFiltro = document.getElementById('filtro-mes-transferencias')?.value;

  let query = db.from('transferencias')
    .select('*, banco_origem:banco_origem_id(nome), banco_destino:banco_destino_id(nome)')
    .order('data', { ascending: false });

  if (mesFiltro) {
    const [ano, mes] = mesFiltro.split('-');
    query = query.gte('data', `${ano}-${mes}-01`)
                 .lte('data', new Date(ano, mes, 0).toISOString().split('T')[0]);
  }

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
    const descNorm   = normalizarTexto(t.descricao);
    const candidates = subcats.filter(p => p.tipo === t.tipo);

    // 1ª tentativa: maior pontuação (quantas palavras do nome da categoria aparecem na descrição)
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

    // 2ª tentativa: alias (ex: "antecipacao" na descrição → busca "credito" na categoria)
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

async function verificarDuplicatasComTimeout(transacoes) {
  const TIMEOUT_MS = 12000;
  const timeout = new Promise(resolve => setTimeout(resolve, TIMEOUT_MS));
  await Promise.race([verificarDuplicatas(transacoes), timeout]);
}

async function verificarDuplicatas(transacoes) {
  const db = obterSupabase();
  const bancoId = document.getElementById('banco-importar')?.value || null;

  // 1. Por fitId (se coluna ofx_id existir no Supabase)
  const fitIds = transacoes.map(t => t.fitId).filter(f => f);
  if (fitIds.length) {
    const { data: jaExistem, error: errOFX } = await db.from('lancamentos')
      .select('ofx_id')
      .in('ofx_id', fitIds);
    if (!errOFX) {
      const idsExistentes = new Set((jaExistem || []).map(l => l.ofx_id));
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
    const candidatos = lancamentosPendentes.filter(l =>
      !usados.has(l.id) &&
      l.tipo === t.tipo &&
      Math.abs(Number(l.valor) - t.valor) < 0.01
    );
    if (!candidatos.length) return;
    const dataTransacao = new Date(t.data + 'T00:00:00');
    candidatos.sort((a, b) => {
      const da = Math.abs(new Date(a.vencimento + 'T00:00:00') - dataTransacao);
      const db = Math.abs(new Date(b.vencimento + 'T00:00:00') - dataTransacao);
      return da - db;
    });
    const melhor = candidatos[0];
    const diffDias = Math.abs(new Date(melhor.vencimento + 'T00:00:00') - dataTransacao) / 86400000;
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
}

// ── Importar Excel - Contas a Pagar ───────────────────────────────────────
let _linhasExcel = [];
let _linhasExcelFiltradas = [];

function abrirImportarExcelPagar() {
  document.getElementById('arquivo-excel-pagar').value = '';
  document.getElementById('arquivo-excel-pagar').click();
}

function lerArquivoExcelPagar(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
      processarExcelPagar(wb);
    } catch (err) {
      mostrarToast('Erro ao ler o arquivo. Verifique se é um .xlsx válido.', 'erro');
    }
  };
  reader.readAsArrayBuffer(file);
}

function _parseExcelDate(val) {
  if (!val) return '';
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof val === 'number') {
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    return d.toISOString().split('T')[0];
  }
  if (typeof val === 'string') {
    const pt = val.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (pt) return `${pt[3]}-${pt[2].padStart(2,'0')}-${pt[1].padStart(2,'0')}`;
    if (/^\d{4}-\d{2}-\d{2}/.test(val)) return val.substring(0, 10);
  }
  return '';
}

function _parseExcelValor(val) {
  if (!val && val !== 0) return 0;
  if (typeof val === 'number') return Math.abs(val);
  const n = parseFloat(String(val).replace(/\s/g,'').replace(/\./g,'').replace(',','.'));
  return Math.abs(n || 0);
}

function _matchNome(lista, nome) {
  if (!nome) return null;
  const n = String(nome).trim().toLowerCase();
  if (!n) return null;
  return lista.find(x => x.nome.trim().toLowerCase() === n) ||
         lista.find(x => x.nome.trim().toLowerCase().includes(n) || n.includes(x.nome.trim().toLowerCase()));
}

function processarExcelPagar(wb) {
  const sheetName = 'LAN_CON';
  if (!wb.SheetNames.includes(sheetName)) {
    mostrarToast(`Aba "${sheetName}" não encontrada. Verifique o nome da aba na planilha.`, 'erro');
    return;
  }
  const ws   = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
  const pagarCats = planoContas.filter(p => !p.tipo || p.tipo === 'pagar');

  _linhasExcel = rows
    .map(r => {
      const vencimento     = _parseExcelDate(r[0]);
      if (!vencimento) return null;
      const fornecedorNome = r[2]  ? String(r[2]).trim()  : '';
      const categoriaNome  = r[5]  ? String(r[5]).trim()  : '';
      const observacao     = r[6]  ? String(r[6]).trim()  : '';
      const descricao      = r[7]  ? String(r[7]).trim()  : '';
      const valor          = _parseExcelValor(r[8]);
      const desconto       = _parseExcelValor(r[9]);
      const ccNome         = r[49] ? String(r[49]).trim() : '';
      if (!descricao || !valor) return null;
      return {
        vencimento,
        descricao,
        valor,
        desconto,
        observacao,
        fornecedorNome,
        fornecedor_id:   _matchNome(fornecedores, fornecedorNome)?.id  || null,
        categoriaNome,
        plano_conta_id:  _matchNome(pagarCats, categoriaNome)?.id      || null,
        ccNome,
        centro_custo_id: _matchNome(centrosCusto, ccNome)?.id          || null,
      };
    })
    .filter(Boolean);

  if (!_linhasExcel.length) {
    mostrarToast('Nenhuma linha válida encontrada na aba LAN_CON.', 'erro');
    return;
  }
  filtrarPreviewExcel();
  document.getElementById('modal-importar-excel-pagar').classList.remove('hidden');
}

function filtrarPreviewExcel() {
  const de  = document.getElementById('excel-filtro-de')?.value  || '';
  const ate = document.getElementById('excel-filtro-ate')?.value || '';
  let linhas = _linhasExcel;
  if (de)  linhas = linhas.filter(l => l.vencimento >= de);
  if (ate) linhas = linhas.filter(l => l.vencimento <= ate);
  _linhasExcelFiltradas = linhas;

  const tbody = document.getElementById('excel-preview-tbody');
  if (!linhas.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="sem-dados">Nenhuma linha no período.</td></tr>';
    document.getElementById('excel-import-info').innerHTML = 'Nenhuma linha para importar.';
    document.getElementById('btn-confirmar-excel').disabled = true;
    return;
  }
  const semCat  = linhas.filter(l => !l.plano_conta_id && l.categoriaNome).length;
  const semForn = linhas.filter(l => !l.fornecedor_id  && l.fornecedorNome).length;
  tbody.innerHTML = linhas.map(l => {
    const corLinha = !l.plano_conta_id && l.categoriaNome ? 'background:#fff8e1;' : '';
    const catHtml  = l.plano_conta_id
      ? `<span style="color:#27ae60;">${l.categoriaNome}</span>`
      : `<span style="color:#e74c3c;">${l.categoriaNome || '—'} ⚠</span>`;
    const fornHtml = l.fornecedor_id
      ? `<span style="color:#27ae60;">${l.fornecedorNome}</span>`
      : `<span style="color:#e67e22;">${l.fornecedorNome || '—'}</span>`;
    const ccHtml   = l.centro_custo_id
      ? `<span style="color:#27ae60;">${l.ccNome}</span>`
      : (l.ccNome ? `<span style="color:#e67e22;">${l.ccNome} ⚠</span>` : '—');
    return `<tr style="${corLinha}">
      <td style="white-space:nowrap;padding:6px 10px;">${formatarData(l.vencimento)}</td>
      <td style="padding:6px 10px;">${l.descricao}</td>
      <td style="padding:6px 10px;">${fornHtml}</td>
      <td style="padding:6px 10px;">${catHtml}</td>
      <td style="text-align:right;padding:6px 10px;white-space:nowrap;">
        <strong>${formatarMoeda(l.valor)}</strong>
        ${l.desconto > 0 ? `<br><span style="font-size:11px;color:#27ae60;">− ${formatarMoeda(l.desconto)}</span>` : ''}
      </td>
      <td style="padding:6px 10px;">${ccHtml}</td>
      <td style="padding:6px 10px;color:#888;">${l.observacao || '—'}</td>
    </tr>`;
  }).join('');
  let info = `<strong>${linhas.length}</strong> linha(s) prontas para importar`;
  if (semCat)  info += ` &nbsp;·&nbsp; <span style="color:#e74c3c;">${semCat} sem categoria</span>`;
  if (semForn) info += ` &nbsp;·&nbsp; <span style="color:#e67e22;">${semForn} fornecedor(es) não encontrado(s)</span>`;
  document.getElementById('excel-import-info').innerHTML = info;
  document.getElementById('btn-confirmar-excel').disabled = false;
}

async function confirmarImportacaoExcelPagar() {
  if (!await garantirSessao()) return;
  const linhas = _linhasExcelFiltradas;
  if (!linhas.length) return;
  const btn = document.getElementById('btn-confirmar-excel');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importando...'; }
  try {
    const db = obterSupabase();

    // Verifica duplicatas: busca lançamentos já existentes no mesmo período
    const minData = linhas.reduce((min, l) => l.vencimento < min ? l.vencimento : min, '9999-12-31');
    const maxData = linhas.reduce((max, l) => l.vencimento > max ? l.vencimento : max, '0000-01-01');
    const { data: jaExistem } = await db.from('lancamentos')
      .select('descricao, vencimento, valor')
      .eq('tipo', 'pagar')
      .gte('vencimento', minData)
      .lte('vencimento', maxData);

    const chaves = new Set((jaExistem || []).map(l =>
      `${(l.descricao || '').trim().toLowerCase()}|${l.vencimento}|${Number(l.valor).toFixed(2)}`
    ));

    const linhasNovas = linhas.filter(l =>
      !chaves.has(`${(l.descricao || '').trim().toLowerCase()}|${l.vencimento}|${Number(l.valor).toFixed(2)}`)
    );
    const duplicadas = linhas.length - linhasNovas.length;

    if (!linhasNovas.length) {
      mostrarToast(`Todas as ${linhas.length} linha(s) já existem no sistema. Nada foi importado.`, 'erro');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-file-excel"></i> Importar Agora'; }
      return;
    }

    const registros = linhasNovas.map(l => ({
      descricao:       l.descricao,
      valor:           l.valor,
      desconto:        l.desconto || 0,
      vencimento:      l.vencimento,
      tipo:            'pagar',
      status:          'pendente',
      plano_conta_id:  l.plano_conta_id  || null,
      fornecedor_id:   l.fornecedor_id   || null,
      centro_custo_id: l.centro_custo_id || null,
      numero_pedido:   l.observacao      || null,
    }));
    const { error } = await q(db.from('lancamentos').insert(registros));
    if (error) throw error;
    fecharModal('modal-importar-excel-pagar');
    let msg = `${linhasNovas.length} conta(s) a pagar importada(s) com sucesso!`;
    if (duplicadas > 0) msg += ` ${duplicadas} ignorada(s) por já existirem no sistema.`;
    mostrarToast(msg, 'sucesso');
    carregarLancamentos('pagar');
  } catch (e) {
    mostrarToast('Erro ao importar. Tente novamente.', 'erro');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-file-excel"></i> Importar Agora'; }
  }
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

  const pendentesDoTipo = lancamentosPendentes.filter(l => l.tipo === t.tipo);
  const dataInicial = t.data || '';
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
  const badge = t.lancamento_id
    ? '<div style="font-size:11px;color:#27ae60;margin-top:3px;"><i class="fas fa-link"></i> conciliado automaticamente</div>'
    : '';
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
    <div style="display:flex;gap:4px;margin-top:5px;flex-wrap:wrap;">
      <button class="btn btn-outline btn-sm" style="font-size:11px;" onclick="abrirConciliacaoMultipla(${i})">
        <i class="fas fa-layer-group"></i> Múltiplos
      </button>
      ${t.tipo === 'receber' ? `<button class="btn btn-outline btn-sm" style="font-size:11px;color:#8e44ad;border-color:#8e44ad;" onclick="abrirDivisaoUnidade(${i})">
        <i class="fas fa-sitemap"></i> Dividir Unidade
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
    const autoMatch  = t.plano_conta_id ? ' <span style="font-size:11px;color:#27ae60;">(auto)</span>' : '';

    const uniOpts = `<option value="">— Nenhuma —</option>`
      + unidades.map(u => `<option value="${u.id}" ${t.unidade_id === u.id ? 'selected' : ''}>${u.nome}</option>`).join('');

    if (t.jaImportado) {
      return `
        <tr style="opacity:0.5; background:#fff8e1;">
          <td><input type="checkbox" onchange="transacoesOFX[${i}].selecionado = this.checked"></td>
          <td>${formatarData(t.data)}</td>
          <td style="max-width:200px;word-break:break-word;font-size:13px;">${t.descricao}</td>
          <td><strong>${formatarMoeda(t.valor)}</strong></td>
          <td><span class="badge badge-${corBadge}">${labelTipo}</span></td>
          <td colspan="3" style="color:#e67e22;font-size:12px;font-weight:600;">
            <i class="fas fa-exclamation-triangle"></i> Já importado anteriormente
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

  document.getElementById('cm-info').innerHTML = `
    <strong>${t.descricao}</strong><br>
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
    db.from('lancamentos').select('descricao, valor, valor_pago, status').eq('id', id).single(),
    db.from('pagamentos')
      .select('valor, data, bancos(nome), plano_contas(nome), origem')
      .eq('lancamento_id', id)
      .order('data', { ascending: true })
  ]);
  document.getElementById('hp-descricao').textContent   = lanc?.descricao || '';
  document.getElementById('hp-valor-total').textContent = formatarMoeda(Number(lanc?.valor || 0));
  const origemLabel = { manual: 'Manual', ofx: 'OFX', desconto: 'Desconto/Baixa' };
  const origemCor   = { manual: { bg:'#eafaf1', txt:'#1a6e3b' }, ofx: { bg:'#eaf4fd', txt:'#2980b9' }, desconto: { bg:'#fff3cd', txt:'#b7770d' } };
  if (!pagtos?.length) {
    document.getElementById('hp-tabela').innerHTML = `<tr><td colspan="5" class="sem-dados">Nenhum pagamento registrado ainda.</td></tr>`;
  } else {
    document.getElementById('hp-tabela').innerHTML = pagtos.map(p => {
      const cor = origemCor[p.origem] || { bg:'#f0f0f0', txt:'#555' };
      return `<tr>
        <td>${formatarData(p.data)}</td>
        <td style="text-align:right;"><strong>${formatarMoeda(Number(p.valor))}</strong></td>
        <td>${p.bancos?.nome || '-'}</td>
        <td>${p.plano_contas?.nome || '-'}</td>
        <td><span style="font-size:11px;padding:2px 8px;border-radius:10px;background:${cor.bg};color:${cor.txt};font-weight:600;">${origemLabel[p.origem] || p.origem}</span></td>
      </tr>`;
    }).join('');
  }
  const valorPago = Number(lanc?.valor_pago || 0);
  const restante  = Number(lanc?.valor || 0) - valorPago;
  document.getElementById('hp-status').innerHTML = lanc?.status === 'pago'
    ? `<span style="color:#27ae60;font-weight:600;"><i class="fas fa-check-circle"></i> Pago integralmente — ${formatarMoeda(valorPago)}</span>`
    : `<span style="color:#e67e22;font-weight:600;"><i class="fas fa-coins"></i> Pago: ${formatarMoeda(valorPago)} — Restante: ${formatarMoeda(restante)}</span>`;
  document.getElementById('modal-historico-pagamentos').classList.remove('hidden');
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
  const selecionadas = transacoesOFX.filter(t => t.selecionado);

  if (!selecionadas.length) { mostrarToast('Selecione ao menos uma transação!', 'erro'); restaurarBtn(); return; }

  try {

  const db     = obterSupabase();
  const aTransferencias  = selecionadas.filter(t => t.transferencia_destino_id);
  const aDividirUnidade  = selecionadas.filter(t => !t.transferencia_destino_id && t.unidade_split?.length > 0);
  const aMultiplos       = selecionadas.filter(t => !t.transferencia_destino_id && !t.unidade_split?.length && t.lancamentos_ids?.length > 0);
  const aConciliar       = selecionadas.filter(t => !t.transferencia_destino_id && !t.unidade_split?.length && t.lancamento_id && !t.lancamentos_ids?.length);
  const aCriar           = selecionadas.filter(t => !t.transferencia_destino_id && !t.unidade_split?.length && !t.lancamento_id && !t.lancamentos_ids?.length);
  let erros = 0;

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
  for (const t of aMultiplos) {
    for (const lancId of t.lancamentos_ids) {
      const { error } = await db.from('lancamentos')
        .update({ status: 'pago', data_pagamento: t.data, banco_id: bancoId, ofx_id: t.fitId || null })
        .eq('id', lancId);
      if (error) { erros++; continue; }
      const lancRef = lancamentosPendentes.find(l => l.id === lancId);
      await q(db.from('pagamentos').insert({
        lancamento_id:  lancId,
        valor:          Number(lancRef?.valor || 0),
        data:           t.data,
        banco_id:       bancoId,
        plano_conta_id: lancRef?.plano_conta_id || null,
        origem:         'ofx',
        ofx_id:         t.fitId || null
      }));
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
    if (t.tipo === 'pagar' && t.centro_custo_id) entry.centroCustoId = t.centro_custo_id;
    if (t.unidade_id) entry.unidadeId = t.unidade_id;
  }
  for (const [lancId, entry] of concilPorLanc) {
    const novoValorPago     = entry.valorPagoAtual + entry.somaOFX;
    const pagamentoCompleto = novoValorPago >= entry.valorTotal - 0.01;
    const updDados = {
      valor_pago: novoValorPago,
      ofx_id:     entry.ofxId,
      banco_id:   bancoId,
      ...(pagamentoCompleto ? { status: 'pago', data_pagamento: entry.data } : {})
    };
    if (entry.tipo === 'pagar' && entry.centroCustoId) updDados.centro_custo_id = entry.centroCustoId;
    if (entry.unidadeId) updDados.unidade_id = entry.unidadeId;
    const { error } = await q(db.from('lancamentos').update(updDados).eq('id', lancId))
    if (error) { erros++; continue; }
    await q(db.from('pagamentos').insert({
      lancamento_id:  lancId,
      valor:          entry.somaOFX,
      data:           entry.data,
      banco_id:       bancoId,
      plano_conta_id: entry.planoContaId || null,
      origem:         'ofx',
      ofx_id:         entry.ofxId
    }));
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

  if (erros) {
    mostrarToast('Erro em algumas transações. Verifique e tente novamente.', 'erro');
  } else {
    const partes = [];
    if (aTransferencias.length) partes.push(`${aTransferencias.length} transferência(s)`);
    if (aDividirUnidade.length) partes.push(`${aDividirUnidade.length} dividida(s) por unidade`);
    if (aMultiplos.length)      partes.push(`${aMultiplos.length} em lote`);
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

  container.innerHTML = `
    <table class="tabela">
      <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Cadastrado em</th>${isAdmin ? '<th></th>' : ''}</tr></thead>
      <tbody>
        ${perfis.map(p => `
          <tr>
            <td>${p.nome}</td>
            <td>${p.email}</td>
            <td>${p.is_admin ? '<span style="color:#c0392b;font-weight:700;">Administrador</span>' : 'Funcionário'}</td>
            <td>${formatarData(p.criado_em?.split('T')[0])}</td>
            ${isAdmin ? `<td>${p.id !== usuario.id && !p.is_admin ? `<button class="btn btn-danger btn-sm" onclick="abrirExcluirUsuario('${p.id}','${p.nome.replace(/'/g, "\\'")}')"><i class="fas fa-trash"></i></button>` : ''}</td>` : ''}
          </tr>`).join('')}
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

  // Usa um cliente temporário para não sobrescrever a sessão do administrador
  const clienteTemp = window.supabase.createClient(SB_URL, SB_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { error } = await clienteTemp.auth.signUp({
    email,
    password: senha,
    options: { data: { nome } }
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

  const [resLanc, resTransf] = await Promise.all([
    q(db.from('lancamentos')
      .select('data_pagamento, tipo, valor, unidade_id, banco_id')
      .eq('status', 'pago')
      .gte('data_pagamento', dataIni)
      .lte('data_pagamento', dataFim)
      .limit(10000)),
    q(db.from('transferencias')
      .select('data, valor, banco_origem_id, banco_destino_id')
      .gte('data', dataIni)
      .lte('data', dataFim)
      .limit(10000))
  ]);
  if (resLanc.error) { tbody.innerHTML = `<tr><td colspan="4" class="sem-dados">Erro ao carregar.</td></tr>`; return; }

  let lancamentos = resLanc.data || [];
  let transferencias = resTransf.data || [];

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
  // Preencher unidades
  const elUnid = document.getElementById('dre-unidade');
  if (elUnid && elUnid.options.length <= 1) {
    unidades.forEach(u => {
      const o = document.createElement('option');
      o.value = u.id; o.textContent = u.nome;
      elUnid.appendChild(o);
    });
  }
  _executarDre();
}

async function _executarDre() {
  if (!(await garantirSessao())) return;
  const db = obterSupabase();
  const mes       = parseInt(document.getElementById('dre-mes')?.value  || (new Date().getMonth() + 1));
  const ano       = parseInt(document.getElementById('dre-ano')?.value  || new Date().getFullYear());
  const unidadeId = document.getElementById('dre-unidade')?.value || '';

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
        .select('tipo, plano_conta_id, valor, data_pagamento')
        .eq('status', 'pago')
        .gte('data_pagamento', de)
        .lte('data_pagamento', ate)
        .range(pagina * PAGE, (pagina + 1) * PAGE - 1);
      if (unidadeId) q2 = q2.eq('unidade_id', unidadeId);
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

  const calMes = _calcularDre(dadosMes);
  const calAno = _calcularDre(dadosAno);
  const mesesPt = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  _renderizarDreKPIs(calMes, calAno);
  _renderizarDreTabela(calMes, calAno, mesesPt[mes-1], ano);

  window._dreCalMes   = calMes;
  window._dreCalAno   = calAno;
  window._dreHistData = dadosHist;
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
  const semCategoria = { qtd: 0, totalRec: 0, totalPag: 0 };
  const planoIds = new Set(planoContas.map(p => p.id));

  lancamentos.forEach(l => {
    if (!l.plano_conta_id || !planoIds.has(l.plano_conta_id)) {
      semCategoria.qtd++;
      if (l.tipo === 'receber') semCategoria.totalRec += Number(l.valor);
      else                      semCategoria.totalPag += Number(l.valor);
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

function _renderizarDreTabela(calMes, calAno, nomeMes, ano) {
  const el = document.getElementById('dre-tabela');
  if (!el) return;

  // Aviso de lançamentos sem categoria
  const sc = calMes.semCategoria;
  let avisoHtml = '';
  if (sc.qtd > 0) {
    const totalExcluido = sc.totalRec + sc.totalPag;
    avisoHtml = `<div style="display:flex;align-items:flex-start;gap:12px;background:#fff8e1;border:1px solid #f39c12;border-radius:10px;padding:14px 16px;margin-bottom:16px;">
      <i class="fas fa-exclamation-triangle" style="color:#f39c12;font-size:20px;flex-shrink:0;margin-top:2px;"></i>
      <div>
        <strong style="color:#b7770d;font-size:13px;">Lançamentos sem categoria excluídos da DRE</strong>
        <p style="margin:4px 0 0;font-size:13px;color:#555;">
          <strong>${sc.qtd}</strong> lançamento${sc.qtd > 1 ? 's' : ''} sem Plano de Contas definido
          foram ignorados neste período — total de <strong>${formatarMoeda(totalExcluido)}</strong>
          ${sc.totalRec > 0 ? ` (receitas: ${formatarMoeda(sc.totalRec)}` : ''}${sc.totalPag > 0 ? `${sc.totalRec > 0 ? ' | ' : ' ('}despesas: ${formatarMoeda(sc.totalPag)}` : ''}${sc.totalRec > 0 || sc.totalPag > 0 ? ')' : ''}.
        </p>
        <p style="margin:6px 0 0;font-size:12px;color:#888;">Para corrigir, abra as telas de <strong>Contas a Pagar</strong> ou <strong>Contas a Receber</strong>, filtre por status "Pago" e atribua uma categoria aos lançamentos sem classificação.</p>
      </div>
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

  let html = avisoHtml + `<div style="overflow-x:auto;">
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
