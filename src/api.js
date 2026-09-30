import { supabase, ensureAnonymousSession, currentUser } from './supabase.js'

async function rpc(name, params = {}) {
  const { data, error } = await supabase.rpc(name, params)
  if (error) throw error
  return data
}

export async function createGame() {
  await ensureAnonymousSession()
  const game = await rpc('create_game')
  if (!game?.game_id) throw new Error('Game could not be created')
  return game
}

export async function joinGame(code, name) {
  await ensureAnonymousSession()
  const joined = await rpc('join_game', { p_code: code.trim().toUpperCase(), p_name: name.trim() })
  if (!joined?.game_id) throw new Error('Game not found')
  return joined
}

export async function getGame(gameId) {
  const { data, error } = await supabase
    .from('games')
    .select('id,join_code,status,phase,current_round,total_rounds,answered_count,created_at,ended_at')
    .eq('id', gameId)
    .single()
  if (error) throw error
  return data
}

export async function getPlayers(gameId) {
  const { data, error } = await supabase
    .from('players')
    .select('id,user_id,display_name,score,is_active,joined_at')
    .eq('game_id', gameId)
    .order('joined_at', { ascending: true })
  if (error) throw error
  return data
}

export async function getCurrentQuestion(gameId) {
  return rpc('get_current_question', { p_game_id: gameId })
}

export async function getMyVote(gameId, roundIndex) {
  const user = await currentUser()
  const { data, error } = await supabase
    .from('votes')
    .select('player_id,round_index,answer,is_correct,locked')
    .eq('game_id', gameId)
    .eq('round_index', roundIndex)
    .eq('user_id', user.id)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function getHostVotes(gameId, roundIndex) {
  const { data, error } = await supabase
    .from('votes')
    .select('player_id,round_index,answer')
    .eq('game_id', gameId)
    .eq('round_index', roundIndex)
  if (error) throw error
  return data || []
}

export async function getVoteDistribution(gameId) {
  return rpc('get_vote_distribution', { p_game_id: gameId })
}

export async function submitVote(gameId, answer) {
  return rpc('submit_vote', { p_game_id: gameId, p_answer: answer })
}

export async function lockVote(gameId) {
  return rpc('lock_vote', { p_game_id: gameId })
}

export async function startGame(gameId) {
  return rpc('host_start_game', { p_game_id: gameId })
}

export async function closeVoting(gameId) {
  return rpc('host_close_voting', { p_game_id: gameId })
}

export async function revealAnswer(gameId) {
  return rpc('host_reveal_answer', { p_game_id: gameId })
}

export async function nextRound(gameId) {
  return rpc('host_next_round', { p_game_id: gameId })
}

export async function endGame(gameId) {
  return rpc('host_end_game', { p_game_id: gameId })
}

export async function removePlayer(gameId, playerId) {
  return rpc('host_remove_player', { p_game_id: gameId, p_player_id: playerId })
}

export function subscribeToGame(gameId, onChange) {
  const channel = supabase
    .channel(`allcrew-game-${gameId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `id=eq.${gameId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `game_id=eq.${gameId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'votes', filter: `game_id=eq.${gameId}` }, onChange)
    .subscribe()

  return () => supabase.removeChannel(channel)
}
