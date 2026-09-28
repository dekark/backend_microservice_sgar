ALTER TABLE "resources" ADD COLUMN "image_s3_bucket" varchar(255);
--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN "image_s3_key" text;
--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN "image_mime_type" varchar(100);
--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN "image_file_size" bigint;
