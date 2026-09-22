package ai

import (
	"fmt"
	"math"
)

// ConstraintValidator validates AI-generated plans against business rules
type ConstraintValidator struct {
	MaxHoursPerWeek  int
	MaxHoursPerDay   int
	MaxTasksPerWeek  int
	MaxTasksPerDay   int
	MaxTaskDuration  int
	MinTaskDuration  int
}

// DefaultValidator returns a validator with sensible defaults
func DefaultValidator() *ConstraintValidator {
	return &ConstraintValidator{
		MaxHoursPerWeek:  40,
		MaxHoursPerDay:   8,
		MaxTasksPerWeek:  15,
		MaxTasksPerDay:   8,
		MaxTaskDuration:  120,
		MinTaskDuration:  5,
	}
}

// ValidationResult holds the result of constraint validation
type ValidationResult struct {
	Valid  bool
	Reason string
}

// Validate checks a plan against constraints
func (v *ConstraintValidator) Validate(plan map[string]interface{}) ValidationResult {
	// Check weeks array
	weeks, ok := plan["weeks"].([]interface{})
	if !ok {
		return ValidationResult{Valid: false, Reason: "missing weeks array"}
	}

	if len(weeks) > 4 {
		return ValidationResult{Valid: false, Reason: "too many weeks (max 4)"}
	}

	// Check total hours
	totalMinutes := 0
	totalTasks := 0

	for i, w := range weeks {
		week, ok := w.(map[string]interface{})
		if !ok {
			return ValidationResult{Valid: false, Reason: fmt.Sprintf("week %d is not an object", i)}
		}

		// Check tasks
		tasks, ok := week["tasks"].([]interface{})
		if !ok {
			return ValidationResult{Valid: false, Reason: fmt.Sprintf("week %d missing tasks", i+1)}
		}

		if len(tasks) > 7 {
			return ValidationResult{Valid: false, Reason: fmt.Sprintf("week %d has too many tasks (max 7)", i+1)}
		}

		if len(tasks) < 1 {
			return ValidationResult{Valid: false, Reason: fmt.Sprintf("week %d has no tasks", i+1)}
		}

		weekMinutes := 0
		for _, t := range tasks {
			task, ok := t.(map[string]interface{})
			if !ok {
				return ValidationResult{Valid: false, Reason: "task is not an object"}
			}

			// Task duration
			duration, ok := task["duration_minutes"].(float64)
			if !ok {
				return ValidationResult{Valid: false, Reason: fmt.Sprintf("task '%v' missing duration_minutes", task["title"])}
			}

			if int(duration) > v.MaxTaskDuration {
				return ValidationResult{Valid: false, Reason: fmt.Sprintf("task '%v' duration %d exceeds max %d", task["title"], int(duration), v.MaxTaskDuration)}
			}

			if int(duration) < v.MinTaskDuration {
				return ValidationResult{Valid: false, Reason: fmt.Sprintf("task '%v' duration %d below min %d", task["title"], int(duration), v.MinTaskDuration)}
			}

			weekMinutes += int(duration)
		}

		totalMinutes += weekMinutes
		totalTasks += len(tasks)

		// Check weekly hours
		weekHours := int(math.Ceil(float64(weekMinutes) / 60.0))
		if estHours, ok := week["estimated_hours"].(float64); ok {
			if int(estHours) > v.MaxHoursPerWeek {
				return ValidationResult{Valid: false, Reason: fmt.Sprintf("week %d estimated hours %d exceeds max %d", i+1, int(estHours), v.MaxHoursPerWeek)}
			}
		}
	}

	// Check total weekly hours
	totalHours := int(math.Ceil(float64(totalMinutes) / 60.0))
	if totalHours > v.MaxHoursPerWeek {
		return ValidationResult{Valid: false, Reason: fmt.Sprintf("total hours %d exceeds weekly max %d", totalHours, v.MaxHoursPerWeek)}
	}

	if totalTasks > v.MaxTasksPerWeek {
		return ValidationResult{Valid: false, Reason: fmt.Sprintf("total tasks %d exceeds max %d", totalTasks, v.MaxTasksPerWeek)}
	}

	return ValidationResult{Valid: true}
}
