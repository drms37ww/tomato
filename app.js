// ============ CONFIGURATION ============
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwC2jZCHMz3mMpaIwwVRWa9G608RAefwFlwwog9Z_f0sl4sK5s8j6ibsK1n6lK67Oo2sA/exec';

// ============ STATE ============
let state = {
  folders: [],
  decks: [],
  cards: [],
  todos: [],
  taskLists: [{ id: 'default', name: 'My Tasks', color: '#4a9eff' }],
  currentTaskList: 'default',
  currentView: 'flashcards',
  currentFolder: null,
  currentDeck: null,
  editingCard: null,
  editingTodo: null,
  editingParentFolder: null,
  studySession: null,
  studyMode: 'flashcards',
  showCompleted: false,
  starred: [],
  settings: {
    shuffle: true,
    reverse: false,
    studyStarredOnly: false,
    autoPlayAudio: false
  },
  stats: {
    totalStudyTime: 0,
    studyStreak: 0,
    lastStudyDate: null,
    accuracy: {}
  }
};

// ============ LOCAL STORAGE ============
function saveToLocal() {
  localStorage.setItem('studyAppData', JSON.stringify({
    folders: state.folders,
    decks: state.decks,
    cards: state.cards,
    todos: state.todos,
    taskLists: state.taskLists,
    currentTaskList: state.currentTaskList,
    starred: state.starred,
    settings: state.settings,
    stats: state.stats
  }));
}

function loadFromLocal() {
  const data = localStorage.getItem('studyAppData');
  if (data) {
    const parsed = JSON.parse(data);
    state.folders = parsed.folders || [];
    state.decks = parsed.decks || [];
    state.cards = parsed.cards || [];
    state.todos = parsed.todos || [];
    state.taskLists = parsed.taskLists || [{ id: 'default', name: 'My Tasks', color: '#4a9eff' }];
    state.currentTaskList = parsed.currentTaskList || 'default';
    state.starred = parsed.starred || [];
    state.settings = parsed.settings || { shuffle: true, reverse: false, studyStarredOnly: false, autoPlayAudio: false };
    state.stats = parsed.stats || { totalStudyTime: 0, studyStreak: 0, lastStudyDate: null, accuracy: {} };
    return true;
  }
  return false;
}

// ============ API ============
async function apiCall(action, params = {}) {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([k, v]) => {
    url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : v);
  });

  try {
    const response = await fetch(url.toString());
    return await response.json();
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
}

async function syncData() {
  showSyncIndicator(true);
  try {
    const data = await apiCall('syncAll');
    state.folders = data.folders || [];
    state.decks = data.decks || [];
    state.cards = data.cards || [];
    state.todos = data.todos || [];
    if (data.taskLists) state.taskLists = data.taskLists;
    if (data.starred) state.starred = data.starred;
    saveToLocal();
    showSyncIndicator(false);
    return true;
  } catch (error) {
    showSyncIndicator(false, true);
    return false;
  }
}

function showSyncIndicator(show, error = false) {
  const indicator = document.getElementById('sync-indicator');
  if (show) {
    indicator.classList.remove('hidden', 'error');
    indicator.classList.add('syncing');
    indicator.innerHTML = '<div class="spinner"></div><span>Syncing...</span>';
  } else if (error) {
    indicator.classList.remove('hidden', 'syncing');
    indicator.classList.add('error');
    indicator.innerHTML = '<span>Sync failed</span>';
    setTimeout(() => indicator.classList.add('hidden'), 3000);
  } else {
    indicator.classList.add('hidden');
  }
}

// ============ NOTIFICATIONS ============
async function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    await Notification.requestPermission();
  }
}

function scheduleReminders() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  state.todos.forEach(todo => {
    if (!todo.reminders || todo.completed) return;
    
    todo.reminders.forEach(reminderDateTime => {
      const reminderTime = new Date(reminderDateTime).getTime();
      const now = Date.now();
      const delay = reminderTime - now;

      if (delay > 0 && delay < 86400000 * 14) {
        setTimeout(() => {
          new Notification('Study Reminder', {
            body: todo.title,
            icon: 'icon-192.png',
            tag: todo.id + reminderDateTime,
            silent: true
          });
        }, delay);
      }
    });
  });
}

// ============ SPACED REPETITION ============
function getWeightedCards(cards, shuffle = true) {
  const weighted = [];
  cards.forEach(card => {
    const weight = Math.max(1, (card.wrongCount || 0) * 2 + 1);
    for (let i = 0; i < weight; i++) {
      weighted.push({ ...card });
    }
  });

  if (shuffle) {
    for (let i = weighted.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [weighted[i], weighted[j]] = [weighted[j], weighted[i]];
    }
  }

  const seen = new Set();
  return weighted.filter(card => {
    if (seen.has(card.id)) return false;
    seen.add(card.id);
    return true;
  });
}

// ============ AUDIO SUPPORT ============
function speak(text) {
  if ('speechSynthesis' in window) {
    stopSpeaking();
    const utterance = new SpeechSynthesisUtterance(stripHtml(text));
    utterance.rate = 0.9;
    utterance.pitch = 1;
    speechSynthesis.speak(utterance);
  }
}

function stopSpeaking() {
  if ('speechSynthesis' in window) {
    speechSynthesis.cancel();
  }
}

function speakCurrentCard() {
  const card = state.studySession.cards[state.studySession.currentIndex];
  const flipped = document.getElementById('flashcard-inner')?.classList.contains('flipped');
  const text = flipped 
    ? (state.settings.reverse ? card.term : card.definition)
    : (state.settings.reverse ? card.definition : card.term);
  speak(text);
}

// ============ STAR/FAVORITE CARDS ============
function toggleStar(cardId) {
  const index = state.starred.indexOf(cardId);
  if (index >= 0) {
    state.starred.splice(index, 1);
  } else {
    state.starred.push(cardId);
  }
  saveToLocal();
  
  try {
    apiCall('updateStarred', { cardId, starred: isStarred(cardId) });
  } catch (error) {
    console.error('Failed to sync star:', error);
  }
  
  render();
}

function isStarred(cardId) {
  return state.starred.includes(cardId);
}

// ============ STATISTICS ============
function updateStats(correct, timeSpent) {
  const deckId = state.studySession?.deckId;
  if (!deckId) return;

  state.stats.totalStudyTime += timeSpent;
  
  if (!state.stats.accuracy[deckId]) {
    state.stats.accuracy[deckId] = { correct: 0, total: 0 };
  }
  if (correct) state.stats.accuracy[deckId].correct++;
  state.stats.accuracy[deckId].total++;

  const today = new Date().toDateString();
  if (state.stats.lastStudyDate !== today) {
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    if (state.stats.lastStudyDate === yesterday) {
      state.stats.studyStreak++;
    } else {
      state.stats.studyStreak = 1;
    }
    state.stats.lastStudyDate = today;
  }

  saveToLocal();
}

// ============ TASK LIST MANAGEMENT ============
function createTaskList(name, color = '#4a9eff') {
  const list = {
    id: 'list_' + Date.now(),
    name,
    color
  };
  state.taskLists.push(list);
  saveToLocal();
  return list;
}

function deleteTaskList(listId) {
  if (listId === 'default') return;
  state.taskLists = state.taskLists.filter(l => l.id !== listId);
  state.todos.forEach(todo => {
    if (todo.listId === listId) todo.listId = 'default';
  });
  if (state.currentTaskList === listId) state.currentTaskList = 'default';
  saveToLocal();
}

function switchTaskList(listId) {
  state.currentTaskList = listId;
  saveToLocal();
  render();
}

// ============ SUBTASKS ============
function addSubtask(parentId, title) {
  const parent = state.todos.find(t => t.id === parentId);
  if (!parent) return;

  const subtask = {
    id: 'todo_' + Date.now(),
    title,
    parentId,
    listId: parent.listId,
    completed: false,
    priority: 'task'
  };

  state.todos.push(subtask);
  saveToLocal();
  return subtask;
}

function getSubtasks(parentId) {
  return state.todos.filter(t => t.parentId === parentId);
}

// ============ DRAG AND DROP ============
let draggedTodo = null;
let dragOverTodo = null;

function initDragAndDrop() {
  document.querySelectorAll('.todo-item[data-todo-id]').forEach(item => {
    const todoId = item.dataset.todoId;
    if (!todoId) return;

    item.draggable = true;
    
    item.addEventListener('dragstart', (e) => {
      draggedTodo = todoId;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      document.querySelectorAll('.todo-item').forEach(el => el.classList.remove('drag-over'));
      draggedTodo = null;
      dragOverTodo = null;
    });

    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      dragOverTodo = todoId;
      item.classList.add('drag-over');
    });

    item.addEventListener('dragleave', () => {
      item.classList.remove('drag-over');
    });

    item.addEventListener('drop', (e) => {
      e.preventDefault();
      item.classList.remove('drag-over');
      
      if (draggedTodo && dragOverTodo && draggedTodo !== dragOverTodo) {
        reorderTodos(draggedTodo, dragOverTodo);
      }
    });
  });
}

function reorderTodos(draggedId, targetId) {
  const todos = state.todos.filter(t => t.listId === state.currentTaskList && !t.parentId && !t.completed);
  const draggedIndex = todos.findIndex(t => t.id === draggedId);
  const targetIndex = todos.findIndex(t => t.id === targetId);

  if (draggedIndex === -1 || targetIndex === -1) return;

  const [removed] = todos.splice(draggedIndex, 1);
  todos.splice(targetIndex, 0, removed);

  todos.forEach((todo, idx) => {
    const original = state.todos.find(t => t.id === todo.id);
    if (original) original.order = idx;
  });

  saveToLocal();
  render();
}

// ============ HELPER FUNCTIONS ============
function getUpcomingDecks() {
  const deckDueDates = [];
  
  state.todos.forEach(todo => {
    if (!todo.linkedDecks || todo.completed || !todo.dueDate) return;
    
    todo.linkedDecks.forEach(deckId => {
      const deck = state.decks.find(d => d.id === deckId);
      if (deck) {
        deckDueDates.push({
          deck,
          dueDate: todo.dueDate,
          todoTitle: todo.title
        });
      }
    });
  });

  deckDueDates.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  
  const seen = new Set();
  return deckDueDates.filter(item => {
    if (seen.has(item.deck.id)) return false;
    seen.add(item.deck.id);
    return true;
  });
}

function getCardCount(deckId) {
  return state.cards.filter(c => c.deckId === deckId).length;
}

function getSubfolderCount(folderPath) {
  return state.folders.filter(f => f.parentPath === folderPath).length;
}

function getDeckCountInFolder(folderPath) {
  return state.decks.filter(d => d.folderPath === folderPath).length;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTime(time) {
  if (!time) return '';
  return time;
}

function isOverdue(dateStr) {
  return new Date(dateStr) < new Date();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function stripHtml(html) {
  const div = document.createElement('div');
  div.innerHTML = html || '';
  return div.textContent || div.innerText || '';
}

const PRIORITY_ORDER = { summative: 1, formative: 2, task: 3, low: 4 };

function sortTodos(todos) {
  return [...todos].sort((a, b) => {
    if (!a.dueDate && !b.dueDate) {
      return (PRIORITY_ORDER[a.priority] || 99) - (PRIORITY_ORDER[b.priority] || 99);
    }
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    const dateDiff = new Date(a.dueDate) - new Date(b.dueDate);
    if (dateDiff !== 0) return dateDiff;
    return (PRIORITY_ORDER[a.priority] || 99) - (PRIORITY_ORDER[b.priority] || 99);
  });
}

// ============ NAVIGATION ============
function navigateBack(parentPath) {
  if (parentPath) {
    state.currentFolder = parentPath;
    state.currentView = 'folder';
  } else {
    state.currentFolder = null;
    state.currentView = 'flashcards';
  }
  render();
}

function openFolder(path) {
  state.currentFolder = path;
  state.currentView = 'folder';
  render();
}

function openDeck(deckId) {
  state.studySession = {
    deckId,
    cards: [],
    currentIndex: 0,
    totalCards: 0,
    correct: 0,
    wrong: 0,
    wrongCards: [],
    history: []
  };
  state.currentView = 'study-mode-select';
  render();
}

function showDeckDetail(deckId) {
  state.currentDeck = deckId;
  state.currentView = 'deck-detail';
  render();
}

function cancelStudy() {
  state.studySession = null;
  state.studyMode = 'flashcards';
  state.currentView = 'flashcards';
  render();
}

function goBackFromDeck() {
  const deck = state.decks.find(d => d.id === state.currentDeck);
  if (deck && deck.folderPath) {
    state.currentFolder = deck.folderPath;
    state.currentView = 'folder';
  } else {
    state.currentView = 'flashcards';
  }
  state.currentDeck = null;
  render();
}

// ============ STUDY MODE SELECTION ============
function selectStudyMode(mode) {
  state.studyMode = mode;
  state.currentView = 'study-setup';
  render();
}

function toggleSetting(setting) {
  state.settings[setting] = !state.settings[setting];
  saveToLocal();
  render();
}

function startStudy() {
  let deckCards = state.cards.filter(c => c.deckId === state.studySession.deckId);
  
  if (state.settings.studyStarredOnly) {
    deckCards = deckCards.filter(c => isStarred(c.id));
  }
  
  if (deckCards.length === 0) {
    alert('No cards to study!');
    return;
  }
  
  const orderedCards = getWeightedCards(deckCards, state.settings.shuffle);
  
  state.studySession.cards = orderedCards;
  state.studySession.totalCards = orderedCards.length;
  state.studySession.currentIndex = 0;
  state.studySession.correct = 0;
  state.studySession.wrong = 0;
  state.studySession.wrongCards = [];
  state.studySession.history = [];
  state.studySession.startTime = Date.now();
  
  if (state.studyMode === 'test') {
    const card = orderedCards[0];
    const correctAnswer = state.settings.reverse ? card.term : card.definition;
    state.studySession.currentOptions = generateTestOptions(correctAnswer, orderedCards);
    state.studySession.showingFeedback = false;
    state.studySession.selectedAnswer = null;
  } else if (state.studyMode === 'learn') {
    state.studySession.showingFeedback = false;
    state.studySession.userAnswer = '';
  } else if (state.studyMode === 'match') {
    initMatchMode();
  }
  
  state.currentView = 'study-' + state.studyMode;
  render();
}

// ============ FLASHCARD STUDY ============
function flipCard() {
  const inner = document.getElementById('flashcard-inner');
  if (inner && !swipeState.isSwiping) {
    inner.classList.toggle('flipped');
    
    if (state.settings.autoPlayAudio) {
      speakCurrentCard();
    }
  }
}

const swipeState = {
  startX: 0,
  startY: 0,
  currentX: 0,
  isDragging: false,
  isSwiping: false,
  isAnimating: false,
  threshold: 100,
  maxRotation: 15
};

function initSwipeHandlers() {
  const flashcard = document.getElementById('flashcard');
  if (!flashcard) return;

  flashcard.addEventListener('pointerdown', onSwipeStart, { passive: false });
  
  document.removeEventListener('pointermove', onSwipeMove);
  document.removeEventListener('pointerup', onSwipeEnd);
  document.removeEventListener('pointercancel', onSwipeEnd);
  document.addEventListener('pointermove', onSwipeMove, { passive: false });
  document.addEventListener('pointerup', onSwipeEnd);
  document.addEventListener('pointercancel', onSwipeEnd);
}

function onSwipeStart(e) {
  if (swipeState.isAnimating) return;
  swipeState.startX = e.clientX;
  swipeState.startY = e.clientY;
  swipeState.currentX = 0;
  swipeState.isDragging = true;
  swipeState.isSwiping = false;

  const flashcard = document.getElementById('flashcard');
  if (flashcard) {
    flashcard.classList.add('swiping');
    flashcard.setPointerCapture(e.pointerId);
  }
}

function onSwipeMove(e) {
  if (!swipeState.isDragging || swipeState.isAnimating) return;
  
  const dx = e.clientX - swipeState.startX;
  const dy = e.clientY - swipeState.startY;

  if (!swipeState.isSwiping && Math.abs(dy) > Math.abs(dx) && Math.abs(dx) < 10) {
    return;
  }

  if (Math.abs(dx) > 10) {
    swipeState.isSwiping = true;
  }

  if (!swipeState.isSwiping) return;

  e.preventDefault();
  swipeState.currentX = dx;

  const flashcard = document.getElementById('flashcard');
  const correctOverlay = document.getElementById('swipe-overlay-correct');
  const wrongOverlay = document.getElementById('swipe-overlay-wrong');

  if (!flashcard) return;

  const rotation = (dx / window.innerWidth) * swipeState.maxRotation;
  const opacity = Math.min(Math.abs(dx) / swipeState.threshold, 1);

  flashcard.style.transform = `translateX(${dx}px) rotate(${rotation}deg)`;

  if (correctOverlay && wrongOverlay) {
    if (dx > 0) {
      correctOverlay.style.opacity = opacity * 0.9;
      wrongOverlay.style.opacity = 0;
    } else if (dx < 0) {
      wrongOverlay.style.opacity = opacity * 0.9;
      correctOverlay.style.opacity = 0;
    } else {
      correctOverlay.style.opacity = 0;
      wrongOverlay.style.opacity = 0;
    }
  }
}

function onSwipeEnd(e) {
  if (!swipeState.isDragging) return;
  swipeState.isDragging = false;

  const flashcard = document.getElementById('flashcard');
  if (!flashcard) return;

  const dx = swipeState.currentX;

  if (swipeState.isSwiping && Math.abs(dx) >= swipeState.threshold) {
    const isCorrect = dx > 0;
    animateCardOut(isCorrect);
  } else if (swipeState.isSwiping) {
    snapCardBack(flashcard);
  } else {
    flipCard();
    flashcard.classList.remove('swiping');
  }

  swipeState.isSwiping = false;
}

function animateCardOut(isCorrect) {
  swipeState.isAnimating = true;
  const flashcard = document.getElementById('flashcard');
  if (!flashcard) return;

  const direction = isCorrect ? 1 : -1;
  const flyX = direction * (window.innerWidth + 200);
  const flyRotation = direction * 30;

  flashcard.classList.remove('swiping');
  flashcard.classList.add('animate-out');
  flashcard.style.transform = `translateX(${flyX}px) rotate(${flyRotation}deg)`;
  flashcard.style.opacity = '0';

  setTimeout(() => {
    swipeState.isAnimating = false;
    markCardWithAnimation(isCorrect);
  }, 250);
}

function snapCardBack(flashcard) {
  flashcard.classList.remove('swiping');
  flashcard.style.transition = 'transform 0.3s cubic-bezier(0.2, 0, 0.2, 1)';
  flashcard.style.transform = 'translateX(0) rotate(0deg)';

  const correctOverlay = document.getElementById('swipe-overlay-correct');
  const wrongOverlay = document.getElementById('swipe-overlay-wrong');
  if (correctOverlay) correctOverlay.style.opacity = 0;
  if (wrongOverlay) wrongOverlay.style.opacity = 0;

  setTimeout(() => {
    flashcard.style.transition = '';
  }, 300);
}

function animateButtonPress(isCorrect) {
  if (swipeState.isAnimating) return;
  swipeState.isAnimating = true;
  
  const flashcard = document.getElementById('flashcard');
  const overlay = document.getElementById(isCorrect ? 'swipe-overlay-correct' : 'swipe-overlay-wrong');
  if (!flashcard) return;

  if (overlay) overlay.style.opacity = '0.9';

  const direction = isCorrect ? 1 : -1;
  const flyX = direction * (window.innerWidth + 200);
  const flyRotation = direction * 25;

  requestAnimationFrame(() => {
    flashcard.classList.add('animate-out');
    flashcard.style.transform = `translateX(${flyX}px) rotate(${flyRotation}deg)`;
    flashcard.style.opacity = '0';
  });

  setTimeout(() => {
    swipeState.isAnimating = false;
    markCardWithAnimation(isCorrect);
  }, 250);
}

function markCardWithAnimation(correct) {
  const session = state.studySession;
  const card = session.cards[session.currentIndex];

  if (!session.history) session.history = [];
  session.history.push({
    index: session.currentIndex,
    correct: correct,
    prevWrongCount: card.wrongCount || 0
  });

  if (correct) {
    session.correct++;
    card.wrongCount = 0;
  } else {
    session.wrong++;
    session.wrongCards.push(card);
    card.wrongCount = (card.wrongCount || 0) + 1;
  }

  apiCall('updateCardStats', {
    id: card.id,
    wrongCount: card.wrongCount,
    lastStudied: new Date().toISOString()
  }).catch(console.error);

  session.currentIndex++;
  
  if (session.currentIndex >= session.cards.length) {
    saveToLocal();
  }
  
  render();

  requestAnimationFrame(() => {
    const newCard = document.getElementById('flashcard');
    if (newCard) {
      newCard.classList.add('animate-enter');
      newCard.addEventListener('animationend', () => {
        newCard.classList.remove('animate-enter');
      }, { once: true });
    }
  });
}

function markCard(correct) {
  animateButtonPress(correct);
}

function goBackCard() {
  const session = state.studySession;
  if (!session.history || session.history.length === 0) return;

  const lastAction = session.history.pop();
  const card = session.cards[lastAction.index];

  if (lastAction.correct) {
    session.correct--;
  } else {
    session.wrong--;
    const idx = session.wrongCards.findIndex(c => c.id === card.id);
    if (idx !== -1) session.wrongCards.splice(idx, 1);
  }

  card.wrongCount = lastAction.prevWrongCount;
  session.currentIndex = lastAction.index;

  render();
}

function retryWrongCards() {
  const session = state.studySession;
  session.cards = state.settings.shuffle 
    ? [...session.wrongCards].sort(() => Math.random() - 0.5)
    : [...session.wrongCards];
  session.totalCards = session.cards.length;
  session.currentIndex = 0;
  session.correct = 0;
  session.wrong = 0;
  session.wrongCards = [];
  session.history = [];
  session.startTime = Date.now();
  state.currentView = 'study-' + state.studyMode;
  render();
}

function restartDeck() {
  startStudy();
}

// ============ LEARN MODE ============
function checkLearnAnswer() {
  const input = document.getElementById('learn-answer-input');
  const userAnswer = input.value.trim().toLowerCase();
  const card = state.studySession.cards[state.studySession.currentIndex];
  const correctAnswer = stripHtml(state.settings.reverse ? card.term : card.definition).toLowerCase();
  
  const isCorrect = userAnswer === correctAnswer || 
                   userAnswer.includes(correctAnswer) ||
                   correctAnswer.includes(userAnswer);
  
  state.studySession.showingFeedback = true;
  state.studySession.userAnswer = input.value;
  state.studySession.isCorrect = isCorrect;
  
  if (isCorrect) {
    state.studySession.correct++;
    card.wrongCount = 0;
  } else {
    state.studySession.wrong++;
    state.studySession.wrongCards.push(card);
    card.wrongCount = (card.wrongCount || 0) + 1;
  }
  
  render();
}

function nextLearnCard() {
  state.studySession.currentIndex++;
  state.studySession.showingFeedback = false;
  state.studySession.userAnswer = '';
  render();
}

// ============ TEST MODE ============
function generateTestOptions(correctAnswer, allCards) {
  const options = [correctAnswer];
  const otherAnswers = allCards
    .map(c => state.settings.reverse ? c.term : c.definition)
    .filter(a => stripHtml(a) !== stripHtml(correctAnswer));
  
  while (options.length < 4 && otherAnswers.length > 0) {
    const randomIndex = Math.floor(Math.random() * otherAnswers.length);
    options.push(otherAnswers.splice(randomIndex, 1)[0]);
  }
  
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  
  return options;
}

function selectTestAnswer(index) {
  state.studySession.selectedAnswer = state.studySession.currentOptions[index];
  render();
}

function checkTestAnswer() {
  const card = state.studySession.cards[state.studySession.currentIndex];
  const correctAnswer = state.settings.reverse ? card.term : card.definition;
  const isCorrect = stripHtml(state.studySession.selectedAnswer) === stripHtml(correctAnswer);
  
  state.studySession.showingFeedback = true;
  
  if (isCorrect) {
    state.studySession.correct++;
  } else {
    state.studySession.wrong++;
    state.studySession.wrongCards.push(card);
  }
  
  render();
}

function nextTestCard() {
  state.studySession.currentIndex++;
  state.studySession.showingFeedback = false;
  state.studySession.selectedAnswer = null;
  
  if (state.studySession.currentIndex < state.studySession.cards.length) {
    const card = state.studySession.cards[state.studySession.currentIndex];
    const correctAnswer = state.settings.reverse ? card.term : card.definition;
    state.studySession.currentOptions = generateTestOptions(correctAnswer, state.studySession.cards);
  }
  
  render();
}

// ============ MATCH MODE ============
function initMatchMode() {
  const cards = [...state.studySession.cards].slice(0, 6);
  const matchCards = [];
  
  cards.forEach(card => {
    matchCards.push({ 
      text: card.term, 
      pair: card.id, 
      type: 'term',
      matched: false,
      selected: false,
      wrong: false
    });
    matchCards.push({ 
      text: card.definition, 
      pair: card.id, 
      type: 'definition',
      matched: false,
      selected: false,
      wrong: false
    });
  });
  
  for (let i = matchCards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [matchCards[i], matchCards[j]] = [matchCards[j], matchCards[i]];
  }
  
  state.studySession.matchCards = matchCards;
  state.studySession.selectedMatch = null;
  state.studySession.matchedPairs = 0;
  state.studySession.totalPairs = cards.length;
}

function selectMatchCard(index) {
  const card = state.studySession.matchCards[index];
  if (card.matched) return;
  
  if (state.studySession.selectedMatch === null) {
    card.selected = true;
    state.studySession.selectedMatch = index;
    render();
  } else {
    const firstCard = state.studySession.matchCards[state.studySession.selectedMatch];
    
    if (firstCard.pair === card.pair && firstCard.type !== card.type) {
      firstCard.matched = true;
      card.matched = true;
      state.studySession.matchedPairs++;
      state.studySession.correct++;
    } else {
      card.wrong = true;
      firstCard.wrong = true;
      state.studySession.wrong++;
      setTimeout(() => {
        card.wrong = false;
        firstCard.wrong = false;
        render();
      }, 500);
    }
    
    firstCard.selected = false;
    state.studySession.selectedMatch = null;
    
    render();
    
    if (state.studySession.matchedPairs === state.studySession.totalPairs) {
      setTimeout(() => {
        state.currentView = 'study-complete';
        render();
      }, 1000);
    }
  }
}

// ============ TODO FUNCTIONS ============
let todoReminders = [];
let selectedPriority = 'task';
let selectedLinkedDecks = [];
let deckPickerPath = null;

function showAddTodo() {
  todoReminders = [];
  selectedPriority = 'task';
  selectedLinkedDecks = [];
  deckPickerPath = null;
  state.currentView = 'add-todo';
  render();
}

function selectPriority(p) {
  selectedPriority = p;
  document.querySelectorAll('.priority-option').forEach(el => {
    el.classList.toggle('selected', el.dataset.priority === p);
  });
}

function getPickerTime() {
  const input = document.getElementById('todo-time');
  return input ? input.value || '09:00' : '09:00';
}

function autoGenerateReminders() {
  const dueInput = document.getElementById('todo-due');
  const timeInput = document.getElementById('todo-time');
  if (!dueInput.value) {
    alert('Please set a due date first');
    return;
  }

  const dueDate = new Date(dueInput.value);
  const time = timeInput.value || '09:00';
  const now = new Date();
  
  const daysBefore = [1, 3, 7, 14];
  const newReminders = [];
  
  daysBefore.forEach(days => {
    const reminderDate = new Date(dueDate);
    reminderDate.setDate(reminderDate.getDate() - days);
    const reminderDateTime = `${reminderDate.toISOString().split('T')[0]}T${time}`;
    
    if (new Date(reminderDateTime) > now) {
      newReminders.push(reminderDateTime);
    }
  });
  
  if (newReminders.length === 0) {
    const dueDateReminder = `${dueInput.value}T${time}`;
    if (new Date(dueDateReminder) > now) {
      newReminders.push(dueDateReminder);
    } else {
      const soonDate = new Date(now.getTime() + 60 * 60 * 1000);
      const soonReminder = soonDate.toISOString().slice(0, 16);
      newReminders.push(soonReminder);
    }
  }
  
  todoReminders = newReminders;
  renderReminders();
}

function addReminderFromInputs() {
  const dateInput = document.getElementById('reminder-date');
  const timeInput = document.getElementById('reminder-time');
  
  if (!dateInput.value) {
    alert('Please select a date');
    return;
  }
  
  const datetime = `${dateInput.value}T${timeInput.value || '09:00'}`;
  
  if (new Date(datetime) <= new Date()) {
    alert('Reminder must be in the future');
    return;
  }
  
  todoReminders.push(datetime);
  renderReminders();
  dateInput.value = '';
}

function removeReminder(index) {
  todoReminders.splice(index, 1);
  renderReminders();
}

function renderReminders() {
  const container = document.getElementById('reminders-container');
  container.innerHTML = todoReminders.map((datetime, i) => {
    const [date, time] = datetime.includes('T') ? datetime.split('T') : [datetime, '09:00'];
    const timeStr = time ? ` ${formatTime(time)}` : '';
    return `
      <div class="reminder-chip">
        ${formatDate(date)}${timeStr}
        <button type="button" onclick="editReminderTime(${i})" style="color: var(--accent); margin-left: 4px;">✎</button>
        <button type="button" onclick="removeReminder(${i})">×</button>
      </div>
    `;
  }).join('');
}

function editReminderTime(index) {
  const datetime = todoReminders[index];
  const [date, currentTime] = datetime.includes('T') ? datetime.split('T') : [datetime, '09:00'];
  const newTime = prompt('Enter new time (HH:MM, 24-hour format):', currentTime || '09:00');
  if (newTime && /^\d{2}:\d{2}$/.test(newTime)) {
    todoReminders[index] = `${date}T${newTime}`;
    renderReminders();
  }
}

function navigateDeckPicker(path) {
  deckPickerPath = path;
  const picker = document.getElementById('deck-picker');
  if (picker) {
    picker.innerHTML = renderDeckPicker();
    picker.scrollTop = 0;
  }
}

function toggleLinkedDeck(deckId) {
  const idx = selectedLinkedDecks.indexOf(deckId);
  if (idx >= 0) {
    selectedLinkedDecks.splice(idx, 1);
  } else {
    selectedLinkedDecks.push(deckId);
  }
  
  const picker = document.getElementById('deck-picker');
  if (picker) picker.innerHTML = renderDeckPicker();
  
  const parent = document.getElementById('deck-picker')?.parentElement;
  if (!parent) return;
  
  let existingChips = parent.querySelector('.selected-decks-chips');
  if (existingChips) existingChips.remove();
  
  if (selectedLinkedDecks.length > 0) {
    const chipsHtml = `<div class="selected-decks-chips">${selectedLinkedDecks.map(id => {
      const d = state.decks.find(x => x.id === id);
      return d ? `<div class="selected-deck-chip">${d.name}<button type="button" onclick="toggleLinkedDeck('${id}')">×</button></div>` : '';
    }).join('')}</div>`;
    document.getElementById('deck-picker').insertAdjacentHTML('beforebegin', chipsHtml);
  }
}

function renderDeckPicker() {
  const currentPath = deckPickerPath;

  let breadcrumb = '';
  if (currentPath) {
    const parts = [];
    let p = currentPath;
    while (p) {
      const f = state.folders.find(x => x.path === p);
      if (f) { parts.unshift(f); p = f.parentPath; } else break;
    }
    breadcrumb = `
      <div class="deck-picker-breadcrumb">
        <button onclick="navigateDeckPicker(null)">All</button>
        ${parts.map((f, i) => `
          <span>›</span>
          ${i < parts.length - 1
            ? `<button onclick="navigateDeckPicker('${f.path}')">${f.name}</button>`
            : `<span style="color:var(--text-secondary)">${f.name}</span>`
          }
        `).join('')}
      </div>
    `;
  }

  const subfolders = state.folders
    .filter(f => currentPath ? f.parentPath === currentPath : !f.parentPath)
    .sort((a, b) => (a.order || 999) - (b.order || 999));

  const decks = state.decks.filter(d => currentPath ? d.folderPath === currentPath : !d.folderPath || d.folderPath === '');

  const items = [];

  subfolders.forEach(f => {
    const deckCount = state.decks.filter(d => d.folderPath === f.path).length +
      state.folders.filter(sf => sf.parentPath === f.path).length;
    items.push(`
      <div class="deck-picker-item is-folder" onclick="navigateDeckPicker('${f.path}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
        <span class="dp-name">${f.name}</span>
        <span class="dp-meta">${deckCount}</span>
        <span class="dp-arrow">›</span>
      </div>
    `);
  });

  decks.forEach(d => {
    const checked = selectedLinkedDecks.includes(d.id);
    const cardCount = state.cards.filter(c => c.deckId === d.id).length;
    items.push(`
      <div class="deck-picker-item" onclick="toggleLinkedDeck('${d.id}')">
        <div class="dp-check ${checked ? 'checked' : ''}"></div>
        <span class="dp-name">${d.name}</span>
        <span class="dp-meta">${cardCount} cards</span>
      </div>
    `);
  });

  if (items.length === 0) {
    items.push(`<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:0.8rem;">No items here</div>`);
  }

  return breadcrumb + items.join('');
}

async function saveTodo(event) {
  event.preventDefault();
  
  const title = document.getElementById('todo-title').value;
  const description = document.getElementById('todo-description')?.value?.trim() || '';
  const dueDate = document.getElementById('todo-due').value;
  const dueTime = dueDate ? getPickerTime() : '';
  const linkedDecks = [...selectedLinkedDecks];

  const todo = {
    id: 'todo_' + Date.now(),
    title,
    description,
    dueDate,
    dueTime,
    priority: selectedPriority,
    reminders: [...todoReminders],
    linkedDecks,
    listId: state.currentTaskList,
    completed: false
  };

  state.todos.push(todo);
  saveToLocal();

  try {
    await apiCall('addTodo', {
      id: todo.id,
      title: todo.title,
      description: todo.description,
      dueDate: todo.dueDate,
      dueTime: todo.dueTime,
      priority: todo.priority,
      reminders: JSON.stringify(todo.reminders),
      linkedDecks: JSON.stringify(todo.linkedDecks),
      listId: todo.listId
    });
  } catch (error) {
    console.error('Failed to sync todo:', error);
  }

  todoReminders = [];
  selectedPriority = 'task';
  selectedLinkedDecks = [];
  scheduleReminders();
  state.currentView = 'todos';
  render();
}

async function completeTodo(id) {
  const todo = state.todos.find(t => t.id === id);
  if (todo) {
    todo.completed = true;
    todo.completedAt = new Date().toISOString();
    saveToLocal();
    render();

    try {
      await apiCall('completeTodo', { id });
    } catch (error) {
      console.error('Failed to sync todo completion:', error);
    }
  }
}

async function uncompleteTodo(id) {
  const todo = state.todos.find(t => t.id === id);
  if (todo) {
    todo.completed = false;
    delete todo.completedAt;
    saveToLocal();
    render();

    try {
      await apiCall('uncompleteTodo', { id });
    } catch (error) {
      console.error('Failed to sync todo uncompletion:', error);
    }
  }
}

async function deleteTodo(id) {
  if (!confirm('Delete this task?')) return;
  
  state.todos = state.todos.filter(t => t.id !== id);
  saveToLocal();
  render();

  try {
    await apiCall('deleteTodo', { id });
  } catch (error) {
    console.error('Failed to sync todo deletion:', error);
  }
}

function openDeckFromTodo(deckId) {
  showDeckDetail(deckId);
}

// ============ CARD FUNCTIONS ============
function showAddCard() {
  state.currentView = 'add-card';
  render();
}

function editCard(cardId) {
  state.editingCard = cardId;
  state.currentView = 'edit-card';
  render();
}

let clearImageFront = false;
let clearImageBack = false;

function clearImage(side) {
  if (side === 'front') {
    clearImageFront = true;
    document.getElementById('preview-front').innerHTML = '<p style="color: var(--text-muted); font-size: 0.875rem;">Image will be removed</p>';
  } else {
    clearImageBack = true;
    document.getElementById('preview-back').innerHTML = '<p style="color: var(--text-muted); font-size: 0.875rem;">Image will be removed</p>';
  }
}

function previewImage(input, previewId) {
  const preview = document.getElementById(previewId);
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = function(e) {
      preview.innerHTML = `<img src="${e.target.result}" style="max-width: 100%; max-height: 150px; border-radius: 8px;">`;
    };
    reader.readAsDataURL(input.files[0]);
  }
}

async function getBase64FromInput(inputId) {
  const input = document.getElementById(inputId);
  if (!input.files || !input.files[0]) return null;
  
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.readAsDataURL(input.files[0]);
  });
}

async function saveCard(event) {
  event.preventDefault();
  
  const term = document.getElementById('card-term').value.trim();
  const definition = document.getElementById('card-definition').value.trim();
  const imageFront = await getBase64FromInput('card-image-front');
  const imageBack = await getBase64FromInput('card-image-back');
  
  const card = {
    id: 'card_' + Date.now(),
    deckId: state.currentDeck,
    term,
    definition,
    imageFront: imageFront || '',
    imageBack: imageBack || '',
    wrongCount: 0,
    lastStudied: ''
  };
  
  state.cards.push(card);
  saveToLocal();
  
  try {
    await apiCall('addCard', {
      id: card.id,
      deckId: card.deckId,
      term: card.term,
      definition: card.definition,
      imageFront: card.imageFront,
      imageBack: card.imageBack
    });
  } catch (error) {
    console.error('Failed to sync card:', error);
  }
  
  state.currentView = 'deck-detail';
  render();
}

async function saveCardAndAddAnother(event) {
  event.preventDefault();
  
  const term = document.getElementById('card-term').value.trim();
  const definition = document.getElementById('card-definition').value.trim();
  const imageFront = await getBase64FromInput('card-image-front');
  const imageBack = await getBase64FromInput('card-image-back');
  
  const card = {
    id: 'card_' + Date.now(),
    deckId: state.currentDeck,
    term,
    definition,
    imageFront: imageFront || '',
    imageBack: imageBack || '',
    wrongCount: 0,
    lastStudied: ''
  };
  
  state.cards.push(card);
  saveToLocal();
  
  try {
    await apiCall('addCard', {
      id: card.id,
      deckId: card.deckId,
      term: card.term,
      definition: card.definition,
      imageFront: card.imageFront,
      imageBack: card.imageBack
    });
  } catch (error) {
    console.error('Failed to sync card:', error);
  }
  
  document.getElementById('card-term').value = '';
  document.getElementById('card-definition').value = '';
  document.getElementById('card-image-front').value = '';
  document.getElementById('card-image-back').value = '';
  document.getElementById('preview-front').innerHTML = '';
  document.getElementById('preview-back').innerHTML = '';
  
  document.getElementById('card-term').focus();
}

async function updateCard(event) {
  event.preventDefault();
  
  const card = state.cards.find(c => c.id === state.editingCard);
  if (!card) return;
  
  const term = document.getElementById('card-term').value.trim();
  const definition = document.getElementById('card-definition').value.trim();
  const newImageFront = await getBase64FromInput('card-image-front');
  const newImageBack = await getBase64FromInput('card-image-back');
  
  card.term = term;
  card.definition = definition;
  if (newImageFront) card.imageFront = newImageFront;
  if (newImageBack) card.imageBack = newImageBack;
  if (clearImageFront) card.imageFront = '';
  if (clearImageBack) card.imageBack = '';
  
  saveToLocal();
  
  try {
    await apiCall('updateCard', {
      id: card.id,
      term: card.term,
      definition: card.definition,
      imageFront: card.imageFront,
      imageBack: card.imageBack
    });
  } catch (error) {
    console.error('Failed to sync card update:', error);
  }
  
  clearImageFront = false;
  clearImageBack = false;
  state.editingCard = null;
  state.currentView = 'deck-detail';
  render();
}

async function deleteCard(id) {
  if (!confirm('Delete this card?')) return;
  
  state.cards = state.cards.filter(c => c.id !== id);
  saveToLocal();
  render();
  
  try {
    await apiCall('deleteCard', { id });
  } catch (error) {
    console.error('Failed to sync card deletion:', error);
  }
}

// ============ RENDER FUNCTIONS ============
function render() {
  const app = document.getElementById('app');
  
  if (state.currentView.startsWith('study')) {
    document.body.classList.add('studying');
  } else {
    document.body.classList.remove('studying');
  }
  
  switch (state.currentView) {
    case 'flashcards':
      app.innerHTML = renderFlashcardsView();
      break;
    case 'todos':
      app.innerHTML = renderTodosView();
      break;
    case 'folder':
      app.innerHTML = renderFolderView();
      break;
    case 'study-mode-select':
      app.innerHTML = renderStudyModeSelect();
      break;
    case 'study-setup':
      app.innerHTML = renderStudySetupView();
      break;
    case 'study-flashcards':
      app.innerHTML = renderStudyFlashcardsView();
      break;
    case 'study-learn':
      app.innerHTML = renderStudyLearnView();
      break;
    case 'study-test':
      app.innerHTML = renderStudyTestView();
      break;
    case 'study-match':
      app.innerHTML = renderStudyMatchView();
      break;
    case 'add-todo':
      app.innerHTML = renderAddTodoView();
      break;
    case 'deck-detail':
      app.innerHTML = renderDeckDetailView();
      break;
    case 'add-card':
      app.innerHTML = renderAddCardView();
      break;
    case 'edit-card':
      app.innerHTML = renderEditCardView();
      break;
    case 'statistics':
      app.innerHTML = renderStatisticsView();
      break;
  }

  attachEventListeners();
}

function renderFlashcardsView() {
  const upcomingDecks = getUpcomingDecks();
  const rootFolders = state.folders
    .filter(f => !f.parentPath)
    .sort((a, b) => (a.order || 999) - (b.order || 999));

  return `
    <div class="header">
      <h1>Flashcards</h1>
      <div class="header-actions">
        <button class="btn-icon" onclick="state.currentView = 'statistics'; render();" title="Statistics">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 3v18h18"/><path d="M7 12l4-4 4 4 5-5"/>
          </svg>
        </button>
        <button class="btn-icon" onclick="syncData().then(render)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M23 4v6h-6M1 20v-6h6"/>
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="container">
      ${upcomingDecks.length > 0 ? `
        <div class="featured-section">
          <h2 class="featured-title">Study Soon</h2>
          <div class="featured-decks">
            ${upcomingDecks.slice(0, 3).map(item => `
              <div class="featured-deck" onclick="openDeck('${item.deck.id}')">
                <h3>${item.deck.name}</h3>
                <p>${getCardCount(item.deck.id)} cards</p>
                <div class="due-date">Due: ${formatDate(item.dueDate)}</div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
      
      <div class="section-header">
        <h2 class="section-title">Subjects</h2>
      </div>
      <div class="list">
        ${rootFolders.length > 0 ? rootFolders.map(folder => `
          <div class="list-item" onclick="openFolder('${folder.path}')">
            <div class="list-item-content">
              <div class="list-item-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                </svg>
              </div>
              <div class="list-item-text">
                <h3>${folder.name}</h3>
                <p>${getSubfolderCount(folder.path)} folders, ${getDeckCountInFolder(folder.path)} decks</p>
              </div>
            </div>
            <span class="list-item-arrow">→</span>
          </div>
        `).join('') : `
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
            </svg>
            <h3>No folders yet</h3>
            <p>Add folders in Google Sheets</p>
          </div>
        `}
      </div>
    </div>
  `;
}

function renderFolderView() {
  const folder = state.folders.find(f => f.path === state.currentFolder);
  const subfolders = state.folders
    .filter(f => f.parentPath === state.currentFolder)
    .sort((a, b) => (a.order || 999) - (b.order || 999));
  
  const decks = state.decks.filter(d => d.folderPath === state.currentFolder);
  const parentPath = folder?.parentPath || null;

  return `
    <div class="header">
      <button class="header-back" onclick="navigateBack('${parentPath || ''}')">
        ← Back
      </button>
      <h1>${folder?.name || 'Folder'}</h1>
      <div></div>
    </div>
    <div class="container">
      ${subfolders.length > 0 ? `
        <div class="section-header">
          <h2 class="section-title">Folders</h2>
        </div>
        <div class="list">
          ${subfolders.map(f => `
            <div class="list-item" onclick="openFolder('${f.path}')">
              <div class="list-item-content">
                <div class="list-item-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                  </svg>
                </div>
                <div class="list-item-text">
                  <h3>${f.name}</h3>
                  <p>${getDeckCountInFolder(f.path)} decks</p>
                </div>
              </div>
              <span class="list-item-arrow">→</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
      
      ${decks.length > 0 ? `
        <div class="section-header" style="margin-top: ${subfolders.length > 0 ? '24px' : '0'}">
          <h2 class="section-title">Decks</h2>
        </div>
        <div class="list">
          ${decks.map(deck => `
            <div class="list-item" onclick="showDeckDetail('${deck.id}')">
              <div class="list-item-content">
                <div class="list-item-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="2" y="4" width="20" height="16" rx="2"/>
                    <line x1="2" y1="10" x2="22" y2="10"/>
                  </svg>
                </div>
                <div class="list-item-text">
                  <h3>${deck.name}</h3>
                  <p>${getCardCount(deck.id)} cards</p>
                </div>
              </div>
              <span class="list-item-arrow">→</span>
            </div>
          `).join('')}
        </div>
      ` : ''}

      ${subfolders.length === 0 && decks.length === 0 ? `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="4" width="20" height="16" rx="2"/>
          </svg>
          <h3>Empty folder</h3>
          <p>Add decks in Google Sheets</p>
        </div>
      ` : ''}
    </div>
  `;
}

function renderStudyModeSelect() {
  const deck = state.decks.find(d => d.id === state.studySession?.deckId);
  const cardCount = getCardCount(state.studySession?.deckId);

  return `
    <div class="header">
      <button class="header-back" onclick="cancelStudy()">← Back</button>
      <h1>Study Mode</h1>
      <div></div>
    </div>
    <div class="container">
      <div class="card" style="text-align: center; padding: 24px; margin-bottom: 24px;">
        <h2 style="margin-bottom: 8px;">${deck?.name}</h2>
        <p style="color: var(--text-secondary);">${cardCount} cards</p>
      </div>

      <div class="mode-selector">
        <div class="mode-card" onclick="selectStudyMode('flashcards')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="4" width="20" height="16" rx="2"/>
            <line x1="2" y1="10" x2="22" y2="10"/>
          </svg>
          <h3>Flashcards</h3>
          <p>Classic flip cards</p>
        </div>

        <div class="mode-card" onclick="selectStudyMode('learn')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          <h3>Learn</h3>
          <p>Type answers</p>
        </div>

        <div class="mode-card" onclick="selectStudyMode('test')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 11l3 3L22 4"/>
            <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
          </svg>
          <h3>Test</h3>
          <p>Multiple choice quiz</p>
        </div>

        <div class="mode-card" onclick="selectStudyMode('match')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="9" cy="9" r="2"/>
            <circle cx="9" cy="15" r="2"/>
            <circle cx="15" cy="9" r="2"/>
            <circle cx="15" cy="15" r="2"/>
            <line x1="11" y1="9" x2="13" y2="9"/>
            <line x1="9" y1="13" x2="9" y2="11"/>
          </svg>
          <h3>Match</h3>
          <p>Match pairs</p>
        </div>
      </div>
    </div>
  `;
}

function renderStudySetupView() {
  const deck = state.decks.find(d => d.id === state.studySession?.deckId);
  let cardCount = getCardCount(state.studySession?.deckId);
  
  if (state.settings.studyStarredOnly) {
    const deckCards = state.cards.filter(c => c.deckId === state.studySession?.deckId);
    cardCount = deckCards.filter(c => isStarred(c.id)).length;
  }

  return `
    <div class="header">
      <button class="header-back" onclick="state.currentView = 'study-mode-select'; render();">← Back</button>
      <h1>Setup</h1>
      <div></div>
    </div>
    <div class="container">
      <div class="card" style="text-align: center; padding: 32px;">
        <h2 style="margin-bottom: 8px;">${deck?.name}</h2>
        <p style="color: var(--text-secondary); margin-bottom: 24px;">${cardCount} cards</p>
        
        <div class="study-options">
          <button class="toggle-btn ${state.settings.shuffle ? 'active' : ''}" onclick="toggleSetting('shuffle')">
            Shuffle ${state.settings.shuffle ? '✓' : ''}
          </button>
          <button class="toggle-btn ${state.settings.reverse ? 'active' : ''}" onclick="toggleSetting('reverse')">
            Front: ${state.settings.reverse ? 'Definition' : 'Term'}
          </button>
          <button class="toggle-btn ${state.settings.studyStarredOnly ? 'active' : ''}" onclick="toggleSetting('studyStarredOnly')">
            Starred Only ${state.settings.studyStarredOnly ? '✓' : ''}
          </button>
          ${state.studyMode === 'flashcards' ? `
            <button class="toggle-btn ${state.settings.autoPlayAudio ? 'active' : ''}" onclick="toggleSetting('autoPlayAudio')">
              Auto Audio ${state.settings.autoPlayAudio ? '✓' : ''}
            </button>
          ` : ''}
        </div>
        
        <button class="btn btn-primary" onclick="startStudy()" style="width: 100%; margin-top: 16px;">
          Start Studying
        </button>
      </div>
    </div>
  `;
}

// Continue in next part due to length...

function renderStudyFlashcardsView() {
  const session = state.studySession;
  if (!session || session.cards.length === 0 || session.currentIndex >= session.cards.length) {
    return renderStudyComplete();
  }

  const card = session.cards[session.currentIndex];
  const progress = ((session.currentIndex) / session.totalCards) * 100;
  const front = state.settings.reverse ? card.definition : card.term;
  const back = state.settings.reverse ? card.term : card.definition;
  const frontImage = state.settings.reverse ? card.imageBack : card.imageFront;
  const backImage = state.settings.reverse ? card.imageFront : card.imageBack;
  const starred = isStarred(card.id);

  return `
    <div class="header">
      <button class="header-back" onclick="cancelStudy()">← Exit</button>
      <h1>Studying</h1>
      <div></div>
    </div>
    <div class="study-container">
      <div class="study-progress">
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${progress}%"></div>
        </div>
        <div class="progress-text">
          <span>${session.currentIndex + 1} / ${session.totalCards}</span>
          <span style="color: var(--success)">✓ ${session.correct}</span>
          <span style="color: var(--error)">✗ ${session.wrong}</span>
        </div>
      </div>

      <div class="flashcard-wrapper">
        <div class="flashcard" id="flashcard">
          <div class="swipe-overlay swipe-overlay-correct" id="swipe-overlay-correct"></div>
          <div class="swipe-overlay swipe-overlay-wrong" id="swipe-overlay-wrong"></div>
          <div class="flashcard-inner" id="flashcard-inner">
            <div class="flashcard-face flashcard-front">
              <span class="flashcard-label">${state.settings.reverse ? 'Definition' : 'Term'}</span>
              <h2>${front}</h2>
              ${frontImage ? `<img src="${frontImage}" alt=""/>` : ''}
            </div>
            <div class="flashcard-face flashcard-back">
              <span class="flashcard-label">${state.settings.reverse ? 'Term' : 'Definition'}</span>
              <h2>${back}</h2>
              ${backImage ? `<img src="${backImage}" alt=""/>` : ''}
            </div>
          </div>
        </div>
      </div>

      <div class="study-actions">
        <button class="study-btn back" onclick="goBackCard()" title="Undo" ${!session.history || session.history.length === 0 ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M3 10h10a5 5 0 015 5v0a5 5 0 01-5 5H10"/>
            <polyline points="7 14 3 10 7 6"/>
          </svg>
        </button>
        <button class="study-btn star ${starred ? 'starred' : ''}" onclick="event.stopPropagation(); toggleStar('${card.id}')" title="Star">
          <svg viewBox="0 0 24 24" fill="${starred ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
        </button>
        <button class="study-btn audio" onclick="speakCurrentCard()" title="Listen">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
            <path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/>
          </svg>
        </button>
      </div>
    </div>
  `;
}

function renderStudyLearnView() {
  const session = state.studySession;
  if (!session || session.currentIndex >= session.cards.length) {
    return renderStudyComplete();
  }

  const card = session.cards[session.currentIndex];
  const progress = ((session.currentIndex) / session.totalCards) * 100;
  const question = state.settings.reverse ? card.definition : card.term;
  const answer = state.settings.reverse ? card.term : card.definition;
  const questionImage = state.settings.reverse ? card.imageBack : card.imageFront;
  
  const showingFeedback = session.showingFeedback;
  const userAnswer = session.userAnswer || '';
  const isCorrect = session.isCorrect;

  return `
    <div class="header">
      <button class="header-back" onclick="cancelStudy()">← Exit</button>
      <h1>Learn Mode</h1>
      <div></div>
    </div>
    <div class="learn-container">
      <div class="study-progress">
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${progress}%"></div>
        </div>
        <div class="progress-text">
          <span>${session.currentIndex + 1} / ${session.totalCards}</span>
          <span style="color: var(--success)">✓ ${session.correct}</span>
          <span style="color: var(--error)">✗ ${session.wrong}</span>
        </div>
      </div>

      <div class="learn-question">
        <h3 style="font-size: 0.875rem; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 16px;">
          ${state.settings.reverse ? 'Definition' : 'Term'}
        </h3>
        <h2>${question}</h2>
        ${questionImage ? `<img src="${questionImage}" alt="" style="max-width: 100%; max-height: 200px; margin-top: 16px; border-radius: 8px;">` : ''}
      </div>

      ${showingFeedback ? `
        <div class="learn-feedback ${isCorrect ? 'correct' : 'wrong'}">
          <h3 style="font-size: 1.25rem; margin-bottom: 8px;">${isCorrect ? '✓ Correct!' : '✗ Incorrect'}</h3>
          ${!isCorrect ? `<p style="margin-bottom: 8px;">Your answer: ${userAnswer}</p>` : ''}
          <p>Correct answer: <strong>${stripHtml(answer)}</strong></p>
        </div>
        <button class="btn btn-primary" onclick="nextLearnCard()" style="width: 100%;">
          Continue
        </button>
      ` : `
        <input 
          type="text" 
          class="learn-answer-input" 
          id="learn-answer-input"
          placeholder="Type your answer..."
          autocomplete="off"
          onkeypress="if(event.key==='Enter') checkLearnAnswer()"
        />
        <button class="btn btn-primary" onclick="checkLearnAnswer()" style="width: 100%; margin-top: 16px;">
          Check Answer
        </button>
      `}
    </div>
  `;
}

function renderStudyTestView() {
  const session = state.studySession;
  if (!session || session.currentIndex >= session.cards.length) {
    return renderStudyComplete();
  }

  const card = session.cards[session.currentIndex];
  const progress = ((session.currentIndex) / session.totalCards) * 100;
  const question = state.settings.reverse ? card.definition : card.term;
  const correctAnswer = state.settings.reverse ? card.term : card.definition;
  
  const showingFeedback = session.showingFeedback;
  const selectedAnswer = session.selectedAnswer;
  const options = session.currentOptions || [];

  return `
    <div class="header">
      <button class="header-back" onclick="cancelStudy()">← Exit</button>
      <h1>Test Mode</h1>
      <div></div>
    </div>
    <div class="test-container">
      <div class="study-progress">
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${progress}%"></div>
        </div>
        <div class="progress-text">
          <span>${session.currentIndex + 1} / ${session.totalCards}</span>
          <span style="color: var(--success)">✓ ${session.correct}</span>
          <span style="color: var(--error)">✗ ${session.wrong}</span>
        </div>
      </div>

      <div class="test-question">
        <h3>${state.settings.reverse ? 'Definition' : 'Term'}</h3>
        <h2>${question}</h2>

        <div class="test-options">
          ${options.map((option, idx) => {
            let className = 'test-option';
            if (showingFeedback) {
              if (stripHtml(option) === stripHtml(correctAnswer)) {
                className += ' correct';
              } else if (option === selectedAnswer && stripHtml(option) !== stripHtml(correctAnswer)) {
                className += ' wrong';
              }
            } else if (option === selectedAnswer) {
              className += ' selected';
            }
            return `
              <div class="${className}" onclick="${showingFeedback ? '' : `selectTestAnswer(${idx})`}">
                ${option}
              </div>
            `;
          }).join('')}
        </div>
      </div>

      ${showingFeedback ? `
        <button class="btn btn-primary" onclick="nextTestCard()" style="width: 100%; margin-top: 24px;">
          Continue
        </button>
      ` : `
        <button class="btn btn-primary" onclick="checkTestAnswer()" ${!selectedAnswer ? 'disabled' : ''} style="width: 100%; margin-top: 24px;">
          Check Answer
        </button>
      `}
    </div>
  `;
}

function renderStudyMatchView() {
  const session = state.studySession;
  if (!session || !session.matchCards) {
    return renderStudyComplete();
  }

  const progress = (session.matchedPairs / session.totalPairs) * 100;
  const elapsed = Math.floor((Date.now() - session.startTime) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  return `
    <div class="header">
      <button class="header-back" onclick="cancelStudy()">← Exit</button>
      <h1>Match Mode</h1>
      <div></div>
    </div>
    <div class="match-container">
      <div class="study-progress">
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${progress}%"></div>
        </div>
        <div class="progress-text">
          <span>${session.matchedPairs} / ${session.totalPairs} matched</span>
          <span>Time: ${minutes}:${seconds.toString().padStart(2, '0')}</span>
        </div>
      </div>

      <div class="match-grid">
        ${session.matchCards.map((item, idx) => `
          <div 
            class="match-card ${item.matched ? 'matched' : ''} ${item.selected ? 'selected' : ''} ${item.wrong ? 'wrong' : ''}" 
            onclick="selectMatchCard(${idx})"
          >
            ${item.text}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderStudyComplete() {
  const session = state.studySession;
  const hasWrongCards = session.wrongCards && session.wrongCards.length > 0;
  const totalTime = Math.floor((Date.now() - session.startTime) / 1000);
  const minutes = Math.floor(totalTime / 60);
  const seconds = totalTime % 60;

  return `
    <div class="header">
      <button class="header-back" onclick="cancelStudy()">← Done</button>
      <h1>Complete!</h1>
      <div></div>
    </div>
    <div class="study-complete">
      <h2>Session Complete!</h2>
      <div class="study-stats">
        <div class="stat">
          <div class="stat-value correct">${session.correct}</div>
          <div class="stat-label">Correct</div>
        </div>
        <div class="stat">
          <div class="stat-value wrong">${session.wrong}</div>
          <div class="stat-label">Wrong</div>
        </div>
        <div class="stat">
          <div class="stat-value">${minutes}:${seconds.toString().padStart(2, '0')}</div>
          <div class="stat-label">Time</div>
        </div>
      </div>
      <div class="study-complete-actions">
        ${hasWrongCards ? `
          <button class="btn btn-primary" onclick="retryWrongCards()">
            Retry Wrong Cards (${session.wrongCards.length})
          </button>
        ` : ''}
        <button class="btn btn-secondary" onclick="restartDeck()">
          Study Again
        </button>
        <button class="btn btn-secondary" onclick="cancelStudy()">
          Back to Flashcards
        </button>
      </div>
    </div>
  `;
}

function renderStatisticsView() {
  const totalDecks = state.decks.length;
  const totalCards = state.cards.length;
  const starredCount = state.starred.length;
  const timeMinutes = Math.floor(state.stats.totalStudyTime / 60);

  return `
    <div class="header">
      <button class="header-back" onclick="state.currentView = 'flashcards'; render();">← Back</button>
      <h1>Statistics</h1>
      <div></div>
    </div>
    <div class="container">
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-card-value">${totalDecks}</div>
          <div class="stat-card-label">Decks</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-value">${totalCards}</div>
          <div class="stat-card-label">Total Cards</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-value">${starredCount}</div>
          <div class="stat-card-label">Starred</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-value">${state.stats.studyStreak}</div>
          <div class="stat-card-label">Day Streak</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-value">${timeMinutes}</div>
          <div class="stat-card-label">Study Minutes</div>
        </div>
      </div>

      ${Object.keys(state.stats.accuracy).length > 0 ? `
        <div class="section-header" style="margin-top: 32px;">
          <h2 class="section-title">Deck Accuracy</h2>
        </div>
        <div class="list">
          ${Object.entries(state.stats.accuracy).map(([deckId, stats]) => {
            const deck = state.decks.find(d => d.id === deckId);
            const accuracy = Math.round((stats.correct / stats.total) * 100);
            return deck ? `
              <div class="list-item">
                <div class="list-item-content">
                  <div class="list-item-text">
                    <h3>${deck.name}</h3>
                    <p>${stats.correct}/${stats.total} correct</p>
                  </div>
                </div>
                <span style="font-size: 1.5rem; font-weight: 700; color: var(--accent);">${accuracy}%</span>
              </div>
            ` : '';
          }).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

function renderTodoItem(todo, isCompleted = false) {
  const subtasks = getSubtasks(todo.id);
  const timeStr = todo.dueTime ? formatTime(todo.dueTime) : '';
  return `
    <div class="todo-item" data-todo-id="${todo.id}">
      <div class="todo-checkbox${isCompleted ? ' checked' : ''}" onclick="${isCompleted ? `uncompleteTodo('${todo.id}')` : `completeTodo('${todo.id}')`}"></div>
      <div class="todo-content">
        <div class="todo-title">${todo.title}</div>
        ${todo.description ? `<div class="todo-description">${todo.description}</div>` : ''}
        <div class="todo-details">
          ${todo.priority ? `<span class="priority-badge ${todo.priority}">${todo.priority}</span>` : ''}
          ${todo.dueDate ? `
            <span class="todo-detail-chip ${isOverdue(todo.dueDate) && !isCompleted ? 'overdue' : ''}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              ${formatDate(todo.dueDate)}${timeStr ? ' · ' + timeStr : ''}
            </span>
          ` : ''}
          ${todo.reminders && todo.reminders.length > 0 ? `
            <span class="todo-detail-chip">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
              ${todo.reminders.length}
            </span>
          ` : ''}
        </div>
        ${todo.linkedDecks && todo.linkedDecks.length > 0 ? `
          <div class="todo-decks">
            ${todo.linkedDecks.map(deckId => {
              const deck = state.decks.find(d => d.id === deckId);
              return deck ? `<button class="todo-deck-link" onclick="event.stopPropagation(); openDeckFromTodo('${deckId}')">${deck.name}</button>` : '';
            }).join('')}
          </div>
        ` : ''}
        ${subtasks.length > 0 ? `
          <div class="todo-subtasks">
            ${subtasks.map(st => renderTodoItem(st, st.completed)).join('')}
          </div>
        ` : ''}
      </div>
      <button class="todo-delete-btn" onclick="event.stopPropagation(); deleteTodo('${todo.id}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
        </svg>
      </button>
    </div>
  `;
}

function renderTodosView() {
  const activeTodos = sortTodos(state.todos.filter(t => !t.completed && !t.parentId && t.listId === state.currentTaskList));
  const completedTodos = state.todos.filter(t => t.completed && !t.parentId && t.listId === state.currentTaskList);
  const showCompleted = state.showCompleted || false;

  return `
    <div class="header">
      <h1>Tasks</h1>
      <button class="btn-icon" onclick="syncData().then(render)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M23 4v6h-6M1 20v-6h6"/>
          <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
        </svg>
      </button>
    </div>
    <div class="container">
      ${activeTodos.length > 0 ? `
        <div class="todo-list">
          ${activeTodos.map(t => renderTodoItem(t)).join('')}
        </div>
      ` : `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 11l3 3L22 4"/>
            <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
          </svg>
          <h3>No tasks yet</h3>
          <p>Tap + to get started</p>
        </div>
      `}

      ${completedTodos.length > 0 ? `
        <div class="completed-section">
          <div class="completed-header ${showCompleted ? 'expanded' : ''}" onclick="state.showCompleted = !state.showCompleted; render();">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            <span>Completed (${completedTodos.length})</span>
          </div>
          <div class="completed-list" style="max-height: ${showCompleted ? completedTodos.length * 80 + 'px' : '0'};">
            ${completedTodos.map(t => renderTodoItem(t, true)).join('')}
          </div>
        </div>
      ` : ''}
    </div>
    <button class="fab" onclick="showAddTodo()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <line x1="12" y1="5" x2="12" y2="19"/>
        <line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
    </button>
  `;
}

function renderAddTodoView() {
  return `
    <div class="header">
      <button class="header-back" onclick="state.currentView = 'todos'; render();">← Cancel</button>
      <h1>New Task</h1>
      <div></div>
    </div>
    <div class="container">
      <form id="todo-form" onsubmit="saveTodo(event)">
        <div class="form-group">
          <label class="form-label">Title *</label>
          <input type="text" class="form-input" id="todo-title" required placeholder="Task name">
        </div>

        <div class="form-group">
          <label class="form-label">Description</label>
          <textarea class="form-input" id="todo-description" placeholder="Add details" rows="2"></textarea>
        </div>

        <div class="form-group">
          <label class="form-label">Priority</label>
          <div class="priority-options">
            <button type="button" class="priority-option ${selectedPriority === 'summative' ? 'selected' : ''}" data-priority="summative" onclick="selectPriority('summative')">Summative</button>
            <button type="button" class="priority-option ${selectedPriority === 'formative' ? 'selected' : ''}" data-priority="formative" onclick="selectPriority('formative')">Formative</button>
            <button type="button" class="priority-option ${selectedPriority === 'task' ? 'selected' : ''}" data-priority="task" onclick="selectPriority('task')">Task</button>
            <button type="button" class="priority-option ${selectedPriority === 'low' ? 'selected' : ''}" data-priority="low" onclick="selectPriority('low')">Low</button>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Due Date</label>
          <input type="date" class="form-input" id="todo-due">
        </div>

        <div class="form-group">
          <label class="form-label">Time</label>
          <input type="time" class="form-input" id="todo-time" value="09:00">
        </div>

        <div class="form-group">
          <label class="form-label">Link Decks</label>
          ${selectedLinkedDecks.length > 0 ? `
            <div class="selected-decks-chips">
              ${selectedLinkedDecks.map(id => {
                const d = state.decks.find(x => x.id === id);
                return d ? `<div class="selected-deck-chip">${d.name}<button type="button" onclick="toggleLinkedDeck('${id}')">×</button></div>` : '';
              }).join('')}
            </div>
          ` : ''}
          <div class="deck-picker" id="deck-picker">
            ${renderDeckPicker()}
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Reminders</label>
          <div id="reminders-container" class="reminder-chips"></div>
          <div style="margin-top: 12px;">
            <div style="display: flex; gap: 8px; margin-bottom: 8px;">
              <input type="date" class="form-input" id="reminder-date" style="flex: 1;">
              <input type="time" class="form-input" id="reminder-time" value="09:00" style="width: 110px;">
              <button type="button" class="btn btn-secondary" style="padding: 8px 14px;" onclick="addReminderFromInputs()">+</button>
            </div>
            <button type="button" class="btn btn-secondary" style="width: 100%; font-size: 0.8rem; padding: 8px;" onclick="autoGenerateReminders()">
              Auto-generate (1-3-7-14 days before)
            </button>
          </div>
        </div>

        <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 24px;">
          Save Task
        </button>
      </form>
    </div>
  `;
}

function renderDeckDetailView() {
  const deck = state.decks.find(d => d.id === state.currentDeck);
  const deckCards = state.cards.filter(c => c.deckId === state.currentDeck);
  
  return `
    <div class="header">
      <button class="header-back" onclick="goBackFromDeck()">← Back</button>
      <h1>${deck?.name || 'Deck'}</h1>
      <button class="btn-icon" onclick="showAddCard()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </button>
    </div>
    <div class="container">
      <div style="display: flex; gap: 12px; margin-bottom: 24px;">
        <button class="btn btn-primary" style="flex: 1;" onclick="openDeck('${state.currentDeck}')">
          Study (${deckCards.length} cards)
        </button>
      </div>
      
      <div class="section-header">
        <h2 class="section-title">Cards</h2>
      </div>
      
      ${deckCards.length > 0 ? `
        <div class="list">
          ${deckCards.map(card => `
            <div class="list-item" onclick="editCard('${card.id}')">
              <div class="list-item-content" style="flex: 1;">
                <div class="list-item-text">
                  <h3>${card.term} ${isStarred(card.id) ? '⭐' : ''}</h3>
                  <p>${card.definition}</p>
                </div>
              </div>
              <button class="btn-icon" onclick="event.stopPropagation(); deleteCard('${card.id}')" style="color: var(--text-muted);">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px;">
                  <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                </svg>
              </button>
            </div>
          `).join('')}
        </div>
      ` : `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="4" width="20" height="16" rx="2"/>
          </svg>
          <h3>No cards yet</h3>
          <p>Tap + to add your first card</p>
        </div>
      `}
    </div>
  `;
}

function renderAddCardView() {
  const deck = state.decks.find(d => d.id === state.currentDeck);
  
  return `
    <div class="header">
      <button class="header-back" onclick="state.currentView = 'deck-detail'; render();">← Cancel</button>
      <h1>Add Card</h1>
      <div></div>
    </div>
    <div class="container">
      <div style="background: var(--bg-tertiary); padding: 12px; border-radius: 8px; margin-bottom: 20px; font-size: 0.75rem; color: var(--text-secondary);">
        <strong>Tip:</strong> For bold/underline/italic, add the card here then format in Google Sheets.
      </div>
      <form onsubmit="saveCard(event)">
        <div class="form-group">
          <label class="form-label">Term (Front) *</label>
          <textarea class="form-input" id="card-term" required placeholder="Enter the term or question" rows="3"></textarea>
        </div>
        
        <div class="form-group">
          <label class="form-label">Definition (Back) *</label>
          <textarea class="form-input" id="card-definition" required placeholder="Enter the definition or answer" rows="3"></textarea>
        </div>
        
        <div class="form-group">
          <label class="form-label">Image - Front (optional)</label>
          <input type="file" class="form-input" id="card-image-front" accept="image/*" onchange="previewImage(this, 'preview-front')">
          <div id="preview-front" style="margin-top: 8px;"></div>
        </div>
        
        <div class="form-group">
          <label class="form-label">Image - Back (optional)</label>
          <input type="file" class="form-input" id="card-image-back" accept="image/*" onchange="previewImage(this, 'preview-back')">
          <div id="preview-back" style="margin-top: 8px;"></div>
        </div>
        
        <div style="display: flex; gap: 12px; margin-top: 24px;">
          <button type="submit" class="btn btn-primary" style="flex: 1;">
            Save Card
          </button>
          <button type="button" class="btn btn-secondary" style="flex: 1;" onclick="saveCardAndAddAnother(event)">
            Save & Add Another
          </button>
        </div>
      </form>
    </div>
  `;
}

function renderEditCardView() {
  const card = state.cards.find(c => c.id === state.editingCard);
  
  return `
    <div class="header">
      <button class="header-back" onclick="state.currentView = 'deck-detail'; render();">← Cancel</button>
      <h1>Edit Card</h1>
      <div></div>
    </div>
    <div class="container">
      <div style="background: var(--bg-tertiary); padding: 12px; border-radius: 8px; margin-bottom: 20px; font-size: 0.75rem; color: var(--text-secondary);">
        <strong>Note:</strong> Editing here saves plain text. For formatting, edit in Google Sheets.
      </div>
      <form onsubmit="updateCard(event)">
        <div class="form-group">
          <label class="form-label">Term (Front) *</label>
          <textarea class="form-input" id="card-term" required rows="3">${stripHtml(card?.term || '')}</textarea>
        </div>
        
        <div class="form-group">
          <label class="form-label">Definition (Back) *</label>
          <textarea class="form-input" id="card-definition" required rows="3">${stripHtml(card?.definition || '')}</textarea>
        </div>
        
        <div class="form-group">
          <label class="form-label">Image - Front (optional)</label>
          <input type="file" class="form-input" id="card-image-front" accept="image/*" onchange="previewImage(this, 'preview-front')">
          <div id="preview-front" style="margin-top: 8px;">
            ${card?.imageFront ? `<img src="${card.imageFront}" style="max-width: 100%; max-height: 150px; border-radius: 8px;">` : ''}
          </div>
          ${card?.imageFront ? `<button type="button" class="btn btn-secondary" style="margin-top: 8px; font-size: 0.75rem;" onclick="clearImage('front')">Remove Image</button>` : ''}
        </div>
        
        <div class="form-group">
          <label class="form-label">Image - Back (optional)</label>
          <input type="file" class="form-input" id="card-image-back" accept="image/*" onchange="previewImage(this, 'preview-back')">
          <div id="preview-back" style="margin-top: 8px;">
            ${card?.imageBack ? `<img src="${card.imageBack}" style="max-width: 100%; max-height: 150px; border-radius: 8px;">` : ''}
          </div>
          ${card?.imageBack ? `<button type="button" class="btn btn-secondary" style="margin-top: 8px; font-size: 0.75rem;" onclick="clearImage('back')">Remove Image</button>` : ''}
        </div>
        
        <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 24px;">
          Save Changes
        </button>
      </form>
    </div>
  `;
}

// ============ EVENT LISTENERS ============
function attachEventListeners() {
  // Navigation
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const view = item.dataset.view;
      state.currentView = view;
      state.currentFolder = null;
      state.studySession = null;
      
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      
      render();
    });
  });

  // Swipe handling for flashcards
  if (state.currentView === 'study-flashcards' && document.getElementById('flashcard')) {
    initSwipeHandlers();
    
    if (state.settings.autoPlayAudio) {
      const card = state.studySession.cards[state.studySession.currentIndex];
      const text = state.settings.reverse ? card.definition : card.term;
      speak(text);
    }
  }

  // Drag and drop for todos
  if (state.currentView === 'todos') {
    initDragAndDrop();
  }

  // Auto-focus on learn mode input
  if (state.currentView === 'study-learn' && !state.studySession.showingFeedback) {
    const input = document.getElementById('learn-answer-input');
    if (input) input.focus();
  }
}

// Keyboard controls
let keyHoldTimer = null;

document.addEventListener('keydown', (e) => {
  if (!state.currentView.startsWith('study')) return;
  if (e.repeat) return;

  switch (e.key) {
    case 'ArrowUp':
    case 'ArrowDown':
      if (state.currentView === 'study-flashcards') {
        e.preventDefault();
        flipCard();
      }
      break;
    case 'ArrowRight':
      if (state.currentView === 'study-flashcards') {
        e.preventDefault();
        if (!swipeState.isAnimating) markCard(true);
      }
      break;
    case 'ArrowLeft':
      if (state.currentView === 'study-flashcards') {
        e.preventDefault();
        keyHoldTimer = setTimeout(() => {
          if (state.studySession.currentIndex > 0) {
            goBackCard();
          }
          keyHoldTimer = null;
        }, 1000);
      }
      break;
  }
});

document.addEventListener('keyup', (e) => {
  if (e.key === 'ArrowLeft' && keyHoldTimer) {
    clearTimeout(keyHoldTimer);
    keyHoldTimer = null;
    if (state.currentView === 'study-flashcards' && !swipeState.isAnimating) {
      markCard(false);
    }
  }
});

// ============ INITIALIZATION ============
async function init() {
  const hasLocal = loadFromLocal();
  
  if (hasLocal) {
    document.getElementById('loading-screen').classList.add('hidden');
    render();
  }

  await requestNotificationPermission();

  const synced = await syncData();
  
  if (!hasLocal && !synced) {
    document.getElementById('app').innerHTML = `
      <div class="empty-state" style="padding-top: 100px;">
        <h3>Connection Error</h3>
        <p>Could not connect to Google Sheets.</p>
        <p style="margin-top: 16px;">Check your Apps Script URL in the code.</p>
        <button class="btn btn-primary" style="margin-top: 24px;" onclick="location.reload()">
          Retry
        </button>
      </div>
    `;
    return;
  }

  render();
  scheduleReminders();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(console.error);
  }
}

init();
