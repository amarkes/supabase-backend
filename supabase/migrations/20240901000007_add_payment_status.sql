-- Add payment status field to transactions table
-- This allows tracking whether a transaction has been paid or not

-- Add is_paid column to transactions table
ALTER TABLE public.transactions 
ADD COLUMN is_paid BOOLEAN DEFAULT false;

-- Add paid_at column to track when the transaction was paid
ALTER TABLE public.transactions 
ADD COLUMN paid_at TIMESTAMP WITH TIME ZONE;

-- Create index for better performance on payment status queries
CREATE INDEX idx_transactions_is_paid ON public.transactions(is_paid);
CREATE INDEX idx_transactions_paid_at ON public.transactions(paid_at);

-- Add comments for documentation
COMMENT ON COLUMN public.transactions.is_paid IS 'Whether the transaction has been paid or not';
COMMENT ON COLUMN public.transactions.paid_at IS 'Timestamp when the transaction was marked as paid';

-- Update existing transactions to be marked as unpaid by default
-- This assumes existing transactions need to be manually marked as paid
UPDATE public.transactions 
SET is_paid = false, paid_at = NULL 
WHERE is_paid IS NULL;
