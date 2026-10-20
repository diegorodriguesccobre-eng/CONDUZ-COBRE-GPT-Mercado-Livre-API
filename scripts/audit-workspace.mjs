import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const files = (...args) => git('ls-files', '-z', ...args).split('\0').filter(Boolean);
const tracked = files();
const untracked = files('--others', '--exclude-standard');
const ignored = files('--others', '--ignored', '--exclude-standard');
const categories = {};
for (const file of ignored) { const category = file.split('/')[0]; categories[category] = (categories[category] ?? 0) + 1; }
const findings = [];
for (const file of tracked) {
  if (/^(node_modules|dist|\.wrangler)\//.test(file) || /(^|\/)(\.dev\.vars|\.env)(\.|$)/.test(file) && !file.endsWith('.example')) {
    findings.push({ code: 'SENSITIVE_TRACKED_FILE', file });
  }
}
for (const file of ['.dev.vars', '.env', '.wrangler/example', 'node_modules/example', 'dist/example']) {
  const result = execFileSync('git', ['check-ignore', file], { encoding: 'utf8' }).trim();
  if (!result) findings.push({ code: 'MISSING_IGNORE', file });
}
if (existsSync('.dev.vars')) {
  const names = readFileSync('.dev.vars', 'utf8').split('\n').filter(l => /^[A-Z_]+=/.test(l)).map(l => l.split('=')[0]);
  if (names.some(name => !['INTERNAL_AUTH_KEY', 'TOKEN_ENCRYPTION_KEY'].includes(name))) findings.push({ code: 'UNEXPECTED_LOCAL_BINDING' });
}
const history = git('rev-list', '--all').trim().split('\n').filter(Boolean);
const reflog = new Set(git('reflog', '--all', '--format=%H').trim().split('\n').filter(Boolean));
const result = { tracked_files: tracked.length, untracked_files: untracked.length, ignored_files: ignored.length,
  ignored_categories: categories, reachable_commits: history.length, reflog_commits: reflog.size,
  findings, note: 'Inventário e política de arquivos. Executar também Gitleaks e npm audit; nenhum valor de segredo é impresso.' };
console.log(JSON.stringify(result, null, 2));
if (findings.length) process.exitCode = 1;
