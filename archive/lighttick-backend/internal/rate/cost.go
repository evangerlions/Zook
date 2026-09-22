package rate

import (
	"context"
	"log"
	"sync"
	"time"

	"github.com/lighttick/lighttick-backend/internal/db"
)

// CostTracker tracks AI usage per user per week
type CostTracker struct {
	queries *db.Queries
	mu      sync.Mutex
}

// NewCostTracker creates a new cost tracker
func NewCostTracker(queries *db.Queries) *CostTracker {
	return &CostTracker{queries: queries}
}

// UsageResult holds token usage data
type UsageResult struct {
	InputTokens  int
	OutputTokens int
	CostCents    int64
}

// RecordUsage records AI usage for a user
func (t *CostTracker) RecordUsage(ctx context.Context, userID string, usage UsageResult) error {
	t.mu.Lock()
	defer t.mu.Unlock()

	// Get current week start (Monday)
	now := time.Now()
	weekday := now.Weekday()
	if weekday == time.Sunday {
		weekday = 7
	}
	weekStart := now.AddDate(0, 0, -(int(weekday) - 1))
	weekStart = time.Date(weekStart.Year(), weekStart.Month(), weekStart.Day(), 0, 0, 0, 0, now.Location())

	// TODO: Implement upsert via sqlc queries
	// For now, just log
	log.Printf("cost_tracker: user=%s week=%s input=%d output=%d cost=%dc",
		userID, weekStart.Format("2006-01-02"), usage.InputTokens, usage.OutputTokens, usage.CostCents)

	return nil
}

// GetWeeklyUsage returns the current week's usage for a user
func (t *CostTracker) GetWeeklyUsage(ctx context.Context, userID string) (int64, error) {
	// TODO: Query from DB
	return 0, nil
}

// IsUnderCap checks if the user is under their weekly cost cap
func (t *CostTracker) IsUnderCap(ctx context.Context, userID string, capCents int) (bool, error) {
	// TODO: Query from DB
	return true, nil
}
