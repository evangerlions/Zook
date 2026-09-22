package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/lighttick/lighttick-backend/internal/ai"
	"github.com/lighttick/lighttick-backend/internal/api"
	"github.com/lighttick/lighttick-backend/internal/auth"
	"github.com/lighttick/lighttick-backend/internal/db"
	"github.com/lighttick/lighttick-backend/internal/rate"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

func main() {
	// Load config from env
	cfg := &Config{
		Port:           getEnv("PORT", "8080"),
		DatabaseURL:    getEnv("DATABASE_URL", ""),
		SupabaseURL:    getEnv("SUPABASE_URL", ""),
		SupabaseKey:    getEnv("SUPABASE_KEY", ""),
		AIAPIKey:       getEnv("AI_API_KEY", ""),
		AIAPIBaseURL:   getEnv("AI_API_BASE_URL", ""),           // optional, for compatible endpoints
		AIModel:        getEnv("AI_MODEL", "gpt-4o"),            // single strong model
		AICostCapCents: parseIntEnv("AI_COST_CAP_CENTS", 30000), // $0.30/week = 30000 cents
		RequestTimeout: parseDurationEnv("REQUEST_TIMEOUT", 30*time.Second),
	}

	if cfg.DatabaseURL == "" {
		log.Fatal("DATABASE_URL is required")
	}
	if cfg.AIAPIKey == "" {
		log.Fatal("AI_API_KEY is required")
	}

	// Initialize database
	dbPool, err := db.NewPool(context.Background(), cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("failed to create db pool: %v", err)
	}
	defer dbPool.Close()

	queries := db.New(dbPool)

	// Initialize AI service
	aiService := ai.NewService(ai.Config{
		APIKey:  cfg.AIAPIKey,
		BaseURL: cfg.AIAPIBaseURL,
		Model:   cfg.AIModel,
		Timeout: cfg.RequestTimeout,
		CostCap: cfg.AICostCapCents,
	})

	// Initialize rate limiter / cost tracker
	costTracker := rate.NewCostTracker(queries)
	// 100 requests per minute per user
	rateLimiter := rate.NewLimiter(100, time.Minute)

	// Initialize router
	r := chi.NewRouter()

	// Global middleware
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(60 * time.Second))

	// Auth middleware
	authMiddleware := auth.NewMiddleware(cfg.SupabaseURL, cfg.SupabaseKey, queries)

	// Auth handler
	authHandler := api.NewAuthHandler(queries)

	// Public routes (no auth)
	r.Post("/api/v1/auth/verify", authMiddleware.VerifyHandler)
	r.Post("/api/v1/auth/register", authHandler.Register)
	r.Post("/api/v1/auth/login", authHandler.Login)
	r.Post("/api/v1/auth/guest", authHandler.CreateGuestSession)

	// Protected routes
	r.Group(func(r chi.Router) {
		r.Use(authMiddleware.Authenticate)
		r.Use(rateLimiter.Middleware)

		// Auth (protected)
		r.Post("/api/v1/auth/upgrade", authHandler.UpgradeAccount)
		r.Post("/api/v1/auth/refresh", authHandler.RefreshToken)
		r.Post("/api/v1/auth/logout", authHandler.Logout)
		r.Get("/api/v1/auth/me", authHandler.GetCurrentUser)

		// Goals
		goalHandler := api.NewGoalHandler(queries)
		r.Post("/api/v1/goals", goalHandler.Create)
		r.Get("/api/v1/goals", goalHandler.List)
		r.Get("/api/v1/goals/{id}", goalHandler.Get)
		r.Put("/api/v1/goals/{id}", goalHandler.Update)
		r.Delete("/api/v1/goals/{id}", goalHandler.Delete)

		// Plans
		planHandler := api.NewPlanHandler(queries, aiService, costTracker)
		r.Post("/api/v1/plans/month", planHandler.GenerateMonth)
		r.Post("/api/v1/plans/week", planHandler.GenerateWeek)
		r.Post("/api/v1/plans/day", planHandler.GenerateDay)
		r.Get("/api/v1/plans/{id}", planHandler.Get)

		// Tasks
		taskHandler := api.NewTaskHandler(queries)
		r.Post("/api/v1/tasks/{id}/complete", taskHandler.Complete)
		r.Post("/api/v1/tasks/{id}/skip", taskHandler.Skip)
		r.Post("/api/v1/tasks/{id}/defer", taskHandler.Defer)
		r.Get("/api/v1/tasks/week/{weekId}", taskHandler.ListByWeek)

		// Sync (offline-first)
		syncHandler := api.NewSyncHandler(queries)
		r.Post("/api/v1/sync/push", syncHandler.Push)
		r.Get("/api/v1/sync/pull", syncHandler.Pull)

		// Review
		reviewHandler := api.NewReviewHandler(queries, aiService)
		r.Post("/api/v1/review/weekly", reviewHandler.Weekly)
		r.Post("/api/v1/review/monthly", reviewHandler.Monthly)

		// Plan B (re-planning)
		r.Post("/api/v1/plans/replan", planHandler.Replan)

		// Weekly win summary
		r.Get("/api/v1/summary/weekly", planHandler.WeeklyWin)

		// Onboarding
		r.Post("/api/v1/onboarding/complete", planHandler.OnboardingComplete)

		// Calendar (Phase 2 stubs)
		calendarHandler := api.NewCalendarHandler(queries)
		r.Post("/api/v1/calendar/connect", calendarHandler.Connect)
		r.Delete("/api/v1/calendar", calendarHandler.Disconnect)
		r.Get("/api/v1/calendar/status", calendarHandler.Status)

		// Chat (Phase 2)
		chatHandler := api.NewChatHandler(queries, aiService)
		r.Post("/api/v1/chat", chatHandler.SendMessage)
		r.Get("/api/v1/chat/history", chatHandler.GetChatHistory)

		// DNA Insights (Phase 2)
		dnaHandler := api.NewDNAHandler(queries)
		r.Get("/api/v1/dna/insights", dnaHandler.ListInsights)
		r.Get("/api/v1/dna/insights/{id}", dnaHandler.GetInsight)
		r.Post("/api/v1/dna/insights/{id}/feedback", dnaHandler.SubmitFeedback)
		r.Delete("/api/v1/dna/insights/{id}", dnaHandler.DeleteInsight)
	})

	// Calendar callback — must be unprotected (OAuth redirect from external provider)
	calendarHandler := api.NewCalendarHandler(queries)
	r.Get("/api/v1/calendar/callback", calendarHandler.Callback)

	// Health check
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	})

	srv := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: r,
	}

	// Graceful shutdown
	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
		<-sig
		log.Println("shutting down...")
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			log.Fatalf("shutdown error: %v", err)
		}
	}()

	log.Printf("server starting on :%s", cfg.Port)
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatalf("server error: %v", err)
	}
}

type Config struct {
	Port           string
	DatabaseURL    string
	SupabaseURL    string
	SupabaseKey    string
	AIAPIKey       string
	AIAPIBaseURL   string
	AIModel        string
	AICostCapCents int
	RequestTimeout time.Duration
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func parseIntEnv(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		var n int
		if _, err := fmt.Sscanf(v, "%d", &n); err == nil {
			return n
		}
	}
	return fallback
}

func parseDurationEnv(key string, fallback time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return fallback
}
