# 阿里云百炼模型列表（Model Studio Models）

> 数据来源：https://help.aliyun.com/zh/model-studio/models

---

# 🧠 一、文本生成模型（LLM）

## 1. Qwen3 商业版
| 模型名称 | 模型代号（Model ID） | 说明 |
|---|---|---|
| 千问 Max（稳定版） | `qwen3-max` | 主力旗舰模型 |
| 千问 Max（快照） | `qwen3-max-2026-01-23` | 指定版本 |
| 千问 Max（历史） | `qwen3-max-2025-09-23` | 历史版本 |
| 千问 Max（预览） | `qwen3-max-preview` | 测试版 |
| 千问 Plus | - | 已升级至 Qwen3.5 |
| 千问 Flash | - | 已升级至 Qwen3.5 |

---

## 2. Qwen3 开源 / 通用系列
| 模型名称 | 模型代号 |
|---|---|
| Qwen3.5（397B） | `qwen3.5-397b-a17b` |
| Qwen3.5（122B） | `qwen3.5-122b-a10b` |

---

# 👁️ 二、多模态模型（视觉/图像理解）

## 1. 视觉理解（VL）
| 模型名称 | 模型代号 |
|---|---|
| Qwen3 VL Plus | `qwen3-vl-plus-2025-12-19` |
| Qwen3 VL Plus（旧） | `qwen3-vl-plus-2025-09-23` |
| Qwen3 VL Flash | `qwen3-vl-flash` |
| Qwen3 VL Flash（新版） | `qwen3-vl-flash-2026-01-22` |
| Qwen3 VL Flash（旧） | `qwen3-vl-flash-2025-10-15` |

---

## 2. 全模态 / 实时
| 模型名称 | 模型代号 |
|---|---|
| Qwen Omni | - |
| Qwen Omni Realtime | - |
| QVQ（视觉推理） | - |

---

# 🎨 三、图像生成模型

| 类型 | 模型 |
|---|---|
| 文生图（千问） | 未单独列 ID（依附 Qwen 系列） |
| 万相文生图 | Wan 系列 |
| 第三方模型 | DeepSeek / Kimi / GLM |

---

# 🎬 四、视频生成模型

| 模型名称 | 模型代号 |
|---|---|
| 万相视频（推荐） | `wan2.6-r2v-flash` |
| 万相视频（标准） | `wan2.6-r2v` |

---

# 🔊 五、语音模型

## 1. TTS（语音合成）
| 模型名称 | 模型代号 |
|---|---|
| 千问 TTS VD | `qwen3-tts-vd-2026-01-26` |
| 千问 TTS VC | `qwen3-tts-vc-2026-01-22` |

---

## 2. ASR（语音识别）
| 模型名称 | 模型代号 |
|---|---|
| 实时语音识别 | `paraformer-realtime-v2` |
| 低采样率版本 | `paraformer-realtime-8k-v2` |

---

# 📊 六、Embedding（文本向量）

## 1. 文本向量
| 模型名称 | 模型代号 |
|---|---|
| Embedding v4 | `text-embedding-v4` |
| Embedding v3 | `text-embedding-v3` |

---

## 2. 多模态向量
| 模型名称 | 模型代号 |
|---|---|
| 通义视觉向量 Plus | `tongyi-embedding-vision-plus` |
| 通义视觉向量 Flash | `tongyi-embedding-vision-flash` |
| Qwen VL Embedding | `qwen3-vl-embedding` |
| 多模态向量 | `multimodal-embedding-v1` |

---

# 🧩 七、已下线模型（历史）

## Qwen2
| 模型名称 | 模型代号 |
|---|---|
| Qwen2 72B | `qwen2-72b-instruct` |
| Qwen2 57B | `qwen2-57b-a14b-instruct` |
| Qwen2 7B | `qwen2-7b-instruct` |

---

## Qwen1.5
| 模型名称 | 模型代号 |
|---|---|
| Qwen1.5 110B | `qwen1.5-110b-chat` |
| Qwen1.5 72B | `qwen1.5-72b-chat` |
| Qwen1.5 32B | `qwen1.5-32b-chat` |
| Qwen1.5 14B | `qwen1.5-14b-chat` |
| Qwen1.5 7B | `qwen1.5-7b-chat` |

---

# ✅ 快速选型建议

- **最强模型**
  - `qwen3-max`

- **高性价比**
  - `qwen3.5-*`

- **多模态**
  - `qwen3-vl-plus`
  - `qwen3-vl-flash`

- **Embedding**
  - `text-embedding-v4`

- **视频生成**
  - `wan2.6-r2v-flash`