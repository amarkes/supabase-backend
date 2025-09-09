-- Fix infinite recursion in users policies
-- Drop existing policies that cause recursion
DROP POLICY IF EXISTS "Users can view their own profile or staff can view all" ON public.users;
DROP POLICY IF EXISTS "Users can update their own profile or staff can update all" ON public.users;
DROP POLICY IF EXISTS "Users can insert their own profile or staff can insert for others" ON public.users;

-- Create simpler policies without recursion
CREATE POLICY "Users can view their own profile" ON public.users
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON public.users
    FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile" ON public.users
    FOR INSERT WITH CHECK (auth.uid() = id);

-- Create a separate policy for staff (will be handled by admin functions)
-- Staff privileges are managed through the admin functions, not RLS policies
