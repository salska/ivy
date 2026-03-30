import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync(`${process.env.HOME}/.config/supertag/config.json`, 'utf-8')).bearerToken;
const TANA_API = 'http://localhost:8262';

async function main() {
  console.log('--- Probing Tana Local API ---');
  
  // 1. Search for all nodes with checkboxes
  const todos = await fetch(`${TANA_API}/nodes/search?query[and][0][is]=todo`, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  }).then(r => r.json());
  console.log(`Found ${todos.length} todos.`);
  
  // 2. Search for the node "What is the date today" by any means
  const result = await fetch(`${TANA_API}/nodes/search?query[and][0][name][contains]=What%20is%20the%20date%20today`, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  }).then(r => r.json());
  
  if (Array.isArray(result) && result.length > 0) {
    console.log('Target node found:', result[0]);
  } else {
    console.log('Target node NOT found by name search.');
  }

  // 3. List all supertags
  const tags = await fetch(`${TANA_API}/nodes/search?query[and][0][hasType]=SYS_T01`, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  }).then(r => r.json());
  
  console.log(`Supertags found: ${tags.length}`);
  const ivyTodo = tags.find((t: any) => t.name === 'ivy-todo');
  if (ivyTodo) {
    console.log('CORRECT ID for #ivy-todo:', ivyTodo.id);
  } else {
    console.log('#ivy-todo tag definition NOT found in Supertag list.');
  }

  // 5. Search for the specific node by ID in the search endpoint
  console.log('Searching for node PktdMR459AdO by ID in search...');
  const idResult = await fetch(`${TANA_API}/nodes/search?query[and][0][id]=PktdMR459AdO`, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  }).then(r => r.json());
  
  if (Array.isArray(idResult) && idResult.length > 0) {
    console.log('Node metadata found via search by ID:', idResult[0]);
    if (idResult[0].tagIds) {
      console.log('TAG IDs FOUND:', idResult[0].tagIds);
    }
  } else if (idResult && idResult.code === 'BAD_REQUEST') {
     console.log('ID search failed (400):', idResult.message);
  } else {
    console.log('Node NOT found via search by ID.');
  }
}

main();
