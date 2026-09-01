create unique index if not exists analyses_base_fingerprint_locale_unique
on public.analyses (
  user_id,
  relationship_id,
  (input_metadata->>'analysis_fingerprint'),
  (input_metadata->>'score_version'),
  (input_metadata->>'locale')
)
where mode = 'analysis'
  and status = 'completed'
  and relationship_id is not null
  and input_metadata->>'analysis_fingerprint' is not null
  and coalesce(input_metadata->>'topic_id', '') = '';
