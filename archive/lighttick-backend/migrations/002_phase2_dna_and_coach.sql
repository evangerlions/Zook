-- Phase 2: 执行 DNA 与 AI Coach 对话系统
-- 创建时间: 2026-08-30

-- DNA 洞察表
CREATE TABLE dna_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category VARCHAR(50) NOT NULL, -- time_preference, pattern, difficulty, recovery
    title VARCHAR(255) NOT NULL,
    description TEXT,
    evidence_count INT NOT NULL DEFAULT 0,
    confidence FLOAT NOT NULL DEFAULT 0.0,
    scope VARCHAR(50) DEFAULT 'user', -- user, goal, task_type
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    user_feedback VARCHAR(20), -- confirmed, rejected, corrected
    user_correction TEXT,
    allowed_effects JSONB DEFAULT '[]', -- 该洞察允许影响的功能
    is_stable BOOLEAN DEFAULT FALSE, -- 是否为稳定规律
    metadata JSONB DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 聊天消息表
CREATE TABLE chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    goal_id UUID REFERENCES goals(id) ON DELETE SET NULL,
    role VARCHAR(20) NOT NULL, -- user, assistant, system
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 聊天会话表
CREATE TABLE chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    goal_id UUID REFERENCES goals(id) ON DELETE SET NULL,
    title VARCHAR(255),
    context JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- AI 建议追踪表
CREATE TABLE ai_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    insight_id UUID REFERENCES dna_insights(id) ON DELETE SET NULL,
    suggestion_type VARCHAR(50) NOT NULL, -- task_order, schedule, difficulty, recovery_day
    context JSONB DEFAULT '{}',
    proposed_changes JSONB DEFAULT '{}',
    user_action VARCHAR(20), -- accepted, rejected, edited
    outcome JSONB DEFAULT '{}', -- 后续执行效果
    created_at TIMESTAMPTZ DEFAULT NOW(),
    acted_at TIMESTAMPTZ
);

-- 执行事件聚合表（用于快速查询）
CREATE TABLE execution_aggregations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    aggregation_type VARCHAR(50) NOT NULL, -- daily, weekly, monthly
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    total_tasks INT DEFAULT 0,
    completed_tasks INT DEFAULT 0,
    skipped_tasks INT DEFAULT 0,
    total_minutes INT DEFAULT 0,
    avg_completion_rate FLOAT DEFAULT 0.0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, aggregation_type, period_start)
);

-- 索引
CREATE INDEX idx_dna_insights_user_id ON dna_insights(user_id);
CREATE INDEX idx_dna_insights_category ON dna_insights(category);
CREATE INDEX idx_dna_insights_confidence ON dna_insights(confidence);
CREATE INDEX idx_chat_messages_user_id ON chat_messages(user_id);
CREATE INDEX idx_chat_messages_goal_id ON chat_messages(goal_id);
CREATE INDEX idx_chat_messages_created_at ON chat_messages(created_at);
CREATE INDEX idx_chat_sessions_user_id ON chat_sessions(user_id);
CREATE INDEX idx_chat_sessions_goal_id ON chat_sessions(goal_id);
CREATE INDEX idx_ai_suggestions_user_id ON ai_suggestions(user_id);
CREATE INDEX idx_ai_suggestions_insight_id ON ai_suggestions(insight_id);
CREATE INDEX idx_ai_suggestions_created_at ON ai_suggestions(created_at);
CREATE INDEX idx_execution_aggregations_user_id ON execution_aggregations(user_id);
CREATE INDEX idx_execution_aggregations_type ON execution_aggregations(aggregation_type);
CREATE INDEX idx_execution_aggregations_period ON execution_aggregations(period_start, period_end);
