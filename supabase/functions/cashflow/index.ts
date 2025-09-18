import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient, type User } from 'https://esm.sh/@supabase/supabase-js@2'

// ============================
// CORS + helpers
// ============================
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, accept',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
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

    // Verificar se o usuário é staff
    const { data: userData, error: userError } = await authed
      .from('users')
      .select('is_staff')
      .eq('id', user.id)
      .single()

    if (userError) throw new HttpError(400, userError.message)

    // Se for staff, usar cliente admin para acessar todas as categorias
    // Se não for staff, usar cliente autenticado para suas próprias categorias
    if (userData?.is_staff) {
      // Staff pode ver todas as categorias usando cliente admin
      const { data: categories, error: categoriesError } = await admin
        .from('categories')
        .select('*')
        .order('type', { ascending: true })
        .order('name', { ascending: true })

      if (categoriesError) throw new HttpError(400, categoriesError.message)

      // Buscar dados dos usuários para cada categoria
      const userIds = [...new Set(categories.map(cat => cat.user_id))]
      const { data: users, error: usersError } = await admin
        .from('users')
        .select('id, email, full_name, is_staff')
        .in('id', userIds)

      if (usersError) throw new HttpError(400, usersError.message)

      // Combinar dados das categorias com dados dos usuários
      const categoriesWithUsers = categories.map(category => ({
        ...category,
        user: users.find(user => user.id === category.user_id)
      }))

      return successList(categoriesWithUsers, 'Categorias listadas com sucesso (visão staff)')
    } else {
      // Usuário comum vê apenas suas próprias categorias
      const { data: categories, error: categoriesError } = await authed
        .from('categories')
        .select('*')
        .eq('user_id', user.id)
        .order('type', { ascending: true })
        .order('name', { ascending: true })

      if (categoriesError) throw new HttpError(400, categoriesError.message)

      // Buscar dados do usuário atual
      const { data: userInfo, error: userError } = await authed
        .from('users')
        .select('id, email, full_name, is_staff')
        .eq('id', user.id)
        .single()

      if (userError) throw new HttpError(400, userError.message)

      // Combinar dados das categorias com dados do usuário
      const categoriesWithUsers = categories.map(category => ({
        ...category,
        user: userInfo
      }))

      return successList(categoriesWithUsers, 'Categorias listadas com sucesso')
    }
  },

  // GET /categories/:id - Buscar categoria por ID
  async getCategory({ authed, req }: Ctx) {
    const user = await requireAuth(authed)
    const url = new URL(req.url)
    const categoryId = url.pathname.split('/').pop()

    if (!categoryId) {
      throw new HttpError(400, 'ID da categoria é obrigatório')
    }

    // Verificar se o usuário é staff
    const { data: userData, error: userError } = await authed
      .from('users')
      .select('is_staff')
      .eq('id', user.id)
      .single()

    if (userError) throw new HttpError(400, userError.message)

    let categoryQuery
    if (userData?.is_staff) {
      // Staff pode buscar qualquer categoria
      categoryQuery = admin
        .from('categories')
        .select('*')
        .eq('id', categoryId)
        .single()
    } else {
      // Usuário comum só pode buscar suas próprias categorias
      categoryQuery = authed
        .from('categories')
        .select('*')
        .eq('id', categoryId)
        .eq('user_id', user.id)
        .single()
    }

    const { data: category, error: categoryError } = await categoryQuery

    if (categoryError || !category) {
      throw new HttpError(404, 'Categoria não encontrada')
    }

    // Buscar dados do usuário proprietário
    const { data: userInfo, error: userInfoError } = await admin
      .from('users')
      .select('id, email, full_name, is_staff')
      .eq('id', category.user_id)
      .single()

    if (userInfoError) throw new HttpError(400, userInfoError.message)

    const categoryWithUser = {
      ...category,
      user: userInfo
    }

    return successItem(categoryWithUser, 'Categoria encontrada com sucesso')
  },

  // POST /categories - Criar categoria
  async createCategory({ authed, req }: Ctx) {
    const user = await requireAuth(authed)
    const { name, type, color, icon } = await readJSON<{
      name?: string
      type?: string
      color?: string
      icon?: string
    }>(req)

    requireFields({ name, type }, ['name', 'type'])

    // Sanitizar e validar o tipo
    const sanitizedType = type!.toString().toLowerCase().trim()
    if (!['income', 'expense'].includes(sanitizedType)) {
      throw new HttpError(400, 'Tipo deve ser "income" ou "expense"')
    }

    // Sanitizar o nome
    const sanitizedName = name!.toString().trim()
    if (!sanitizedName) {
      throw new HttpError(400, 'Nome da categoria não pode estar vazio')
    }

    const { data, error } = await authed
      .from('categories')
      .insert({
        name: sanitizedName,
        type: sanitizedType as 'income' | 'expense',
        color: color?.toString().trim() || '#3B82F6',
        icon: icon?.toString().trim() || '💰',
        user_id: user.id,
      })
      .select()
      .single()

    if (error) throw new HttpError(400, error.message)

    return successItem(data, 'Categoria criada com sucesso')
  },

  // DELETE /categories/:id - Deletar categoria
  async deleteCategory({ authed, req }: Ctx) {
    const user = await requireAuth(authed)
    const url = new URL(req.url)
    const categoryId = url.pathname.split('/').pop()

    if (!categoryId) {
      throw new HttpError(400, 'ID da categoria é obrigatório')
    }

    // Verificar se a categoria existe e pertence ao usuário
    const { data: category, error: fetchError } = await authed
      .from('categories')
      .select('id, name')
      .eq('id', categoryId)
      .eq('user_id', user.id)
      .single()

    if (fetchError || !category) {
      throw new HttpError(404, 'Categoria não encontrada')
    }

    // Verificar se existem transações usando esta categoria
    const { data: transactions, error: checkError } = await authed
      .from('transactions')
      .select('id')
      .eq('category_id', categoryId)
      .limit(1)

    if (checkError) {
      throw new HttpError(400, checkError.message)
    }

    if (transactions && transactions.length > 0) {
      throw new HttpError(400, 'Não é possível deletar categoria que possui transações associadas')
    }

    // Deletar a categoria
    const { error: deleteError } = await authed
      .from('categories')
      .delete()
      .eq('id', categoryId)
      .eq('user_id', user.id)

    if (deleteError) {
      throw new HttpError(400, deleteError.message)
    }

    return successMessage(`Categoria "${category.name}" deletada com sucesso`)
  },

  // PUT /categories/:id - Atualizar categoria
  async updateCategory({ authed, req }: Ctx) {
    const user = await requireAuth(authed)
    const url = new URL(req.url)
    const categoryId = url.pathname.split('/').pop()

    if (!categoryId) {
      throw new HttpError(400, 'ID da categoria é obrigatório')
    }

    const { name, type, color, icon } = await readJSON<{
      name?: string
      type?: 'income' | 'expense'
      color?: string
      icon?: string
    }>(req)

    // Pelo menos um campo deve ser fornecido para atualização
    if (!name && !type && !color && !icon) {
      throw new HttpError(400, 'Pelo menos um campo deve ser fornecido para atualização')
    }

    // Verificar se a categoria existe e pertence ao usuário
    const { data: existingCategory, error: fetchError } = await authed
      .from('categories')
      .select('id, name, type, color, icon')
      .eq('id', categoryId)
      .eq('user_id', user.id)
      .single()

    if (fetchError || !existingCategory) {
      throw new HttpError(404, 'Categoria não encontrada')
    }

    // Preparar dados para atualização (só incluir campos fornecidos)
    const updateData: any = {}
    if (name !== undefined) updateData.name = name
    if (type !== undefined) updateData.type = type
    if (color !== undefined) updateData.color = color
    if (icon !== undefined) updateData.icon = icon

    // Atualizar a categoria
    const { data, error: updateError } = await authed
      .from('categories')
      .update(updateData)
      .eq('id', categoryId)
      .eq('user_id', user.id)
      .select()
      .single()

    if (updateError) {
      throw new HttpError(400, updateError.message)
    }

    return successItem(data, 'Categoria atualizada com sucesso')
  },

  // GET /transactions - Listar transações
  async transactions({ authed, req }: Ctx) {
    const user = await requireAuth(authed)
    const url = new URL(req.url)
    const startDate = url.searchParams.get('start_date')
    const endDate = url.searchParams.get('end_date')
    const type = url.searchParams.get('type')
    const categoryId = url.searchParams.get('category_id')
    const isPaid = url.searchParams.get('is_paid')
    const limit = parseInt(url.searchParams.get('limit') || '50')
    const offset = parseInt(url.searchParams.get('offset') || '0')

    // Verificar se o usuário é staff
    const { data: userData, error: userError } = await authed
      .from('users')
      .select('is_staff')
      .eq('id', user.id)
      .single()

    if (userError) throw new HttpError(400, userError.message)

    // Se for staff, usar cliente admin para acessar todas as transações
    // Se não for staff, usar cliente autenticado para suas próprias transações
    if (userData?.is_staff) {
      // Staff pode ver todas as transações usando cliente admin
      const { data: transactions, error: transactionsError } = await admin
        .from('transactions')
        .select(`
          *,
          category:categories(*)
        `)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      if (transactionsError) throw new HttpError(400, transactionsError.message)

      // Aplicar filtros se fornecidos
      let filteredTransactions = transactions
      if (startDate) filteredTransactions = filteredTransactions.filter(t => t.date >= startDate)
      if (endDate) filteredTransactions = filteredTransactions.filter(t => t.date <= endDate)
      if (type) filteredTransactions = filteredTransactions.filter(t => t.type === type)
      if (categoryId) filteredTransactions = filteredTransactions.filter(t => t.category_id === categoryId)
      if (isPaid !== null) {
        const paidStatus = isPaid === 'true'
        filteredTransactions = filteredTransactions.filter(t => t.is_paid === paidStatus)
      }

      // Buscar dados dos usuários para cada transação
      const userIds = [...new Set(filteredTransactions.map(t => t.user_id))]
      const { data: users, error: usersError } = await admin
        .from('users')
        .select('id, email, full_name, is_staff')
        .in('id', userIds)

      if (usersError) throw new HttpError(400, usersError.message)

      // Combinar dados das transações com dados dos usuários
      const transactionsWithUsers = filteredTransactions.map(transaction => ({
        ...transaction,
        user: users.find(user => user.id === transaction.user_id)
      }))

      return successList(transactionsWithUsers, 'Transações listadas com sucesso (visão staff)')
    } else {
      // Usuário comum vê apenas suas próprias transações
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
      if (isPaid !== null) {
        const paidStatus = isPaid === 'true'
        query = query.eq('is_paid', paidStatus)
      }

      const { data: transactions, error: transactionsError } = await query

      if (transactionsError) throw new HttpError(400, transactionsError.message)

      // Buscar dados do usuário atual
      const { data: userInfo, error: userError } = await authed
        .from('users')
        .select('id, email, full_name, is_staff')
        .eq('id', user.id)
        .single()

      if (userError) throw new HttpError(400, userError.message)

      // Combinar dados das transações com dados do usuário
      const transactionsWithUsers = transactions.map(transaction => ({
        ...transaction,
        user: userInfo
      }))

      return successList(transactionsWithUsers, 'Transações listadas com sucesso')
    }
  },

  // GET /transactions/:id - Buscar transação por ID
  async getTransaction({ authed, req }: Ctx) {
    const user = await requireAuth(authed)
    const url = new URL(req.url)
    const transactionId = url.pathname.split('/').pop()

    if (!transactionId) {
      throw new HttpError(400, 'ID da transação é obrigatório')
    }

    // Verificar se o usuário é staff
    const { data: userData, error: userError } = await authed
      .from('users')
      .select('is_staff')
      .eq('id', user.id)
      .single()

    if (userError) throw new HttpError(400, userError.message)

    let transactionQuery
    if (userData?.is_staff) {
      // Staff pode buscar qualquer transação
      transactionQuery = admin
        .from('transactions')
        .select(`
          *,
          category:categories(*)
        `)
        .eq('id', transactionId)
        .single()
    } else {
      // Usuário comum só pode buscar suas próprias transações
      transactionQuery = authed
        .from('transactions')
        .select(`
          *,
          category:categories(*)
        `)
        .eq('id', transactionId)
        .eq('user_id', user.id)
        .single()
    }

    const { data: transaction, error: transactionError } = await transactionQuery

    if (transactionError || !transaction) {
      throw new HttpError(404, 'Transação não encontrada')
    }

    // Buscar dados do usuário proprietário
    const { data: userInfo, error: userInfoError } = await admin
      .from('users')
      .select('id, email, full_name, is_staff')
      .eq('id', transaction.user_id)
      .single()

    if (userInfoError) throw new HttpError(400, userInfoError.message)

    const transactionWithUser = {
      ...transaction,
      user: userInfo
    }

    return successItem(transactionWithUser, 'Transação encontrada com sucesso')
  },

  // POST /transactions - Criar transação
  async createTransaction({ authed, req }: Ctx) {
    const user = await requireAuth(authed)
    const { type, amount, description, date, category_id, tags, notes, is_paid } = await readJSON<{
      type?: 'income' | 'expense'
      amount?: number
      description?: string
      date?: string
      category_id?: string
      tags?: string[]
      notes?: string
      is_paid?: boolean
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
        is_paid: is_paid !== undefined ? is_paid : false, // Default to unpaid
        paid_at: is_paid === true ? new Date().toISOString() : null,
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

    const { type, amount, description, date, category_id, tags, notes, is_paid } = await readJSON<{
      type?: 'income' | 'expense'
      amount?: number
      description?: string
      date?: string
      category_id?: string
      tags?: string[]
      notes?: string
      is_paid?: boolean
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

    const updateData: any = {}
    if (type) updateData.type = type
    if (amount) updateData.amount = amount
    if (description) updateData.description = description
    if (date) updateData.date = date
    if (category_id !== undefined) updateData.category_id = category_id
    if (tags) updateData.tags = tags
    if (notes !== undefined) updateData.notes = notes
    if (is_paid !== undefined) {
      updateData.is_paid = is_paid
      updateData.paid_at = is_paid ? new Date().toISOString() : null
    }

    const { data, error } = await authed
      .from('transactions')
      .update(updateData)
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
      .select('type, amount, date, is_paid')
      .eq('user_id', user.id)

    if (startDate) query = query.gte('date', startDate)
    if (endDate) query = query.lte('date', endDate)

    const { data, error } = await query

    if (error) throw new HttpError(400, error.message)

    const summary = data.reduce((acc, transaction) => {
      if (transaction.type === 'income') {
        acc.totalIncome += parseFloat(transaction.amount.toString())
        if (transaction.is_paid) {
          acc.paidIncome += parseFloat(transaction.amount.toString())
        } else {
          acc.pendingIncome += parseFloat(transaction.amount.toString())
        }
      } else {
        acc.totalExpenses += parseFloat(transaction.amount.toString())
        if (transaction.is_paid) {
          acc.paidExpenses += parseFloat(transaction.amount.toString())
        } else {
          acc.pendingExpenses += parseFloat(transaction.amount.toString())
        }
      }
      return acc
    }, { 
      totalIncome: 0, 
      totalExpenses: 0, 
      paidIncome: 0, 
      pendingIncome: 0, 
      paidExpenses: 0, 
      pendingExpenses: 0 
    })

    summary.balance = summary.totalIncome - summary.totalExpenses
    summary.paidBalance = summary.paidIncome - summary.paidExpenses
    summary.pendingBalance = summary.pendingIncome - summary.pendingExpenses

    return success(summary, 'Resumo financeiro calculado com sucesso')
  },

  // PATCH /transactions/:id/pay - Marcar transação como paga
  async markAsPaid({ authed, req }: Ctx) {
    const user = await requireAuth(authed)
    const url = new URL(req.url)
    const pathParts = url.pathname.split('/')
    const transactionId = pathParts[pathParts.length - 2] // /transactions/:id/pay

    if (!transactionId) {
      throw new HttpError(400, 'ID da transação é obrigatório')
    }

    // Verificar se a transação existe e pertence ao usuário
    const { data: transaction, error: fetchError } = await authed
      .from('transactions')
      .select('id, is_paid')
      .eq('id', transactionId)
      .eq('user_id', user.id)
      .single()

    if (fetchError || !transaction) {
      throw new HttpError(404, 'Transação não encontrada')
    }

    if (transaction.is_paid) {
      throw new HttpError(400, 'Transação já está marcada como paga')
    }

    // Marcar como paga
    const { data, error: updateError } = await authed
      .from('transactions')
      .update({
        is_paid: true,
        paid_at: new Date().toISOString()
      })
      .eq('id', transactionId)
      .eq('user_id', user.id)
      .select(`
        *,
        category:categories(*)
      `)
      .single()

    if (updateError) {
      throw new HttpError(400, updateError.message)
    }

    return successItem(data, 'Transação marcada como paga com sucesso')
  },

  // PATCH /transactions/:id/unpay - Marcar transação como não paga
  async markAsUnpaid({ authed, req }: Ctx) {
    const user = await requireAuth(authed)
    const url = new URL(req.url)
    const pathParts = url.pathname.split('/')
    const transactionId = pathParts[pathParts.length - 2] // /transactions/:id/unpay

    if (!transactionId) {
      throw new HttpError(400, 'ID da transação é obrigatório')
    }

    // Verificar se a transação existe e pertence ao usuário
    const { data: transaction, error: fetchError } = await authed
      .from('transactions')
      .select('id, is_paid, user_id')
      .eq('id', transactionId)
      .eq('user_id', user.id)
      .single()

    if (fetchError || !transaction) {
      throw new HttpError(404, 'Transação não encontrada')
    }

    if (!transaction.is_paid) {
      throw new HttpError(400, 'Transação já está marcada como não paga')
    }

    // Marcar como não paga
    const { data, error: updateError } = await authed
      .from('transactions')
      .update({
        is_paid: false,
        paid_at: null
      })
      .eq('id', transactionId)
      .eq('user_id', user.id)
      .select(`
        *,
        category:categories(*)
      `)
      .single()

    if (updateError) {
      throw new HttpError(400, updateError.message)
    }

    return successItem(data, 'Transação marcada como não paga com sucesso')
  },

  // PATCH /transactions/:id/toggle-payment - Alternar status de pagamento
  async togglePaymentStatus({ authed, req }: Ctx) {
    const user = await requireAuth(authed)
    const url = new URL(req.url)
    const pathParts = url.pathname.split('/')
    const transactionId = pathParts[pathParts.length - 2] // /transactions/:id/toggle-payment

    if (!transactionId) {
      throw new HttpError(400, 'ID da transação é obrigatório')
    }

    // Verificar se a transação existe e pertence ao usuário
    const { data: transaction, error: fetchError } = await authed
      .from('transactions')
      .select('id, is_paid')
      .eq('id', transactionId)
      .eq('user_id', user.id)
      .single()

    if (fetchError || !transaction) {
      throw new HttpError(404, 'Transação não encontrada')
    }

    // Alternar status de pagamento
    const newStatus = !transaction.is_paid
    const updateData = {
      is_paid: newStatus,
      paid_at: newStatus ? new Date().toISOString() : null
    }

    const { data, error: updateError } = await authed
      .from('transactions')
      .update(updateData)
      .eq('id', transactionId)
      .eq('user_id', user.id)
      .select(`
        *,
        category:categories(*)
      `)
      .single()

    if (updateError) {
      throw new HttpError(400, updateError.message)
    }

    const message = newStatus 
      ? 'Transação marcada como paga com sucesso'
      : 'Transação marcada como não paga com sucesso'

    return successItem(data, message)
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

    if (req.method === 'GET' && (path.startsWith('/categories/') || path.startsWith('/cashflow/categories/'))) {
      return await handlers.getCategory({ req, authed, authHeader })
    }

    if (req.method === 'POST' && (path === '/categories' || path === '/cashflow/categories')) {
      return await handlers.createCategory({ req, authed, authHeader })
    }

    if (req.method === 'DELETE' && (path.startsWith('/categories/') || path.startsWith('/cashflow/categories/'))) {
      return await handlers.deleteCategory({ req, authed, authHeader })
    }

    if (req.method === 'PUT' && (path.startsWith('/categories/') || path.startsWith('/cashflow/categories/'))) {
      return await handlers.updateCategory({ req, authed, authHeader })
    }

    if (req.method === 'PATCH' && (path.startsWith('/categories/') || path.startsWith('/cashflow/categories/'))) {
      return await handlers.updateCategory({ req, authed, authHeader })
    }

    // Transactions endpoints
    if (req.method === 'GET' && (path === '/transactions' || path === '/cashflow/transactions')) {
      return await handlers.transactions({ req, authed, authHeader })
    }

    if (req.method === 'GET' && (path.startsWith('/transactions/') || path.startsWith('/cashflow/transactions/'))) {
      return await handlers.getTransaction({ req, authed, authHeader })
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

    // Payment status endpoints
    if (req.method === 'PATCH' && (path.match(/^\/transactions\/[^\/]+\/pay$/) || path.match(/^\/cashflow\/transactions\/[^\/]+\/pay$/))) {
      return await handlers.markAsPaid({ req, authed, authHeader })
    }

    if (req.method === 'PATCH' && (path.match(/^\/transactions\/[^\/]+\/unpay$/) || path.match(/^\/cashflow\/transactions\/[^\/]+\/unpay$/))) {
      return await handlers.markAsUnpaid({ req, authed, authHeader })
    }

    if (req.method === 'PATCH' && (path.match(/^\/transactions\/[^\/]+\/toggle-payment$/) || path.match(/^\/cashflow\/transactions\/[^\/]+\/toggle-payment$/))) {
      return await handlers.togglePaymentStatus({ req, authed, authHeader })
    }

    return json({ error: `Endpoint não encontrado: ${req.method} ${path}` }, 404)
  } catch (err: any) {
    if (err instanceof HttpError) {
      return json({ error: err.message }, err.status)
    }
    return json({ error: err?.message ?? 'Erro interno' }, 500)
  }
})