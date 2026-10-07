package auth

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/lighttick/lighttick-backend/internal/db"
)

// ContextKey is the key for user ID in request context
type ContextKey string

const UserIDKey ContextKey = "user_id"

// Middleware validates Supabase JWT tokens
type Middleware struct {
	supabaseURL string
	supabaseKey string
	queries     *db.Queries
}

// NewMiddleware creates a new auth middleware
func NewMiddleware(supabaseURL, supabaseKey string, queries *db.Queries) *Middleware {
	return &Middleware{
		supabaseURL: supabaseURL,
		supabaseKey: supabaseKey,
		queries:     queries,
	}
}

// Authenticate validates the JWT token and extracts user ID
func (m *Middleware) Authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			http.Error(w, "missing authorization", http.StatusUnauthorized)
			return
		}

		token := strings.TrimPrefix(authHeader, "Bearer ")
		if token == authHeader {
			http.Error(w, "invalid authorization format", http.StatusUnauthorized)
			return
		}

		// Validate JWT with Supabase
		userID, err := m.validateToken(r.Context(), token)
		if err != nil {
			log.Printf("auth: token validation failed: %v", err)
			http.Error(w, "invalid token", http.StatusUnauthorized)
			return
		}

		// Ensure user exists in our DB
		if err := m.ensureUser(r.Context(), userID); err != nil {
			log.Printf("auth: failed to ensure user: %v", err)
			http.Error(w, "user not found", http.StatusUnauthorized)
			return
		}

		// Add user ID to context
		ctx := context.WithValue(r.Context(), UserIDKey, userID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// VerifyHandler handles token verification (public endpoint)
func (m *Middleware) VerifyHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	userID, err := m.validateToken(r.Context(), req.Token)
	if err != nil {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"user_id": userID})
}

// validateToken validates a JWT token with Supabase and returns the user ID
func (m *Middleware) validateToken(ctx context.Context, token string) (string, error) {
	// TODO: Implement actual Supabase JWT validation
	// For now, decode the JWT payload to extract user ID
	// In production, use github.com/supabase-community/gotrue-go or validate JWT signature

	// Simplified: extract sub claim from JWT
	// JWT format: header.payload.signature
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return "", fmt.Errorf("invalid jwt format")
	}

	// Decode payload (base64url)
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", fmt.Errorf("decode jwt payload: %w", err)
	}

	var claims map[string]interface{}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return "", fmt.Errorf("parse jwt payload: %w", err)
	}

	sub, ok := claims["sub"].(string)
	if !ok {
		return "", fmt.Errorf("missing sub claim")
	}

	return sub, nil
}

// ensureUser ensures the user exists in our local DB
func (m *Middleware) ensureUser(ctx context.Context, userID string) error {
	// TODO: Implement user sync
	// For now, this is a placeholder
	return nil
}
