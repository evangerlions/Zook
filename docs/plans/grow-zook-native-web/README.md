# Grow 整体迁入 Zook：原生 Web 方案

2026-11-02，基于 Zook `aae6160`。这是实施前梳理与提案，当前未完成原生迁移，未修改运行时代码、数据库、服务配置或部署。

目标是在当前 Zook 的既有 api、worker、admin-web 运行结构下新增并行 Grow Web，使用统一系统服务，保留其他产品及管理后台行为。新版最终没有Grow独立Python容器/进程/端口；原历史Grow服务继续保留。

## 阅读入口

- [范围与目标](proposal.md)：此次迁移定义与不改动的历史资产。
- [整体设计与能力矩阵](design.md)：目录/路由/身份/系统服务、数据权威、资源隔离及回退。
- [50项实施任务](tasks.md)：按基线、前端、账号、业务模块和发布门禁排序；当前均未标为实现完成。
- [已注册旧API清单](legacy-routes.json)：511个OpenAPI可见method/path操作；同时记录429个源码装饰器声明用于追溯。
- [逐操作迁移账本](migration-ledger.json)：511项候选分组；目标合同及验收证据尚待逐项填写，不将同名接口视为语义等价。
- [同进程Web规范](specs/grow-native-web/spec.md)、[系统服务规范](specs/grow-platform-services/spec.md)、[兼容与回退规范](specs/grow-compatibility-gates/spec.md)。

## 目标架构

```text
现有域名与Web进程
 ├─ 既有后台路径 → apps/admin-web 构建产物（行为保留）
 ├─ /grow/* → apps/grow-web 构建产物（新增）
 └─ /api/* → 既有Zook API
                  ├─ 普通用户认证/应用成员关系
                  ├─ LightTick业务与新增子模块
                  ├─ PostgreSQL仓储/文件/日志/审计
                  └─ 平台LLM与既有worker内有界任务
```

## 实施顺序与完成定义

1. 固定存量行为及负载基线，逐项比对迁移账本。
2. 新增默认关闭的Grow前端挂载，保持后台文件、端口及三服务Compose。
3. 接入Zook普通用户登录，完成原生Node记录保存/回读/重启闭环。
4. 依次迁移行动与规划、课程与阅读、知识与认知、股票投资和研究能力。
5. 所有能力处置完成，在无Python镜像中通过验收及存量产品关闭/开启双态回归。
6. 退出新版部署的Python兼容依赖，按main→dev→同SHA online的既有发布流程推进。

部署完整性、功能兼容、容量影响与发布重启窗口分别验收。方案采用P95增加不超过10%、无新增5xx的初始混合负载门槛，须在基线阶段固化；它不承诺同进程绝对故障隔离或零停机。

历史账号、Supabase/GitHub数据和旧配置不在此次自动迁移范围。新版Zook账号不通过用户名自动继承旧数据，也不向旧服务回写新版数据。

## 提案校验与同步

本地OpenSpec变更为 `openspec/changes/grow-zook-native-web`，已生成proposal、design、三份spec和tasks，并通过 `openspec validate grow-zook-native-web --strict`。
仓库按既有规则忽略 `openspec/`；本目录保存可提交、可评审的同内容快照。实施期间应同步更新两处任务/设计，不将规范校验通过当作功能测试通过。
