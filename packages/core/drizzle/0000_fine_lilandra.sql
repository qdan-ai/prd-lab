CREATE TABLE `api_tokens` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`token_hash` char(64) NOT NULL,
	`token_prefix` varchar(12) NOT NULL,
	`scopes` json NOT NULL,
	`last_used_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`revoked_at` datetime(3),
	CONSTRAINT `api_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `api_tokens_token_hash_unique` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`key` varchar(128) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`response_json` json NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `idempotency_keys_key_user_id_pk` PRIMARY KEY(`key`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`owner_id` varchar(36) NOT NULL,
	`visibility` enum('private','team') NOT NULL DEFAULT 'private',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`archived_at` datetime(3),
	`name_active` varchar(255) GENERATED ALWAYS AS ((CASE WHEN `archived_at` IS NULL THEN `name` END)) VIRTUAL,
	CONSTRAINT `projects_id` PRIMARY KEY(`id`),
	CONSTRAINT `projects_owner_name_active_unique` UNIQUE(`owner_id`,`name_active`)
);
--> statement-breakpoint
CREATE TABLE `share_links` (
	`id` varchar(32) NOT NULL,
	`snapshot_id` varchar(36) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`password_version` int NOT NULL DEFAULT 1,
	`allow_external_api` boolean NOT NULL DEFAULT false,
	`external_api_allowlist` json NOT NULL,
	`created_by` varchar(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`revoked_at` datetime(3),
	`snapshot_id_active` varchar(36) GENERATED ALWAYS AS ((CASE WHEN `revoked_at` IS NULL THEN `snapshot_id` END)) VIRTUAL,
	CONSTRAINT `share_links_id` PRIMARY KEY(`id`),
	CONSTRAINT `share_links_snapshot_active_unique` UNIQUE(`snapshot_id_active`)
);
--> statement-breakpoint
CREATE TABLE `snapshot_files` (
	`id` varchar(36) NOT NULL,
	`snapshot_id` varchar(36) NOT NULL,
	`rel_path` varchar(700) NOT NULL,
	`s3_key` varchar(1024) NOT NULL,
	`content_type` varchar(128) NOT NULL,
	`size_bytes` bigint NOT NULL,
	`sha256` char(64) NOT NULL,
	CONSTRAINT `snapshot_files_id` PRIMARY KEY(`id`),
	CONSTRAINT `snapshot_files_snapshot_relpath_unique` UNIQUE(`snapshot_id`,`rel_path`)
);
--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` varchar(36) NOT NULL,
	`version_id` varchar(36) NOT NULL,
	`seq_no` int NOT NULL,
	`entry_html_path` varchar(512) NOT NULL DEFAULT 'index.html',
	`total_size_bytes` bigint NOT NULL,
	`file_count` int NOT NULL,
	`content_sha256` char(64) NOT NULL,
	`uploader_id` varchar(36) NOT NULL,
	`uploader_type` enum('user','mcp','cli') NOT NULL DEFAULT 'user',
	`change_note` text NOT NULL,
	`version_label` varchar(64),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`archived_at` datetime(3),
	`archived_by` varchar(36),
	`version_label_active` varchar(64) GENERATED ALWAYS AS ((CASE WHEN `archived_at` IS NULL AND `version_label` IS NOT NULL THEN `version_label` END)) VIRTUAL,
	CONSTRAINT `snapshots_id` PRIMARY KEY(`id`),
	CONSTRAINT `snapshots_version_seq_unique` UNIQUE(`version_id`,`seq_no`),
	CONSTRAINT `snapshots_version_label_active_unique` UNIQUE(`version_id`,`version_label_active`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`email` varchar(255),
	`password_hash` varchar(255),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`archived_at` datetime(3),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `versions` (
	`id` varchar(36) NOT NULL,
	`project_id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`seq_no` int NOT NULL,
	`created_by` varchar(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`archived_at` datetime(3),
	CONSTRAINT `versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `versions_project_name_unique` UNIQUE(`project_id`,`name`),
	CONSTRAINT `versions_project_seq_unique` UNIQUE(`project_id`,`seq_no`)
);
--> statement-breakpoint
ALTER TABLE `api_tokens` ADD CONSTRAINT `api_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `idempotency_keys` ADD CONSTRAINT `idempotency_keys_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `projects` ADD CONSTRAINT `projects_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `share_links` ADD CONSTRAINT `share_links_snapshot_id_snapshots_id_fk` FOREIGN KEY (`snapshot_id`) REFERENCES `snapshots`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `share_links` ADD CONSTRAINT `share_links_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `snapshot_files` ADD CONSTRAINT `snapshot_files_snapshot_id_snapshots_id_fk` FOREIGN KEY (`snapshot_id`) REFERENCES `snapshots`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `snapshots` ADD CONSTRAINT `snapshots_version_id_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `versions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `snapshots` ADD CONSTRAINT `snapshots_uploader_id_users_id_fk` FOREIGN KEY (`uploader_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `snapshots` ADD CONSTRAINT `snapshots_archived_by_users_id_fk` FOREIGN KEY (`archived_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `versions` ADD CONSTRAINT `versions_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `versions` ADD CONSTRAINT `versions_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `api_tokens_user_revoked_idx` ON `api_tokens` (`user_id`,`revoked_at`);