import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync } from 'fs';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function uploadFolder(localFolder, bucket) {
  const files = readdirSync(localFolder).filter(f => extname(f).toLowerCase() === '.jpg');
  const total = files.length;

  console.log(`\n📁 Bucket: ${bucket} — ${total} arquivos encontrados`);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = join(localFolder, file);
    const fileData = readFileSync(filePath);

    const { error } = await supabase.storage
      .from(bucket)
      .upload(file, fileData, { contentType: 'image/jpeg', upsert: true });

    if (error) {
      console.error(`  ❌ Erro ${i + 1}/${total} — ${file}: ${error.message}`);
    } else {
      console.log(`  ✅ Upload ${i + 1}/${total} — ${file}`);
    }

    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n✔ ${bucket} concluído.\n`);
}

const base = join(__dirname, 'public');

await uploadFolder(join(base, 'boticario'), 'catalogo-boticario');
await uploadFolder(join(base, 'natura'),    'catalogo-natura');

console.log('🎉 Todos os uploads finalizados.');
