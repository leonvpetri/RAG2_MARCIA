import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { search: searchBoticario } = await import('./search.js');
const { search: searchNatura }    = await import('./search_natura.js');

const app = express();
app.use(cors());

app.post('/webhook', express.raw({ type: '*/*' }), async (req, res) => {
  res.sendStatus(200);

  let body;
  try {
    const raw = req.body.toString('utf8');
    body = JSON.parse(raw);
  } catch (err) {
    console.error('WhatsApp webhook parse error:', err.message);
    console.error('Raw body:', req.body.toString('utf8').substring(0, 500));
    return;
  }

  try {
    const { event, data } = body ?? {};

    if (event !== 'messages.upsert') return;
    if (data?.key?.fromMe !== false) return;

    const phone = data?.key?.remoteJid;
    const texto = data?.message?.conversation ?? data?.message?.extendedTextMessage?.text;

    if (!phone || !texto?.trim()) return;

    const brand = detectBrand(texto);

    if (!brand) {
      await sendWhatsApp(phone,
        'Para qual catálogo você quer buscar?\n\nDigite o nome do produto + a marca:\n✅ Sérum Chronos Natura informações\n✅ Perfume Malbec Boticário informações'
      );
      return;
    }

    const searchFn = brand === 'natura' ? searchNatura : searchBoticario;
    const result = await searchFn(texto);

    if (!result?.paginas?.length) {
      await sendWhatsApp(phone,
        'Não encontrei esse produto. Tente ser mais específico — inclua o nome da linha ou o código do produto.'
      );
      return;
    }

    const top = result.paginas[0];
    const pagina = top.pagina_interna ?? top.pagina;
    const { text, codigo } = await generateResponse(texto, top, brand);

    const msg1 = codigo ? `${text}\n🔍 Código: ${codigo}` : text;
    const msg2 = `📖 Ver no catálogo: ${BASE_URL}${buildFlipbookUrl(brand, pagina)}`;

    await sendWhatsApp(phone, msg1);
    await sendWhatsApp(phone, msg2);
  } catch (err) {
    console.error('Erro /webhook:', err.message);
  }
});

app.use(express.json());
app.get('/natura/:file', (req, res) => {
  const filePath = path.join(__dirname, 'public/natura', req.params.file);
  res.setHeader('Content-Type', 'text/html');
  res.sendFile(filePath);
});

app.get('/boticario/:file', (req, res) => {
  const filePath = path.join(__dirname, 'public/boticario', req.params.file);
  res.setHeader('Content-Type', 'text/html');
  res.sendFile(filePath);
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/imagens', express.static(path.join(__dirname, 'public/boticario')));
app.use('/boticario', express.static(path.join(__dirname, 'public/boticario')));
app.use('/natura',   express.static(path.join(__dirname, 'public/natura')));

function detectBrand(message) {
  const lower = message.toLowerCase();
  if (lower.includes('natura')) return 'natura';
  if (lower.includes('boticario') || lower.includes('boticário')) return 'boticario';
  return null;
}

function buildFlipbookUrl(brand, pagina) {
  if (brand === 'natura')
    return `/natura/natura-abril-2026.htm#page/${pagina}`;
  return `/boticario/catalogo_boticario_abril.htm#page/${pagina}`;
}

function buildImagemUrl(brand, arquivo) {
  if (brand === 'natura') return `/natura/${arquivo}`;
  return `/imagens/${arquivo}`;
}

async function generateResponse(query, resultado, brand) {
  const nomeCatalogo = brand === 'natura' ? 'Natura' : 'O Boticário';
  const pagina = resultado.pagina_interna ?? resultado.pagina;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `Você é uma consultora virtual simpática do catálogo ${nomeCatalogo}.

Cliente buscou: "${query}"

Conteúdo encontrado no catálogo (página ${pagina}):
${resultado.texto}

Retorne um JSON com dois campos:
- "resposta": texto em 2 linhas no máximo destacando o produto mais relevante com nome completo e preço. Use 1 emoji no máximo.
- "codigo": o código numérico do produto mais relevante (número de 4 a 6 dígitos presente no texto). Se não encontrar, retorne null.` }] }],
        generationConfig: { temperature: 0.5, maxOutputTokens: 200, responseMimeType: 'application/json' },
      }),
    }
  );
  const data = await res.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  try {
    const parsed = JSON.parse(raw);
    return { text: parsed.resposta ?? 'Produto encontrado! Confira a página do catálogo abaixo.', codigo: parsed.codigo ?? null };
  } catch {
    return { text: raw, codigo: null };
  }
}

app.post('/search', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'Mensagem vazia' });

    const brand = detectBrand(message);

    if (!brand) {
      return res.json({
        text: 'Para qual catálogo você quer buscar?\n\nDigite o nome do produto + a marca:\n✅ Sérum Chronos Natura informações\n✅ Perfume Malbec Boticário informações',
      });
    }

    const searchFn = brand === 'natura' ? searchNatura : searchBoticario;
    const result = await searchFn(message);

    if (!result?.paginas?.length) {
      return res.json({
        text: 'Não encontrei esse produto. Tente ser mais específico — inclua o nome da linha ou o código do produto.',
      });
    }

    const top = result.paginas[0];
    const pagina = top.pagina_interna ?? top.pagina;
    const { text, codigo } = await generateResponse(message, top, brand);

    res.json({
      text,
      codigo,
      brand,
      pagina,
      arquivo: top.arquivo,
      imagem_url: buildImagemUrl(brand, top.arquivo),
      flipbook_url: buildFlipbookUrl(brand, pagina),
    });
  } catch (err) {
    console.error('Erro /search:', err.message);
    res.status(500).json({ error: 'Erro interno. Tente novamente.' });
  }
});

const BASE_URL = process.env.BASE_URL ?? 'https://artefinal-rag2-marcia.gumtcw.easypanel.host';
const EVOLUTION_URL = process.env.EVOLUTION_URL;
const EVOLUTION_APIKEY = process.env.EVOLUTION_APIKEY;
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE;

async function sendWhatsApp(phone, text) {
  await fetch(`${EVOLUTION_URL}/message/sendText/${EVOLUTION_INSTANCE}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': EVOLUTION_APIKEY,
    },
    body: JSON.stringify({ number: phone, text }),
  });
}

app.listen(3001, () => console.log('✅ CRM Natura + Boticário: http://localhost:3001'));
