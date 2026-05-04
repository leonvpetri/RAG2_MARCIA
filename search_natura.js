import { createClient } from '@supabase/supabase-js';

let _supabase;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  }
  return _supabase;
}

async function getQueryEmbedding(text) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'models/gemini-embedding-2',
        content: { parts: [{ text }] },
        outputDimensionality: 768,
      }),
    }
  );
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${err}`);
  }
  const data = await response.json();
  return data.embedding.values;
}

async function rerank(query, candidates) {
  const lista = candidates
    .map((c, i) => `[${i}] Página ${c.pagina} — ${c.arquivo}\n${c.texto}`)
    .join('\n\n---\n\n');

  const prompt = `Você é um assistente de catálogo. O usuário buscou: "${query}"

Abaixo estão ${candidates.length} páginas candidatas com seu texto extraído.
Retorne APENAS um JSON com os índices das 5 páginas mais relevantes em ordem decrescente de relevância.
Formato: {"ranking": [2, 0, 4, 1, 3]}

Páginas:
${lista}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    }
  );
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini Rerank error ${response.status}: ${err}`);
  }
  const data = await response.json();
  const json = JSON.parse(data.candidates[0].content.parts[0].text);
  return json.ranking.slice(0, 5).map(i => candidates[i]);
}

async function rpcWithRetry(fn) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const { data, error } = await fn();
    if (!error) return data;
    const isNetwork = error.message?.includes('fetch failed') || error.message?.includes('network') || error.message?.includes('timeout');
    if (isNetwork && attempt < 4) {
      console.warn(`  Conexão instável, tentativa ${attempt}/4 — aguardando ${attempt * 3}s...`);
      await new Promise(r => setTimeout(r, attempt * 3000));
      continue;
    }
    throw new Error(`Supabase RPC error: ${error.message}`);
  }
}

async function search(query, limite = 5) {
  const isCodigo = /^\d+$/.test(query.trim());

  // Natura: pagina no Supabase = índice + 1, sem offset de impressão
  const formatRow = (row) => ({
    pagina: row.pagina,
    arquivo: row.arquivo,
    texto: row.texto,
    ...(row.similarity !== undefined && { similarity: row.similarity }),
  });

  if (isCodigo) {
    console.log(`\nBuscando por código: "${query}"\n`);
    const raw = await rpcWithRetry(() =>
      getSupabase().rpc('buscar_natura_por_codigo', { codigo: query.trim(), limite })
    );
    if (!raw || raw.length === 0) return console.log('Nenhum resultado encontrado.');
    const result = raw.map(formatRow);
    result.forEach((row, i) => console.log(`${i + 1}. Página ${row.pagina} — ${row.arquivo}`));
    return { paginas: result };
  }

  console.log(`\nBuscando: "${query}"\n`);
  const embedding = await getQueryEmbedding(query);

  const raw = await rpcWithRetry(() =>
    getSupabase().rpc('buscar_natura_hibrido', { query_embedding: embedding, query_texto: query, limite: 15 })
  );
  if (!raw || raw.length === 0) return console.log('Nenhum resultado encontrado.');

  const candidates = raw.map(formatRow);

  console.log(`  Rerankeando ${candidates.length} candidatos...\n`);
  const reranked = await rerank(query, candidates);

  reranked.forEach((row, i) =>
    console.log(`${i + 1}. Página ${row.pagina} — ${row.arquivo}`)
  );

  return { paginas: reranked };
}

import { fileURLToPath } from 'url';
const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const query = process.argv[2];
  if (!query) {
    console.error('Uso: node search_natura.js "sua busca aqui"');
    process.exit(1);
  }
  search(query).catch(err => {
    console.error('Erro:', err.message);
    process.exit(1);
  });
}

export { search };
