// ============ GOOGLE APPS SCRIPT BACKEND ============
// This file goes in Google Apps Script (script.google.com)
// Deploy as Web App with "Anyone" access

function doGet(e) {
  const action = e.parameter.action;
  
  try {
    switch(action) {
      case 'syncAll':
        return syncAll();
      case 'addFolder':
        return addFolder(e.parameter);
      case 'addDeck':
        return addDeck(e.parameter);
      case 'addCard':
        return addCard(e.parameter);
      case 'updateCard':
        return updateCard(e.parameter);
      case 'updateCardStats':
        return updateCardStats(e.parameter);
      case 'deleteCard':
        return deleteCard(e.parameter);
      case 'addTodo':
        return addTodo(e.parameter);
      case 'updateTodo':
        return updateTodo(e.parameter);
      case 'completeTodo':
        return completeTodo(e.parameter);
      case 'uncompleteTodo':
        return uncompleteTodo(e.parameter);
      case 'deleteTodo':
        return deleteTodo(e.parameter);
      case 'updateStarred':
        return updateStarred(e.parameter);
      case 'addTaskList':
        return addTaskList(e.parameter);
      case 'deleteTaskList':
        return deleteTaskList(e.parameter);
      case 'addSubtask':
        return addSubtask(e.parameter);
      default:
        return createResponse({ error: 'Unknown action' });
    }
  } catch (error) {
    return createResponse({ error: error.toString() });
  }
}

function createResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============ SYNC ALL DATA ============
function syncAll() {
  const data = {
    folders: getFolders(),
    decks: getDecks(),
    cards: getCards(),
    todos: getTodos(),
    taskLists: getTaskLists(),
    starred: getStarred()
  };
  return createResponse(data);
}

// ============ FOLDERS ============
function getFolders() {
  const sheet = getSheet('Folders');
  if (!sheet) return [];
  
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  
  return data.slice(1).map(row => ({
    path: row[0] || '',
    name: row[1] || '',
    parentPath: row[2] || '',
    order: row[3] || 0
  })).filter(f => f.path);
}

function addFolder(params) {
  const sheet = getOrCreateSheet('Folders', ['path', 'name', 'parentPath', 'order']);
  sheet.appendRow([
    params.path,
    params.name,
    params.parentPath || '',
    params.order || 0
  ]);
  return createResponse({ success: true });
}

// ============ DECKS ============
function getDecks() {
  const sheet = getSheet('Decks');
  if (!sheet) return [];
  
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  
  return data.slice(1).map(row => ({
    id: row[0] || '',
    name: row[1] || '',
    folderPath: row[2] || '',
    order: row[3] || 0
  })).filter(d => d.id);
}

function addDeck(params) {
  const sheet = getOrCreateSheet('Decks', ['id', 'name', 'folderPath', 'order']);
  sheet.appendRow([
    params.id,
    params.name,
    params.folderPath || '',
    params.order || 0
  ]);
  return createResponse({ success: true });
}

// ============ CARDS ============
function getCards() {
  const sheet = getSheet('Cards');
  if (!sheet) return [];
  
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  
  return data.slice(1).map(row => ({
    id: row[0] || '',
    deckId: row[1] || '',
    term: row[2] || '',
    definition: row[3] || '',
    imageFront: row[4] || '',
    imageBack: row[5] || '',
    wrongCount: row[6] || 0,
    lastStudied: row[7] || ''
  })).filter(c => c.id);
}

function addCard(params) {
  const sheet = getOrCreateSheet('Cards', [
    'id', 'deckId', 'term', 'definition', 'imageFront', 'imageBack', 'wrongCount', 'lastStudied'
  ]);
  sheet.appendRow([
    params.id,
    params.deckId,
    params.term,
    params.definition,
    params.imageFront || '',
    params.imageBack || '',
    0,
    ''
  ]);
  return createResponse({ success: true });
}

function updateCard(params) {
  const sheet = getSheet('Cards');
  if (!sheet) return createResponse({ error: 'Sheet not found' });
  
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === params.id) {
      sheet.getRange(i + 1, 3).setValue(params.term);
      sheet.getRange(i + 1, 4).setValue(params.definition);
      if (params.imageFront !== undefined) sheet.getRange(i + 1, 5).setValue(params.imageFront);
      if (params.imageBack !== undefined) sheet.getRange(i + 1, 6).setValue(params.imageBack);
      return createResponse({ success: true });
    }
  }
  return createResponse({ error: 'Card not found' });
}

function updateCardStats(params) {
  const sheet = getSheet('Cards');
  if (!sheet) return createResponse({ error: 'Sheet not found' });
  
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === params.id) {
      if (params.wrongCount !== undefined) {
        sheet.getRange(i + 1, 7).setValue(params.wrongCount);
      }
      if (params.lastStudied !== undefined) {
        sheet.getRange(i + 1, 8).setValue(params.lastStudied);
      }
      return createResponse({ success: true });
    }
  }
  return createResponse({ error: 'Card not found' });
}

function deleteCard(params) {
  const sheet = getSheet('Cards');
  if (!sheet) return createResponse({ error: 'Sheet not found' });
  
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === params.id) {
      sheet.deleteRow(i + 1);
      return createResponse({ success: true });
    }
  }
  return createResponse({ error: 'Card not found' });
}

// ============ TODOS ============
function getTodos() {
  const sheet = getSheet('Todos');
  if (!sheet) return [];
  
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  
  return data.slice(1).map(row => ({
    id: row[0] || '',
    title: row[1] || '',
    description: row[2] || '',
    dueDate: row[3] || '',
    dueTime: row[4] || '',
    priority: row[5] || 'task',
    reminders: row[6] ? JSON.parse(row[6]) : [],
    linkedDecks: row[7] ? JSON.parse(row[7]) : [],
    listId: row[8] || 'default',
    completed: row[9] === 'TRUE' || row[9] === true,
    completedAt: row[10] || '',
    parentId: row[11] || '',
    order: row[12] || 0,
    recurrence: row[13] || ''
  })).filter(t => t.id);
}

function addTodo(params) {
  const sheet = getOrCreateSheet('Todos', [
    'id', 'title', 'description', 'dueDate', 'dueTime', 'priority', 
    'reminders', 'linkedDecks', 'listId', 'completed', 'completedAt', 
    'parentId', 'order', 'recurrence'
  ]);
  
  sheet.appendRow([
    params.id,
    params.title,
    params.description || '',
    params.dueDate || '',
    params.dueTime || '',
    params.priority || 'task',
    params.reminders || '[]',
    params.linkedDecks || '[]',
    params.listId || 'default',
    false,
    '',
    params.parentId || '',
    params.order || 0,
    params.recurrence || ''
  ]);
  return createResponse({ success: true });
}

function updateTodo(params) {
  const sheet = getSheet('Todos');
  if (!sheet) return createResponse({ error: 'Sheet not found' });
  
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === params.id) {
      if (params.title !== undefined) sheet.getRange(i + 1, 2).setValue(params.title);
      if (params.description !== undefined) sheet.getRange(i + 1, 3).setValue(params.description);
      if (params.dueDate !== undefined) sheet.getRange(i + 1, 4).setValue(params.dueDate);
      if (params.dueTime !== undefined) sheet.getRange(i + 1, 5).setValue(params.dueTime);
      if (params.priority !== undefined) sheet.getRange(i + 1, 6).setValue(params.priority);
      if (params.reminders !== undefined) sheet.getRange(i + 1, 7).setValue(params.reminders);
      if (params.linkedDecks !== undefined) sheet.getRange(i + 1, 8).setValue(params.linkedDecks);
      if (params.order !== undefined) sheet.getRange(i + 1, 13).setValue(params.order);
      return createResponse({ success: true });
    }
  }
  return createResponse({ error: 'Todo not found' });
}

function completeTodo(params) {
  const sheet = getSheet('Todos');
  if (!sheet) return createResponse({ error: 'Sheet not found' });
  
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === params.id) {
      sheet.getRange(i + 1, 10).setValue(true);
      sheet.getRange(i + 1, 11).setValue(new Date().toISOString());
      return createResponse({ success: true });
    }
  }
  return createResponse({ error: 'Todo not found' });
}

function uncompleteTodo(params) {
  const sheet = getSheet('Todos');
  if (!sheet) return createResponse({ error: 'Sheet not found' });
  
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === params.id) {
      sheet.getRange(i + 1, 10).setValue(false);
      sheet.getRange(i + 1, 11).setValue('');
      return createResponse({ success: true });
    }
  }
  return createResponse({ error: 'Todo not found' });
}

function deleteTodo(params) {
  const sheet = getSheet('Todos');
  if (!sheet) return createResponse({ error: 'Sheet not found' });
  
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === params.id) {
      sheet.deleteRow(i + 1);
      return createResponse({ success: true });
    }
  }
  return createResponse({ error: 'Todo not found' });
}

// ============ STARRED CARDS ============
function getStarred() {
  const sheet = getSheet('Starred');
  if (!sheet) return [];
  
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  
  return data.slice(1).map(row => row[0]).filter(id => id);
}

function updateStarred(params) {
  const sheet = getOrCreateSheet('Starred', ['cardId']);
  const data = sheet.getDataRange().getValues();
  const starred = params.starred === 'true';
  
  // Find existing entry
  let found = false;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === params.cardId) {
      found = true;
      if (!starred) {
        // Remove from starred
        sheet.deleteRow(i + 1);
      }
      break;
    }
  }
  
  // Add to starred if not found and should be starred
  if (!found && starred) {
    sheet.appendRow([params.cardId]);
  }
  
  return createResponse({ success: true });
}

// ============ TASK LISTS ============
function getTaskLists() {
  const sheet = getSheet('TaskLists');
  if (!sheet) return [{ id: 'default', name: 'My Tasks', color: '#4a9eff' }];
  
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [{ id: 'default', name: 'My Tasks', color: '#4a9eff' }];
  
  const lists = data.slice(1).map(row => ({
    id: row[0] || '',
    name: row[1] || '',
    color: row[2] || '#4a9eff'
  })).filter(l => l.id);
  
  // Ensure default list exists
  if (!lists.find(l => l.id === 'default')) {
    lists.unshift({ id: 'default', name: 'My Tasks', color: '#4a9eff' });
  }
  
  return lists;
}

function addTaskList(params) {
  const sheet = getOrCreateSheet('TaskLists', ['id', 'name', 'color']);
  sheet.appendRow([
    params.id,
    params.name,
    params.color || '#4a9eff'
  ]);
  return createResponse({ success: true });
}

function deleteTaskList(params) {
  const sheet = getSheet('TaskLists');
  if (!sheet) return createResponse({ error: 'Sheet not found' });
  
  // Don't allow deleting default list
  if (params.id === 'default') {
    return createResponse({ error: 'Cannot delete default list' });
  }
  
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === params.id) {
      sheet.deleteRow(i + 1);
      return createResponse({ success: true });
    }
  }
  return createResponse({ error: 'List not found' });
}

// ============ SUBTASKS ============
function addSubtask(params) {
  const sheet = getSheet('Todos');
  if (!sheet) return createResponse({ error: 'Sheet not found' });
  
  sheet.appendRow([
    params.id,
    params.title,
    '',
    '',
    '',
    params.priority || 'task',
    '[]',
    '[]',
    params.listId || 'default',
    false,
    '',
    params.parentId,
    0,
    ''
  ]);
  return createResponse({ success: true });
}

// ============ HELPER FUNCTIONS ============
function getSheet(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

function getOrCreateSheet(name, headers = []) {
  let sheet = getSheet(name);
  
  if (!sheet) {
    sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet(name);
    if (headers.length > 0) {
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    }
  }
  
  return sheet;
}

// ============ SETUP FUNCTION ============
// Run this once to create all necessary sheets
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Create Folders sheet
  getOrCreateSheet('Folders', ['path', 'name', 'parentPath', 'order']);
  
  // Create Decks sheet
  getOrCreateSheet('Decks', ['id', 'name', 'folderPath', 'order']);
  
  // Create Cards sheet
  getOrCreateSheet('Cards', [
    'id', 'deckId', 'term', 'definition', 'imageFront', 'imageBack', 'wrongCount', 'lastStudied'
  ]);
  
  // Create Todos sheet
  getOrCreateSheet('Todos', [
    'id', 'title', 'description', 'dueDate', 'dueTime', 'priority', 
    'reminders', 'linkedDecks', 'listId', 'completed', 'completedAt', 
    'parentId', 'order', 'recurrence'
  ]);
  
  // Create Starred sheet
  getOrCreateSheet('Starred', ['cardId']);
  
  // Create TaskLists sheet
  const taskListsSheet = getOrCreateSheet('TaskLists', ['id', 'name', 'color']);
  
  // Add default task list if sheet was just created
  if (taskListsSheet.getLastRow() === 1) {
    taskListsSheet.appendRow(['default', 'My Tasks', '#4a9eff']);
  }
  
  Logger.log('All sheets created successfully!');
  return 'Setup complete! All sheets are ready.';
}
