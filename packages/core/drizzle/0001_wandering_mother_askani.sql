ALTER TABLE `snapshots` ADD `renderer_name` varchar(64);--> statement-breakpoint
ALTER TABLE `snapshots` ADD `renderer_metadata` json;