/**
 * What a shell command is *for*, read the way Claude Code and Codex present it: `rg -n useState src`
 * becomes "Searched for useState in src", `npm test` becomes "Ran tests". Purely cosmetic and never
 * executed — the parser only splits words, so a command it does not recognise still renders, as
 * "Ran <command>". The expanded step always shows the command itself, so a summary can never hide it.
 */
export type CommandKind = 'read' | 'search' | 'list' | 'edit' | 'command';

/** One named part of a multi-command script, e.g. "Created directory" + "features/hello". */
export interface CommandStep {
  active: string;
  done: string;
  detail: string | null;
}

export interface CommandDescription {
  kind: CommandKind;
  /** Verb phrase while the command runs, e.g. "Searching for". */
  active: string;
  /** Verb phrase once it finished, e.g. "Searched for". */
  done: string;
  /** The subject, rendered in mono next to the verb: a file, a pattern, the short command. */
  detail: string | null;
  /** The file a shell write targets, so a summary counts it as an edited file. */
  target: string | null;
  /** The named parts when the line chains several commands; empty for a single one. */
  steps: CommandStep[];
  /** The command the user should read when expanding: a `bash -lc '…'` wrapper is peeled off. */
  display: string;
}

/** `raw`: the detail is just the command line, which a one-line chain need not repeat. */
type Described = Omit<CommandDescription, 'display' | 'steps'> & { raw?: boolean };

type Words = string[];

const DETAIL_LIMIT = 80;

const clip = (text: string, limit = DETAIL_LIMIT): string =>
  text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;

const basename = (path: string): string => path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || path;

/** One simple command of a command line, with the files its output redirections write. */
export interface SimpleCommand {
  words: Words;
  writes: string[];
  /** Fed by a pipe (`… | tail -5`): it shapes the previous command's output. */
  piped: boolean;
}

/** Splits a command line into simple commands (on `&&`, `||`, `;`, `|`, `&`, newlines), honouring
 * quotes, keeping output redirection targets and skipping heredoc bodies — a body is data, never
 * more commands. Good enough to name a command, never to run one. */
export const splitCommands = (command: string): SimpleCommand[] => {
  const commands: SimpleCommand[] = [];
  let words: Words = [];
  let writes: string[] = [];
  let word = '';
  let started = false;
  let quote = '';
  // What the next word is: a plain word, the target of `>` (a write) or of `<` (ignored).
  let next: 'word' | 'write' | 'drop' = 'word';
  let piped = false;
  const heredocs: string[] = [];

  const endWord = () => {
    if (started) {
      if (next === 'write' && !word.startsWith('/dev/')) writes.push(word);
      else if (next === 'word') words.push(word);
      next = 'word';
    }
    word = '';
    started = false;
  };
  const endCommand = (pipe = false) => {
    endWord();
    if (words.length || writes.length) commands.push({ words, writes, piped });
    words = [];
    writes = [];
    piped = pipe;
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (quote) {
      if (character === quote) quote = '';
      else if (character === '\\' && quote === '"' && index + 1 < command.length) word += command[++index];
      else word += character;
    } else if (character === '"' || character === "'") {
      quote = character;
      started = true;
    } else if (character === '\\' && index + 1 < command.length) {
      if (command[index + 1] !== '\n') {
        word += command[index + 1];
        started = true;
      }
      index += 1;
    } else if (character === '\n' && heredocs.length) {
      endCommand();
      // Skip each pending heredoc body, up to and including its delimiter line.
      for (const delimiter of heredocs.splice(0)) {
        let lineEnd = command.indexOf('\n', index + 1);
        while (lineEnd !== -1 && command.slice(index + 1, lineEnd).trim() !== delimiter) {
          index = lineEnd;
          lineEnd = command.indexOf('\n', index + 1);
        }
        index = lineEnd === -1 ? command.length : lineEnd;
      }
    } else if (/[;&|\n]/.test(character)) {
      // `2>&1` is a redirection, not a background `&`.
      if (character === '&' && command[index - 1] === '>') continue;
      const pipe = character === '|' && command[index + 1] !== '|' && command[index - 1] !== '|';
      if (character === '|' && command[index + 1] === '|') index += 1;
      endCommand(pipe);
    } else if (character === '>' || character === '<') {
      // A file-descriptor prefix such as `2>` belongs to the redirection.
      if (/^\d+$/.test(word)) {
        word = '';
        started = false;
      } else endWord();
      if (character === '<' && command[index + 1] === '<' && command[index + 2] !== '<') {
        index += 1;
        if (command[index + 1] === '-') index += 1;
        while (command[index + 1] === ' ' || command[index + 1] === '\t') index += 1;
        const delimiter = /^(['"]?)([^\s'";&|<>()]+)\1/.exec(command.slice(index + 1));
        if (delimiter) {
          heredocs.push(delimiter[2]);
          index += delimiter[0].length;
        }
        continue;
      }
      while (command[index + 1] === character || command[index + 1] === '&' || command[index + 1] === '|') index += 1;
      // `>&1` names a descriptor; otherwise the next word is the target file (or, for `<`, the input).
      if (command[index] === '&' && /\d/.test(command[index + 1] ?? '')) index += 1;
      else next = character === '>' ? 'write' : 'drop';
    } else if (/\s/.test(character)) {
      endWord();
    } else {
      word += character;
      started = true;
    }
  }
  endCommand();
  return commands;
};

const isFlag = (word: string) => word.startsWith('-') && word !== '-';

/** Arguments that are not flags, skipping the values of flags known to take one. */
const operands = (args: Words, valued: Set<string> = new Set()): Words => {
  const result: Words = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') {
      result.push(...args.slice(index + 1));
      break;
    }
    if (isFlag(arg)) {
      if (valued.has(arg)) index += 1;
      continue;
    }
    result.push(arg);
  }
  return result;
};

const flagValue = (args: Words, ...names: string[]): string | null => {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (names.includes(arg) && args[index + 1] !== undefined) return args[index + 1];
    const inline = names.find((name) => name.startsWith('--') && arg.startsWith(`${name}=`));
    if (inline) return arg.slice(inline.length + 1);
  }
  return null;
};

const described = (kind: CommandKind, active: string, done: string, detail: string | null, target: string | null = null): Described =>
  ({ kind, active, done, detail: detail ? clip(detail) : null, target });

const ran = (active: string, done: string, words: Words): Described =>
  ({ ...described('command', active, done, words.join(' ')), raw: true });

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'fish']);
const PREFIXES = new Set(['sudo', 'time', 'nohup', 'exec', 'command', 'builtin', 'env', 'timeout', 'xargs']);
const NOISE = new Set(['cd', 'pushd', 'popd', 'export', 'set', 'source', '.', 'true', 'unset', 'ulimit']);
const READERS = new Set(['cat', 'head', 'tail', 'less', 'more', 'bat', 'nl', 'wc', 'sed', 'awk', 'jq', 'stat', 'file', 'xxd', 'od']);
const SEARCHERS = new Set(['rg', 'grep', 'egrep', 'fgrep', 'ag', 'ack']);
const SEARCH_VALUED = new Set(['-g', '--glob', '-t', '--type', '-T', '-A', '-B', '-C', '-m', '--max-count', '--include',
  '--exclude', '--exclude-dir', '-f', '--file', '-d', '--max-depth', '--context', '--before-context', '--after-context']);
const TEST_RUNNERS = new Set(['pytest', 'vitest', 'jest', 'mocha', 'playwright', 'phpunit', 'rspec', 'ava']);
const LINTERS = new Set(['eslint', 'ruff', 'biome', 'mypy', 'pyright', 'flake8', 'pylint', 'stylelint', 'golangci-lint', 'shellcheck']);
const FORMATTERS = new Set(['prettier', 'black', 'isort', 'gofmt', 'rustfmt', 'dprint']);

/** Drops `FOO=bar` assignments and wrappers such as `sudo`, which never say what a command does. */
const strip = (words: Words): Words => {
  let index = 0;
  while (index < words.length) {
    const word = words[index];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) index += 1;
    else if (PREFIXES.has(basename(word))) {
      index += 1;
      while (index < words.length && isFlag(words[index])) index += 1;
      if (basename(word) === 'timeout' && /^\d/.test(words[index] ?? '')) index += 1;
    } else break;
  }
  return words.slice(index);
};

const describeRead = (name: string, args: Words) => {
  const valued = new Set(['-n', '-c', '--lines', '--bytes', '-e', '-f']);
  if (name === 'sed' || name === 'awk' || name === 'jq') {
    // The first operand is the script; the files follow it.
    const rest = operands(args, valued);
    const script = name === 'sed' ? (flagValue(args, '-n', '-e') ?? rest[0] ?? '') : rest[0] ?? '';
    const files = (name === 'sed' && flagValue(args, '-n', '-e') !== null ? rest : rest.slice(1));
    if (name === 'sed' && /\bs\//.test(script) && args.some((arg) => /^-i/.test(arg))) return null;
    if (!files.length) return null;
    const range = name === 'sed' ? /^(\d+)(?:,(\d+|\$))?p$/.exec(script) : null;
    const lines = range ? ` · lines ${range[1]}${range[2] ? `–${range[2]}` : ''}` : '';
    return described('read', 'Reading', 'Read', `${files.map(basename).join(', ')}${lines}`);
  }
  const files = operands(args, valued);
  if (!files.length) return null;
  if (name === 'wc') return described('read', 'Counting', 'Counted', files.map(basename).join(', '));
  const count = /^-?\d+$/.test(flagValue(args, '-n') ?? '') ? Math.abs(Number(flagValue(args, '-n'))) : null;
  const scope = count !== null && (name === 'head' || name === 'tail') ? ` · ${name === 'head' ? 'first' : 'last'} ${count} lines` : '';
  return described('read', 'Reading', 'Read', `${files.map(basename).join(', ')}${scope}`);
};

const describeSearch = (args: Words) => {
  if (args.includes('--files')) {
    const roots = operands(args, SEARCH_VALUED);
    return described('list', 'Listing files in', 'Listed files in', roots.join(', ') || '.');
  }
  const explicit = flagValue(args, '-e', '--regexp');
  const rest = operands(args, new Set([...SEARCH_VALUED, '-e', '--regexp']));
  const pattern = explicit ?? rest.shift();
  if (!pattern) return null;
  const where = rest.length ? ` in ${rest.join(', ')}` : '';
  return described('search', 'Searching for', 'Searched for', `${pattern}${where}`);
};

const describeFind = (name: string, args: Words) => {
  if (name === 'fd' || name === 'fdfind') {
    const rest = operands(args, new Set(['-e', '--extension', '-t', '--type', '-d', '--max-depth', '-E', '--exclude']));
    const extension = flagValue(args, '-e', '--extension');
    const pattern = rest[0] ?? (extension ? `*.${extension}` : null);
    const where = rest[1] ? ` in ${rest[1]}` : '';
    return pattern ? described('search', 'Finding files', 'Found files', `${pattern}${where}`)
      : described('list', 'Listing files in', 'Listed files in', rest[1] ?? '.');
  }
  const root = args.find((arg) => !isFlag(arg)) ?? '.';
  const pattern = flagValue(args, '-name', '-iname', '-path', '-ipath', '-regex');
  return pattern ? described('search', 'Finding files', 'Found files', `${pattern} in ${root}`)
    : described('list', 'Listing files in', 'Listed files in', root);
};

const GIT_VERBS: Record<string, [string, string]> = {
  status: ['Checking git status', 'Checked git status'],
  diff: ['Reviewing changes', 'Reviewed changes'],
  log: ['Reading git history', 'Read git history'],
  show: ['Inspecting commit', 'Inspected commit'],
  blame: ['Reading blame', 'Read blame'],
  branch: ['Checking branches', 'Checked branches'],
  add: ['Staging changes', 'Staged changes'],
  commit: ['Committing', 'Committed'],
  push: ['Pushing', 'Pushed'],
  pull: ['Pulling', 'Pulled'],
  fetch: ['Fetching', 'Fetched'],
  checkout: ['Switching branch', 'Switched branch'],
  switch: ['Switching branch', 'Switched branch'],
  merge: ['Merging', 'Merged'],
  rebase: ['Rebasing', 'Rebased'],
  stash: ['Stashing changes', 'Stashed changes'],
  restore: ['Restoring files', 'Restored files'],
  reset: ['Resetting', 'Reset'],
  clone: ['Cloning', 'Cloned'],
};

const describeGit = (words: Words) => {
  let index = 1;
  // `git -C dir status`: global options come before the subcommand.
  while (index < words.length && isFlag(words[index])) index += ['-C', '-c', '--git-dir', '--work-tree'].includes(words[index]) ? 2 : 1;
  const sub = words[index];
  const args = words.slice(index + 1);
  if (sub === 'grep') return describeSearch(args);
  if (sub === 'ls-files') return described('list', 'Listing tracked files', 'Listed tracked files', operands(args).join(', ') || null);
  const verb = sub ? GIT_VERBS[sub] : undefined;
  if (!verb) return null;
  return ran(verb[0], verb[1], ['git', ...words.slice(index)]);
};

/** `npm run test:unit`, `pnpm build`, `yarn add zod`, `bun x tsc`: a script name says what it is for. */
const describeScript = (script: string, words: Words) => {
  if (/^test|:test|^e2e|spec/.test(script)) return ran('Running tests', 'Ran tests', words);
  if (/^build|:build/.test(script)) return ran('Building', 'Built', words);
  if (/^type-?check|^tsc|:types/.test(script)) return ran('Type-checking', 'Type-checked', words);
  if (/^lint|:lint/.test(script)) return ran('Linting', 'Linted', words);
  if (/^format|^fmt|prettier/.test(script)) return ran('Formatting', 'Formatted', words);
  if (/^dev|^start|^serve|^preview/.test(script)) return ran('Starting dev server', 'Started dev server', words);
  return ran('Running script', 'Ran script', words);
};

const describePackageManager = (name: string, words: Words) => {
  const args = words.slice(1);
  const sub = args.find((arg) => !isFlag(arg));
  if (!sub) return null;
  const rest = args.slice(args.indexOf(sub) + 1);
  if (['install', 'i', 'ci', 'add', 'sync', 'update', 'upgrade', 'remove', 'uninstall'].includes(sub)
    || (sub === 'pip' && rest[0] === 'install')) {
    const removing = sub === 'remove' || sub === 'uninstall';
    return ran(removing ? 'Removing dependencies' : 'Installing dependencies', removing ? 'Removed dependencies' : 'Installed dependencies', words);
  }
  if (sub === 'run' || sub === 'run-script') {
    // `uv run pytest` / `poetry run mypy`: the wrapped tool is what matters.
    if (name === 'uv' || name === 'poetry' || name === 'pipenv') return describeWords(rest) ?? null;
    return rest[0] ? describeScript(rest[0], words) : null;
  }
  if (sub === 'exec' || sub === 'x' || sub === 'dlx') return describeWords(rest) ?? null;
  if (sub === 'test' || sub === 't') return ran('Running tests', 'Ran tests', words);
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(name)) return describeScript(sub, words);
  return null;
};

const RTK_WRAPPERS = new Set(['proxy', 'bypass', 'err', 'test', 'summary']);

/** `rtk git status`, `rtk read a.ts`, `rtk proxy make`: RTK only compresses the output of the command
 * it wraps, so the wrapped command says what it is for. */
const describeRtk = (args: Words): Described | null => {
  const [sub, ...rest] = args;
  if (sub === 'read') {
    const files = operands(rest, new Set(['-l', '--level', '-m', '--max-lines', '--head-lines', '--tail-lines']));
    return files.length ? described('read', 'Reading', 'Read', files.map(basename).join(', ')) : null;
  }
  return describeWords(sub && RTK_WRAPPERS.has(sub) ? rest : args);
};

/** Describes one simple command, or null when it carries no recognisable intent. */
const describeWords = (input: Words): Described | null => {
  const words = strip(input);
  if (!words.length) return null;
  const name = basename(words[0]);
  const args = words.slice(1);

  if (SHELLS.has(name)) {
    const script = flagValue(args, '-c', '-lc', '-ic', '-lic');
    return script ? describeLine(script) : null;
  }
  if (name === 'rtk') return describeRtk(args);
  if (READERS.has(name)) return describeRead(name, args);
  if (SEARCHERS.has(name)) return describeSearch(args);
  if (name === 'find' || name === 'fd' || name === 'fdfind') return describeFind(name, args);
  if (name === 'ls' || name === 'tree' || name === 'eza' || name === 'exa') {
    return described('list', 'Listing', 'Listed', operands(args, new Set(['-L', '-I', '--level'])).join(', ') || '.');
  }
  if (name === 'pwd') return described('list', 'Checking working directory', 'Checked working directory', null);
  if (name === 'git') return describeGit(words);
  if (name === 'gh') return ran('Querying GitHub', 'Queried GitHub', words);
  if (['npm', 'pnpm', 'yarn', 'bun', 'uv', 'pip', 'pip3', 'poetry', 'pipenv', 'cargo', 'go', 'composer', 'bundle'].includes(name)) {
    const sub = args.find((arg) => !isFlag(arg));
    if ((name === 'cargo' || name === 'go') && sub) {
      if (sub === 'test') return ran('Running tests', 'Ran tests', words);
      if (sub === 'build' || sub === 'check' || sub === 'vet') return ran('Building', 'Built', words);
      if (sub === 'run') return ran('Running program', 'Ran program', words);
      if (sub === 'fmt') return ran('Formatting', 'Formatted', words);
      if (sub === 'clippy') return ran('Linting', 'Linted', words);
    }
    if ((name === 'pip' || name === 'pip3') && sub === 'install') return ran('Installing dependencies', 'Installed dependencies', words);
    return describePackageManager(name, words);
  }
  if (name === 'npx' || name === 'pnpx' || name === 'bunx') return describeWords(args.filter((arg) => !isFlag(arg)));
  if (TEST_RUNNERS.has(name)) return ran('Running tests', 'Ran tests', words);
  if (name === 'tsc' || name === 'vue-tsc') return ran('Type-checking', 'Type-checked', words);
  if (LINTERS.has(name)) {
    if (name === 'ruff' && args[0] === 'format') return ran('Formatting', 'Formatted', words);
    return ran('Linting', 'Linted', words);
  }
  if (FORMATTERS.has(name)) return ran('Formatting', 'Formatted', words);
  if (name === 'vite' || name === 'webpack' || name === 'next' || name === 'esbuild') {
    return args[0] === 'build' ? ran('Building', 'Built', words) : ran('Starting dev server', 'Started dev server', words);
  }
  if (name === 'make' || name === 'just') {
    const target = args.find((arg) => !isFlag(arg) && !arg.includes('='));
    return target ? describeScript(target, words) : ran('Running make', 'Ran make', words);
  }
  if (name === 'python' || name === 'python3' || name === 'node' || name === 'deno' || name === 'ruby' || name === 'php') {
    if (args[0] === '-m' && args[1]) return describeWords(args.slice(1)) ?? ran('Running module', 'Ran module', words);
    if (args.includes('-c') || args.includes('-e') || args.includes('-')) return described('command', 'Running inline script', 'Ran inline script', name);
    const script = args.find((arg) => !isFlag(arg));
    return script ? described('command', 'Running script', 'Ran script', basename(script)) : null;
  }
  if (name === 'curl' || name === 'wget' || name === 'http') {
    const url = args.find((arg) => /^https?:\/\//.test(arg)) ?? operands(args, new Set(['-X', '-H', '-d', '-o', '--data', '--header', '-u'])).pop();
    return described('command', 'Requesting', 'Requested', url ?? null);
  }
  if (name === 'docker' || name === 'docker-compose' || name === 'podman') return ran('Running docker', 'Ran docker', words);
  if (name === 'mkdir') return described('command', 'Creating directory', 'Created directory', operands(args).join(', ') || null);
  if (name === 'touch') return described('command', 'Creating file', 'Created file', operands(args).map(basename).join(', ') || null);
  if (name === 'rm' || name === 'rmdir') return described('command', 'Removing', 'Removed', operands(args).join(', ') || null);
  if (name === 'mv') return described('command', 'Moving', 'Moved', operands(args).join(' → ') || null);
  if (name === 'cp') return described('command', 'Copying', 'Copied', operands(args).join(' → ') || null);
  if (name === 'chmod' || name === 'chown') return ran('Changing permissions', 'Changed permissions', words);
  if (name === 'kill' || name === 'pkill' || name === 'killall') return ran('Stopping process', 'Stopped process', words);
  if (name === 'sleep') return described('command', 'Waiting', 'Waited', args[0] ? `${args[0]}s` : null);
  return null;
};

const WRITERS = new Set(['cat', 'echo', 'printf']);

/** Output sent into a file (`cat > a.tsx <<EOF`, `echo x >> .gitignore`, `… | tee log`) is a write. */
const describeSimple = ({ words: input, writes }: SimpleCommand): Described | null => {
  const words = strip(input);
  const name = words[0] ? basename(words[0]) : '';
  const files = name === 'tee' ? operands(words.slice(1)) : writes;
  if (files.length && (!words.length || WRITERS.has(name) || name === 'tee')) {
    return described('edit', 'Writing', 'Wrote', files.map(basename).join(', '), files[0]);
  }
  if (!words.length) return null;
  return describeWords(words) ?? ran('Running', 'Ran', words);
};

/** A line that chains several commands reads as the chain of what each one does; `cd x && npm test`
 * is still just about the tests, and `… | tail -5` only trims the output. */
const describeLine = (line: string): Omit<CommandDescription, 'display'> | null => {
  const commands = splitCommands(line).filter((command) => !command.piped || command.writes.length
    || basename(strip(command.words)[0] ?? '') === 'tee');
  const meaningful = commands.filter((command) => !NOISE.has(basename(strip(command.words)[0] ?? '')) || command.writes.length);
  const parts = (meaningful.length ? meaningful : commands.slice(0, 1)).map(describeSimple).filter((part): part is Described => part !== null);
  if (parts.length <= 1) return parts[0] ? { kind: parts[0].kind, active: parts[0].active, done: parts[0].done,
    detail: parts[0].detail, target: parts[0].target, steps: [] } : null;
  const steps = parts.map(({ active, done, detail }) => ({ active, done, detail }));
  return {
    kind: 'command',
    active: `Running ${parts.length} commands`,
    done: `Ran ${parts.length} commands`,
    detail: parts.map((part) => part.detail && !part.raw ? `${part.done} ${part.detail}` : part.done).join(' · '),
    target: null,
    steps,
  };
};

/** Peels `bash -lc "…"` (how Codex reports every command) so the user reads what actually ran. */
const unwrapShell = (command: string): string => {
  const commands = splitCommands(command);
  const words = commands[0]?.words;
  if (words?.length && commands.length === 1 && SHELLS.has(basename(words[0]))) {
    const script = flagValue(words.slice(1), '-c', '-lc', '-ic', '-lic');
    if (script) return unwrapShell(script);
  }
  return command.trim();
};

export const describeCommand = (command: unknown): CommandDescription => {
  const text = typeof command === 'string' ? command : Array.isArray(command)
    ? command.map((word) => /[\s'"]/.test(String(word)) ? `'${String(word).replace(/'/g, "'\\''")}'` : String(word)).join(' ') : '';
  const display = unwrapShell(text);
  const description = display ? describeLine(display) : null;
  return { ...(description ?? { ...described('command', 'Running command', 'Ran command', null), steps: [] }), display };
};
