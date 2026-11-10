ALTER TABLE `clip_suggestions` ADD `notes` text;
--> statement-breakpoint
ALTER TABLE `clip_suggestions` ADD `version` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `clip_suggestions` ADD `origin` text DEFAULT 'heuristic' NOT NULL;
--> statement-breakpoint
ALTER TABLE `clip_suggestions` ADD `signals_json` text;
--> statement-breakpoint
INSERT OR IGNORE INTO system_settings (key, value) VALUES ('quota.clips_per_project', '100');
