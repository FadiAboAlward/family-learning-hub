update public.workspace_settings
set value = jsonb_set(jsonb_set(value,'{heartbeat_seconds}','60'::jsonb,true),'{inactivity_minutes}','10'::jsonb,true), updated_at=now()
where workspace_id='55f9224c-8ba7-4cbc-9f88-713e6a6b41df' and key='tracking.learning_sessions';
