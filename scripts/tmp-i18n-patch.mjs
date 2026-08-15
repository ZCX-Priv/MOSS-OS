// one-off patch v2: apply i18n edits from JSON data, after normalizing CRLF -> LF (deleted after run)
import { readFileSync, writeFileSync } from 'node:fs';

const data = JSON.parse(readFileSync('scripts/tmp-i18n-patch.json', 'utf8'));

for (const locale of ['zh', 'en']) {
  const d = data[locale];
  let src = readFileSync(d.file, 'utf8').replace(/\r\n/g, '\n');
  const before = src;
  let ok = 0, fail = 0;

  for (const line of d.deleteLines) {
    const needle = line + '\n';
    if (src.includes(needle)) { src = src.split(needle).join(''); ok++; }
    else { console.log(`[${locale}] DELETE-LINE miss:`, JSON.stringify(line)); fail++; }
  }
  for (const block of d.deleteBlocks) {
    if (src.includes(block)) { src = src.split(block).join(''); ok++; }
    else { console.log(`[${locale}] DELETE-BLOCK miss`); fail++; }
  }
  for (const [o, n] of d.replaceExact) {
    if (src.includes(o)) { src = src.split(o).join(n); ok++; }
    else { console.log(`[${locale}] REPLACE miss:`, JSON.stringify(o.slice(0, 50))); fail++; }
  }
  if (src.includes(d.pluginsOld)) { src = src.split(d.pluginsOld).join(d.pluginsNew); ok++; }
  else { console.log(`[${locale}] PLUGINS miss`); fail++; }

  if (src !== before) writeFileSync(d.file, src, 'utf8');
  console.log(`[${locale}] ok=${ok} fail=${fail} ${src !== before ? 'written' : 'NO-CHANGE'}`);
}
