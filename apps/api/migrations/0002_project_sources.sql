CREATE TABLE `project_sources` (
	`project_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`filename` text,
	`text` text NOT NULL,
	`chars` integer NOT NULL,
	`analysis_json` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_sources_kind_ck" CHECK("project_sources"."kind" in ('paste','txt','md','docx','pdf','csv','json'))
);
--> statement-breakpoint
CREATE INDEX `project_sources_ws_idx` ON `project_sources` (`workspace_id`);
--> statement-breakpoint
INSERT OR IGNORE INTO system_settings (key, value) VALUES
  ('quota.exports_per_month', '500'),
  ('quota.outputs_per_project', '200');
