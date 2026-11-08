# 当前行为账本基线

对 Grow 当前工作树进行纯源码 AST 核对，包含未提交的有效实现和隐藏接口。未导入/运行 Python 服务，未读取数据目录、密钥、环境文件或真实私人历史。

结果：旧清单 511/511 项均定位到声明，当前共 516 个 method/path 身份；新增 5 个隐藏声明，未解析动态注册 0、旧声明未定位 0。保留源码位置及 SHA-256。静态定位只证明声明存在，不能证明运行注册、功能等价或迁移完成。

账本每项附实施切片、候选合同、页面/测试候选、对账及迁移义务。候选均明确未验证：正式课程路线不能映射为目标计划；平台凭据设置不迁入用户正文或导出。516 项仍为 unreviewed，必须逐操作补实际合同、实现和测试证据。当前门禁按预期失败，pending_semantic_review=516，不能作为发布候选通过。

复现（Python 3.13，仅源码）：

```sh
python3.13 build_scripts/inventory_grow_legacy_behaviors.py --source-root /Volumes/肖豪/project/grow/知行成长/server --baseline docs/plans/grow-zook-native-web/legacy-routes.json --output docs/plans/grow-zook-native-web/current-behavior-declarations.json --ledger docs/plans/grow-zook-native-web/migration-ledger.json --ledger-output docs/plans/grow-zook-native-web/migration-ledger.json
python3.13 -m unittest discover -s build_scripts/tests -p test_inventory_grow_legacy_behaviors.py
python3.13 build_scripts/check_grow_migration_ledger.py --ledger docs/plans/grow-zook-native-web/migration-ledger.json --inventory docs/plans/grow-zook-native-web/current-behavior-declarations.json
```

5 项测试覆盖跨文件路由参数、前缀、隐藏/多 method、资源工厂、未知表达式拒绝静默漏报、不执行旧服务、不以菜单/构建代替等价验收。U0 总任务保持未完成：行情/精度/交易日/回测黄金数据、全域同步及其他 App 负载仍待补齐。
