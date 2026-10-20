CREATE TABLE `merge_requests` (
	`id` varchar(36) NOT NULL,
	`project_id` varchar(36) NOT NULL,
	`seq` int NOT NULL,
	`line` varchar(64) NOT NULL,
	`author_id` varchar(36) NOT NULL,
	`title` varchar(255) NOT NULL,
	`note` text,
	`items` json,
	`snapshot_id` varchar(36) NOT NULL,
	`base_rev` int NOT NULL,
	`status` enum('open','merged','returned','withdrawn') NOT NULL DEFAULT 'open',
	`withdraw_reason` enum('author','member_removed'),
	`return_note` text,
	`decided_by` varchar(36),
	`decided_at` datetime(3),
	`merged_rev` int,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`renumber_map` json,
	CONSTRAINT `merge_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `merge_requests_project_seq_unique` UNIQUE(`project_id`,`seq`)
);
--> statement-breakpoint
CREATE TABLE `project_members` (
	`id` varchar(36) NOT NULL,
	`project_id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`role` enum('lead','admin','member') NOT NULL,
	`added_by` varchar(36),
	`added_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`removed_at` datetime(3),
	`removed_by` varchar(36),
	`user_id_active` varchar(36) GENERATED ALWAYS AS ((CASE WHEN `removed_at` IS NULL THEN `user_id` END)) VIRTUAL,
	CONSTRAINT `project_members_id` PRIMARY KEY(`id`),
	CONSTRAINT `project_members_project_user_active_unique` UNIQUE(`project_id`,`user_id_active`)
);
--> statement-breakpoint
CREATE TABLE `team_discussions` (
	`project_id` varchar(36) NOT NULL,
	`author_id` varchar(36) NOT NULL,
	`snapshot_id` varchar(36) NOT NULL,
	`pushed_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `team_discussions_project_id_author_id_pk` PRIMARY KEY(`project_id`,`author_id`)
);
--> statement-breakpoint
CREATE TABLE `team_events` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`project_id` varchar(36) NOT NULL,
	`actor_id` varchar(36),
	`type` varchar(64) NOT NULL,
	`payload` json,
	`at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `team_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `team_line_history` (
	`project_id` varchar(36) NOT NULL,
	`line` varchar(64) NOT NULL,
	`rev` int NOT NULL,
	`snapshot_id` varchar(36) NOT NULL,
	`reason` enum('init','merge','seal') NOT NULL,
	`mr_id` varchar(36),
	`by_user_id` varchar(36),
	`at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `team_line_history_project_id_line_rev_pk` PRIMARY KEY(`project_id`,`line`,`rev`)
);
--> statement-breakpoint
CREATE TABLE `team_lines` (
	`project_id` varchar(36) NOT NULL,
	`line` varchar(64) NOT NULL,
	`rev` int NOT NULL,
	`head_snapshot_id` varchar(36) NOT NULL,
	`base_version_key` varchar(128),
	`updated_by` varchar(36),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `team_lines_project_id_line_pk` PRIMARY KEY(`project_id`,`line`)
);
--> statement-breakpoint
CREATE TABLE `team_progress` (
	`project_id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`device_id` varchar(64) NOT NULL,
	`line` varchar(64) NOT NULL,
	`base_rev` int NOT NULL,
	`summary` json,
	`pushed_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `team_progress_project_id_user_id_device_id_line_pk` PRIMARY KEY(`project_id`,`user_id`,`device_id`,`line`)
);
--> statement-breakpoint
CREATE TABLE `team_sealing` (
	`project_id` varchar(36) NOT NULL,
	`line` varchar(64) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`device_id` varchar(64) NOT NULL,
	`since` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`seen_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `team_sealing_project_id_line_user_id_device_id_pk` PRIMARY KEY(`project_id`,`line`,`user_id`,`device_id`)
);
--> statement-breakpoint
ALTER TABLE `repo_blobs` ADD `git_oid` char(40);--> statement-breakpoint
ALTER TABLE `repo_state` ADD `team_version_id` varchar(36);--> statement-breakpoint
ALTER TABLE `repo_state` ADD `team_since` datetime(3);--> statement-breakpoint
ALTER TABLE `repo_state` ADD `team_ready_at` datetime(3);--> statement-breakpoint
ALTER TABLE `repo_state` ADD `state_rev` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `repo_state` ADD `id_ledger` json;--> statement-breakpoint
ALTER TABLE `repo_state` ADD `team_client_format` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `repo_state` ADD `start_team_snapshot_id` varchar(36);--> statement-breakpoint
ALTER TABLE `repo_versions` ADD `team_snapshot_id` varchar(36);--> statement-breakpoint
ALTER TABLE `repo_versions` ADD `commit_raw_b64` mediumtext;--> statement-breakpoint
ALTER TABLE `repo_versions` ADD `team_record` json;--> statement-breakpoint
ALTER TABLE `snapshot_files` ADD `git_mode` char(6);--> statement-breakpoint
ALTER TABLE `snapshot_files` ADD `git_oid` char(40);--> statement-breakpoint
ALTER TABLE `snapshots` ADD `audience` enum('guest','team') DEFAULT 'guest' NOT NULL;--> statement-breakpoint
ALTER TABLE `repo_state` ADD CONSTRAINT `repo_state_team_version_id_unique` UNIQUE(`team_version_id`);--> statement-breakpoint
ALTER TABLE `merge_requests` ADD CONSTRAINT `merge_requests_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `merge_requests` ADD CONSTRAINT `merge_requests_author_id_users_id_fk` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `merge_requests` ADD CONSTRAINT `merge_requests_snapshot_id_snapshots_id_fk` FOREIGN KEY (`snapshot_id`) REFERENCES `snapshots`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `merge_requests` ADD CONSTRAINT `merge_requests_decided_by_users_id_fk` FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_members` ADD CONSTRAINT `project_members_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_members` ADD CONSTRAINT `project_members_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_members` ADD CONSTRAINT `project_members_added_by_users_id_fk` FOREIGN KEY (`added_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_members` ADD CONSTRAINT `project_members_removed_by_users_id_fk` FOREIGN KEY (`removed_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `team_discussions` ADD CONSTRAINT `team_discussions_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `team_discussions` ADD CONSTRAINT `team_discussions_author_id_users_id_fk` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `team_discussions` ADD CONSTRAINT `team_discussions_snapshot_id_snapshots_id_fk` FOREIGN KEY (`snapshot_id`) REFERENCES `snapshots`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `team_events` ADD CONSTRAINT `team_events_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `team_events` ADD CONSTRAINT `team_events_actor_id_users_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `team_line_history` ADD CONSTRAINT `team_line_history_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `team_line_history` ADD CONSTRAINT `team_line_history_snapshot_id_snapshots_id_fk` FOREIGN KEY (`snapshot_id`) REFERENCES `snapshots`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `team_line_history` ADD CONSTRAINT `team_line_history_by_user_id_users_id_fk` FOREIGN KEY (`by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `team_lines` ADD CONSTRAINT `team_lines_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `team_lines` ADD CONSTRAINT `team_lines_head_snapshot_id_snapshots_id_fk` FOREIGN KEY (`head_snapshot_id`) REFERENCES `snapshots`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `team_lines` ADD CONSTRAINT `team_lines_updated_by_users_id_fk` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `team_progress` ADD CONSTRAINT `team_progress_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `team_progress` ADD CONSTRAINT `team_progress_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `team_sealing` ADD CONSTRAINT `team_sealing_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `team_sealing` ADD CONSTRAINT `team_sealing_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `merge_requests_project_status_idx` ON `merge_requests` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `project_members_user_idx` ON `project_members` (`user_id`);--> statement-breakpoint
CREATE INDEX `team_events_project_idx` ON `team_events` (`project_id`,`id`);--> statement-breakpoint
ALTER TABLE `repo_state` ADD CONSTRAINT `repo_state_team_version_id_versions_id_fk` FOREIGN KEY (`team_version_id`) REFERENCES `versions`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `repo_state` ADD CONSTRAINT `repo_state_start_team_snapshot_id_snapshots_id_fk` FOREIGN KEY (`start_team_snapshot_id`) REFERENCES `snapshots`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `repo_versions` ADD CONSTRAINT `repo_versions_team_snapshot_id_snapshots_id_fk` FOREIGN KEY (`team_snapshot_id`) REFERENCES `snapshots`(`id`) ON DELETE set null ON UPDATE no action;