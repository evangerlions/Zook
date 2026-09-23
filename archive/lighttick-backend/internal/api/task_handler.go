package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/lighttick/lighttick-backend/internal/auth"
	"github.com/lighttick/lighttick-backend/internal/db"
	"github.com/lighttick/lighttick-backend/pkg/types"
)

// TaskHandler handles task operations
type TaskHandler struct {
	queries *db.Queries
}

// NewTaskHandler creates a new task handler
func NewTaskHandler(queries *db.Queries) *TaskHandler {
	return &TaskHandler{queries: queries}
}

// Complete handles POST /api/v1/tasks/{id}/complete
func (h *TaskHandler) Complete(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(auth.UserIDKey).(string)
	taskID := chi.URLParam(r, "id")

	var req struct {
		CompletionCriteria string `json:"completion_criteria"`
		Notes              string `json:"notes"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		JSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid JSON body")
		return
	}

	// TODO: Update task status to completed
	// TODO: Append to completion_history
	// TODO: Check if all tasks in week are done -> trigger weekly summary

	_ = userID
	_ = taskID
	_ = req

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "completed",
		"task_id":   taskID,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

// Skip handles POST /api/v1/tasks/{id}/skip
func (h *TaskHandler) Skip(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(auth.UserIDKey).(string)
	taskID := chi.URLParam(r, "id")

	var req struct {
		Reason string `json:"reason"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		JSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid JSON body")
		return
	}

	if req.Reason == "" {
		JSONErrorWithField(w, http.StatusBadRequest, "MISSING_FIELD", "reason is required", "reason")
		return
	}

	// TODO: Update task status to skipped with reason
	// TODO: Append to completion_history

	_ = userID

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "skipped",
		"task_id":   taskID,
		"reason":    req.Reason,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

// Defer handles POST /api/v1/tasks/{id}/defer
func (h *TaskHandler) Defer(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(auth.UserIDKey).(string)
	taskID := chi.URLParam(r, "id")

	var req struct {
		NewDate string `json:"new_date"` // YYYY-MM-DD
		Reason  string `json:"reason"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		JSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid JSON body")
		return
	}

	if req.NewDate == "" {
		JSONErrorWithField(w, http.StatusBadRequest, "MISSING_FIELD", "new_date is required", "new_date")
		return
	}

	// TODO: Update task status to deferred, increment reschedule_count
	// TODO: Append to completion_history

	_ = userID

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "deferred",
		"task_id":   taskID,
		"new_date":  req.NewDate,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

// ListByWeek handles GET /api/v1/tasks/week/{weekId}
func (h *TaskHandler) ListByWeek(w http.ResponseWriter, r *http.Request) {
	weekID := chi.URLParam(r, "weekId")

	// Optional query param for status filter
	status := r.URL.Query().Get("status")
	_ = status

	// TODO: Query tasks for this week from DB
	// If status filter provided, filter by status

	_ = weekID

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode([]types.Task{})
}
