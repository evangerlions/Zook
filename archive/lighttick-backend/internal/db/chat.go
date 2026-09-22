package db

import (
	"context"
	"time"

	"github.com/google/uuid"
)

type ChatMessage struct {
	ID        uuid.UUID      `json:"id" db:"id"`
	UserID    uuid.UUID      `json:"user_id" db:"user_id"`
	GoalID    *uuid.UUID     `json:"goal_id,omitempty" db:"goal_id"`
	Role      string         `json:"role" db:"role"` // user, assistant, system
	Content   string         `json:"content" db:"content"`
	Metadata  map[string]any `json:"metadata" db:"metadata"`
	CreatedAt time.Time      `json:"created_at" db:"created_at"`
}

type ChatSession struct {
	ID        uuid.UUID      `json:"id" db:"id"`
	UserID    uuid.UUID      `json:"user_id" db:"user_id"`
	GoalID    *uuid.UUID     `json:"goal_id,omitempty" db:"goal_id"`
	Title     *string        `json:"title,omitempty" db:"title"`
	Context   map[string]any `json:"context" db:"context"`
	CreatedAt time.Time      `json:"created_at" db:"created_at"`
	UpdatedAt time.Time      `json:"updated_at" db:"updated_at"`
}

type CreateChatMessageParams struct {
	UserID   uuid.UUID
	GoalID   *uuid.UUID
	Role     string
	Content  string
	Metadata map[string]any
}

type CreateChatSessionParams struct {
	UserID  uuid.UUID
	GoalID  *uuid.UUID
	Title   *string
	Context map[string]any
}

func (q *Queries) CreateChatMessage(ctx context.Context, arg CreateChatMessageParams) (ChatMessage, error) {
	query := `
		INSERT INTO chat_messages (user_id, goal_id, role, content, metadata)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, user_id, goal_id, role, content, metadata, created_at
	`

	var msg ChatMessage
	err := q.pool.QueryRow(ctx, query,
		arg.UserID,
		arg.GoalID,
		arg.Role,
		arg.Content,
		arg.Metadata,
	).Scan(
		&msg.ID,
		&msg.UserID,
		&msg.GoalID,
		&msg.Role,
		&msg.Content,
		&msg.Metadata,
		&msg.CreatedAt,
	)

	return msg, err
}

func (q *Queries) ListChatMessagesBySession(ctx context.Context, userID uuid.UUID, limit int, offset int) ([]ChatMessage, error) {
	query := `
		SELECT id, user_id, goal_id, role, content, metadata, created_at
		FROM chat_messages
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3
	`

	rows, err := q.pool.Query(ctx, query, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var messages []ChatMessage
	for rows.Next() {
		var msg ChatMessage
		err := rows.Scan(
			&msg.ID,
			&msg.UserID,
			&msg.GoalID,
			&msg.Role,
			&msg.Content,
			&msg.Metadata,
			&msg.CreatedAt,
		)
		if err != nil {
			return nil, err
		}
		messages = append(messages, msg)
	}

	return messages, nil
}

func (q *Queries) ListChatMessagesByGoal(ctx context.Context, userID uuid.UUID, goalID uuid.UUID, limit int) ([]ChatMessage, error) {
	query := `
		SELECT id, user_id, goal_id, role, content, metadata, created_at
		FROM chat_messages
		WHERE user_id = $1 AND goal_id = $2
		ORDER BY created_at DESC
		LIMIT $3
	`

	rows, err := q.pool.Query(ctx, query, userID, goalID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var messages []ChatMessage
	for rows.Next() {
		var msg ChatMessage
		err := rows.Scan(
			&msg.ID,
			&msg.UserID,
			&msg.GoalID,
			&msg.Role,
			&msg.Content,
			&msg.Metadata,
			&msg.CreatedAt,
		)
		if err != nil {
			return nil, err
		}
		messages = append(messages, msg)
	}

	return messages, nil
}

func (q *Queries) CreateChatSession(ctx context.Context, arg CreateChatSessionParams) (ChatSession, error) {
	query := `
		INSERT INTO chat_sessions (user_id, goal_id, title, context)
		VALUES ($1, $2, $3, $4)
		RETURNING id, user_id, goal_id, title, context, created_at, updated_at
	`

	var session ChatSession
	err := q.pool.QueryRow(ctx, query,
		arg.UserID,
		arg.GoalID,
		arg.Title,
		arg.Context,
	).Scan(
		&session.ID,
		&session.UserID,
		&session.GoalID,
		&session.Title,
		&session.Context,
		&session.CreatedAt,
		&session.UpdatedAt,
	)

	return session, err
}

func (q *Queries) GetChatSession(ctx context.Context, id uuid.UUID) (ChatSession, error) {
	query := `
		SELECT id, user_id, goal_id, title, context, created_at, updated_at
		FROM chat_sessions
		WHERE id = $1
	`

	var session ChatSession
	err := q.pool.QueryRow(ctx, query, id).Scan(
		&session.ID,
		&session.UserID,
		&session.GoalID,
		&session.Title,
		&session.Context,
		&session.CreatedAt,
		&session.UpdatedAt,
	)

	return session, err
}

func (q *Queries) UpdateChatSessionContext(ctx context.Context, id uuid.UUID, context map[string]any) error {
	query := `
		UPDATE chat_sessions
		SET context = $2, updated_at = NOW()
		WHERE id = $1
	`

	_, err := q.pool.Exec(ctx, query, id, context)
	return err
}

func (q *Queries) ListChatSessionsByUser(ctx context.Context, userID uuid.UUID, limit int, offset int) ([]ChatSession, error) {
	query := `
		SELECT id, user_id, goal_id, title, context, created_at, updated_at
		FROM chat_sessions
		WHERE user_id = $1
		ORDER BY updated_at DESC
		LIMIT $2 OFFSET $3
	`

	rows, err := q.pool.Query(ctx, query, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sessions []ChatSession
	for rows.Next() {
		var session ChatSession
		err := rows.Scan(
			&session.ID,
			&session.UserID,
			&session.GoalID,
			&session.Title,
			&session.Context,
			&session.CreatedAt,
			&session.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		sessions = append(sessions, session)
	}

	return sessions, nil
}
