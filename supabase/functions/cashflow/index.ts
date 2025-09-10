import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient, type User } from 'https://esm.sh/@supabase/supabase-js@2'

// ============================
// CORS + helpers
// ============================
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, accept',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
} as const

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  })

// ============================
// Response helpers padronizados
// ============================
const success = (data: unknown, message?: string) => 
  json({ success: true, data, ...(message && { message }) })

const successList = (items: unknown[], message?: string) => 
  json({ success: true, data: items, count: items.length, ...(message && { message }) })

const successItem = (item: unknown, message?: string) => 
  json({ success: true, data: item, ...(message && { message }) })

const successMessage = (message: string) => 
  json({ success: true, message })

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// Fail fast se ambiente não configurado
const REQUIRED_ENVS = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'] as const
const env = Object.fromEntries(
  REQUIRED_ENVS.map((k) => {
    const v = Deno.env.get(k)
    if (!v) throw new Error(`Missing env: ${k}`)
    return [k, v]
  }),
) as Record<(typeof REQUIRED_ENVS)[number], string>

// Clients globais
const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
})
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

// ============================
// Utilitários por requisição
// ============================
const readJSON = async <T = any>(req: Request): Promise<T> => {
  try {
    return (await req.json()) as T
  } catch {
    return {} as T
  }
}

const authedClientFrom = (authHeader: string | null) =>
  createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: authHeader ? { Authorization: authHeader } : {} },
  })

const requireAuth = async (authed: ReturnType<typeof authedClientFrom>): Promise<User> => {
  const { data, error } = await authed.auth.getUser()
  if (error || !data?.user) throw new HttpError(401, 'Unauthorized')
  return data.user
}

const requireFields = (obj: Record<string, unknown>, fields: string[]) => {
  const missing = fields.filter((f) => obj[f] === undefined || obj[f] === null || obj[f] === '')
  if (missing.length) {
    throw new HttpError(400, `Parâmetros obrigatórios ausentes: ${missing.join(', ')}`)
  }
}

// ============================
// Handlers
// ============================
type Ctx = {
  req: Request
  authHeader: string | null
  authed: ReturnType<typeof authedClientFrom>
}

const handlers: Record<
  string,
  (ctx: Ctx) => Promise<Response>
> = {
  // GET /categories - Listar categorias
  async categories({ authed }: Ctx) {
    const user = await requireAuth(authed)

    const { data, error } = await authed
      .from('categories')
      .select('*')
      .eq('user_id', user.id)
      .order('type', { ascending: true })
      .order('name', { ascending: true })

    if (error) throw new HttpError(400, error.message)

    return successList(data, 'Categorias listadas com sucesso')
  },

  // POST /categories - Criar categoria
  async createCategory({ authed, req }: Ctx) {
    const user = await requireAuth(authed)
    const { name, type, color, icon } = await readJSON<{
      name?: string
      type?: 'income' | 'expense'
      color?: string
      icon?: string
    }>(req)

    requireFields({ name, type }, ['name', 'type'])

    const { data, error } = await authed
      .from('categories')
      .insert({
        name: name!,
        type: type!,
        color: color || '#3B82F6',
        icon: icon || '💰',
        user_id: user.id,
      })
      .select()
      .single()

    if (error) throw new HttpError(400, error.message)

    return successItem(data, 'Categoria criada com sucesso')
  },

  // GET /transactions - Listar transações
  async transactions({ authed, req }: Ctx) {
    const user = await requireAuth(authed)
    const url = new URL(req.url)
    const startDate = url.searchParams.get('start_date')
    const endDate = url.searchParams.get('end_date')
    const type = url.searchParams.get('type')
    const categoryId = url.searchParams.get('category_id')
    const limit = parseInt(url.searchParams.get('limit') || '50')
    const offset = parseInt(url.searchParams.get('offset') || '0')

    let query = authed
      .from('transactions')
      .select(`
        *,
        category:categories(*)
      `)
      .eq('user_id', user.id)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (startDate) query = query.gte('date', startDate)
    if (endDate) query = query.lte('date', endDate)
    if (type) query = query.eq('type', type)
    if (categoryId) query = query.eq('category_id', categoryId)

    const { data, error } = await query

    if (error) throw new HttpError(400, error.message)

    return successList(data, 'Transações listadas com sucesso')
  },

  // POST /transactions - Criar transação
  async createTransaction({ authed, req }: Ctx) {
    const user = await requireAuth(authed)
    const { type, amount, description, date, category_id, tags, notes } = await readJSON<{
      type?: 'income' | 'expense'
      amount?: number
      description?: string
      date?: string
      category_id?: string
      tags?: string[]
      notes?: string
    }>(req)

    requireFields({ type, amount, description }, ['type', 'amount', 'description'])

    // Validar se a categoria pertence ao usuário (se fornecida)
    if (category_id) {
      const { data: category, error: categoryError } = await authed
        .from('categories')
        .select('id')
        .eq('id', category_id)
        .eq('user_id', user.id)
        .single()

      if (categoryError || !category) {
        throw new HttpError(400, 'Categoria não encontrada ou não pertence ao usuário')
      }
    }

    const { data, error } = await authed
      .from('transactions')
      .insert({
        user_id: user.id,
        type: type!,
        amount: amount!,
        description: description!,
        date: date || new Date().toISOString().split('T')[0],
        category_id: category_id || null,
        tags: tags || [],
        notes: notes || null,
      })
      .select(`
        *,
        category:categories(*)
      `)
      .single()

    if (error) throw new HttpError(400, error.message)

    return successItem(data, 'Transação criada com sucesso')
  },

  // PUT /transactions/:id - Atualizar transação
  async updateTransaction({ authed, req }: Ctx) {
    const user = await requireAuth(authed)
    const url = new URL(req.url)
    const transactionId = url.pathname.split('/').pop()

    if (!transactionId) throw new HttpError(400, 'ID da transação é obrigatório')

    const { type, amount, description, date, category_id, tags, notes } = await readJSON<{
      type?: 'income' | 'expense'
      amount?: number
      description?: string
      date?: string
      category_id?: string
      tags?: string[]
      notes?: string
    }>(req)

    // Validar se a categoria pertence ao usuário (se fornecida)
    if (category_id) {
      const { data: category, error: categoryError } = await authed
        .from('categories')
        .select('id')
        .eq('id', category_id)
        .eq('user_id', user.id)
        .single()

      if (categoryError || !category) {
        throw new HttpError(400, 'Categoria não encontrada ou não pertence ao usuário')
      }
    }

    const { data, error } = await authed
      .from('transactions')
      .update({
        ...(type && { type }),
        ...(amount && { amount }),
        ...(description && { description }),
        ...(date && { date }),
        ...(category_id !== undefined && { category_id }),
        ...(tags && { tags }),
        ...(notes !== undefined && { notes }),
      })
      .eq('id', transactionId)
      .eq('user_id', user.id)
      .select(`
        *,
        category:categories(*)
      `)
      .single()

    if (error) throw new HttpError(400, error.message)

    return successItem(data, 'Transação atualizada com sucesso')
  },

  // DELETE /transactions/:id - Deletar transação
  async deleteTransaction({ authed, req }: Ctx) {
    const user = await requireAuth(authed)
    const url = new URL(req.url)
    const transactionId = url.pathname.split('/').pop()

    if (!transactionId) throw new HttpError(400, 'ID da transação é obrigatório')

    const { error } = await authed
      .from('transactions')
      .delete()
      .eq('id', transactionId)
      .eq('user_id', user.id)

    if (error) throw new HttpError(400, error.message)

    return successMessage('Transação deletada com sucesso')
  },

  // GET /summary - Resumo financeiro
  async summary({ authed, req }: Ctx) {
    const user = await requireAuth(authed)
    const url = new URL(req.url)
    const startDate = url.searchParams.get('start_date')
    const endDate = url.searchParams.get('end_date')

    let query = authed
      .from('transactions')
      .select('type, amount, date')
      .eq('user_id', user.id)

    if (startDate) query = query.gte('date', startDate)
    if (endDate) query = query.lte('date', endDate)

    const { data, error } = await query

    if (error) throw new HttpError(400, error.message)

    const summary = data.reduce((acc, transaction) => {
      if (transaction.type === 'income') {
        acc.totalIncome += parseFloat(transaction.amount.toString())
      } else {
        acc.totalExpenses += parseFloat(transaction.amount.toString())
      }
      return acc
    }, { totalIncome: 0, totalExpenses: 0 })

    summary.balance = summary.totalIncome - summary.totalExpenses

    return success(summary, 'Resumo financeiro calculado com sucesso')
  },
}

// ============================
// HTTP server
// ============================
serve(async (req) => {
  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  const authHeader = req.headers.get('Authorization')
  const authed = authedClientFrom(authHeader)

  try {
    // Roteamento baseado no método HTTP e path
    const url = new URL(req.url)
    const path = url.pathname.replace('/functions/v1/cashflow', '') || '/'

    // Categories endpoints
    if (req.method === 'GET' && (path === '/categories' || path === '/cashflow/categories')) {
      return await handlers.categories({ req, authed, authHeader })
    }

    if (req.method === 'POST' && (path === '/categories' || path === '/cashflow/categories')) {
      return await handlers.createCategory({ req, authed, authHeader })
    }

    // Transactions endpoints
    if (req.method === 'GET' && (path === '/transactions' || path === '/cashflow/transactions')) {
      return await handlers.transactions({ req, authed, authHeader })
    }

    if (req.method === 'POST' && (path === '/transactions' || path === '/cashflow/transactions')) {
      return await handlers.createTransaction({ req, authed, authHeader })
    }

    if (req.method === 'PUT' && (path.startsWith('/transactions/') || path.startsWith('/cashflow/transactions/'))) {
      return await handlers.updateTransaction({ req, authed, authHeader })
    }

    if (req.method === 'DELETE' && (path.startsWith('/transactions/') || path.startsWith('/cashflow/transactions/'))) {
      return await handlers.deleteTransaction({ req, authed, authHeader })
    }

    // Summary endpoint
    if (req.method === 'GET' && (path === '/summary' || path === '/cashflow/summary')) {
      return await handlers.summary({ req, authed, authHeader })
    }

    return json({ error: `Endpoint não encontrado: ${req.method} ${path}` }, 404)
  } catch (err: any) {
    if (err instanceof HttpError) {
      return json({ error: err.message }, err.status)
    }
    return json({ error: err?.message ?? 'Erro interno' }, 500)
  }
})