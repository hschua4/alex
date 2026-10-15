CREATE TABLE IF NOT EXISTS "invite_code" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "invite_code" text;--> statement-breakpoint
UPDATE "app_meta" SET "value" = '0006', "updated_at" = now() WHERE "key" = 'schema_version';
