TRUNCATE TABLE `share_links`;--> statement-breakpoint
ALTER TABLE `share_links` DROP INDEX `share_links_snapshot_active_unique`;--> statement-breakpoint
ALTER TABLE `share_links` DROP COLUMN `snapshot_id_active`;--> statement-breakpoint
ALTER TABLE `share_links` DROP FOREIGN KEY `share_links_snapshot_id_snapshots_id_fk`;--> statement-breakpoint
ALTER TABLE `share_links` DROP COLUMN `snapshot_id`;--> statement-breakpoint
ALTER TABLE `share_links` DROP COLUMN `allow_external_api`;--> statement-breakpoint
ALTER TABLE `share_links` DROP COLUMN `external_api_allowlist`;--> statement-breakpoint
ALTER TABLE `share_links` ADD COLUMN `version_id` varchar(36) NOT NULL;--> statement-breakpoint
ALTER TABLE `share_links` ADD CONSTRAINT `share_links_version_id_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `versions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `share_links` ADD COLUMN `version_id_active` varchar(36) GENERATED ALWAYS AS ((CASE WHEN `revoked_at` IS NULL THEN `version_id` END)) VIRTUAL;--> statement-breakpoint
CREATE UNIQUE INDEX `share_links_version_active_unique` ON `share_links` (`version_id_active`);
