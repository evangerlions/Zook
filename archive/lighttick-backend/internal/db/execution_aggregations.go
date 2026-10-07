package db

import (
	"context"
	"time"

	"github.com/google/uuid"
)

type ExecutionAggregation struct {
	ID                uuid.UUID      `json:"id" db:"id"`
	UserID            uuid.UUID      `json:"user_id" db:"user_id"`
	AggregationType   string         `json:"aggregation_type" db:"aggregation_type"` // daily, weekly, monthly
	PeriodStart       time.Time      `json:"period_start" db:"period_start"`
	PeriodEnd         time.Time      `json:"period_end" db:"period_end"`
	TotalTasks        int            `json:"total_tasks" db:"total_tasks"`
	CompletedTasks    int            `json:"completed_tasks" db:"completed_tasks"`
	SkippedTasks      int            `json:"skipped_tasks" db:"skipped_tasks"`
	TotalMinutes      int            `json:"total_minutes" db:"total_minutes"`
	AvgCompletionRate float64        `json:"avg_completion_rate" db:"avg_completion_rate"`
	Metadata          map[string]any `json:"metadata" db:"metadata"`
	CreatedAt         time.Time      `json:"created_at" db:"created_at"`
}

type CreateExecutionAggregationParams struct {
	UserID            uuid.UUID
	AggregationType   string
	PeriodStart       time.Time
	PeriodEnd         time.Time
	TotalTasks        int
	CompletedTasks    int
	SkippedTasks      int
	TotalMinutes      int
	AvgCompletionRate float64
	Metadata          map[string]any
}

type UpdateExecutionAggregationParams struct {
	ID                uuid.UUID
	TotalTasks        int
	CompletedTasks    int
	SkippedTasks      int
	TotalMinutes      int
	AvgCompletionRate float64
	Metadata          map[string]any
}

func (q *Queries) CreateExecutionAggregation(ctx context.Context, arg CreateExecutionAggregationParams) (ExecutionAggregation, error) {
	query := `
		INSERT INTO execution_aggregations (
			user_id, aggregation_type, period_start, period_end,
			total_tasks, completed_tasks, skipped_tasks, total_minutes,
			avg_completion_rate, metadata
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING id, user_id, aggregation_type, period_start, period_end,
			total_tasks, completed_tasks, skipped_tasks, total_minutes,
			avg_completion_rate, metadata, created_at
	`

	var agg ExecutionAggregation
	err := q.pool.QueryRow(ctx, query,
		arg.UserID,
		arg.AggregationType,
		arg.PeriodStart,
		arg.PeriodEnd,
		arg.TotalTasks,
		arg.CompletedTasks,
		arg.SkippedTasks,
		arg.TotalMinutes,
		arg.AvgCompletionRate,
		arg.Metadata,
	).Scan(
		&agg.ID,
		&agg.UserID,
		&agg.AggregationType,
		&agg.PeriodStart,
		&agg.PeriodEnd,
		&agg.TotalTasks,
		&agg.CompletedTasks,
		&agg.SkippedTasks,
		&agg.TotalMinutes,
		&agg.AvgCompletionRate,
		&agg.Metadata,
		&agg.CreatedAt,
	)

	return agg, err
}

func (q *Queries) UpdateExecutionAggregation(ctx context.Context, arg UpdateExecutionAggregationParams) error {
	query := `
		UPDATE execution_aggregations
		SET total_tasks = $2, completed_tasks = $3, skipped_tasks = $4,
			total_minutes = $5, avg_completion_rate = $6, metadata = $7
		WHERE id = $1
	`

	_, err := q.pool.Exec(ctx, query,
		arg.ID,
		arg.TotalTasks,
		arg.CompletedTasks,
		arg.SkippedTasks,
		arg.TotalMinutes,
		arg.AvgCompletionRate,
		arg.Metadata,
	)

	return err
}

func (q *Queries) GetExecutionAggregation(ctx context.Context, id uuid.UUID) (ExecutionAggregation, error) {
	query := `
		SELECT id, user_id, aggregation_type, period_start, period_end,
			total_tasks, completed_tasks, skipped_tasks, total_minutes,
			avg_completion_rate, metadata, created_at
		FROM execution_aggregations
		WHERE id = $1
	`

	var agg ExecutionAggregation
	err := q.pool.QueryRow(ctx, query, id).Scan(
		&agg.ID,
		&agg.UserID,
		&agg.AggregationType,
		&agg.PeriodStart,
		&agg.PeriodEnd,
		&agg.TotalTasks,
		&agg.CompletedTasks,
		&agg.SkippedTasks,
		&agg.TotalMinutes,
		&agg.AvgCompletionRate,
		&agg.Metadata,
		&agg.CreatedAt,
	)

	return agg, err
}

func (q *Queries) GetExecutionAggregationByPeriod(ctx context.Context, userID uuid.UUID, aggType string, periodStart time.Time) (ExecutionAggregation, error) {
	query := `
		SELECT id, user_id, aggregation_type, period_start, period_end,
			total_tasks, completed_tasks, skipped_tasks, total_minutes,
			avg_completion_rate, metadata, created_at
		FROM execution_aggregations
		WHERE user_id = $1 AND aggregation_type = $2 AND period_start = $3
	`

	var agg ExecutionAggregation
	err := q.pool.QueryRow(ctx, query, userID, aggType, periodStart).Scan(
		&agg.ID,
		&agg.UserID,
		&agg.AggregationType,
		&agg.PeriodStart,
		&agg.PeriodEnd,
		&agg.TotalTasks,
		&agg.CompletedTasks,
		&agg.SkippedTasks,
		&agg.TotalMinutes,
		&agg.AvgCompletionRate,
		&agg.Metadata,
		&agg.CreatedAt,
	)

	return agg, err
}

func (q *Queries) ListExecutionAggregations(ctx context.Context, userID uuid.UUID, aggType string, limit int, offset int) ([]ExecutionAggregation, error) {
	query := `
		SELECT id, user_id, aggregation_type, period_start, period_end,
			total_tasks, completed_tasks, skipped_tasks, total_minutes,
			avg_completion_rate, metadata, created_at
		FROM execution_aggregations
		WHERE user_id = $1 AND aggregation_type = $2
		ORDER BY period_start DESC
		LIMIT $3 OFFSET $4
	`

	rows, err := q.pool.Query(ctx, query, userID, aggType, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var aggregations []ExecutionAggregation
	for rows.Next() {
		var agg ExecutionAggregation
		err := rows.Scan(
			&agg.ID,
			&agg.UserID,
			&agg.AggregationType,
			&agg.PeriodStart,
			&agg.PeriodEnd,
			&agg.TotalTasks,
			&agg.CompletedTasks,
			&agg.SkippedTasks,
			&agg.TotalMinutes,
			&agg.AvgCompletionRate,
			&agg.Metadata,
			&agg.CreatedAt,
		)
		if err != nil {
			return nil, err
		}
		aggregations = append(aggregations, agg)
	}

	return aggregations, nil
}

func (q *Queries) UpsertExecutionAggregation(ctx context.Context, arg CreateExecutionAggregationParams) (ExecutionAggregation, error) {
	query := `
		INSERT INTO execution_aggregations (
			user_id, aggregation_type, period_start, period_end,
			total_tasks, completed_tasks, skipped_tasks, total_minutes,
			avg_completion_rate, metadata
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT (user_id, aggregation_type, period_start)
		DO UPDATE SET
			total_tasks = EXCLUDED.total_tasks,
			completed_tasks = EXCLUDED.completed_tasks,
			skipped_tasks = EXCLUDED.skipped_tasks,
			total_minutes = EXCLUDED.total_minutes,
			avg_completion_rate = EXCLUDED.avg_completion_rate,
			metadata = EXCLUDED.metadata
		RETURNING id, user_id, aggregation_type, period_start, period_end,
			total_tasks, completed_tasks, skipped_tasks, total_minutes,
			avg_completion_rate, metadata, created_at
	`

	var agg ExecutionAggregation
	err := q.pool.QueryRow(ctx, query,
		arg.UserID,
		arg.AggregationType,
		arg.PeriodStart,
		arg.PeriodEnd,
		arg.TotalTasks,
		arg.CompletedTasks,
		arg.SkippedTasks,
		arg.TotalMinutes,
		arg.AvgCompletionRate,
		arg.Metadata,
	).Scan(
		&agg.ID,
		&agg.UserID,
		&agg.AggregationType,
		&agg.PeriodStart,
		&agg.PeriodEnd,
		&agg.TotalTasks,
		&agg.CompletedTasks,
		&agg.SkippedTasks,
		&agg.TotalMinutes,
		&agg.AvgCompletionRate,
		&agg.Metadata,
		&agg.CreatedAt,
	)

	return agg, err
}
