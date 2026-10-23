ALTER TABLE `users` ADD `role` enum('admin','editor') DEFAULT 'editor' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `password_changed_at` datetime(3);--> statement-breakpoint
ALTER TABLE `users` ADD `credential_version` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `failed_login_count` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `login_failure_window_started_at` datetime(3);--> statement-breakpoint
ALTER TABLE `users` ADD `login_locked_until` datetime(3);--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_email_unique` UNIQUE(`email`);--> statement-breakpoint
-- 上线前核对这两个现有账号的 ID、邮箱唯一性与用户名；仅初始化一次，之后改名不改变角色。
UPDATE `users` SET `role` = 'admin' WHERE `name` IN ('dan', '李宏炜') AND `archived_at` IS NULL;