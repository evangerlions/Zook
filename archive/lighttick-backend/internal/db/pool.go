package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// DB is the main database connection pool wrapper
type DB struct {
	Pool *pgxpool.Pool
}

// NewPool creates a new database connection pool
func NewPool(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse db config: %w", err)
	}

	// Connection pool settings
	config.MaxConns = 20
	config.MinConns = 5
	config.MaxConnLifetime = 30 * 60 // 30 minutes
	config.MaxConnIdleTime = 5 * 60  // 5 minutes

	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}

	// Verify connection
	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("ping db: %w", err)
	}

	return pool, nil
}

// New creates a new DB wrapper (sqlc-style interface)
func New(pool *pgxpool.Pool) *Queries {
	return &Queries{pool: pool}
}

// Queries holds all database query methods
type Queries struct {
	pool *pgxpool.Pool
}
