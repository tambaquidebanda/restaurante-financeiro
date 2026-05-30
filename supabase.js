const SB_URL = 'https://pwmpqdaaogrrdlqxcqev.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3bXBxZGFhb2dycmRscXhjcWV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0NTM5MDYsImV4cCI6MjA5NTAyOTkwNn0.NCsE48pa8mv7mtU3bCtZEmyE5uT5yQVq-kVT7AUCjQI';

let supabaseClient = null;

function inicializarSupabase(url, key) {
  supabaseClient = window.supabase.createClient(url, key, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false
    }
  });
  return supabaseClient;
}

function obterSupabase() {
  if (supabaseClient) return supabaseClient;
  return inicializarSupabase(SB_URL, SB_KEY);
}

async function fazerLogin(email, senha) {
  return await obterSupabase().auth.signInWithPassword({ email, password: senha });
}

async function fazerLogout() {
  return await obterSupabase().auth.signOut();
}

async function obterSessao() {
  const db = obterSupabase();
  if (!db) return null;
  const { data: { session } } = await db.auth.getSession();
  return session;
}

async function obterUsuarioAtual() {
  const db = obterSupabase();
  if (!db) return null;
  const { data: { user } } = await db.auth.getUser();
  return user;
}

async function alterarMinhaSenha(novaSenha) {
  return await obterSupabase().auth.updateUser({ password: novaSenha });
}
