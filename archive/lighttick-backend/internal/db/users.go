package db

import (
	"context"
	"database/sql"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// User represents a user in the system
type User struct {
	ID          uuid.UUID
	SupabaseUID uuid.UUID
	Email       sql.NullString
	Nickname    sql.NullString
	IsGuest     bool
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// CreateUserParams contains parameters for creating a user
type CreateUserParams struct {
	SupabaseUID uuid.UUID
	Email       sql.NullString
	Nickname    sql.NullString
	IsGuest     bool
}

// UpgradeGuestUserParams contains parameters for upgrading a guest user
type UpgradeGuestUserParams struct {
	ID       uuid.UUID
	Email    sql.NullString
	Nickname sql.NullString
	IsGuest  bool
}

// CreateUser creates a new user
func (q *Queries) CreateUser(ctx context.Context, arg CreateUserParams) (User, error) {
	var user User
	err := q.pool.QueryRow(ctx, `
		INSERT INTO users (supabase_uid, email, nickname, is_guest)
		VALUES ($1, $2, $3, $4)
		RETURNING id, supabase_uid, email, nickname, is_guest, created_at, updated_at
	`, arg.SupabaseUID, arg.Email, arg.Nickname, arg.IsGuest).Scan(
		&user.ID,
		&user.SupabaseUID,
		&user.Email,
		&user.Nickname,
		&user.IsGuest,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	return user, err
}

// GetUser retrieves a user by ID
func (q *Queries) GetUser(ctx context.Context, id uuid.UUID) (User, error) {
	var user User
	err := q.pool.QueryRow(ctx, `
		SELECT id, supabase_uid, email, nickname, is_guest, created_at, updated_at
		FROM users
		WHERE id = $1
	`, id).Scan(
		&user.ID,
		&user.SupabaseUID,
		&user.Email,
		&user.Nickname,
		&user.IsGuest,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	return user, err
}

// GetUserBySupabaseUID retrieves a user by Supabase UID
func (q *Queries) GetUserBySupabaseUID(ctx context.Context, supabaseUID uuid.UUID) (User, error) {
	var user User
	err := q.pool.QueryRow(ctx, `
		SELECT id, supabase_uid, email, nickname, is_guest, created_at, updated_at
		FROM users
		WHERE supabase_uid = $1
	`, supabaseUID).Scan(
		&user.ID,
		&user.SupabaseUID,
		&user.Email,
		&user.Nickname,
		&user.IsGuest,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	return user, err
}

// GetUserByEmail retrieves a user by email
func (q *Queries) GetUserByEmail(ctx context.Context, email sql.NullString) (User, error) {
	var user User
	err := q.pool.QueryRow(ctx, `
		SELECT id, supabase_uid, email, nickname, is_guest, created_at, updated_at
		FROM users
		WHERE email = $1
	`, email).Scan(
		&user.ID,
		&user.SupabaseUID,
		&user.Email,
		&user.Nickname,
		&user.IsGuest,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	return user, err
}

// UpgradeGuestUser upgrades a guest user to a registered user
func (q *Queries) UpgradeGuestUser(ctx context.Context, arg UpgradeGuestUserParams) error {
	_, err := q.pool.Exec(ctx, `
		UPDATE users
		SET email = $2, nickname = $3, is_guest = $4, updated_at = NOW()
		WHERE id = $1
	`, arg.ID, arg.Email, arg.Nickname, arg.IsGuest)
	return err
}

// UpdateUser updates user information
func (q *Queries) UpdateUser(ctx context.Context, id uuid.UUID, email, nickname sql.NullString) error {
	_, err := q.pool.Exec(ctx, `
		UPDATE users
		SET email = $2, nickname = $3, updated_at = NOW()
		WHERE id = $1
	`, id, email, nickname)
	return err
}

// DeleteUser deletes a user
func (q *Queries) DeleteUser(ctx context.Context, id uuid.UUID) error {
	_, err := q.pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, id)
	return err
}

// ListUsers retrieves users with pagination
func (q *Queries) ListUsers(ctx context.Context, limit, offset int) ([]User, error) {
	rows, err := q.pool.Query(ctx, `
		SELECT id, supabase_uid, email, nickname, is_guest, created_at, updated_at
		FROM users
		ORDER BY created_at DESC
		LIMIT $1 OFFSET $2
	`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []User
	for rows.Next() {
		var user User
		if err := rows.Scan(
			&user.ID,
			&user.SupabaseUID,
			&user.Email,
			&user.Nickname,
			&user.IsGuest,
			&user.CreatedAt,
			&user.UpdatedAt,
		); err != nil {
			return nil, err
		}
		users = append(users, user)
	}
	return users, nil
}
