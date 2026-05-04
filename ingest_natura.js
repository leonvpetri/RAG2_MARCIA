import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const IMAGES_DIR = './public/natura';
const PROGRESS_FILE = './progress_natura.json';
const TOTAL_IMAGES = 164;
const DELAY_MS = 1000;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

function loadProgress() {
  if (fs.existsSync(PROGRESS_FILE)) {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
  }
  return { completed: [] };
}

function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function extractText(base64) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: 'Extraia todo o texto visível nesta página de catálogo. Inclua nomes de produtos, descrições, preços, códigos e slogans. Retorne apenas o texto, sem formatação extra.' },
            { inline_data: { mime_type: 'image/jpeg', data: base64 } },
          ],
        }],
        generationConfig: { temperature: 0 },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini Vision error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
}

async function getEmbedding(base64, texto) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'models/gemini-embedding-2',
        content: {
          parts: [
            { text: texto },
            { inline_data: { mime_type: 'image/jpeg', data: base64 } },
          ],
        },
        outputDimensionality: 768,
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini Embedding error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.embedding.values;
}

async function insertPage(pagina, arquivo, texto, embedding) {
  const MAX_RETRIES = 5;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const { error } = await supabase
      .from('catalogo_natura')
      .insert({ pagina, marca: 'natura', arquivo, texto, embedding });

    if (!error) return;

    const isNetwork = error.message?.includes('fetch failed') || error.message?.includes('network');
    if (isNetwork && attempt < MAX_RETRIES) {
      const wait = attempt * 3000;
      console.warn(`  Supabase rede instável, tentativa ${attempt}/${MAX_RETRIES} — aguardando ${wait / 1000}s...`);
      await sleep(wait);
      continue;
    }

    throw new Error(`Supabase insert error: ${error.message}`);
  }
}

async function clearTable() {
  console.log('Limpando tabela catalogo_natura...');
  const { error } = await supabase
    .from('catalogo_natura')
    .delete()
    .gte('pagina', 0);
  if (error) throw new Error(`Supabase delete error: ${error.message}`);
  console.log('Tabela limpa.\n');
}

async function main() {
  const progress = loadProgress();
  const completed = new Set(progress.completed);

  if (completed.size === 0) {
    await clearTable();
  } else {
    console.log(`Retomando do progresso: ${completed.size}/${TOTAL_IMAGES} já processadas.\n`);
  }

  console.log(`Iniciando ingestão de ${TOTAL_IMAGES} imagens Natura...\n`);

  for (let i = 0; i < TOTAL_IMAGES; i++) {
    const arquivo = `natura-abril-2026${i}.jpg`;
    const pagina = i + 1;
    const imagePath = path.join(IMAGES_DIR, arquivo);

    if (completed.has(arquivo)) {
      console.log(`[${pagina}/${TOTAL_IMAGES}] Já processado — pulando.`);
      continue;
    }

    if (!fs.existsSync(imagePath)) {
      console.warn(`[${pagina}/${TOTAL_IMAGES}] Arquivo não encontrado: ${arquivo} — pulando.`);
      continue;
    }

    try {
      const base64 = fs.readFileSync(imagePath).toString('base64');

      console.log(`[${pagina}/${TOTAL_IMAGES}] Extraindo texto: ${arquivo}`);
      const texto = await extractText(base64);

      console.log(`[${pagina}/${TOTAL_IMAGES}] Gerando embedding...`);
      const embedding = await getEmbedding(base64, texto);

      console.log(`[${pagina}/${TOTAL_IMAGES}] Salvando no Supabase...`);
      await insertPage(pagina, arquivo, texto, embedding);

      completed.add(arquivo);
      progress.completed = [...completed];
      saveProgress(progress);

      console.log(`[${pagina}/${TOTAL_IMAGES}] OK.\n`);
    } catch (err) {
      console.error(`[${pagina}/${TOTAL_IMAGES}] Erro: ${err.message}`);
      console.error('Progresso salvo. Execute novamente para retomar.');
      process.exit(1);
    }

    if (i < TOTAL_IMAGES - 1) await sleep(DELAY_MS);
  }

  console.log(`Concluído! ${completed.size} páginas vetorizadas.`);
}

main();
