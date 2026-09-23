package service

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/lighttick/lighttick-backend/internal/db"
)

// ExecutionAggregator 负责聚合执行事件并生成洞察
type ExecutionAggregator struct {
	queries *db.Queries
}

func NewExecutionAggregator(queries *db.Queries) *ExecutionAggregator {
	return &ExecutionAggregator{queries: queries}
}

// AggregateDailyStats 聚合每日统计数据
func (a *ExecutionAggregator) AggregateDailyStats(ctx context.Context, userID uuid.UUID, date time.Time) error {
	startOfDay := time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0, date.Location())
	endOfDay := startOfDay.Add(24 * time.Hour)

	// 获取当天的任务统计
	stats, err := a.queries.GetTaskStatsByDateRange(ctx, db.GetTaskStatsByDateRangeParams{
		UserID:    userID,
		StartDate: startOfDay,
		EndDate:   endOfDay,
	})
	if err != nil {
		return err
	}

	// 计算完成率
	completionRate := 0.0
	if stats.TotalTasks > 0 {
		completionRate = float64(stats.CompletedTasks) / float64(stats.TotalTasks)
	}

	// 创建或更新聚合数据
	_, err = a.queries.UpsertExecutionAggregation(ctx, db.CreateExecutionAggregationParams{
		UserID:            userID,
		AggregationType:   "daily",
		PeriodStart:       startOfDay,
		PeriodEnd:         endOfDay,
		TotalTasks:        stats.TotalTasks,
		CompletedTasks:    stats.CompletedTasks,
		SkippedTasks:      stats.SkippedTasks,
		TotalMinutes:      stats.TotalMinutes,
		AvgCompletionRate: completionRate,
		Metadata:          map[string]any{},
	})

	return err
}

// AggregateWeeklyStats 聚合每周统计数据
func (a *ExecutionAggregator) AggregateWeeklyStats(ctx context.Context, userID uuid.UUID, weekStart time.Time) error {
	endOfWeek := weekStart.Add(7 * 24 * time.Hour)

	// 获取本周的任务统计
	stats, err := a.queries.GetTaskStatsByDateRange(ctx, db.GetTaskStatsByDateRangeParams{
		UserID:    userID,
		StartDate: weekStart,
		EndDate:   endOfWeek,
	})
	if err != nil {
		return err
	}

	// 计算完成率
	completionRate := 0.0
	if stats.TotalTasks > 0 {
		completionRate = float64(stats.CompletedTasks) / float64(stats.TotalTasks)
	}

	// 创建或更新聚合数据
	_, err = a.queries.UpsertExecutionAggregation(ctx, db.CreateExecutionAggregationParams{
		UserID:            userID,
		AggregationType:   "weekly",
		PeriodStart:       weekStart,
		PeriodEnd:         endOfWeek,
		TotalTasks:        stats.TotalTasks,
		CompletedTasks:    stats.CompletedTasks,
		SkippedTasks:      stats.SkippedTasks,
		TotalMinutes:      stats.TotalMinutes,
		AvgCompletionRate: completionRate,
		Metadata:          map[string]any{},
	})

	return err
}

// GenerateTimePreferenceInsight 生成时间偏好洞察
func (a *ExecutionAggregator) GenerateTimePreferenceInsight(ctx context.Context, userID uuid.UUID) error {
	// 获取最近 14 天的每日聚合数据
	twoWeeksAgo := time.Now().AddDate(0, 0, -14)
	aggregations, err := a.queries.ListExecutionAggregations(ctx, db.ListExecutionAggregationsParams{
		UserID:          userID,
		AggregationType: "daily",
		Limit:           14,
		Offset:          0,
	})
	if err != nil {
		return err
	}

	if len(aggregations) < 7 {
		// 数据不足，不生成洞察
		return nil
	}

	// 分析哪几天完成率最高
	dayStats := make(map[string][]float64)
	for _, agg := range aggregations {
		if agg.PeriodStart.Before(twoWeeksAgo) {
			continue
		}
		dayName := agg.PeriodStart.Weekday().String()
		dayStats[dayName] = append(dayStats[dayName], agg.AvgCompletionRate)
	}

	// 找出表现最好的几天
	bestDays := []string{}
	for day, rates := range dayStats {
		avgRate := 0.0
		for _, rate := range rates {
			avgRate += rate
		}
		avgRate /= float64(len(rates))

		if avgRate > 0.7 {
			bestDays = append(bestDays, day)
		}
	}

	if len(bestDays) > 0 {
		title := "你在 " + bestDays[0] + " 表现最好"
		description := "根据最近两周的数据，你在 " + bestDays[0] + " 的平均完成率最高。"

		_, err = a.queries.CreateDNAInsight(ctx, db.CreateDNAInsightParams{
			UserID:         userID,
			Category:       "time_preference",
			Title:          title,
			Description:    &description,
			EvidenceCount:  len(aggregations),
			Confidence:     0.6,
			Scope:          "user",
			AllowedEffects: []string{"task_scheduling"},
			IsStable:       false,
			Metadata:       map[string]any{"best_days": bestDays},
		})
		if err != nil {
			return err
		}
	}

	return nil
}

// GenerateCompletionPatternInsight 生成完成率模式洞察
func (a *ExecutionAggregator) GenerateCompletionPatternInsight(ctx context.Context, userID uuid.UUID) error {
	// 获取最近 4 周的每周聚合数据
	aggregations, err := a.queries.ListExecutionAggregations(ctx, db.ListExecutionAggregationsParams{
		UserID:          userID,
		AggregationType: "weekly",
		Limit:           4,
		Offset:          0,
	})
	if err != nil {
		return err
	}

	if len(aggregations) < 3 {
		// 数据不足，不生成洞察
		return nil
	}

	// 分析完成率趋势
	trend := "stable"
	firstHalfAvg := 0.0
	secondHalfAvg := 0.0

	if len(aggregations) >= 4 {
		// 前两周
		for i := 2; i < 4; i++ {
			firstHalfAvg += aggregations[i].AvgCompletionRate
		}
		firstHalfAvg /= 2

		// 后两周
		for i := 0; i < 2; i++ {
			secondHalfAvg += aggregations[i].AvgCompletionRate
		}
		secondHalfAvg /= 2

		if secondHalfAvg > firstHalfAvg*1.1 {
			trend = "improving"
		} else if secondHalfAvg < firstHalfAvg*0.9 {
			trend = "declining"
		}
	}

	// 生成洞察
	var title, description string
	confidence := 0.5

	switch trend {
	case "improving":
		title = "你的完成率在提升"
		description = "最近两周的完成率比之前有所提高，继续保持！"
		confidence = 0.7
	case "declining":
		title = "你的完成率在下降"
		description = "最近两周的完成率有所下降，可能需要调整节奏或目标。"
		confidence = 0.7
	default:
		title = "你的完成率保持稳定"
		description = "最近几周的表现比较稳定。"
		confidence = 0.5
	}

	_, err = a.queries.CreateDNAInsight(ctx, db.CreateDNAInsightParams{
		UserID:         userID,
		Category:       "pattern",
		Title:          title,
		Description:    &description,
		EvidenceCount:  len(aggregations),
		Confidence:     confidence,
		Scope:          "user",
		AllowedEffects: []string{"goal_adjustment"},
		IsStable:       trend == "stable",
		Metadata:       map[string]any{"trend": trend},
	})

	return err
}
