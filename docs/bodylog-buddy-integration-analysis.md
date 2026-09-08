# BodyLog 打卡搭子功能 · 前后端对接分析报告

> 本文保留最初对接分析快照，部分缺口已在后续实现中修复。当前接口以 [README_API.md](../README_API.md) 和仓库 OpenAPI 为准；当前能力及验证方式见 [实现概览](current-backend-implementation-overview.md)。

> 生成时间: 2026-08-19
> 范围: BodyLog iOS 客户端 ↔ Zook 后端 (BodyLog 模块)

---

## 一、项目架构定位澄清

### 1.1 多产品后端架构

**Zook 是一个通用后端服务,支撑多个独立的 App 产品:**

```
┌─────────────────────────────────────────────────────────────┐
│                    Zook Backend (通用平台)                    │
├─────────────────────────────────────────────────────────────┤
│  /api/v1/auth/*         → 平台公共账号能力                     │
│    ├── 密码登录 / 邮箱验证码 / 短信验证码                       │
│    ├── 个推一键登录 / 二维码登录                                │
│    └── Token 刷新 / 账号注销                                   │
├─────────────────────────────────────────────────────────────┤
│  /api/v1/frogsleep/*    → FrogSleep 睡眠 App                  │
│    ├── 睡眠搭子 (sleep-buddy)                                 │
│    ├── 专注搭子 (focus-buddy)                                 │
│    └── 搭子成长体系 (buddy-growth)                            │
│    客户端: /Users/hao/Documents/project/sleep/                │
├─────────────────────────────────────────────────────────────┤
│  /api/v1/bodylog/*      → BodyLog 运动 App                    │
│    ├── 打卡搭子 (buddies) ← 本文重点                           │
│    ├── 好友/社交 (friends/social)                             │
│    ├── 排行榜 (leaderboards)                                  │
│    ├── 挑战 (challenges)                                      │
│    └── 群组 (groups)                                          │
│    客户端: /Users/hao/Documents/project/sport/BodyLog/        │
└─────────────────────────────────────────────────────────────┘
```

**架构说明:**
- Zook 提供统一的账号系统、数据库、通知队列等基础设施
- 每个 App 产品有独立的业务模块和 API 命名空间
- 不同产品的搭子功能独立实现,不强制复用

### 1.2 本文档范围

**聚焦 BodyLog 打卡搭子功能的前后端对接现状**,包括:
- 账号系统前后端对比分析
- 客户端数据模型与 API 契约
- 后端数据库 Schema 与 Service 实现
- **关键差异**: 路径、字段命名、HTTP 方法的不一致
- 联调建议与接入优先级

---

## 二、账号系统前后端对比分析

### 2.1 BodyLog 客户端账号系统现状

**核心文件**: `BodyLog/Services/AccountSessionStore.swift`

**数据模型**:
```swift
struct BodyLogAccountSession: Codable, Equatable, Sendable {
    let userID: String
    let accessToken: String
    let refreshToken: String
    let expiresAt: Date
}

enum AccountSessionState: Equatable, Sendable {
    case signedOut
    case authenticating
    case signedIn(userID: String)
    case expired
}
```

**协议体系**:
- `AccountTokenStoring` - Token 存储（Keychain 实现）
- `AccountAuthenticating` - Token 刷新（默认 Unavailable 实现）
- `AccountAccessTokenProviding` - 访问令牌获取
- `AccountDeleting` - 账号删除（默认 Unavailable 实现）
- `AccountScopedDataClearing` - 账号数据清理

**当前状态**:
```swift
// 默认使用 Unavailable 实现
authenticator: AccountAuthenticating = UnavailableAccountAuthenticator()
accountDeleter: AccountDeleting = UnavailableAccountDeleter()
```

**关键问题**:
1. ❌ 所有 `refresh()` 调用都会抛出 `AccountAuthenticationError.unavailable`
2. ❌ 所有 `deleteAccount()` 调用都会抛出错误
3. ⚠️ 客户端已实现完整的协议和本地存储，但缺少真实后端对接
4. ✅ Keychain 存储、状态机、数据清理等基础设施已就绪

### 2.2 Zook 后端账号系统现状

**核心文件**: `src/modules/auth/auth.service.ts`

**支持的登录方式** (5种):
1. ✅ 密码登录 (`login`)
2. ✅ 邮箱验证码注册/登录 (`registerEmailCode`, `loginEmailCode`, `loginWithEmailCode`)
3. ✅ 短信验证码注册/登录 (`registerSmsCode`, `loginSmsCode`, `loginWithSmsCode`)
4. ✅ 个推一键登录 (`loginWithOneClickPhone`)
5. ✅ 二维码登录 (`qrLoginService`)

**核心特性**:
- **双令牌机制**: accessToken (15分钟) + refreshToken
- **失败锁定**: 15分钟窗口内10次失败 → 锁定15分钟
- **密码管理**: 修改/重置/设置，支持强度校验
- **会话管理**: 创建/刷新/登出/删除，支持多设备
- **安全特性**: 密码哈希（argon2id）、速率限制、账号区域分区（CN/INTL）
- **Token 刷新**: 支持 Body 和 Cookie 两种方式

**API 端点**:
```
POST /api/v1/auth/login                    - 密码登录
POST /api/v1/auth/login/email-code         - 邮箱验证码登录
POST /api/v1/auth/login/sms-code           - 短信验证码登录
POST /api/v1/auth/login/one-click          - 个推一键登录
POST /api/v1/auth/register/email-code      - 邮箱验证码注册
POST /api/v1/auth/register/sms-code        - 短信验证码注册
POST /api/v1/auth/refresh                  - 刷新 Token
POST /api/v1/auth/logout                   - 登出
DELETE /api/v1/auth/account                - 注销账号
POST /api/v1/auth/password/send-code       - 发送密码重置邮件
POST /api/v1/auth/password/reset           - 重置密码
POST /api/v1/auth/password/change          - 修改密码
```

### 2.3 账号系统关键差异

| 维度 | BodyLog 客户端 | Zook 后端 | 差异分析 |
|---|---|---|---|
| **登录方式** | 未实现（Unavailable） | 5种（密码/邮箱/短信/一键/二维码） | 客户端需选择接入方式 |
| **Token 结构** | `BodyLogAccountSession`<br/>(userID, accessToken, refreshToken, expiresAt) | `AuthSession`<br/>(userId, appId, accessToken, refreshToken, tokenVersion) | 后端多了 `tokenVersion` 和 `appId` |
| **Token 刷新** | 只看 `expiresAt` | 支持版本号校验 + Cookie 刷新 | 语义不完全对齐 |
| **账号注销** | 协议已定义，Unavailable 实现 | 完整实现（含确认机制） | 需替换为 Remote 实现 |
| **数据存储** | Keychain（本地） | 数据库 + Redis（会话状态） | 客户端本地，后端中心化 |
| **失败处理** | 无 | 15分钟/10次/锁定15分钟 | 客户端需处理锁定错误 |
| **多设备** | 无 | 支持（scope: current/all） | 客户端需支持登出范围选择 |

### 2.4 账号系统接入建议

**接入优先级**:

**P0 - 必须解决（阻塞搭子功能）**:

1. **替换 Unavailable 实现**
   ```swift
   // 新增 RemoteAccountAuthenticator
   struct RemoteAccountAuthenticator: AccountAuthenticating {
       let client: BodyLogSocialAPIClient

       func refresh(refreshToken: String) async throws -> BodyLogAccountSession {
           // 调用 POST /api/v1/auth/refresh
           let response = try await client.send(
               path: "/api/v1/auth/refresh",
               method: .post,
               body: ["refreshToken": refreshToken]
           )
           return BodyLogAccountSession(
               userID: response.userId,
               accessToken: response.accessToken,
               refreshToken: response.refreshToken,
               expiresAt: Date(timeIntervalSince1970: response.expiresAt)
           )
       }
   }
   ```

2. **选择登录方式**
   - **推荐先接入**: 密码登录 + 邮箱验证码登录（最稳定）
   - **后续扩展**: 短信验证码、个推一键登录
   - **可选**: 二维码登录（Web 端场景）

3. **对齐 Token 语义**
   - 后端 `tokenVersion` 需要在客户端存储
   - 刷新时传递 `tokenVersion` 进行校验
   - 处理 `AUTH_LOGIN_TEMPORARILY_LOCKED` 错误

**P1 - 建议解决**:

4. **账号注销实现**
   ```swift
   struct RemoteAccountDeleter: AccountDeleting {
       let client: BodyLogSocialAPIClient

       func deleteAccount(accessToken: String) async throws {
           try await client.send(
               path: "/api/v1/auth/account",
               method: .delete,
               body: ["confirmation": "DELETE"]
           )
       }
   }
   ```

5. **错误处理完善**
   - 处理登录失败锁定（提示用户等待）
   - 处理 Token 失效（自动刷新或重新登录）
   - 处理账号被拉黑（`AUTH_USER_BLOCKED`）

6. **多设备管理**
   - 登出时支持 `scope: current/all`
   - 显示当前活跃设备列表

### 2.5 账号系统接入成本评估

| 任务 | 工作量 | 说明 |
|---|---|---|
| 实现 RemoteAccountAuthenticator | 1天 | 替换 Unavailable 实现 |
| 实现密码登录 UI + 逻辑 | 1天 | 最基础的登录方式 |
| 实现邮箱验证码登录 | 1.5天 | 含发送验证码、倒计时、验证 |
| 对齐 Token 语义 | 0.5天 | 存储 tokenVersion、处理刷新 |
| 实现账号注销 | 0.5天 | 替换 Unavailable 实现 |
| 错误处理完善 | 1天 | 锁定、失效、拉黑等场景 |
| 联调测试 | 2天 | 覆盖所有登录方式 |

**总计**: 约 7.5天（1.5周）

### 2.6 账号系统总结

**现状评估**:
- ✅ 后端账号系统**非常成熟**（5种登录、双令牌、失败锁定、多设备管理）
- ⚠️ 客户端账号系统**协议就绪**，但使用 Unavailable 降级实现
- ❌ 账号系统**未接入真实后端**，阻塞所有需要认证的功能（包括搭子）

**关键决策点**:
1. **登录方式选择**: 先接入密码+邮箱验证码，后续扩展
2. **Token 刷新策略**: 是否使用 Cookie 刷新（Web 端友好）
3. **多设备管理**: 是否支持"登出所有设备"功能

**下一步行动**:
1. **立即**: 实现 `RemoteAccountAuthenticator`，替换 Unavailable
2. **本周**: 完成密码登录 + 邮箱验证码登录
3. **下周**: 联调测试，打通账号系统
4. **月底**: 扩展其他登录方式

---

## 二、后端实现现状 (Zook)

### 2.1 数据库 Schema (迁移 027_bodylog_buddy.sql)

**三张核心表:**

```sql
-- 1. 搭子配对表
zook_bodylog_buddy_pairs
├── id (TEXT PK)
├── app_id, user_id, partner_user_id (业务键,强制 user_id < partner_user_id 避免双向重复)
├── shared_habit_ids (JSONB, 1-3 个共同习惯)
├── status (pending/active/dissolved)
├── consecutive_days, max_consecutive, current_tier (成长体系)
├── last_active_date, revival_used_this_month
├── invited_via (friend/link/matching), invitation_token
└── created_at, accepted_at, dissolved_at, updated_at

-- 2. 搭子活动记录表
zook_bodylog_buddy_activities
├── id (TEXT PK)
├── pair_id (FK → buddy_pairs)
├── actor_user_id, type (checked_in/encouraged/viewed/reminded/milestone/revived)
├── target_habit_id, payload (JSONB)
└── created_at

-- 3. 搭子鼓励记录表
zook_bodylog_buddy_encouragements
├── id (TEXT PK)
├── pair_id (FK → buddy_pairs)
├── from_user_id, to_user_id
├── emoji (💪/👏/🔥/😊), is_same_action
└── created_at
```

**索引设计合理:**
- `uq_bodylog_buddy_pairs` 唯一约束 + `user_id < partner_user_id` CHECK 约束
- 按 user_id / partner_user_id / status 的复合索引
- 活动表按 pair_id + created_at DESC 索引

### 2.2 数据访问层 (postgres-bodylog-buddy.ts)

**已实现所有 CRUD 方法:**
- `insertBodyLogBuddyPair` / `findBodyLogBuddyPair` / `updateBodyLogBuddyPair`
- `listBodyLogBuddyPairsByUser` / `listAllBodyLogBuddyPairs` / `findBodyLogBuddyPairByUsers`
- `insertBodyLogBuddyActivity` / `listBodyLogBuddyActivities`
- `insertBodyLogBuddyEncouragement` / `listBodyLogBuddyEncouragements`

**所有方法都已注册到 `ApplicationDatabase` 抽象层**,支持多数据库实现。

### 2.3 业务服务层 (bodylog-buddy.service.ts)

**核心能力:**

| 方法 | 功能 | 状态 |
|---|---|---|
| `createPair(userId, req)` | 创建搭子邀请 | ✅ 完整实现 |
| `acceptPair(userId, pairId)` | 接受邀请 | ✅ 完整实现 |
| `dissolvePair(userId, pairId)` | 解除搭子关系 | ✅ 完整实现 |
| `getMyBuddies(userId)` | 获取搭子列表 | ✅ 完整实现 |
| `getBuddyDetail(userId, pairId)` | 获取搭子详情(含活动流) | ✅ 完整实现 |
| `recordCheckin(userId, habitId, count)` | 记录打卡并广播 | ✅ 完整实现 |
| `encourage(userId, req)` | 发送鼓励(支持"同款"自动打卡) | ✅ 完整实现 |
| `dailySettlement()` | 每日结算连续天数+等级 | ✅ 完整实现 |
| `autoDissolveInactivePairs()` | 自动解除不活跃搭子 | ✅ 完整实现 |

**业务规则已实现:**
- 搭子数量限制: FREE=2, PREMIUM=5
- 等级阈值: 铜牌3天 / 银牌7天 / 金牌30天 / 钻石60天 / 传奇180天
- 等级奖励: 金牌1天 / 钻石3天 / 传奇7天 Premium
- 不活跃阈值: 7天警告 / 14天自动解除
- 重新邀请冷却: 30天
- 邀请过期: 14天

**TODO 待完善:**
```typescript
private async checkIsPremium(userId: string): Promise<boolean> {
  // TODO: 实现Premium检查逻辑
  return false;
}

private async grantPremiumReward(userId: string, days: number): Promise<void> {
  // TODO: 实现Premium奖励逻辑
}
```

### 2.4 通知系统 (bodylog-buddy-notification.ts)

**8 种通知类型:**
- `buddy_invite` / `buddy_accepted` / `buddy_checked_in` / `buddy_encouraged`
- `buddy_tier_upgraded` / `buddy_streak_warning` / `buddy_streak_broken` / `buddy_revived`

**已集成到 NotificationService**,通过 BullMQ 异步队列发送。

### 2.5 路由定义 (bodylog-v1-routes.ts)

**搭子相关路由:**

| 路径 | 方法 | 功能 |
|---|---|---|
| `/api/v1/bodylog/buddies` | POST | 创建搭子邀请 |
| `/api/v1/bodylog/buddies` | GET | 获取我的搭子列表 |
| `/api/v1/bodylog/buddies/:id` | GET | 获取搭子详情 |
| `/api/v1/bodylog/buddies/:id/accept` | POST | 接受邀请 |
| `/api/v1/bodylog/buddies/:id/dissolve` | POST | 解除搭子 |
| `/api/v1/bodylog/buddies/encourage` | POST | 发送鼓励 |
| `/api/v1/bodylog/buddies/checkin` | POST | 记录打卡 |

**路由已注册到 `BackendApplication`**,通过 `bodyLogBuddyService` 依赖注入。

---

## 三、客户端实现现状 (BodyLog iOS)

### 3.1 数据模型 (BuddyModels.swift)

**与后端完全对齐的类型:**

```swift
enum BuddyPairStatus: String, Codable { case pending, active, dissolved }
enum BuddyTier: String, Codable { case copper, silver, gold, diamond, legend }
enum BuddyActivityType: String, Codable { case checked_in, encouraged, viewed, reminded, milestone, revived }
enum BuddyEncouragementEmoji: String, Codable { case 💪, 👏, 🔥, 😊 }

struct BuddyPair {
    let id: String
    let partnerUserID: String        // ⚠️ 命名差异: 后端是 partnerUserId
    let partnerNickname: String
    let partnerAvatarKey: String
    let sharedHabitIDs: [String]     // ⚠️ 命名差异: 后端是 sharedHabitIds
    let status: BuddyPairStatus
    let consecutiveDays: Int
    let maxConsecutive: Int
    let currentTier: BuddyTier?
    let lastActiveDate: Date?
    let createdAt: Date
    let acceptedAt: Date?
}

struct BuddyActivity {
    let id: String
    let pairID: String               // ⚠️ 命名差异: 后端是 pairId
    let actorUserID: String          // ⚠️ 命名差异: 后端是 actorUserId
    let actorNickname: String
    let actorAvatarKey: String
    let type: BuddyActivityType
    let targetHabitID: String?       // ⚠️ 命名差异: 后端是 targetHabitId
    let targetHabitName: String?
    let payload: [String: String]
    let createdAt: Date
}

struct BuddyEncouragement {
    let id: String
    let pairID: String               // ⚠️ 命名差异: 后端是 pairId
    let fromUserID: String
    let fromNickname: String
    let toUserID: String
    let emoji: BuddyEncouragementEmoji
    let isSameAction: Bool
    let createdAt: Date
}
```

### 3.2 API 客户端 (RemoteBuddyPair.swift)

**客户端期望的 API 契约:**

| 路径 | 方法 | 请求体 | 响应体 |
|---|---|---|---|
| `GET /buddy/pairs` | GET | - | `[BuddyPair]` |
| `GET /buddy/pairs/:id` | GET | - | `BuddyFeedResponse { pair, activities, encouragements }` |
| `POST /buddy/pairs` | POST | `{ partnerUserID, sharedHabitIDs }` | `CreateBuddyPairResponse { pair, invitationToken }` |
| `PUT /buddy/pairs/:id/accept` | PUT | - | `BuddyPair` |
| `DELETE /buddy/pairs/:id` | DELETE | - | void |
| `POST /buddy/pairs/:id/encourage` | POST | `{ pairID, emoji, isSameAction, targetHabitID }` | `BuddyEncouragement` |
| `POST /buddy/checkin` | POST | `{ habitID, count }` | void |

---

## 四、关键差异分析

### 4.1 路径前缀不一致

| 维度 | 客户端期望 | 后端实际 |
|---|---|---|
| 基础路径 | `/buddy/...` | `/api/v1/bodylog/buddies/...` |
| 产品前缀 | 无 | `/api/v1/bodylog/` |
| 资源命名 | `pairs` (单数) | `buddies` (复数) |

**影响:** 客户端 `RemoteBuddyPair.swift` 中所有路径都需要调整。

### 4.2 字段命名风格不一致

| 客户端 (Swift) | 后端 (TypeScript) | 说明 |
|---|---|---|
| `partnerUserID` | `partnerUserId` | Swift 全大写,TS 小写驼峰 |
| `sharedHabitIDs` | `sharedHabitIds` | 同上 |
| `pairID` | `pairId` | 同上 |
| `actorUserID` | `actorUserId` | 同上 |
| `targetHabitID` | `targetHabitId` | 同上 |
| `fromUserID` | `fromUserId` | 同上 |
| `toUserID` | `toUserId` | 同上 |

**根因:** Swift 命名规范倾向全大写 ID,TypeScript 倾向小写驼峰 id。

**解决方案:**
- 方案 A: 客户端使用 `JSONDecoder.keyDecodingStrategy = .convertFromSnakeCase` + 自定义映射
- 方案 B: 后端返回 JSON 时使用 Swift 风格的全大写 ID
- 方案 C: 统一使用小写驼峰 id (推荐,符合 REST API 惯例)

### 4.3 HTTP 方法不一致

| 操作 | 客户端期望 | 后端实际 | 影响 |
|---|---|---|---|
| 接受邀请 | `PUT /buddy/pairs/:id/accept` | `POST /api/v1/bodylog/buddies/:id/accept` | 方法+路径都不同 |
| 解除搭子 | `DELETE /buddy/pairs/:id` | `POST /api/v1/bodylog/buddies/:id/dissolve` | 方法+路径都不同 |
| 发送鼓励 | `POST /buddy/pairs/:id/encourage` | `POST /api/v1/bodylog/buddies/encourage` (pairId 在 body) | 路径结构不同 |

**REST 语义分析:**
- `PUT /accept` vs `POST /accept`: PUT 语义上是"替换",POST 语义上是"触发动作"。**后端 POST 更合理**
- `DELETE /pairs/:id` vs `POST /dissolve`: DELETE 符合 REST 删除语义,但 POST /dissolve 更符合"解除关系"的业务语义。**两者都可接受**
- 鼓励接口: 客户端是资源嵌套 `/pairs/:id/encourage`,后端是扁平 `/buddies/encourage`。**客户端更符合 REST 风格**

### 4.4 响应结构差异

| 操作 | 客户端期望 | 后端实际 |
|---|---|---|
| 获取搭子列表 | `[BuddyPair]` | `{ buddies: [BuddyPair], total: number }` |
| 解除搭子 | void | `{ dissolved: true }` |
| 记录打卡 | void | `{ recorded: true }` |

**后端返回包装对象更合理**(便于扩展,如添加分页元数据)。

---

## 五、联调建议

### 5.1 优先级排序

**P0 - 必须解决 (阻塞联调):**

1. **路径前缀对齐**
   - 客户端修改 `RemoteBuddyPair.swift` 中所有路径
   - `/buddy/pairs` → `/api/v1/bodylog/buddies`
   - `/buddy/pairs/:id` → `/api/v1/bodylog/buddies/:id`
   - `/buddy/checkin` → `/api/v1/bodylog/buddies/checkin`

2. **字段命名统一**
   - 推荐方案 C: 统一使用小写驼峰 `id` 而非全大写 `ID`
   - 客户端在 `JSONDecoder` 中配置 key 映射策略
   - 或后端在序列化时使用 Swift 风格 (不推荐)

3. **HTTP 方法对齐**
   - 客户端修改:
     - `PUT /accept` → `POST /accept`
     - `DELETE /pairs/:id` → `POST /pairs/:id/dissolve`
   - 或后端修改 (二选一):
     - 后端支持 `DELETE /buddies/:id` (更 RESTful)
     - 后端支持 `PUT /buddies/:id/accept` (语义更准确)

**P1 - 建议解决 (提升质量):**

4. **响应结构调整**
   - 客户端适配后端的包装对象 `{ buddies, total }`
   - 或后端返回纯数组 `[BuddyPair]` (不推荐)

5. **鼓励接口路径调整**
   - 客户端: `POST /buddy/pairs/:id/encourage`
   - 后端: `POST /api/v1/bodylog/buddies/encourage` (pairId in body)
   - **推荐**: 后端改为 `POST /api/v1/bodylog/buddies/:id/encourage` (更 RESTful)

**P2 - 可选优化 (提升体验):**

6. **Premium 检查实现**
   - 后端完成 `checkIsPremium()` 和 `grantPremiumReward()` 实现
   - 需要对接 BodyLog 的订阅系统

7. **通知文案国际化**
   - 当前通知文案是中文硬编码
   - 建议支持多语言 (参考 FrogSleep 的 i18n 实现)

### 5.2 接入步骤建议

**阶段 1: 协议对齐 (1-2 天)**

1. 客户端修改 `RemoteBuddyPair.swift`:
   ```swift
   // 路径前缀
   let basePath = "/api/v1/bodylog/buddies"

   // 字段映射 (使用小写驼峰)
   struct BuddyPair: Codable {
       let id: String
       let partnerUserId: String  // 改为小写驼峰
       let sharedHabitIds: [String]
       // ...
   }

   // HTTP 方法
   func acceptPair(pairID: String) async throws -> BuddyPair {
       try await client.send(
           path: "\(basePath)/\(pairID)/accept",
           method: .post,  // 改为 POST
           // ...
       )
   }

   func dissolvePair(pairID: String) async throws {
       try await client.send(
           path: "\(basePath)/\(pairID)/dissolve",  // 改为 /dissolve
           method: .post,  // 改为 POST
           // ...
       )
   }
   ```

2. 后端调整鼓励接口路径 (可选):
   ```typescript
   // bodylog-v1-routes.ts
   const buddyEncourageMatch = request.path.match(/^\/api\/v1\/bodylog\/buddies\/([^/]+)\/encourage$/);
   if (buddyEncourageMatch && request.method === "POST") {
     const encouragement = await buddyService.encourage(auth.userId, {
       pairId: buddyEncourageMatch[1],  // 从路径提取
       emoji: body.emoji,
       isSameAction: body.isSameAction ?? false,
       targetHabitId: body.targetHabitId,
     });
     return context.ok(encouragement, request.requestId as string);
   }
   ```

**阶段 2: 联调测试 (2-3 天)**

1. 搭建测试环境,配置 BodyLog App 的 `app_id`
2. 使用 Postman/curl 验证后端接口
3. 客户端连接测试环境,逐接口联调
4. 重点测试:
   - 创建搭子邀请 → 接受 → 激活
   - 打卡广播 → 连续天数计算
   - 鼓励 → "同款"自动打卡
   - 每日结算 (模拟时间推进)

**阶段 3: 功能完善 (3-5 天)**

1. 后端实现 Premium 检查逻辑
2. 客户端完善 UI 交互 (邀请过期提示、搭子数量限制等)
3. 配置定时任务: `dailySettlement()` + `autoDissolveInactivePairs()`
4. 灰度发布

---

## 六、与 FrogSleep 搭子体系的对比

### 6.1 FrogSleep 搭子 (睡眠/专注搭子)

**特点:**
- **匹配算法**: `searchFocusMatches()` 基于同意校验 + 关系刷新 + 排序候选
- **成长体系**: 完整的 `buddy-growth` 模块,含邀请捆绑/回执/联合目标/里程碑/治理规则
- **域管理**: `buddy-domain-*` 系列,含槽位验证、关系验证、决策记录
- **安全/隐私**: `buddy-safety.ts` / `buddy-privacy.ts` / `buddy-protected-access.ts`
- **异步处理**: BullMQ 队列处理邀请邮件/通知
- **数据库迁移**: 13 个相关迁移 (007/009-020),含群组预嵌入、域槽位、治理规则等

**复杂度:** 高 (完整的社交产品体系)

### 6.2 BodyLog 搭子 (打卡搭子)

**特点:**
- **简单直接**: 基于好友关系的 1v1 搭子配对
- **成长体系**: 5 级等级 (铜/银/金/钻/传奇),基于连续打卡天数
- **业务规则**: 搭子数量限制、不活跃自动解除、重新邀请冷却
- **通知系统**: 8 种通知类型,通过 NotificationService 异步发送
- **数据库迁移**: 1 个迁移 (027),3 张核心表

**复杂度:** 中 (轻量级社交功能)

### 6.3 架构建议

**当前方案:** BodyLog 搭子是独立实现,不复用 FrogSleep 的 buddy-growth 底座。

**理由:**
1. **业务场景不同**: FrogSleep 是睡眠/专注场景,BodyLog 是运动打卡场景
2. **复杂度差异**: FrogSleep 需要匹配算法、域管理、治理规则;BodyLog 只需要简单的好友配对
3. **产品独立性**: BodyLog 是独立产品,有自己的迭代节奏

**风险:**
- 如果未来 BodyLog 需要更复杂的搭子功能 (如群组搭子、匹配算法),可能需要重构
- 两套搭子体系的维护成本

**建议:**
- 短期: 保持现状,快速联调上线
- 中期: 观察 BodyLog 搭子的使用情况,评估是否需要升级
- 长期: 如果 BodyLog 搭子功能复杂化,考虑抽取通用 `buddy-core` 模块供两个产品复用

---

## 七、总结

### 7.1 现状评估

**后端 (Zook):**
- ✅ 数据库设计合理,索引完整
- ✅ Service 层业务逻辑完整,规则清晰
- ✅ 通知系统集成完成
- ✅ 路由已注册,依赖注入就绪
- ⚠️ Premium 检查逻辑待实现

**客户端 (BodyLog iOS):**
- ✅ 数据模型与后端对齐
- ✅ Remote 层实现完整
- ✅ UI 视图 (列表/详情/动画/Widget/Watch) 齐全
- ❌ API 路径/字段命名/HTTP 方法与后端不一致

### 7.2 接入成本评估

**路径对齐:** 1-2 天 (修改 RemoteBuddyPair.swift)
**字段映射:** 0.5 天 (配置 JSONDecoder 或修改模型)
**HTTP 方法调整:** 0.5 天 (修改客户端或后端)
**联调测试:** 2-3 天
**功能完善:** 3-5 天

**总计:** 约 1-2 周可完成首次联调上线

### 7.3 关键决策点

1. **字段命名风格:** 建议统一使用小写驼峰 `id` (符合 REST API 惯例)
2. **HTTP 方法:** 建议客户端适配后端的 POST 方法 (更符合业务语义)
3. **鼓励接口:** 建议后端改为 RESTful 风格 `/buddies/:id/encourage`
4. **Premium 集成:** 需要在联调前完成后端 Premium 检查逻辑

### 7.4 下一步行动

1. **立即:** 确认字段命名风格决策 (全大写 ID vs 小写驼峰 id)
2. **本周:** 客户端修改 `RemoteBuddyPair.swift` 对齐路径和方法
3. **下周:** 搭建测试环境,开始联调
4. **月底:** 完成功能测试,灰度发布

---

## 附录: 快速参考

### A. 后端 API 端点汇总

```
POST   /api/v1/bodylog/buddies              创建搭子邀请
GET    /api/v1/bodylog/buddies              获取我的搭子列表
GET    /api/v1/bodylog/buddies/:id          获取搭子详情
POST   /api/v1/bodylog/buddies/:id/accept   接受邀请
POST   /api/v1/bodylog/buddies/:id/dissolve 解除搭子
POST   /api/v1/bodylog/buddies/encourage    发送鼓励
POST   /api/v1/bodylog/buddies/checkin      记录打卡
```

### B. 数据库表结构

```sql
zook_bodylog_buddy_pairs (搭子配对)
├── id, app_id, user_id, partner_user_id
├── shared_habit_ids (JSONB)
├── status, consecutive_days, max_consecutive, current_tier
└── last_active_date, revival_used_this_month, invited_via, invitation_token

zook_bodylog_buddy_activities (活动记录)
├── id, pair_id, actor_user_id
├── type, target_habit_id, payload (JSONB)
└── created_at

zook_bodylog_buddy_encouragements (鼓励记录)
├── id, pair_id, from_user_id, to_user_id
├── emoji, is_same_action
└── created_at
```

### C. 业务规则速查

- 搭子数量限制: FREE=2, PREMIUM=5
- 等级阈值: 铜牌3天 / 银牌7天 / 金牌30天 / 钻石60天 / 传奇180天
- 等级奖励: 金牌1天 / 钻石3天 / 传奇7天 Premium
- 不活跃阈值: 7天警告 / 14天自动解除
- 重新邀请冷却: 30天
- 邀请过期: 14天

---

**文档维护:** 本文档应随代码变更同步更新,特别是 API 路径和字段命名的最终决策。
