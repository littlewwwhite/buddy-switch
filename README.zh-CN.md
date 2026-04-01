[English](./README.md) | **中文**

# buddy-switch

自定义你的 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) buddy 宠物 —— 选择物种、稀有度、帽子等。

```
     (___)
     .----.     ★★★★★ legendary  blob  @  beanie
    ( @  @ )    DEBUGGING  █████████████████░░░░░░░░  69
    (      )    PATIENCE   █████████████████████████ 100 ★
     `----´     SNARK      ██████████████████████░░░  88
```

## 工作原理

Claude Code 根据二进制文件中的 **SALT** 值和你的用户 ID，为每个用户确定性地生成一只 buddy 宠物。`buddy-switch` 通过修改 SALT 值，让你从完整的宠物池中自由挑选。

- 18 种物种 × 8 种帽子 × 6 种眼睛 × 5 种稀有度
- 确定性 —— 相同用户 + SALT = 永远相同的宠物
- 可逆 —— 随时恢复原始宠物

## 安装

需要 [Bun](https://bun.sh) ≥ 1.0。

```bash
# 免安装直接运行
bunx buddy-switch

# 或全局安装
bun install -g buddy-switch
buddy
```

## 使用方式

### 交互模式（推荐）

```bash
buddy
```

启动 TUI 向导：选择稀有度 → 物种 → 帽子 → 浏览 → 确认。滚动时右侧实时预览 ASCII 精灵图。

方向键导航，回车选择，← 返回上一级，q 退出。

### 命令行模式

```bash
buddy info                  # 查看当前宠物详情
buddy list                  # 浏览所有传说级（默认）
buddy list epic cat         # 浏览史诗级猫
buddy list rare shiny       # 浏览稀有闪光
buddy set dragon wizard     # 切换为最佳传说级龙 + 巫师帽
buddy set ghost shiny       # 切换为闪光传说级幽灵
buddy set friend-2026-abc   # 通过精确 SALT 值切换
buddy restore               # 恢复原始宠物
```

筛选器可以自由组合，顺序无关：

| 筛选器 | 可选值                                                                          |
| ------ | ------------------------------------------------------------------------------- |
| 稀有度 | `common` `uncommon` `rare` `epic` `legendary`（默认：`legendary`）               |
| 物种   | `duck` `goose` `blob` `cat` `dragon` `octopus` `owl` `penguin` `turtle` `snail` `ghost` `axolotl` `capybara` `cactus` `robot` `rabbit` `mushroom` `chonk` |
| 帽子   | `crown` `tophat` `propeller` `halo` `wizard` `beanie` `tinyduck`               |
| 闪光   | `shiny`                                                                         |

## 切换后

1. **重启 Claude Code**（退出并重新打开）
2. 在 Claude Code 中输入 `/buddy` 重新孵化，获得新性格

切换时会清除 companion soul（名字 + 性格），Claude Code 会重新生成。

## Claude Code 更新后

当 Claude Code 更新时，二进制文件被替换，自定义 SALT 会丢失。`buddy-switch` 会自动检测到这一点：

- `buddy info` 会显示 ⚠ 警告
- 状态文件自动更新以追踪新的默认 SALT
- 重新运行 `buddy` 即可重新选择宠物

## 技术细节

1. 通过 `which claude` + 符号链接解析定位 Claude Code 二进制文件
2. 扫描二进制文件中的 SALT 模式（`friend-YYYY-xxx`）
3. 枚举所有相同长度的 SALT 值，构建完整目录
4. 使用 Claude Code 相同的 PRNG（mulberry32）对每个 SALT 进行确定性掷骰，生成宠物属性
5. 原地修补二进制文件，替换旧 SALT 字节为新值
6. 在 macOS 上重新签名（`codesign --force --sign -`）
7. 清除 `~/.claude.json` 中的 companion soul

状态存储在 `~/.claude/buddy-state.json`，用于支持恢复功能。

## 环境要求

- [Bun](https://bun.sh) ≥ 1.0
- Claude Code 已安装且在 PATH 中
- 对 Claude Code 二进制文件有写权限（可能需要 `chmod u+w`）

## 许可证

MIT
