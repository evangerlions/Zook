package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/lighttick/lighttick-backend/internal/auth"
	"github.com/lighttick/lighttick-backend/internal/db"
)

type AuthHandler struct {
	queries *db.Queries
}

func NewAuthHandler(queries *db.Queries) *AuthHandler {
	return &AuthHandler{queries: queries}
}

// RegisterRequest 注册请求
type RegisterRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Nickname string `json:"nickname"`
}

// LoginRequest 登录请求
type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// GuestSessionRequest 游客会话请求
type GuestSessionRequest struct {
	DeviceID string `json:"device_id"`
}

// UpgradeAccountRequest 账号升级请求
type UpgradeAccountRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Nickname string `json:"nickname"`
}

// AuthResponse 认证响应
type AuthResponse struct {
	UserID string `json:"user_id"`
	Email  string `json:"email,omitempty"`
	Token  string `json:"token"`
}

// Register 用户注册
func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var req RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	// 验证输入
	if req.Email == "" || req.Password == "" {
		http.Error(w, "email and password are required", http.StatusBadRequest)
		return
	}

	// TODO: 集成 Supabase Auth 创建用户
	// 这里简化处理，实际应该调用 Supabase Auth API
	supabaseUID := uuid.New()

	// 创建本地用户记录
	ctx := r.Context()
	user, err := h.queries.CreateUser(ctx, db.CreateUserParams{
		SupabaseUid: supabaseUID,
		Email:       sql.NullString{String: req.Email, Valid: true},
		Nickname:    sql.NullString{String: req.Nickname, Valid: req.Nickname != ""},
		IsGuest:     false,
	})
	if err != nil {
		log.Printf("failed to create user: %v", err)
		http.Error(w, "failed to create user", http.StatusInternalServerError)
		return
	}

	// TODO: 生成 JWT token（实际应该由 Supabase 生成）
	token := "placeholder_token_" + user.ID.String()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(AuthResponse{
		UserID: user.ID.String(),
		Email:  req.Email,
		Token:  token,
	})
}

// Login 用户登录
func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	// TODO: 集成 Supabase Auth 验证用户
	// 这里简化处理
	ctx := r.Context()
	user, err := h.queries.GetUserByEmail(ctx, sql.NullString{String: req.Email, Valid: true})
	if err != nil {
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}

	// TODO: 生成 JWT token
	token := "placeholder_token_" + user.ID.String()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(AuthResponse{
		UserID: user.ID.String(),
		Email:  req.Email,
		Token:  token,
	})
}

// CreateGuestSession 创建游客会话
func (h *AuthHandler) CreateGuestSession(w http.ResponseWriter, r *http.Request) {
	var req GuestSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	// 生成游客用户 ID
	supabaseUID := uuid.New()

	ctx := r.Context()
	user, err := h.queries.CreateUser(ctx, db.CreateUserParams{
		SupabaseUid: supabaseUID,
		IsGuest:     true,
	})
	if err != nil {
		log.Printf("failed to create guest user: %v", err)
		http.Error(w, "failed to create guest session", http.StatusInternalServerError)
		return
	}

	// TODO: 生成临时 JWT token
	token := "placeholder_guest_token_" + user.ID.String()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(AuthResponse{
		UserID: user.ID.String(),
		Token:  token,
	})
}

// UpgradeAccount 升级游客账号
func (h *AuthHandler) UpgradeAccount(w http.ResponseWriter, r *http.Request) {
	// 从 context 获取当前用户 ID
	userID, ok := r.Context().Value(auth.UserIDKey).(string)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var req UpgradeAccountRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	// 验证输入
	if req.Email == "" || req.Password == "" {
		http.Error(w, "email and password are required", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	uid, err := uuid.Parse(userID)
	if err != nil {
		http.Error(w, "invalid user id", http.StatusBadRequest)
		return
	}

	// 检查用户是否存在
	user, err := h.queries.GetUser(ctx, uid)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}

	// 检查是否已经是正式用户
	if !user.IsGuest {
		http.Error(w, "account already upgraded", http.StatusBadRequest)
		return
	}

	// TODO: 集成 Supabase Auth 创建正式账号
	// 这里简化处理，直接更新本地记录
	err = h.queries.UpgradeGuestUser(ctx, db.UpgradeGuestUserParams{
		ID:       uid,
		Email:    sql.NullString{String: req.Email, Valid: true},
		Nickname: sql.NullString{String: req.Nickname, Valid: req.Nickname != ""},
		IsGuest:  false,
	})
	if err != nil {
		log.Printf("failed to upgrade user: %v", err)
		http.Error(w, "failed to upgrade account", http.StatusInternalServerError)
		return
	}

	// TODO: 生成新的 JWT token
	token := "placeholder_token_" + uid.String()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(AuthResponse{
		UserID: uid.String(),
		Email:  req.Email,
		Token:  token,
	})
}

// VerifyToken 验证 token（公开端点）
func (h *AuthHandler) VerifyToken(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	// TODO: 实际应该验证 JWT token
	// 这里简化处理，直接返回 user_id
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"user_id": "placeholder_user_id",
	})
}

// GetCurrentUser 获取当前用户信息
func (h *AuthHandler) GetCurrentUser(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(auth.UserIDKey).(string)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	ctx := r.Context()
	uid, err := uuid.Parse(userID)
	if err != nil {
		http.Error(w, "invalid user id", http.StatusBadRequest)
		return
	}

	user, err := h.queries.GetUser(ctx, uid)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}

	response := map[string]interface{}{
		"id":        user.ID.String(),
		"email":     user.Email.String,
		"nickname":  user.Nickname.String,
		"is_guest":  user.IsGuest,
		"created_at": user.CreatedAt,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// RefreshToken 刷新 token
func (h *AuthHandler) RefreshToken(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(auth.UserIDKey).(string)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	// TODO: 实际应该生成新的 JWT token
	token := "placeholder_refreshed_token_" + userID

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"token": token,
	})
}

// Logout 登出
func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	// TODO: 实际应该使 token 失效
	// 对于无状态 JWT，客户端删除 token 即可
	w.WriteHeader(http.StatusOK)
}
