/* Smarter sanity check on T-SQL files.
 * Strips CASE ... END regions before counting BEGIN/END balance. */
'use strict';
const fs = require('fs');
const path = require('path');

const files = ['001_schema.sql', '002_seed_coa.sql', '003_seed_units.sql'];

function stripCaseEnds(text) {
  // Remove CASE ... END (handling nesting crudely by walking left-to-right)
  let out = '';
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    // CASE keyword
    const caseM = rest.match(/^\bCASE\b/i);
    if (caseM) {
      depth++;
      i += 4;
      continue;
    }
    const endM = rest.match(/^\bEND\b/i);
    if (endM) {
      if (depth > 0) { depth--; i += 3; continue; }
      out += 'END';
      i += 3;
      continue;
    }
    out += text[i];
    i++;
  }
  return out;
}

let totalErrors = 0;
for (const f of files) {
  const p = path.join(__dirname, '..', 'database', f);
  const text = fs.readFileSync(p, 'utf8');
  const stripped = stripCaseEnds(text);
  const lines = stripped.split(/\r?\n/);
  let beginDepth = 0;
  let goCount = 0;
  const issues = [];
  lines.forEach((line, idx) => {
    const i = idx + 1;
    const trimmed = line.trim();
    if (/^--/.test(trimmed)) return;
    const bM = trimmed.match(/\bBEGIN\b/gi);
    if (bM) beginDepth += bM.length;
    const eM = trimmed.match(/\bEND\b/gi);
    if (eM) beginDepth -= eM.length;
    if (/^\s*GO\s*$/i.test(trimmed)) {
      goCount++;
      if (beginDepth !== 0) {
        issues.push(`Line ${i}: GO with unbalanced BEGIN/END depth=${beginDepth}`);
      }
    }
  });
  if (beginDepth !== 0) {
    issues.push(`Final BEGIN/END depth = ${beginDepth} (should be 0)`);
  }
  console.log(`${f}: ${goCount} GO batches, ${issues.length} issues`);
  for (const x of issues.slice(0, 10)) console.log('  -', x);
  totalErrors += issues.length;
}
console.log('\nTotal issues:', totalErrors);
process.exit(totalErrors === 0 ? 0 : 1);
