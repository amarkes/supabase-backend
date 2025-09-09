import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient, type User } from 'https://esm.sh/@supabase/supabase-js@2'

// ============================
// CORS + helpers
// ============================
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, accept',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
} as const

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  })

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

// Clients globais sem cabeçalho Authorization (útil pro login)
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
    // só envia Authorization se presente
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
  // Retorna usuário do auth + perfil na tabela users
  async me({ authed }: Ctx) {
    const user = await requireAuth(authed)

    const { data: profile, error } = await authed
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single()

    if (error) throw new HttpError(400, error.message)

    const safeUser = {
      id: user.id,
      email: user.email,
      phone: user.phone,
      app_metadata: user.app_metadata,
      user_metadata: user.user_metadata,
      role: (user.user_metadata as any)?.role ?? null, // se você usa role no user_metadata
      created_at: user.created_at,
      updated_at: user.updated_at,
    }

    return json({ user: safeUser, profile })
  },

  // Atualiza flag is_staff de outro usuário — somente staff pode
  async change_staff({ authed, req }: Ctx) {
    const user = await requireAuth(authed)
    const { target_user_id, is_staff } = await readJSON<{
      target_user_id?: string
      is_staff?: boolean
    }>(req)

    requireFields({ target_user_id, is_staff }, ['target_user_id', 'is_staff'])

    // Checa se chamador é staff via RLS (client autenticado)
    const { data: caller, error: callerErr } = await authed
      .from('users')
      .select('id, is_staff')
      .eq('id', user.id)
      .single()

    if (callerErr) throw new HttpError(400, callerErr.message)
    if (!caller?.is_staff) throw new HttpError(403, 'Forbidden (somente staff)')

    const { data: updated, error } = await admin
      .from('users')
      .update({ is_staff })
      .eq('id', target_user_id)
      .select('id, is_staff')
      .single()

    if (error) throw new HttpError(400, error.message)

    return json({ message: 'is_staff atualizado com sucesso', target: updated })
  },

  // Login por email/senha (usa client anon, sem Authorization do chamador)
  async login({ req }: Ctx) {
    const { email, password } = await readJSON<{ email?: string; password?: string }>(req)
    requireFields({ email, password }, ['email', 'password'])

    const { data, error } = await anon.auth.signInWithPassword({ email: email!, password: password! })
    if (error) throw new HttpError(401, error.message)

    const { session, user } = data
    if (!session || !user) throw new HttpError(500, 'Falha ao criar sessão')

    // (Opcional) carrega perfil
    let profile: any = null
    const { data: prof } = await admin
      .from('users')
      .select('id, email, full_name, username, is_staff')
      .eq('id', user.id)
      .maybeSingle()
    profile = prof ?? null

    return json({
      token_type: session.token_type,
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        app_metadata: user.app_metadata,
        user_metadata: user.user_metadata,
        created_at: user.created_at,
        updated_at: user.updated_at,
      },
      profile,
    })
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

  if (req.method !== 'POST') {
    return json({ error: 'Método não permitido' }, 405)
  }

  try {
    const authHeader = req.headers.get('Authorization')
    const authed = authedClientFrom(authHeader)

    const { action } = await readJSON<{ action?: string }>(req)
    if (!action) throw new HttpError(400, 'Ação obrigatória')

    const handler = handlers[action]
    if (!handler) throw new HttpError(400, 'Ação inválida')

    return await handler({ req, authed, authHeader })
  } catch (err: any) {
    if (err instanceof HttpError) {
      return json({ error: err.message }, err.status)
    }
    // log opcional
    // console.error('[edge-fn] error:', err)
    return json({ error: err?.message ?? 'Erro interno' }, 500)
  }
})
