const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const TEXT_EXTENSIONS = new Set([
  '', '.cjs', '.js', '.json', '.md', '.mjs', '.ps1', '.py', '.sh', '.toml', '.ts', '.yaml', '.yml'
]);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function removeDir(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function normalizeGithubRepository(input) {
  if (!input || typeof input !== 'string') throw new Error('GitHub repository must be a non-empty string');
  let value = input.trim()
    .replace(/^git@github\.com:/, '')
    .replace(/^ssh:\/\/git@github\.com\//, '')
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/^github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/^\/+|\/+$/g, '');
  const parts = value.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error(`Invalid GitHub repository: ${input}`);
  const repository = `${parts[0]}/${parts[1]}`;
  return { repository, cloneUrl: `https://github.com/${repository}.git` };
}

function listFiles(root) {
  const files = [];
  function visit(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) files.push(full);
    }
  }
  if (fs.existsSync(root)) visit(root);
  return files;
}

function copyDir(source, target) {
  if (!fs.existsSync(source)) throw new Error(`Source directory does not exist: ${source}`);
  ensureDir(target);
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else if (entry.isFile()) {
      ensureDir(path.dirname(to));
      fs.copyFileSync(from, to);
    }
  }
}

function hashDirectory(root) {
  if (!fs.existsSync(root)) throw new Error(`Directory does not exist: ${root}`);
  const hash = crypto.createHash('sha256');
  for (const file of listFiles(root)) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    const fileHash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    hash.update(relative);
    hash.update('\0');
    hash.update(fileHash);
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

function loadYamlFile(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return yaml.load(fs.readFileSync(file, 'utf8')) || fallback;
}

function writeYamlFile(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, yaml.dump(data, { lineWidth: 100, noRefs: true }));
}

function loadJsonFile(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJsonFile(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function isSafeRelativePath(value) {
  return typeof value === 'string' && value.length > 0 && !path.isAbsolute(value) && !value.split(/[\\/]/).includes('..');
}

function validateSources(sources) {
  const errors = [];
  if (!sources || sources.version !== 1) errors.push('sources file must contain version: 1');
  const marketplace = sources && sources.marketplace;
  if (!marketplace || !marketplace.name) errors.push('sources file must contain marketplace.name');
  if (!marketplace || !marketplace.owner || !marketplace.owner.name) errors.push('sources file must contain marketplace.owner.name');
  const plugins = sources && sources.plugins ? sources.plugins : {};
  for (const [name, item] of Object.entries(plugins)) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) errors.push(`${name}: invalid plugin name`);
    if (!item || item.type !== 'github') errors.push(`${name}: only github sources are supported`);
    if (!item || !item.repository) errors.push(`${name}: missing repository`);
    if (!item || !isSafeRelativePath(item.path || '.')) errors.push(`${name}: invalid path`);
    if (!item || !isSafeRelativePath(item.target)) errors.push(`${name}: invalid target`);
    if (!item || !item.track || !item.track.type || !item.track.value) errors.push(`${name}: missing track.type/value`);
    const platforms = item && Array.isArray(item.platforms) ? item.platforms : [];
    if (platforms.length === 0) errors.push(`${name}: platforms must contain claude and/or codex`);
    for (const platform of platforms) {
      if (!['claude', 'codex'].includes(platform)) errors.push(`${name}: unsupported platform ${platform}`);
    }
  }
  return errors;
}

function execGit(args, cwd) {
  return childProcess.execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function selectLsRemoteRef(output, requested) {
  if (!output) throw new Error('No refs returned by git ls-remote');
  const type = requested && requested.type ? requested.type : 'branch';
  const value = requested && requested.value ? requested.value : 'main';
  const exact = type === 'tag' ? `refs/tags/${value}` : type === 'branch' ? `refs/heads/${value}` : value;
  for (const line of output.split('\n').map((item) => item.trim()).filter(Boolean)) {
    const fields = line.split(/\s+/);
    if (fields[1] === exact || fields[1] === `${exact}^{}`) return fields[0];
  }
  if (type === 'commit' && /^[a-f0-9]{40}$/.test(value)) return value;
  throw new Error(`Unable to find exact ref ${exact}`);
}

function resolveGithubHead(source) {
  const normalized = normalizeGithubRepository(source.repository);
  const requested = source.track || { type: 'branch', value: 'main' };
  return selectLsRemoteRef(execGit(['ls-remote', normalized.cloneUrl, requested.value], process.cwd()), requested);
}

function cloneGithubSource(source, workDir) {
  const normalized = normalizeGithubRepository(source.repository);
  const requested = source.track || { type: 'branch', value: 'main' };
  const cloneDir = path.join(workDir, 'repo');
  const args = ['clone', '--depth', '1'];
  if (requested.type === 'branch' || requested.type === 'tag') args.push('--branch', requested.value);
  args.push(normalized.cloneUrl, cloneDir);
  execGit(args, workDir);
  if (requested.type === 'commit') execGit(['checkout', requested.value], cloneDir);
  const commit = execGit(['rev-parse', 'HEAD'], cloneDir);
  const sourcePath = source.path === '.' ? cloneDir : path.join(cloneDir, source.path);
  if (!fs.existsSync(sourcePath)) throw new Error(`Source path does not exist in ${normalized.repository}: ${source.path}`);
  const treeSpec = source.path === '.' ? 'HEAD^{tree}' : `HEAD:${source.path.replace(/^\.\//, '')}`;
  return {
    repository: normalized.repository,
    cloneDir,
    sourcePath,
    commit,
    treeSha: execGit(['rev-parse', treeSpec], cloneDir)
  };
}

function makeTempWorkDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pluginctl-'));
}

function resolveInside(root, relative, label) {
  if (!isSafeRelativePath(relative)) throw new Error(`${label} has unsafe path: ${relative}`);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(root, relative);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`${label} escapes plugin directory: ${relative}`);
  }
  return resolved;
}

function validateManifestPaths(pluginDir, manifest, label) {
  const errors = [];
  for (const key of ['skills', 'hooks', 'apps']) {
    if (typeof manifest[key] !== 'string') continue;
    try {
      const target = resolveInside(pluginDir, manifest[key], `${label}.${key}`);
      if (!fs.existsSync(target)) errors.push(`${label}.${key} does not exist: ${manifest[key]}`);
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (typeof manifest.mcpServers === 'string') {
    try {
      const target = resolveInside(pluginDir, manifest.mcpServers, `${label}.mcpServers`);
      if (!fs.existsSync(target)) errors.push(`${label}.mcpServers does not exist: ${manifest.mcpServers}`);
    } catch (error) {
      errors.push(error.message);
    }
  }
  return errors;
}

function validatePlugin(pluginDir, expectedName, platforms) {
  const errors = [];
  const manifests = {};
  const specs = {
    codex: path.join(pluginDir, '.codex-plugin', 'plugin.json'),
    claude: path.join(pluginDir, '.claude-plugin', 'plugin.json')
  };
  for (const platform of platforms) {
    const file = specs[platform];
    if (!fs.existsSync(file)) {
      errors.push(`missing ${platform} manifest: ${path.relative(pluginDir, file)}`);
      continue;
    }
    try {
      const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
      manifests[platform] = manifest;
      if (manifest.name !== expectedName) errors.push(`${platform} manifest name must be ${expectedName}`);
      if (!manifest.version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(manifest.version)) {
        errors.push(`${platform} manifest has invalid semver version`);
      }
      if (!manifest.description) errors.push(`${platform} manifest is missing description`);
      errors.push(...validateManifestPaths(pluginDir, manifest, `${platform} manifest`));
    } catch (error) {
      errors.push(`invalid ${platform} manifest JSON: ${error.message}`);
    }
  }
  if (manifests.codex && manifests.claude && manifests.codex.version !== manifests.claude.version) {
    errors.push('claude and codex manifest versions differ');
  }
  return { errors, manifests };
}

function readTextFiles(root) {
  const result = [];
  for (const file of listFiles(root)) {
    const stat = fs.statSync(file);
    if (stat.size > 2 * 1024 * 1024 || !TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
    result.push({ file, text: fs.readFileSync(file, 'utf8') });
  }
  return result;
}

function scanPluginRisk(pluginDir) {
  const flags = new Set();
  const files = listFiles(pluginDir);
  if (files.some((file) => /(^|[\\/])hooks([\\/]|$)/i.test(file))) flags.add('contains lifecycle hooks');
  if (files.some((file) => /(^|[\\/])(scripts|bin)([\\/]|$)/i.test(file))) flags.add('contains executable helper scripts');
  if (files.some((file) => /(^|[\\/])\.mcp\.json$/i.test(file) || /(^|[\\/])[^\\/]*mcp[^\\/]*([\\/]|$)/i.test(file))) flags.add('contains MCP components');
  const text = readTextFiles(pluginDir).map((item) => item.text).join('\n');
  if (/\"mcpServers\"\s*:/.test(text)) flags.add('contains MCP components');
  if (/\b(curl|wget)\b/.test(text)) flags.add('contains network command');
  if (/\b(npm install|npm i\b|pnpm add|yarn add|pip install)\b/.test(text)) flags.add('contains package install command');
  if (/\bsudo\b/.test(text)) flags.add('contains sudo command');
  if (/\brm\s+-rf\b|Remove-Item\b[^\n]*-Recurse/i.test(text)) flags.add('contains destructive delete command');
  if (/(~[\\/]\.ssh|~[\\/]\.aws|\.env\b|API[_ ]?key|access[_ -]?token|private[_ -]?key|secret)/i.test(text)) {
    flags.add('mentions secret-bearing paths or values');
  }
  return { highRisk: flags.size > 0, flags: Array.from(flags).sort() };
}

function loadOverlay(repoRoot, pluginName) {
  const file = path.join(repoRoot, 'overlays', pluginName, 'overlay.yaml');
  return fs.existsSync(file) ? loadYamlFile(file, null) : null;
}

function applyOverlay(pluginDir, overlay) {
  if (!overlay) return [];
  const changed = [];
  for (const [index, item] of (overlay.replace || []).entries()) {
    if (typeof item.from !== 'string' || typeof item.to !== 'string') throw new Error(`overlay replace[${index}] requires from/to strings`);
    const relative = item.file || 'README.md';
    const file = resolveInside(pluginDir, relative, `overlay replace[${index}]`);
    if (!fs.existsSync(file)) throw new Error(`overlay target file does not exist: ${relative}`);
    const original = fs.readFileSync(file, 'utf8');
    if (!original.includes(item.from)) throw new Error(`overlay text not found in ${relative}`);
    fs.writeFileSync(file, original.split(item.from).join(item.to));
    changed.push(relative);
  }
  return changed;
}

function pluginMetadata(pluginDir, platforms) {
  for (const platform of ['codex', 'claude']) {
    if (!platforms.includes(platform)) continue;
    const file = path.join(pluginDir, `.${platform}-plugin`, 'plugin.json');
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  return {};
}

function buildMarketplaces(repoRoot, sources, lock) {
  const marketplace = sources.marketplace;
  const entries = Object.entries(sources.plugins || {}).sort(([a], [b]) => a.localeCompare(b));
  const codexPlugins = [];
  const claudePlugins = [];
  for (const [name, source] of entries) {
    const pluginDir = path.join(repoRoot, source.target);
    if (!fs.existsSync(pluginDir)) continue;
    const metadata = pluginMetadata(pluginDir, source.platforms || []);
    if ((source.platforms || []).includes('codex')) {
      codexPlugins.push({
        name,
        source: { source: 'local', path: `./${source.target.split(path.sep).join('/')}` },
        policy: {
          installation: source.policy && source.policy.installation ? source.policy.installation : 'AVAILABLE',
          authentication: source.policy && source.policy.authentication ? source.policy.authentication : 'ON_INSTALL'
        },
        category: source.category || 'Other'
      });
    }
    if ((source.platforms || []).includes('claude')) {
      const entry = {
        name,
        source: `./${source.target.split(path.sep).join('/')}`,
        description: metadata.description || name,
        category: (source.category || 'other').toLowerCase()
      };
      if (metadata.version) entry.version = metadata.version;
      if (metadata.author) entry.author = metadata.author;
      if (metadata.homepage) entry.homepage = metadata.homepage;
      if (metadata.repository) entry.repository = metadata.repository;
      if (metadata.license) entry.license = metadata.license;
      claudePlugins.push(entry);
    }
  }
  const codex = {
    name: marketplace.name,
    interface: { displayName: marketplace.displayName || marketplace.name },
    plugins: codexPlugins
  };
  const claude = {
    $schema: 'https://anthropic.com/claude-code/marketplace.schema.json',
    name: marketplace.name,
    description: marketplace.description || `${marketplace.name} plugin marketplace`,
    owner: marketplace.owner,
    plugins: claudePlugins
  };
  return {
    codex,
    claude,
    codexCount: codexPlugins.length,
    claudeCount: claudePlugins.length,
    lockedCount: Object.keys(lock.plugins || {}).length
  };
}

function generateMarketplaces(repoRoot, sources, lock) {
  const built = buildMarketplaces(repoRoot, sources, lock);
  writeJsonFile(path.join(repoRoot, '.agents', 'plugins', 'marketplace.json'), built.codex);
  writeJsonFile(path.join(repoRoot, '.claude-plugin', 'marketplace.json'), built.claude);
  return built;
}

function validateMarketplaces(repoRoot, sources, lock) {
  const built = buildMarketplaces(repoRoot, sources, lock);
  const errors = [];
  for (const [label, relative, expected] of [
    ['Codex', path.join('.agents', 'plugins', 'marketplace.json'), built.codex],
    ['Claude', path.join('.claude-plugin', 'marketplace.json'), built.claude]
  ]) {
    const file = path.join(repoRoot, relative);
    if (!fs.existsSync(file)) {
      errors.push(`${label} marketplace is missing: ${relative}`);
      continue;
    }
    try {
      const actual = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (JSON.stringify(actual) !== JSON.stringify(expected)) errors.push(`${label} marketplace is stale: ${relative}`);
    } catch (error) {
      errors.push(`${label} marketplace is invalid JSON: ${error.message}`);
    }
  }
  return { ...built, errors };
}

function parseGitStatusPorcelain(output) {
  if (!output) return [];
  return output.split('\n').map((line) => {
    if (!line.trim()) return null;
    if (/^.. /.test(line)) return line.slice(3).trim();
    return line.replace(/^\S+\s+/, '').trim();
  }).filter(Boolean);
}

module.exports = {
  applyOverlay,
  buildMarketplaces,
  cloneGithubSource,
  copyDir,
  ensureDir,
  execGit,
  generateMarketplaces,
  hashDirectory,
  listFiles,
  loadJsonFile,
  loadOverlay,
  loadYamlFile,
  makeTempWorkDir,
  normalizeGithubRepository,
  parseGitStatusPorcelain,
  pluginMetadata,
  removeDir,
  resolveGithubHead,
  scanPluginRisk,
  selectLsRemoteRef,
  validatePlugin,
  validateMarketplaces,
  validateSources,
  writeJsonFile,
  writeYamlFile
};
