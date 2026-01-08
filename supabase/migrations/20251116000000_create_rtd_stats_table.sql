-- Create RTD (Real-Time Data) Stats table for managing dynamic statistics
CREATE TABLE IF NOT EXISTS public.rtd_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prizes_given INTEGER NOT NULL DEFAULT 200,
    happy_winners INTEGER NOT NULL DEFAULT 500,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Enable RLS
ALTER TABLE public.rtd_stats ENABLE ROW LEVEL SECURITY;

-- Allow public read access
CREATE POLICY "Allow public read access to rtd_stats"
ON public.rtd_stats
FOR SELECT
TO PUBLIC
USING (true);

-- Allow authenticated users to insert (for admin)
CREATE POLICY "Allow authenticated insert to rtd_stats"
ON public.rtd_stats
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Allow authenticated users to update (for admin)
CREATE POLICY "Allow authenticated update to rtd_stats"
ON public.rtd_stats
FOR UPDATE
TO authenticated
USING (true);

-- Insert default values
INSERT INTO public.rtd_stats (prizes_given, happy_winners)
VALUES (200, 500)
ON CONFLICT DO NOTHING;
