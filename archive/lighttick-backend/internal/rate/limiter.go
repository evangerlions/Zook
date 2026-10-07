package rate

import (
	"net/http"
	"sync"
	"time"
)

// Limiter implements a simple per-key token bucket rate limiter
type Limiter struct {
	mu       sync.Mutex
	buckets  map[string]*bucket
	rate     int           // requests per window
	window   time.Duration // sliding window duration
}

type bucket struct {
	tokens    int
	lastRefill time.Time
}

// NewLimiter creates a new rate limiter
func NewLimiter(rate int, window time.Duration) *Limiter {
	return &Limiter{
		buckets: make(map[string]*bucket),
		rate:    rate,
		window:  window,
	}
}

// Allow checks if a request from the given key is allowed
func (l *Limiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	b, exists := l.buckets[key]
	if !exists {
		l.buckets[key] = &bucket{tokens: l.rate - 1, lastRefill: time.Now()}
		return true
	}

	// Refill tokens based on elapsed time
	elapsed := time.Since(b.lastRefill)
	if elapsed >= l.window {
		b.tokens = l.rate
		b.lastRefill = time.Now()
	} else {
		// Proportional refill
		refill := int(float64(elapsed) / float64(l.window) * float64(l.rate))
		b.tokens = min(b.tokens+refill, l.rate)
		b.lastRefill = time.Now()
	}

	if b.tokens <= 0 {
		return false
	}

	b.tokens--
	return true
}

// Middleware returns an HTTP middleware that rate limits by remote address
func (l *Limiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.RemoteAddr
		if !l.Allow(key) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			w.Write([]byte(`{"error":{"code":"RATE_LIMITED","message":"too many requests, please try again later"}}`))
			return
		}
		next.ServeHTTP(w, r)
	})
}

// Cleanup removes stale buckets older than 2x the window
func (l *Limiter) Cleanup() {
	l.mu.Lock()
	defer l.mu.Unlock()

	cutoff := time.Now().Add(-2 * l.window)
	for key, b := range l.buckets {
		if b.lastRefill.Before(cutoff) {
			delete(l.buckets, key)
		}
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
