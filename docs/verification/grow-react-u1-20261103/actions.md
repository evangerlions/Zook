# U2 共享行动日行动切片（2026-11-03）

前端固定提交 `36f080e2d9f49c4e95d8fed03b2c49da637054f9`；合同快照锚点 Zook `2946311f2c0f606ecf2d5e54c238cd97359816f5`。从 Grow 干净构建工作树生成，`source_dirty=false`，沿用 Zook 既有 Web `/grow/actions` 挂载及 `/api/v1/lighttick/action-plans`。未新增业务服务、App 身份或 API；未部署。

## 已实现

- 独立共享行动页面，展示同 owner 的既有 workspace，区分共享行动、基础 task 与课程完成。
- 日行动明确打勾/计时创建，日期可为空；暂停/恢复、改期/转待安排、归档、打勾完成/撤销。
- 计时会话开始及显式确认实际投入；0 分钟记为中断，不把墙钟时间当实际投入，不把内容行动的计时当学完。
- 执行记录分页，沿用实际事实日期、撤销记录和分钟数。
- 提交前按 origin/app/user/document 持久化原 path/body/key/revision；重载、401恢复或丢响应后显式重试原请求，不在旧 key 上更新版本。冲突保留原输入，刷新核对后由用户解除。
- 未提交创建表单同样保存到独立文档槽；损坏存储不覆盖，写入失败不发送业务命令。前台/联网重新读取服务端；浏览器存储没有令牌。
- 服务端能力未开放时展示只读状态。375px 导航换行为两行，按钮不挤成逐字换行。

## 验证

- Grow `npm test`：10/10；`npm run build`（包含 TypeScript）通过。
- Zook `node --experimental-transform-types --test test/unit/lighttick-action*.test.ts`：36/36；`npm run check:api-contracts` 通过。
- 本机隔离 PG + 实际 Zook API/Web + Chrome：`test/support/grow_web_actions_acceptance.py`。
  - 创建后原生合同读取同 ID；另一端先暂停，Web 旧 revision 被拒绝且请求保留；核对后恢复。
  - 打勾完成再撤销，保留两条事实；计时只写一条实际 5 分钟记录。
  - 服务端已提交后主动丢弃响应，重载重试的 JSON/body/key 完全一致，最终仅一个行动。
  - 未提交标题/日期经重载恢复；其他 owner 看不到当前 owner 行动；375px 无横向溢出；无页面异常。
- 使用最终干净静态产物重跑记录与手动计划浏览器故事，回归创建/冲突/历史/离线恢复、显式计划确认与今日任务。

私有运行日志与截图在 `.artifacts/grow-unified-20261103/` 的 `actions-*`、`actions-browser/`、`records-browser-actions-regression/`、`plans-browser-actions-regression/`；不包含生产数据。原 Grow staged 差异在前后 binary diff 比较一致。

## 未完成范围

共享行动的层级创建/完整编辑、复盘、来源内容交互与实践反馈尚未迁完；AI 规划会话与目标复盘续排仍待实现。因而原 U2 全量交互任务仍未勾选，单独拆出本次已验证日行动切片。原生证据是 canonical HTTP 互通，不能替代设备 UI、读屏及真实模型验收。课程私人数据权威、迁移与发布门禁仍按原依赖推进。
