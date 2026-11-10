ALTER TABLE `processing_jobs` ADD `payload_json` text;
--> statement-breakpoint
ALTER TABLE `processing_jobs` ADD `origin` text;
--> statement-breakpoint
ALTER TABLE `processing_jobs` ADD `transcript_id` text REFERENCES transcripts(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX `transcripts_ws_idx` ON `transcripts` (`workspace_id`);
--> statement-breakpoint
INSERT OR IGNORE INTO system_settings (key, value) VALUES
  ('quota.transcripts_per_month', '200'),
  ('quota.active_jobs_per_project', '5'),
  ('job.stale_after_s', '604800');
