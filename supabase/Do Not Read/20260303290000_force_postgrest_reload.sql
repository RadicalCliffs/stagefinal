-- Force PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
