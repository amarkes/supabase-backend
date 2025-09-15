import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient, type User } from 'https://esm.sh/@supabase/supabase-js@2'

// ============================
// CORS + helpers
// ============================
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, accept',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Credentials': 'true',
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
  // GET /me - Retorna dados do usuário logado
  async me({ authed }: Ctx) {
    const user = await requireAuth(authed)

    const { data: profile, error } = await authed
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single()

    if (error) throw new HttpError(400, error.message)

    // Dados de autenticação do Supabase Auth
    const authUser = {
      id: user.id,
      email: user.email,
      phone: user.phone,
      app_metadata: user.app_metadata,
      user_metadata: user.user_metadata,
      role: (user.user_metadata as any)?.role ?? null,
      created_at: user.created_at,
      updated_at: user.updated_at,
      email_confirmed_at: user.email_confirmed_at,
      phone_confirmed_at: user.phone_confirmed_at,
      last_sign_in_at: user.last_sign_in_at,
      confirmed_at: user.confirmed_at,
      recovery_sent_at: user.recovery_sent_at,
      new_email: user.new_email,
      new_phone: user.new_phone,
      invited_at: user.invited_at,
      action_link: user.action_link,
      email_change_sent_at: user.email_change_sent_at,
      new_email_change_sent_at: user.new_email_change_sent_at,
      phone_change_sent_at: user.phone_change_sent_at,
      new_phone_change_sent_at: user.new_phone_change_sent_at,
      reauthentication_sent_at: user.reauthentication_sent_at,
      reauthentication_token: user.reauthentication_token,
      is_sso_user: user.is_sso_user,
      deleted_at: user.deleted_at,
      is_anonymous: user.is_anonymous,
    }

    // Dados do perfil da tabela users
    const userProfile = {
      id: profile.id,
      email: profile.email,
      full_name: profile.full_name,
      username: profile.username,
      avatar_url: profile.avatar_url,
      bio: profile.bio,
      phone: profile.phone,
      date_of_birth: profile.date_of_birth,
      location: profile.location,
      website: profile.website,
      is_verified: profile.is_verified,
      is_active: profile.is_active,
      is_staff: profile.is_staff,
      last_login: profile.last_login,
      preferences: profile.preferences,
      created_at: profile.created_at,
      updated_at: profile.updated_at,
    }

    return json({ 
      user: authUser, 
      profile: userProfile 
    })
  },

  // POST /login - Login por email/senha
  async login({ req }: Ctx) {
    const { email, password } = await readJSON<{ email?: string; password?: string }>(req)
    requireFields({ email, password }, ['email', 'password'])

    // Usa client anônimo para login (sem Authorization header)
    const { data, error } = await anon.auth.signInWithPassword({ 
      email: email!, 
      password: password! 
    })
    
    if (error) {
      throw new HttpError(401, error.message)
    }

    const { session, user } = data
    if (!session || !user) throw new HttpError(500, 'Falha ao criar sessão')

    // Carrega perfil do usuário usando admin client
    let profile: any = null
    const { data: prof } = await admin
      .from('users')
      .select('*')
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

  // DELETE /logout - Logout do usuário
  async logout({ authed, req }: Ctx) {
    const user = await requireAuth(authed)

    const url = new URL(req.url)
    const scope = url.searchParams.get('scope') || 'local'
    const targetUserId = url.searchParams.get('user_id')

    // Verificar se é staff para logout de outros usuários
    if (targetUserId && targetUserId !== user.id) {
      const { data: currentUser, error: userError } = await authed
        .from('users')
        .select('is_staff')
        .eq('id', user.id)
        .single()

      if (userError || !currentUser?.is_staff) {
        throw new HttpError(403, 'Insufficient permissions')
      }
    }

    const userIdToLogout = targetUserId || user.id

    try {
      // Para logout local do próprio usuário, usar o cliente autenticado
      if (scope === 'local' && !targetUserId) {
        const { error: logoutError } = await authed.auth.signOut()
        
        if (logoutError) {
          // Mesmo com erro, consideramos sucesso pois o token pode já estar expirado
        }
        
        return json({ 
          message: `User logged out successfully (local scope)`,
          user_id: userIdToLogout,
          scope: 'local'
        })
      }

      // Para logout global do próprio usuário ou logout de outros usuários, usar admin client
      const { error: logoutError } = await admin.auth.admin.signOut(userIdToLogout, {
        scope: scope as 'local' | 'global'
      })

      if (logoutError) {
        // Mesmo com erro, consideramos sucesso pois o token pode já estar expirado
      }

      return json({ 
        message: `User logged out successfully (${scope} scope)`,
        user_id: userIdToLogout,
        scope: scope
      })
    } catch (err) {
      // Mesmo com erro, consideramos sucesso pois o logout pode ter funcionado
      return json({ 
        message: `User logged out successfully (${scope} scope)`,
        user_id: userIdToLogout,
        scope: scope
      })
    }
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
    const path = url.pathname

    // Remove o prefixo da função (/functions/v1/auth) do path
    const cleanPath = path.replace('/functions/v1/auth', '') || '/'

    if (req.method === 'GET' && (cleanPath === '/me' || cleanPath === '/auth/me')) {
      return await handlers.me({ req, authed, authHeader })
    }

    if (req.method === 'POST' && (cleanPath === '/login' || cleanPath === '/auth/login')) {
      return await handlers.login({ req, authed, authHeader })
    }

    if (req.method === 'DELETE' && (cleanPath === '/logout' || cleanPath === '/auth/logout')) {
      return await handlers.logout({ req, authed, authHeader })
    }

    return json({ error: `Endpoint não encontrado: ${req.method} ${cleanPath}` }, 404)
  } catch (err: any) {
    if (err instanceof HttpError) {
      return json({ error: err.message }, err.status)
    }
    return json({ error: err?.message ?? 'Erro interno' }, 500)
  }
})
