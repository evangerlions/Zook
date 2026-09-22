package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/lighttick/lighttick-backend/internal/auth"
	"github.com/lighttick/lighttick-backend/internal/db"
)

type DNAHandler struct {
	queries *db.Queries
}

func NewDNAHandler(queries *db.Queries) *DNAHandler {
	return &DNAHandler{queries: queries}
}

type DNAInsightResponse struct {
	ID             uuid.UUID      `json:"id"`
	Category       string         `json:"category"`
	Title          string         `json:"title"`
	Description    *string        `json:"description,omitempty"`
	EvidenceCount  int            `json:"evidence_count"`
	Confidence     float64        `json:"confidence"`
	Scope          string         `json:"scope"`
	CreatedAt      time.Time      `json:"created_at"`
	ExpiresAt      *time.Time     `json:"expires_at,omitempty"`
	UserFeedback   *string        `json:"user_feedback,omitempty"`
	UserCorrection *string        `json:"user_correction,omitempty"`
	AllowedEffects []string       `json:"allowed_effects"`
	IsStable       bool           `json:"is_stable"`
	Metadata       map[string]any `json:"metadata,omitempty"`
}

type FeedbackRequest struct {
	Feedback   string  `json:"feedback"` // confirmed, rejected, corrected
	Correction *string `json:"correction,omitempty"`
}

// ListInsights 获取用户的 DNA 洞察列表
func (h *DNAHandler) ListInsights(w http.ResponseWriter, r *http.Request) {
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

	// 获取洞察列表
	insights, err := h.queries.ListDNAInsightsByUser(r.Context(), uid, limit, offset)
	if err != nil {
		JSONError(w, http.StatusInternalServerError, "DB_ERROR", "Failed to fetch insights")
		return
	}

	// 转换为响应格式
	response := make([]DNAInsightResponse, len(insights))
	for i, insight := range insights {
		response[i] = DNAInsightResponse{
			ID:             insight.ID,
			Category:       insight.Category,
			Title:          insight.Title,
			Description:    insight.Description,
			EvidenceCount:  insight.EvidenceCount,
			Confidence:     insight.Confidence,
			Scope:          insight.Scope,
			CreatedAt:      insight.CreatedAt,
			ExpiresAt:      insight.ExpiresAt,
			UserFeedback:   insight.UserFeedback,
			UserCorrection: insight.UserCorrection,
			AllowedEffects: insight.AllowedEffects,
			IsStable:       insight.IsStable,
			Metadata:       insight.Metadata,
		}
	}

	JSONResponse(w, http.StatusOK, response)
}

// GetInsight 获取单个洞察详情
func (h *DNAHandler) GetInsight(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(auth.UserIDKey).(string)
	uid, err := uuid.Parse(userID)
	if err != nil {
		JSONError(w, http.StatusBadRequest, "INVALID_USER_ID", "Invalid user ID format")
		return
	}

	// 获取 insight ID
	insightIDStr := r.PathValue("id")
	insightID, err := uuid.Parse(insightIDStr)
	if err != nil {
		JSONError(w, http.StatusBadRequest, "INVALID_INSIGHT_ID", "Invalid insight ID format")
		return
	}

	// 获取洞察
	insight, err := h.queries.GetDNAInsight(r.Context(), insightID)
	if err != nil {
		JSONError(w, http.StatusNotFound, "INSIGHT_NOT_FOUND", "Insight not found")
		return
	}

	// 验证权限
	if insight.UserID != uid {
		JSONError(w, http.StatusForbidden, "FORBIDDEN", "You don't have access to this insight")
		return
	}

	response := DNAInsightResponse{
		ID:             insight.ID,
		Category:       insight.Category,
		Title:          insight.Title,
		Description:    insight.Description,
		EvidenceCount:  insight.EvidenceCount,
		Confidence:     insight.Confidence,
		Scope:          insight.Scope,
		CreatedAt:      insight.CreatedAt,
		ExpiresAt:      insight.ExpiresAt,
		UserFeedback:   insight.UserFeedback,
		UserCorrection: insight.UserCorrection,
		AllowedEffects: insight.AllowedEffects,
		IsStable:       insight.IsStable,
		Metadata:       insight.Metadata,
	}

	JSONResponse(w, http.StatusOK, response)
}

// SubmitFeedback 提交用户对洞察的反馈
func (h *DNAHandler) SubmitFeedback(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(auth.UserIDKey).(string)
	uid, err := uuid.Parse(userID)
	if err != nil {
		JSONError(w, http.StatusBadRequest, "INVALID_USER_ID", "Invalid user ID format")
		return
	}

	// 获取 insight ID
	insightIDStr := r.PathValue("id")
	insightID, err := uuid.Parse(insightIDStr)
	if err != nil {
		JSONError(w, http.StatusBadRequest, "INVALID_INSIGHT_ID", "Invalid insight ID format")
		return
	}

	// 验证请求体
	var req FeedbackRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		JSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}

	// 验证反馈类型
	if req.Feedback != "confirmed" && req.Feedback != "rejected" && req.Feedback != "corrected" {
		JSONError(w, http.StatusBadRequest, "INVALID_FEEDBACK", "Feedback must be 'confirmed', 'rejected', or 'corrected'")
		return
	}

	// 如果是 corrected，必须提供修正内容
	if req.Feedback == "corrected" && req.Correction == nil {
		JSONError(w, http.StatusBadRequest, "MISSING_CORRECTION", "Correction is required when feedback is 'corrected'")
		return
	}

	// 获取洞察
	insight, err := h.queries.GetDNAInsight(r.Context(), insightID)
	if err != nil {
		JSONError(w, http.StatusNotFound, "INSIGHT_NOT_FOUND", "Insight not found")
		return
	}

	// 验证权限
	if insight.UserID != uid {
		JSONError(w, http.StatusForbidden, "FORBIDDEN", "You don't have access to this insight")
		return
	}

	// 更新反馈
	err = h.queries.UpdateDNAInsightFeedback(r.Context(), db.UpdateDNAInsightFeedbackParams{
		ID:             insightID,
		UserFeedback:   req.Feedback,
		UserCorrection: req.Correction,
	})
	if err != nil {
		JSONError(w, http.StatusInternalServerError, "DB_ERROR", "Failed to update feedback")
		return
	}

	JSONResponse(w, http.StatusOK, map[string]string{"status": "updated"})
}

// DeleteInsight 删除洞察
func (h *DNAHandler) DeleteInsight(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(auth.UserIDKey).(string)
	uid, err := uuid.Parse(userID)
	if err != nil {
		JSONError(w, http.StatusBadRequest, "INVALID_USER_ID", "Invalid user ID format")
		return
	}

	// 获取 insight ID
	insightIDStr := r.PathValue("id")
	insightID, err := uuid.Parse(insightIDStr)
	if err != nil {
		JSONError(w, http.StatusBadRequest, "INVALID_INSIGHT_ID", "Invalid insight ID format")
		return
	}

	// 获取洞察
	insight, err := h.queries.GetDNAInsight(r.Context(), insightID)
	if err != nil {
		JSONError(w, http.StatusNotFound, "INSIGHT_NOT_FOUND", "Insight not found")
		return
	}

	// 验证权限
	if insight.UserID != uid {
		JSONError(w, http.StatusForbidden, "FORBIDDEN", "You don't have access to this insight")
		return
	}

	// 删除洞察
	err = h.queries.DeleteDNAInsight(r.Context(), insightID)
	if err != nil {
		JSONError(w, http.StatusInternalServerError, "DB_ERROR", "Failed to delete insight")
		return
	}

	JSONResponse(w, http.StatusOK, map[string]string{"status": "deleted"})
}
