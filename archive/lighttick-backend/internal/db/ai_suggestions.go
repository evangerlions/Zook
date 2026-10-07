package db

import (
	"context"
	"time"

	"github.com/google/uuid"
)

type AISuggestion struct {
	ID              uuid.UUID      `json:"id" db:"id"`
	UserID          uuid.UUID      `json:"user_id" db:"user_id"`
	InsightID       *uuid.UUID     `json:"insight_id,omitempty" db:"insight_id"`
	SuggestionType  string         `json:"suggestion_type" db:"suggestion_type"` // task_order, schedule, difficulty, recovery_day
	Context         map[string]any `json:"context" db:"context"`
	ProposedChanges map[string]any `json:"proposed_changes" db:"proposed_changes"`
	UserAction      *string        `json:"user_action,omitempty" db:"user_action"` // accepted, rejected, edited
	Outcome         map[string]any `json:"outcome" db:"outcome"`
	CreatedAt       time.Time      `json:"created_at" db:"created_at"`
	ActedAt         *time.Time     `json:"acted_at,omitempty" db:"acted_at"`
}

type CreateAISuggestionParams struct {
	UserID          uuid.UUID
	InsightID       *uuid.UUID
	SuggestionType  string
	Context         map[string]any
	ProposedChanges map[string]any
}

type UpdateAISuggestionActionParams struct {
	ID         uuid.UUID
	UserAction string
	Outcome    map[string]any
}

func (q *Queries) CreateAISuggestion(ctx context.Context, arg CreateAISuggestionParams) (AISuggestion, error) {
	query := `
		INSERT INTO ai_suggestions (user_id, insight_id, suggestion_type, context, proposed_changes)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, user_id, insight_id, suggestion_type, context, proposed_changes, user_action, outcome, created_at, acted_at
	`

	var suggestion AISuggestion
	err := q.pool.QueryRow(ctx, query,
		arg.UserID,
		arg.InsightID,
		arg.SuggestionType,
		arg.Context,
		arg.ProposedChanges,
	).Scan(
		&suggestion.ID,
		&suggestion.UserID,
		&suggestion.InsightID,
		&suggestion.SuggestionType,
		&suggestion.Context,
		&suggestion.ProposedChanges,
		&suggestion.UserAction,
		&suggestion.Outcome,
		&suggestion.CreatedAt,
		&suggestion.ActedAt,
	)

	return suggestion, err
}

func (q *Queries) UpdateAISuggestionAction(ctx context.Context, arg UpdateAISuggestionActionParams) error {
	query := `
		UPDATE ai_suggestions
		SET user_action = $2, outcome = $3, acted_at = NOW()
		WHERE id = $1
	`

	_, err := q.pool.Exec(ctx, query, arg.ID, arg.UserAction, arg.Outcome)
	return err
}

func (q *Queries) GetAISuggestion(ctx context.Context, id uuid.UUID) (AISuggestion, error) {
	query := `
		SELECT id, user_id, insight_id, suggestion_type, context, proposed_changes, user_action, outcome, created_at, acted_at
		FROM ai_suggestions
		WHERE id = $1
	`

	var suggestion AISuggestion
	err := q.pool.QueryRow(ctx, query, id).Scan(
		&suggestion.ID,
		&suggestion.UserID,
		&suggestion.InsightID,
		&suggestion.SuggestionType,
		&suggestion.Context,
		&suggestion.ProposedChanges,
		&suggestion.UserAction,
		&suggestion.Outcome,
		&suggestion.CreatedAt,
		&suggestion.ActedAt,
	)

	return suggestion, err
}

func (q *Queries) ListAISuggestionsByUser(ctx context.Context, userID uuid.UUID, limit int, offset int) ([]AISuggestion, error) {
	query := `
		SELECT id, user_id, insight_id, suggestion_type, context, proposed_changes, user_action, outcome, created_at, acted_at
		FROM ai_suggestions
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3
	`

	rows, err := q.pool.Query(ctx, query, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var suggestions []AISuggestion
	for rows.Next() {
		var suggestion AISuggestion
		err := rows.Scan(
			&suggestion.ID,
			&suggestion.UserID,
			&suggestion.InsightID,
			&suggestion.SuggestionType,
			&suggestion.Context,
			&suggestion.ProposedChanges,
			&suggestion.UserAction,
			&suggestion.Outcome,
			&suggestion.CreatedAt,
			&suggestion.ActedAt,
		)
		if err != nil {
			return nil, err
		}
		suggestions = append(suggestions, suggestion)
	}

	return suggestions, nil
}

func (q *Queries) GetAISuggestionStats(ctx context.Context, userID uuid.UUID) (map[string]any, error) {
	query := `
		SELECT 
			COUNT(*) as total,
			COUNT(CASE WHEN user_action = 'accepted' THEN 1 END) as accepted,
			COUNT(CASE WHEN user_action = 'rejected' THEN 1 END) as rejected,
			COUNT(CASE WHEN user_action = 'edited' THEN 1 END) as edited,
			COUNT(CASE WHEN user_action IS NULL THEN 1 END) as pending
		FROM ai_suggestions
		WHERE user_id = $1
	`

	var stats map[string]any
	err := q.pool.QueryRow(ctx, query, userID).Scan(
		&stats["total"],
		&stats["accepted"],
		&stats["rejected"],
		&stats["edited"],
		&stats["pending"],
	)

	return stats, err
}
