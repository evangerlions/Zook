package api

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/lighttick/lighttick-backend/internal/auth"
	"github.com/lighttick/lighttick-backend/internal/ai"
	"github.com/lighttick/lighttick-backend/internal/db"
	"github.com/lighttick/lighttick-backend/internal/rate"
	"github.com/lighttick/lighttick-backend/pkg/types"
)

// PlanHandler handles plan CRUD and AI generation
type PlanHandler struct {
	queries      *db.Queries
	aiService    *ai.Service
	costTracker  *rate.CostTracker
	validator    *ai.ConstraintValidator
}

// NewPlanHandler creates a new plan handler
func NewPlanHandler(queries *db.Queries, aiService *ai.Service, costTracker *rate.CostTracker) *PlanHandler {
	return &PlanHandler{
		queries:     queries,
		aiService:   aiService,
		costTracker: costTracker,
		validator:   ai.DefaultValidator(),
	}
}

// GenerateMonth handles POST /api/v1/plans/month
func (h *PlanHandler) GenerateMonth(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(auth.UserIDKey).(string)

	var req struct {
		GoalID          int64  `json:"goal_id"`
		MonthIndex      int    `json:"month_index"`
		GoalTitle       string `json:"goal_title"`
		CurrentLevel    string `json:"current_level"`
		WeeklyHours     int    `json:"weekly_hours"`
		LearningPace    string `json:"learning_pace"`
		Motivation      string `json:"motivation"`
		PreviousSummary string `json:"previous_summary"` // summary from prior month
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		JSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid JSON body")
		return
	}

	if req.GoalID <= 0 || req.MonthIndex <= 0 {
		JSONError(w, http.StatusBadRequest, "MISSING_FIELD", "goal_id and month_index are required")
		return
	}

	// Build AI prompt
	systemPrompt := buildMonthSystemPrompt()
	userPrompt := buildMonthUserPrompt(req)

	// Generate with fallback
	result := h.aiService.GenerateWithFallback(r.Context(), systemPrompt, userPrompt, monthPlanSchema())

	if !result.Success {
		log.Printf("plan: ai generation failed, returning template for user=%s goal=%d", userID, req.GoalID)
		// Return template fallback
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"source":  "template",
			"plan":    buildTemplateMonthPlan(req),
			"warning": "AI generation unavailable, using template plan",
		})
		return
	}

	// Validate constraints
	validationResult := h.validator.Validate(result.Plan)
	if !validationResult.Valid {
		log.Printf("plan: constraint validation failed: %s", validationResult.Reason)
		JSONError(w, http.StatusBadRequest, "PLAN_VALIDATION_ERROR", validationResult.Reason)
		return
	}

	// TODO: Save to DB
	// - Create month_plans row
	// - Create week_plans rows
	// - Create tasks rows

	// Record cost
	if usage, ok := result.Plan["_usage"].(map[string]interface{}); ok {
		inputTokens := int(usage["input_tokens"].(float64))
		outputTokens := int(usage["output_tokens"].(float64))
		h.costTracker.RecordUsage(r.Context(), userID, rate.UsageResult{
			InputTokens:  inputTokens,
			OutputTokens: outputTokens,
			CostCents:    ai.EstimateCost(inputTokens, outputTokens),
		})
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"source": result.Source,
		"plan":   result.Plan,
	})
}

// GenerateWeek handles POST /api/v1/plans/week
func (h *PlanHandler) GenerateWeek(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(auth.UserIDKey).(string)

	var req struct {
		MonthPlanID int64  `json:"month_plan_id"`
		WeekIndex   int    `json:"week_index"`
		MonthGoal   string `json:"month_goal"`
		WeekGoal    string `json:"week_goal"`
		WeeklyHours int    `json:"weekly_hours"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		JSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid JSON body")
		return
	}

	if req.MonthPlanID <= 0 || req.WeekIndex <= 0 {
		JSONError(w, http.StatusBadRequest, "MISSING_FIELD", "month_plan_id and week_index are required")
		return
	}

	systemPrompt := buildWeekSystemPrompt()
	userPrompt := buildWeekUserPrompt(req)

	result := h.aiService.GenerateWithFallback(r.Context(), systemPrompt, userPrompt, weekPlanSchema())

	if !result.Success {
		log.Printf("plan: week ai generation failed, returning template")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"source":  "template",
			"plan":    buildTemplateWeekPlan(req),
			"warning": "AI generation unavailable, using template plan",
		})
		return
	}

	validationResult := h.validator.Validate(result.Plan)
	if !validationResult.Valid {
		JSONError(w, http.StatusBadRequest, "PLAN_VALIDATION_ERROR", validationResult.Reason)
		return
	}

	// TODO: Save week_plans and tasks to DB

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"source": result.Source,
		"plan":   result.Plan,
	})
}

// GenerateDay handles POST /api/v1/plans/day
func (h *PlanHandler) GenerateDay(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(auth.UserIDKey).(string)

	var req struct {
		WeekPlanID int64  `json:"week_plan_id"`
		Date       string `json:"date"` // YYYY-MM-DD
		DayOfWeek  string `json:"day_of_week"`
		AvailableMinutes int `json:"available_minutes"` // how much time available today
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		JSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid JSON body")
		return
	}

	if req.WeekPlanID <= 0 || req.Date == "" {
		JSONError(w, http.StatusBadRequest, "MISSING_FIELD", "week_plan_id and date are required")
		return
	}

	systemPrompt := buildDaySystemPrompt()
	userPrompt := buildDayUserPrompt(req)

	result := h.aiService.GenerateWithFallback(r.Context(), systemPrompt, userPrompt, dayPlanSchema())

	if !result.Success {
		log.Printf("plan: day ai generation failed")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"source":  "template",
			"plan":    buildTemplateDayPlan(req),
			"warning": "AI generation unavailable, using template plan",
		})
		return
	}

	// TODO: Update task statuses for the day

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"source": result.Source,
		"plan":   result.Plan,
	})
}

// Get handles GET /api/v1/plans/{id}
func (h *PlanHandler) Get(w http.ResponseWriter, r *http.Request) {
	planID := chi.URLParam(r, "id")
	userID := r.Context().Value(auth.UserIDKey).(string)
	_ = userID
	_ = planID

	// TODO: Query plan from DB with weeks and tasks

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "not_implemented",
	})
}

// Replan handles POST /api/v1/plans/replan
func (h *PlanHandler) Replan(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(auth.UserIDKey).(string)

	var req struct {
		WeekPlanID   int64    `json:"week_plan_id"`
		CompletedTasks []int64 `json:"completed_tasks"`
		SkippedTasks   []int64 `json:"skipped_tasks"`
		SkipReasons    map[int64]string `json:"skip_reasons"`
		RemainingTime  int    `json:"remaining_minutes"` // time left this week
		Mood           string `json:"mood"` // user's current mood/energy
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		JSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid JSON body")
		return
	}

	if req.WeekPlanID <= 0 {
		JSONErrorWithField(w, http.StatusBadRequest, "MISSING_FIELD", "week_plan_id is required", "week_plan_id")
		return
	}

	systemPrompt := buildReplanSystemPrompt()
	userPrompt := buildReplanUserPrompt(req)

	result := h.aiService.GenerateWithFallback(r.Context(), systemPrompt, userPrompt, replanSchema())

	if !result.Success {
		log.Printf("plan: replan ai generation failed")
		JSONError(w, http.StatusInternalServerError, "AI_GENERATION_FAILED", "AI replan generation failed")
		return
	}

	// TODO: Update tasks in DB with new schedule

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"source": result.Source,
		"plan":   result.Plan,
	})
}

// WeeklyWin handles GET /api/v1/summary/weekly
func (h *PlanHandler) WeeklyWin(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(auth.UserIDKey).(string)
	_ = userID

	// TODO: Query completion history for the week
	// Calculate win rate, streaks, etc.

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"week_start":     time.Now().AddDate(0, 0, -7).Format("2006-01-02"),
		"tasks_completed": 0,
		"tasks_skipped":   0,
		"win_rate":        0.0,
		"streak_days":     0,
		"summary":         "not implemented yet",
	})
}

// OnboardingComplete handles POST /api/v1/onboarding/complete
// Bridges the signup-to-first-plan gap: takes wizard inputs, creates goal, generates month plan
func (h *PlanHandler) OnboardingComplete(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(auth.UserIDKey).(string)

	var req struct {
		GoalTitle       string `json:"goal_title"`
		DurationMonths  int    `json:"duration_months"`
		CurrentLevel    string `json:"current_level"`
		WeeklyHours     int    `json:"weekly_hours"`
		LearningPace    string `json:"learning_pace"`
		Motivation      string `json:"motivation"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		JSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid JSON body")
		return
	}

	if req.GoalTitle == "" {
		JSONErrorWithField(w, http.StatusBadRequest, "MISSING_FIELD", "goal_title is required", "goal_title")
		return
	}

	if req.DurationMonths <= 0 {
		JSONErrorWithField(w, http.StatusBadRequest, "INVALID_VALUE", "duration_months must be positive", "duration_months")
		return
	}

	if req.WeeklyHours <= 0 || req.WeeklyHours > 168 {
		JSONErrorWithField(w, http.StatusBadRequest, "INVALID_VALUE", "weekly_hours must be between 1 and 168", "weekly_hours")
		return
	}

	// TODO: Step 1 - Create goal in DB
	// TODO: Step 2 - Generate month plan using AI (reuse GenerateMonth logic)
	// TODO: Step 3 - Return both goal and plan in response

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"goal_id":   0, // TODO
		"plan":      buildTemplateMonthPlan(struct {
			GoalID          int64  `json:"goal_id"`
			MonthIndex      int    `json:"month_index"`
			GoalTitle       string `json:"goal_title"`
			CurrentLevel    string `json:"current_level"`
			WeeklyHours     int    `json:"weekly_hours"`
			LearningPace    string `json:"learning_pace"`
			Motivation      string `json:"motivation"`
			PreviousSummary string `json:"previous_summary"`
		}{
			GoalTitle:    req.GoalTitle,
			DurationMonths: req.DurationMonths,
			CurrentLevel:  req.CurrentLevel,
			WeeklyHours:   req.WeeklyHours,
			LearningPace:  req.LearningPace,
			Motivation:    req.Motivation,
		}),
		"message": "welcome! your first plan is ready",
	})
}

// --- Prompt Builders ---

func buildMonthSystemPrompt() string {
	return `你是一个专业的学习计划设计师。你的任务是根据用户的目标和时间限制，设计一个30天的学习计划。

要求：
1. 计划必须具体、可执行
2. 每周有明确的里程碑
3. 考虑用户的学习节奏和可用时间
4. 输出必须是有效的 JSON

输出格式（JSON Schema）：
{
  "goal": "本月核心目标",
  "weeks": [
    {
      "week_index": 1,
      "goal": "本周目标",
      "milestone": "本周里程碑",
      "estimated_hours": 10,
      "tasks": [
        {
          "title": "任务标题",
          "duration_minutes": 30,
          "difficulty": "medium",
          "type": "study",
          "completion_criteria": "完成标准"
        }
      ]
    }
  ]
}`
}

func buildMonthUserPrompt(req struct {
	GoalID          int64  `json:"goal_id"`
	MonthIndex      int    `json:"month_index"`
	GoalTitle       string `json:"goal_title"`
	CurrentLevel    string `json:"current_level"`
	WeeklyHours     int    `json:"weekly_hours"`
	LearningPace    string `json:"learning_pace"`
	Motivation      string `json:"motivation"`
	PreviousSummary string `json:"previous_summary"`
}) string {
	prompt := "请为我设计学习计划：\n"
	prompt += "- 目标: " + req.GoalTitle + "\n"
	prompt += "- 当前水平: " + req.CurrentLevel + "\n"
	prompt += "- 每周可用时间: " + strconv.Itoa(req.WeeklyHours) + " 小时\n"
	prompt += "- 学习节奏: " + req.LearningPace + "\n"
	prompt += "- 动力: " + req.Motivation + "\n"
	if req.PreviousSummary != "" {
		prompt += "- 上月总结: " + req.PreviousSummary + "\n"
	}
	prompt += "- 这是第 " + strconv.Itoa(req.MonthIndex) + " 个月\n"
	return prompt
}

func buildWeekSystemPrompt() string {
	return `你是一个周计划设计师。根据用户的月度目标，设计一周的具体学习计划。

要求：
1. 每天的任务总时长不超过用户每周可用时间
2. 任务必须具体、可执行
3. 包含学习、练习、复习的混合
4. 输出必须是有效的 JSON`
}

func buildWeekUserPrompt(req struct {
	MonthPlanID int64  `json:"month_plan_id"`
	WeekIndex   int    `json:"week_index"`
	MonthGoal   string `json:"month_goal"`
	WeekGoal    string `json:"week_goal"`
	WeeklyHours int    `json:"weekly_hours"`
}) string {
	prompt := "请为我设计本周计划：\n"
	prompt += "- 月度目标: " + req.MonthGoal + "\n"
	prompt += "- 本周目标: " + req.WeekGoal + "\n"
	prompt += "- 每周可用时间: " + strconv.Itoa(req.WeeklyHours) + " 小时\n"
	return prompt
}

func buildDaySystemPrompt() string {
	return `你是一个日程安排师。根据用户今天的可用时间，从本周任务中选择并排列今天的任务。

要求：
1. 任务总时长不超过可用时间
2. 优先安排依赖关系靠前的任务
3. 考虑任务难度和精力分配`
}

func buildDayUserPrompt(req struct {
	WeekPlanID      int64  `json:"week_plan_id"`
	Date            string `json:"date"`
	DayOfWeek       string `json:"day_of_week"`
	AvailableMinutes int   `json:"available_minutes"`
}) string {
	prompt := "请为我安排今天的日程：\n"
	prompt += "- 日期: " + req.Date + " (" + req.DayOfWeek + ")\n"
	prompt += "- 可用时间: " + strconv.Itoa(req.AvailableMinutes) + " 分钟\n"
	return prompt
}

func buildReplanSystemPrompt() string {
	return `你是一个计划调整专家。用户本周完成了一些任务，跳过了一些任务。
根据完成情况和用户当前的状态，重新安排剩余任务的计划。

要求：
1. 保持本周目标不变
2. 考虑用户当前的心情和精力
3. 如果无法完成本周目标，给出 Plan B
4. 输出必须是有效的 JSON`
}

func buildReplanUserPrompt(req struct {
	WeekPlanID     int64    `json:"week_plan_id"`
	CompletedTasks []int64  `json:"completed_tasks"`
	SkippedTasks   []int64  `json:"skipped_tasks"`
	SkipReasons    map[int64]string `json:"skip_reasons"`
	RemainingTime  int    `json:"remaining_minutes"`
	Mood           string `json:"mood"`
}) string {
	prompt := "请帮我调整本周计划：\n"
	prompt += "- 已完成任务: " + strconv.Itoa(len(req.CompletedTasks)) + " 个\n"
	prompt += "- 已跳过任务: " + strconv.Itoa(len(req.SkippedTasks)) + " 个\n"
	prompt += "- 剩余可用时间: " + strconv.Itoa(req.RemainingTime) + " 分钟\n"
	prompt += "- 当前状态: " + req.Mood + "\n"
	return prompt
}

// --- Template Fallbacks ---

func buildTemplateMonthPlan(req struct {
	GoalID          int64  `json:"goal_id"`
	MonthIndex      int    `json:"month_index"`
	GoalTitle       string `json:"goal_title"`
	CurrentLevel    string `json:"current_level"`
	WeeklyHours     int    `json:"weekly_hours"`
	LearningPace    string `json:"learning_pace"`
	Motivation      string `json:"motivation"`
	PreviousSummary string `json:"previous_summary"`
}) map[string]interface{} {
	hoursPerWeek := req.WeeklyHours
	if hoursPerWeek <= 0 {
		hoursPerWeek = 10
	}

	tasks := []map[string]interface{}{
		{"title": "学习核心概念", "duration_minutes": 45, "difficulty": "medium", "type": "study", "completion_criteria": "完成笔记整理"},
		{"title": "练习题组 A", "duration_minutes": 30, "difficulty": "medium", "type": "practice", "completion_criteria": "正确率 70%+"},
		{"title": "复习错题", "duration_minutes": 20, "difficulty": "low", "type": "review", "completion_criteria": "整理错题本"},
		{"title": "小测验", "duration_minutes": 15, "difficulty": "high", "type": "quiz", "completion_criteria": "得分 80%+"},
	}

	weeks := make([]map[string]interface{}, 4)
	for i := 0; i < 4; i++ {
		weeks[i] = map[string]interface{}{
			"week_index":      i + 1,
			"goal":            "第" + strconv.Itoa(i+1) + "周学习目标",
			"milestone":       "第" + strconv.Itoa(i+1) + "周里程碑",
			"estimated_hours": hoursPerWeek,
			"tasks":           tasks,
		}
	}

	return map[string]interface{}{
		"goal":  req.GoalTitle,
		"weeks": weeks,
	}
}

func buildTemplateWeekPlan(req struct {
	MonthPlanID int64  `json:"month_plan_id"`
	WeekIndex   int    `json:"week_index"`
	MonthGoal   string `json:"month_goal"`
	WeekGoal    string `json:"week_goal"`
	WeeklyHours int    `json:"weekly_hours"`
}) map[string]interface{} {
	return map[string]interface{}{
		"weeks": []map[string]interface{}{
			{
				"week_index":      req.WeekIndex,
				"goal":            req.WeekGoal,
				"milestone":       "完成本周目标",
				"estimated_hours": req.WeeklyHours,
				"tasks": []map[string]interface{}{
					{"title": "学习内容", "duration_minutes": 45, "difficulty": "medium", "type": "study", "completion_criteria": "完成笔记"},
					{"title": "练习题", "duration_minutes": 30, "difficulty": "medium", "type": "practice", "completion_criteria": "正确率 70%+"},
					{"title": "复习总结", "duration_minutes": 20, "difficulty": "low", "type": "review", "completion_criteria": "整理重点"},
				},
			},
		},
	}
}

func buildTemplateDayPlan(req struct {
	WeekPlanID       int64  `json:"week_plan_id"`
	Date             string `json:"date"`
	DayOfWeek        string `json:"day_of_week"`
	AvailableMinutes int    `json:"available_minutes"`
}) map[string]interface{} {
	mins := req.AvailableMinutes
	if mins <= 0 {
		mins = 60
	}

	return map[string]interface{}{
		"date":     req.Date,
		"tasks": []map[string]interface{}{
			{"title": "学习", "duration_minutes": mins / 2, "type": "study"},
			{"title": "练习", "duration_minutes": mins / 3, "type": "practice"},
			{"title": "复习", "duration_minutes": mins / 6, "type": "review"},
		},
	}
}

// --- JSON Schemas ---

func monthPlanSchema() string {
	return `{
		"type": "object",
		"required": ["goal", "weeks"],
		"properties": {
			"goal": {"type": "string"},
			"weeks": {
				"type": "array",
				"items": {
					"type": "object",
					"required": ["week_index", "goal", "milestone", "estimated_hours", "tasks"],
					"properties": {
						"week_index": {"type": "integer", "minimum": 1, "maximum": 4},
						"goal": {"type": "string"},
						"milestone": {"type": "string"},
						"estimated_hours": {"type": "integer", "minimum": 1},
						"tasks": {
							"type": "array",
							"items": {
								"type": "object",
								"required": ["title", "duration_minutes", "difficulty", "type", "completion_criteria"],
								"properties": {
									"title": {"type": "string"},
									"duration_minutes": {"type": "integer", "minimum": 5, "maximum": 120},
									"difficulty": {"type": "string", "enum": ["low", "medium", "high"]},
									"type": {"type": "string", "enum": ["study", "practice", "project", "review", "quiz"]},
									"completion_criteria": {"type": "string"}
								}
							}
						}
					}
				}
			}
		}
	}`
}

func weekPlanSchema() string {
	return monthPlanSchema()
}

func dayPlanSchema() string {
	return `{
		"type": "object",
		"required": ["date", "tasks"],
		"properties": {
			"date": {"type": "string"},
			"tasks": {
				"type": "array",
				"items": {
					"type": "object",
					"required": ["title", "duration_minutes", "type"],
					"properties": {
						"title": {"type": "string"},
						"duration_minutes": {"type": "integer", "minimum": 5, "maximum": 120},
						"type": {"type": "string", "enum": ["study", "practice", "project", "review", "quiz"]}
					}
				}
			}
		}
	}`
}

func replanSchema() string {
	return `{
		"type": "object",
		"required": ["plan_b", "tasks"],
		"properties": {
			"plan_b": {"type": "boolean"},
			"reason": {"type": "string"},
			"tasks": {
				"type": "array",
				"items": {
					"type": "object",
					"required": ["task_id", "new_date", "new_status"],
					"properties": {
						"task_id": {"type": "integer"},
						"new_date": {"type": "string"},
						"new_status": {"type": "string", "enum": ["pending", "active", "deferred"]}
					}
				}
			}
		}
	}`
}
