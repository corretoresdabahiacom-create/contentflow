ALTER TABLE `reports` ADD `urgent` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `reports` ADD `target_workspace_id` text;
--> statement-breakpoint
ALTER TABLE `reports` ADD `owner_notified_at` integer;
--> statement-breakpoint
ALTER TABLE `reports` ADD `resolution` text;
--> statement-breakpoint
ALTER TABLE `reports` ADD `resolution_note` text;
--> statement-breakpoint
ALTER TABLE `reports` ADD `reviewer_id` text;
--> statement-breakpoint
ALTER TABLE `reports` ADD `reporter_ip_hash` text;
--> statement-breakpoint
CREATE INDEX `reports_ws_idx` ON `reports` (`target_workspace_id`);
--> statement-breakpoint
CREATE INDEX `processing_jobs_updated_idx` ON `processing_jobs` (`status`,`updated_at`);
--> statement-breakpoint
INSERT OR IGNORE INTO system_settings (key, value) VALUES
  ('rate_limit.report.max', '5'),
  ('rate_limit.report.window_s', '3600'),
  ('report.retention_days', '180'),
  ('job.stuck_after_s', '3600');
