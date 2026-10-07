package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/lighttick/lighttick-backend/internal/auth"
	"github.com/lighttick/lighttick-backend/internal/db"
)

// GoalHandler handles goal CRUD operations
type GoalHandler struct {
	queries *db.Queries
}

// NewGoalHandler creates a new goal handler
func NewGoalHandler(queries *db.Queries) *GoalHandler {
	return &GoalHandler{queries: queries}
}

// Create handles POST /api/v1/goals
func (h *GoalHandler) Create(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(auth.UserIDKey).(string)

	var req struct {
		Title             string `json:"title"`
		Description       string `json:"description"`
		DurationMonths    int    `json:"duration_months"`
		CurrentLevel      string `json:"current_level"`
		WeeklyHours       int    `json:"weekly_hours"`
		LearningPace      string `json:"learning_pace"`
		MotivationStatement string `json:"motivation_statement"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		JSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid JSON body")
		return
	}

	if req.Title == "" {
		JSONErrorWithField(w, http.StatusBadRequest, "MISSING_FIELD", "title is required", "title")
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

	// TODO: Insert into DB
	_ = userID

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"status": "created"})
}

// List handles GET /api/v1/goals?limit=20&cursor=...
func (h *GoalHandler) List(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(auth.UserIDKey).(string)

	// Parse pagination params
	limitStr := r.URL.Query().Get("limit")
	cursor := r.URL.Query().Get("cursor")

	limit := 20 // default
	if limitStr != "" {
		if n, err := strconv.Atoi(limitStr); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}

	// Optional status filter
	status := r.URL.Query().Get("status")
	_ = status // TODO: filter by status

	// TODO: Query from DB with pagination
	// If cursor provided, get rows after cursor
	// Return next cursor if more results

	_ = userID
	_ = cursor

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"data":   []interface{}{},
		"meta": map[string]interface{}{
			"total":  0,
			"limit":  limit,
			"cursor": cursor,
			"next":   "", // empty means no more results
		},
	})
}

// Get handles GET /api/v1/goals/{id}
func (h *GoalHandler) Get(w http.ResponseWriter, r *http.Request) {
	goalID := chi.URLParam(r, "id")
	userID := r.Context().Value(auth.UserIDKey).(string)
	_ = goalID
	_ = userID

	// TODO: Query from DB
	// If not found, return 404:
	// JSONError(w, http.StatusNotFound, "NOT_FOUND", "goal not found")
	// If found but user doesn't own it, return 403:
	// JSONError(w, http.StatusForbidden, "FORBIDDEN", "you do not have access to this goal")

	JSONError(w, http.StatusNotFound, "NOT_FOUND", "goal not found")
}

// Update handles PUT /api/v1/goals/{id}
func (h *GoalHandler) Update(w http.ResponseWriter, r *http.Request) {
	goalID := chi.URLParam(r, "id")
	userID := r.Context().Value(auth.UserIDKey).(string)

	var req struct {
		Title             string `json:"title"`
		Description       string `json:"description"`
		DurationMonths    int    `json:"duration_months"`
		CurrentLevel      string `json:"current_level"`
		WeeklyHours       int    `json:"weekly_hours"`
		LearningPace      string `json:"learning_pace"`
		MotivationStatement string `json:"motivation_statement"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		JSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid JSON body")
		return
	}

	if req.Title == "" {
		JSONErrorWithField(w, http.StatusBadRequest, "MISSING_FIELD", "title is required", "title")
		return
	}

	// TODO: Update goal in DB (verify ownership via userID)

	_ = goalID
	_ = userID

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "updated"})
}

// Delete handles DELETE /api/v1/goals/{id}
func (h *GoalHandler) Delete(w http.ResponseWriter, r *http.Request) {
	goalID := chi.URLParam(r, "id")
	userID := r.Context().Value(auth.UserIDKey).(string)

	// TODO: Delete goal from DB (verify ownership, cascade to plans/tasks)

	_ = goalID
	_ = userID

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})
}
