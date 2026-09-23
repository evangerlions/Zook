package db

import (
	"context"
	"time"

	"github.com/google/uuid"
)

type TaskStats struct {
	TotalTasks     int `json:"total_tasks"`
	CompletedTasks int `json:"completed_tasks"`
	SkippedTasks   int `json:"skipped_tasks"`
	TotalMinutes   int `json:"total_minutes"`
}

type GetTaskStatsByDateRangeParams struct {
	UserID    uuid.UUID
	StartDate time.Time
	EndDate   time.Time
}

func (q *Queries) GetTaskStatsByDateRange(ctx context.Context, arg GetTaskStatsByDateRangeParams) (TaskStats, error) {
	query := `
		SELECT 
			COUNT(*) as total_tasks,
			COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_tasks,
			COUNT(CASE WHEN status = 'skipped' THEN 1 END) as skipped_tasks,
			COALESCE(SUM(actual_minutes), 0) as total_minutes
		FROM tasks t
		JOIN goals g ON t.goal_id = g.id
		WHERE g.user_id = $1
			AND t.scheduled_date >= $2
			AND t.scheduled_date < $3
	`

	var stats TaskStats
	err := q.pool.QueryRow(ctx, query,
		arg.UserID,
		arg.StartDate,
		arg.EndDate,
	).Scan(
		&stats.TotalTasks,
		&stats.CompletedTasks,
		&stats.SkippedTasks,
		&stats.TotalMinutes,
	)

	return stats, err
}
