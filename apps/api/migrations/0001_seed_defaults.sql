-- Dados-semente obrigatórios (R7: monetização sempre desligada; feature flags e limites padrão).
INSERT INTO feature_flags (key, enabled, description) VALUES
  ('monetization_enabled', 0, 'R7: pagamentos desativados; /billing/* retorna 404'),
  ('video_render_enabled', 0, 'Renderização de vídeo experimental (Fase 5); só admin global ativa'),
  ('wasm_transcription_enabled', 0, 'Transcrição WASM no navegador (Fase 3)'),
  ('ai_external_enabled', 0, 'Adaptador de IA externa; desligado por padrão');
--> statement-breakpoint
INSERT INTO system_settings (key, value) VALUES
  ('rate_limit.login.max', '10'),
  ('rate_limit.login.window_s', '600'),
  ('rate_limit.register.max', '5'),
  ('rate_limit.register.window_s', '3600'),
  ('session.ttl_s', '2592000'),
  ('session.rotate_after_s', '86400'),
  ('quota.projects_per_workspace', '100'),
  ('quota.members_per_workspace', '10'),
  ('quota.clients_per_workspace', '10');
