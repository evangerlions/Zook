-- LightTick 初始数据库 Schema
-- 创建时间: 2026-08-30

-- 用户表
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supabase_uid UUID UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE,
    nickname VARCHAR(100),
    is_guest BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 目标表
CREATE TABLE goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    template_type VARCHAR(20),
    deadline DATE,
    status VARCHAR(20) DEFAULT 'draft', -- draft, active, paused, recovering, completed, archived
    progress FLOAT DEFAULT 0,
    paused_at TIMESTAMPTZ,
    resume_date TIMESTAMPTZ,
    pause_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 阶段计划表
CREATE TABLE stage_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    milestones JSONB DEFAULT '[]',
    generated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 月计划表
CREATE TABLE month_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    stage_plan_id UUID REFERENCES stage_plans(id) ON DELETE SET NULL,
    year INT NOT NULL,
    month INT NOT NULL,
    focus_area TEXT,
    weekly_breakdown JSONB DEFAULT '[]',
    total_estimated_min INT DEFAULT 0,
    status VARCHAR(20) DEFAULT 'draft',
    generated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(goal_id, year, month)
);

-- 周计划表
CREATE TABLE week_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    month_plan_id UUID REFERENCES month_plans(id) ON DELETE SET NULL,
    week_number INT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    focus TEXT,
    tasks JSONB DEFAULT '[]',
    total_estimated_min INT DEFAULT 0,
    target_sessions INT DEFAULT 4,
    target_minutes INT DEFAULT 120,
    commitment_mode VARCHAR(20) DEFAULT 'standard',
    status VARCHAR(20) DEFAULT 'draft',
    generated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 日计划表
CREATE TABLE day_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    plan_date DATE NOT NULL,
    tasks JSONB DEFAULT '[]',
    total_estimated_min INT DEFAULT 0,
    auto_generated BOOLEAN DEFAULT FALSE,
    generated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(goal_id, plan_date)
);

-- 任务表
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID,
    goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    steps JSONB DEFAULT '[]',
    estimated_minutes INT NOT NULL,
    actual_minutes INT,
    difficulty VARCHAR(10) DEFAULT 'medium',
    status VARCHAR(20) DEFAULT 'pending',
    lineage_id UUID,
    selected_variant VARCHAR(20) DEFAULT 'standard',
    scheduled_date DATE,
    completed_at TIMESTAMPTZ,
    skip_reason VARCHAR(50),
    notes TEXT,
    is_baseline BOOLEAN DEFAULT FALSE,
    is_core BOOLEAN DEFAULT TRUE,
    is_optional BOOLEAN DEFAULT FALSE,
    is_quickstart BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 执行事件表（用于事件溯源和数据分析）
CREATE TABLE execution_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
    goal_id UUID REFERENCES goals(id) ON DELETE SET NULL,
    event_type VARCHAR(50) NOT NULL,
    context JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_users_supabase_uid ON users(supabase_uid);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_goals_user_id ON goals(user_id);
CREATE INDEX idx_goals_status ON goals(status);
CREATE INDEX idx_stage_plans_goal_id ON stage_plans(goal_id);
CREATE INDEX idx_month_plans_goal_id ON month_plans(goal_id);
CREATE INDEX idx_week_plans_goal_id ON week_plans(goal_id);
CREATE INDEX idx_day_plans_goal_id ON day_plans(goal_id);
CREATE INDEX idx_tasks_goal_id ON tasks(goal_id);
CREATE INDEX idx_tasks_lineage_id ON tasks(lineage_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_execution_events_user_id ON execution_events(user_id);
CREATE INDEX idx_execution_events_goal_id ON execution_events(goal_id);
CREATE INDEX idx_execution_events_event_type ON execution_events(event_type);
CREATE INDEX idx_execution_events_created_at ON execution_events(created_at);
