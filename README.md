**English** | [中文](./README.zh-CN.md)

# buddy-switch

Customize your [Claude Code](https://docs.anthropic.com/en/docs/claude-code) buddy pet — pick the species, rarity, hat, and more.

```
     (___)
     .----.     ★★★★★ legendary  blob  @  beanie
    ( @  @ )    DEBUGGING  █████████████████░░░░░░░░  69
    (      )    PATIENCE   █████████████████████████ 100 ★
     `----´     SNARK      ██████████████████████░░░  88
```

## How it works

Claude Code assigns each user a deterministic buddy pet based on a **SALT** value embedded in the binary and your user ID. `buddy-switch` patches that SALT to let you choose a different pet from the full pool of possibilities.

- 18 species × 8 hats × 6 eyes × 5 rarities
- Deterministic — same user + SALT = same pet, always
- Reversible — restore your original pet anytime

## Install

Requires [Bun](https://bun.sh) ≥ 1.0.

```bash
# via npx (no install needed)
bunx buddy-switch

# or install globally
bun install -g buddy-switch
buddy
```

## Usage

### Interactive mode (recommended)

```bash
buddy
```

Launches a TUI wizard: pick rarity → species → hat → browse → confirm. Live ASCII sprite previews appear as you scroll.

Use arrow keys to navigate, Enter to select, ← to go back, q to quit.

### CLI commands

```bash
buddy info                  # Show current pet details
buddy list                  # Browse all legendaries (default)
buddy list epic cat         # Browse epic cats
buddy list rare shiny       # Browse rare shinies
buddy set dragon wizard     # Switch to best legendary dragon with wizard hat
buddy set ghost shiny       # Switch to shiny legendary ghost
buddy set friend-2026-abc   # Switch by exact SALT value
buddy restore               # Restore original pet
```

Filters can be combined freely in natural language order:

| Filter    | Values                                                                          |
| --------- | ------------------------------------------------------------------------------- |
| Rarity    | `common` `uncommon` `rare` `epic` `legendary` (default: `legendary`)            |
| Species   | `duck` `goose` `blob` `cat` `dragon` `octopus` `owl` `penguin` `turtle` `snail` `ghost` `axolotl` `capybara` `cactus` `robot` `rabbit` `mushroom` `chonk` |
| Hat       | `crown` `tophat` `propeller` `halo` `wizard` `beanie` `tinyduck`               |
| Shiny     | `shiny`                                                                         |

## After switching

1. **Restart Claude Code** (quit and reopen)
2. Run `/buddy` inside Claude Code to re-hatch with a new personality

The companion soul (name + personality) is cleared on switch so Claude Code generates a fresh one.

## Claude Code updates

When Claude Code updates, the binary is replaced and your custom SALT is lost. `buddy-switch` detects this automatically:

- `buddy info` will show a ⚠ warning
- Your state file is updated to track the new default SALT
- Just run `buddy` again to re-pick your pet

## How it works (technical)

1. Locates the Claude Code binary via `which claude` + symlink resolution
2. Scans the binary for the SALT pattern (`friend-YYYY-xxx`)
3. Enumerates all possible SALT values of the same length to build a catalog
4. Rolls each SALT through the same PRNG (mulberry32) that Claude Code uses, producing deterministic pet attributes
5. Patches the binary in-place, replacing the old SALT bytes with the new one
6. Re-signs the binary on macOS (`codesign --force --sign -`)
7. Clears the companion soul from `~/.claude.json`

State is stored in `~/.claude/buddy-state.json` for restore support.

## Requirements

- [Bun](https://bun.sh) ≥ 1.0
- Claude Code installed and in PATH
- Write permission to the Claude Code binary (may need `chmod u+w`)

## License

MIT
