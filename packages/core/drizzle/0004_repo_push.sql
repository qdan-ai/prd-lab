CREATE TABLE `repo_blobs` (
	`project_id` varchar(36) NOT NULL,
	`sha256` char(64) NOT NULL,
	`size_bytes` bigint NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `repo_blobs_project_id_sha256_pk` PRIMARY KEY(`project_id`,`sha256`)
);
--> statement-breakpoint
CREATE TABLE `repo_state` (
	`project_id` varchar(36) NOT NULL,
	`version_id` varchar(36) NOT NULL,
	`format` varchar(32),
	`online_key` varchar(128),
	`online_periods` json,
	`last_pushed_at` datetime(3),
	`last_pushed_by` varchar(36),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `repo_state_project_id` PRIMARY KEY(`project_id`),
	CONSTRAINT `repo_state_version_id_unique` UNIQUE(`version_id`)
);
--> statement-breakpoint
CREATE TABLE `repo_versions` (
	`id` varchar(36) NOT NULL,
	`project_id` varchar(36) NOT NULL,
	`key` varchar(128) NOT NULL,
	`snapshot_id` varchar(36) NOT NULL,
	`kind` enum('version','baseline','draft','hidden') NOT NULL,
	`number` varchar(64),
	`name` varchar(255),
	`summary` text,
	`line` varchar(64),
	`parent_key` varchar(128),
	`patch_of` varchar(128),
	`sealed_at` datetime(3),
	`changes` json,
	`spec_docs` json,
	`withdrawn_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `repo_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `repo_versions_project_key_unique` UNIQUE(`project_id`,`key`)
);
--> statement-breakpoint
ALTER TABLE `projects` ADD `kind` enum('upload','repo') DEFAULT 'upload' NOT NULL;--> statement-breakpoint
ALTER TABLE `repo_blobs` ADD CONSTRAINT `repo_blobs_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `repo_state` ADD CONSTRAINT `repo_state_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `repo_state` ADD CONSTRAINT `repo_state_version_id_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `versions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `repo_state` ADD CONSTRAINT `repo_state_last_pushed_by_users_id_fk` FOREIGN KEY (`last_pushed_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `repo_versions` ADD CONSTRAINT `repo_versions_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `repo_versions` ADD CONSTRAINT `repo_versions_snapshot_id_snapshots_id_fk` FOREIGN KEY (`snapshot_id`) REFERENCES `snapshots`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `repo_versions_snapshot_idx` ON `repo_versions` (`snapshot_id`);