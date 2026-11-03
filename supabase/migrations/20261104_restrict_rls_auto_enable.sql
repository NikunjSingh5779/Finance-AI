-- Keep the platform's automatic RLS event trigger, but prevent clients from
-- invoking its SECURITY DEFINER function directly through the Data API.
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
