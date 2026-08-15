const fs = require('fs');
const s = fs.readFileSync('webui/src/i18n/locales/zh.ts', 'utf8');
const probe = (name, needle) => {
  const count = (s.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  const i = s.indexOf(needle);
  console.log(name, 'count=' + count, i >= 0 ? JSON.stringify(s.slice(Math.max(0, i - 8), i + 45)) : 'ABSENT');
};
probe('PLUGIN_ID', 'PLUGIN_ID_REQUIRED');
probe('EXT_NAME', 'EXTENSION_NAME_REQUIRED');
probe('nav-model', "model: '");
console.log('crlf=', (s.match(/\r\n/g) || []).length, 'lf=', (s.match(/\n/g) || []).length);
console.log('moduleType=', s.includes('moduleType'), 'mcpTab=', s.includes('mcpTab'), 'nav-tools=', s.includes("tools: '工具'"));
