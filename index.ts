#!/usr/bin/env bun
// input: CLI args, Claude Code binary, ~/.claude.json
// output: patched binary with customized buddy pet
// pos: standalone CLI tool for Claude Code buddy pet customization

import { readFileSync, writeFileSync, existsSync, realpathSync, accessSync, constants as FS } from "fs";
import { execSync } from "child_process";
import { homedir } from "os";
import { resolve, basename } from "path";

// ─── Constants ───────────────────────────────────────────

const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"] as const;
type Rarity = (typeof RARITIES)[number];

const SPECIES = [
  "duck", "goose", "blob", "cat", "dragon", "octopus", "owl", "penguin",
  "turtle", "snail", "ghost", "axolotl", "capybara", "cactus", "robot",
  "rabbit", "mushroom", "chonk",
] as const;
type Species = (typeof SPECIES)[number];

const EYES = ["\u00b7", "\u2726", "\u00d7", "\u25c9", "@", "\u00b0"] as const;
const HATS = ["none", "crown", "tophat", "propeller", "halo", "wizard", "beanie", "tinyduck"] as const;
const STAT_NAMES = ["DEBUGGING", "PATIENCE", "CHAOS", "WISDOM", "SNARK"] as const;

const RARITY_WEIGHTS: Record<Rarity, number> = { common: 60, uncommon: 25, rare: 10, epic: 4, legendary: 1 };
const RARITY_FLOOR: Record<Rarity, number> = { common: 5, uncommon: 15, rare: 25, epic: 35, legendary: 50 };
const RARITY_STARS: Record<Rarity, string> = {
  common: "\u2605", uncommon: "\u2605\u2605", rare: "\u2605\u2605\u2605",
  epic: "\u2605\u2605\u2605\u2605", legendary: "\u2605\u2605\u2605\u2605\u2605",
};

const SALT_PATTERN = /^friend-\d{4}-\w+$/;
const CLAUDE_CONFIG = resolve(homedir(), ".claude.json");
const STATE_PATH = resolve(homedir(), ".claude", "buddy-state.json");
const CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

type Pet = {
  salt: string; rarity: Rarity; species: string;
  eye: string; hat: string; shiny: boolean;
  stats: Record<string, number>; total: number;
};

// ─── Sprites (frame 0 only, 12 chars wide, {E} = eye) ───

const SPRITE: Record<string, string[]> = {
  duck:     ['            ', '    __      ', '  <({E} )___  ', '   (  ._>   ', '    `--\u00b4    '],
  goose:    ['            ', '     ({E}>    ', '     ||     ', '   _(__)_   ', '    ^^^^    '],
  blob:     ['            ', '   .----.   ', '  ( {E}  {E} )  ', '  (      )  ', '   `----\u00b4   '],
  cat:      ['            ', '   /\\_/\\    ', '  ( {E}   {E})  ', '  (  \u03c9  )   ', '  (")_(")   '],
  dragon:   ['            ', '  /^\\  /^\\  ', ' <  {E}  {E}  > ', ' (   ~~   ) ', '  `-vvvv-\u00b4  '],
  octopus:  ['            ', '   .----.   ', '  ( {E}  {E} )  ', '  (______)  ', '  /\\/\\/\\/\\  '],
  owl:      ['            ', '   /\\  /\\   ', '  (({E})({E}))  ', '  (  ><  )  ', '   `----\u00b4   '],
  penguin:  ['            ', '  .---.     ', '  ({E}>{E})     ', ' /(   )\\    ', '  `---\u00b4     '],
  turtle:   ['            ', '   _,--._   ', '  ( {E}  {E} )  ', ' /[______]\\ ', '  ``    ``  '],
  snail:    ['            ', ' {E}    .--.  ', '  \\  ( @ )  ', '   \\_`--\u00b4   ', '  ~~~~~~~   '],
  ghost:    ['            ', '   .----.   ', '  / {E}  {E} \\  ', '  |      |  ', '  ~`~``~`~  '],
  axolotl:  ['            ', '}~(______)~{', '}~({E} .. {E})~{', '  ( .--. )  ', '  (_/  \\_)  '],
  capybara: ['            ', '  n______n  ', ' ( {E}    {E} ) ', ' (   oo   ) ', '  `------\u00b4  '],
  cactus:   ['            ', ' n  ____  n ', ' | |{E}  {E}| | ', ' |_|    |_| ', '   |    |   '],
  robot:    ['            ', '   .[||].   ', '  [ {E}  {E} ]  ', '  [ ==== ]  ', '  `------\u00b4  '],
  rabbit:   ['            ', '   (\\__/)   ', '  ( {E}  {E} )  ', ' =(  ..  )= ', '  (")__(")  '],
  mushroom: ['            ', ' .-o-OO-o-. ', '(__________)', '   |{E}  {E}|   ', '   |____|   '],
  chonk:    ['            ', '  /\\    /\\  ', ' ( {E}    {E} ) ', ' (   ..   ) ', '  `------\u00b4  '],
};

const HAT_LINE: Record<string, string> = {
  none: '', crown: '   \\^^^/    ', tophat: '   [___]    ', propeller: '    -+-     ',
  halo: '   (   )    ', wizard: '    /^\\     ', beanie: '   (___)    ', tinyduck: '    ,>      ',
};

function renderSprite(species: string, eye: string, hat: string): string[] {
  const body = (SPRITE[species] ?? SPRITE.blob!).map(l => l.replaceAll('{E}', eye));
  const lines = [...body];
  if (hat !== 'none' && !lines[0]!.trim()) lines[0] = HAT_LINE[hat] ?? '';
  if (!lines[0]!.trim()) lines.shift();
  return lines;
}

// ─── PRNG & Roll ─────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  return Number(BigInt(Bun.hash(s)) & 0xffffffffn);
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

function rollRarity(rng: () => number): Rarity {
  let roll = rng() * 100;
  for (const r of RARITIES) { roll -= RARITY_WEIGHTS[r]; if (roll < 0) return r; }
  return "common";
}

function rollStats(rng: () => number, rarity: Rarity): Record<string, number> {
  const floor = RARITY_FLOOR[rarity];
  const peak = pick(rng, STAT_NAMES);
  let dump = pick(rng, STAT_NAMES);
  while (dump === peak) dump = pick(rng, STAT_NAMES);
  const stats: Record<string, number> = {};
  for (const name of STAT_NAMES) {
    if (name === peak) stats[name] = Math.min(100, floor + 50 + Math.floor(rng() * 30));
    else if (name === dump) stats[name] = Math.max(1, floor - 10 + Math.floor(rng() * 15));
    else stats[name] = floor + Math.floor(rng() * 40);
  }
  return stats;
}

function fullRoll(userId: string, salt: string): Pet {
  const seed = hashString(userId + salt);
  const rng = mulberry32(seed);
  const rarity = rollRarity(rng);
  const species = pick(rng, SPECIES);
  const eye = pick(rng, EYES);
  const hat = rarity === "common" ? "none" : pick(rng, HATS);
  const shiny = rng() < 0.01;
  const stats = rollStats(rng, rarity);
  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  return { salt, rarity, species, eye, hat, shiny, stats, total };
}

// ─── Catalog ─────────────────────────────────────────────

function buildCatalog(userId: string, saltLen: number): Pet[] {
  const suffixLen = saltLen - "friend-2026-".length;
  const results: Pet[] = [];
  const enumerate = (prefix: string, depth: number) => {
    if (depth === 0) { results.push(fullRoll(userId, prefix)); return; }
    for (const c of CHARS) enumerate(prefix + c, depth - 1);
  };
  enumerate("friend-2026-", suffixLen);
  return results;
}

// ─── Binary & Config ─────────────────────────────────────

function findBinaryPath(): string {
  // 1. Try `which claude` → resolve symlinks
  try {
    const w = execSync("which claude", { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    const p = realpathSync(w);
    if (existsSync(p)) {
      // Check if this is a real binary or a JS/shell wrapper
      const head = readFileSync(p, { encoding: null }).subarray(0, 4);
      const isMachO = head[0] === 0xcf && head[1] === 0xfa;
      const isELF = head[0] === 0x7f && head[1] === 0x45;
      if (isMachO || isELF) return p;

      // It's a text wrapper (npm install, shell script, etc.)
      // Try to find the real binary from known locations
      const real = findNativeBinary();
      if (real) return real;

      // Last resort: use the wrapper path (will fail at SALT scan with a helpful message)
      return p;
    }
  } catch {}

  // 2. Fallback to known install locations
  const real = findNativeBinary();
  if (real) return real;

  console.error(`\n  ${S.red}Cannot find Claude Code binary.${S.reset}`);
  console.error(`  ${S.dim}Ensure 'claude' is installed and in PATH.${S.reset}\n`);
  process.exit(1);
}

function findNativeBinary(): string | null {
  // Check ~/.local/share/claude/versions/<latest>
  const versionsDir = resolve(homedir(), ".local", "share", "claude", "versions");
  if (existsSync(versionsDir)) {
    try {
      const entries = execSync(`ls -1 "${versionsDir}"`, { encoding: "utf8" }).trim().split("\n").filter(Boolean);
      // Sort semver-ish descending, pick latest
      entries.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      for (const v of entries) {
        const p = resolve(versionsDir, v);
        if (existsSync(p)) {
          const head = readFileSync(p, { encoding: null }).subarray(0, 4);
          const isMachO = head[0] === 0xcf && head[1] === 0xfa;
          const isELF = head[0] === 0x7f && head[1] === 0x45;
          if (isMachO || isELF) return p;
        }
      }
    } catch {}
  }
  return null;
}

function getBinaryVersion(binPath: string): string | null {
  const match = binPath.match(/versions\/([^/]+)$/);
  return match?.[1] ?? null;
}

function getUserId(): string {
  try {
    if (!existsSync(CLAUDE_CONFIG)) return "anon";
    const c = JSON.parse(readFileSync(CLAUDE_CONFIG, "utf8"));
    return c.oauthAccount?.accountUuid ?? c.userID ?? "anon";
  } catch {
    return "anon";
  }
}

function readClaudeConfig(): Record<string, unknown> {
  try {
    if (!existsSync(CLAUDE_CONFIG)) return {};
    return JSON.parse(readFileSync(CLAUDE_CONFIG, "utf8"));
  } catch {
    return {};
  }
}

function clearCompanionSoul() {
  const cfg = readClaudeConfig();
  if (!cfg.companion) return;
  delete cfg.companion;
  writeFileSync(CLAUDE_CONFIG, JSON.stringify(cfg, null, 2) + "\n");
}

function findSaltInBinary(bin: Buffer): { salt: string; length: number } | null {
  const prefix = Buffer.from("friend-");
  let idx = 0;
  while (true) {
    idx = bin.indexOf(prefix, idx);
    if (idx === -1) break;
    let end = idx + prefix.length;
    while (end < bin.length) {
      const ch = bin[end]!;
      if ((ch >= 0x30 && ch <= 0x39) || (ch >= 0x41 && ch <= 0x5a) || (ch >= 0x61 && ch <= 0x7a) || ch === 0x2d) end++;
      else break;
    }
    const salt = bin.slice(idx, end).toString("utf8");
    if (SALT_PATTERN.test(salt)) return { salt, length: end - idx };
    idx = end;
  }
  return null;
}

function patchBinary(binPath: string, oldSalt: string, newSalt: string): number {
  try {
    accessSync(binPath, FS.W_OK);
  } catch {
    console.error(`\n  ${S.red}No write permission for binary.${S.reset}`);
    console.error(`  ${S.dim}Try: sudo chmod u+w "${binPath}"${S.reset}\n`);
    process.exit(1);
  }

  const buf = readFileSync(binPath);
  const oldB = Buffer.from(oldSalt), newB = Buffer.from(newSalt);
  let n = 0, idx = 0;
  while ((idx = buf.indexOf(oldB, idx)) !== -1) { newB.copy(buf, idx); idx += newB.length; n++; }
  if (n === 0) throw new Error(`"${oldSalt}" not found in binary.`);
  writeFileSync(binPath, buf);
  try { execSync(`codesign --force --sign - "${binPath}"`, { stdio: "pipe" }); } catch {}
  return n;
}

type State = { originalSalt: string; currentSalt: string };

function loadState(): State | null {
  try {
    if (!existsSync(STATE_PATH)) return null;
    return JSON.parse(readFileSync(STATE_PATH, "utf8"));
  } catch {
    return null;
  }
}

function saveState(s: State) { writeFileSync(STATE_PATH, JSON.stringify(s, null, 2) + "\n"); }

// ─── Terminal ────────────────────────────────────────────

const isTTY = !!process.stdin.isTTY;

const S = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", italic: "\x1b[3m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
  blue: "\x1b[34m", magenta: "\x1b[35m", cyan: "\x1b[36m",
};

const RARITY_CLR: Record<Rarity, string> = {
  common: S.dim, uncommon: S.green, rare: S.blue, epic: S.magenta, legendary: S.yellow,
};

let drawnLines = 0;

function tRender(lines: string[]) {
  if (drawnLines > 0) process.stdout.write(`\x1b[${drawnLines}A\x1b[J`);
  process.stdout.write(lines.join("\n") + "\n");
  drawnLines = lines.length;
}

function tClear() {
  if (drawnLines > 0) { process.stdout.write(`\x1b[${drawnLines}A\x1b[J`); drawnLines = 0; }
}

function tHideCursor() { process.stdout.write("\x1b[?25l"); }
function tShowCursor() { process.stdout.write("\x1b[?25h"); }

function readKey(): Promise<string> {
  return new Promise((r) => {
    const h = (d: Buffer) => { process.stdin.off("data", h); r(d.toString()); };
    process.stdin.on("data", h);
  });
}

function enterRaw() {
  if (isTTY) { process.stdin.setRawMode(true); process.stdin.resume(); }
  tHideCursor();
}

function exitRaw() {
  tShowCursor();
  if (isTTY) { process.stdin.setRawMode(false); process.stdin.pause(); }
}

process.on("exit", () => tShowCursor());
process.on("SIGINT", () => { tShowCursor(); process.exit(130); });

const BACK = Symbol.for("buddy-back");

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function padVisual(s: string, width: number): string {
  const vis = stripAnsi(s).length;
  return vis >= width ? s : s + ' '.repeat(width - vis);
}

// ─── Display ─────────────────────────────────────────────

function petLine(p: Pet, opts?: { selected?: boolean; index?: number }): string {
  const sel = opts?.selected ?? false;
  const rc = RARITY_CLR[p.rarity];
  const pre = sel ? `  ${S.cyan}\u276f${S.reset} ` : "    ";
  const idx = opts?.index !== undefined ? `${S.dim}${String(opts.index).padStart(3)}.${S.reset} ` : "";
  const shiny = p.shiny ? ` ${S.yellow}\u2728${S.reset}` : "";
  return (
    `${pre}${idx}${rc}${RARITY_STARS[p.rarity].padEnd(5)}${S.reset} ` +
    `${sel ? S.bold : ""}${p.species.padEnd(9)}${S.reset} ${p.eye}  ${p.hat.padEnd(9)}${shiny}` +
    `  ${S.dim}\u03a3${p.total}${S.reset}`
  );
}

function petDetail(p: Pet): string[] {
  const rc = RARITY_CLR[p.rarity];
  const lines: string[] = [];
  lines.push(`  ${S.dim}${"\u2500".repeat(56)}${S.reset}`);
  lines.push(
    `  ${rc}${RARITY_STARS[p.rarity]} ${p.rarity}${S.reset}  ${S.bold}${p.species}${S.reset}  ` +
    `${p.eye}  ${p.hat}${p.shiny ? `  ${S.yellow}SHINY${S.reset}` : ""}` +
    `    ${S.dim}${p.salt}${S.reset}`,
  );

  // Build sprite
  const sprite = renderSprite(p.species, p.eye, p.hat);
  const spriteW = 14;

  // Build stat lines
  const vals = Object.values(p.stats);
  const mx = Math.max(...vals), mn = Math.min(...vals);
  const statLines: string[] = [];
  for (const [k, v] of Object.entries(p.stats)) {
    const isPeak = v === mx && v >= 80;
    const isDump = v === mn && v <= 30;
    const mark = isPeak ? ` ${S.yellow}\u2605${S.reset}` : isDump ? ` ${S.red}\u25bc${S.reset}` : "";
    const clr = isPeak ? S.yellow : isDump ? S.red : v >= 70 ? S.green : S.dim;
    const w = 25;
    const filled = Math.round((v / 100) * w);
    const bar = "\u2588".repeat(filled) + "\u2591".repeat(w - filled);
    statLines.push(`${k.padEnd(10)} ${clr}${bar}${S.reset} ${clr}${String(v).padStart(3)}${S.reset}${mark}`);
  }
  statLines.push(`${"".padEnd(10)} ${S.dim}${"".padEnd(25)} \u03a3 ${p.total}${S.reset}`);

  // Side-by-side: sprite left, stats right
  const rows = Math.max(sprite.length, statLines.length);
  const blank = " ".repeat(12);
  lines.push("");
  for (let i = 0; i < rows; i++) {
    const spr = (i < sprite.length ? sprite[i]! : blank).padEnd(spriteW);
    const stat = i < statLines.length ? statLines[i]! : "";
    lines.push(`  ${spr}${stat}`);
  }
  return lines;
}

// ─── Interactive UI ──────────────────────────────────────

type MenuOpts<T> = {
  preview?: (value: T) => string[];
  allowBack?: boolean;
};

async function uiMenu<T>(
  title: string,
  items: { label: string; value: T; hint?: string }[],
  opts?: MenuOpts<T>,
): Promise<T | typeof BACK | null> {
  if (!isTTY || items.length === 0) return items[0]?.value ?? null;
  enterRaw();
  let cur = 0;

  // Compute pad width for side-by-side preview alignment
  let padW = 0;
  if (opts?.preview) {
    for (const it of items) {
      const vis = stripAnsi(`  \u276f ${it.label}  ${it.hint ?? ''}`).length;
      padW = Math.max(padW, vis);
    }
    padW += 4;
  }

  const draw = () => {
    const lines: string[] = [``, `  ${S.bold}${title}${S.reset}`, ``];
    const preview = opts?.preview?.(items[cur]!.value) ?? [];

    for (let i = 0; i < items.length; i++) {
      const sel = i === cur;
      const pre = sel ? `  ${S.cyan}\u276f${S.reset} ` : "    ";
      const style = sel ? S.bold : "";
      const hint = items[i]!.hint ? `  ${S.dim}${items[i]!.hint}${S.reset}` : "";
      let line = `${pre}${style}${items[i]!.label}${S.reset}${hint}`;

      // Show preview sprite aligned with cursor
      const pi = i - cur;
      if (pi >= 0 && pi < preview.length) {
        line = padVisual(line, padW) + preview[pi];
      }
      lines.push(line);
    }

    const back = opts?.allowBack ? "  \u2190 back" : "";
    lines.push(``, `  ${S.dim}\u2191\u2193 move  enter select${back}  q quit${S.reset}`, ``);
    tRender(lines);
  };

  draw();
  while (true) {
    const k = await readKey();
    if (k === "\x1b[A") { cur = (cur - 1 + items.length) % items.length; draw(); }
    else if (k === "\x1b[B") { cur = (cur + 1) % items.length; draw(); }
    else if (k === "\r") { tClear(); exitRaw(); return items[cur]!.value; }
    else if (opts?.allowBack && k === "\x1b[D") { tClear(); exitRaw(); return BACK; }
    else if (k === "q" || k === "\x1b" || k === "\x03") { tClear(); exitRaw(); return null; }
  }
}

async function uiPetBrowser(title: string, pets: Pet[]): Promise<Pet | null> {
  if (!isTTY || pets.length === 0) return pets[0] ?? null;
  enterRaw();
  let cur = 0;
  const pageSize = Math.min(10, Math.max(5, (process.stdout.rows || 30) - 20));

  const draw = () => {
    const lines: string[] = [``, `  ${S.bold}${title}${S.reset}  ${S.dim}(${pets.length})${S.reset}`, ``];

    const half = Math.floor(pageSize / 2);
    const start = Math.max(0, Math.min(cur - half, pets.length - pageSize));
    const end = Math.min(pets.length, start + pageSize);

    if (start > 0) lines.push(`  ${S.dim}  \u2191 ${start} more${S.reset}`);
    for (let i = start; i < end; i++) {
      lines.push(petLine(pets[i]!, { selected: i === cur }));
    }
    if (end < pets.length) lines.push(`  ${S.dim}  \u2193 ${pets.length - end} more${S.reset}`);

    lines.push(...petDetail(pets[cur]!));
    lines.push(``);
    lines.push(`  ${S.dim}\u2191\u2193 browse  enter select  \u2190/q back${S.reset}`);
    lines.push(``);
    tRender(lines);
  };

  draw();
  while (true) {
    const k = await readKey();
    if (k === "\x1b[A") { cur = Math.max(0, cur - 1); draw(); }
    else if (k === "\x1b[B") { cur = Math.min(pets.length - 1, cur + 1); draw(); }
    else if (k === "\r") { tClear(); exitRaw(); return pets[cur]!; }
    else if (k === "\x1b[D" || k === "q" || k === "\x1b" || k === "\x03") { tClear(); exitRaw(); return null; }
  }
}

async function uiConfirm(msg: string): Promise<boolean> {
  if (!isTTY) return true;
  const r = await uiMenu(msg, [
    { label: `${S.green}Yes${S.reset}`, value: true },
    { label: "No", value: false },
  ]);
  if (r === null || r === BACK) return false;
  return r;
}

// ─── Core ────────────────────────────────────────────────

function getCurrentInfo() {
  const binPath = findBinaryPath();
  const userId = getUserId();
  const bin = readFileSync(binPath);
  const saltInfo = findSaltInBinary(bin);

  if (!saltInfo) {
    const sizeMB = (bin.length / 1048576).toFixed(1);
    const head4 = bin.subarray(0, 4).toString("hex");
    console.error(`\n  ${S.red}SALT pattern not found in binary.${S.reset}`);
    console.error(`  ${S.dim}path${S.reset}  ${binPath}`);
    console.error(`  ${S.dim}size${S.reset}  ${sizeMB} MB  ${S.dim}magic${S.reset} ${head4}`);
    console.error(``);
    console.error(`  Possible causes:`);
    console.error(`    1. Claude Code was installed via npm — the JS wrapper has no SALT`);
    console.error(`    2. Your Claude Code version doesn't include the buddy feature yet`);
    console.error(`    3. The binary format changed in a newer version`);
    console.error(``);
    console.error(`  ${S.dim}If installed via npm, try the native installer:${S.reset}`);
    console.error(`  ${S.dim}  curl -fsSL https://claude.ai/install.sh | sh${S.reset}`);
    console.error(``);
    process.exit(1);
  }

  const pet = fullRoll(userId, saltInfo.salt);
  const state = loadState();
  const cfg = readClaudeConfig();
  const soul = cfg.companion as { name?: string; personality?: string } | undefined;
  const version = getBinaryVersion(binPath);

  // Detect Claude Code update: binary SALT no longer matches our last patch
  let wasUpdated = false;
  if (state && saltInfo.salt !== state.currentSalt) {
    wasUpdated = true;
    state.originalSalt = saltInfo.salt;
    state.currentSalt = saltInfo.salt;
    saveState(state);
  }

  return { binPath, userId, saltInfo, pet, state, soul, version, wasUpdated };
}

function doSwitch(targetSalt: string) {
  const { binPath, userId, saltInfo, pet: oldPet } = getCurrentInfo();
  if (targetSalt === saltInfo.salt) { console.log("\n  Already active.\n"); return; }
  if (targetSalt.length !== saltInfo.length) {
    console.error(`\n  ${S.red}SALT must be ${saltInfo.length} chars (got ${targetSalt.length}).${S.reset}\n`);
    process.exit(1);
  }

  let state = loadState() ?? { originalSalt: saltInfo.salt, currentSalt: saltInfo.salt };
  const newPet = fullRoll(userId, targetSalt);

  console.log(`\n  ${S.bold}Switching${S.reset}`);
  console.log(`  ${S.red}before${S.reset}${petLine(oldPet)}`);
  console.log(`  ${S.green}after ${S.reset}${petLine(newPet)}`);

  const n = patchBinary(binPath, saltInfo.salt, targetSalt);
  state.currentSalt = targetSalt;
  saveState(state);
  clearCompanionSoul();

  console.log(`\n  ${S.green}\u2713${S.reset} Patched ${n} location(s). Soul cleared.`);
  console.log(`  ${S.dim}Restart Claude Code, then /buddy to re-hatch.${S.reset}\n`);
}

// ─── Commands ────────────────────────────────────────────

async function cmdInteractive() {
  const info = getCurrentInfo();
  const { pet, soul, saltInfo, userId, state, version, wasUpdated } = info;

  // Show current pet
  console.log(``);
  console.log(`  ${S.bold}Current Buddy${S.reset}${version ? `  ${S.dim}v${version}${S.reset}` : ""}`);
  if (wasUpdated) console.log(`  ${S.yellow}\u26a0 Claude Code was updated. Pet reset to default.${S.reset}`);
  if (soul?.name) console.log(`  ${S.italic}${soul.name}${S.reset}  ${S.dim}${soul.personality ?? ""}${S.reset}`);
  console.log(petDetail(pet).join("\n"));
  console.log(``);

  // ── Wizard state machine ──
  let catalog: Pet[] = [];
  let rarity: Rarity | undefined;
  let species: string | undefined;
  let hat: string | undefined;

  type Step = 'action' | 'rarity' | 'species' | 'hat' | 'browse';
  let step: Step = 'action';
  const history: Step[] = [];
  const goTo = (s: Step) => { history.push(step); step = s; };
  const goBack = () => { step = history.pop() ?? 'action'; };

  while (true) {
    switch (step) {
      case 'action': {
        const r = await uiMenu("What to do?", [
          { label: "Switch pet", value: "switch" },
          { label: "Restore original", value: "restore", hint: state?.originalSalt !== saltInfo.salt ? state?.originalSalt : "already original" },
          { label: "Exit", value: "exit" },
        ]);
        if (r === null || r === "exit") return;
        if (r === "restore") { cmdRestore(); return; }
        goTo('rarity');
        break;
      }

      case 'rarity': {
        if (catalog.length === 0) {
          process.stdout.write(`\n  ${S.dim}Scanning...${S.reset}`);
          catalog = buildCatalog(userId, saltInfo.length);
          process.stdout.write(`\r\x1b[K`);
        }
        const counts = new Map<Rarity, number>();
        for (const p of catalog) counts.set(p.rarity, (counts.get(p.rarity) ?? 0) + 1);

        const r = await uiMenu("Rarity", RARITIES.slice().reverse().map((rt) => ({
          label: `${RARITY_CLR[rt]}${RARITY_STARS[rt]} ${rt}${S.reset}`,
          value: rt,
          hint: String(counts.get(rt) ?? 0),
        })), { allowBack: true });

        if (r === BACK) { goBack(); break; }
        if (r === null) return;
        rarity = r;
        goTo('species');
        break;
      }

      case 'species': {
        const byRarity = catalog.filter((p) => p.rarity === rarity);
        const counts = new Map<string, number>();
        for (const p of byRarity) counts.set(p.species, (counts.get(p.species) ?? 0) + 1);

        const items: { label: string; value: string; hint: string }[] = [
          { label: `${S.bold}(all)${S.reset}`, value: "*", hint: String(byRarity.length) },
        ];
        for (const sp of [...counts.keys()].sort()) {
          items.push({ label: sp, value: sp, hint: String(counts.get(sp)) });
        }

        const r = await uiMenu("Species", items, {
          allowBack: true,
          preview: (v) => v === "*" ? [] : renderSprite(v, "\u00b7", "none"),
        });

        if (r === BACK) { goBack(); break; }
        if (r === null) return;
        species = r;
        hat = undefined;

        // Skip hat if species=all or only 1 hat type
        if (species !== "*") {
          const bySpecies = byRarity.filter((p) => p.species === species);
          if (new Set(bySpecies.map((p) => p.hat)).size > 1) { goTo('hat'); break; }
        }
        goTo('browse');
        break;
      }

      case 'hat': {
        let list = catalog.filter((p) => p.rarity === rarity);
        if (species !== "*") list = list.filter((p) => p.species === species);
        const counts = new Map<string, number>();
        for (const p of list) counts.set(p.hat, (counts.get(p.hat) ?? 0) + 1);

        const items: { label: string; value: string; hint: string }[] = [
          { label: `${S.bold}(all)${S.reset}`, value: "*", hint: String(list.length) },
        ];
        for (const h of [...counts.keys()].sort()) {
          items.push({ label: h, value: h, hint: String(counts.get(h)) });
        }

        const r = await uiMenu("Hat", items, {
          allowBack: true,
          preview: (v) => renderSprite(species!, "\u00b7", v === "*" ? "none" : v),
        });

        if (r === BACK) { goBack(); break; }
        if (r === null) return;
        hat = r;
        goTo('browse');
        break;
      }

      case 'browse': {
        let list = catalog.filter((p) => p.rarity === rarity);
        if (species && species !== "*") list = list.filter((p) => p.species === species);
        if (hat && hat !== "*") list = list.filter((p) => p.hat === hat);
        list.sort((a, b) => (b.shiny ? 1 : 0) - (a.shiny ? 1 : 0) || b.total - a.total);

        const chosen = await uiPetBrowser(`Pick your ${rarity}`, list);
        if (!chosen) { goBack(); break; }

        console.log(petDetail(chosen).join("\n"));
        console.log(``);

        if (!(await uiConfirm("Switch to this pet?"))) {
          step = 'browse';
          break;
        }
        doSwitch(chosen.salt);
        return;
      }
    }
  }
}

function cmdInfo() {
  const { pet, soul, saltInfo, state, binPath, version, wasUpdated } = getCurrentInfo();
  console.log(`\n  ${S.bold}Buddy Pet${S.reset}${version ? `  ${S.dim}v${version}${S.reset}` : ""}`);
  if (wasUpdated) console.log(`  ${S.yellow}\u26a0 Claude Code was updated. Pet reset to default.${S.reset}`);
  console.log(`  ${S.dim}binary${S.reset}  ${binPath}`);
  console.log(`  ${S.dim}salt${S.reset}    ${saltInfo.salt}${state && state.originalSalt !== saltInfo.salt ? ` ${S.dim}(orig: ${state.originalSalt})${S.reset}` : ""}`);
  if (soul?.name) console.log(`  ${S.dim}name${S.reset}    ${soul.name}  ${S.dim}${soul.personality ?? ""}${S.reset}`);
  console.log(petDetail(pet).join("\n"));
  console.log(``);
}

function cmdList(tokens: string[]) {
  const f = parseTokens(tokens);
  if (!f.rarity && !f.species && !f.hat && f.shiny === undefined) f.rarity = "legendary";

  const { userId, saltInfo } = getCurrentInfo();
  process.stdout.write(`  ${S.dim}Scanning...${S.reset}`);
  const catalog = buildCatalog(userId, saltInfo.length);
  process.stdout.write(`\r\x1b[K`);

  let results = catalog.filter((p) => {
    if (f.rarity && p.rarity !== f.rarity) return false;
    if (f.species && p.species !== f.species) return false;
    if (f.hat && p.hat !== f.hat) return false;
    if (f.shiny !== undefined && p.shiny !== f.shiny) return false;
    return true;
  });

  results.sort((a, b) =>
    RARITIES.indexOf(b.rarity) - RARITIES.indexOf(a.rarity) ||
    a.species.localeCompare(b.species) ||
    (b.shiny ? 1 : 0) - (a.shiny ? 1 : 0) ||
    b.total - a.total,
  );

  const desc = [f.rarity, f.species, f.hat, f.shiny ? "shiny" : ""].filter(Boolean).join(" ") || "all";
  console.log(`  ${S.dim}${desc} | ${results.length} results${S.reset}\n`);

  if (results.length === 0) { console.log("  No matches.\n"); return; }

  const grouped = new Map<string, Pet[]>();
  for (const p of results) { if (!grouped.has(p.species)) grouped.set(p.species, []); grouped.get(p.species)!.push(p); }
  let i = 0;
  for (const [sp, list] of grouped) {
    console.log(`  ${S.bold}${sp}${S.reset} ${S.dim}(${list.length})${S.reset}`);
    for (const p of list) { console.log(petLine(p, { index: ++i })); }
    console.log(``);
  }
  console.log(`  ${S.dim}Use: buddy set <salt>${S.reset}\n`);
}

async function cmdSet(tokens: string[]) {
  if (tokens.length === 0) { console.error(`  ${S.red}Usage: buddy set <salt | species> [hat] [shiny]${S.reset}`); process.exit(1); }

  const f = parseTokens(tokens);

  // Direct SALT
  if (f.salt) { doSwitch(f.salt); return; }

  // Fuzzy match
  if (!f.rarity) f.rarity = "legendary";
  const { userId, saltInfo } = getCurrentInfo();
  process.stdout.write(`  ${S.dim}Scanning...${S.reset}`);
  const catalog = buildCatalog(userId, saltInfo.length);
  process.stdout.write(`\r\x1b[K`);

  let matches = catalog.filter((p) => {
    if (f.rarity && p.rarity !== f.rarity) return false;
    if (f.species && p.species !== f.species) return false;
    if (f.hat && p.hat !== f.hat) return false;
    if (f.shiny !== undefined && p.shiny !== f.shiny) return false;
    return true;
  });

  if (matches.length === 0) { console.error(`\n  ${S.red}No match.${S.reset} Try: buddy list ${tokens.join(" ")}\n`); process.exit(1); }

  matches.sort((a, b) => (b.shiny ? 1 : 0) - (a.shiny ? 1 : 0) || b.total - a.total);

  if (matches.length === 1 || !isTTY) {
    doSwitch(matches[0]!.salt);
    return;
  }

  // Interactive browse
  const chosen = await uiPetBrowser(`${matches.length} matches`, matches);
  if (!chosen) return;

  console.log(petDetail(chosen).join("\n"));
  console.log(``);
  if (!(await uiConfirm("Switch to this pet?"))) return;
  doSwitch(chosen.salt);
}

function cmdRestore() {
  const state = loadState();
  if (!state) { console.log("\n  No state. Binary is unmodified.\n"); return; }
  const { saltInfo } = getCurrentInfo();
  if (saltInfo.salt === state.originalSalt) { console.log("\n  Already original.\n"); return; }

  console.log(`\n  Restoring: ${saltInfo.salt} ${S.dim}\u2192${S.reset} ${state.originalSalt}`);
  const n = patchBinary(findBinaryPath(), saltInfo.salt, state.originalSalt);
  state.currentSalt = state.originalSalt;
  saveState(state);
  clearCompanionSoul();
  console.log(`  ${S.green}\u2713${S.reset} Restored (${n} locations). Soul cleared.`);
  console.log(`  ${S.dim}Restart Claude Code, then /buddy to re-hatch.${S.reset}\n`);
}

function cmdDebug() {
  const binPath = findBinaryPath();
  const bin = readFileSync(binPath);
  const sizeMB = (bin.length / 1048576).toFixed(1);
  const head = bin.subarray(0, 4).toString("hex");

  console.log(`\n  ${S.bold}Debug Info${S.reset}`);
  console.log(`  ${S.dim}path${S.reset}   ${binPath}`);
  console.log(`  ${S.dim}size${S.reset}   ${sizeMB} MB`);
  console.log(`  ${S.dim}magic${S.reset}  ${head}`);
  console.log(`  ${S.dim}user${S.reset}   ${getUserId()}`);

  // Search for "friend-" occurrences
  const prefix = Buffer.from("friend-");
  const hits: string[] = [];
  let idx = 0;
  while (hits.length < 20) {
    idx = bin.indexOf(prefix, idx);
    if (idx === -1) break;
    const snippet = bin.subarray(idx, Math.min(idx + 40, bin.length)).toString("utf8").replace(/[^\x20-\x7e]/g, ".");
    hits.push(`    @0x${idx.toString(16).padStart(8, "0")}  ${snippet}`);
    idx += prefix.length;
  }

  console.log(`\n  ${S.bold}"friend-" occurrences: ${hits.length}${S.reset}`);
  if (hits.length > 0) hits.forEach((h) => console.log(h));
  else console.log(`    (none found)`);

  // Search for SALT_PATTERN matches
  const saltInfo = findSaltInBinary(bin);
  console.log(`\n  ${S.bold}SALT match:${S.reset} ${saltInfo ? `${S.green}${saltInfo.salt}${S.reset} (${saltInfo.length} chars)` : `${S.red}none${S.reset}`}`);

  // Also search for UTF-16LE "friend-" (in case it's stored as wide string)
  const prefix16 = Buffer.from("friend-", "utf16le");
  const idx16 = bin.indexOf(prefix16);
  if (idx16 !== -1) {
    console.log(`  ${S.yellow}Found "friend-" as UTF-16LE at 0x${idx16.toString(16)}${S.reset}`);
  }

  // Show state file
  const state = loadState();
  console.log(`\n  ${S.bold}State:${S.reset} ${state ? JSON.stringify(state) : "(none)"}`);
  console.log(``);
}

// ─── Token Parser ────────────────────────────────────────

function parseTokens(tokens: string[]): { rarity?: string; species?: string; hat?: string; shiny?: boolean; salt?: string } {
  const f: ReturnType<typeof parseTokens> = {};
  for (const t of tokens) {
    const lo = t.toLowerCase();
    if (lo === "shiny" || lo === "--shiny") { f.shiny = true; continue; }
    if (SALT_PATTERN.test(t)) { f.salt = t; continue; }
    if ((RARITIES as readonly string[]).includes(lo)) { f.rarity = lo; continue; }
    if ((SPECIES as readonly string[]).includes(lo)) { f.species = lo; continue; }
    if ((HATS as readonly string[]).includes(lo)) { f.hat = lo; continue; }
  }
  return f;
}

// ─── Main ────────────────────────────────────────────────

function usage() {
  console.log(`
  ${S.bold}buddy${S.reset} ${S.dim}\u2014 Customize your Claude Code buddy pet${S.reset}

  ${S.bold}Usage${S.reset}
    buddy                               Interactive mode
    buddy info                          Show current pet
    buddy list [filters...]             Browse available pets
    buddy set  <species|salt> [...]     Switch pet
    buddy restore                       Restore original

  ${S.bold}Filters${S.reset} ${S.dim}(natural language style)${S.reset}
    legendary / epic / rare             Rarity ${S.dim}(default: legendary)${S.reset}
    dragon / cat / ghost / ...          Species
    wizard / crown / halo / ...         Hat
    shiny                               Shiny only

  ${S.bold}Examples${S.reset}
    buddy                               Interactive wizard
    buddy set dragon wizard             Best legendary dragon w/ wizard hat
    buddy set ghost shiny               Shiny legendary ghost
    buddy list epic cat                 Browse epic cats
    buddy set friend-2026-g40           Direct SALT
`);
}

const args = process.argv.slice(2);
const cmd = args[0];

switch (cmd) {
  case "info":              cmdInfo(); break;
  case "list": case "ls":   cmdList(args.slice(1)); break;
  case "set":  case "use":  cmdSet(args.slice(1)); break;
  case "restore": case "reset": cmdRestore(); break;
  case "debug":             cmdDebug(); break;
  case "-h": case "--help": case "help": usage(); break;
  default:
    if (args.length === 0 && isTTY) cmdInteractive();
    else if (args.length > 0) {
      const f = parseTokens(args);
      if (f.salt || f.species) cmdSet(args);
      else usage();
    }
    else usage();
}
