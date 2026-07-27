-- Migration: Auto-trigger generate-profile-embedding Edge Function on profile changes
-- This replaces the Supabase Dashboard Database Webhook with a persistent SQL trigger
-- so it survives dashboard changes, project restarts, and migrations.

-- Enable pg_net extension (required for HTTP calls from PostgreSQL)
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Create the trigger function that calls the Edge Function via pg_net
CREATE OR REPLACE FUNCTION public.trigger_generate_profile_embedding()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    edge_function_url TEXT;
    service_role_key TEXT;
    request_payload JSONB;
    profile_has_input BOOLEAN;
BEGIN
    -- Check if the profile has meaningful embedding input (bio, preferences, location, or profile_owner)
    profile_has_input := (
        COALESCE(TRIM(NEW.bio), '') != '' OR
        COALESCE(TRIM(NEW.preferences), '') != '' OR
        COALESCE(TRIM(NEW.location), '') != '' OR
        COALESCE(TRIM(NEW.profile_owner), '') != ''
    );

    -- Skip if no embedding source text is available
    IF NOT profile_has_input THEN
        RETURN NEW;
    END IF;

    -- On UPDATE, skip if none of the embedding-relevant fields actually changed
    IF TG_OP = 'UPDATE' THEN
        IF (
            OLD.bio IS NOT DISTINCT FROM NEW.bio AND
            OLD.preferences IS NOT DISTINCT FROM NEW.preferences AND
            OLD.location IS NOT DISTINCT FROM NEW.location AND
            OLD.profile_owner IS NOT DISTINCT FROM NEW.profile_owner
        ) THEN
            RETURN NEW;
        END IF;
    END IF;

    -- Build the Edge Function URL from the Supabase project URL
    -- The project ref is extracted from the SUPABASE_URL secret
    edge_function_url := CONCAT(
        REGEXP_REPLACE(
            current_setting('app.settings.supabase_url', TRUE),
            '\.supabase\.co$',
            '.supabase.co'
        ),
        '/functions/v1/generate-profile-embedding'
    );

    -- Fallback: hardcode the URL if the setting is not available
    IF edge_function_url IS NULL OR edge_function_url = '' OR edge_function_url = '/functions/v1/generate-profile-embedding' THEN
        edge_function_url := 'https://oxdhkjernhpkscrideby.supabase.co/functions/v1/generate-profile-embedding';
    END IF;

    -- Get the service role key for authentication
    service_role_key := current_setting('supabase.service_role_key', TRUE);

    -- Build the payload matching the Edge Function's expected format
    request_payload := jsonb_build_object(
        'type', TG_OP,
        'record', jsonb_build_object(
            'id', NEW.id,
            'bio', NEW.bio,
            'preferences', NEW.preferences,
            'location', NEW.location,
            'profile_owner', NEW.profile_owner
        )
    );

    -- Fire-and-forget HTTP POST to the Edge Function via pg_net
    PERFORM net.http_post(
        url := edge_function_url,
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', CONCAT('Bearer ', service_role_key)
        ),
        body := request_payload
    );

    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        -- Log but don't fail the transaction if the HTTP call fails
        RAISE WARNING 'trigger_generate_profile_embedding failed: %', SQLERRM;
        RETURN NEW;
END;
$$;

-- Drop the trigger if it already exists (idempotent)
DROP TRIGGER IF EXISTS trg_auto_generate_embedding ON public.profiles;

-- Create the trigger on INSERT and UPDATE
CREATE TRIGGER trg_auto_generate_embedding
    AFTER INSERT OR UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.trigger_generate_profile_embedding();

-- Add a comment for documentation
COMMENT ON FUNCTION public.trigger_generate_profile_embedding() IS
    'Automatically calls the generate-profile-embedding Edge Function via pg_net '
    'whenever a profile is inserted or updated with meaningful bio/preferences/location data. '
    'Skips if no embedding-relevant fields changed on UPDATE.';
