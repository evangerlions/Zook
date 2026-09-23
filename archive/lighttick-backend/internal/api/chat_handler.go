package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/lighttick/lighttick-backend/internal/ai"
	"github.com/lighttick/lighttick-backend/internal/auth"
	"github.com/lighttick/lighttick-backend/internal/db"
)

type ChatHandler struct {
	queries   *db.Queries
	aiService *ai.Service
}

func NewChatHandler(queries *db.Queries, aiService *ai.Service) *ChatHandler {
	return &ChatHandler{
		queries:   queries,
		aiService: aiService,
	}
}

type SendMessageRequest struct {
	Message string     `json:"message"`
	GoalID  *uuid.UUID `json:"goal_id,omitempty"`
	Context string     `json:"context,omitempty"` // 可选的上下文信息
}

type ChatResponse struct {
	ID        uuid.UUID      `json:"id"`
	Role      string         `json:"role"`
	Content   string         `json:"content"`
	Metadata  map[string]any `json:"metadata,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
}

// SendMessage 处理用户消息并返回 AI 响应（SSE 流式）
func (h *ChatHandler) SendMessage(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(auth.UserIDKey).(string)
	uid, err := uuid.Parse(userID)
	if err != nil {
		JSONError(w, http.StatusBadRequest, "INVALID_USER_ID", "Invalid user ID format")
		return
	}

	var req SendMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		JSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}

	if req.Message == "" {
		JSONError(w, http.StatusBadRequest, "MISSING_FIELD", "Message is required")
		return
	}

	// 保存用户消息
	userMsg, err := h.queries.CreateChatMessage(r.Context(), db.CreateChatMessageParams{
		UserID:   uid,
		GoalID:   req.GoalID,
		Role:     "user",
		Content:  req.Message,
		Metadata: map[string]any{"context": req.Context},
	})
	if err != nil {
		JSONError(w, http.StatusInternalServerError, "DB_ERROR", "Failed to save message")
		return
	}

	// 获取最近的对话历史（用于上下文）
	history, err := h.queries.ListChatMessagesByUser(r.Context(), uid, 10, 0)
	if err != nil {
		JSONError(w, http.StatusInternalServerError, "DB_ERROR", "Failed to fetch chat history")
		return
	}

	// 如果有 goal_id，获取目标信息
	var goalContext string
	if req.GoalID != nil {
		goal, err := h.queries.GetGoal(r.Context(), *req.GoalID)
		if err == nil {
			goalContext = fmt.Sprintf("用户正在追求目标：%s", goal.Title)
		}
	}

	// 获取用户的 DNA 洞察（用于个性化）
	insights, err := h.queries.GetActiveDNAInsightsByUser(r.Context(), uid)
	if err != nil {
		// 不阻断流程，只是没有个性化
		insights = []db.DNAInsight{}
	}

	// 构建 AI 提示
	prompt := h.buildChatPrompt(req.Message, history, goalContext, insights)

	// 设置 SSE 响应头
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	// 创建流式响应
	flusher, ok := w.(http.Flusher)
	if !ok {
		JSONError(w, http.StatusInternalServerError, "STREAMING_NOT_SUPPORTED", "Streaming not supported")
		return
	}

	// 调用 AI 服务
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	// 生成 AI 响应
	aiResponse, err := h.aiService.Generate(ctx, ai.GenerateRequest{
		Prompt: prompt,
		Model:  "gpt-4",
	})
	if err != nil {
		// 发送错误事件
		errorData := map[string]any{
			"error": map[string]any{
				"code":    "AI_ERROR",
				"message": "Failed to generate response",
			},
		}
		errorJSON, _ := json.Marshal(errorData)
		fmt.Fprintf(w, "event: error\ndata: %s\n\n", errorJSON)
		flusher.Flush()
		return
	}

	// 保存 AI 响应
	aiMsg, err := h.queries.CreateChatMessage(r.Context(), db.CreateChatMessageParams{
		UserID:   uid,
		GoalID:   req.GoalID,
		Role:     "assistant",
		Content:  aiResponse.Content,
		Metadata: map[string]any{"model": aiResponse.Model, "tokens": aiResponse.TokensUsed},
	})
	if err != nil {
		// 已经发送了响应，这里只是记录错误
		fmt.Printf("Failed to save AI message: %v\n", err)
	}

	// 发送完成事件
	doneData := map[string]any{
		"message": ChatResponse{
			ID:        aiMsg.ID,
			Role:      aiMsg.Role,
			Content:   aiMsg.Content,
			Metadata:  aiMsg.Metadata,
			CreatedAt: aiMsg.CreatedAt,
		},
	}
	doneJSON, _ := json.Marshal(doneData)
	fmt.Fprintf(w, "event: done\ndata: %s\n\n", doneJSON)
	flusher.Flush()
}

// GetChatHistory 获取聊天历史
func (h *ChatHandler) GetChatHistory(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(auth.UserIDKey).(string)
	uid, err := uuid.Parse(userID)
	if err != nil {
		JSONError(w, http.StatusBadRequest, "INVALID_USER_ID", "Invalid user ID format")
		return
	}

	// 解析查询参数
	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := parseInt(l); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}

	offset := 0
	if o := r.URL.Query().Get("offset"); o != "" {
		if n, err := parseInt(o); err == nil && n >= 0 {
			offset = n
		}
	}

	// 获取聊天历史
	messages, err := h.queries.ListChatMessagesByUser(r.Context(), uid, limit, offset)
	if err != nil {
		JSONError(w, http.StatusInternalServerError, "DB_ERROR", "Failed to fetch chat history")
		return
	}

	// 转换为响应格式
	response := make([]ChatResponse, len(messages))
	for i, msg := range messages {
		response[i] = ChatResponse{
			ID:        msg.ID,
			Role:      msg.Role,
			Content:   msg.Content,
			Metadata:  msg.Metadata,
			CreatedAt: msg.CreatedAt,
		}
	}

	JSONResponse(w, http.StatusOK, response)
}

// buildChatPrompt 构建聊天提示
func (h *ChatHandler) buildChatPrompt(userMessage string, history []db.ChatMessage, goalContext string, insights []db.DNAInsight) string {
	prompt := "你是 LightTick 的 AI Coach，一个专注于帮助用户实现目标的个人成长助手。\n\n"

	// 添加目标上下文
	if goalContext != "" {
		prompt += goalContext + "\n\n"
	}

	// 添加 DNA 洞察
	if len(insights) > 0 {
		prompt += "你了解到的关于这个用户的信息：\n"
		for _, insight := range insights {
			if insight.Confidence > 0.6 {
				prompt += fmt.Sprintf("- %s（置信度：%.0f%%）\n", insight.Title, insight.Confidence*100)
			}
		}
		prompt += "\n"
	}

	// 添加对话历史
	if len(history) > 0 {
		prompt += "最近的对话历史：\n"
		// 反转历史，从旧到新
		for i := len(history) - 1; i >= 0; i-- {
			msg := history[i]
			role := "用户"
			if msg.Role == "assistant" {
				role = "AI Coach"
			}
			prompt += fmt.Sprintf("%s: %s\n", role, msg.Content)
		}
		prompt += "\n"
	}

	// 添加当前消息
	prompt += fmt.Sprintf("用户当前消息: %s\n\n", userMessage)

	// 添加指导原则
	prompt += `请以温暖、支持但务实的方式回应。遵循以下原则：
1. 先理解用户的情况和需求
2. 提供具体、可执行的建议
3. 如果用户遇到挫折，帮助他们找到恢复的方法
4. 避免空洞的鼓励，提供实际的支持
5. 如果合适，提出一个问题来帮助用户深入思考
6. 保持回复简洁，通常不超过 3-4 段

请用中文回复。`

	return prompt
}

// parseInt 辅助函数
func parseInt(s string) (int, error) {
	var n int
	_, err := fmt.Sscanf(s, "%d", &n)
	return n, err
}
