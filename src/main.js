import { isConfigured, ensureAnonymousSession, currentUser } from './supabase.js'
import {
  createGame, joinGame, getGame, getPlayers, getCurrentQuestion, getMyVote,
  getHostVotes, getVoteDistribution, submitVote, startGame, closeVoting,
  revealAnswer, nextRound, endGame, removePlayer, subscribeToGame,
} from './api.js'

const app = document.querySelector('#app')
const letters = ['A', 'B', 'C', 'D']
const catNames = {
  accident: 'Happy Accidents',
  names: "What's in a Name?",
  fiction: 'Fiction Got There First',
}

const esc = (value = '') => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;')

let unsubscribe = null
let refreshTimer = null
let busy = false

function scheduleRefresh(fn) {
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => fn().catch(showFatal), 100)
}

function showFatal(error) {
  console.error(error)
  app.innerHTML = shell(`
    <section class="card error-card">
      <div class="eyebrow">Something went wrong</div>
      <h1>${esc(error?.message || 'Unknown error')}</h1>
      <p>Refresh the page. If it still fails, keep this message — it should tell us exactly what Supabase rejected.</p>
      <button class="button primary" onclick="location.reload()">Refresh</button>
    </section>
  `)
}

function shell(body, compact = false) {
  return `
    <div class="page ${compact ? 'compact' : ''}">
      <header class="topbar">
        <a class="brand" href="/">
          <span class="brand-mark">?</span>
          <span><strong>Things You Thought You Knew</strong><small>All Crew Live</small></span>
        </a>
        <button class="icon-button" id="fullscreen-button" title="Full screen">⛶</button>
      </header>
      <main>${body}</main>
      <footer>Dauntless All Crew · live quiz</footer>
    </div>`
}

function bindGlobal() {
  document.querySelector('#fullscreen-button')?.addEventListener('click', async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen()
      else await document.exitFullscreen()
    } catch (_) {}
  })
}

function configScreen() {
  app.innerHTML = shell(`
    <section class="card hero-card centered">
      <div class="eyebrow">Connection needed</div>
      <div class="hero-icon">🔌</div>
      <h1>Supabase isn't connected yet</h1>
      <p>The multiplayer app needs its Supabase connection before it can start.</p>
    </section>`)
  bindGlobal()
}

function loading(text = 'Loading game…') {
  app.innerHTML = shell(`<section class="card centered loading-card"><div class="spinner"></div><h2>${esc(text)}</h2></section>`, true)
  bindGlobal()
}

async function init() {
  if (!isConfigured) return configScreen()
  loading('Connecting to All Crew…')
  await ensureAnonymousSession()
  const path = location.pathname.replace(/\/+$/, '') || '/'
  if (path === '/host') return hostPage()
  if (path === '/play') return playerPage()
  return joinPage()
}

function joinPage() {
  unsubscribe?.(); unsubscribe = null
  const params = new URLSearchParams(location.search)
  const code = params.get('code') || ''

  app.innerHTML = shell(`
    <section class="join-layout">
      <div class="join-copy">
        <div class="eyebrow">All Crew Game</div>
        <h1>Things You Thought You Knew</h1>
        <p>Strange inventions, unexpected names and future tech that fiction got to first.</p>
      </div>
      <form class="card join-card" id="join-form">
        <label>Your name<input id="player-name" maxlength="40" autocomplete="off" value="" placeholder="e.g. Peter" required></label>
        <label>Game code<input id="game-code" maxlength="8" autocomplete="off" value="${esc(code.toUpperCase())}" placeholder="e.g. A4B29C" required></label>
        <button class="button primary large" type="submit">Join All Crew →</button>
        <a class="button secondary large" href="/host" style="display:block;text-align:center;margin-top:10px;text-decoration:none">I'm hosting this game</a>
        <p class="form-error" id="form-error"></p>
      </form>
    </section>`)
  bindGlobal()

  const form = document.querySelector('#join-form')
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (busy) return
    busy = true
    const btn = form.querySelector('button')
    const err = document.querySelector('#form-error')
    btn.disabled = true; btn.textContent = 'Joining…'; err.textContent = ''
    try {
      const name = document.querySelector('#player-name').value.trim()
      const joinCode = document.querySelector('#game-code').value.trim().toUpperCase()
      const joined = await joinGame(joinCode, name)
      localStorage.setItem('allcrew_player_game_id', joined.game_id)
      history.replaceState({}, '', `/play?game=${joined.game_id}`)
      await playerPage()
    } catch (error) {
      err.textContent = friendlyError(error)
      btn.disabled = false; btn.textContent = 'Join All Crew →'
    } finally { busy = false }
  })
}

function friendlyError(error) {
  const m = error?.message || 'Something went wrong.'
  if (m.includes('Name already in use') || m.includes('players_game_active_name_unique') || m.includes('duplicate key value')) return 'Someone is already using that name in this game. Add your surname or initial.'
  if (m.includes('Game not found')) return 'That game code does not exist. Check the code on the shared screen.'
  if (m.includes('finished')) return 'That game has already finished.'
  if (m.includes('Anonymous sign-ins')) return 'Anonymous sign-ins are not enabled in Supabase yet.'
  return m
}

async function hostPage() {
  unsubscribe?.(); unsubscribe = null
  const stored = localStorage.getItem('allcrew_host_game_id')
  if (!stored) return renderHostCreate()
  try {
    await getGame(stored)
    await renderHostGame(stored)
  } catch (_) {
    localStorage.removeItem('allcrew_host_game_id')
    renderHostCreate()
  }
}

function renderHostCreate() {
  app.innerHTML = shell(`
    <section class="card hero-card centered">
      <div class="eyebrow">Host</div>
      <div class="hero-icon">🎙️</div>
      <h1>Start an All Crew game</h1>
      <p>Create the room, share the join link, wait for everyone to appear, then start the quiz.</p>
      <button class="button primary large" id="create-game">Create new game</button>
      <p class="form-error" id="host-error"></p>
    </section>`)
  bindGlobal()
  document.querySelector('#create-game').addEventListener('click', async (event) => {
    if (busy) return
    busy = true; event.currentTarget.disabled = true; event.currentTarget.textContent = 'Creating…'
    try {
      const game = await createGame()
      localStorage.setItem('allcrew_host_game_id', game.game_id)
      await renderHostGame(game.game_id)
    } catch (error) {
      document.querySelector('#host-error').textContent = friendlyError(error)
      event.currentTarget.disabled = false; event.currentTarget.textContent = 'Create new game'
    } finally { busy = false }
  })
}

async function renderHostGame(gameId) {
  const refresh = async () => {
    const [game, players, question, votes] = await Promise.all([
      getGame(gameId), getPlayers(gameId), getCurrentQuestion(gameId),
      getGame(gameId).then(g => g.status === 'active' ? getHostVotes(gameId, g.current_round) : []),
    ])
    let distribution = null
    if (['closed', 'revealed'].includes(game.phase)) distribution = await getVoteDistribution(gameId)
    paintHost({ game, players, question, votes, distribution })
  }

  await refresh()
  unsubscribe?.()
  unsubscribe = subscribeToGame(gameId, () => scheduleRefresh(refresh))
}

function hostHeader(game) {
  return `<div class="game-meta"><span>Round ${game.current_round} / ${game.total_rounds}</span><span class="phase phase-${game.phase}">${esc(game.phase)}</span></div>`
}

function paintHost({ game, players, question, votes, distribution }) {
  const activePlayers = players.filter(p => p.is_active)
  if (game.status === 'lobby') return paintLobby(game, activePlayers)
  if (game.status === 'finished' || game.phase === 'finished') return paintLeaderboard(game, activePlayers, true)

  const answeredIds = new Set(votes.map(v => v.player_id))
  const joinUrl = `${location.origin}/?code=${game.join_code}`
  const answerCards = (question?.options || []).map((o, i) => `
    <div class="answer-card host-answer ${game.phase === 'revealed' && question.correct_answer === i ? 'is-correct' : ''}">
      <span class="answer-letter">${letters[i]}</span><span class="answer-emoji">${esc(o.emoji)}</span>
      <strong>${esc(o.label)}</strong><small>${esc(o.detail || '')}</small>
    </div>`).join('')

  const people = activePlayers.map(p => `
    <div class="player-row"><span class="status-dot ${answeredIds.has(p.id) ? 'done' : ''}"></span><span>${esc(p.display_name)}</span>
      <button class="text-button remove-player" data-player="${p.id}">Remove</button></div>`).join('')

  const distributionMarkup = distribution ? renderDistribution(distribution, game.phase === 'revealed' ? question.correct_answer : null) : ''
  const revealMarkup = game.phase === 'revealed' ? `
    <section class="reveal-panel">
      <div class="reveal-answer"><span>The answer</span><h2>${letters[question.correct_answer]} — ${esc(question.options[question.correct_answer].label)}</h2><p>${esc(question.correct_explain)}</p></div>
      <div class="story"><h3>${esc(question.story_title)}</h3><p>${esc(question.story_body)}</p><strong>${esc(question.story_punch)}</strong>
      ${question.source_url ? `<a href="${esc(question.source_url)}" target="_blank" rel="noopener">Source: ${esc(question.source_label || 'Open source')} ↗</a>` : ''}</div>
    </section>` : ''

  let mainAction = ''
  if (game.phase === 'voting') mainAction = `<button class="button danger large" id="host-action">Close voting</button>`
  if (game.phase === 'closed') mainAction = `<button class="button primary large" id="host-action">Reveal answer</button>`
  if (game.phase === 'revealed') mainAction = `<button class="button primary large" id="host-action">${game.current_round === game.total_rounds ? 'Show final leaderboard →' : 'Next round →'}</button>`

  app.innerHTML = shell(`
    ${hostHeader(game)}
    <section class="host-grid">
      <div class="host-main">
        <div class="eyebrow">${esc(catNames[question.category] || question.category)}</div>
        <h1 class="question-title">${esc(question.title)}</h1>
        <p class="question-copy">${esc(question.question)}</p>
        <div class="answers-grid">${answerCards}</div>
        ${game.phase === 'closed' ? `<div class="host-callout">Votes are locked. Talk through the spread before you reveal the answer.</div>` : ''}
        ${distributionMarkup}
        ${revealMarkup}
        <div class="host-actions">${mainAction}<button class="button secondary" id="end-game">End game</button></div>
      </div>
      <aside class="host-sidebar card">
        <div class="sidebar-title"><div><strong>${game.answered_count} / ${activePlayers.length}</strong><small>answered</small></div><span>${esc(game.join_code)}</span></div>
        <p class="join-mini">${esc(joinUrl)}</p>
        <div class="players-list">${people || '<p class="muted">No active players.</p>'}</div>
      </aside>
    </section>`, true)
  bindGlobal(); bindHostActions(game)
}

function paintLobby(game, players) {
  const joinUrl = `${location.origin}/?code=${game.join_code}`
  app.innerHTML = shell(`
    <section class="lobby-grid">
      <div class="lobby-code">
        <div class="eyebrow">Lobby open</div>
        <h1>Join the game</h1>
        <div class="join-code">${esc(game.join_code)}</div>
        <p>${esc(joinUrl)}</p>
        <button class="button secondary" id="copy-link">Copy join link</button>
      </div>
      <div class="card lobby-players">
        <div class="lobby-heading"><h2>${players.length} joined</h2><span>Waiting for crew…</span></div>
        <div class="name-cloud">${players.map(p => `<span>${esc(p.display_name)}</span>`).join('') || '<p class="muted">Share the link and names will appear here live.</p>'}</div>
        <button class="button primary large" id="start-game" ${players.length ? '' : 'disabled'}>Start quiz →</button>
      </div>
    </section>`, true)
  bindGlobal()
  document.querySelector('#copy-link').addEventListener('click', async e => {
    await navigator.clipboard.writeText(joinUrl); e.currentTarget.textContent = 'Copied ✓'; setTimeout(() => e.currentTarget.textContent = 'Copy join link', 1200)
  })
  document.querySelector('#start-game').addEventListener('click', () => hostAction(() => startGame(game.id)))
}

function bindHostActions(game) {
  document.querySelector('#host-action')?.addEventListener('click', () => {
    if (game.phase === 'voting') return hostAction(() => closeVoting(game.id))
    if (game.phase === 'closed') return hostAction(() => revealAnswer(game.id))
    if (game.phase === 'revealed') return hostAction(() => nextRound(game.id))
  })
  document.querySelector('#end-game')?.addEventListener('click', () => {
    if (confirm('End this game and show the leaderboard?')) hostAction(() => endGame(game.id))
  })
  document.querySelectorAll('.remove-player').forEach(btn => btn.addEventListener('click', () => {
    const id = btn.dataset.player
    if (confirm('Remove this player from the game?')) hostAction(() => removePlayer(game.id, id))
  }))
}

async function hostAction(action) {
  if (busy) return
  busy = true
  try { await action() } catch (error) { alert(friendlyError(error)) } finally { busy = false }
}

function renderDistribution(distribution, correctIndex = null) {
  const max = Math.max(1, ...distribution.map(x => Number(x.count)))
  return `<section class="distribution"><h3>Votes</h3>${distribution.map(row => {
    const i = Number(row.answer)
    const count = Number(row.count)
    return `<div class="bar-row ${correctIndex === i ? 'correct-bar' : ''}"><span>${letters[i]}</span><div class="bar-track"><div class="bar-fill" style="width:${(count/max)*100}%"></div></div><strong>${count}</strong></div>`
  }).join('')}</section>`
}

function paintLeaderboard(game, players, host = false) {
  const ranked = [...players].filter(p => p.is_active).sort((a,b) => b.score - a.score || a.joined_at.localeCompare(b.joined_at))
  const rows = ranked.map((p,i) => `<div class="leader-row ${i < 3 ? 'podium' : ''}"><span class="rank">${['🥇','🥈','🥉'][i] || `${i+1}.`}</span><strong>${esc(p.display_name)}</strong><span>${p.score} / ${game.total_rounds}</span></div>`).join('')
  app.innerHTML = shell(`
    <section class="leaderboard-wrap">
      <div class="eyebrow">Game over</div><h1>Leaderboard</h1>
      <div class="card leaderboard">${rows || '<p>No players.</p>'}</div>
      ${host ? `<button class="button secondary" id="new-game">Start a new game</button>` : '<p class="waiting-copy">Thanks for playing. You can close this tab.</p>'}
    </section>`, true)
  bindGlobal()
  document.querySelector('#new-game')?.addEventListener('click', () => { localStorage.removeItem('allcrew_host_game_id'); location.reload() })
}

async function playerPage() {
  unsubscribe?.(); unsubscribe = null
  const params = new URLSearchParams(location.search)
  const gameId = params.get('game') || localStorage.getItem('allcrew_player_game_id')
  if (!gameId) { location.href = '/'; return }
  localStorage.setItem('allcrew_player_game_id', gameId)

  const refresh = async () => {
    const [game, players, question, user] = await Promise.all([getGame(gameId), getPlayers(gameId), getCurrentQuestion(gameId), currentUser()])
    const me = players.find(p => p.user_id === user.id)
    if (!me || !me.is_active) { localStorage.removeItem('allcrew_player_game_id'); location.href = '/'; return }
    const vote = game.status === 'active' ? await getMyVote(gameId, game.current_round) : null
    let distribution = null
    if (['closed','revealed'].includes(game.phase)) distribution = await getVoteDistribution(gameId)
    paintPlayer({ game, players, question, me, vote, distribution })
  }

  try { await refresh() } catch (error) { return showFatal(error) }
  unsubscribe = subscribeToGame(gameId, () => scheduleRefresh(refresh))
}

function paintPlayer({ game, players, question, me, vote, distribution }) {
  const active = players.filter(p => p.is_active)
  if (game.status === 'lobby') {
    app.innerHTML = shell(`<section class="card player-state centered"><div class="hero-icon">👋</div><div class="eyebrow">You're in, ${esc(me.display_name)}</div><h1>Waiting for the host</h1><p>${active.length} people have joined. Keep this page open.</p></section>`, true)
    return bindGlobal()
  }
  if (game.status === 'finished' || game.phase === 'finished') return paintLeaderboard(game, active, false)

  const optionCards = (question.options || []).map((o,i) => {
    const chosen = vote && Number(vote.answer) === i
    const correct = game.phase === 'revealed' && question.correct_answer === i
    const wrongChoice = game.phase === 'revealed' && chosen && !correct
    return `<button class="answer-card player-answer ${chosen ? 'chosen' : ''} ${correct ? 'is-correct' : ''} ${wrongChoice ? 'is-wrong' : ''}" data-answer="${i}" ${vote || game.phase !== 'voting' ? 'disabled' : ''}>
      <span class="answer-letter">${letters[i]}</span><span class="answer-emoji">${esc(o.emoji)}</span><strong>${esc(o.label)}</strong><small>${esc(o.detail || '')}</small>
    </button>`
  }).join('')

  let state = ''
  if (game.phase === 'voting' && !vote) state = `<div class="player-status open">Choose one answer. Once it's locked, you can't change it.</div>`
  if (game.phase === 'voting' && vote) state = `<div class="player-status locked">🔒 Answer locked · ${game.answered_count} / ${active.length} answered</div>`
  if (game.phase === 'closed') state = `<div class="player-status locked">Votes are closed. Waiting for the reveal…</div>${renderDistribution(distribution, null)}`
  if (game.phase === 'revealed') {
    const right = vote && Number(vote.answer) === Number(question.correct_answer)
    state = `<div class="personal-result ${right ? 'right' : 'wrong'}"><strong>${right ? '✓ Correct' : vote ? '✕ Not this time' : 'No answer recorded'}</strong><span>${right ? `Score: ${me.score} / ${game.current_round}` : `The answer was ${letters[question.correct_answer]} — ${esc(question.options[question.correct_answer].label)}`}</span></div>
      ${renderDistribution(distribution, question.correct_answer)}
      <section class="mini-story"><h3>${esc(question.story_title)}</h3><p>${esc(question.story_body)}</p><strong>${esc(question.story_punch)}</strong></section>`
  }

  app.innerHTML = shell(`
    <div class="game-meta"><span>Round ${game.current_round} / ${game.total_rounds}</span><span>${esc(me.display_name)} · ${me.score} pts</span></div>
    <section class="player-question">
      <div class="eyebrow">${esc(catNames[question.category] || question.category)}</div>
      <h1>${esc(question.title)}</h1><p>${esc(question.question)}</p>
      <div class="answers-grid">${optionCards}</div>${state}
    </section>`, true)
  bindGlobal()
  document.querySelectorAll('.player-answer:not([disabled])').forEach(btn => btn.addEventListener('click', async () => {
    if (busy) return
    busy = true
    document.querySelectorAll('.player-answer').forEach(b => b.disabled = true)
    try { await submitVote(game.id, Number(btn.dataset.answer)) }
    catch (error) { alert(friendlyError(error)); busy = false; scheduleRefresh(() => playerPage()) }
    finally { busy = false }
  }))
}

init().catch(showFatal)
