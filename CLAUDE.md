LightTick 后端开发必须在本仓库进行，首先阅读并遵循 [AGENTS.md](AGENTS.md)。客户端位于 `../plan/LightTick-iOS` 和 `../plan/LightTick-Android`；旧 Go 代码在 `archive/lighttick-backend`，仅供参考。

# Project Guidelines

## Gstack

Use the `/browse` skill from gstack for all web browsing. Never use `mcp__claude-in-chrome__*` tools.

Available skills:
- `/office-hours`
- `/plan-ceo-review`
- `/plan-eng-review`
- `/plan-design-review`
- `/design-consultation`
- `/design-shotgun`
- `/design-html`
- `/review`
- `/ship`
- `/land-and-deploy`
- `/canary`
- `/benchmark`
- `/browse`
- `/connect-chrome`
- `/qa`
- `/qa-only`
- `/design-review`
- `/setup-browser-cookies`
- `/setup-deploy`
- `/retro`
- `/investigate`
- `/document-release`
- `/codex`
- `/cso`
- `/autoplan`
- `/plan-devex-review`
- `/devex-review`
- `/careful`
- `/freeze`
- `/guard`
- `/unfreeze`
- `/gstack-upgrade`
- `/learn`

If gstack skills aren't working, run `cd .claude/skills/gstack && ./setup` to build the binary and register skills.