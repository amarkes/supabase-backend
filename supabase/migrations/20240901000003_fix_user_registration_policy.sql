-- Fix user registration policy to allow anonymous user creation
-- This allows new users to be created without authentication

-- Drop the existing restrictive policy
DROP POLICY IF EXISTS "Users can insert their own profile or staff can insert for others" ON public.users;

-- Create a new policy that allows:
-- 1. Users to insert their own profile (when authenticated)
-- 2. Staff to insert profiles for others (when authenticated)
-- 3. Anonymous users to insert profiles (for new user registration)
CREATE POLICY "Allow user profile creation" ON public.users
    FOR INSERT WITH CHECK (
        -- Allow if user is inserting their own profile
        auth.uid() = id OR 
        -- Allow if authenticated user is staff
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE id = auth.uid() AND is_staff = true
        ) OR
        -- Allow anonymous insertion (for new user registration)
        auth.uid() IS NULL
    );

-- Add comment for documentation
COMMENT ON POLICY "Allow user profile creation" ON public.users IS 
'Allows users to create their own profile, staff to create profiles for others, and anonymous users to create new profiles during registration';
