const fs = require('fs');
const path = 'src/audit.ts';
let source = fs.readFileSync(path, 'utf8');
const needle = '  if (/^just a moment(?:\\.\\.\\.)?$/i.test(title) || /^just a moment\\b/i.test(visiblePrefix)) {\n    return "Cloudflare challenge page";\n  }';
const replacement = '  if (/^just a moment(?:\\.\\.\\.)?$/i.test(title) || /^just a moment\\b/i.test(visiblePrefix) || /title:\\s*just a moment/i.test(visiblePrefix) || /performing security verification|page maybe requiring captcha/i.test(visiblePrefix)) {\n    return "Cloudflare challenge page";\n  }';
if (!source.includes(needle)) throw new Error('challenge guard anchor not found');
source = source.replace(needle, replacement);
fs.writeFileSync(path, source);
console.log('Installed Reader/challenge semantic guard.');
