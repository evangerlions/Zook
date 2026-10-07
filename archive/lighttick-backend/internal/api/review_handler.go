package api

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"

	"github.com/lighttick/lighttick-backend/internal/ai"
	"github.com/lighttick/lighttick-backend/internal/auth"
	"github.com/lighttick/lighttick-backend/internal/db"
)

// ReviewHandler handles weekly and monthly review generation
type ReviewHandler struct {
	queries   *db.Queries
	aiService *ai.Service
}

// NewReviewHandler creates a new review handler
func NewReviewHandler(queries *db.Queries, aiService *ai.Service) *ReviewHandler {
	return &ReviewHandler{queries: queries, aiService: aiService}
}

// Weekly handles POST /api/v1/review/weekly
func (h *ReviewHandler) Weekly(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(auth.UserIDKey).(string)

	var req struct {
		GoalID         int64    `json:"goal_id"`
		MonthPlanID    int64    `json:"month_plan_id"`
		WeekPlanIDs    []int64  `json:"week_plan_ids"`
		CompletedCount int      `json:"completed_count"`
		SkippedCount   int      `json:"skipped_count"`
		SkipReasons    []string `json:"skip_reasons"`
		TotalMinutes   int      `json:"total_minutes"`
		Mood           string   `json:"mood"`
		SelfReflection string   `json:"self_reflection"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		JSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid JSON body")
		return
	}

	if req.GoalID <= 0 {
		JSONErrorWithField(w, http.StatusBadRequest, "MISSING_FIELD", "goal_id is required", "goal_id")
		return
	}

	// Build AI review prompt
	systemPrompt := buildWeeklyReviewSystemPrompt()
	userPrompt := buildWeeklyReviewUserPrompt(req)

	result := h.aiService.GenerateWithFallback(r.Context(), systemPrompt, userPrompt, weeklyReviewSchema())

	if !result.Success {
		log.Printf("review: weekly ai generation failed for user=%s", userID)
		JSONError(w, http.StatusInternalServerError, "AI_GENERATION_FAILED", "AI review generation failed")
		return
	}

	// TODO: Save review to DB
	// TODO: Generate next week recommendations
	// TODO: Update behavioral learning profile

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"source": result.Source,
		"review": result.Plan,
	})
}

// Monthly handles POST /api/v1/review/monthly
func (h *ReviewHandler) Monthly(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(auth.UserIDKey).(string)

	var req struct {
		GoalID           int64 `json:"goal_id"`
		MonthPlanID      int64 `json:"month_plan_id"`
		WeeksCompleted   int   `json:"weeks_completed"`
		TotalTasksDone   int   `json:"total_tasks_done"`
		TotalTasksPlanned int  `json:"total_tasks_planned"`
		MonthSummary     string `json:"month_summary"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		JSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid JSON body")
		return
	}

	if req.GoalID <= 0 || req.MonthPlanID <= 0 {
		JSONError(w, http.StatusBadRequest, "MISSING_FIELD", "goal_id and month_plan_id are required")
		return
	}

	systemPrompt := buildMonthlyReviewSystemPrompt()
	userPrompt := buildMonthlyReviewUserPrompt(req)

	result := h.aiService.GenerateWithFallback(r.Context(), systemPrompt, userPrompt, monthlyReviewSchema())

	if !result.Success {
		log.Printf("review: monthly ai generation failed for user=%s", userID)
		JSONError(w, http.StatusInternalServerError, "AI_GENERATION_FAILED", "AI review generation failed")
		return
	}

	// TODO: Save monthly review to DB
	// TODO: Use review summary as input for next month's plan

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"source": result.Source,
		"review": result.Plan,
	})
}

// --- Prompt Builders ---

func buildWeeklyReviewSystemPrompt() string {
	return `你是一个学习教练。用户刚刚完成了一周的学习，请根据完成情况给出周复盘。

要求：
1. 肯定用户的努力和完成的任务
2. 分析跳过任务的原因模式
3. 给出下周的改进建议
4. 如果完成率低于 50%，给出 Plan B 建议
5. 输出必须是有效的 JSON

输出格式：
{
  "week_summary": "本周总结",
  "win_rate": 0.75,
  "tasks_completed": 15,
  "tasks_skipped": 5,
  "strengths": ["优点1", "优点2"],
  "areas_for_improvement": ["改进点1"],
  "skip_pattern_analysis": "跳过任务的模式分析",
  "next_week_recommendations": ["建议1", "建议2"],
  "encouragement": "鼓励的话",
  "plan_b_suggested": false
}`
}

func buildWeeklyReviewUserPrompt(req struct {
	GoalID         int64    `json:"goal_id"`
	MonthPlanID    int64    `json:"month_plan_id"`
	WeekPlanIDs    []int64  `json:"week_plan_ids"`
	CompletedCount int      `json:"completed_count"`
	SkippedCount   int      `json:"skip_count"`
	SkipReasons    []string `json:"skip_reasons"`
	TotalMinutes   int      `json:"total_minutes"`
	Mood           string   `json:"mood"`
	SelfReflection string   `json:"self_reflection"`
}) string {
	total := req.CompletedCount + req.SkippedCount
	winRate := 0.0
	if total > 0 {
		winRate = float64(req.CompletedCount) / float64(total)
	}

	prompt := "请帮我做周复盘：\n"
	prompt += "- 完成任务: " + itoa(req.CompletedCount) + " 个\n"
	prompt += "- 跳过任务: " + itoa(req.SkippedCount) + " 个\n"
	prompt += "- 完成率: " + ftoa(winRate*100) + "%\n"
	prompt += "- 总学习时长: " + itoa(req.TotalMinutes) + " 分钟\n"
	if len(req.SkipReasons) > 0 {
		prompt += "- 跳过原因: " + joinStrings(req.SkipReasons, ", ") + "\n"
	}
	if req.Mood != "" {
		prompt += "- 本周状态: " + req.Mood + "\n"
	}
	if req.SelfReflection != "" {
		prompt += "- 自我反思: " + req.SelfReflection + "\n"
	}
	return prompt
}

func buildMonthlyReviewSystemPrompt() string {
	return `你是一个学习教练。用户完成了一个月的学习计划，请给出月度复盘。

要求：
1. 总结本月的学习成果
2. 评估目标进度
3. 分析学习节奏是否合适
4. 给出下月的调整建议
5. 输出必须是有效的 JSON

输出格式：
{
  "month_summary": "月度总结",
  "goal_progress_percent": 35,
  "total_tasks_completed": 60,
  "total_tasks_planned": 80,
  "learning_pace_assessment": "节奏评估",
  "next_month_adjustments": ["调整1", "调整2"],
  "motivation_message": "鼓励信息"
}`
}

func buildMonthlyReviewUserPrompt(req struct {
	GoalID            int64  `json:"goal_id"`
	MonthPlanID       int64  `json:"month_plan_id"`
	WeeksCompleted    int    `json:"weeks_completed"`
	TotalTasksDone    int    `json:"total_tasks_done"`
	TotalTasksPlanned int    `json:"total_tasks_planned"`
	MonthSummary      string `json:"month_summary"`
}) string {
	prompt := "请帮我做月度复盘：\n"
	prompt += "- 完成周数: " + itoa(req.WeeksCompleted) + " 周\n"
	prompt += "- 完成任务: " + itoa(req.TotalTasksDone) + " / " + itoa(req.TotalTasksPlanned) + " 个\n"
	if req.MonthSummary != "" {
		prompt += "- 月度总结: " + req.MonthSummary + "\n"
	}
	return prompt
}

// --- JSON Schemas ---

func weeklyReviewSchema() string {
	return `{
		"type": "object",
		"required": ["week_summary", "win_rate", "tasks_completed", "tasks_skipped"],
		"properties": {
			"week_summary": {"type": "string"},
			"win_rate": {"type": "number"},
			"tasks_completed": {"type": "integer"},
			"tasks_skipped": {"type": "integer"},
			"strengths": {"type": "array", "items": {"type": "string"}},
			"areas_for_improvement": {"type": "array", "items": {"type": "string"}},
			"skip_pattern_analysis": {"type": "string"},
			"next_week_recommendations": {"type": "array", "items": {"type": "string"}},
			"encouragement": {"type": "string"},
			"plan_b_suggested": {"type": "boolean"}
		}
	}`
}

func monthlyReviewSchema() string {
	return `{
		"type": "object",
		"required": ["month_summary", "goal_progress_percent"],
		"properties": {
			"month_summary": {"type": "string"},
			"goal_progress_percent": {"type": "integer"},
			"total_tasks_completed": {"type": "integer"},
			"total_tasks_planned": {"type": "integer"},
			"learning_pace_assessment": {"type": "string"},
			"next_month_adjustments": {"type": "array", "items": {"type": "string"}},
			"motivation_message": {"type": "string"}
		}
	}`
}

// --- Helpers ---

func itoa(n int) string {
	return strconv.Itoa(n)
}

func ftoa(f float64) string {
	return strconv.Itoa(int(f))
}

func joinStrings(ss []string, sep string) string {
	result := ""
	for i, s := range ss {
		if i > 0 {
			result += sep
		}
		result += s
	}
	return result
}
