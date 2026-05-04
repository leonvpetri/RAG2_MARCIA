# RAG2_Marcia — Pipeline RAG Multimodal (Natura + Boticário)

## Idioma
Sempre responda em português do Brasil.

## Sobre o projeto
Pipeline RAG multimodal para vetorizar os catálogos Natura e O Boticário
usando Gemini Embedding 2 (768d) via API REST e armazenar no Supabase pgvector.
Serve de backend para o CRM_Boticario (projeto irmão).

## Stack
- Node.js ESM (sem SDK Google — fetch nativo obrigatório)
- @supabase/supabase-js
- Supabase pgvector — projeto rag2_marcia (São Paulo)
- Gemini Embedding 2 — embeddings multimodais (texto + imagem)
- gemini-3.1-flash-lite-preview — OCR e reranker

## Estrutura de arquivos

### Ingestão
- `ingest.js` — vetoriza 199 JPGs do Boticário → catalogo_boticario
- `ingest_natura.js` — vetoriza 164 JPGs da Natura → catalogo_natura
- `progress.json` — controle de progresso Boticário (retomada segura)
- `progress_natura.json` — controle de progresso Natura (retomada segura)

### Busca
- `search.js` — busca Boticário; exporta `{ search }` para uso como módulo
- `search_natura.js` — busca Natura; exporta `{ search }` para uso como módulo

### Imagens
- `public/boticario/` — 199 JPGs do catálogo Boticário + flipbook .htm
- `public/natura/` — 164 JPGs do catálogo Natura + flipbook .htm

### Credenciais
- `.env` — GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY (nunca commitar)

## Padrão de arquivos e numeração

### Boticário
- Arquivo: `catalogo_boticario_abril{indice}.jpg` (índice 0 a 198)
- `pagina` no Supabase = índice + 1 (1 a 199)
- `pagina_interna` = pagina no Supabase
- `pagina_impressa` (exibida no CRM) = pagina_interna - 2
- Flipbook: `/boticario/catalogo_boticario_abril.htm#page/{pagina_interna}`

### Natura
- Arquivo: `natura-abril-2026{indice}.jpg` (índice 0 a 163)
- `pagina` no Supabase = índice + 1 (1 a 164)
- Sem offset: pagina no Supabase = página impressa no catálogo físico
- Flipbook: `/natura/natura-abril-2026.htm#page/{pagina}`

## Supabase
- Projeto: rag2_marcia
- URL: https://igfwzwgecgtzkhbbqomq.supabase.co
- Região: São Paulo

### Tabela catalogo_boticario (199 páginas)
- Campos: pagina, marca ('O Boticário'), arquivo, texto, embedding vector(768)
- Funções RPC:
  - `buscar_hibrido(query_embedding, query_texto, limite)` — 60% vetorial + 40% ts_rank
  - `buscar_por_codigo(codigo, limite)` — ILIKE no texto, ORDER BY POSITION
  - `buscar_pagina(query_embedding, limite)` — vetorial puro (legado)

### Tabela catalogo_natura (164 páginas)
- Campos: pagina, marca ('natura'), arquivo, texto, embedding vector(768)
- Funções RPC:
  - `buscar_natura_hibrido(query_embedding, query_texto, limite)` — busca híbrida
  - `buscar_natura_por_codigo(codigo, limite)` — busca por código numérico

## API Gemini (fetch nativo — sem SDK)

### OCR (extração de texto)
```
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key={GEMINI_API_KEY}
```
- Prompt: extrair todo texto visível da página (nomes, preços, códigos, slogans)
- Retorna texto plano sem formatação extra

### Embedding multimodal
```
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent?key={GEMINI_API_KEY}
```
- Partes: { text: texto_ocr } + { inline_data: { mime_type: 'image/jpeg', data: base64 } }
- outputDimensionality: 768

### Reranker (pós-busca)
```
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key={GEMINI_API_KEY}
```
- Recebe 15 candidatos, retorna JSON `{"ranking": [2, 0, 4, 1, 3]}`
- responseMimeType: 'application/json', temperature: 0

## Fluxo de busca (search.js / search_natura.js)
1. Query numérica → `buscar_por_codigo` / `buscar_natura_por_codigo` (sem embedding)
2. Query texto:
   a. Gerar embedding da query via Gemini Embedding 2
   b. `buscar_hibrido` / `buscar_natura_hibrido` → 15 candidatos
   c. Reranker Gemini escolhe top 5
3. Retorna `{ paginas: [{ pagina, pagina_interna, arquivo, texto, similarity }] }`
4. `search.js` exporta `{ search }` para importação pelo CRM_Boticario

## Regras
- NUNCA usar SDK do Google
- NUNCA commitar .env
- Sempre usar fetch nativo para chamadas à API Gemini
- Delay de 1 segundo entre imagens na ingestão
- Salvar progresso em progress*.json para retomada segura
- search.js e search_natura.js são exportáveis como módulos (export { search })
