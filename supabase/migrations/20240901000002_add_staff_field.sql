-- Add staff field to users table
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_staff BOOLEAN DEFAULT false;

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view their own profile" ON public.users;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.users;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.users;

-- Create new policies with staff support
CREATE POLICY "Users can view their own profile or staff can view all" ON public.users
    FOR SELECT USING (
        auth.uid() = id OR 
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE id = auth.uid() AND is_staff = true
        )
    );

CREATE POLICY "Users can update their own profile or staff can update all" ON public.users
    FOR UPDATE USING (
        auth.uid() = id OR 
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE id = auth.uid() AND is_staff = true
        )
    );

CREATE POLICY "Users can insert their own profile or staff can insert for others" ON public.users
    FOR INSERT WITH CHECK (
        auth.uid() = id OR 
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE id = auth.uid() AND is_staff = true
        )
    );

-- Create index for staff queries
CREATE INDEX IF NOT EXISTS idx_users_is_staff ON public.users(is_staff);

-- Add comment for documentation
COMMENT ON COLUMN public.users.is_staff IS 'Whether the user has staff privileges (can view/edit all profiles)';

