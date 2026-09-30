import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = 'https://ivnqfklgaktmbtjuldqj.supabase.co'
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_-2OXX7g_bHMHsUJbQ4lUXA_qKSXBRYJ'

export const isConfigured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY)

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

export async function ensureAnonymousSession() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  if (sessionError) throw sessionError
  if (sessionData.session) return sessionData.session

  const { data, error } = await supabase.auth.signInAnonymously()
  if (error) throw error
  return data.session
}

export async function currentUser() {
  const { data, error } = await supabase.auth.getUser()
  if (error) throw error
  return data.user
}
