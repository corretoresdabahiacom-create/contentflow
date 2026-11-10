ALTER TABLE `approvals` ADD `output_version` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `approvals_pending_uq` ON `approvals` (`output_id`) WHERE `status` = 'pending';
--> statement-breakpoint
CREATE UNIQUE INDEX `brand_kits_client_uq` ON `brand_kits` (`client_id`);
--> statement-breakpoint
CREATE INDEX `editorial_calendar_client_idx` ON `editorial_calendar` (`client_id`,`scheduled_for`);
--> statement-breakpoint
INSERT OR IGNORE INTO system_settings (key, value) VALUES
  ('quota.workspaces_per_user', '3'),
  ('quota.calendar_per_workspace', '500'),
  ('quota.shared_links_per_workspace', '50'),
  ('shared_link.log_retention_days', '90');
