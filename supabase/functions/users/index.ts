import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, accept',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
};

serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const { method } = req
    const authHeader = req.headers.get('Authorization') ?? ''

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    // Cliente autenticado pelo token do usuário (para GET/PUT sob RLS)
    const authedClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: authHeader ? { Authorization: authHeader } : {} },
    })

    // Cliente com service role (apenas no servidor; NUNCA no frontend)
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // Helper para exigir auth nas rotas protegidas
    const requireAuth = async () => {
      if (!authHeader) {
        return { user: null, error: new Error('Unauthorized') }
      }
      const { data, error } = await authedClient.auth.getUser()
      return { user: data?.user ?? null, error }
    }

    switch (method) {
      // -------- GET (PROTEGIDO) ----------
      case 'GET': {
        const { user, error } = await requireAuth()
        if (error || !user) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }

        // verifica se é staff
        const { data: currentUser, error: userError } = await authedClient
          .from('users')
          .select('is_staff')
          .eq('id', user.id)
          .single()

        if (userError) {
          return new Response(JSON.stringify({ error: userError.message }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }

        const isStaff = currentUser?.is_staff || false

        if (isStaff) {
          const { data: allUsers, error: getAllError } = await adminClient
            .from('users')
            .select('*')
            .order('created_at', { ascending: false })

          if (getAllError) {
            return new Response(JSON.stringify({ error: getAllError.message }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            })
          }

          return new Response(JSON.stringify({ users: allUsers, is_staff: true }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        } else {
          const { data: profile, error: getError } = await authedClient
            .from('users')
            .select('*')
            .eq('id', user.id)
            .single()

          if (getError) {
            return new Response(JSON.stringify({ error: getError.message }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            })
          }

          return new Response(JSON.stringify({ user: profile, is_staff: false }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
      }

      // -------- POST (PÚBLICO / SEM LOGIN) ----------
      case 'POST': {
        const body = await req.json()

        // cria usuário no Auth (confirmado) — não exige Authorization
        const { data: newAuthUser, error: createAuthError } =
          await adminClient.auth.admin.createUser({
            email: body.email,
            password: body.password,
            email_confirm: true,
            user_metadata: {
              full_name: body.full_name,
              username: body.username,
              avatar_url: body.avatar_url ?? null,
            },
          })

        if (createAuthError || !newAuthUser?.user) {
          return new Response(
            JSON.stringify({
              error: `Failed to create user in auth: ${createAuthError?.message ?? 'Unknown error'}`,
            }),
            {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          )
        }

        // upsert do perfil (bypass RLS via service role)
        const profileData = {
          id: newAuthUser.user.id,
          email: newAuthUser.user.email,
          full_name: body.full_name,
          username: body.username,
          avatar_url: body.avatar_url ?? null,
          bio: body.bio ?? null,
          phone: body.phone ?? null,
          date_of_birth: body.date_of_birth ?? null,
          location: body.location ?? null,
          website: body.website ?? null,
          preferences: body.preferences || {},
        }

        const { data: upsertData, error: upsertError } = await adminClient
          .from('users')
          .upsert(profileData, { onConflict: 'id' })
          .select()
          .single()

        if (upsertError) {
          return new Response(JSON.stringify({ error: upsertError.message }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }

        return new Response(
          JSON.stringify({
            message: 'User created successfully',
            user: upsertData,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        )
      }

      // -------- PUT (PROTEGIDO) ----------
      case 'PUT': {
        const { user, error } = await requireAuth()
        if (error || !user) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }

        const updateBody = await req.json()

        // checa permissão (staff pode editar outros)
        const { data: checkUser, error: checkError } = await authedClient
          .from('users')
          .select('is_staff')
          .eq('id', user.id)
          .single()

        if (checkError) {
          return new Response(JSON.stringify({ error: checkError.message }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }

        const canEditOthers = checkUser?.is_staff || false
        if (!canEditOthers && updateBody.id && updateBody.id !== user.id) {
          return new Response(JSON.stringify({ error: 'Insufficient permissions' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }

        const { is_staff, ...safeUpdateData } = updateBody

        const { data: updateData, error: updateError } = await authedClient
          .from('users')
          .update(safeUpdateData)
          .eq('id', updateBody.id || user.id)
          .select()
          .single()

        if (updateError) {
          return new Response(JSON.stringify({ error: updateError.message }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }

        return new Response(JSON.stringify(updateData), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      default:
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
          status: 405,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
}, { verifyJwt: false }) // <= POST público, GET/PUT protegidos dentro da função
