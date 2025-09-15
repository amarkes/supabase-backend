-- Fix categories table to reference public.users instead of auth.users
-- This allows proper joins between categories and users tables

-- First, drop the existing foreign key constraint
ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_user_id_fkey;

-- Clean up orphaned categories that reference non-existent users
-- Delete categories that reference users not in public.users table
DELETE FROM public.categories 
WHERE user_id NOT IN (SELECT id FROM public.users);

-- Add new foreign key constraint referencing public.users
ALTER TABLE public.categories 
ADD CONSTRAINT categories_user_id_fkey 
FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- Add comment for documentation
COMMENT ON CONSTRAINT categories_user_id_fkey ON public.categories 
IS 'Foreign key to public.users table for proper joins';
