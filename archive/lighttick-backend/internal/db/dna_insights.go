package db

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type DNAInsight struct {
	ID             uuid.UUID      `json:"id" db:"id"`
	UserID         uuid.UUID      `json:"user_id" db:"user_id"`
	Category       string         `json:"category" db:"category"`
	Title          string         `json:"title" db:"title"`
	Description    *string        `json:"description,omitempty" db:"description"`
	EvidenceCount  int            `json:"evidence_count" db:"evidence_count"`
	Confidence     float64        `json:"confidence" db:"confidence"`
	Scope          string         `json:"scope" db:"scope"`
	CreatedAt      time.Time      `json:"created_at" db:"created_at"`
	ExpiresAt      *time.Time     `json:"expires_at,omitempty" db:"expires_at"`
	UserFeedback   *string        `json:"user_feedback,omitempty" db:"user_feedback"`
	UserCorrection *string        `json:"user_correction,omitempty" db:"user_correction"`
	AllowedEffects []string       `json:"allowed_effects" db:"allowed_effects"`
	IsStable       bool           `json:"is_stable" db:"is_stable"`
	Metadata       map[string]any `json:"metadata" db:"metadata"`
	UpdatedAt      time.Time      `json:"updated_at" db:"updated_at"`
}

type CreateDNAInsightParams struct {
	UserID         uuid.UUID
	Category       string
	Title          string
	Description    *string
	EvidenceCount  int
	Confidence     float64
	Scope          string
	ExpiresAt      *time.Time
	AllowedEffects []string
	IsStable       bool
	Metadata       map[string]any
}

type UpdateDNAInsightFeedbackParams struct {
	ID             uuid.UUID
	UserFeedback   string
	UserCorrection *string
}

func (q *Queries) CreateDNAInsight(ctx context.Context, arg CreateDNAInsightParams) (DNAInsight, error) {
	query := `
		INSERT INTO dna_insights (
			user_id, category, title, description, evidence_count, confidence,
			scope, expires_at, allowed_effects, is_stable, metadata
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING id, user_id, category, title, description, evidence_count, confidence,
			scope, created_at, expires_at, user_feedback, user_correction,
			allowed_effects, is_stable, metadata, updated_at
	`

	var insight DNAInsight
	err := q.pool.QueryRow(ctx, query,
		arg.UserID,
		arg.Category,
		arg.Title,
		arg.Description,
		arg.EvidenceCount,
		arg.Confidence,
		arg.Scope,
		arg.ExpiresAt,
		arg.AllowedEffects,
		arg.IsStable,
		arg.Metadata,
	).Scan(
		&insight.ID,
		&insight.UserID,
		&insight.Category,
		&insight.Title,
		&insight.Description,
		&insight.EvidenceCount,
		&insight.Confidence,
		&insight.Scope,
		&insight.CreatedAt,
		&insight.ExpiresAt,
		&insight.UserFeedback,
		&insight.UserCorrection,
		&insight.AllowedEffects,
		&insight.IsStable,
		&insight.Metadata,
		&insight.UpdatedAt,
	)

	return insight, err
}

func (q *Queries) GetDNAInsight(ctx context.Context, id uuid.UUID) (DNAInsight, error) {
	query := `
		SELECT id, user_id, category, title, description, evidence_count, confidence,
			scope, created_at, expires_at, user_feedback, user_correction,
			allowed_effects, is_stable, metadata, updated_at
		FROM dna_insights
		WHERE id = $1
	`

	var insight DNAInsight
	err := q.pool.QueryRow(ctx, query, id).Scan(
		&insight.ID,
		&insight.UserID,
		&insight.Category,
		&insight.Title,
		&insight.Description,
		&insight.EvidenceCount,
		&insight.Confidence,
		&insight.Scope,
		&insight.CreatedAt,
		&insight.ExpiresAt,
		&insight.UserFeedback,
		&insight.UserCorrection,
		&insight.AllowedEffects,
		&insight.IsStable,
		&insight.Metadata,
		&insight.UpdatedAt,
	)

	return insight, err
}

func (q *Queries) ListDNAInsightsByUser(ctx context.Context, userID uuid.UUID, limit int, offset int) ([]DNAInsight, error) {
	query := `
		SELECT id, user_id, category, title, description, evidence_count, confidence,
			scope, created_at, expires_at, user_feedback, user_correction,
			allowed_effects, is_stable, metadata, updated_at
		FROM dna_insights
		WHERE user_id = $1
		ORDER BY confidence DESC, created_at DESC
		LIMIT $2 OFFSET $3
	`

	rows, err := q.pool.Query(ctx, query, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var insights []DNAInsight
	for rows.Next() {
		var insight DNAInsight
		err := rows.Scan(
			&insight.ID,
			&insight.UserID,
			&insight.Category,
			&insight.Title,
			&insight.Description,
			&insight.EvidenceCount,
			&insight.Confidence,
			&insight.Scope,
			&insight.CreatedAt,
			&insight.ExpiresAt,
			&insight.UserFeedback,
			&insight.UserCorrection,
			&insight.AllowedEffects,
			&insight.IsStable,
			&insight.Metadata,
			&insight.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		insights = append(insights, insight)
	}

	return insights, nil
}

func (q *Queries) UpdateDNAInsightFeedback(ctx context.Context, arg UpdateDNAInsightFeedbackParams) error {
	query := `
		UPDATE dna_insights
		SET user_feedback = $2, user_correction = $3, updated_at = NOW()
		WHERE id = $1
	`

	_, err := q.pool.Exec(ctx, query, arg.ID, arg.UserFeedback, arg.UserCorrection)
	return err
}

func (q *Queries) DeleteDNAInsight(ctx context.Context, id uuid.UUID) error {
	query := `DELETE FROM dna_insights WHERE id = $1`
	_, err := q.pool.Exec(ctx, query, id)
	return err
}

func (q *Queries) GetActiveDNAInsightsByUser(ctx context.Context, userID uuid.UUID) ([]DNAInsight, error) {
	query := `
		SELECT id, user_id, category, title, description, evidence_count, confidence,
			scope, created_at, expires_at, user_feedback, user_correction,
			allowed_effects, is_stable, metadata, updated_at
		FROM dna_insights
		WHERE user_id = $1
			AND (expires_at IS NULL OR expires_at > NOW())
			AND user_feedback IS DISTINCT FROM 'rejected'
		ORDER BY confidence DESC
	`

	rows, err := q.pool.Query(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var insights []DNAInsight
	for rows.Next() {
		var insight DNAInsight
		err := rows.Scan(
			&insight.ID,
			&insight.UserID,
			&insight.Category,
			&insight.Title,
			&insight.Description,
			&insight.EvidenceCount,
			&insight.Confidence,
			&insight.Scope,
			&insight.CreatedAt,
			&insight.ExpiresAt,
			&insight.UserFeedback,
			&insight.UserCorrection,
			&insight.AllowedEffects,
			&insight.IsStable,
			&insight.Metadata,
			&insight.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		insights = append(insights, insight)
	}

	return insights, nil
}

// ScanDNAInsight 用于 pgx.Rows 扫描
func ScanDNAInsight(row pgx.Row) (DNAInsight, error) {
	var insight DNAInsight
	err := row.Scan(
		&insight.ID,
		&insight.UserID,
		&insight.Category,
		&insight.Title,
		&insight.Description,
		&insight.EvidenceCount,
		&insight.Confidence,
		&insight.Scope,
		&insight.CreatedAt,
		&insight.ExpiresAt,
		&insight.UserFeedback,
		&insight.UserCorrection,
		&insight.AllowedEffects,
		&insight.IsStable,
		&insight.Metadata,
		&insight.UpdatedAt,
	)
	return insight, err
}

// 确保 pool 类型正确
var _ *pgxpool.Pool
