-- Append-only, relationship-scoped five-dimension snapshots.
create table if not exists public.relationship_analysis_snapshots (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null unique references public.analyses(id) on delete cascade,
  relationship_id uuid not null references public.relationships(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  source_reference text,
  overall_score smallint not null check (overall_score between 0 and 100),
  topic_compatibility smallint not null check (topic_compatibility between 0 and 100),
  tempo_compatibility smallint not null check (tempo_compatibility between 0 and 100),
  interaction_balance smallint not null check (interaction_balance between 0 and 100),
  intimacy smallint not null check (intimacy between 0 and 100),
  excitement smallint not null check (excitement between 0 and 100),
  score_version text not null,
  analysis_version integer not null,
  data_window jsonb not null default '{}'::jsonb,
  summary text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  result jsonb not null
);

create index if not exists relationship_analysis_snapshots_relationship_created_idx on public.relationship_analysis_snapshots(relationship_id, created_at desc);
create index if not exists relationship_analysis_snapshots_user_created_idx on public.relationship_analysis_snapshots(user_id, created_at desc);

alter table public.relationship_analysis_snapshots enable row level security;
create policy "relationship_analysis_snapshots_read_own" on public.relationship_analysis_snapshots for select to authenticated using ((select auth.uid()) = user_id);

revoke insert, update, delete, truncate on public.relationship_analysis_snapshots from anon, authenticated;
grant select on public.relationship_analysis_snapshots to authenticated;
grant select, insert, update, delete, truncate, references, trigger on public.relationship_analysis_snapshots to service_role;

create or replace function public.capture_relationship_analysis_snapshot()
returns trigger language plpgsql security definer set search_path = '' as $$
declare d jsonb;
begin
  if new.mode <> 'analysis' or new.status <> 'completed' or new.relationship_id is null or coalesce((new.result->>'analysisVersion')::integer, 0) < 3 then return new; end if;
  d := new.result->'dimensions';
  insert into public.relationship_analysis_snapshots(analysis_id,relationship_id,user_id,created_at,source_reference,overall_score,topic_compatibility,tempo_compatibility,interaction_balance,intimacy,excitement,score_version,analysis_version,data_window,summary,metadata,result)
  values(new.id,new.relationship_id,new.user_id,coalesce(new.completed_at,new.created_at),new.input_metadata->>'source_reference',(new.result->>'overallScore')::smallint,(d->>'topic_compatibility')::smallint,(d->>'tempo_compatibility')::smallint,(d->>'interaction_balance')::smallint,(d->>'intimacy')::smallint,(d->>'excitement')::smallint,new.result->>'scoreVersion',(new.result->>'analysisVersion')::integer,coalesce(new.result->'dataWindow','{}'::jsonb),coalesce(new.result->>'overallReason',''),jsonb_build_object('source',new.input_metadata->>'source','event','analysis_snapshot_created'),new.result)
  on conflict (analysis_id) do nothing;
  return new;
end;
$$;

drop trigger if exists analyses_capture_relationship_snapshot on public.analyses;
create trigger analyses_capture_relationship_snapshot after insert or update of result,status on public.analyses for each row execute function public.capture_relationship_analysis_snapshot();

revoke all on function public.capture_relationship_analysis_snapshot() from public, anon, authenticated;
grant execute on function public.capture_relationship_analysis_snapshot() to service_role;
