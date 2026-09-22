package api

import (
	"encoding/json"
	"net/http"

	"github.com/lighttick/lighttick-backend/internal/auth"
	"github.com/lighttick/lighttick-backend/internal/db"
)

// CalendarHandler handles calendar integration (Phase 2)
type CalendarHandler struct {
	queries *db.Queries
}

// NewCalendarHandler creates a new calendar handler
func NewCalendarHandler(queries *db.Queries) *CalendarHandler {
	return &CalendarHandler{queries: queries}
}

// Connect handles POST /api/v1/calendar/connect
// Initiates OAuth flow for calendar integration
func (h *CalendarHandler) Connect(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(auth.UserIDKey).(string)

	var req struct {
		Provider string `json:"provider"` // google/apple
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		JSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid JSON body")
		return
	}

	if req.Provider != "google" && req.Provider != "apple" {
		JSONErrorWithField(w, http.StatusBadRequest, "INVALID_VALUE", "provider must be 'google' or 'apple'", "provider")
		return
	}

	// TODO: Phase 2 - Initiate OAuth flow
	// 1. Generate OAuth state/nonce
	// 2. Return OAuth URL for client to redirect to
	// 3. Store state in session/cache

	_ = userID

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":     "oauth_url_ready",
		"provider":   req.Provider,
		"oauth_url":  "", // TODO: actual OAuth URL
		"state":      "", // TODO: CSRF state
	})
}

// Callback handles GET /api/v1/calendar/callback?code=...&state=...
// Receives OAuth callback and stores calendar token
func (h *CalendarHandler) Callback(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(auth.UserIDKey).(string)

	code := r.URL.Query().Get("code")
	state := r.URL.Query().Get("state")

	if code == "" {
		JSONErrorWithField(w, http.StatusBadRequest, "MISSING_FIELD", "code query param is required", "code")
		return
	}

	if state == "" {
		JSONErrorWithField(w, http.StatusBadRequest, "MISSING_FIELD", "state query param is required", "state")
		return
	}

	// TODO: Phase 2 - Exchange code for token
	// 1. Validate state matches session
	// 2. Exchange code for access + refresh token
	// 3. Store encrypted token in DB
	// 4. Start initial calendar sync

	_ = userID

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status": "connected",
	})
}

// Disconnect handles DELETE /api/v1/calendar
// Removes calendar integration for the user
func (h *CalendarHandler) Disconnect(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(auth.UserIDKey).(string)

	// TODO: Phase 2 - Revoke token and delete from DB

	_ = userID

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status": "disconnected",
	})
}

// Status handles GET /api/v1/calendar/status
// Returns current calendar integration status
func (h *CalendarHandler) Status(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(auth.UserIDKey).(string)

	// TODO: Phase 2 - Query calendar connection status from DB

	_ = userID

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"connected":      false,
		"provider":       "",
		"last_sync":      "",
		"next_sync":      "",
		"sync_status":    "not_connected", // not_connected | syncing | synced | error
		"calendar_email": "",
	})
}
