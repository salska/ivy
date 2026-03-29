
import { Database } from "bun:sqlite";
const db = new Database("/Users/sal/.pai/blackboard/local.db");
const rows = db.query("SELECT summary FROM events WHERE summary LIKE '%run_shell_command%'").all();
console.log(JSON.stringify(rows, null, 2));
db.close();
