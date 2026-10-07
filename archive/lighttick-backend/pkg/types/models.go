package types

import "time"

type TaskStatus string

const (
	TaskPending     TaskStatus = "pending"
	TaskActive      TaskStatus = "active"
	TaskCompleted   TaskStatus = "completed"
	TaskSkipped     TaskStatus = "skipped"
	TaskDeferred    TaskStatus = "deferred"
	TaskRescheduled TaskStatus = "rescheduled"
)

type Difficulty string

const (
	DifficultyLow    Difficulty = "low"
	DifficultyMedium Difficulty = "medium"
	DifficultyHigh   Difficulty = "high"
)

type TaskType string

const (
	TaskTypeStudy    TaskType = "study"
	TaskTypePractice TaskType = "practice"
	TaskTypeProject  TaskType = "project"
	TaskTypeReview   TaskType = "review"
	TaskTypeQuiz     TaskType = "quiz"
)

type PlanStatus string

const (
	PlanDraft    PlanStatus = "draft"
	PlanActive   PlanStatus = "active"
	PlanComplete PlanStatus = "complete"
	PlanArchived PlanStatus = "archived"
)

type GoalStatus string

const (
	GoalDraft      GoalStatus = "draft"
	GoalActive     GoalStatus = "active"
	GoalComplete   GoalStatus = "complete"
	GoalArchived   GoalStatus = "archived"
)

type CompletionAction string

const (
	ActionCompleted CompletionAction = "completed"
	ActionSkipped   CompletionAction = "skipped"
	ActionDeferred  CompletionAction = "deferred"
)

// Goal represents a long-term goal (e.g., "pass iOS exam in 3 months")
type Goal struct {
	ID                  int64      `json:"id"`
	UserID              string     `json:"user_id"`
	Title               string     `json:"title"`
	Description         string     `json:"description"`
	DurationMonths      int        `json:"duration_months"`
	CurrentLevel        string     `json:"current_level"`
	WeeklyHours         int        `json:"weekly_hours"`
	LearningPace        string     `json:"learning_pace"` // compact|balanced|relaxed
	MotivationStatement string     `json:"motivation_statement"`
	Status              GoalStatus `json:"status"`
	CreatedAt           time.Time  `json:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at"`
}

// MonthPlan represents a 30-day plan for a goal
type MonthPlan struct {
	ID         int64      `json:"id"`
	GoalID     int64      `json:"goal_id"`
	MonthIndex int        `json:"month_index"`
	Goal       string     `json:"goal"`
	Status     PlanStatus `json:"status"`
	CreatedAt  time.Time  `json:"created_at"`
}

// WeekPlan represents a week within a month plan
type WeekPlan struct {
	ID             int64      `json:"id"`
	MonthPlanID    int64      `json:"month_plan_id"`
	WeekIndex      int        `json:"week_index"`
	Goal           string     `json:"goal"`
	Milestone      string     `json:"milestone"`
	EstimatedHours int        `json:"estimated_hours"`
	Status         PlanStatus `json:"status"`
	CreatedAt      time.Time  `json:"created_at"`
}

// Task represents a single executable task
type Task struct {
	ID              int64      `json:"id"`
	WeekPlanID      int64      `json:"week_plan_id"`
	Title           string     `json:"title"`
	DurationMinutes int        `json:"duration_minutes"`
	Difficulty      Difficulty `json:"difficulty"`
	Type            TaskType   `json:"type"`
	Status          TaskStatus `json:"status"`
	DependsOn       []int64    `json:"depends_on"`     // task IDs this depends on
	ParentTaskID    *int64     `json:"parent_task_id"` // for subtasks
	CreatedAt       time.Time  `json:"created_at"`
	CompletedAt     *time.Time `json:"completed_at"`
	SkipReason      string     `json:"skip_reason"`
	RescheduleCount int        `json:"reschedule_count"`
}

// User represents a user (managed via Supabase Auth, synced here for convenience)
type User struct {
	ID           string    `json:"id"` // Supabase auth user ID
	Email        string    `json:"email"`
	AuthProvider string    `json:"auth_provider"`
	CreatedAt    time.Time `json:"created_at"`
	LastActive   time.Time `json:"last_active"`
}

// CompletionHistory is an append-only log of all task actions
type CompletionHistory struct {
	ID        int64            `json:"id"`
	UserID    string           `json:"user_id"`
	TaskID    int64            `json:"task_id"`
	Timestamp time.Time        `json:"timestamp"`
	Action    CompletionAction `json:"action"`
	Context   string           `json:"context"` // JSON blob with additional context
}

// SyncItem represents a queued sync operation from offline client
type SyncItem struct {
	ID       int64     `json:"id"`
	UserID   string    `json:"user_id"`
	Action   string    `json:"action"` // complete/skip/defer/reschedule
	TaskID   int64     `json:"task_id"`
	Payload  string    `json:"payload"` // JSON blob
	ClientTS time.Time `json:"client_ts"`
	ServerTS time.Time `json:"server_ts"`
	Status   string    `json:"status"` // pending/resolved/conflict
}
