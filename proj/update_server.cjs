
const fs = require('fs');
const path = require('path');

const filePath = '/Users/sal/Downloads/ivy-blackboard/src/runtime/serve/unified-server.ts';
let content = fs.readFileSync(filePath, 'utf-8');

const workPost = `
                if (path === '/api/work' && req.method === 'POST') {
                    const body = await req.json();
                    if (!body.id) body.id = 'work-' + Math.random().toString(36).substring(2, 11);
                    return jsonOk(createWorkItem(db, body), 200, cors);
                }
`;

const projectPost = `
                if (path === '/api/projects' && req.method === 'POST') {
                    const body = await req.json();
                    return jsonOk(registerProject(db, body), 200, cors);
                }
`;

// Insert workPost after the existing GET /api/work block
const workGetMarker = "const items = listWorkItems(db, { all, status, project });\\n                    return jsonOk({ count: items.length, items }, 200, cors);\\n                }";
content = content.replace(/(const items = listWorkItems\(db, \{ all, status, project \}\);\s+return jsonOk\(\{ count: items\.length, items \}, 200, cors\);\s+\})/, "$1" + workPost);

// Insert projectPost after the existing GET /api/projects block
const projectGetMarker = "const projects = listProjects(db);\\n                    return jsonOk({ count: projects.length, items: projects }, 200, cors);\\n                }";
content = content.replace(/(const projects = listProjects\(db\);\s+return jsonOk\(\{ count: projects\.length, items: projects \}, 200, cors\);\s+\})/, "$1" + projectPost);

fs.writeFileSync(filePath, content);
console.log('Updated unified-server.ts');
