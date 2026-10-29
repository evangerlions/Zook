type Query=(sql:string,values?:unknown[])=>Promise<{rows:Record<string,unknown>[]} >;
export async function readLightTickOperationalSummary(query:Query):Promise<Record<string,number>>{
    const result = await query(`SELECT
      (SELECT COUNT(*) FROM zook_lighttick_profiles WHERE app_id='lighttick') AS profiles,
      (SELECT COUNT(*) FROM zook_lighttick_profiles WHERE app_id='lighttick' AND onboarding_state='completed') AS onboarding_completed,
      (SELECT COUNT(*) FROM zook_lighttick_goals WHERE app_id='lighttick') AS goals,
      (SELECT COUNT(*) FROM zook_lighttick_plan_cycles WHERE app_id='lighttick') AS plans,
      (SELECT COUNT(*) FROM zook_lighttick_execution_events WHERE app_id='lighttick' AND event_type='plan_confirmed') AS plan_confirmations,
      (SELECT COUNT(*) FROM zook_lighttick_tasks WHERE app_id='lighttick') AS tasks,
      (SELECT COUNT(*) FROM zook_lighttick_execution_events WHERE app_id='lighttick' AND aggregate_type='task' AND event_type LIKE 'task_%') AS task_actions,
      (SELECT COUNT(*) FROM zook_lighttick_reviews WHERE app_id='lighttick') AS reviews,
      (SELECT COUNT(*) FROM zook_lighttick_change_proposals WHERE app_id='lighttick' AND status='pending') AS pending_proposals,
      (SELECT COUNT(*) FROM zook_lighttick_change_proposals WHERE app_id='lighttick' AND status='accepted') AS proposals_accepted,
      (SELECT COUNT(*) FROM zook_lighttick_ai_runs WHERE app_id='lighttick') AS ai_runs,
      (SELECT COUNT(*) FROM zook_lighttick_ai_runs WHERE app_id='lighttick' AND status='failed') AS ai_failures,
      (SELECT COUNT(*) FROM zook_lighttick_ai_runs WHERE app_id='lighttick' AND error_code='LIGHTTICK_AI_RUN_FAILED') AS ai_schema_failures,
      (SELECT COALESCE(ROUND(AVG(latency_ms)),0) FROM zook_lighttick_ai_runs WHERE app_id='lighttick' AND latency_ms IS NOT NULL) AS ai_average_latency_ms,
      (SELECT COALESCE(SUM((usage->>'totalTokens')::BIGINT),0) FROM zook_lighttick_ai_runs WHERE app_id='lighttick') AS ai_total_tokens,
      (SELECT COUNT(*) FROM zook_lighttick_operations WHERE app_id='lighttick' AND status='conflict') AS sync_conflicts,
      (SELECT COUNT(*) FROM zook_lighttick_operations WHERE app_id='lighttick' AND entity_type='notification' AND status<>'accepted') AS notification_failures,
      (SELECT COUNT(*) FROM zook_lighttick_devices WHERE app_id='lighttick' AND active=TRUE) AS active_devices`);
    return Object.fromEntries(Object.entries(result.rows[0] ?? {}).map(([key, value]) => [key, Number(value)]));
  }
