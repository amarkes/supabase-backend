-- Create categories table for income and expenses
CREATE TABLE IF NOT EXISTS public.categories (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    color TEXT DEFAULT '#3B82F6',
    icon TEXT DEFAULT '💰',
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create transactions table for income and expenses
CREATE TABLE IF NOT EXISTS public.transactions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
    description TEXT NOT NULL,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    tags TEXT[] DEFAULT '{}',
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- Create policies for categories
CREATE POLICY "Users can view their own categories" ON public.categories
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own categories" ON public.categories
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own categories" ON public.categories
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own categories" ON public.categories
    FOR DELETE USING (auth.uid() = user_id);

-- Create policies for transactions
CREATE POLICY "Users can view their own transactions" ON public.transactions
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own transactions" ON public.transactions
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own transactions" ON public.transactions
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own transactions" ON public.transactions
    FOR DELETE USING (auth.uid() = user_id);

-- Create indexes for better performance
CREATE INDEX idx_categories_user_id ON public.categories(user_id);
CREATE INDEX idx_categories_type ON public.categories(type);
CREATE INDEX idx_transactions_user_id ON public.transactions(user_id);
CREATE INDEX idx_transactions_date ON public.transactions(date);
CREATE INDEX idx_transactions_type ON public.transactions(type);
CREATE INDEX idx_transactions_category_id ON public.transactions(category_id);

-- Create function to handle updated_at timestamp
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER categories_updated_at
    BEFORE UPDATE ON public.categories
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER transactions_updated_at
    BEFORE UPDATE ON public.transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- Insert default categories
INSERT INTO public.categories (name, type, color, icon, user_id) VALUES
    ('Salário', 'income', '#10B981', '💼', (SELECT id FROM auth.users LIMIT 1)),
    ('Freelance', 'income', '#3B82F6', '💻', (SELECT id FROM auth.users LIMIT 1)),
    ('Investimentos', 'income', '#8B5CF6', '📈', (SELECT id FROM auth.users LIMIT 1)),
    ('Outros', 'income', '#6B7280', '💰', (SELECT id FROM auth.users LIMIT 1)),
    ('Alimentação', 'expense', '#EF4444', '🍽️', (SELECT id FROM auth.users LIMIT 1)),
    ('Transporte', 'expense', '#F59E0B', '🚗', (SELECT id FROM auth.users LIMIT 1)),
    ('Moradia', 'expense', '#8B5CF6', '🏠', (SELECT id FROM auth.users LIMIT 1)),
    ('Saúde', 'expense', '#EC4899', '🏥', (SELECT id FROM auth.users LIMIT 1)),
    ('Lazer', 'expense', '#06B6D4', '🎮', (SELECT id FROM auth.users LIMIT 1)),
    ('Outros', 'expense', '#6B7280', '💸', (SELECT id FROM auth.users LIMIT 1));

-- Add comments for documentation
COMMENT ON TABLE public.categories IS 'Categories for income and expense transactions';
COMMENT ON TABLE public.transactions IS 'Personal cashflow transactions (income and expenses)';
COMMENT ON COLUMN public.transactions.amount IS 'Transaction amount (always positive)';
COMMENT ON COLUMN public.transactions.type IS 'Type of transaction: income or expense';
COMMENT ON COLUMN public.transactions.tags IS 'Array of tags for better organization';
